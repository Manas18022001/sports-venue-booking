import type { ReactNode } from "react";
import { AuthGate } from "../../components/providers";
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AuthGate admin>{children}</AuthGate>;
}
