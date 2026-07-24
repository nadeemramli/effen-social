import { redirect } from "next/navigation";

/**
 * Root route. Some auth emails land here with ?code=… when the Supabase Site
 * URL points at the app root — forward those to the callback exchange.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  redirect("/videos");
}
