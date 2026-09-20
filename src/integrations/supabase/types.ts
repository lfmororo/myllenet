export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_tokens: {
        Row: {
          active: boolean
          created_at: string
          id: string
          last_ip: string | null
          last_seen_at: string | null
          name: string
          token: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          last_ip?: string | null
          last_seen_at?: string | null
          name: string
          token: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          last_ip?: string | null
          last_seen_at?: string | null
          name?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      block_alerts_sent: {
        Row: {
          created_at: string | null
          customer_id: string | null
          id: string
          invoice_id: string | null
          new_status: string
          processed: boolean | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          new_status: string
          processed?: boolean | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          new_status?: string
          processed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "block_alerts_sent_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "block_alerts_sent_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      block_history: {
        Row: {
          changed_by: string | null
          created_at: string
          customer_id: string
          id: string
          new_status: string
          old_status: string | null
          reason: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          customer_id: string
          id?: string
          new_status: string
          old_status?: string | null
          reason?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          new_status?: string
          old_status?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "block_history_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_alerts_sent: {
        Row: {
          alert_type: string
          customer_id: string | null
          id: string
          sent_at: string | null
        }
        Insert: {
          alert_type: string
          customer_id?: string | null
          id?: string
          sent_at?: string | null
        }
        Update: {
          alert_type?: string
          customer_id?: string | null
          id?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_alerts_sent_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_feedback: {
        Row: {
          created_at: string
          id: string
          mensagem: string | null
          nome: string | null
          rating: number
          telefone: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          id?: string
          mensagem?: string | null
          nome?: string | null
          rating: number
          telefone?: string | null
          tipo?: string
        }
        Update: {
          created_at?: string
          id?: string
          mensagem?: string | null
          nome?: string | null
          rating?: number
          telefone?: string | null
          tipo?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          alert_on_abnormal_usage: boolean | null
          alert_on_disconnect: boolean | null
          alert_on_frequent_drops: boolean | null
          ativo: boolean
          bairro: string | null
          block_alerts_enabled: boolean | null
          block_status: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cep: string | null
          cidade: string | null
          complemento: string | null
          cortesia: boolean
          cpf: string
          created_at: string
          desconto_especial_centavos: number
          dia_vencimento: number
          email: string
          estado: string | null
          id: string
          nome: string
          numero: string | null
          pago_ate: string | null
          plan_id: string | null
          pop_name: string | null
          preferred_payment_method: string | null
          rua: string | null
          seller_name: string | null
          senha_pppoe: string
          telefone: string | null
          updated_at: string
          usuario_pppoe: string
        }
        Insert: {
          alert_on_abnormal_usage?: boolean | null
          alert_on_disconnect?: boolean | null
          alert_on_frequent_drops?: boolean | null
          ativo?: boolean
          bairro?: string | null
          block_alerts_enabled?: boolean | null
          block_status?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          cortesia?: boolean
          cpf: string
          created_at?: string
          desconto_especial_centavos?: number
          dia_vencimento?: number
          email: string
          estado?: string | null
          id?: string
          nome: string
          numero?: string | null
          pago_ate?: string | null
          plan_id?: string | null
          pop_name?: string | null
          preferred_payment_method?: string | null
          rua?: string | null
          seller_name?: string | null
          senha_pppoe: string
          telefone?: string | null
          updated_at?: string
          usuario_pppoe: string
        }
        Update: {
          alert_on_abnormal_usage?: boolean | null
          alert_on_disconnect?: boolean | null
          alert_on_frequent_drops?: boolean | null
          ativo?: boolean
          bairro?: string | null
          block_alerts_enabled?: boolean | null
          block_status?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          cortesia?: boolean
          cpf?: string
          created_at?: string
          desconto_especial_centavos?: number
          dia_vencimento?: number
          email?: string
          estado?: string | null
          id?: string
          nome?: string
          numero?: string | null
          pago_ate?: string | null
          plan_id?: string | null
          pop_name?: string | null
          preferred_payment_method?: string | null
          rua?: string | null
          seller_name?: string | null
          senha_pppoe?: string
          telefone?: string | null
          updated_at?: string
          usuario_pppoe?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      efi_api_logs: {
        Row: {
          context: string | null
          created_at: string
          duration_ms: number | null
          endpoint: string
          error_message: string | null
          id: string
          method: string
          request_body: string | null
          response_body: string | null
          status_code: number | null
        }
        Insert: {
          context?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          error_message?: string | null
          id?: string
          method: string
          request_body?: string | null
          response_body?: string | null
          status_code?: number | null
        }
        Update: {
          context?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          error_message?: string | null
          id?: string
          method?: string
          request_body?: string | null
          response_body?: string | null
          status_code?: number | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          created_at: string
          customer_id: string
          descricao: string
          efi_barcode: string | null
          efi_charge_id: number | null
          efi_link: string | null
          efi_pix_copiacola: string | null
          efi_pix_qrcode: string | null
          gateway: string
          gateway_fee_centavos: number
          id: string
          mp_link: string | null
          mp_payment_id: string | null
          mp_pix_copiacola: string | null
          mp_pix_qrcode: string | null
          net_amount_centavos: number | null
          paid_at: string | null
          payment_method: string | null
          plan_id: string | null
          status: string
          updated_at: string
          valor_centavos: number
          vencimento: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          descricao: string
          efi_barcode?: string | null
          efi_charge_id?: number | null
          efi_link?: string | null
          efi_pix_copiacola?: string | null
          efi_pix_qrcode?: string | null
          gateway?: string
          gateway_fee_centavos?: number
          id?: string
          mp_link?: string | null
          mp_payment_id?: string | null
          mp_pix_copiacola?: string | null
          mp_pix_qrcode?: string | null
          net_amount_centavos?: number | null
          paid_at?: string | null
          payment_method?: string | null
          plan_id?: string | null
          status?: string
          updated_at?: string
          valor_centavos: number
          vencimento: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          descricao?: string
          efi_barcode?: string | null
          efi_charge_id?: number | null
          efi_link?: string | null
          efi_pix_copiacola?: string | null
          efi_pix_qrcode?: string | null
          gateway?: string
          gateway_fee_centavos?: number
          id?: string
          mp_link?: string | null
          mp_payment_id?: string | null
          mp_pix_copiacola?: string | null
          mp_pix_qrcode?: string | null
          net_amount_centavos?: number | null
          paid_at?: string | null
          payment_method?: string | null
          plan_id?: string | null
          status?: string
          updated_at?: string
          valor_centavos?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      mikrotik_commands: {
        Row: {
          action: string
          attempts: number
          created_at: string
          customer_id: string | null
          error_message: string | null
          executed_at: string | null
          id: string
          payload: Json
          result: Json | null
          status: string
          usuario_pppoe: string
        }
        Insert: {
          action: string
          attempts?: number
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          usuario_pppoe: string
        }
        Update: {
          action?: string
          attempts?: number
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          usuario_pppoe?: string
        }
        Relationships: [
          {
            foreignKeyName: "mikrotik_commands_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      mikrotik_pppoe_snapshots: {
        Row: {
          collected_at: string
          collection_ok: boolean
          host: string
          id: string
          usernames: Json
        }
        Insert: {
          collected_at?: string
          collection_ok?: boolean
          host: string
          id?: string
          usernames?: Json
        }
        Update: {
          collected_at?: string
          collection_ok?: boolean
          host?: string
          id?: string
          usernames?: Json
        }
        Relationships: []
      }
      mikrotik_status_history: {
        Row: {
          diagnostics: Json | null
          host: string
          id: string
          logged_at: string | null
          message: string | null
          online: boolean
        }
        Insert: {
          diagnostics?: Json | null
          host: string
          id?: string
          logged_at?: string | null
          message?: string | null
          online: boolean
        }
        Update: {
          diagnostics?: Json | null
          host?: string
          id?: string
          logged_at?: string | null
          message?: string | null
          online?: boolean
        }
        Relationships: []
      }
      notification_logs: {
        Row: {
          created_at: string
          customer_id: string | null
          customer_name: string
          error_message: string | null
          id: string
          message: string
          phone: string | null
          status: string
          type: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          customer_name: string
          error_message?: string | null
          id?: string
          message: string
          phone?: string | null
          status?: string
          type: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          error_message?: string | null
          id?: string
          message?: string
          phone?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          ativo: boolean
          created_at: string
          desconto_centavos: number
          descricao: string | null
          dias_desconto: number
          id: string
          intervalo_meses: number
          juros_mensal: number
          multa_centavos: number
          nome: string
          nome_servidor: string | null
          updated_at: string
          valor_centavos: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          desconto_centavos?: number
          descricao?: string | null
          dias_desconto?: number
          id?: string
          intervalo_meses?: number
          juros_mensal?: number
          multa_centavos?: number
          nome: string
          nome_servidor?: string | null
          updated_at?: string
          valor_centavos: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          desconto_centavos?: number
          descricao?: string | null
          dias_desconto?: number
          id?: string
          intervalo_meses?: number
          juros_mensal?: number
          multa_centavos?: number
          nome?: string
          nome_servidor?: string | null
          updated_at?: string
          valor_centavos?: number
        }
        Relationships: []
      }
      pppoe_drops: {
        Row: {
          customer_id: string
          dropped_at: string | null
          id: string
          last_uptime: string | null
          reason: string | null
          usuario_pppoe: string
        }
        Insert: {
          customer_id: string
          dropped_at?: string | null
          id?: string
          last_uptime?: string | null
          reason?: string | null
          usuario_pppoe: string
        }
        Update: {
          customer_id?: string
          dropped_at?: string | null
          id?: string
          last_uptime?: string | null
          reason?: string | null
          usuario_pppoe?: string
        }
        Relationships: [
          {
            foreignKeyName: "pppoe_drops_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      pppoe_logs: {
        Row: {
          customer_id: string
          event_type: string
          id: string
          ip_address: string | null
          logged_at: string | null
          rx_bytes: number | null
          tx_bytes: number | null
          uptime: string | null
          usuario_pppoe: string
        }
        Insert: {
          customer_id: string
          event_type: string
          id?: string
          ip_address?: string | null
          logged_at?: string | null
          rx_bytes?: number | null
          tx_bytes?: number | null
          uptime?: string | null
          usuario_pppoe: string
        }
        Update: {
          customer_id?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          logged_at?: string | null
          rx_bytes?: number | null
          tx_bytes?: number | null
          uptime?: string | null
          usuario_pppoe?: string
        }
        Relationships: [
          {
            foreignKeyName: "pppoe_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      user_report_permissions: {
        Row: {
          created_at: string
          id: string
          report_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          report_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          report_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wan_logs: {
        Row: {
          cpu_load: number | null
          created_at: string
          free_memory: number | null
          id: string
          interface_name: string
          rx_bps: number
          rx_bytes: number | null
          temperature: number | null
          total_memory: number | null
          tx_bps: number
          tx_bytes: number | null
        }
        Insert: {
          cpu_load?: number | null
          created_at?: string
          free_memory?: number | null
          id?: string
          interface_name: string
          rx_bps?: number
          rx_bytes?: number | null
          temperature?: number | null
          total_memory?: number | null
          tx_bps?: number
          tx_bytes?: number | null
        }
        Update: {
          cpu_load?: number | null
          created_at?: string
          free_memory?: number | null
          id?: string
          interface_name?: string
          rx_bps?: number
          rx_bytes?: number | null
          temperature?: number | null
          total_memory?: number | null
          tx_bps?: number
          tx_bytes?: number | null
        }
        Relationships: []
      }
      wan_status_history: {
        Row: {
          created_at: string | null
          id: string
          interface_name: string
          reason: string | null
          status: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          interface_name: string
          reason?: string | null
          status: string
        }
        Update: {
          created_at?: string | null
          id?: string
          interface_name?: string
          reason?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_abnormal_usage: {
        Args: { bytes_threshold: number }
        Returns: {
          customer_id: string
          total_bytes: number
        }[]
      }
      check_and_block_overdue_customers: { Args: never; Returns: undefined }
      check_frequent_drops: {
        Args: { drop_count: number; time_threshold: string }
        Returns: {
          count: number
          customer_id: string
        }[]
      }
      get_bandwidth_report: {
        Args: { _from: string; _to: string }
        Returns: {
          active_days: number
          customer_id: string
          download_bytes: number
          peak_bytes: number
          total_bytes: number
          upload_bytes: number
        }[]
      }
      get_recent_disconnections: {
        Args: { since_time: string }
        Returns: {
          customer_id: string
          last_seen: string
          nome: string
          usuario_pppoe: string
        }[]
      }
      has_report_access: {
        Args: { _report_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
