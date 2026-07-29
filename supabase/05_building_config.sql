-- ============================================================
-- MIGRATION 05: Building config + new expense categories
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Building config table (stores fixed monthly security rate)
CREATE TABLE IF NOT EXISTS public.building_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  security_monthly    NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT building_config_landlord_unique UNIQUE (landlord_id)
);

ALTER TABLE public.building_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "building_config: landlord full access"
  ON public.building_config FOR ALL
  USING (landlord_id = auth.uid())
  WITH CHECK (landlord_id = auth.uid());

-- 2. Add electricity_bill and water_bill to the expenses category constraint
-- First drop the existing check constraint on category
DO $$
DECLARE
  cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
  WHERE tc.table_name = 'expenses'
    AND tc.table_schema = 'public'
    AND tc.constraint_type = 'CHECK'
    AND cc.check_clause ILIKE '%category%';

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.expenses DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_category_check
  CHECK (category IN (
    'electrical', 'plumbing', 'appliances', 'structural',
    'pest_control', 'safety', 'wifi',
    'insurance', 'taxes', 'cleaning', 'building_maintenance', 'security',
    'electricity_bill', 'water_bill', 'other'
  ));
