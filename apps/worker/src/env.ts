import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// The worker shares the repo-root env files with the web app.
const root = resolve(process.cwd(), "..", "..");
loadDotenv({ path: resolve(root, ".env.development.local") });
loadDotenv({ path: resolve(root, ".env.local") });
loadDotenv({ path: resolve(root, ".env") });

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(10, "The worker requires SUPABASE_SECRET_KEY (service role)"),
  EFFEN_MODE: z.enum(["mock", "live"]).default("mock"),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  EFFEN_STORAGE: z.enum(["local", "r2"]).default("local"),
  EFFEN_LOCAL_STORAGE_DIR: z.string().default("./data/storage"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  WORKER_STEP_DELAY_MS: z.coerce.number().default(1200),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[worker] invalid environment:");
  for (const issue of parsed.error.issues)
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const repoRoot = root;
export const storageDir = resolve(root, env.EFFEN_LOCAL_STORAGE_DIR);
