import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export interface WorkspaceContext {
  userId: string;
  userEmail: string | null;
  workspaceId: string;
  workspaceName: string;
}

/**
 * Resolve the signed-in user's workspace, or redirect to /login.
 * Every server action and page in the app shell goes through this; combined with
 * RLS it gives defense-in-depth on workspace ownership.
 */
export const requireWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error || !membership) {
    // Bootstrap trigger should have created this; treat absence as a broken session.
    redirect("/login?error=no-workspace");
  }

  const ws = membership.workspaces as unknown as { name: string } | null;
  return {
    userId: user.id,
    userEmail: user.email ?? null,
    workspaceId: membership.workspace_id,
    workspaceName: ws?.name ?? "Workspace",
  };
});

/** Assert a row belongs to the current workspace; use before acting on client-supplied ids. */
export function assertWorkspaceRow<T extends { workspace_id: string }>(
  row: T | null,
  workspaceId: string,
): T {
  if (!row || row.workspace_id !== workspaceId) {
    throw new Error("Not found");
  }
  return row;
}

export async function writeAudit(
  workspaceId: string,
  userId: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.from("audit_log").insert({
    workspace_id: workspaceId,
    user_id: userId,
    action,
    detail,
  });
}
