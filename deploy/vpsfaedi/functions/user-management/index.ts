import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function getSupabaseClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
}

async function verifyAdmin(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const supabase = getSupabaseClient(authHeader);
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) throw new Error("Unauthorized");
  const userId = data.claims.sub as string;
  const admin = getSupabaseAdmin();
  const { data: roleData } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleData) throw new Error("Forbidden: admin only");
  return userId;
}

async function listUsers(req: Request) {
  await verifyAdmin(req.headers.get("Authorization"));
  const admin = getSupabaseAdmin();

  const { data: { users }, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(error.message);

  // Get roles
  const { data: roles } = await admin.from("user_roles").select("user_id, role");
  const { data: profiles } = await admin.from("profiles").select("user_id, full_name");
  const { data: permissions } = await admin.from("user_report_permissions").select("user_id, report_key");

  const rolesMap = new Map<string, string>();
  for (const r of roles || []) rolesMap.set(r.user_id, r.role);

  const profilesMap = new Map<string, string>();
  for (const p of profiles || []) profilesMap.set(p.user_id, p.full_name || "");

  const mapped = users.map(u => ({
    id: u.id,
    email: u.email,
    full_name: profilesMap.get(u.id) || u.user_metadata?.full_name || "",
    phone: u.user_metadata?.phone || u.phone || "",
    role: rolesMap.get(u.id) || "user",
    report_permissions: (permissions || []).filter(p => p.user_id === u.id).map(p => p.report_key),
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }));

  return new Response(JSON.stringify(mapped), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function createUser(req: Request) {
  await verifyAdmin(req.headers.get("Authorization"));
  const { email, password, full_name, role, phone, report_permissions } = await req.json();

  if (!email || !password) {
    return new Response(JSON.stringify({ error: "Email e senha obrigatórios" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = getSupabaseAdmin();

  const { data: userData, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    phone: phone || undefined,
    user_metadata: { full_name: full_name || email, phone: phone || "" },
  });

  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Assign role if admin
  if (role === "admin" && userData.user) {
    await admin.from("user_roles").insert({ user_id: userData.user.id, role: "admin" });
  }
  if (userData.user && Array.isArray(report_permissions) && report_permissions.length) {
    await admin.from("user_report_permissions").insert(report_permissions.map((report_key: string) => ({ user_id: userData.user.id, report_key })));
  }

  return new Response(JSON.stringify({ success: true, user: userData.user }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function updateUser(req: Request) {
  await verifyAdmin(req.headers.get("Authorization"));
  const { user_id, email, password, full_name, role, phone, report_permissions } = await req.json();

  if (!user_id) {
    return new Response(JSON.stringify({ error: "user_id obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = getSupabaseAdmin();

  const updateData: any = {};
  if (email) updateData.email = email;
  if (password) updateData.password = password;
  const metadata: any = {};
  if (full_name) metadata.full_name = full_name;
  if (phone !== undefined) metadata.phone = phone;
  if (Object.keys(metadata).length > 0) updateData.user_metadata = metadata;

  if (Object.keys(updateData).length > 0) {
    const { error } = await admin.auth.admin.updateUserById(user_id, updateData);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Update profile name
  if (full_name) {
    await admin.from("profiles").update({ full_name }).eq("user_id", user_id);
  }

  // Update role
  if (role) {
    await admin.from("user_roles").delete().eq("user_id", user_id);
    if (role === "admin") {
      await admin.from("user_roles").insert({ user_id, role: "admin" });
    }
  }
  if (Array.isArray(report_permissions)) {
    await admin.from("user_report_permissions").delete().eq("user_id", user_id);
    if (report_permissions.length) {
      await admin.from("user_report_permissions").insert(report_permissions.map((report_key: string) => ({ user_id, report_key })));
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function deleteUser(req: Request) {
  const adminUserId = await verifyAdmin(req.headers.get("Authorization"));
  const { user_id } = await req.json();

  if (!user_id) {
    return new Response(JSON.stringify({ error: "user_id obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (user_id === adminUserId) {
    return new Response(JSON.stringify({ error: "Não é possível excluir a si mesmo" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(user_id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    switch (path) {
      case "list": return await listUsers(req);
      case "create": return await createUser(req);
      case "update": return await updateUser(req);
      case "delete": return await deleteUser(req);
      default:
        return new Response(JSON.stringify({ error: "Endpoint não encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    console.error("User management error:", err);
    const status = err.message?.includes("Unauthorized") ? 401 : err.message?.includes("Forbidden") ? 403 : 500;
    return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
