"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { supabase, signInWithGoogle } from "@/lib/client";

const NAV = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/upload", label: "Scan", icon: "📷" },
  { href: "/timeline", label: "Timeline", icon: "🗂️" },
  { href: "/agent", label: "Sehat AI", icon: "✨" },
  { href: "/share", label: "Share", icon: "🔗" },
];

export function Logo() {
  return (
    <span className="font-display text-xl font-extrabold text-brand-ink">
      Sehat<span className="text-brand">Vault</span>
    </span>
  );
}

export function SignIn() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <Logo />
      <h1 className="font-display text-4xl font-extrabold leading-tight text-brand-ink">
        Your health history.
        <br />
        Your ownership. Your control.
      </h1>
      <p className="text-slate-600">
        Scan prescriptions and reports, let your AI agent organise them, and share them with any doctor through one QR code.
      </p>
      <button onClick={() => signInWithGoogle()} className="btn-primary">
        Continue with Google
      </button>
      <p className="text-xs text-slate-500">Prototype on Avalanche Fuji testnet. Use sample data only. Not medical advice.</p>
    </div>
  );
}

export default function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");
  const path = usePathname();

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => setState(data.session ? "in" : "out"));
    const { data: sub } = supabase().auth.onAuthStateChange((_e, s) => setState(s ? "in" : "out"));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (state === "loading") return <div className="grid min-h-dvh place-items-center text-slate-500">Loading…</div>;
  if (state === "out") return <SignIn />;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-teal-100 bg-white/90 px-4 py-3 backdrop-blur">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/privacy" className="text-slate-600 hover:text-brand">
            Privacy
          </Link>
          <button onClick={() => supabase().auth.signOut()} className="text-slate-600 hover:text-brand">
            Sign out
          </button>
        </div>
      </header>
      <main className="px-4 py-5">
        {title && <h1 className="mb-4 font-display text-2xl font-extrabold text-brand-ink">{title}</h1>}
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-teal-100 bg-white">
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex flex-col items-center py-2 text-xs ${path?.startsWith(n.href) ? "text-brand font-semibold" : "text-slate-500"}`}
            >
              <span className="text-lg">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
