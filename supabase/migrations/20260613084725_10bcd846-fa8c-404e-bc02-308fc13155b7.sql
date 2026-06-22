CREATE TABLE public.shipment_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barcode text NOT NULL,
    product_code text,
    model text,
    status text NOT NULL DEFAULT 'in_warehouse',
    status_changed_at timestamptz,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    is_unrecognized boolean NOT NULL DEFAULT false,
    deleted_at timestamptz,
    deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ocr_raw_text text
);

CREATE TABLE public.shipment_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id uuid NOT NULL REFERENCES public.shipment_records(id) ON DELETE CASCADE,
    storage_path text NOT NULL,
    uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id uuid NOT NULL REFERENCES public.shipment_records(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    action text NOT NULL,
    field text,
    old_value text,
    new_value text,
    created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_records TO authenticated;
GRANT ALL ON public.shipment_records TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_images TO authenticated;
GRANT ALL ON public.shipment_images TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_history TO authenticated;
GRANT ALL ON public.status_history TO service_role;

ALTER TABLE public.shipment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own records" ON public.shipment_records FOR ALL USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can manage own images" ON public.shipment_images FOR ALL USING (auth.uid() = uploaded_by) WITH CHECK (auth.uid() = uploaded_by);
CREATE POLICY "Users can manage own history" ON public.status_history FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);