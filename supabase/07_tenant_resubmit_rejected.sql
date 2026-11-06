-- Let tenants resubmit a payment the landlord rejected.
-- The old policy only allowed updates while status = 'pending_review', so the
-- upsert from the tenant app failed for rejected months. A resubmission always
-- goes back to 'pending_review'.
drop policy if exists "payments: tenant updates own pending" on public.payments;

create policy "payments: tenant updates own pending or rejected"
  on public.payments for update
  using (tenant_id = auth.uid() and status in ('pending_review', 'rejected'))
  with check (tenant_id = auth.uid() and status = 'pending_review');
