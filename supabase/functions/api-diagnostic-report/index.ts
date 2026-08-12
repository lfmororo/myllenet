import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) throw new Error("Forbidden: admin only");

    const url = new URL(req.url);
    const startDate = url.searchParams.get("start") || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = url.searchParams.get("end") || new Date().toISOString();

    const [efiLogs, notificationLogs, mikrotikLogs] = await Promise.all([
      supabase.from("efi_api_logs").select("*").gte("created_at", startDate).lte("created_at", endDate).order('created_at', { ascending: true }),
      supabase.from("notification_logs").select("*").gte("created_at", startDate).lte("created_at", endDate),
      supabase.from("mikrotik_status_history").select("*").gte("logged_at", startDate).lte("logged_at", endDate),
    ]);

    const efiData = efiLogs.data || [];
    const notifData = notificationLogs.data || [];
    const mktData = mikrotikLogs.data || [];

    const report = {
      period: { start: startDate, end: endDate },
      summary: {
        total_efi_calls: efiData.length,
        efi_errors: efiData.filter(l => l.status_code && (l.status_code < 200 || l.status_code >= 300)).length,
        total_notifications: notifData.length,
        notification_failures: notifData.filter(l => l.status === "failed").length,
        mikrotik_downtime_events: mktData.filter(l => !l.online).length,
      },
      efi_metrics: {
        errors_by_endpoint: efiData.reduce((acc: any, log) => {
          if (log.status_code && (log.status_code < 200 || log.status_code >= 300)) {
            acc[log.endpoint] = (acc[log.endpoint] || 0) + 1;
          }
          return acc;
        }, {}),
        avg_response_time: efiData.length ? (efiData.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / efiData.length).toFixed(2) : 0,
        daily_calls: efiData.reduce((acc: any, log) => {
          const date = new Date(log.created_at).toISOString().split('T')[0];
          acc[date] = (acc[date] || 0) + 1;
          return acc;
        }, {})
      },
      notif_metrics: {
        by_type: notifData.reduce((acc: any, log) => {
          acc[log.type] = (acc[log.type] || 0) + 1;
          return acc;
        }, {})
      },
      details: {
        efi_logs: efiData.slice(-100), // Limitar logs detalhados
        notification_logs: notifData.slice(-100),
        mikrotik_logs: mktData.slice(-100),
      }
    };

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
