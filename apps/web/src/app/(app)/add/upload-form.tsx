"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { createUploadTarget, finalizeUpload } from "./actions";

type Phase = "idle" | "signing" | "uploading" | "finalizing" | "done" | "error";

export function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  async function handleFile(file: File) {
    setPhase("signing");
    setError(null);
    setProgress(0);
    try {
      const target = await createUploadTarget(file.name, file.type, file.size);
      if (!target.ok || !target.url || !target.videoId || !target.key) {
        throw new Error(target.error ?? "Could not prepare the upload.");
      }
      setVideoId(target.videoId);
      setPhase("uploading");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", target.url!);
        for (const [k, v] of Object.entries(target.headers ?? {}))
          xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });

      setPhase("finalizing");
      const fin = await finalizeUpload(
        target.videoId,
        target.key,
        file.type,
        file.size,
      );
      if (!fin.ok)
        throw new Error(fin.error ?? "Could not finalize the upload.");
      setPhase("done");
      toast.success("Upload complete", {
        description: "The video is in your library, ready to analyze.",
      });
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <Label htmlFor="upload-file">Video file</Label>
          <Input
            id="upload-file"
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            disabled={
              phase === "uploading" ||
              phase === "finalizing" ||
              phase === "signing"
            }
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <p className="text-muted-foreground text-xs">
            MP4, MOV, or WebM up to 500 MB and 15 minutes. Only upload footage
            you have the rights to analyze. Files go straight to storage via a
            short-lived signed URL.
          </p>
        </div>

        {(phase === "uploading" || phase === "finalizing") && (
          <div className="space-y-1.5" role="status" aria-live="polite">
            <Progress value={phase === "finalizing" ? 100 : progress} />
            <p className="text-muted-foreground text-xs">
              {phase === "uploading"
                ? `Uploading… ${progress}%`
                : "Verifying upload…"}
            </p>
          </div>
        )}

        {phase === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>
              {error}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setPhase("idle");
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {phase === "done" && videoId && (
          <Alert>
            <AlertTitle>Upload complete</AlertTitle>
            <AlertDescription>
              <Link className="underline" href={`/videos/${videoId}`}>
                Open the video
              </Link>{" "}
              to select it for analysis, or upload another file.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
