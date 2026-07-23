"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toggleProvider, type ToggleableProvider } from "./actions";

export interface ProvidersState {
  manual_upload: boolean;
  youtube_official: boolean;
  instagram_apify: boolean;
  tiktok_apify: boolean;
}

const PROVIDERS: {
  key: ToggleableProvider;
  label: string;
  unofficial: boolean;
}[] = [
  {
    key: "youtube_official",
    label: "YouTube (official API)",
    unofficial: false,
  },
  { key: "instagram_apify", label: "Instagram via Apify", unofficial: true },
  { key: "tiktok_apify", label: "TikTok via Apify", unofficial: true },
];

export function ProviderToggles({ initial }: { initial: ProvidersState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<ToggleableProvider | null>(null);
  const [pending, startTransition] = useTransition();

  function onToggle(key: ToggleableProvider, enabled: boolean) {
    setError(null);
    setPendingKey(key);
    const previous = state[key];
    setState((s) => ({ ...s, [key]: enabled }));
    startTransition(async () => {
      const res = await toggleProvider(key, enabled);
      setPendingKey(null);
      if (res.ok) {
        const label = PROVIDERS.find((p) => p.key === key)?.label ?? key;
        toast.success(`${label} ${enabled ? "enabled" : "disabled"}`);
        router.refresh();
      } else {
        setState((s) => ({ ...s, [key]: previous }));
        setError(res.error ?? "Could not update the provider.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not update provider</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ul className="divide-border divide-y">
        <li className="flex items-center justify-between gap-4 py-3 first:pt-0">
          <div>
            <Label htmlFor="provider-manual_upload">Manual upload</Label>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Always available — your own files never need a provider.
            </p>
          </div>
          <Switch
            id="provider-manual_upload"
            checked
            disabled
            aria-label="Manual upload (always on)"
          />
        </li>
        {PROVIDERS.map((p) => (
          <li
            key={p.key}
            className="flex items-center justify-between gap-4 py-3 last:pb-0"
          >
            <div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`provider-${p.key}`}>{p.label}</Label>
                {p.unofficial && (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground text-[11px]"
                  >
                    Unofficial — optional
                  </Badge>
                )}
              </div>
            </div>
            <Switch
              id={`provider-${p.key}`}
              checked={state[p.key]}
              disabled={pending && pendingKey === p.key}
              onCheckedChange={(checked) => onToggle(p.key, checked === true)}
              aria-label={p.label}
            />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        Disabling a provider blocks new ingestion from it; existing research
        stays available.
      </p>
    </div>
  );
}
