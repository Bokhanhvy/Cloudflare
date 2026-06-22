import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign In — Shipment Tracking" }] }),
  component: AuthPage,
});

const ADMIN_EMAIL = "oqcsample@admin.local";
const ADMIN_SECRET = "121988";

function normalizeLogin(input: string): string {
  const v = input.trim();
  if (!v) return v;
  if (v.toLowerCase() === "oqcsample") return ADMIN_EMAIL;
  if (v.includes("@")) return v;
  return `${v.toLowerCase()}@user.local`;
}

async function tryClaimAdmin() {
  try {
    await (supabase as any).rpc("claim_admin_role", { _secret: ADMIN_SECRET });
  } catch {
    // ignore
  }
}

function AuthPage() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Quick register dialog
  const [quickOpen, setQuickOpen] = useState(false);
  const [qUser, setQUser] = useState("");
  const [qPass, setQPass] = useState("");
  const [qBusy, setQBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) nav({ to: "/records" });
  }, [loading, session, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const finalEmail = normalizeLogin(email);
      if (mode === "up") {
        if (password.length < 6) throw new Error(t("auth.passwordTooShort") as string);
        const { data: upData, error } = await supabase.auth.signUp({
          email: finalEmail,
          password,
          options: {
            data: { display_name: name || finalEmail.split("@")[0] },
          },
        });
        if (error) throw error;
        if (!upData.session) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({ email: finalEmail, password });
          if (signInErr) throw signInErr;
        }
        if (finalEmail === ADMIN_EMAIL && password === ADMIN_SECRET) await tryClaimAdmin();
        toast.success("Account created — welcome!");
      } else {
        // Admin self-provision: if username = oqcsample + pwd 121988 and account missing, create it
        if (finalEmail === ADMIN_EMAIL && password === ADMIN_SECRET) {
          const { error: signErr } = await supabase.auth.signInWithPassword({ email: finalEmail, password });
          if (signErr) {
            const { error: upErr } = await supabase.auth.signUp({
              email: finalEmail,
              password,
              options: { data: { display_name: "Admin" } },
            });
            if (upErr) throw upErr;
            const { error: si2 } = await supabase.auth.signInWithPassword({ email: finalEmail, password });
            if (si2) throw si2;
          }
          await tryClaimAdmin();
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email: finalEmail, password });
          if (error) throw error;
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Auth error");
    } finally {
      setBusy(false);
    }
  };

  const quickRegister = async () => {
    const u = qUser.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(u)) {
      toast.error(t("auth.usernameInvalid") as string);
      return;
    }
    if (qPass.length < 6) {
      toast.error(t("auth.passwordTooShort") as string);
      return;
    }
    setQBusy(true);
    try {
      const quickEmail = `${u}@user.local`;
      const { error } = await supabase.auth.signUp({
        email: quickEmail,
        password: qPass,
        options: { data: { display_name: u } },
      });
      if (error) throw error;
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: quickEmail,
        password: qPass,
      });
      if (signErr) throw signErr;
      toast.success(t("auth.quickCreated", { email: quickEmail }));
      setQuickOpen(false);
      setQUser("");
      setQPass("");
    } catch (err: any) {
      toast.error(err.message || "Quick register failed");
    } finally {
      setQBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Toaster richColors position="top-right" />
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm space-y-4"
      >
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-semibold">{t("app")}</h1>
        </div>
        <h2 className="text-sm text-muted-foreground">
          {mode === "in" ? t("auth.title") : t("auth.signUpTitle")}
        </h2>
        {mode === "up" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("auth.displayName")}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {mode === "in" ? t("auth.signIn") : t("auth.signUp")}
        </Button>
        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={busy}
          onClick={() => setQuickOpen(true)}
          title={t("auth.quickHint") as string}
        >
          ⚡ {t("auth.quickRegister")}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center -mt-1">{t("auth.quickHint")}</p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: window.location.origin },
              });
              if (error) throw error;
              // On success Supabase redirects the browser to Google, then
              // back to redirectTo — there's nothing further to do here.
            } catch (err: any) {
              toast.error(err.message || "Google sign-in failed");
              setBusy(false);
            }
          }}
        >
          Continue with Google
        </Button>
        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? t("auth.switchToSignUp") : t("auth.switchToSignIn")}
        </button>
      </form>

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("auth.quickDialogTitle")}</DialogTitle>
            <DialogDescription>{t("auth.quickHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="quick-user">{t("auth.quickUsername")}</Label>
              <Input
                id="quick-user"
                value={qUser}
                onChange={(e) => setQUser(e.target.value)}
                placeholder="vd: nam2026"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">{t("auth.quickUsernameHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-pass">{t("auth.password")}</Label>
              <Input
                id="quick-pass"
                type="password"
                value={qPass}
                onChange={(e) => setQPass(e.target.value)}
                minLength={6}
              />
              <p className="text-[11px] text-muted-foreground">{t("auth.quickPasswordHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQuickOpen(false)} disabled={qBusy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={quickRegister} disabled={qBusy}>
              {t("auth.quickSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
