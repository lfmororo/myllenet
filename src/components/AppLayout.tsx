import { useAuth } from "@/hooks/useAuth";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import {
  LayoutDashboard,
  Users,
  FileText,
  Bell,
  AlertTriangle,
  Settings,
  LogOut,
  Loader2,
  ShieldAlert,
  Router,
  GitCompare,
} from "lucide-react";
import logoImg from "@/assets/logo.png";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Cobranças", url: "/cobrancas", icon: FileText },
  { title: "Notificações", url: "/notificacoes", icon: Bell },
  { title: "R3005G", url: "/r3005g", icon: Router },
  { title: "Comparação PPPoE", url: "/pppoe-compare", icon: GitCompare },
  { title: "Logs EFI", url: "/logs-efi", icon: AlertTriangle },
  { title: "Configurações", url: "/settings", icon: Settings },
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/clientes": "Clientes",
  "/cobrancas": "Cobranças",
  "/notificacoes": "Notificações",
  "/r3005g": "R3005G - PPPoE",
  "/pppoe-compare": "Comparação PPPoE",
  "/logs-efi": "Logs EFI",
  "/settings": "Configurações",
};

function AppSidebar() {
  const { signOut, user } = useAuth();

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
      {/* Logo area */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <img src={logoImg} alt="MylleNet" className="h-10 w-10 rounded-xl object-contain drop-shadow-lg" />
        <div className="overflow-hidden">
          <h1 className="text-base font-bold leading-tight truncate tracking-wide text-sidebar-primary">Myllenet</h1>
          <p className="text-[11px] text-sidebar-foreground/60 truncate">{user?.email}</p>
        </div>
      </div>

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <p className="text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40 px-3 mb-2">Navegação</p>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      activeClassName="bg-sidebar-primary/15 text-sidebar-primary font-semibold shadow-sm"
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="mt-auto border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent text-[13px] rounded-lg"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </Sidebar>
  );
}

export default function AppLayout() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const location = useLocation();
  const currentTitle = pageTitles[location.pathname] || "";

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <img src={logoImg} alt="MylleNet" className="h-14 w-14 rounded-xl object-contain animate-pulse" />
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="mx-auto h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-bold">Acesso Restrito</h1>
          <p className="text-muted-foreground">Sua conta não possui permissão de administrador.</p>
          <Button variant="outline" onClick={signOut}>Sair</Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10 h-14 flex items-center px-6 gap-4">
            <SidebarTrigger />
            <h2 className="text-sm font-semibold text-foreground/80">{currentTitle}</h2>
          </header>
          <main className="flex-1 px-6 py-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
