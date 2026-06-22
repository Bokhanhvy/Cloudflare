
CREATE POLICY "Users select own shipment photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'shipment-photos' AND owner = auth.uid());

CREATE POLICY "Users insert own shipment photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'shipment-photos' AND owner = auth.uid());

CREATE POLICY "Users update own shipment photos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'shipment-photos' AND owner = auth.uid())
WITH CHECK (bucket_id = 'shipment-photos' AND owner = auth.uid());

CREATE POLICY "Users delete own shipment photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'shipment-photos' AND owner = auth.uid());
