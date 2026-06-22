
ALTER TABLE public.shipment_records
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.shipment_images
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS idx_shipment_records_deleted_at ON public.shipment_records (deleted_at);
CREATE INDEX IF NOT EXISTS idx_shipment_images_deleted_at ON public.shipment_images (deleted_at);

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS trash_retention_days integer NOT NULL DEFAULT 30;

CREATE OR REPLACE FUNCTION public.purge_trash_items()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  s record;
  removed integer := 0;
  img record;
  rec record;
BEGIN
  SELECT trash_retention_days INTO s FROM public.system_settings WHERE key = 'global';
  IF NOT FOUND OR COALESCE(s.trash_retention_days, 0) <= 0 THEN
    RETURN 0;
  END IF;

  -- Purge soft-deleted images older than retention
  FOR img IN
    SELECT id, storage_path, record_id
    FROM public.shipment_images
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - (s.trash_retention_days || ' days')::interval
  LOOP
    DELETE FROM storage.objects WHERE bucket_id = 'shipment-photos' AND name = img.storage_path;
    DELETE FROM public.shipment_images WHERE id = img.id;
    INSERT INTO public.status_history (record_id, action, old_value, new_value)
    VALUES (img.record_id, 'photo_purged', img.storage_path, 'trash_retention_expired');
    removed := removed + 1;
  END LOOP;

  -- Purge soft-deleted records older than retention (and any remaining images)
  FOR rec IN
    SELECT id FROM public.shipment_records
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - (s.trash_retention_days || ' days')::interval
  LOOP
    FOR img IN
      SELECT id, storage_path FROM public.shipment_images WHERE record_id = rec.id
    LOOP
      DELETE FROM storage.objects WHERE bucket_id = 'shipment-photos' AND name = img.storage_path;
      DELETE FROM public.shipment_images WHERE id = img.id;
    END LOOP;
    DELETE FROM public.shipment_records WHERE id = rec.id;
    removed := removed + 1;
  END LOOP;

  RETURN removed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_trash_items() TO authenticated;
