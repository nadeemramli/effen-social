import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — EFFEN Studio" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="tally-dot" aria-hidden />
          <span className="font-display text-2xl font-bold tracking-tight">
            EFFEN
          </span>
          <span className="text-muted-foreground mt-1 text-xs uppercase tracking-[0.2em]">
            Content Studio
          </span>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
