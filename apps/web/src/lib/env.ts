import "server-only";
import { z } from "zod";

/**
 * Server-side environment validation. Fails fast at boot with a readable error.
 * Client code may only ever see NEXT_PUBLIC_* values — nothing here is allowed
 * to be imported from a client component ("server-only" enforces that).
 */
const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
    SUPABASE_SECRET_KEY: z.string().optional().default(""),
    EFFEN_MODE: z.enum(["mock", "live"]).default("mock"),
    EFFEN_STORAGE: z.enum(["local", "r2"]).default("local"),
    EFFEN_LOCAL_STORAGE_DIR: z.string().default("./data/storage"),
    EFFEN_SIGNING_SECRET: z.string().min(16),
    R2_ACCOUNT_ID: z.string().optional().default(""),
    R2_ACCESS_KEY_ID: z.string().optional().default(""),
    R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
    R2_BUCKET: z.string().optional().default("effen-media"),
    EFFEN_QUEUE: z.enum(["db", "qstash"]).default("db"),
    QSTASH_TOKEN: z.string().optional().default(""),
    OPENAI_API_KEY: z.string().optional().default(""),
    GEMINI_API_KEY: z.string().optional().default(""),
    YOUTUBE_API_KEY: z.string().optional().default(""),
    APIFY_TOKEN: z.string().optional().default(""),
    APIFY_WEBHOOK_SECRET: z.string().optional().default(""),
  })
  .superRefine((env, ctx) => {
    if (
      env.EFFEN_STORAGE === "r2" &&
      !(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "EFFEN_STORAGE=r2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY",
      });
    }
    if (env.EFFEN_QUEUE === "qstash" && !env.QSTASH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "EFFEN_QUEUE=qstash requires QSTASH_TOKEN",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${detail}\nSee .env.example for reference.`,
    );
  }
  cached = parsed.data;
  return cached;
}

export function isMockMode(): boolean {
  return env().EFFEN_MODE === "mock";
}
