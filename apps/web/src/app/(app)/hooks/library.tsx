"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HOOK_CATEGORIES,
  hookCategoryLabel,
  type HookCategory,
  type HookItem,
} from "./categories";
import { createHook, updateHook, deleteHook } from "./actions";

interface HookForm {
  mechanism: string;
  category: string;
  example: string;
  notes: string;
}

const EMPTY_FORM: HookForm = {
  mechanism: "",
  category: "",
  example: "",
  notes: "",
};

export function HookLibrary({ hooks }: { hooks: HookItem[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HookItem | null>(null);
  const [form, setForm] = useState<HookForm>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<HookItem | null>(null);
  const [pending, startTransition] = useTransition();

  // Filter lives in the URL so returning to the page restores it.
  const category = params.get("category") ?? "all";

  function setCategoryFilter(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete("category");
    else next.set("category", value);
    const qs = next.toString();
    router.replace(qs ? `/hooks?${qs}` : "/hooks", { scroll: false });
  }

  const filtered = useMemo(
    () =>
      category === "all" ? hooks : hooks.filter((h) => h.category === category),
    [hooks, category],
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(hook: HookItem) {
    setEditing(hook);
    setForm({
      mechanism: hook.mechanism,
      category: hook.category,
      example: hook.example ?? "",
      notes: hook.notes,
    });
    setDialogOpen(true);
  }

  function submit() {
    if (form.mechanism.trim().length < 10) {
      toast.error("Describe the mechanism in at least 10 characters.");
      return;
    }
    if (!(HOOK_CATEGORIES as readonly string[]).includes(form.category)) {
      toast.error("Pick a category.");
      return;
    }
    startTransition(async () => {
      const input = {
        mechanism: form.mechanism.trim(),
        category: form.category as HookCategory,
        example: form.example.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      const res = editing
        ? await updateHook(editing.id, input)
        : await createHook(input);
      if (res.ok) {
        toast.success(editing ? "Hook updated" : "Hook saved to your library");
        setDialogOpen(false);
        setEditing(null);
        setForm(EMPTY_FORM);
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not save the hook.");
      }
    });
  }

  function confirmDelete() {
    const hook = deleting;
    if (!hook) return;
    startTransition(async () => {
      const res = await deleteHook(hook.id);
      if (res.ok) {
        toast.success("Hook deleted");
        setDeleting(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not delete the hook.");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hook library</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {hooks.length === 0
              ? "Reusable hook mechanisms you can apply to any topic."
              : `${hooks.length} hook${hooks.length === 1 ? "" : "s"} saved`}
          </p>
        </div>
        <Button onClick={openCreate} aria-label="Save a hook">
          Save a hook
        </Button>
      </div>

      {hooks.length === 0 ? (
        <div className="border-border mt-10 rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-lg font-semibold">
            Build a library of reusable hooks
          </p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Saved hooks are abstract, reusable mechanisms — descriptions of what
            an opening does to the viewer, so you can re-apply the pattern to
            any topic. Source quotes don&apos;t belong here: capture the
            mechanism, never the original wording.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            Save a hook
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center gap-2">
            <Select value={category} onValueChange={setCategoryFilter}>
              <SelectTrigger
                className="h-9 w-48"
                aria-label="Filter by category"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {HOOK_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {hookCategoryLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium">
                No hooks in this category yet
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setCategoryFilter("all")}
              >
                Show all categories
              </Button>
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((h) => (
                <li
                  key={h.id}
                  className="bg-card border-border flex flex-col rounded-lg border p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="secondary">
                      {hookCategoryLabel(h.category)}
                    </Badge>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(h)}
                        aria-label={`Edit hook: ${h.mechanism.slice(0, 60)}`}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(h)}
                        aria-label={`Delete hook: ${h.mechanism.slice(0, 60)}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium leading-snug">
                    {h.mechanism}
                  </p>
                  {h.example && (
                    <div className="mt-3">
                      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                        Example (original)
                      </p>
                      <p className="mt-0.5 text-sm italic">{h.example}</p>
                    </div>
                  )}
                  {h.notes && (
                    <p className="text-muted-foreground mt-3 text-sm">
                      {h.notes}
                    </p>
                  )}
                  {h.sourceVideo && (
                    <p className="mt-auto pt-3 text-xs">
                      <Link
                        href={`/videos/${h.sourceVideo.id}`}
                        className="text-muted-foreground hover:text-foreground hover:underline"
                      >
                        From analysis: {h.sourceVideo.title ?? "Untitled video"}
                      </Link>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDialogOpen(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit hook" : "Save a hook"}</DialogTitle>
            <DialogDescription>
              Hooks are stored as abstract, reusable mechanisms — never copied
              source wording.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="hook-mechanism">Mechanism</Label>
              <Textarea
                id="hook-mechanism"
                value={form.mechanism}
                onChange={(e) =>
                  setForm((f) => ({ ...f, mechanism: e.target.value }))
                }
                rows={3}
                aria-label="Hook mechanism"
              />
              <p className="text-muted-foreground text-xs">
                Describe the mechanism abstractly — what it does to the viewer,
                not the exact words
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-category">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger
                  id="hook-category"
                  className="w-full"
                  aria-label="Hook category"
                >
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {hookCategoryLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-example">
                Original example (optional — write your own, never a source
                quote)
              </Label>
              <Input
                id="hook-example"
                value={form.example}
                onChange={(e) =>
                  setForm((f) => ({ ...f, example: e.target.value }))
                }
                aria-label="Original example"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-notes">Notes</Label>
              <Textarea
                id="hook-notes"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={2}
                aria-label="Notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={pending}
              aria-label={editing ? "Save changes" : "Save hook"}
            >
              {pending ? "Saving…" : editing ? "Save changes" : "Save hook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this hook?</DialogTitle>
            <DialogDescription>
              This permanently removes the mechanism
              {deleting
                ? ` “${deleting.mechanism.slice(0, 80)}${deleting.mechanism.length > 80 ? "…" : ""}”`
                : ""}{" "}
              from your library. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleting(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
              aria-label="Confirm delete hook"
            >
              {pending ? "Deleting…" : "Delete hook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
