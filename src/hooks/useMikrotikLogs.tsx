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
        const fullKey = `${dateObj.toISOString()}_${time}`; // Keep uniqueness if needed, or just time
        if (!grouped[time]) grouped[time] = { time, fullDate: dateObj };
        // Download (rx) e Upload (tx) monitorados separadamente, em Mbps
        // O speedtest via 'tool fetch' salva em 'rx_bytes' o total baixado em 3 segundos.
        // Se rx_bps estiver zerado ou ausente, tentamos calcular a partir de rx_bytes (downloaded / 3s)
        const rx_bps = Number(log.rx_bps || 0);
        const rx_bytes = Number(log.rx_bytes || 0);
        let calculatedDownload = rx_bps / 1_000_000;
        
        if (calculatedDownload <= 0 && rx_bytes > 0) {
          calculatedDownload = (rx_bytes * 8) / (3 * 1024 * 1024);
        }
        
        grouped[time][`${log.interface_name} ↓`] = calculatedDownload;
        grouped[time][`${log.interface_name} ↑`] = Number(log.tx_bps || 0) / 1_000_000;

      });
      setWanLogs(Object.values(grouped).reverse().slice(-60));
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
