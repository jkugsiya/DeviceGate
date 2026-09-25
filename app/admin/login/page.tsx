import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/admin";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/admin");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
