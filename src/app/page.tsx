"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/client";
import { SignIn } from "@/components/AppShell";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => data.session && router.replace("/dashboard"));
  }, [router]);
  return <SignIn />;
}
