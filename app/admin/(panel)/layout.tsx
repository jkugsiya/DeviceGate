import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Nav } from "../_components/nav";
import { SignOutButton } from "../_components/sign-out-button";

export default async function PanelLayout({ children }: LayoutProps<"/admin">) {
  const { user } = await requireAdmin();
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-2.5">
          <Link href="/admin" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
              DG
            </span>
            <span className="hidden sm:inline">DeviceGate</span>
          </Link>
          <Nav />
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden md:inline">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
