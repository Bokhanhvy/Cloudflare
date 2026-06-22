
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill email from auth.users
UPDATE public.profiles p SET email = u.email
FROM auth.users u WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- Update trigger to include email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- Make sure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update ensure_profile to include email too
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
BEGIN
  SELECT email, COALESCE(raw_user_meta_data->>'display_name', split_part(email, '@', 1))
    INTO v_email, v_name FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (auth.uid(), v_email, v_name)
  ON CONFLICT (id) DO UPDATE SET email = COALESCE(public.profiles.email, EXCLUDED.email);
END;
$$;
