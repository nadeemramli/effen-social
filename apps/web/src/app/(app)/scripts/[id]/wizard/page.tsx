import { notFound } from "next/navigation";
import Link from "next/link";
import { loadScriptBundle } from "../../actions";
import { Wizard } from "./wizard";

export const metadata = { title: "Script wizard — EFFEN Studio" };

export default async function WizardPage({
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
  const s = bundle.script;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/scripts"
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← All scripts
      </Link>
      <Wizard
        scriptId={id}
        initialStage={s.stage}
        topic={
          (s.topic as {
            topic?: string;
            angle?: string;
            audience?: string;
            notes?: string;
          } | null) ?? null
        }
        research={bundle.research}
        hook={
          (s.hook as {
            options?: Array<{
              text: string;
              mechanism: string;
              category: string;
              rationale: string;
            }>;
            selected?: string;
          } | null) ?? null
        }
        hasDraft={bundle.versions.length > 0}
      />
    </div>
  );
}
