import type { ReactNode } from "react";
import { AuthGate } from "../../components/providers";
export default function BookingsLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
