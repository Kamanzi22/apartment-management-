-- ============================================================
-- MIGRATION 06: Lease contract uploads
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Path of the uploaded contract file in the lease-contracts bucket
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS contract_path TEXT;

-- 2. Storage bucket for lease contracts (landlord-only, private)
--    Limits match the app: 15MB, PDF / JPG / PNG / WEBP
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lease-contracts',
  'lease-contracts',
  false,
  15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "lease-contracts: landlord only" ON storage.objects;
CREATE POLICY "lease-contracts: landlord only"
  ON storage.objects FOR ALL
  USING  (bucket_id = 'lease-contracts' AND public.is_landlord())
  WITH CHECK (bucket_id = 'lease-contracts' AND public.is_landlord());
