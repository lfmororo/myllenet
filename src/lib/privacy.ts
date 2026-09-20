export function maskCustomerName(value?: string | null): string {
  const parts = (value || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];

  return `${parts[0]} ${parts.slice(1).map((part) => `${part.charAt(0).toUpperCase()}.`).join(" ")}`;
}

export function maskDocument(value?: string | null): string {
  const digits = (value || "").replace(/\D/g, "");

  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  if (digits.length >= 2) return `${"*".repeat(Math.min(digits.length - 2, 12))}${digits.slice(-2)}`;
  return "Não informado";
}

export function maskedCustomerLocation(customer?: {
  bairro?: string | null;
  cidade?: string | null;
} | null): string {
  const location = [customer?.bairro, customer?.cidade].filter(Boolean).join(" - ");
  return location ? `Endereço protegido • ${location}` : "Endereço protegido";
}