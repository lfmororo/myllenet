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
        // Usamos uma chave de tempo com precisão de 30 segundos para agrupar logs do agente que podem variar ligeiramente
        const seconds = dateObj.getSeconds();
        const roundedSeconds = seconds < 30 ? "00" : "30";
        const timeKey = dateObj.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' }) + ":" + roundedSeconds;
        const displayTime = dateObj.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        if (!grouped[timeKey]) grouped[timeKey] = { time: displayTime, fullDate: dateObj };
        
        // Limite de sanidade: descarta picos irreais (>2 Gbps) vindos de contadores resetados ou erro de relatório
        const clamp = (mbps: number) => (!isFinite(mbps) || mbps < 0 || mbps > 2000 ? 0 : mbps);

        const rx_bps = Number(log.rx_bps || 0);
        const rx_bytes = Number(log.rx_bytes || 0);
        let calculatedDownload = rx_bps / 1_000_000;
        
        // Se rx_bps está zerado ou muito baixo, mas temos rx_bytes, verificamos se é um log de speedtest
        // Logs de speedtest salvam o total baixado em rx_bytes
        if ((calculatedDownload <= 0.1) && rx_bytes > 0) {
          // A função mikrotik-speedtest usa 3s como padrão
          calculatedDownload = (rx_bytes * 8) / (3 * 1000 * 1000);
        }
        
        const iface = log.interface_name;
        // Prioritize data: if we already have a value for this interface in this time slot, don't overwrite if it's 0
        const currentDownload = grouped[timeKey][`${iface} ↓`] || 0;
        const currentUpload = grouped[timeKey][`${iface} ↑`] || 0;

        const newDownload = clamp(calculatedDownload);
        const newUpload = clamp(Number(log.tx_bps || 0) / 1_000_000);

        if (newDownload > currentDownload) grouped[timeKey][`${iface} ↓`] = newDownload;
        if (newUpload > currentUpload) grouped[timeKey][`${iface} ↑`] = newUpload;
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
