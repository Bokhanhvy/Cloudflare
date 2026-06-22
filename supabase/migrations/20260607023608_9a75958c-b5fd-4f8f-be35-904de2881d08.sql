
CREATE INDEX IF NOT EXISTS idx_shipment_records_barcode ON public.shipment_records (barcode);
CREATE INDEX IF NOT EXISTS idx_shipment_records_product_code ON public.shipment_records (product_code);
CREATE INDEX IF NOT EXISTS idx_shipment_records_status ON public.shipment_records (status);
CREATE INDEX IF NOT EXISTS idx_shipment_records_created_at ON public.shipment_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_records_model ON public.shipment_records (model);
CREATE INDEX IF NOT EXISTS idx_shipment_images_record_id ON public.shipment_images (record_id);
CREATE INDEX IF NOT EXISTS idx_status_history_record_id ON public.status_history (record_id);
CREATE INDEX IF NOT EXISTS idx_status_history_created_at ON public.status_history (created_at DESC);
