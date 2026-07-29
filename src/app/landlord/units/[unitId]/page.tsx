import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { format } from 'date-fns'
import { ArrowLeft, Users, Phone, Mail, CheckCircle2, Clock, AlertCircle, KeyRound } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MaintenanceBoard } from '@/app/landlord/maintenance/maintenance-board'
import { RentReviewList } from '@/app/landlord/rent/rent-review-list'
import { UnitAddTenantDialog } from './unit-add-tenant-dialog'
import { EditRentDialog } from './edit-rent-dialog'
import { EditTenantDialog } from './edit-tenant-dialog'
import { EditLeaseDialog } from './edit-lease-dialog'
import { ResetTenantPasswordDialog } from './reset-tenant-password-dialog'
import { ConfirmMoveOutDialog } from './confirm-move-out-dialog'
import { currentPeriodMonth, formatPeriodMonth } from '@/lib/rent-utils'

interface UnitData {
  id: string
  label: string
  bedroom_count: number
  monthly_rent: number
  status: string
}
interface TenantData {
  id: string
  full_name: string
  phone: string | null
}
interface LeaseData {
  id: string
  status: string
  monthly_rent: number
  deposit_amount: number
  move_in_date: string
  rent_due_day: number
  lease_start: string
  lease_end: string | null
}
interface PaymentData {
  id: string
  tenant_id: string
  period_month: string
  amount: number
  receipt_file_url: string | null
  submitted_at: string
  status: string
  landlord_notes: string | null
  profiles: { full_name: string; unit_id: string | null; units: { label: string } | null } | null
}
interface MaintenanceData {
  id: string
  category: string
  description: string
  urgency: string
  status: string
  photo_urls: string[]
  landlord_comment: string | null
  created_at: string
  updated_at: string
  profiles: { full_name: string } | null
  units: { label: string } | null
}

function UnitDetailView({
  unit,
  tenant,
  tenantEmail,
  activeLease,
  payments,
  maintenanceRequests,
  period,
}: {
  unit: UnitData
  tenant: TenantData | null
  tenantEmail: string | null
  activeLease: LeaseData | null
  payments: PaymentData[]
  maintenanceRequests: MaintenanceData[]
  period: string
}) {
  const currentPayment = payments.find(p => p.period_month === period) ?? null
  const openMaintenanceCount = maintenanceRequests.filter(r => r.status !== 'resolved').length
  const todayDay = new Date().getDate()
  const rentDueDay = activeLease?.rent_due_day ?? 1
  const rentDuePassed = todayDay >= rentDueDay

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/landlord"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Overview
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{unit.label}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-slate-500">
                {unit.bedroom_count}BR · ${unit.monthly_rent.toFixed(0)}/mo
              </p>
              <EditRentDialog unitId={unit.id} currentRent={unit.monthly_rent} />
            </div>
          </div>
          <Badge
            variant={unit.status === 'occupied' ? 'default' : 'secondary'}
            className="text-sm px-3 py-1"
          >
            {unit.status === 'occupied' ? 'Occupied' : 'Vacant'}
          </Badge>
        </div>
      </div>

      {/* Tenant */}
      <Card className="shadow-sm">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Tenant</h2>
            {!tenant
              ? <UnitAddTenantDialog unit={unit} />
              : (
                <div className="flex items-center gap-2">
                  {activeLease && (
                    <ConfirmMoveOutDialog
                      tenantId={tenant.id}
                      tenantName={tenant.full_name}
                      unitId={unit.id}
                      unitLabel={unit.label}
                      leaseId={activeLease.id}
                    />
                  )}
                  {tenantEmail && (
                    <EditTenantDialog
                      tenantId={tenant.id}
                      currentName={tenant.full_name}
                      currentEmail={tenantEmail}
                      currentPhone={tenant.phone}
                    />
                  )}
                </div>
              )
            }
          </div>
          {tenant ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-sm text-slate-900">{tenant.full_name}</span>
              </div>
              {tenantEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-600">{tenantEmail}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                {tenant.phone
                  ? <span className="text-sm text-slate-600">{tenant.phone}</span>
                  : <span className="text-sm text-slate-400 italic">No phone</span>
                }
              </div>
              {/* Login credentials */}
              {tenantEmail && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1">
                    <KeyRound className="h-3 w-3" /> Login Credentials
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-400">Email</p>
                      <p className="text-sm text-slate-700 font-mono">{tenantEmail}</p>
                    </div>
                    <ResetTenantPasswordDialog tenantId={tenant.id} tenantName={tenant.full_name} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No tenant — unit is vacant</p>
          )}
        </CardContent>
      </Card>

      {/* Lease */}
      {activeLease && (
        <Card className="shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-800">Lease</h2>
              <EditLeaseDialog
                leaseId={activeLease.id}
                currentMoveIn={activeLease.move_in_date}
                currentLeaseStart={activeLease.lease_start}
                currentLeaseEnd={activeLease.lease_end}
                currentRentDueDay={activeLease.rent_due_day}
                currentDeposit={activeLease.deposit_amount}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-slate-400">Move-in</p>
                <p className="text-sm text-slate-900 mt-0.5">
                  {format(new Date(activeLease.move_in_date), 'MMM d, yyyy')}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Rent due</p>
                <p className="text-sm text-slate-900 mt-0.5">
                  {activeLease.rent_due_day}{['st','nd','rd'][((activeLease.rent_due_day+90)%100-10)%10-1]??'th'} of each month
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Lease end</p>
                <p className="text-sm text-slate-900 mt-0.5">
                  {activeLease.lease_end
                    ? format(new Date(activeLease.lease_end), 'MMM d, yyyy')
                    : 'Month-to-month'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Monthly rent</p>
                <p className="text-sm text-slate-900 mt-0.5">${activeLease.monthly_rent.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Security deposit</p>
                <p className="text-sm text-slate-900 mt-0.5">${activeLease.deposit_amount.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current month rent status */}
      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-3">
          Rent — {formatPeriodMonth(period)}
        </h2>
        {unit.status !== 'occupied' || !tenant ? (
          <Card className="shadow-sm">
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-slate-400">Unit is vacant</p>
            </CardContent>
          </Card>
        ) : !currentPayment && !rentDuePassed ? (
          <Card className="shadow-sm">
            <CardContent className="pt-4 pb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400 shrink-0" />
              <p className="text-sm text-slate-500">Due on the {rentDueDay}{['st','nd','rd'][((rentDueDay+90)%100-10)%10-1]??'th'}</p>
            </CardContent>
          </Card>
        ) : !currentPayment ? (
          <Card className="shadow-sm border-red-200 bg-red-50/30">
            <CardContent className="pt-4 pb-4 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-700 font-medium">No payment submitted this month</p>
            </CardContent>
          </Card>
        ) : currentPayment.status === 'confirmed' ? (
          <Card className="shadow-sm border-green-200 bg-green-50/30">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm text-green-800 font-medium">
                  Paid · ${currentPayment.amount.toFixed(2)}
                </p>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Confirmed {format(new Date(currentPayment.submitted_at), 'MMM d')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-sm border-amber-200 bg-amber-50/30">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800 font-medium">
                  Pending review · ${currentPayment.amount.toFixed(2)}
                </p>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Submitted {format(new Date(currentPayment.submitted_at), 'MMM d')}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Payment history */}
      {payments.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-800 mb-3">Payment History</h2>
          <RentReviewList payments={payments as any} currentPeriod={period} />
        </div>
      )}

      {/* Maintenance */}
      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-3">
          Maintenance
          {openMaintenanceCount > 0 && (
            <span className="ml-2 text-sm font-normal text-orange-600">
              · {openMaintenanceCount} open
            </span>
          )}
        </h2>
        {maintenanceRequests.length > 0 ? (
          <MaintenanceBoard requests={maintenanceRequests as any} />
        ) : (
          <p className="text-sm text-slate-400">No maintenance requests for this unit</p>
        )}
      </div>
    </div>
  )
}

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ unitId: string }>
}) {
  const { unitId } = await params
  const period = currentPeriodMonth()

  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    const {
      demoUnits,
      demoActiveLeases,
      demoLeases,
      demoPayments,
      demoMaintenanceRequests,
    } = await import('@/lib/demo-data')

    const demoUnit = demoUnits.find(u => u.id === unitId)
    if (!demoUnit) notFound()

    const unit: UnitData = {
      id: demoUnit.id,
      label: demoUnit.label,
      bedroom_count: demoUnit.bedroom_count,
      monthly_rent: demoUnit.monthly_rent,
      status: demoUnit.status,
    }

    const rawTenant = demoUnit.profiles[0] as { id: string; full_name: string } | undefined
    const tenant: TenantData | null = rawTenant
      ? { id: rawTenant.id, full_name: rawTenant.full_name, phone: null }
      : null

    const activeLeaseRef = demoActiveLeases.find(l => l.unit_id === unitId)
    const fullLease = activeLeaseRef ? demoLeases.find(l => l.id === activeLeaseRef.id) : null
    const activeLease: LeaseData | null = fullLease
      ? {
          id: fullLease.id,
          status: fullLease.status,
          monthly_rent: fullLease.monthly_rent,
          deposit_amount: fullLease.deposit_amount,
          move_in_date: fullLease.move_in_date,
          rent_due_day: fullLease.rent_due_day,
          lease_start: fullLease.lease_start,
          lease_end: fullLease.lease_end,
        }
      : null

    const tenantPhone = (fullLease as any)?.profiles?.phone ?? null
    const tenantWithPhone: TenantData | null = tenant
      ? { ...tenant, phone: tenantPhone }
      : null

    const payments = (tenant
      ? demoPayments.filter(p => p.tenant_id === tenant.id)
      : []) as unknown as PaymentData[]

    const maintenanceRequests = demoMaintenanceRequests.filter(
      r => r.unit_id === unitId,
    ) as unknown as MaintenanceData[]

    return (
      <UnitDetailView
        unit={unit}
        tenant={tenantWithPhone}
        tenantEmail={tenant ? `${tenant.full_name.toLowerCase().replace(' ', '.')}@demo.com` : null}
        activeLease={activeLease}
        payments={payments}
        maintenanceRequests={maintenanceRequests}
        period={period}
      />
    )
  }

  const supabase = await createClient()
  const adminClient = await createAdminClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rawUnit } = await supabase
    .from('units')
    .select(`
      *,
      profiles!profiles_unit_id_fkey(id, full_name, phone),
      leases!leases_unit_id_fkey(
        id, status, monthly_rent, deposit_amount,
        move_in_date, rent_due_day, lease_start, lease_end
      )
    `)
    .eq('id', unitId)
    .single()

  if (!rawUnit) notFound()

  const unit: UnitData = {
    id: rawUnit.id,
    label: rawUnit.label,
    bedroom_count: rawUnit.bedroom_count,
    monthly_rent: rawUnit.monthly_rent,
    status: rawUnit.status,
  }

  const tenant =
    (rawUnit.profiles as { id: string; full_name: string; phone: string | null }[] | null)?.[0] ??
    null

  const activeLease =
    (
      rawUnit.leases as {
        id: string
        status: string
        monthly_rent: number
        deposit_amount: number
        move_in_date: string
        rent_due_day: number
        lease_start: string
        lease_end: string | null
      }[] | null
    )?.find(l => l.status === 'active') ?? null

  let tenantEmail: string | null = null
  if (tenant?.id) {
    const { data: authUser } = await adminClient.auth.admin.getUserById(tenant.id)
    tenantEmail = authUser.user?.email ?? null
  }

  const paymentsResult = tenant?.id
    ? await supabase
        .from('payments')
        .select(`
          id, tenant_id, period_month, amount, receipt_file_url,
          submitted_at, status, landlord_notes,
          profiles!payments_tenant_id_fkey(full_name, unit_id, units(label))
        `)
        .eq('tenant_id', tenant.id)
        .order('period_month', { ascending: false })
        .limit(12)
    : { data: [] }

  const { data: rawMaintenance } = await supabase
    .from('maintenance_requests')
    .select(`
      id, category, description, urgency, status, photo_urls,
      landlord_comment, created_at, updated_at,
      profiles!maintenance_requests_tenant_id_fkey(full_name),
      units!maintenance_requests_unit_id_fkey(label)
    `)
    .eq('unit_id', unitId)
    .order('created_at', { ascending: false })

  return (
    <UnitDetailView
      unit={unit}
      tenant={tenant}
      tenantEmail={tenantEmail}
      activeLease={activeLease}
      payments={(paymentsResult.data ?? []) as unknown as PaymentData[]}
      maintenanceRequests={(rawMaintenance ?? []) as unknown as MaintenanceData[]}
      period={period}
    />
  )
}
