
DO $$
DECLARE
  dup RECORD;
  keeper UUID;
  latest_status public.shipment_status;
BEGIN
  FOR dup IN
    SELECT barcode FROM public.shipment_records
    WHERE is_unrecognized = false AND deleted_at IS NULL
    GROUP BY barcode HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keeper
      FROM public.shipment_records
      WHERE barcode = dup.barcode AND is_unrecognized = false AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1;

    SELECT status INTO latest_status
      FROM public.shipment_records
      WHERE barcode = dup.barcode AND is_unrecognized = false AND deleted_at IS NULL
      ORDER BY updated_at DESC, created_at DESC LIMIT 1;

    UPDATE public.shipment_images SET record_id = keeper
      WHERE record_id IN (
        SELECT id FROM public.shipment_records
        WHERE barcode = dup.barcode AND is_unrecognized = false AND deleted_at IS NULL
          AND id <> keeper
      );

    UPDATE public.status_history SET record_id = keeper
      WHERE record_id IN (
        SELECT id FROM public.shipment_records
        WHERE barcode = dup.barcode AND is_unrecognized = false AND deleted_at IS NULL
          AND id <> keeper
      );

    INSERT INTO public.status_history (record_id, action, new_value)
    VALUES (keeper, 'duplicate_merged', dup.barcode);

    DELETE FROM public.shipment_records
      WHERE barcode = dup.barcode AND is_unrecognized = false AND deleted_at IS NULL
        AND id <> keeper;

    UPDATE public.shipment_records
      SET status = latest_status, updated_at = now()
      WHERE id = keeper;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shipment_records_unique_active_barcode
  ON public.shipment_records (barcode)
  WHERE is_unrecognized = false AND deleted_at IS NULL;
