import NotificationLogTable from "@/components/NotificationLogTable";

export default function NotificationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Notificações</h2>
        <p className="text-muted-foreground">Histórico de notificações enviadas</p>
      </div>
      <NotificationLogTable />
    </div>
  );
}
