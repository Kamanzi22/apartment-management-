export type MaintenanceCategory =
  | 'electrical' | 'plumbing' | 'appliances' | 'structural'
  | 'pest_control' | 'safety' | 'wifi' | 'other'

export type ExpenseCategory =
  | 'electrical' | 'plumbing' | 'appliances' | 'structural'
  | 'pest_control' | 'safety' | 'wifi'
  | 'insurance' | 'taxes' | 'cleaning' | 'building_maintenance' | 'security'
  | 'other'

export const MAINTENANCE_CATEGORIES: { value: MaintenanceCategory; label: string }[] = [
  { value: 'electrical',  label: 'Electrical' },
  { value: 'plumbing',    label: 'Plumbing' },
  { value: 'appliances',  label: 'Appliances' },
  { value: 'structural',  label: 'Structural' },
  { value: 'pest_control',label: 'Pest Control' },
  { value: 'safety',      label: 'Safety' },
  { value: 'wifi',        label: 'WiFi' },
  { value: 'other',       label: 'Other' },
]

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'electrical',        label: 'Electrical' },
  { value: 'plumbing',          label: 'Plumbing' },
  { value: 'appliances',        label: 'Appliances' },
  { value: 'structural',        label: 'Structural' },
  { value: 'pest_control',      label: 'Pest Control' },
  { value: 'safety',            label: 'Safety' },
  { value: 'wifi',              label: 'WiFi' },
  { value: 'insurance',         label: 'Insurance' },
  { value: 'taxes',             label: 'Taxes' },
  { value: 'cleaning',          label: 'Cleaning' },
  { value: 'building_maintenance', label: 'Building Maintenance' },
  { value: 'security',          label: 'Security' },
  { value: 'other',             label: 'Other' },
]

export function categoryLabel(value: string, list: { value: string; label: string }[]): string {
  return list.find(c => c.value === value)?.label ?? value
}

export const URGENCIES = ['low', 'medium', 'high'] as const
export type Urgency = typeof URGENCIES[number]

// Safety pre-selects high urgency; everything else defaults to medium
export function defaultUrgency(category: MaintenanceCategory): Urgency {
  return category === 'safety' ? 'high' : 'medium'
}
