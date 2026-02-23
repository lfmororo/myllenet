import EfiApiLogTable from "@/components/EfiApiLogTable";

export default function EfiLogsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Logs EFI</h2>
        <p className="text-muted-foreground">Registros de chamadas à API EFI</p>
      </div>
      <EfiApiLogTable />
    </div>
  );
}
