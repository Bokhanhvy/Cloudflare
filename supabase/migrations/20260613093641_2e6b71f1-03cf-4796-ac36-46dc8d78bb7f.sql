
-- Make sure every existing auth user has a profile row
INSERT INTO public.profiles (id, email, display_name)
SELECT u.id, u.email,
  COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET email = COALESCE(public.profiles.email, EXCLUDED.email);

-- Add FK relationships so PostgREST can embed profiles via created_by / uploaded_by / user_id
ALTER TABLE public.shipment_records
  ADD CONSTRAINT shipment_records_created_by_profiles_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.shipment_images
  ADD CONSTRAINT shipment_images_uploaded_by_profiles_fkey
  FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.status_history
  ADD CONSTRAINT status_history_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
