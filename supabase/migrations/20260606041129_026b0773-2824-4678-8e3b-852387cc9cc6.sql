ALTER TABLE public.shipment_records
  DROP CONSTRAINT IF EXISTS shipment_records_created_by_fkey,
  ADD CONSTRAINT shipment_records_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.shipment_images
  DROP CONSTRAINT IF EXISTS shipment_images_uploaded_by_fkey,
  ADD CONSTRAINT shipment_images_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS shipment_images_record_id_fkey,
  ADD CONSTRAINT shipment_images_record_id_fkey
    FOREIGN KEY (record_id) REFERENCES public.shipment_records(id) ON DELETE CASCADE;

ALTER TABLE public.status_history
  DROP CONSTRAINT IF EXISTS status_history_user_id_fkey,
  ADD CONSTRAINT status_history_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS status_history_record_id_fkey,
  ADD CONSTRAINT status_history_record_id_fkey
    FOREIGN KEY (record_id) REFERENCES public.shipment_records(id) ON DELETE CASCADE;