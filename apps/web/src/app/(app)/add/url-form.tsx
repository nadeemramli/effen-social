"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { addVideoByUrl, type AddUrlResult } from "./actions";

export function AddUrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AddUrlResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const res = await addVideoByUrl(url);
      setResult(res);
      if (res.ok && !res.duplicate) {
        toast.success("Video added", {
          description: "Metadata collected. Find it in your library.",
        });
        setUrl("");
      }
    } catch {
      setResult({
        ok: false,
        error: "Something went wrong adding this video. Try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
          <div className="space-y-2">
            <Label htmlFor="video-url">Video link</Label>
            <Input
              id="video-url"
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=… or a Reel / TikTok link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <p className="text-muted-foreground text-xs">
              YouTube uses the official API. Instagram and TikTok scraping are
              optional and can be turned off in Settings — direct upload always
              works.
            </p>
          </div>

          {result && !result.ok && (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t add this video</AlertTitle>
              <AlertDescription>
                {result.error}
                {result.errorKind === "provider_down" && result.videoId && (
                  <span className="mt-1 block">
                    The video is saved and marked retryable — retry it from{" "}
                    <Link
                      className="underline"
                      href={`/videos/${result.videoId}`}
                    >
                      its detail page
                    </Link>{" "}
                    when the provider recovers.
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}
          {result?.ok && result.duplicate && (
            <Alert>
              <AlertTitle>Already in your library</AlertTitle>
              <AlertDescription>
                This video was added before — duplicates are prevented
                automatically.{" "}
                {result.videoId && (
                  <Link
                    className="underline"
                    href={`/videos/${result.videoId}`}
                  >
                    Open it
                  </Link>
                )}
              </AlertDescription>
            </Alert>
          )}
          {result?.ok && !result.duplicate && result.videoId && (
            <Alert>
              <AlertTitle>Added</AlertTitle>
              <AlertDescription>
                Metadata collected.{" "}
                <Link className="underline" href={`/videos/${result.videoId}`}>
                  View the video
                </Link>{" "}
                or add another link.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !url}>
              {pending ? "Fetching metadata…" : "Add video"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/videos")}
            >
              Go to library
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
