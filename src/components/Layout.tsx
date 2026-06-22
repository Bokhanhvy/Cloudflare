import { Link, useNavigate, useRouterState, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Package, Upload, ListOrdered, History, LogOut, Globe, AlertTriangle, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import i18n from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";

export function AppLayout() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();

  const signOut = async () => {
    await supabase.auth.signOut();
    nav({ to: "/auth" });
  };

  const toggleLang = () => {
    const next = i18n.language === "vi" ? "en" : "vi";
    i18n.changeLanguage(next);
    localStorage.setItem("lang", next);
  };

  const items = [
    { to: "/upload", label: t("nav.upload"), Icon: Upload },
    { to: "/records", label: t("nav.records"), Icon: ListOrdered },
    { to: "/unrecognized", label: t("nav.unrecognized"), Icon: AlertTriangle },
    { to: "/history", label: t("nav.history"), Icon: History },
    { to: "/trash", label: t("nav.trash"), Icon: Trash2 },
    { to: "/settings", label: t("nav.settings"), Icon: SettingsIcon },
  ] as const;


  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-2 sm:px-4 h-14 flex items-center gap-1 sm:gap-2">
          <Link to="/records" className="flex items-center gap-2 font-semibold shrink-0">
            <Package className="h-5 w-5 text-primary" />
            <span className="hidden md:inline truncate">{t("app")}</span>
          </Link>
          <nav className="flex items-center gap-0.5 sm:gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
            {items.map(({ to, label, Icon }) => {
              const active = pathname === to || pathname.startsWith(to + "/");
              return (
                <Link
                  key={to}
                  to={to}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 sm:px-2.5 py-1.5 text-sm font-medium transition ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60"}`}
                  title={label}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={toggleLang} title={t("common.language")} className="px-2">
              <Globe className="h-4 w-4" />
              <span className="ml-1 text-xs uppercase">{i18n.language}</span>
            </Button>
            {user && (
              <Button variant="ghost" size="sm" onClick={signOut} title={t("nav.signOut")} className="px-2">
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-3 sm:px-4 py-4 sm:py-6">
        <Outlet />
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
