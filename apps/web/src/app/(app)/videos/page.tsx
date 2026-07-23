import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { loadLibrary } from "@/lib/videos";
import { Button } from "@/components/ui/button";
import { Library } from "./library";

export const metadata = { title: "Videos — EFFEN Studio" };

export default async function VideosPage() {
  const ws = await requireWorkspace();
  const videos = await loadLibrary(ws.workspaceId);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Videos</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {videos.length === 0
              ? "Your research library is empty."
              : `${videos.length} video${videos.length === 1 ? "" : "s"} · ${videos.filter((v) => v.hasAnalysis).length} analyzed`}
          </p>
        </div>
        <Button asChild>
          <Link href="/add">Add video</Link>
        </Button>
      </div>

      {videos.length === 0 ? (
        <div className="border-border mt-10 rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-lg font-semibold">
            Start your research library
          </p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Paste a video link or upload a file. Metadata is collected instantly
            and for free — deep analysis only runs on the videos you choose.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild>
              <Link href="/add">Add your first video</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/sources">Watch a creator</Link>
            </Button>
          </div>
        </div>
      ) : (
        <Library videos={videos} />
      )}
    </div>
  );
}
