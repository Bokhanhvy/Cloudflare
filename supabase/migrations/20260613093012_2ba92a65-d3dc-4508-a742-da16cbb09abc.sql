
-- Revert to shared (workspace-style) access like the original project
DROP POLICY IF EXISTS "Users can manage own records" ON public.shipment_records;
DROP POLICY IF EXISTS "Users can manage own images" ON public.shipment_images;
DROP POLICY IF EXISTS "Users can manage own history" ON public.status_history;

CREATE POLICY "records_all_auth" ON public.shipment_records
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "images_all_auth" ON public.shipment_images
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "history_read_all" ON public.status_history
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "history_insert_auth" ON public.status_history
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow everyone signed in to see each other's display names
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "profiles_read_all" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

-- Helper RPC called by upload page to make sure a profile row exists
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    auth.uid(),
    COALESCE(
      (SELECT raw_user_meta_data->>'display_name' FROM auth.users WHERE id = auth.uid()),
      (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
