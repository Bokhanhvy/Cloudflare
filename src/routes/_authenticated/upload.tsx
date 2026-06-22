import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Upload as UploadIcon, Loader2, CheckCircle2, XCircle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { scanFile, scanFileMulti, scanRegion, type Rect, type ScanResult } from "@/lib/scan";
import { compressImage } from "@/lib/image";
import { uploadPhoto } from "@/lib/photos";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { STATUSES, type ShipmentStatus } from "@/lib/status";
import { StatusBadge } from "@/components/StatusBadge";
import { ImageLightbox } from "@/components/ImageLightbox";
import { toast } from "sonner";


export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({ meta: [{ title: "Upload — Shipment Tracking" }] }),
  component: UploadPage,
});

// "preparing" = file picked and previewed locally, compression/scan not done yet.
// "scanning" = compressing + decoding the QR/barcode.
// "uploading" = record created/found, photo bytes are being sent to storage.
type ItemState = "preparing" | "pending" | "scanning" | "uploading" | "created" | "added" | "failed";
interface BatchItem {
  id: string;
  file: File;
  url: string;
  state: ItemState;
  barcode?: string;
  productCode?: string;
  model?: string;
  rawText?: string;
  recordId?: string;
  existingStatus?: ShipmentStatus;
  error?: string;
  confidence?: number;
  method?: string;
  format?: string;
  qrIndex?: number; // 1-based when the source photo contained multiple QRs
  qrTotal?: number;
}

// ---------------------------------------------------------------------------
// Module-level upload store.
//
// Keeping the batch items + "busy" flag outside the React component means an
// in-flight batch keeps running (compression, scanning, Supabase inserts,
// storage uploads) even if the user navigates to another route/tab and the
// UploadPage component unmounts. The component re-subscribes to this store
// on mount and simply renders whatever is currently in progress.
// ---------------------------------------------------------------------------
let storeItems: BatchItem[] = [];
let storeBusy = false;
const storeListeners = new Set<() => void>();

function notifyStore() {
  for (const l of storeListeners) l();
}

function setStoreItems(updater: (prev: BatchItem[]) => BatchItem[]) {
  storeItems = updater(storeItems);
  notifyStore();
}

function setStoreBusy(v: boolean) {
  storeBusy = v;
  notifyStore();
  if (v) requestWakeLock();
  else releaseWakeLock();
}

// ---------------------------------------------------------------------------
// Screen Wake Lock.
//
// While a batch is uploading, ask the OS to keep the screen on so the phone
// doesn't lock itself mid-upload from its own screen-timeout. This is a
// best-effort improvement, not a guarantee:
// - It only keeps the *screen* on. It does nothing once the user manually
//   presses the power button, switches to another app, or the browser tab
//   is closed — at that point the OS can suspend or kill the page's JS at
//   any time and there is no web API that can prevent that (this is an
//   intentional OS-level restriction, strictest on iOS).
// - The lock itself is automatically released by the browser the moment the
//   tab becomes hidden (app-switch, screen off, etc.), so it can't be used
//   to "force" background execution either — it only helps for the time the
//   screen would otherwise have dimmed/locked while the page stays visible.
// - Not supported in every browser; failures are swallowed so upload still
//   works exactly as before wherever Wake Lock isn't available.
let wakeLock: any = null;

async function requestWakeLock() {
  try {
    const nav = navigator as any;
    if (!nav.wakeLock || document.visibilityState !== "visible") return;
    if (wakeLock) return; // already held
    wakeLock = await nav.wakeLock.request("screen");
    wakeLock.addEventListener?.("release", () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release?.();
  } catch {
    // Ignore.
  }
  wakeLock = null;
}

if (typeof document !== "undefined") {
  // The lock is auto-released whenever the tab is hidden. Re-acquire it as
  // soon as the tab becomes visible again, but only if a batch is still in
  // progress — this covers the case where the user briefly glanced away
  // (e.g. a notification) and comes back while the upload is still running.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && storeBusy) {
      requestWakeLock();
    }
  });
}


function useUploadStore() {
  const [items, setItemsLocal] = useState<BatchItem[]>(storeItems);
  const [busy, setBusyLocal] = useState<boolean>(storeBusy);
  useEffect(() => {
    const listener = () => {
      setItemsLocal(storeItems);
      setBusyLocal(storeBusy);
    };
    storeListeners.add(listener);
    // Sync immediately in case the store changed between render and mount.
    listener();
    return () => {
      storeListeners.delete(listener);
    };
  }, []);
  return { items, busy };
}

// Warn the user before they close/refresh the tab while an upload is still running,
// so they don't lose track of an in-flight batch. This does NOT stop the upload —
// the promises below keep running regardless of navigation, this is just a courtesy.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (storeBusy) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function UploadPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const _nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const { items, busy } = useUploadStore();
  const [defaultStatus, setDefaultStatus] = useState<ShipmentStatus>("in_warehouse");
  const [previewId, setPreviewId] = useState<string | null>(null);


  const updateItem = (id: string, patch: Partial<BatchItem>) =>
    setStoreItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const processOne = async (item: BatchItem) => {
    if (!user) return;
    try {
      // Make sure this user's profile row exists (FK target for created_by)
      await (supabase as any).rpc("ensure_profile");

      // Scan was already performed up-front in handleFiles (so a single photo
      // with multiple QR codes can be expanded into one row per code). If no
      // barcode was found at that stage, route the photo to Unrecognized.
      const scan = item.barcode
        ? {
            barcode: item.barcode,
            productCode: item.productCode || "",
            model: item.model || "",
            rawText: item.rawText || "",
            confidence: item.confidence ?? 0,
            method: (item.method as any) || "jsqr",
            format: item.format || "QR_CODE",
          }
        : null;

      // Unrecognized: still keep the image under a dedicated record
      if (!scan) {
        updateItem(item.id, { state: "uploading" });
        const placeholder = `UNRECOG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const { data, error } = await supabase
          .from("shipment_records")
          .insert({
            barcode: placeholder,
            status: defaultStatus,
            is_unrecognized: true,
            created_by: user.id,
          })
          .select("id")
          .single();
        if (error) throw error;
        await uploadPhoto(item.file, data.id, user.id);
        updateItem(item.id, { state: "failed", recordId: data.id, error: t("batch.unrecognizedStored") });
        return;
      }

      updateItem(item.id, { state: "uploading" });


      // Check duplicate (skip unrecognized rows)
      const { data: existing } = await supabase
        .from("shipment_records")
        .select("id,status")
        .eq("barcode", scan.barcode)
        .eq("is_unrecognized", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let recordId: string;
      let resultState: ItemState;
      if (existing) {
        recordId = existing.id;
        // Latest upload wins: update status + bump updated_at, log history
        const { error: updErr } = await supabase
          .from("shipment_records")
          .update({
            status: defaultStatus,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", recordId);
        if (updErr) throw updErr;
        if (existing.status !== defaultStatus) {
          await supabase.from("status_history").insert({
            record_id: recordId,
            user_id: user.id,
            action: "status_changed",
            field: "status",
            old_value: existing.status,
            new_value: defaultStatus,
          });
        }
        await supabase.from("status_history").insert({
          record_id: recordId,
          user_id: user.id,
          action: "photo_reupload",
          new_value: defaultStatus,
        });
        resultState = "added";
      } else {
        const { data, error } = await supabase
          .from("shipment_records")
          .insert({
            barcode: scan.barcode,
            product_code: scan.productCode || null,
            model: scan.model || null,
            status: defaultStatus,
            ocr_raw_text: scan.rawText || null,
            created_by: user.id,
          })
          .select("id")
          .single();
        if (error) {
          // Race: another concurrent upload just created the same barcode.
          // Re-fetch and merge into the existing record instead of duplicating.
          const { data: refound } = await supabase
            .from("shipment_records")
            .select("id,status")
            .eq("barcode", scan.barcode)
            .eq("is_unrecognized", false)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!refound) throw error;
          recordId = refound.id;
          await supabase
            .from("shipment_records")
            .update({ status: defaultStatus, updated_at: new Date().toISOString() } as any)
            .eq("id", recordId);
          if (refound.status !== defaultStatus) {
            await supabase.from("status_history").insert({
              record_id: recordId,
              user_id: user.id,
              action: "status_changed",
              field: "status",
              old_value: refound.status,
              new_value: defaultStatus,
            });
          }
          await supabase.from("status_history").insert({
            record_id: recordId,
            user_id: user.id,
            action: "photo_reupload",
            new_value: defaultStatus,
          });
          resultState = "added";
        } else {
          recordId = data.id;
          await supabase.from("status_history").insert({
            record_id: recordId,
            user_id: user.id,
            action: "record_created",
            new_value: defaultStatus,
          });
          resultState = "created";
        }
      }
      await uploadPhoto(item.file, recordId, user.id);
      item.recordId = recordId;
      updateItem(item.id, {
        state: resultState,
        recordId,
        existingStatus: defaultStatus,

      });
    } catch (e: any) {
      updateItem(item.id, { state: "failed", error: e?.message || String(e) });
    }
  };

  /** Re-scan an item using full image or a manually-cropped rect, and update its record. */
  const rescanItem = async (item: BatchItem, rect?: Rect) => {
    if (!user) return;
    try {
      updateItem(item.id, { state: "scanning" });
      const res = rect ? await scanRegion(item.file, rect) : await scanFile(item.file);
      if (!res.barcode) {
        toast.error(t("unrecog.stillFailed"));
        updateItem(item.id, { state: item.recordId ? "failed" : "pending", error: t("unrecog.stillFailed") });
        return;
      }
      // If the item already has a record (e.g. unrecognized placeholder), promote it.
      if (item.recordId) {
        await supabase.from("shipment_records").update({
          barcode: res.barcode,
          product_code: res.productCode || null,
          model: res.model || null,
          is_unrecognized: false,
          ocr_raw_text: res.rawText || null,
        }).eq("id", item.recordId);
        await supabase.from("status_history").insert({
          record_id: item.recordId, user_id: user.id, action: "manual_rescan", new_value: res.barcode,
        });
        updateItem(item.id, {
          state: "created",
          barcode: res.barcode,
          productCode: res.productCode,
          model: res.model,
          confidence: res.confidence,
          method: res.method,
          error: undefined,
        });
        toast.success(t("unrecog.recognized", { code: res.barcode }));
      } else {
        // No record yet — just update local data.
        updateItem(item.id, {
          state: "pending",
          barcode: res.barcode,
          productCode: res.productCode,
          model: res.model,
          rawText: res.rawText,
          confidence: res.confidence,
          method: res.method,
        });
        toast.success(t("unrecog.recognized", { code: res.barcode }));
      }

    } catch (e: any) {
      updateItem(item.id, { state: "failed", error: e?.message || String(e) });
    }
  };


  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    setStoreBusy(true);
    try {
      const arr = Array.from(files);

      // Show every picked photo immediately as a "preparing" placeholder with its
      // own local preview URL, before any compression/scanning/upload happens.
      // This gives instant visual feedback instead of a blank "0/0" screen.
      const placeholders: BatchItem[] = arr.map((file, idx) => ({
        id: `placeholder-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        url: URL.createObjectURL(file),
        state: "preparing",
      }));
      setStoreItems((prev) => [...prev, ...placeholders]);

      // Compress + scan up-front, in parallel, so a single photo containing
      // multiple QR codes expands into one BatchItem per detected code. Each
      // placeholder is replaced by its real item(s) as soon as its own
      // compression/scan finishes, instead of waiting for the whole batch.
      const PREP_CONCURRENCY = Math.min(8, Math.max(4, navigator.hardwareConcurrency ?? 4));
      const buckets: BatchItem[][] = new Array(arr.length).fill(null).map(() => []);
      let ci = 0;
      await Promise.all(
        Array.from({ length: Math.min(PREP_CONCURRENCY, arr.length) }, async () => {
          while (true) {
            const idx = ci++;
            if (idx >= arr.length) break;
            const placeholder = placeholders[idx];
            updateItem(placeholder.id, { state: "scanning" });
            const compressed = await compressImage(arr[idx]);
            const url = URL.createObjectURL(compressed);
            let scans: ScanResult[] = [];
            try {
              scans = await scanFileMulti(compressed);
            } catch {
              scans = [];
            }
            const base = `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
            let resolved: BatchItem[];
            if (scans.length === 0) {
              resolved = [{ id: `${base}-u`, file: compressed, url, state: "pending" }];
            } else {
              const total = scans.length;
              resolved = scans.map((s, k) => ({
                id: `${base}-${k}`,
                file: compressed,
                url,
                state: "pending" as ItemState,
                barcode: s.barcode,
                productCode: s.productCode,
                model: s.model,
                rawText: s.rawText,
                confidence: s.confidence,
                method: s.method,
                format: s.format,
                qrIndex: total > 1 ? k + 1 : undefined,
                qrTotal: total > 1 ? total : undefined,
              }));
            }
            buckets[idx] = resolved;
            // Swap the temporary placeholder for the real, scanned item(s) as
            // soon as they're ready, so the list updates progressively rather
            // than all at once at the end of the batch.
            setStoreItems((prev) => {
              const out: BatchItem[] = [];
              for (const it of prev) {
                if (it.id === placeholder.id) out.push(...resolved);
                else out.push(it);
              }
              return out;
            });
            URL.revokeObjectURL(placeholder.url);
          }
        }),
      );
      const prepared = buckets.flat();

      // Group items by barcode so duplicates collapse onto the same record
      // instead of racing each other to insert. Items without a barcode
      // (unrecognized) are each their own group.
      const groups = new Map<string, BatchItem[]>();
      prepared.forEach((it, i) => {
        const key = it.barcode ? `bc:${it.barcode}` : `u:${i}`;
        const g = groups.get(key);
        if (g) g.push(it);
        else groups.set(key, [it]);
      });
      const groupList = Array.from(groups.values());

      // Process groups in parallel; within a group, items run sequentially so
      // the first one creates/finds the record and the rest attach to it.
      // These promises run against the module-level store, so they keep going
      // to completion even if the user navigates away from this page or
      // switches tabs while the batch is still in flight.
      const UPLOAD_CONCURRENCY = 10;
      let gi = 0;
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, groupList.length) }, async () => {
          while (true) {
            const idx = gi++;
            if (idx >= groupList.length) break;
            const group = groupList[idx];
            await processOne(group[0]);
            // Reuse the recordId resolved by the first item for the rest.
            for (let k = 1; k < group.length; k++) {
              const head = group[0];
              const sibling = group[k];
              if (head.recordId) {
                try {
                  updateItem(sibling.id, { state: "uploading" });
                  await uploadPhoto(sibling.file, head.recordId, user!.id);
                  updateItem(sibling.id, {
                    state: "added",
                    recordId: head.recordId,
                    existingStatus: defaultStatus,
                  });
                } catch (e: any) {
                  updateItem(sibling.id, { state: "failed", error: e?.message || String(e) });
                }
              } else {
                // First item failed without a record — process sibling normally.
                await processOne(sibling);
              }
            }
          }
        }),
      );

      const ok = prepared.filter((p) => p.state !== "failed").length;
      toast.success(t("batch.summary", { ok, total: prepared.length }));
    } finally {
      // Always release busy (and therefore the wake lock) even if something
      // above threw unexpectedly — an upload error should never leave the
      // screen pinned on indefinitely.
      setStoreBusy(false);
    }
  };

  const clearAll = () => setStoreItems(() => []);

  const okCount = items.filter((i) => i.state === "created" || i.state === "added").length;
  const failCount = items.filter((i) => i.state === "failed").length;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold">{t("upload.title")}</h1>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="space-y-1.5 flex-1">
          <Label>{t("batch.defaultStatus")}</Label>
          <Select value={defaultStatus} onValueChange={(v) => setDefaultStatus(v as ShipmentStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => inputRef.current?.click()} className="h-20" disabled={busy}>
          <UploadIcon className="h-5 w-5 mr-2" /> {t("upload.choosePhotos")}
        </Button>
        <Button variant="outline" onClick={() => camRef.current?.click()} className="h-20" disabled={busy}>
          <Camera className="h-5 w-5 mr-2" /> {t("upload.takePhoto")}
        </Button>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {busy && (() => {
        const done = items.filter((i) => i.state === "created" || i.state === "added" || i.state === "failed").length;
        const total = items.length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("batch.processing", { done, total })}
            </div>
            <div className="h-1.5 rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs text-muted-foreground">{t("batch.keepScreenOnHint")}</div>
          </div>
        );
      })()}

      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">
              {t("batch.summary", { ok: okCount, total: items.length })}
              {failCount > 0 && <span className="ml-2 text-destructive">({failCount} ✗)</span>}
            </div>
            <Button size="sm" variant="ghost" onClick={clearAll} disabled={busy}>
              {t("batch.clear")}
            </Button>
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 p-2">
                <img
                  src={it.url}
                  onClick={() => setPreviewId(it.id)}
                  className="h-14 w-14 object-cover rounded border shrink-0 cursor-zoom-in"
                  title={t("upload.clickToPreview")}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <ItemStateIcon state={it.state} />
                    {it.qrTotal && it.qrTotal > 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 shrink-0">
                        QR {it.qrIndex}/{it.qrTotal}
                      </span>
                    )}
                    <span className="font-mono text-xs truncate">
                      {it.barcode || (it.state === "failed" ? t("batch.failed") : "...")}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-0.5">
                    {it.state === "preparing" && <span>{t("batch.preparing")}</span>}
                    {it.state === "scanning" && <span>{t("batch.scanning")}</span>}
                    {it.state === "uploading" && <span>{t("batch.uploading")}</span>}
                    {it.productCode && <span>{it.productCode}</span>}
                    {it.model && <span>· {it.model}</span>}
                    {typeof it.confidence === "number" && (
                      <span className={it.confidence < 0.8 ? "text-orange-600" : "text-emerald-600"}>
                        · {t("scan.confidence")}: {Math.round(it.confidence * 100)}%
                        {it.method && ` (${it.method})`}
                      </span>
                    )}
                    {typeof it.confidence === "number" && it.confidence < 0.8 && (
                      <span className="text-orange-600">⚠ {t("scan.lowConfidence")}</span>
                    )}
                    {(it.format === "FALLBACK_FIRST_LINE" || it.format === "OCR") && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-500/30">
                        {t("scan.fallbackBadge")}
                      </span>
                    )}
                    {it.state === "created" && <span className="text-green-600">{t("batch.created")}</span>}
                    {it.state === "added" && (
                      <span className="text-blue-600 flex items-center gap-1">
                        {t("batch.addedToExisting")}
                        {it.existingStatus && <StatusBadge status={it.existingStatus} />}
                      </span>
                    )}
                    {it.state === "failed" && <span className="text-destructive">{it.error}</span>}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={it.state === "preparing" || it.state === "scanning" || it.state === "uploading"}
                  onClick={() => rescanItem(it)}
                  title={t("unrecog.rescan")}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                {it.recordId && (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/records/$id" params={{ id: it.recordId }}>{t("batch.open")}</Link>
                  </Button>
                )}

              </li>
            ))}
          </ul>
          <Button variant="outline" className="w-full" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Plus className="h-4 w-4 mr-2" /> {t("batch.retake")}
          </Button>
        </div>
      )}

      {previewId && (() => {
        const p = items.find((x) => x.id === previewId);
        if (!p) return null;
        return (
          <ImageLightbox
            src={p.url}
            onClose={() => setPreviewId(null)}
            onRegionScan={async (rect) => {
              await rescanItem(p, rect);
              setPreviewId(null);
            }}
          />
        );
      })()}
    </div>
  );
}


function ItemStateIcon({ state }: { state: ItemState }) {
  if (state === "created" || state === "added")
    return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (state === "failed") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (state === "preparing")
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/50 shrink-0" />;
  return <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />;
}
