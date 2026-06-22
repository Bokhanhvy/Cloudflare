-- Ensure profile auto-creation on signup and backfill any missing profiles

-- 1) Backfill profiles for existing auth users
INSERT INTO public.profiles (id, email, display_name)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- 2) (Re)create trigger so future signups always get a profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3) RPC the client can call defensively before inserting records
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (uid, uemail, split_part(COALESCE(uemail, ''), '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
