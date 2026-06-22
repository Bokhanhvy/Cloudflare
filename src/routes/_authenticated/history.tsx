import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "History — Shipment Tracking" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("status_history")
      .select("*,profiles:user_id(display_name,email),record:record_id(barcode)")
      .order("created_at", { ascending: false })
      .limit(300);
    setItems(data || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("history-all")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "status_history" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("history.title")}</h1>
      <div className="rounded-lg border bg-card divide-y">
        {items.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">{t("history.empty")}</div>
        )}
        {items.map((h) => (
          <div key={h.id} className="p-3 text-xs flex flex-wrap gap-2 items-center">
            <span className="text-muted-foreground w-32">
              {format(new Date(h.created_at), "yyyy-MM-dd HH:mm")}
            </span>
            <span className="font-medium">{h.profiles?.display_name || h.profiles?.email || "?"}</span>
            {h.record?.barcode && (
              <Link to="/records/$id" params={{ id: h.record_id }} className="font-mono text-primary hover:underline">
                {h.record.barcode}
              </Link>
            )}
            <span className="text-primary">{h.action}</span>
            {h.field && <span className="text-muted-foreground">{h.field}:</span>}
            {h.old_value && <span className="line-through text-muted-foreground">{h.old_value}</span>}
            {h.new_value && <span>→ {h.new_value}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
