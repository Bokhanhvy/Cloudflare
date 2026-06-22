import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Undo2, Loader2, Image as ImageIcon, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { format } from "date-fns";
import { StatusBadge } from "@/components/StatusBadge";
import { PhotoThumb } from "@/components/PhotoThumb";
import type { ShipmentStatus } from "@/lib/status";

export const Route = createFileRoute("/_authenticated/trash")({
  head: () => ({ meta: [{ title: "Recycle Bin — Shipment Tracking" }] }),
  component: TrashPage,
});

interface TrashItem {
  key: string;
  type: "record" | "photo";
  id: string;
  record_id: string;
  barcode: string;
  product_code: string | null;
  status: ShipmentStatus;
  is_unrecognized: boolean;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name?: string | null;
  created_at: string;
  image_count?: number;
  storage_path?: string;
}

function TrashPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: recordData, error: recordError } = await supabase
      .from("shipment_records")
      .select("id,barcode,product_code,status,is_unrecognized,deleted_at,deleted_by,created_at,shipment_images(id)")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(1000);
    const { data: photoData, error: photoError } = await supabase
      .from("shipment_images")
      .select("id,record_id,storage_path,deleted_at,deleted_by,created_at,shipment_records(id,barcode,product_code,status,is_unrecognized,deleted_at)")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(1000);
    if (recordError || photoError) {
      toast.error(recordError?.message || photoError?.message || "Load failed");
      setItems([]);
      setLoading(false);
      return;
    }

    const deletedByIds = Array.from(new Set([
      ...((recordData as any[]) || []).map((r) => r.deleted_by).filter(Boolean),
      ...((photoData as any[]) || []).map((r) => r.deleted_by).filter(Boolean),
    ]));
    const names = new Map<string, string>();
    if (deletedByIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .in("id", deletedByIds);
      for (const p of profiles || []) names.set(p.id, p.display_name || p.email || "");
    }

    const records: TrashItem[] = ((recordData as any[]) || []).map((r) => ({
      key: `record:${r.id}`,
      type: "record",
      id: r.id,
      record_id: r.id,
      barcode: r.barcode,
      product_code: r.product_code,
      status: r.status,
      is_unrecognized: r.is_unrecognized,
      deleted_at: r.deleted_at,
      deleted_by: r.deleted_by,
      deleted_by_name: r.deleted_by ? names.get(r.deleted_by) : null,
      created_at: r.created_at,
      image_count: r.shipment_images?.length ?? 0,
    }));
    const photos: TrashItem[] = ((photoData as any[]) || [])
      .filter((img) => !img.shipment_records?.deleted_at)
      .map((img) => ({
        key: `photo:${img.id}`,
        type: "photo",
        id: img.id,
        record_id: img.record_id,
        barcode: img.shipment_records?.barcode || "",
        product_code: img.shipment_records?.product_code || null,
        status: img.shipment_records?.status || "in_warehouse",
        is_unrecognized: !!img.shipment_records?.is_unrecognized,
        deleted_at: img.deleted_at,
        deleted_by: img.deleted_by,
        deleted_by_name: img.deleted_by ? names.get(img.deleted_by) : null,
        created_at: img.created_at,
        image_count: 1,
        storage_path: img.storage_path,
      }));
    setItems([...records, ...photos].sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((r) =>
      r.barcode.toLowerCase().includes(s) || (r.product_code || "").toLowerCase().includes(s)
    );
  }, [items, q]);

  const allIds = filtered.map((i) => i.key);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((p) => {
    const n = new Set(p);
    if (allSelected) allIds.forEach((id) => n.delete(id));
    else allIds.forEach((id) => n.add(id));
    return n;
  });

  const restoreSelected = async () => {
    if (!selected.size) return;
    setBusy(true);
    const chosen = items.filter((item) => selected.has(item.key));
    const recordIds = chosen.filter((item) => item.type === "record").map((item) => item.id);
    const photoIds = chosen.filter((item) => item.type === "photo").map((item) => item.id);
    const { error } = recordIds.length
      ? await supabase.from("shipment_records").update({ deleted_at: null, deleted_by: null } as any).in("id", recordIds)
      : { error: null };
    setBusy(false);
    if (error) return toast.error(error.message);
    if (recordIds.length) {
      await supabase.from("shipment_images").update({ deleted_at: null, deleted_by: null } as any).in("record_id", recordIds);
    }
    if (photoIds.length) {
      const { error: photoError } = await supabase.from("shipment_images").update({ deleted_at: null, deleted_by: null } as any).in("id", photoIds);
      if (photoError) return toast.error(photoError.message);
    }
    // Audit
    if (user) {
      await supabase.from("status_history").insert(
        chosen.map((item) => ({ record_id: item.record_id, user_id: user.id, action: "restored_from_trash" }))
      );
    }
    toast.success(t("trash.restored", { n: chosen.length }));
    setSelected(new Set());
    load();
  };

  const purgeSelected = async () => {
    if (!selected.size) return;
    if (!confirm(t("trash.purgeConfirm", { n: selected.size }))) return;
    setBusy(true);
    try {
      const chosen = items.filter((item) => selected.has(item.key));
      const recordIds = chosen.filter((item) => item.type === "record").map((item) => item.id);
      const photoItems = chosen.filter((item) => item.type === "photo");
      // Remove storage objects then DB rows
      const { data: imgs } = recordIds.length
        ? await supabase.from("shipment_images").select("storage_path").in("record_id", recordIds)
        : { data: [] as any[] };
      const paths = [
        ...((imgs || []).map((i: any) => i.storage_path).filter(Boolean)),
        ...photoItems.map((item) => item.storage_path).filter(Boolean),
      ] as string[];
      if (paths.length) await supabase.storage.from("shipment-photos").remove(paths);
      if (photoItems.length) await supabase.from("shipment_images").delete().in("id", photoItems.map((item) => item.id));
      if (recordIds.length) {
        await supabase.from("shipment_images").delete().in("record_id", recordIds);
        const { error } = await supabase.from("shipment_records").delete().in("id", recordIds);
        if (error) throw error;
      }
      toast.success(t("trash.purged", { n: chosen.length }));
      setSelected(new Set());
      load();
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">{t("trash.title")}</h1>
        <Input className="max-w-xs" placeholder={t("records.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="text-sm text-muted-foreground">{t("trash.help")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
        <span className="text-sm text-muted-foreground">{t("bulk.selected", { n: selected.size })}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={restoreSelected} disabled={!selected.size || busy}>
            <Undo2 className="h-4 w-4 mr-1" /> {t("trash.restore")}
          </Button>
          <Button variant="destructive" size="sm" onClick={purgeSelected} disabled={!selected.size || busy}>
            <Trash2 className="h-4 w-4 mr-1" /> {t("trash.purge")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> ...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">{t("trash.empty")}</div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {filtered.map((r) => (
            <li key={r.key} className="flex items-center gap-3 p-3">
              <Checkbox checked={selected.has(r.key)} onCheckedChange={() => toggle(r.key)} />
              {r.type === "photo" && r.storage_path ? (
                <PhotoThumb path={r.storage_path} className="h-14 w-14 shrink-0 object-cover rounded" />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded border bg-muted/50 flex items-center justify-center text-muted-foreground">
                  <Package className="h-5 w-5" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm truncate">{r.barcode}</span>
                  <span className="text-xs inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    {r.type === "photo" ? <ImageIcon className="h-3 w-3" /> : <Package className="h-3 w-3" />}
                    {t(`trash.${r.type}`)}
                  </span>
                  {r.is_unrecognized && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700">{t("nav.unrecognized")}</span>}
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-0.5">
                  {r.product_code && <span>{r.product_code}</span>}
                  <span>{t("fields.photos")}: {r.image_count}</span>
                  <span>{t("trash.deletedAt")}: {format(new Date(r.deleted_at), "yyyy-MM-dd HH:mm")}</span>
                  {r.deleted_by_name && <span>{t("trash.deletedBy")}: {r.deleted_by_name}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
