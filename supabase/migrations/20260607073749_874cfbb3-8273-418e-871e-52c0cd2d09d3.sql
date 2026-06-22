ALTER TABLE public.shipment_records
  ADD CONSTRAINT shipment_records_deleted_by_fkey
  FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.shipment_images
  ADD CONSTRAINT shipment_images_deleted_by_fkey
  FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;