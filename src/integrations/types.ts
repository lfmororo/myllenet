export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: "admin" | "user";
  report_permissions: string[];
}
