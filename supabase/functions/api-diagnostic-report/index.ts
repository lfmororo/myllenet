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
      supabase.from("efi_api_logs").select("*").gte("created_at", startDate).lte("created_at", endDate),
      supabase.from("notification_logs").select("*").gte("created_at", startDate).lte("created_at", endDate),
      supabase.from("mikrotik_status_history").select("*").gte("logged_at", startDate).lte("logged_at", endDate),
    ]);

    const report = {
      period: { start: startDate, end: endDate },
      summary: {
        total_efi_calls: efiLogs.data?.length || 0,
        efi_errors: efiLogs.data?.filter(l => l.status_code && (l.status_code < 200 || l.status_code >= 300)).length || 0,
        total_notifications: notificationLogs.data?.length || 0,
        notification_failures: notificationLogs.data?.filter(l => l.status === "failed").length || 0,
        mikrotik_downtime_events: mikrotikLogs.data?.filter(l => !l.online).length || 0,
      },
      efi_metrics: {
        errors_by_endpoint: efiLogs.data?.reduce((acc: any, log) => {
          if (log.status_code && (log.status_code < 200 || log.status_code >= 300)) {
            acc[log.endpoint] = (acc[log.endpoint] || 0) + 1;
          }
          return acc;
        }, {}),
        avg_response_time: efiLogs.data?.length ? (efiLogs.data.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / efiLogs.data.length).toFixed(2) : 0,
      },
      details: {
        efi_logs: efiLogs.data,
        notification_logs: notificationLogs.data,
        mikrotik_logs: mikrotikLogs.data,
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
