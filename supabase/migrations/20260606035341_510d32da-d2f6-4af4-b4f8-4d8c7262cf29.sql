
-- Fix mutable search_path
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Restrict direct execution of trigger functions (only triggers need them)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Storage policies for shipment-photos bucket
CREATE POLICY "shipment_photos_read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'shipment-photos');
CREATE POLICY "shipment_photos_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'shipment-photos');
CREATE POLICY "shipment_photos_update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'shipment-photos');
CREATE POLICY "shipment_photos_delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'shipment-photos');
