export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type MaintenanceStatus = 'submitted' | 'acknowledged' | 'scheduled' | 'in_progress' | 'on_hold' | 'resolved' | 'closed'
export type LedgerStatus = 'paid' | 'partial' | 'pending' | 'overdue' | 'not_due'
export type LedgerRow = { period_month: string; due_date: string; expected: number; confirmed_paid: number; pending_paid: number; balance: number; status: LedgerStatus }

export type Database = {
  public: {
    Tables: {
      units: {
        Row: {
          id: string
          label: string
          bedroom_count: number
          monthly_rent: number
          status: 'occupied' | 'vacant'
          created_at: string
        }
        Insert: {
          id?: string
          label: string
          bedroom_count: number
          monthly_rent: number
          status?: 'occupied' | 'vacant'
          created_at?: string
        }
        Update: {
          id?: string
          label?: string
          bedroom_count?: number
          monthly_rent?: number
          status?: 'occupied' | 'vacant'
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          role: 'landlord' | 'tenant'
          full_name: string
          phone: string | null
          unit_id: string | null
          created_at: string
          email_notifications: boolean
        }
        Insert: {
          id: string
          role: 'landlord' | 'tenant'
          full_name: string
          phone?: string | null
          unit_id?: string | null
          created_at?: string
          email_notifications?: boolean
        }
        Update: {
          id?: string
          role?: 'landlord' | 'tenant'
          full_name?: string
          phone?: string | null
          unit_id?: string | null
          created_at?: string
          email_notifications?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          }
        ]
      }
      leases: {
        Row: {
          id: string
          unit_id: string
          tenant_id: string
          move_in_date: string
          rent_due_day: number
          monthly_rent: number
          deposit_amount: number
          lease_start: string
          lease_end: string | null
          status: 'active' | 'ended'
          contract_path: string | null
          created_at: string
        }
        Insert: {
          id?: string
          unit_id: string
          tenant_id: string
          move_in_date: string
          rent_due_day: number
          monthly_rent: number
          deposit_amount?: number
          lease_start: string
          lease_end?: string | null
          status?: 'active' | 'ended'
          contract_path?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          unit_id?: string
          tenant_id?: string
          move_in_date?: string
          rent_due_day?: number
          monthly_rent?: number
          deposit_amount?: number
          lease_start?: string
          lease_end?: string | null
          status?: 'active' | 'ended'
          contract_path?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'leases_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'leases_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      payments: {
        Row: {
          id: string
          lease_id: string
          tenant_id: string
          period_month: string
          amount: number
          receipt_file_url: string | null
          submitted_at: string
          status: 'pending_review' | 'confirmed' | 'rejected'
          reviewed_by: string | null
          reviewed_at: string | null
          landlord_notes: string | null
        }
        Insert: {
          id?: string
          lease_id: string
          tenant_id: string
          period_month: string
          amount: number
          receipt_file_url?: string | null
          submitted_at?: string
          status?: 'pending_review' | 'confirmed' | 'rejected'
          reviewed_by?: string | null
          reviewed_at?: string | null
          landlord_notes?: string | null
        }
        Update: {
          id?: string
          lease_id?: string
          tenant_id?: string
          period_month?: string
          amount?: number
          receipt_file_url?: string | null
          submitted_at?: string
          status?: 'pending_review' | 'confirmed' | 'rejected'
          reviewed_by?: string | null
          reviewed_at?: string | null
          landlord_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'payments_lease_id_fkey'
            columns: ['lease_id']
            isOneToOne: false
            referencedRelation: 'leases'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      maintenance_requests: {
        Row: {
          id: string
          unit_id: string
          tenant_id: string
          category: 'electrical' | 'plumbing' | 'appliances' | 'structural' | 'pest_control' | 'safety' | 'wifi' | 'other'
          description: string
          photo_urls: string[]
          urgency: 'low' | 'medium' | 'high'
          status: MaintenanceStatus
          landlord_comment: string | null
          scheduled_for: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          unit_id: string
          tenant_id: string
          category: 'electrical' | 'plumbing' | 'appliances' | 'structural' | 'pest_control' | 'safety' | 'wifi' | 'other'
          description: string
          photo_urls?: string[]
          urgency: 'low' | 'medium' | 'high'
          status?: MaintenanceStatus
          landlord_comment?: string | null
          scheduled_for?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          unit_id?: string
          tenant_id?: string
          category?: 'electrical' | 'plumbing' | 'appliances' | 'structural' | 'pest_control' | 'safety' | 'wifi' | 'other'
          description?: string
          photo_urls?: string[]
          urgency?: 'low' | 'medium' | 'high'
          status?: MaintenanceStatus
          landlord_comment?: string | null
          scheduled_for?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'maintenance_requests_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'maintenance_requests_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      messages: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string | null
          body: string
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          sender_id: string
          recipient_id?: string | null
          body: string
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          sender_id?: string
          recipient_id?: string | null
          body?: string
          created_at?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'messages_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      move_out_notices: {
        Row: {
          id: string
          lease_id: string
          tenant_id: string
          intended_move_out_date: string
          reason: string | null
          status: 'submitted' | 'acknowledged'
          created_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          tenant_id: string
          intended_move_out_date: string
          reason?: string | null
          status?: 'submitted' | 'acknowledged'
          created_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          tenant_id?: string
          intended_move_out_date?: string
          reason?: string | null
          status?: 'submitted' | 'acknowledged'
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'move_out_notices_lease_id_fkey'
            columns: ['lease_id']
            isOneToOne: false
            referencedRelation: 'leases'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'move_out_notices_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          body: string
          link: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          body: string
          link?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          title?: string
          body?: string
          link?: string | null
          read_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      expenses: {
        Row: {
          id: string
          unit_id: string | null
          category: 'electrical' | 'plumbing' | 'appliances' | 'structural' | 'pest_control' | 'safety' | 'wifi' | 'insurance' | 'taxes' | 'cleaning' | 'building_maintenance' | 'security' | 'other'
          amount: number
          expense_date: string
          description: string
          receipt_file_url: string | null
          linked_maintenance_request_id: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          unit_id?: string | null
          category: 'electrical' | 'plumbing' | 'appliances' | 'structural' | 'pest_control' | 'safety' | 'wifi' | 'insurance' | 'taxes' | 'cleaning' | 'building_maintenance' | 'security' | 'other'
          amount: number
          expense_date: string
          description: string
          receipt_file_url?: string | null
          linked_maintenance_request_id?: string | null
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          unit_id?: string | null
          category?: 'electrical' | 'plumbing' | 'appliances' | 'structural' | 'pest_control' | 'safety' | 'wifi' | 'insurance' | 'taxes' | 'cleaning' | 'building_maintenance' | 'security' | 'other'
          amount?: number
          expense_date?: string
          description?: string
          receipt_file_url?: string | null
          linked_maintenance_request_id?: string | null
          created_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expenses_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_linked_maintenance_request_id_fkey'
            columns: ['linked_maintenance_request_id']
            isOneToOne: false
            referencedRelation: 'maintenance_requests'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      rent_schedule: {
        Row: {
          id: string
          lease_id: string
          effective_month: string
          monthly_rent: number
          created_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          effective_month: string
          monthly_rent: number
          created_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          effective_month?: string
          monthly_rent?: number
          created_at?: string
        }
        Relationships: []
      }
      message_reads: {
        Row: {
          message_id: string
          user_id: string
          read_at: string
        }
        Insert: {
          message_id: string
          user_id: string
          read_at?: string
        }
        Update: {
          message_id?: string
          user_id?: string
          read_at?: string
        }
        Relationships: []
      }
      sent_alerts: {
        Row: {
          key: string
          sent_at: string
          level: string | null
          days_offset: number | null
          channel: string | null
          lease_id: string | null
          period_month: string | null
          user_id: string | null
        }
        Insert: {
          key: string
          sent_at?: string
          level?: string | null
          days_offset?: number | null
          channel?: string | null
          lease_id?: string | null
          period_month?: string | null
          user_id?: string | null
        }
        Update: {
          key?: string
          sent_at?: string
          level?: string | null
          days_offset?: number | null
          channel?: string | null
          lease_id?: string | null
          period_month?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          created_at?: string
        }
        Relationships: []
      }
      alert_settings: {
        Row: {
          landlord_id: string
          enabled: boolean
          before_due_days: number[]
          on_due_day: boolean
          after_due_days: number[]
          warning_after_days: number
          final_warning_after_days: number
          notify_landlord_after_days: number
          send_hour: number
          channels: ('in_app' | 'email' | 'sms')[]
          tpl_before: string
          tpl_due_today: string
          tpl_overdue: string
          tpl_warning: string
          tpl_final_warning: string
          tpl_over_limit: string
          lease_ending_days: number
          receipt_waiting_days: number
          repair_open_days: number
          grace_days: number
          max_unpaid_days: number
          notice_period_days: number
          updated_at: string
        }
        Insert: {
          landlord_id: string
          enabled?: boolean
          before_due_days?: number[]
          on_due_day?: boolean
          after_due_days?: number[]
          warning_after_days?: number
          final_warning_after_days?: number
          notify_landlord_after_days?: number
          send_hour?: number
          channels?: ('in_app' | 'email' | 'sms')[]
          tpl_before?: string
          tpl_due_today?: string
          tpl_overdue?: string
          tpl_warning?: string
          tpl_final_warning?: string
          tpl_over_limit?: string
          lease_ending_days?: number
          receipt_waiting_days?: number
          repair_open_days?: number
          grace_days?: number
          max_unpaid_days?: number
          notice_period_days?: number
          updated_at?: string
        }
        Update: {
          landlord_id?: string
          enabled?: boolean
          before_due_days?: number[]
          on_due_day?: boolean
          after_due_days?: number[]
          warning_after_days?: number
          final_warning_after_days?: number
          notify_landlord_after_days?: number
          send_hour?: number
          channels?: ('in_app' | 'email' | 'sms')[]
          tpl_before?: string
          tpl_due_today?: string
          tpl_overdue?: string
          tpl_warning?: string
          tpl_final_warning?: string
          tpl_over_limit?: string
          lease_ending_days?: number
          receipt_waiting_days?: number
          repair_open_days?: number
          grace_days?: number
          max_unpaid_days?: number
          notice_period_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      lease_alert_overrides: {
        Row: {
          lease_id: string
          enabled: boolean
          before_due_days: number[] | null
          after_due_days: number[] | null
          updated_at: string
        }
        Insert: {
          lease_id: string
          enabled?: boolean
          before_due_days?: number[] | null
          after_due_days?: number[] | null
          updated_at?: string
        }
        Update: {
          lease_id?: string
          enabled?: boolean
          before_due_days?: number[] | null
          after_due_days?: number[] | null
          updated_at?: string
        }
        Relationships: []
      }
      rent_limit_actions: {
        Row: {
          id: string
          lease_id: string
          action: 'payment_plan' | 'more_time' | 'notice_to_vacate' | 'resume'
          details: Json
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          action: 'payment_plan' | 'more_time' | 'notice_to_vacate' | 'resume'
          details?: Json
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          action?: 'payment_plan' | 'more_time' | 'notice_to_vacate' | 'resume'
          details?: Json
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      vacate_notices: {
        Row: {
          id: string
          lease_id: string
          tenant_id: string
          issued_by: string | null
          issued_at: string
          move_out_date: string
          reason: string | null
          status: 'issued' | 'withdrawn'
        }
        Insert: {
          id?: string
          lease_id: string
          tenant_id: string
          issued_by?: string | null
          issued_at?: string
          move_out_date: string
          reason?: string | null
          status?: 'issued' | 'withdrawn'
        }
        Update: {
          id?: string
          lease_id?: string
          tenant_id?: string
          issued_by?: string | null
          issued_at?: string
          move_out_date?: string
          reason?: string | null
          status?: 'issued' | 'withdrawn'
        }
        Relationships: []
      }
      maintenance_status_history: {
        Row: {
          id: string
          request_id: string
          from_status: string | null
          to_status: string
          comment: string | null
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          request_id: string
          from_status?: string | null
          to_status: string
          comment?: string | null
          changed_by?: string | null
          changed_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          from_status?: string | null
          to_status?: string
          comment?: string | null
          changed_by?: string | null
          changed_at?: string
        }
        Relationships: []
      }
      maintenance_updates: {
        Row: {
          id: string
          request_id: string
          author_id: string
          body: string
          photo_paths: string[]
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          author_id?: string
          body: string
          photo_paths?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          author_id?: string
          body?: string
          photo_paths?: string[]
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      rent_ledger: { Args: { p_lease: string; p_today?: string }; Returns: LedgerRow[] }
      rent_upcoming: { Args: { p_lease: string; p_months?: number; p_today?: string }; Returns: LedgerRow[] }
      rent_ledger_many: { Args: { p_leases: string[]; p_today?: string }; Returns: (LedgerRow & { lease_id: string })[] }
      tenant_balance: { Args: { p_tenant: string; p_today?: string }; Returns: number }
      set_unit_rent: { Args: { p_unit: string; p_rent: number; p_effective_month: string }; Returns: undefined }
      end_tenancy: { Args: { p_lease: string; p_move_out: string }; Returns: undefined }
      attach_tenant: {
        Args: {
          p_tenant: string; p_full_name: string; p_phone: string | null; p_unit: string
          p_move_in: string; p_rent: number; p_deposit: number; p_lease_end: string | null
        }
        Returns: string
      }
      replace_tenancy: {
        Args: {
          p_old_lease: string; p_move_out: string
          p_tenant: string; p_full_name: string; p_phone: string | null; p_unit: string
          p_move_in: string; p_rent: number; p_deposit: number; p_lease_end: string | null
        }
        Returns: string
      }
      due_alerts: {
        Args: { p_now?: string }
        Returns: {
          key: string; user_id: string; audience: 'tenant' | 'landlord'; level: string; notif_type: string
          days_offset: number | null; lease_id: string | null; period_month: string | null
          title: string; body: string; link: string; channels: string[]
        }[]
      }
      alert_settings_current: { Args: Record<string, never>; Returns: Database['public']['Tables']['alert_settings']['Row'][] }
      rent_limit_status: {
        Args: { p_today?: string }
        Returns: {
          lease_id: string; tenant_id: string; unit_id: string; lease_active: boolean
          total_owed: number; oldest_month: string | null; oldest_due: string | null; days_late: number
          state: 'ok' | 'due' | 'late' | 'over_limit' | 'plan' | 'more_time'
          plan_amount: number | null; plan_end: string | null; plan_kept: boolean | null
          more_time_until: string | null; vacate_move_out: string | null
          grace_days: number; max_unpaid_days: number
        }[]
      }
    }
    Enums: Record<string, never>
  }
}
