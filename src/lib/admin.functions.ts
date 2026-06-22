import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    const userIds = data.users.map((u) => u.id);
    const [{ data: profs }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,display_name,email").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const profMap = new Map((profs || []).map((p: any) => [p.id, p]));
    const roleMap = new Map<string, string[]>();
    for (const r of roles || []) {
      const arr = roleMap.get((r as any).user_id) || [];
      arr.push((r as any).role);
      roleMap.set((r as any).user_id, arr);
    }
    return {
      users: data.users.map((u) => ({
        id: u.id,
        email: u.email || "",
        created_at: u.created_at,
        display_name: (profMap.get(u.id) as any)?.display_name || null,
        roles: roleMap.get(u.id) || [],
      })),
    };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("Cannot delete yourself");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; role: "admin" | "user"; grant: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      if (data.userId === context.userId && data.role === "admin") {
        throw new Error("Cannot remove your own admin role");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminSetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; password: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.password || data.password.length < 6) throw new Error("Password too short (min 6)");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Generate a random 10-char password and return it to the admin
    const newPassword = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: newPassword });
    if (error) throw new Error(error.message);
    return { ok: true, password: newPassword };
  });
