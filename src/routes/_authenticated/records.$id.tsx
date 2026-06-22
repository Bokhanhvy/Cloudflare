import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Copy, Trash2, Plus, AlertTriangle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { StatusBadge } from "@/components/StatusBadge";
import { PhotoThumb } from "@/components/PhotoThumb";
import { signedUrl, deletePhoto, uploadPhoto } from "@/lib/photos";
import { compressImage } from "@/lib/image";
import { copy } from "@/lib/clipboard";
import { STATUSES, statusWarningKey, type ShipmentStatus } from "@/lib/status";
import { format } from "date-fns";
import { toast } from "sonner";
import { ImageLightbox } from "@/components/ImageLightbox";
import { scanImageUrlRegion, type Rect } from "@/lib/scan";


export const Route = createFileRoute("/_authenticated/records/$id")({
  head: () => ({ meta: [{ title: "Record — Shipment Tracking" }] }),
  component: RecordDetail,
});

function RecordDetail() {
  const { id } = useParams({ from: "/_authenticated/records/$id" });
  const { t } = useTranslation();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [record, setRecord] = useState<any | null>(null);
  const [images, setImages] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: r } = await supabase
      .from("shipment_records")
      .select("*,profiles:created_by(display_name,email)")
      .eq("id", id)
      .maybeSingle();
    setRecord(r);
    setEdit({
      product_code: r?.product_code || "",
      model: r?.model || "",
      status: r?.status || "in_warehouse",
      notes: r?.notes || "",
      barcode: r?.barcode || "",
    });
    const { data: imgs } = await supabase
      .from("shipment_images")
      .select("*")
      .eq("record_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    setImages(imgs || []);
    const { data: hist } = await supabase
      .from("status_history")
      .select("*,profiles:user_id(display_name,email)")
      .eq("record_id", id)
      .order("created_at", { ascending: false });
    setHistory(hist || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`rec-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_records", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_images", filter: `record_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "status_history", filter: `record_id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id]);

  const save = async () => {
    if (!user || !record) return;
    setBusy(true);
    try {
      const changes: Array<{ field: string; old: any; new: any }> = [];
      for (const k of ["barcode", "product_code", "model", "status", "notes"] as const) {
        if ((record[k] || "") !== (edit[k] || "")) {
          changes.push({ field: k, old: record[k], new: edit[k] });
        }
      }
      if (!changes.length) {
        toast.info("No changes");
        setBusy(false);
        return;
      }
      const statusChanged = (record.status || "") !== (edit.status || "");
      const { error } = await supabase.from("shipment_records").update({
        barcode: edit.barcode.trim(),
        product_code: edit.product_code.trim() || null,
        model: edit.model.trim() || null,
        status: edit.status,
        notes: edit.notes.trim() || null,
        ...(statusChanged ? { status_changed_at: new Date().toISOString() } : {}),
      } as any).eq("id", id);
      if (error) throw error;
      for (const c of changes) {
        await supabase.from("status_history").insert({
          record_id: id, user_id: user.id,
          action: c.field === "status" ? "status_changed" : "field_updated",
          field: c.field, old_value: String(c.old ?? ""), new_value: String(c.new ?? ""),
        });
      }
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files || !user) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const cf = await compressImage(f);
        await uploadPhoto(cf, id, user.id);
      }
      toast.success("Uploaded");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (img: any) => {
    if (!user) return;
    if (!confirm(t("trash.confirmMoveOne", { defaultValue: "Move this photo to Recycle Bin?" }))) return;
    try {
      await deletePhoto(img.id, img.storage_path, id, user.id);
      toast.success(t("trash.movedToTrash"));
    } catch (e: any) {
      toast.error(e?.message || String(e));
    }
  };

  const removeRecord = async () => {
    if (!confirm(t("records.deleteConfirm"))) return;
    const { error } = await supabase.from("shipment_records")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null } as any)
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("trash.movedToTrash")); window.history.back(); }
  };

  const openLightbox = async (path: string) => {
    const u = await signedUrl(path);
    setLightbox(u);
  };

  const onRegionScan = async (rect: Rect) => {
    if (!lightbox || !user) return;
    try {
      toast.info(t("detail.rescanning"));
      const res = await scanImageUrlRegion(lightbox, rect);
      if (!res.barcode) { toast.error(t("detail.rescanFailed")); return; }
      setEdit((e: any) => ({
        ...e,
        barcode: res.barcode,
        product_code: res.productCode || e.product_code,
        model: res.model || e.model,
      }));
      toast.success(t("detail.rescanFound", { code: res.barcode }));
    } catch (e: any) {
      toast.error(e.message || String(e));
    }
  };


  if (!record) return <div className="text-sm text-muted-foreground">…</div>;

  const wk = statusWarningKey(edit.status as ShipmentStatus);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/records"><ArrowLeft className="h-4 w-4 mr-1" /> {t("nav.records")}</Link>
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="destructive" size="sm" onClick={removeRecord}>
            <Trash2 className="h-4 w-4 mr-1" /> {t("records.delete")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-lg break-all">{record.barcode}</code>
        <Button size="icon" variant="ghost" onClick={() => copy(record.barcode)}>
          <Copy className="h-4 w-4" />
        </Button>
        <StatusBadge status={record.status} />
      </div>
      {wk && (
        <div className="rounded border border-orange-300 bg-orange-50 text-orange-800 px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {t(wk)}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>{t("fields.photos")} ({images.length})</Label>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Plus className="h-4 w-4 mr-1" /> {t("detail.addPhotos")}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => addPhotos(e.target.files)} />
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              <PhotoThumb path={img.storage_path} onClick={() => openLightbox(img.storage_path)}
                className="h-24 w-full object-cover rounded border" />
              <button
                onClick={() => removePhoto(img)}
                className="absolute top-1 right-1 rounded-full bg-black/60 text-white p-1 opacity-0 group-hover:opacity-100 transition"
                title={t("detail.deletePhoto")}
              ><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>

      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("fields.barcode")}</Label>
          <Input value={edit.barcode} onChange={(e) => setEdit({ ...edit, barcode: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("fields.productCode")}</Label>
          <Input value={edit.product_code} onChange={(e) => setEdit({ ...edit, product_code: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("fields.model")}</Label>
          <Input value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("fields.status")}</Label>
          <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label>{t("fields.notes")}</Label>
          <Textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
        </div>
      </div>

      <Button onClick={save} disabled={busy}>
        <Save className="h-4 w-4 mr-1" /> {t("detail.save")}
      </Button>

      <div className="text-xs text-muted-foreground">
        {t("fields.createdBy")}: {record.profiles?.display_name || record.profiles?.email} ·{" "}
        {t("fields.createdAt")}: {format(new Date(record.created_at), "yyyy-MM-dd HH:mm")} ·{" "}
        {t("fields.updatedAt")}: {format(new Date(record.updated_at), "yyyy-MM-dd HH:mm")}
      </div>

      {record.ocr_raw_text && (
        <details className="rounded border bg-muted/30 p-3">
          <summary className="cursor-pointer text-sm font-medium">OCR Raw Text</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{record.ocr_raw_text}</pre>
        </details>
      )}

      <div className="rounded-lg border bg-card">
        <div className="px-3 py-2 border-b font-medium text-sm">{t("detail.history")}</div>
        <div className="divide-y">
          {history.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">{t("history.empty")}</div>
          )}
          {history.map((h) => (
            <div key={h.id} className="p-3 text-xs flex flex-wrap gap-2">
              <span className="text-muted-foreground">{format(new Date(h.created_at), "yyyy-MM-dd HH:mm")}</span>
              <span className="font-medium">{h.profiles?.display_name || h.profiles?.email || "?"}</span>
              <span className="text-primary">{h.action}</span>
              {h.field && <span className="text-muted-foreground">{h.field}</span>}
              {h.old_value && <span className="line-through text-muted-foreground">{h.old_value}</span>}
              {h.new_value && <span>→ {h.new_value}</span>}
            </div>
          ))}
        </div>
      </div>

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} onRegionScan={onRegionScan} />}
    </div>
  );
}
