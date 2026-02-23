import { useAuth } from "@/hooks/useAuth";
import { Navigate, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
} from "lucide-react";
import logoImg from "@/assets/logo.png";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Cobranças", url: "/cobrancas", icon: FileText },
  { title: "Notificações", url: "/notificacoes", icon: Bell },
  { title: "Logs EFI", url: "/logs-efi", icon: AlertTriangle },
  { title: "Configurações", url: "/settings", icon: Settings },
];

function AppSidebar() {
  const { signOut, user } = useAuth();

  return (
    <Sidebar className="border-r bg-card">
      <div className="flex items-center gap-3 px-4 py-4 border-b">
        <img src={logoImg} alt="MylleNet" className="h-9 w-9 rounded-lg object-contain" />
        <div className="overflow-hidden">
          <h1 className="text-lg font-bold leading-tight truncate">Myllenet</h1>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </div>
      </div>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase text-muted-foreground px-3 mb-1">Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                      activeClassName="bg-primary/10 text-primary font-semibold"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="mt-auto border-t p-3">
        <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </Sidebar>
  );
}

export default function AppLayout() {
  const { user, isAdmin, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
          <p className="text-muted-foreground">
            Sua conta não possui permissão de administrador.
          </p>
          <Button variant="outline" onClick={() => {}}>Sair</Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="border-b bg-card sticky top-0 z-10 h-14 flex items-center px-4 gap-3">
            <SidebarTrigger />
          </header>
          <main className="flex-1 container mx-auto px-4 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
