
-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_shipment_records_barcode ON public.shipment_records (barcode);
CREATE INDEX IF NOT EXISTS idx_shipment_records_product_code ON public.shipment_records (product_code);
CREATE INDEX IF NOT EXISTS idx_shipment_records_status ON public.shipment_records (status);
CREATE INDEX IF NOT EXISTS idx_shipment_records_created_at ON public.shipment_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_records_is_unrecognized ON public.shipment_records (is_unrecognized);
CREATE INDEX IF NOT EXISTS idx_shipment_images_record_id ON public.shipment_images (record_id);
CREATE INDEX IF NOT EXISTS idx_shipment_images_created_at ON public.shipment_images (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_history_record_id ON public.status_history (record_id, created_at DESC);

-- System settings (singleton row keyed by 'global')
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  cleanup_enabled boolean NOT NULL DEFAULT true,
  retention_months integer NOT NULL DEFAULT 6,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_read_all ON public.system_settings;
CREATE POLICY settings_read_all ON public.system_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS settings_write_auth ON public.system_settings;
CREATE POLICY settings_write_auth ON public.system_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS settings_update_auth ON public.system_settings;
CREATE POLICY settings_update_auth ON public.system_settings FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

INSERT INTO public.system_settings (key, cleanup_enabled, retention_months)
VALUES ('global', true, 6)
ON CONFLICT (key) DO NOTHING;

-- Cleanup function: removes shipment_images rows (and storage objects) for shipped records older than retention.
-- Keeps shipment_records, history, and metadata intact.
CREATE OR REPLACE FUNCTION public.cleanup_old_shipped_images()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  s record;
  removed integer := 0;
  img record;
BEGIN
  SELECT cleanup_enabled, retention_months INTO s FROM public.system_settings WHERE key = 'global';
  IF NOT FOUND OR NOT s.cleanup_enabled THEN
    RETURN 0;
  END IF;

  FOR img IN
    SELECT si.id, si.storage_path, si.record_id
    FROM public.shipment_images si
    JOIN public.shipment_records sr ON sr.id = si.record_id
    WHERE sr.status = 'shipped'
      AND si.created_at < now() - (s.retention_months || ' months')::interval
  LOOP
    DELETE FROM storage.objects WHERE bucket_id = 'shipment-photos' AND name = img.storage_path;
    DELETE FROM public.shipment_images WHERE id = img.id;
    INSERT INTO public.status_history (record_id, action, old_value, new_value)
    VALUES (img.record_id, 'photo_auto_cleanup', img.storage_path, 'retention_expired');
    removed := removed + 1;
  END LOOP;

  RETURN removed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_old_shipped_images() TO authenticated;
