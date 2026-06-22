import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, FolderInput, AlertTriangle, RefreshCw, Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PhotoThumb } from "@/components/PhotoThumb";
import { signedUrl } from "@/lib/photos";
import { ImageLightbox } from "@/components/ImageLightbox";
import { scanImageUrlRegion, type Rect } from "@/lib/scan";
import { STATUSES, type ShipmentStatus } from "@/lib/status";
import { toast } from "sonner";
import { format } from "date-fns";


export const Route = createFileRoute("/_authenticated/unrecognized")({
  head: () => ({ meta: [{ title: "Unrecognized — Shipment Tracking" }] }),
  component: UnrecognizedPage,
});

interface Item {
  id: string;
  barcode: string;
  created_at: string;
  images: { id: string; storage_path: string }[];
}

function UnrecognizedPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [destBarcode, setDestBarcode] = useState("");
  const [destProductCode, setDestProductCode] = useState("");
  const [destStatus, setDestStatus] = useState<ShipmentStatus>("in_warehouse");
  const [productCodes, setProductCodes] = useState<string[]>([]);
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [pcOpen, setPcOpen] = useState(false);
  const [bcOpen, setBcOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; recordId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProductCodes = async () => {
    const { data } = await supabase
      .from("shipment_records")
      .select("barcode,product_code")
      .eq("is_unrecognized", false)
      .is("deleted_at", null)
      .limit(5000);
    const pcSet = new Set<string>();
    const bcSet = new Set<string>();
    (data || []).forEach((r: any) => {
      if (r.product_code) pcSet.add(r.product_code);
      if (r.barcode) bcSet.add(r.barcode);
    });
    setProductCodes(Array.from(pcSet).sort());
    setBarcodes(Array.from(bcSet).sort());
  };


  const load = async () => {
    const { data } = await supabase
      .from("shipment_records")
      .select("id,barcode,created_at,images:shipment_images(id,storage_path)")
      .eq("is_unrecognized", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    setItems((data as any) || []);
  };
  useEffect(() => {
    load();
    loadProductCodes();
    const ch = supabase.channel("unrecog")
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_records", filter: "is_unrecognized=eq.true" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_images" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);


  const allIds = useMemo(() => items.map((i) => i.id), [items]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelected((p) => {
    const n = new Set(p);
    if (allSelected) allIds.forEach((id) => n.delete(id));
    else allIds.forEach((id) => n.add(id));
    return n;
  });

  const totalImages = useMemo(
    () => items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.images.length, 0),
    [items, selected]
  );

  const NO_CODE_BARCODE = "NO_PRODUCT_CODE";
  const NO_CODE_LABEL = "Chưa có mã sản phẩm";

  const moveSelected = async () => {
    if (!user || !selected.size) return;
    const targetBarcode = destBarcode.trim();
    const targetPc = destProductCode.trim();
    const useNoCode = (!targetBarcode && !targetPc) || targetPc === NO_CODE_BARCODE;
    setBusy(true);
    try {
      const resolveOrCreate = async (bc: string, pc: string | null) => {
        const { data: existing } = await supabase
          .from("shipment_records")
          .select("id")
          .eq("barcode", bc)
          .eq("is_unrecognized", false)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing) {
          await supabase.from("shipment_records").update({ status: destStatus }).eq("id", existing.id);
          return existing.id as string;
        }
        const { data: created, error } = await supabase
          .from("shipment_records")
          .insert({ barcode: bc, product_code: pc, status: destStatus, created_by: user.id })
          .select("id")
          .single();
        if (error) throw error;
        return created.id as string;
      };

      let targetId: string;
      if (useNoCode) {
        targetId = await resolveOrCreate(NO_CODE_BARCODE, null);
      } else if (targetBarcode) {
        targetId = await resolveOrCreate(targetBarcode, targetPc || null);
      } else {
        targetId = await resolveOrCreate(`PC-${targetPc}-${Date.now().toString(36).toUpperCase()}`, targetPc);
      }

      const sourceIds = Array.from(selected);
      const { error: e1 } = await supabase
        .from("shipment_images")
        .update({ record_id: targetId })
        .in("record_id", sourceIds);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("shipment_records")
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.id } as any)
        .in("id", sourceIds);
      if (e2) throw e2;
      await supabase.from("status_history").insert({
        record_id: targetId, user_id: user.id, action: "images_moved",
        new_value: `${totalImages} images from ${sourceIds.length} unrecognized → ${destStatus}`,
      });
      toast.success(t("unrecog.moved", { n: totalImages }));
      setSelected(new Set()); setMoveOpen(false);
      setDestBarcode(""); setDestProductCode("");
      load();
    } catch (e: any) {
      toast.error(e.message || "Move failed");
    } finally {
      setBusy(false);
    }
  };


  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!confirm(t("unrecog.deleteConfirm", { n: selected.size }))) return;
    setBusy(true);
    try {
      const ids = Array.from(selected);
      // Soft-delete — files stay in storage and the records appear in Recycle Bin.
      await supabase.from("shipment_records")
        .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null } as any)
        .in("id", ids);
      toast.success(t("unrecog.deleted", { n: ids.length }));
      setSelected(new Set());
      load();
    } finally { setBusy(false); }
  };

  /**
   * Promote an unrecognized record after a successful scan.
   * If a non-deleted record with the same barcode already exists, move all
   * images of `recordId` into that record and soft-delete `recordId` so
   * duplicates merge into one. Otherwise update `recordId` in place.
   */
  const promoteOrMerge = async (
    recordId: string,
    res: { barcode: string; productCode?: string; model?: string; rawText?: string },
    action: string,
  ): Promise<string> => {
    if (!user) throw new Error("Not authenticated");
    const { data: existing } = await supabase
      .from("shipment_records")
      .select("id")
      .eq("barcode", res.barcode)
      .eq("is_unrecognized", false)
      .is("deleted_at", null)
      .neq("id", recordId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error: mvErr } = await supabase
        .from("shipment_images")
        .update({ record_id: existing.id } as any)
        .eq("record_id", recordId);
      if (mvErr) throw mvErr;
      await supabase
        .from("shipment_records")
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.id } as any)
        .eq("id", recordId);
      await supabase.from("status_history").insert({
        record_id: existing.id, user_id: user.id, action: `${action}_merged`,
        new_value: res.barcode,
      });
      return existing.id;
    }

    const { error } = await supabase.from("shipment_records").update({
      barcode: res.barcode,
      product_code: res.productCode || null,
      model: res.model || null,
      is_unrecognized: false,
      ocr_raw_text: res.rawText || null,
    }).eq("id", recordId);
    if (error) throw error;
    await supabase.from("status_history").insert({
      record_id: recordId, user_id: user.id, action, new_value: res.barcode,
    });
    return recordId;
  };

  const onRegionScan = async (rect: Rect) => {
    if (!lightbox || !user) return;
    try {
      toast.info(t("unrecog.rescanning"));
      const res = await scanImageUrlRegion(lightbox.url, rect);
      if (!res.barcode) { toast.error(t("unrecog.stillFailed")); return; }
      await promoteOrMerge(lightbox.recordId, res, "manual_rescan");
      toast.success(t("unrecog.recognized", { code: res.barcode }));
      setLightbox(null);
      load();
    } catch (e: any) {
      toast.error(e.message || String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-semibold flex-1 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          {t("unrecog.title")} <span className="text-muted-foreground text-sm">({items.length})</span>
        </h1>
        <Button asChild variant="ghost" size="sm"><Link to="/records">{t("nav.records")}</Link></Button>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
            {t("bulk.selectAll")}
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{t("bulk.selected", { n: selected.size })} · {totalImages} {t("fields.photos").toLowerCase()}</span>
              <Button size="sm" onClick={() => setMoveOpen(true)} disabled={busy}>
                <FolderInput className="h-4 w-4 mr-1.5" /> {t("unrecog.move")}
              </Button>
              <Button size="sm" variant="destructive" onClick={deleteSelected} disabled={busy}>
                <Trash2 className="h-4 w-4 mr-1.5" /> {t("bulk.delete")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("bulk.clear")}</Button>
            </>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">{t("unrecog.empty")}</div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((it) => (
            <li key={it.id} className={`rounded-lg border overflow-hidden bg-card ${selected.has(it.id) ? "ring-2 ring-primary" : ""}`}>
              <div className="relative">
                {it.images[0] ? (
                  <PhotoThumb
                    path={it.images[0].storage_path}
                    className="h-40 w-full object-cover"
                    onClick={async () => {
                      const u = await signedUrl(it.images[0].storage_path);
                      setLightbox({ url: u, recordId: it.id });
                    }}
                  />
                ) : (
                  <div className="h-40 bg-muted" />
                )}
                <label className="absolute top-2 left-2 bg-black/60 rounded p-1">
                  <Checkbox checked={selected.has(it.id)} onCheckedChange={() => toggle(it.id)} />
                </label>
                {it.images.length > 1 && (
                  <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                    +{it.images.length - 1}
                  </span>
                )}
              </div>
              <div className="p-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{format(new Date(it.created_at), "yyyy-MM-dd HH:mm")}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  disabled={busy || !it.images[0]}
                  onClick={async () => {
                    if (!it.images[0] || !user) return;
                    setBusy(true);
                    try {
                      const u = await signedUrl(it.images[0].storage_path);
                      const res = await scanImageUrlRegion(u);
                      if (!res.barcode) { toast.error(t("unrecog.stillFailed")); return; }
                      await promoteOrMerge(it.id, res, "rescan");
                      toast.success(t("unrecog.recognized", { code: res.barcode }));
                      load();
                    } catch (e: any) {
                      toast.error(e?.message || String(e));
                    } finally { setBusy(false); }
                  }}
                  title={t("unrecog.rescan")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>

            </li>
          ))}
        </ul>
      )}

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("unrecog.moveTitle", { n: totalImages })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("unrecog.destProductCode")}</Label>
              <Popover open={pcOpen} onOpenChange={setPcOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={pcOpen}
                    className={cn("w-full justify-between font-normal", !destProductCode && "text-muted-foreground")}
                  >
                    {destProductCode === NO_CODE_BARCODE ? NO_CODE_LABEL : (destProductCode || t("unrecog.pickProductCode"))}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                  <Command>
                    <CommandInput placeholder={t("unrecog.searchProductCode") as string} />
                    <CommandList>
                      <CommandEmpty>{productCodes.length === 0 ? t("unrecog.noProductCodes") : t("unrecog.noMatch")}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value={NO_CODE_LABEL}
                          onSelect={() => { setDestProductCode(NO_CODE_BARCODE); setDestBarcode(""); setPcOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", destProductCode === NO_CODE_BARCODE ? "opacity-100" : "opacity-0")} />
                          <span className="font-medium">📂 {NO_CODE_LABEL}</span>
                        </CommandItem>
                        {destProductCode && destProductCode !== NO_CODE_BARCODE && (
                          <CommandItem
                            value="__clear__"
                            onSelect={() => { setDestProductCode(""); setPcOpen(false); }}
                          >
                            <span className="text-muted-foreground">— {t("common.cancel")} —</span>
                          </CommandItem>
                        )}
                        {productCodes.map((pc) => (
                          <CommandItem
                            key={pc}
                            value={pc}
                            onSelect={(v) => { setDestProductCode(v); setPcOpen(false); }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", destProductCode === pc ? "opacity-100" : "opacity-0")} />
                            {pc}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">{t("unrecog.destProductHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("fields.status")}</Label>
              <Select value={destStatus} onValueChange={(v) => setDestStatus(v as ShipmentStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("unrecog.destBarcode")}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. ANH_SAN_PHAM, BOX_PHOTOS, REWORK…"
                  value={destBarcode}
                  onChange={(e) => setDestBarcode(e.target.value)}
                  className="flex-1"
                />
                <Popover open={bcOpen} onOpenChange={setBcOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="icon" title={t("unrecog.searchBarcode") as string}>
                      <Search className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[320px]" align="end">
                    <Command>
                      <CommandInput placeholder={t("unrecog.searchBarcode") as string} />
                      <CommandList>
                        <CommandEmpty>{t("unrecog.noMatch")}</CommandEmpty>
                        <CommandGroup>
                          {barcodes.map((bc) => (
                            <CommandItem
                              key={bc}
                              value={bc}
                              onSelect={(v) => { setDestBarcode(v); setBcOpen(false); }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", destBarcode === bc ? "opacity-100" : "opacity-0")} />
                              <span className="truncate">{bc}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  { key: "ANH_SAN_PHAM", label: "Ảnh Sản Phẩm" },
                  { key: "BOX_PHOTOS", label: "BOX_PHOTOS" },
                  { key: "MANUAL_CHECK", label: "MANUAL_CHECK" },
                  { key: "REWORK", label: "REWORK" },
                  { key: "ADDITIONAL_IMAGES", label: "ADDITIONAL_IMAGES" },
                ].map((p) => (
                  <Button
                    key={p.key}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setDestBarcode(destProductCode ? `${destProductCode}__${p.key}` : p.key)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("unrecog.destBarcodeHint")}</p>
            </div>

          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMoveOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={moveSelected} disabled={busy}>{t("unrecog.moveAll")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lightbox && (
        <ImageLightbox
          src={lightbox.url}
          onClose={() => setLightbox(null)}
          onRegionScan={onRegionScan}
        />
      )}
    </div>
  );
}
