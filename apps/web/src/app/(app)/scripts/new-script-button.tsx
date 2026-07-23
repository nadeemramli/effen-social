"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createBlankScript } from "./actions";

export function NewScriptButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createBlankScript();
          if (res.ok && res.scriptId)
            router.push(`/scripts/${res.scriptId}/wizard`);
          else toast.error(res.error ?? "Could not create a script.");
        })
      }
    >
      {pending ? "Creating…" : "New script"}
    </Button>
  );
}
