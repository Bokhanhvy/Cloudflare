import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Copy, ExternalLink, FileSpreadsheet, AlertTriangle, ChevronDown, ChevronRight, Trash2, X, Pencil, Save, ArrowDownWideNarrow, ArrowUpWideNarrow, Pin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { deletePhoto } from "@/lib/photos";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";
import { PhotoThumb } from "@/components/PhotoThumb";
import { copy } from "@/lib/clipboard";
import { format } from "date-fns";
import type { ShipmentStatus } from "@/lib/status";
import { STATUSES, statusWarningKey } from "@/lib/status";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { ImageLightbox } from "@/components/ImageLightbox";
import { signedUrl } from "@/lib/photos";
import { isPinnedRecord, withPinnedFirst } from "@/lib/recordSort";


export const Route = createFileRoute("/_authenticated/records")({
  head: () => ({ meta: [{ title: "Records — Shipment Tracking" }] }),
  component: RecordsLayout,
});

interface Rec {
  id: string;
  barcode: string;
  product_code: string | null;
  model: string | null;
  status: ShipmentStatus;
  status_changed_at: string | null;
  notes: string | null;
  created_at: string;
  created_by: string;
  profiles?: { display_name: string | null; email: string | null } | null;
  images?: { id: string; storage_path: string; deleted_at: string | null }[];
}

function RecordsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // If a child route (e.g. /records/$id) matched, render it; otherwise render the list.
  if (pathname !== "/records") return <Outlet />;
  return <RecordsListPage />;
}

function RecordsListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ShipmentStatus>("all");
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");
  const [records, setRecords] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // How many rows are currently rendered for each expanded product-code
  // group. Groups can have hundreds of barcodes (e.g. a box with 150+ items)
  // — rendering all of them at once bloats the DOM and slows scrolling, so
  // each group starts with a capped number of rows and grows via "Show more".
  const [groupVisibleCount, setGroupVisibleCount] = useState<Map<string, number>>(new Map());
  const GROUP_PAGE_SIZE = 30;
  const [editingPc, setEditingPc] = useState<string | null>(null);
  const [pcDraft, setPcDraft] = useState("");
  const [historyMap, setHistoryMap] = useState<Map<string, Array<{ status: ShipmentStatus; at: string }>>>(new Map());
  // Record ids that were ever `ready_to_ship` — used only for the
  // "Shipback in Sorting" banner, computed via a small dedicated query
  // instead of from the (lazily-loaded) full per-record historyMap.
  const [shipbackIds, setShipbackIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportIncludeImages, setExportIncludeImages] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Ids whose full status timeline has already been fetched (or is being
  // fetched), so re-expanding a group / revisiting a page doesn't re-query.
  const historyLoadedIds = useRef<Set<string>>(new Set()).current;

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("shipment_records")
      .select(
        "id,barcode,product_code,model,status,status_changed_at,notes,created_at,created_by,profiles:created_by(display_name,email),images:shipment_images(id,storage_path,deleted_at)"
      )
      .eq("is_unrecognized", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    const recs = (data as any[]) || [];
    setRecords(recs as any);
    setLoading(false);

    // The "Shipback in Sorting" banner only needs to know which records are
    // currently moved_to_sorting AND were ready_to_ship at some point before
    // that — it doesn't need every record's full timeline. Query just the
    // status_history rows that matter for that check, scoped to records
    // currently in that status, instead of pulling history for all 1000
    // records up front.
    const sortingIds = recs.filter((r) => r.status === "moved_to_sorting").map((r) => r.id);
    if (sortingIds.length) {
      const { data: shipbackHist } = await supabase
        .from("status_history")
        .select("record_id")
        .in("record_id", sortingIds)
        .eq("action", "status_changed")
        .eq("new_value", "ready_to_ship");
      const ids = new Set<string>((shipbackHist || []).map((h: any) => h.record_id));
      setShipbackIds(ids);
    } else {
      setShipbackIds(new Set());
    }

    // Re-fetch timelines for any group/page that's already expanded/visible,
    // since a realtime update may have changed their history — but don't
    // blow away the whole cache (that would force a re-fetch storm on every
    // realtime tick while someone is actively viewing a group).
    const stillLoaded = Array.from(historyLoadedIds);
    historyLoadedIds.clear();
    if (stillLoaded.length) loadHistoryFor(stillLoaded);
  };

  // Lazily fetch the full status timeline for a specific set of records —
  // called when a product-code group is expanded, or when the flat view's
  // current page changes — instead of upfront for every record in the list.
  const loadHistoryFor = async (ids: string[]) => {
    const missing = ids.filter((id) => !historyLoadedIds.has(id));
    if (!missing.length) return;
    missing.forEach((id) => historyLoadedIds.add(id));
    const { data: hist } = await supabase
      .from("status_history")
      .select("record_id,old_value,new_value,created_at")
      .in("record_id", missing)
      .eq("action", "status_changed")
      .order("created_at", { ascending: true });
    const byRec = new Map<string, any[]>();
    for (const h of hist || []) {
      const arr = byRec.get(h.record_id) || [];
      arr.push(h);
      byRec.set(h.record_id, arr);
    }
    setHistoryMap((prev) => {
      const n = new Map(prev);
      for (const id of missing) {
        const r = records.find((rr) => rr.id === id);
        const events = byRec.get(id) || [];
        const initial = (events[0]?.old_value as ShipmentStatus) || r?.status || "in_warehouse";
        const tl: Array<{ status: ShipmentStatus; at: string }> = [
          { status: initial, at: r?.created_at || new Date().toISOString() },
        ];
        for (const h of events) {
          if (h.new_value) tl.push({ status: h.new_value as ShipmentStatus, at: h.created_at });
        }
        const out: typeof tl = [];
        for (const e of tl) {
          if (!out.length || out[out.length - 1].status !== e.status) out.push(e);
        }
        n.set(id, out);
      }
      return n;
    });
  };


  useEffect(() => {
    load();
    const ch = supabase
      .channel("records-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_records" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_images" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = records.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!s) return true;
      return (
        r.barcode.toLowerCase().includes(s) ||
        (r.product_code || "").toLowerCase().includes(s) ||
        (r.model || "").toLowerCase().includes(s)
      );
    });
    const sorted = [...list].sort((a, b) => {
      if (sortOrder === "name") {
        const pa = (a.product_code || a.barcode || "").toLowerCase();
        const pb = (b.product_code || b.barcode || "").toLowerCase();
        return pa.localeCompare(pb);
      }
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
    return sorted;
  }, [records, q, statusFilter, sortOrder]);

  // Duplicates map
  const dupCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) m.set(r.barcode, (m.get(r.barcode) || 0) + 1);
    return m;
  }, [records]);

  // Shipback items currently in sorting area
  const shipbackInSortingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of records) {
      if (r.status !== "moved_to_sorting") continue;
      if (shipbackIds.has(r.id)) ids.add(r.id);
    }
    return ids;
  }, [records, shipbackIds]);

  // Group by product_code for grouped view. Within each group, records whose
  // barcode follows the "<MaSanPham>__TEN" convention (e.g. product photos,
  // box photos, rework notes — created from the Unrecognized screen) are
  // always pinned to the top, regardless of the active sort order. The
  // relative order of every other record in the group is left untouched.
  // The groups themselves are also ordered by the active `sortOrder`
  // (newest/oldest/name) so changing the sort applies to the whole list,
  // not just to the records inside a single product code.
  const groups = useMemo(() => {
    const m = new Map<string, Rec[]>();
    for (const r of filtered) {
      const k = r.product_code || "__none__";
      const arr = m.get(k) || [];
      arr.push(r);
      m.set(k, arr);
    }
    // `filtered` is already ordered by sortOrder, so the first record pushed
    // into each bucket reflects that overall order — use it as the group's
    // sort anchor for "newest"/"oldest" (computed before the pin reorder,
    // so a pinned sample record doesn't skew a group's recency).
    const entries = Array.from(m.entries()).map(([pc, items]) => ({
      pc,
      anchor: items[0] as Rec | undefined,
      items: withPinnedFirst(items),
    }));
    if (sortOrder === "name") {
      entries.sort((a, b) => a.pc.localeCompare(b.pc));
    } else {
      entries.sort((a, b) => {
        const ta = new Date(a.anchor?.created_at ?? 0).getTime();
        const tb = new Date(b.anchor?.created_at ?? 0).getTime();
        return sortOrder === "newest" ? tb - ta : ta - tb;
      });
    }
    return entries.map((e) => [e.pc, e.items] as [string, Rec[]]);
  }, [filtered, sortOrder]);

  // Reset pagination when filters change
  useEffect(() => { setPage(1); }, [q, statusFilter, viewMode, sortOrder]);

  const flatPaged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // In flat view, only the current page's rows are visible — fetch their
  // timelines on demand instead of the whole filtered set.
  useEffect(() => {
    if (viewMode === "flat" && flatPaged.length) {
      loadHistoryFor(flatPaged.map((r) => r.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, flatPaged]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  // Select-all scoped to current page (flat view only) — kept for quick
  // selection of just what's on screen.
  const allVisibleIds = viewMode === "flat" ? flatPaged.map((r) => r.id) : [];
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelected) allVisibleIds.forEach((id) => n.delete(id));
      else allVisibleIds.forEach((id) => n.add(id));
      return n;
    });
  };
  // Select-all across the entire (filtered) record set — every record on
  // every page / in every product-code group, not just what's visible.
  const allFilteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const toggleSelectAllFiltered = () => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allFilteredSelected) allFilteredIds.forEach((id) => n.delete(id));
      else allFilteredIds.forEach((id) => n.add(id));
      return n;
    });
  };
  const toggleSelectGroup = (groupIds: string[]) => {
    setSelected((prev) => {
      const n = new Set(prev);
      const allOn = groupIds.every((id) => n.has(id));
      if (allOn) groupIds.forEach((id) => n.delete(id));
      else groupIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const openLightbox = async (path: string) => {
    const u = await signedUrl(path);
    setLightbox(u);
  };


  const bulkStatus = async (newStatus: ShipmentStatus) => {
    if (!selected.size || !user) return;
    const ids = Array.from(selected);
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("shipment_records")
      .update({ status: newStatus, status_changed_at: nowIso } as any)
      .in("id", ids);
    if (error) return toast.error(error.message);
    await supabase.from("status_history").insert(
      ids.map((rid) => ({
        record_id: rid, user_id: user.id, action: "status_changed",
        field: "status", new_value: newStatus,
      }))
    );
    toast.success(t("bulk.updated", { n: ids.length }));
    setSelected(new Set());
    load();
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(t("bulk.deleteConfirm", { n: selected.size }))) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("shipment_records")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null } as any)
      .in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(t("bulk.deleted", { n: ids.length }));
    setSelected(new Set());
    load();
  };

  const appendTimeline = (id: string, newStatus: ShipmentStatus, at: string) => {
    setHistoryMap((prev) => {
      const n = new Map(prev);
      const arr = [...(n.get(id) || [])];
      if (!arr.length || arr[arr.length - 1].status !== newStatus) {
        arr.push({ status: newStatus, at });
      }
      n.set(id, arr);
      return n;
    });
  };

  const inlineStatusChange = async (id: string, newStatus: ShipmentStatus) => {
    if (!user) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("shipment_records")
      .update({ status: newStatus, status_changed_at: nowIso } as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    await supabase.from("status_history").insert({
      record_id: id, user_id: user.id, action: "status_changed",
      field: "status", new_value: newStatus,
    });
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus, status_changed_at: nowIso } : r)));
    appendTimeline(id, newStatus, nowIso);
    // Notify when a shipback item lands in the sorting area. The row's own
    // timeline is already loaded (the row is visible/being interacted with),
    // but fall back to the lightweight shipbackIds set just in case.
    const tl = historyMap.get(id) || [];
    const wasShipback = tl.some((e) => e.status === "ready_to_ship") || shipbackIds.has(id);
    if (newStatus === "moved_to_sorting" && wasShipback) {
      toast.warning(t("warnings.shipbackInSorting"));
    }
  };

  const inlineNotesSave = async (id: string, oldNotes: string | null, newNotes: string) => {
    if (!user) return;
    const trimmed = newNotes.trim();
    if ((oldNotes || "") === trimmed) return;
    const { error } = await supabase
      .from("shipment_records")
      .update({ notes: trimmed || null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    await supabase.from("status_history").insert({
      record_id: id, user_id: user.id, action: "field_updated",
      field: "notes", old_value: oldNotes || "", new_value: trimmed,
    });
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, notes: trimmed || null } : r)));
    toast.success(t("records.notesSaved"));
  };

  const removePhotoFromList = async (img: { id: string; storage_path: string }, recordId: string) => {
    if (!user) return;
    if (!confirm(t("trash.confirmMoveOne"))) return;
    try {
      await deletePhoto(img.id, img.storage_path, recordId, user.id);
    } catch (e: any) {
      return toast.error(e?.message || String(e));
    }
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? { ...r, images: (r.images || []).map((im) => (im.id === img.id ? { ...im, deleted_at: new Date().toISOString() } : im)) }
          : r
      )
    );
    toast.success(t("trash.movedToTrash"));
  };

  const renameProductCode = async (oldPc: string, items: Rec[], nextValue: string) => {
    if (!user) return;
    const initial = oldPc === "__none__" ? "" : oldPc;
    const next = nextValue.trim();
    if (next === initial) { setEditingPc(null); return; }
    const newPc = next === "" ? null : next;
    const ids = items.map((r) => r.id);
    const { error } = await supabase
      .from("shipment_records")
      .update({ product_code: newPc })
      .in("id", ids);
    if (error) return toast.error(error.message);
    await supabase.from("status_history").insert(
      ids.map((rid) => ({
        record_id: rid, user_id: user.id, action: "field_updated",
        field: "product_code", old_value: initial, new_value: newPc || "",
      }))
    );
    setRecords((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, product_code: newPc } : r))
    );
    setEditingPc(null);
    toast.success(t("group.renamed", { n: ids.length }));
  };

  const runExport = async (withImages: boolean) => {
    const source = selected.size > 0 ? filtered.filter((r) => selected.has(r.id)) : filtered;
    if (!source.length) {
      toast.error(t("records.exportNothing"));
      return;
    }
    setExporting(true);
    try {
      // Build a filename from product codes present in the selection (or "all")
      const codes = Array.from(
        new Set(source.map((r) => (r.product_code || "no-code").replace(/[^\w.-]+/g, "_")))
      ).sort();
      const codeTag = codes.length === 0
        ? "all"
        : codes.length <= 3
        ? codes.join("+")
        : `${codes.slice(0, 3).join("+")}+${codes.length - 3}more`;
      const stamp = format(new Date(), "yyyyMMdd-HHmm");
      const filename = `shipments-${codeTag}-${stamp}.xlsx`;

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Records");
      ws.columns = [
        { header: "Barcode", key: "barcode", width: 24 },
        { header: "Product Code", key: "product_code", width: 18 },
        { header: "Model", key: "model", width: 18 },
        { header: "Status", key: "status", width: 18 },
        { header: "Notes", key: "notes", width: 28 },
        { header: "Created By", key: "created_by", width: 20 },
        { header: "Created At", key: "created_at", width: 18 },
        ...(withImages ? [{ header: "Images", key: "images", width: 22 }] : []),
      ] as any;
      ws.getRow(1).font = { bold: true };

      for (const r of source) {
        const rowIndex = ws.rowCount + 1;
        ws.addRow({
          barcode: r.barcode,
          product_code: r.product_code || "",
          model: r.model || "",
          status: t(`status.${r.status}`),
          notes: r.notes || "",
          created_by: r.profiles?.display_name || r.profiles?.email || "",
          created_at: format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
        });
        if (withImages) {
          const imgs = (r.images || []).filter((im) => !im.deleted_at).slice(0, 4);
          if (imgs.length) {
            ws.getRow(rowIndex).height = 90;
            for (let i = 0; i < imgs.length; i++) {
              const im = imgs[i];
              try {
                const url = await signedUrl(im.storage_path);
                if (!url) continue;
                const resp = await fetch(url);
                const buf = await resp.arrayBuffer();
                const ext = im.storage_path.toLowerCase().endsWith(".png") ? "png" : "jpeg";
                const imageId = wb.addImage({ buffer: buf as any, extension: ext as any });
                // Place each image in its own cell offset (columns 8..11 with width 12 each)
                const colStart = 7 + i; // 0-indexed: column H is 7
                ws.addImage(imageId, {
                  tl: { col: colStart + 0.05, row: rowIndex - 1 + 0.05 } as any,
                  ext: { width: 110, height: 110 },
                  editAs: "oneCell",
                } as any);
              } catch {}
            }
            // ensure column widths exist
            for (let i = 0; i < imgs.length; i++) {
              const col = ws.getColumn(8 + i);
              if (!col.width || col.width < 18) col.width = 18;
            }
          }
        }
      }

      const out = await wb.xlsx.writeBuffer();
      const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      toast.success(t("records.exported", { n: source.length, defaultValue: `Đã xuất ${source.length} hồ sơ` }));
      setExportOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <h1 className="text-xl font-semibold flex-1">{t("records.title")}</h1>
        <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as "newest" | "oldest" | "name")}>
          <SelectTrigger className="w-auto h-9 text-sm" title={t("records.sortLabel")}>
            {sortOrder === "oldest" ? (
              <ArrowUpWideNarrow className="h-4 w-4 mr-1.5" />
            ) : (
              <ArrowDownWideNarrow className="h-4 w-4 mr-1.5" />
            )}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("records.sortNewest")}</SelectItem>
            <SelectItem value="oldest">{t("records.sortOldest")}</SelectItem>
            <SelectItem value="name">{t("records.sortName")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setViewMode(viewMode === "grouped" ? "flat" : "grouped")}
        >
          {viewMode === "grouped" ? t("group.flat") : t("group.productCodes")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} disabled={!filtered.length}>
          <FileSpreadsheet className="h-4 w-4 mr-1.5" /> {selected.size > 0 ? `${t("records.export")} (${selected.size})` : t("records.export")}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("records.search")}
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.allStatuses")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {shipbackInSortingIds.size > 0 && (
        <div className="rounded border border-orange-300 bg-orange-50 text-orange-800 px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("warnings.shipbackInSortingCount", { n: shipbackInSortingIds.size })}
        </div>
      )}

      {/* Bulk toolbar */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAllFiltered} />
            {t("bulk.selectAll", { n: filtered.length })}
          </label>
          {viewMode === "flat" && (
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
              {t("bulk.selectAllPage")}
            </label>
          )}
          {viewMode === "grouped" && (
            <span className="text-xs text-muted-foreground">{t("bulk.groupSelectHint")}</span>
          )}
          {selected.size > 0 && (
            <span className="text-sm text-muted-foreground">{t("bulk.selected", { n: selected.size })}</span>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <Select onValueChange={(v) => bulkStatus(v as ShipmentStatus)}>
              <SelectTrigger className="h-8 w-48"><SelectValue placeholder={t("bulk.changeStatus")} /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("bulk.clear")}
            </Button>
            <Button size="sm" variant="destructive" onClick={bulkDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("bulk.delete")}
            </Button>
          </div>
        )}
      </div>


      {loading ? (
        <div className="text-sm text-muted-foreground">…</div>
      ) : !filtered.length ? (
        <div className="text-sm text-muted-foreground py-8 text-center">{t("records.empty")}</div>
      ) : viewMode === "grouped" ? (
        <div className="space-y-2">
          {groups.map(([pc, items]) => {
            const isOpen = expanded.has(pc);
            const counts: Record<string, number> = {};
            for (const r of items) counts[r.status] = (counts[r.status] || 0) + 1;
            const groupIds = items.map((r) => r.id);
            const groupAllSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
            const visibleCount = groupVisibleCount.get(pc) ?? GROUP_PAGE_SIZE;
            const visibleItems = items.slice(0, visibleCount);
            const hasMore = items.length > visibleCount;
            return (
              <div key={pc} className="rounded-lg border bg-card">
                <div
                  className="w-full flex items-center gap-2 p-3 hover:bg-accent/40 cursor-pointer select-none"
                  onClick={() => {
                    if (editingPc === pc) return;
                    setExpanded((prev) => {
                      const n = new Set(prev);
                      if (n.has(pc)) {
                        n.delete(pc);
                      } else {
                        n.add(pc);
                        loadHistoryFor(items.slice(0, GROUP_PAGE_SIZE).map((r) => r.id));
                      }
                      return n;
                    });
                  }}
                >
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={groupAllSelected}
                      onCheckedChange={() => toggleSelectGroup(groupIds)}
                      title={t("bulk.selectAllInGroup")}
                    />
                  </span>
                  <span className="shrink-0 inline-flex items-center" aria-hidden>
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                  {editingPc === pc ? (
                    <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Input
                        autoFocus
                        value={pcDraft}
                        onChange={(e) => setPcDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); renameProductCode(pc, items, pcDraft); }
                          if (e.key === "Escape") { e.preventDefault(); setEditingPc(null); }
                        }}
                        className="h-8 w-48 font-mono font-semibold"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => renameProductCode(pc, items, pcDraft)}
                        title={t("group.renameSave")}
                      >
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setEditingPc(null)}
                        title={t("group.renameCancel")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  ) : (
                    <>
                      <span className="font-mono font-semibold">
                        {pc === "__none__" ? t("group.noProductCode") : pc}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPcDraft(pc === "__none__" ? "" : pc);
                          setEditingPc(pc);
                        }}
                        title={t("group.renameTitle")}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                  <span className="text-xs text-muted-foreground ml-2">
                    {t("group.totalBarcodes", { n: items.length })}
                  </span>
                  <div className="ml-auto flex gap-1 flex-wrap">
                    {STATUSES.filter((s) => counts[s]).map((s) => (
                      <span key={s} className="text-xs">
                        <StatusBadge status={s} /> <span className="text-muted-foreground">×{counts[s]}</span>
                      </span>
                    ))}
                  </div>
                </div>
                {isOpen && (
                  <ul className="divide-y border-t">
                    {visibleItems.map((r) => (
                      <RowItem
                        key={r.id}
                        r={r}
                        timeline={historyMap.get(r.id) || []}
                        shipbackAlert={shipbackInSortingIds.has(r.id)}
                        dup={(dupCount.get(r.barcode) || 0) > 1}
                        checked={selected.has(r.id)}
                        onToggle={() => toggleSelect(r.id)}
                        onStatusChange={(s) => inlineStatusChange(r.id, s)}
                        onImageClick={openLightbox}
                        onPhotoDelete={(img) => removePhotoFromList(img, r.id)}
                        onNotesSave={(notes) => inlineNotesSave(r.id, r.notes, notes)}
                        t={t}
                      />
                    ))}
                  </ul>
                )}
                {isOpen && hasMore && (
                  <div className="border-t p-2 flex justify-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const next = Math.min(items.length, visibleCount + GROUP_PAGE_SIZE);
                        setGroupVisibleCount((prev) => {
                          const n = new Map(prev);
                          n.set(pc, next);
                          return n;
                        });
                        loadHistoryFor(items.slice(visibleCount, next).map((r) => r.id));
                      }}
                    >
                      {t("group.showMore", { n: items.length - visibleCount })}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {flatPaged.map((r) => (
              <RowItem
                key={r.id}
                r={r}
                timeline={historyMap.get(r.id) || []}
                shipbackAlert={shipbackInSortingIds.has(r.id)}
                dup={(dupCount.get(r.barcode) || 0) > 1}
                checked={selected.has(r.id)}
                onToggle={() => toggleSelect(r.id)}
                onStatusChange={(s) => inlineStatusChange(r.id, s)}
                onImageClick={openLightbox}
                onPhotoDelete={(img) => removePhotoFromList(img, r.id)}
                onNotesSave={(notes) => inlineNotesSave(r.id, r.notes, notes)}
                t={t}
              />
            ))}
          </ul>

          <div className="flex items-center justify-center gap-3 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t("page.prev")}
            </Button>
            <span className="text-muted-foreground">
              {page} {t("page.of")} {totalPages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t("page.next")}
            </Button>
          </div>
        </>
      )}

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}

      <Dialog open={exportOpen} onOpenChange={(o) => !exporting && setExportOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("records.exportTitle")}</DialogTitle>
            <DialogDescription>{t("records.exportFilenameHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={exportIncludeImages}
                onCheckedChange={(v) => setExportIncludeImages(!!v)}
                disabled={exporting}
              />
              <span>
                <span className="font-medium">{t("records.exportIncludeImages")}</span>
                <span className="block text-xs text-muted-foreground">{t("records.exportImagesHint")}</span>
              </span>
            </label>
            <div className="text-xs text-muted-foreground">
              {selected.size > 0
                ? t("bulk.selected", { n: selected.size })
                : `${filtered.length} ${t("records.title").toLowerCase()}`}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportOpen(false)} disabled={exporting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => runExport(exportIncludeImages)} disabled={exporting}>
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              {exporting ? t("settings.running") : t("records.exportConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function RowItem({
  r, timeline, shipbackAlert, dup, checked, onToggle, onStatusChange, onImageClick, onPhotoDelete, onNotesSave, t,
}: {
  r: Rec;
  timeline: Array<{ status: ShipmentStatus; at: string }>;
  shipbackAlert: boolean;
  dup: boolean;
  checked: boolean;
  onToggle: () => void;
  onStatusChange: (s: ShipmentStatus) => void;
  onImageClick: (path: string) => void;
  onPhotoDelete: (img: { id: string; storage_path: string }) => void;
  onNotesSave: (notes: string) => void;
  t: (k: string, o?: any) => string;
}) {
  const wk = statusWarningKey(r.status);
  const imgs = (r.images || []).filter((im) => !im.deleted_at);
  const pinned = isPinnedRecord(r.barcode, r.product_code);
  const [notesDraft, setNotesDraft] = useState(r.notes || "");
  useEffect(() => { setNotesDraft(r.notes || ""); }, [r.notes]);
  const statusTime = r.status_changed_at
    ? format(new Date(r.status_changed_at), "HH:mm:ss")
    : null;
  const statusDate = r.status_changed_at
    ? format(new Date(r.status_changed_at), "yyyy-MM-dd")
    : null;
  return (
    <li className={`p-3 flex gap-3 ${dup ? "bg-red-50/60" : ""} ${pinned ? "bg-amber-50/50" : ""}`}>
      <div className="pt-1">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start gap-2 flex-wrap">
          {pinned && (
            <span
              className="text-amber-600 inline-flex items-center shrink-0"
              title={t("group.pinnedRecord")}
            >
              <Pin className="h-3.5 w-3.5 fill-amber-500" />
            </span>
          )}
          <code className={`font-mono text-sm break-all ${dup ? "text-red-600 font-semibold" : ""}`}>
            {r.barcode}
          </code>
          {dup && (
            <span className="text-xs text-red-600 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Duplicate
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
          {r.product_code && <span><code>{r.product_code}</code></span>}
          {r.model && <span>· <code>{r.model}</code></span>}
          <span>· {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}</span>
          <span>· {imgs.length} {t("fields.photos").toLowerCase()}</span>
        </div>
        {timeline.length > 0 && (
          <div className="flex flex-wrap gap-1.5 py-1">
            {timeline.map((e, i) => {
              const tip = format(new Date(e.at), "yyyy-MM-dd HH:mm:ss");
              return (
                <div key={i} className="flex flex-col items-center" title={tip}>
                  <StatusBadge status={e.status} />
                  <span className="text-[10px] text-muted-foreground font-mono leading-tight mt-0.5 text-center">
                    <span className="block">{format(new Date(e.at), "yyyy-MM-dd")}</span>
                    <span className="block">{format(new Date(e.at), "HH:mm:ss")}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {shipbackAlert && (
          <div className="text-xs text-orange-700 bg-orange-50 border border-orange-300 rounded px-2 py-1 inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {t("warnings.shipbackInSorting")}
          </div>
        )}
        {wk && !shipbackAlert && <div className="text-xs text-orange-600">{t(wk)}</div>}
        {imgs.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto py-1">
            {imgs.slice(0, 8).map((im) => (
              <div key={im.id} className="relative group shrink-0">
                <PhotoThumb
                  path={im.storage_path}
                  className="h-14 w-14 rounded border object-cover"
                  onClick={() => onImageClick(im.storage_path)}
                />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onPhotoDelete(im); }}
                  className="absolute -top-1 -right-1 rounded-full bg-black/70 text-white p-0.5 opacity-0 group-hover:opacity-100 transition"
                  title={t("detail.deletePhoto")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {imgs.length > 8 && (
              <span className="text-xs text-muted-foreground self-center">+{imgs.length - 8}</span>
            )}
          </div>
        )}
        <Textarea
          rows={1}
          placeholder={t("fields.notes")}
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => onNotesSave(notesDraft)}
          className="text-xs min-h-[32px] resize-y"
        />
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Select value={r.status} onValueChange={(v) => onStatusChange(v as ShipmentStatus)}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {statusTime && (
          <div className="text-[10px] text-muted-foreground text-right leading-tight">
            <div>{statusDate}</div>
            <div className="font-mono">{statusTime}</div>
          </div>
        )}
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => copy(r.barcode, t("fields.barcode"))} title={t("records.copy")}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/records/$id" params={{ id: r.id }}>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>
    </li>
  );
}

