import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useMikrotikLogs = () => {
  const [wanLogs, setWanLogs] = useState<any[]>([]);
  const [wanHistory, setWanHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWanHistory = async () => {
    const { data, error } = await supabase
      .from('wan_status_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (!error && data) {
      setWanHistory(data);
    }
  };

  const fetchWanLogs = async () => {

    const { data, error } = await supabase
      .from('wan_logs' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(240);
    
    if (!error && data) {
      const grouped: Record<string, any> = {};
      data.forEach((log: any) => {
        const dateObj = new Date(log.created_at);
        const time = dateObj.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        if (!grouped[time]) grouped[time] = { time, fullDate: dateObj };
        
        const rx_bps = Number(log.rx_bps || 0);
        const rx_bytes = Number(log.rx_bytes || 0);
        let calculatedDownload = rx_bps / 1_000_000;
        
        // Se rx_bps está zerado, mas temos rx_bytes, é provavelmente um log de speedtest
        if (calculatedDownload <= 0 && rx_bytes > 0) {
          // A função mikrotik-speedtest usa 3s como padrão agora
          calculatedDownload = (rx_bytes * 8) / (3 * 1000 * 1000);
        }
        
        const iface = log.interface_name;
        grouped[time][`${iface} ↓`] = calculatedDownload;
        grouped[time][`${iface} ↑`] = Number(log.tx_bps || 0) / 1_000_000;
      });
      
      // Ordenar por data e pegar os últimos 60 pontos
      const sorted = Object.values(grouped).sort((a: any, b: any) => a.fullDate.getTime() - b.fullDate.getTime());
      setWanLogs(sorted.slice(-60));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWanLogs();
    fetchWanHistory();
    const channel = supabase
      .channel('wan_updates_mikrotik_page')
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'wan_logs' }, () => {
        fetchWanLogs();
      })
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'wan_status_history' }, () => {
        fetchWanHistory();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return { wanLogs, wanHistory, loading };
};
