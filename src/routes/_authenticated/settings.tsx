import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2, Save, User as UserIcon, Lock, Shield, ShieldOff, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { adminListUsers, adminDeleteUser, adminSetRole, adminSetPassword, adminResetPassword } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Shipment Tracking" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleanupEnabled, setCleanupEnabled] = useState(true);
  const [retentionMonths, setRetentionMonths] = useState(6);
  const [trashRetentionDays, setTrashRetentionDays] = useState(30);
  const [running, setRunning] = useState(false);
  const [purging, setPurging] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Password change
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [changing, setChanging] = useState(false);

  // Admin
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("system_settings").select("*").eq("key", "global").maybeSingle();
      if (data) {
        setCleanupEnabled(!!data.cleanup_enabled);
        setRetentionMonths(data.retention_months ?? 6);
        setTrashRetentionDays(data.trash_retention_days ?? 30);
      }
      if (user) {
        const { data: prof } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
        setDisplayName(prof?.display_name || "");
        const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: user.id, _role: "admin" });
        setIsAdmin(!!hasAdmin);
      }
      setLoading(false);
    })();
  }, [user]);

  const saveDisplayName = async () => {
    if (!user) return;
    setSavingName(true);
    const name = displayName.trim();
    const { error } = await supabase.from("profiles").update({ display_name: name || null }).eq("id", user.id);
    setSavingName(false);
    if (error) toast.error(error.message);
    else toast.success(t("account.saved"));
  };

  const changePassword = async () => {
    if (!user?.email) return;
    if (newPass.length < 6) { toast.error(t("auth.passwordTooShort")); return; }
    if (newPass !== confirmPass) { toast.error(t("account.passwordMismatch")); return; }
    setChanging(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: user.email, password: oldPass });
      if (signErr) throw new Error(t("account.oldPasswordWrong") as string);
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;
      toast.success(t("account.passwordChanged"));
      setOldPass(""); setNewPass(""); setConfirmPass("");
    } catch (err: any) {
      toast.error(err.message || "Failed");
    } finally {
      setChanging(false);
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await (supabase as any).from("system_settings").upsert({
      key: "global",
      cleanup_enabled: cleanupEnabled,
      retention_months: retentionMonths,
      trash_retention_days: trashRetentionDays,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success(t("settings.saved"));
  };

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await (supabase as any).rpc("cleanup_old_shipped_images");
    setRunning(false);
    if (error) toast.error(error.message);
    else toast.success(t("settings.cleanupDone", { n: data ?? 0 }));
  };

  const purgeTrashNow = async () => {
    setPurging(true);
    const { data, error } = await (supabase as any).rpc("purge_trash_items");
    setPurging(false);
    if (error) toast.error(error.message);
    else toast.success(t("settings.trashPurged", { n: data ?? 0 }));
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> ...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>

      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">{t("account.title")}</h2>
        </div>
        <div className="space-y-1.5">
          <Label>{t("account.email")}</Label>
          <Input value={user?.email || ""} disabled />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="display-name">{t("account.displayName")}</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={user?.email?.split("@")[0]}
          />
        </div>
        <div>
          <Button onClick={saveDisplayName} disabled={savingName}>
            <Save className="h-4 w-4 mr-2" /> {savingName ? t("account.saving") : t("account.save")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">{t("account.passwordTitle")}</h2>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="old-pass">{t("account.oldPassword")}</Label>
          <Input id="old-pass" type="password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pass">{t("account.newPassword")}</Label>
          <Input id="new-pass" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} minLength={6} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-pass">{t("account.confirmPassword")}</Label>
          <Input id="confirm-pass" type="password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} minLength={6} />
        </div>
        <div>
          <Button onClick={changePassword} disabled={changing || !oldPass || !newPass || !confirmPass}>
            <Lock className="h-4 w-4 mr-2" /> {changing ? t("account.changing") : t("account.changePassword")}
          </Button>
        </div>
      </section>

      {isAdmin && <AdminSection currentUserId={user!.id} />}

      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div>
          <h2 className="font-medium">{t("settings.cleanupTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.cleanupHelp")}</p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="enabled">{t("settings.enableCleanup")}</Label>
          <Switch id="enabled" checked={cleanupEnabled} onCheckedChange={setCleanupEnabled} />
        </div>

        <div className="space-y-1.5">
          <Label>{t("settings.retention")}</Label>
          <Select
            value={String(retentionMonths)}
            onValueChange={(v) => setRetentionMonths(Number(v))}
            disabled={!cleanupEnabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">{t("settings.months3")}</SelectItem>
              <SelectItem value="6">{t("settings.months6")}</SelectItem>
              <SelectItem value="12">{t("settings.months12")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-2" /> {saving ? t("settings.saving") : t("settings.save")}
          </Button>
          <Button variant="outline" onClick={runNow} disabled={running || !cleanupEnabled}>
            <Trash2 className="h-4 w-4 mr-2" /> {running ? t("settings.running") : t("settings.runNow")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div>
          <h2 className="font-medium">{t("settings.trashTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.trashHelp")}</p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("settings.trashRetention")}</Label>
          <Select
            value={String(trashRetentionDays)}
            onValueChange={(v) => setTrashRetentionDays(Number(v))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">{t("settings.days30")}</SelectItem>
              <SelectItem value="60">{t("settings.days60")}</SelectItem>
              <SelectItem value="90">{t("settings.days90")}</SelectItem>
              <SelectItem value="0">{t("settings.daysNever")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={purgeTrashNow} disabled={purging || trashRetentionDays === 0}>
            <Trash2 className="h-4 w-4 mr-2" /> {purging ? t("settings.running") : t("settings.purgeTrashNow")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function AdminSection({ currentUserId }: { currentUserId: string }) {
  const { t } = useTranslation();
  const listFn = useServerFn(adminListUsers);
  const delFn = useServerFn(adminDeleteUser);
  const roleFn = useServerFn(adminSetRole);
  const setPassFn = useServerFn(adminSetPassword);
  const resetPassFn = useServerFn(adminResetPassword);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn({ data: undefined as any }),
  });

  const [pwTarget, setPwTarget] = useState<{ id: string; email: string } | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const onDelete = async (id: string, email: string) => {
    if (!confirm(t("account.deleteUserConfirm", { email }) as string)) return;
    try {
      await delFn({ data: { userId: id } });
      toast.success(t("account.userDeleted"));
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const onToggleRole = async (id: string, hasAdmin: boolean) => {
    try {
      await roleFn({ data: { userId: id, role: "admin", grant: !hasAdmin } });
      toast.success(t("account.roleUpdated"));
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const onReset = async (id: string, email: string) => {
    if (!confirm(t("account.resetPasswordConfirm", { email }) as string)) return;
    try {
      const res = await resetPassFn({ data: { userId: id } });
      try { await navigator.clipboard.writeText(res.password); } catch { /* ignore */ }
      toast.success(t("account.resetPasswordDone", { password: res.password }), { duration: 15000 });
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const submitSetPassword = async () => {
    if (!pwTarget) return;
    if (pwValue.length < 6) { toast.error(t("auth.passwordTooShort")); return; }
    setPwSaving(true);
    try {
      await setPassFn({ data: { userId: pwTarget.id, password: pwValue } });
      toast.success(t("account.passwordSet"));
      setPwTarget(null);
      setPwValue("");
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h2 className="font-medium">{t("account.adminTitle")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("account.adminHelp")}</p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> ...</div>
      ) : (
        <div className="space-y-2">
          {(data?.users || []).map((u) => {
            const hasAdmin = u.roles.includes("admin");
            const isMe = u.id === currentUserId;
            return (
              <div key={u.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{u.display_name || u.email.split("@")[0]}</div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  {hasAdmin && <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">ADMIN</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setPwTarget({ id: u.id, email: u.email }); setPwValue(""); }}
                    title={t("account.setPassword") as string}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReset(u.id, u.email)}
                    title={t("account.resetPassword") as string}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleRole(u.id, hasAdmin)}
                    disabled={isMe && hasAdmin}
                    title={hasAdmin ? (t("account.removeAdmin") as string) : (t("account.makeAdmin") as string)}
                  >
                    {hasAdmin ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onDelete(u.id, u.email)}
                    disabled={isMe}
                    title={t("account.deleteUser") as string}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!pwTarget} onOpenChange={(o) => { if (!o) { setPwTarget(null); setPwValue(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("account.setPasswordTitle", { email: pwTarget?.email || "" })}</DialogTitle>
          </DialogHeader>
          <Input
            type="text"
            autoFocus
            value={pwValue}
            onChange={(e) => setPwValue(e.target.value)}
            placeholder={t("account.setPasswordPlaceholder") as string}
            minLength={6}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPwTarget(null); setPwValue(""); }}>{t("common.cancel")}</Button>
            <Button onClick={submitSetPassword} disabled={pwSaving || pwValue.length < 6}>
              {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}
              {t("account.setPassword")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
