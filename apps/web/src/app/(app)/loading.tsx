import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared route-transition skeleton for every app tab. Shown instantly on
 * navigation while the target page's server queries run, so the shell never
 * appears frozen.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-border rounded-lg border p-4">
            <Skeleton className="mb-3 aspect-video w-full rounded-md" />
            <Skeleton className="mb-2 h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
