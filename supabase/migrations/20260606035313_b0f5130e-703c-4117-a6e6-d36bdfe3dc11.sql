
-- Status enum
CREATE TYPE public.shipment_status AS ENUM (
  'in_warehouse',
  'ready_to_ship',
  'shipped',
  'moved_to_sorting',
  'returned_to_warehouse'
);

-- Profiles table (display name)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_self_upsert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Trigger to auto-create profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Shipment records
CREATE TABLE public.shipment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL,
  product_code TEXT,
  model TEXT,
  status public.shipment_status NOT NULL DEFAULT 'in_warehouse',
  notes TEXT,
  ocr_raw_text TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shipment_records_barcode ON public.shipment_records(barcode);
CREATE INDEX idx_shipment_records_product_code ON public.shipment_records(product_code);
CREATE INDEX idx_shipment_records_model ON public.shipment_records(model);
CREATE INDEX idx_shipment_records_created_at ON public.shipment_records(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_records TO authenticated;
GRANT ALL ON public.shipment_records TO service_role;
ALTER TABLE public.shipment_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "records_all_auth" ON public.shipment_records FOR ALL TO authenticated USING (true) WITH CHECK (auth.uid() IS NOT NULL);

-- Shipment images
CREATE TABLE public.shipment_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.shipment_records(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shipment_images_record ON public.shipment_images(record_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_images TO authenticated;
GRANT ALL ON public.shipment_images TO service_role;
ALTER TABLE public.shipment_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "images_all_auth" ON public.shipment_images FOR ALL TO authenticated USING (true) WITH CHECK (auth.uid() IS NOT NULL);

-- Activity history
CREATE TABLE public.status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.shipment_records(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_history_record ON public.status_history(record_id, created_at DESC);
CREATE INDEX idx_status_history_created_at ON public.status_history(created_at DESC);

GRANT SELECT, INSERT ON public.status_history TO authenticated;
GRANT ALL ON public.status_history TO service_role;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history_read_all" ON public.status_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "history_insert_auth" ON public.status_history FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_records_updated BEFORE UPDATE ON public.shipment_records
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_images;
ALTER PUBLICATION supabase_realtime ADD TABLE public.status_history;
