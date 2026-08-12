import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import AppLayout from "./components/AppLayout";
import DashboardHome from "./pages/DashboardHome";
import CustomersPage from "./pages/CustomersPage";
import BillingPage from "./pages/BillingPage";
import NotificationsPage from "./pages/NotificationsPage";
import EfiLogsPage from "./pages/EfiLogsPage";
import Settings from "./pages/Settings";
import MikrotikPage from "./pages/MikrotikPage";
import InvoiceView from "./pages/InvoiceView";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/fatura/:id" element={<InvoiceView />} />
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<DashboardHome />} />
              <Route path="/clientes" element={<CustomersPage />} />
              <Route path="/cobrancas" element={<BillingPage />} />
              <Route path="/notificacoes" element={<NotificationsPage />} />
              <Route path="/logs-efi" element={<EfiLogsPage />} />
              <Route path="/mikrotik" element={<MikrotikPage />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
