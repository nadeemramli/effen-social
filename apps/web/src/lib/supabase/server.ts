import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/** Session-scoped client for Server Components / Actions / Route Handlers (RLS applies). */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    env().NEXT_PUBLIC_SUPABASE_URL,
    env().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes sessions instead.
          }
        },
      },
    },
  );
}

/**
 * Service-role client (bypasses RLS). Server-only, used by webhook handlers and
 * admin tasks. Throws when SUPABASE_SECRET_KEY is not configured.
 */
export function supabaseAdmin(): SupabaseClient {
  const key = env().SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured — required for this operation.",
    );
  }
  return createClient(env().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
