export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

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
        }
        Insert: {
          id: string
          role: 'landlord' | 'tenant'
          full_name: string
          phone?: string | null
          unit_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          role?: 'landlord' | 'tenant'
          full_name?: string
          phone?: string | null
          unit_id?: string | null
          created_at?: string
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
          status: 'submitted' | 'acknowledged' | 'in_progress' | 'resolved'
          landlord_comment: string | null
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
          status?: 'submitted' | 'acknowledged' | 'in_progress' | 'resolved'
          landlord_comment?: string | null
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
          status?: 'submitted' | 'acknowledged' | 'in_progress' | 'resolved'
          landlord_comment?: string | null
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
