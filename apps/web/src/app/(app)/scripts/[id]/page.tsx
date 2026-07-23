import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ScriptStatus } from "@effen/core";
import { loadScriptBundle } from "../actions";
import { Editor } from "./editor";

export const metadata = { title: "Script editor — EFFEN Studio" };

export default async function ScriptEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let bundle: Awaited<ReturnType<typeof loadScriptBundle>>;
  try {
    bundle = await loadScriptBundle(id);
  } catch {
    notFound();
  }
  if (bundle.versions.length === 0) redirect(`/scripts/${id}/wizard`);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <Link
          href="/scripts"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← All scripts
        </Link>
        <Link
          href={`/scripts/${id}/wizard`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Back to wizard (topic / research / hook)
        </Link>
      </div>
      <Editor
        // Remount on new versions so client state re-initializes from the server.
        key={bundle.script.current_version as number}
        scriptId={id}
        status={bundle.script.status as ScriptStatus}
        currentVersion={bundle.script.current_version as number}
        versions={bundle.versions}
      />
    </div>
  );
}
