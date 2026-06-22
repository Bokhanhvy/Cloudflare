import { supabase } from "@/integrations/supabase/client";

const BUCKET = "shipment-photos";

export async function uploadPhoto(file: File, recordId: string, userId: string) {
  const path = `${recordId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  const { error: dbErr } = await supabase.from("shipment_images").insert({
    record_id: recordId,
    storage_path: path,
    uploaded_by: userId,
  });
  if (dbErr) throw dbErr;
  await supabase.from("status_history").insert({
    record_id: recordId,
    user_id: userId,
    action: "photo_added",
    new_value: path,
  });
  return path;
}

const urlCache = new Map<string, { url: string; exp: number }>();

// Batch together signed-URL requests that happen within the same tick (e.g.
// many PhotoThumb components mounting at once when a group with lots of
// photos is expanded) into a single createSignedUrls call, instead of firing
// one Storage API request per image. Falls back to per-path requests only
// for whatever wasn't already resolved by the in-flight batch.
let pendingPaths: Set<string> | null = null;
let pendingResolvers: Map<string, Array<(url: string) => void>> | null = null;
let flushScheduled = false;

async function flushPendingSignedUrls() {
  const paths = pendingPaths!;
  const resolvers = pendingResolvers!;
  pendingPaths = null;
  pendingResolvers = null;
  flushScheduled = false;

  const list = Array.from(paths);
  const now = Date.now();
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(list, 3600);
    if (error) throw error;
    for (const entry of data || []) {
      const url = entry.signedUrl || "";
      if (entry.path) urlCache.set(entry.path, { url, exp: now + 50 * 60 * 1000 });
      const fns = resolvers.get(entry.path || "") || [];
      fns.forEach((fn) => fn(url));
    }
  } catch {
    // Batch call failed (e.g. one bad path) — resolve everything with "" so
    // callers don't hang; individual PhotoThumb instances already show a
    // placeholder while url is empty.
    for (const p of list) {
      const fns = resolvers.get(p) || [];
      fns.forEach((fn) => fn(""));
    }
  }
}

export async function signedUrl(path: string): Promise<string> {
  const now = Date.now();
  const c = urlCache.get(path);
  if (c && c.exp > now) return c.url;

  return new Promise<string>((resolve) => {
    if (!pendingPaths) {
      pendingPaths = new Set();
      pendingResolvers = new Map();
    }
    pendingPaths.add(path);
    const fns = pendingResolvers!.get(path) || [];
    fns.push(resolve);
    pendingResolvers!.set(path, fns);
    if (!flushScheduled) {
      flushScheduled = true;
      // Microtask flush: lets every PhotoThumb mounted in this render pass
      // register its path before the batch is sent.
      Promise.resolve().then(flushPendingSignedUrls);
    }
  });
}

export async function deletePhoto(id: string, path: string, recordId: string, userId: string) {
  // Soft-delete: keep storage object and DB row so it can be restored from Recycle Bin.
  const { error } = await supabase.from("shipment_images")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId } as any)
    .eq("id", id);
  if (error) throw error;
  await supabase.from("status_history").insert({
    record_id: recordId,
    user_id: userId,
    action: "photo_deleted",
    old_value: path,
  });
}
