import "server-only";
import type { StorageAdapter } from "@effen/core";
import { env } from "@/lib/env";
import { LocalStorageAdapter } from "./local";
import { R2StorageAdapter } from "./r2";

let instance: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (!instance) {
    instance =
      env().EFFEN_STORAGE === "r2"
        ? new R2StorageAdapter()
        : new LocalStorageAdapter();
  }
  return instance;
}
