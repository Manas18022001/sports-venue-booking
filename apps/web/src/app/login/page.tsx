import { AuthForm } from "../../components/auth-form";
export const metadata = { title: "Welcome back" };
export default function LoginPage() {
  return <AuthForm mode="login" />;
}
