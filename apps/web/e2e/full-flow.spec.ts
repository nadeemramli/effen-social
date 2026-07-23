import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

/**
 * End-to-end vertical slice: auth → persona → ingest (URL + upload + duplicate)
 * → bulk analysis (cost confirm) → pipeline completion → analysis detail →
 * ideas → wizard → script editor → export → budget block → cross-workspace
 * denial. Runs against the dev server + local Supabase + worker, all in mock
 * AI mode (zero external spend).
 */

const runId = Date.now().toString(36);
const USER_A = {
  email: `e2e-a-${runId}@example.com`,
  password: "e2e-password-1234",
};
const USER_B = {
  email: `e2e-b-${runId}@example.com`,
  password: "e2e-password-1234",
};

// A real 11-char YouTube id keeps classifyUrl happy; mock mode never calls YouTube.
const YT_URL = `https://www.youtube.com/watch?v=dQw4w9WgXcQ`;

async function signUp(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/videos", { timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

let videoAUrl: string; // detail URL of the analyzed video, reused in the cross-workspace test

test("signup lands in an empty library with mock-mode badge", async ({
  page,
}) => {
  await signUp(page, USER_A);
  await expect(page.getByText("Mock mode")).toBeVisible();
  await expect(page.getByText("Start your research library")).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/01-empty-library.png",
    fullPage: true,
  });
});

test("persona can be created and versioned", async ({ page }) => {
  await signUp(page, USER_A).catch(async () => {
    // Already registered from the previous test — sign in instead.
    await page.goto("/login");
    await page.getByLabel("Email").fill(USER_A.email);
    await page.getByLabel("Password").fill(USER_A.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("**/videos");
  });
  await page.goto("/persona");
  await page
    .getByLabel(/name/i)
    .first()
    .fill("Evidence-first creator educator");
  await page
    .getByLabel(/audience/i)
    .first()
    .fill("Early-stage creators who want data-backed growth advice");
  const voice = page.getByLabel(/voice/i).first();
  if (await voice.isVisible().catch(() => false))
    await voice.fill("Direct, warm, allergic to hype");
  await page
    .getByRole("button", { name: /save|create/i })
    .first()
    .click();
  await expect(page.getByText(/saved|created/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: "test-results/screens/02-persona.png",
    fullPage: true,
  });
});

test("URL ingestion collects metadata; duplicates are refused", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  await page.goto("/add");
  await page.getByLabel(/video link/i).fill(YT_URL);
  await page.getByRole("button", { name: /add video/i }).click();
  await expect(page.getByText(/^Added$/)).toBeVisible({ timeout: 20_000 });

  // Same URL again → duplicate prevention.
  await page.getByLabel(/video link/i).fill(YT_URL);
  await page.getByRole("button", { name: /add video/i }).click();
  await expect(page.getByText(/already in your library/i)).toBeVisible({
    timeout: 20_000,
  });
  await page.screenshot({
    path: "test-results/screens/03-duplicate.png",
    fullPage: true,
  });
});

test("direct upload stores the file and reaches metadata_ready", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  await page.goto("/add");
  await page.getByRole("tab", { name: /upload a file/i }).click();
  await page
    .getByLabel(/video file/i)
    .setInputFiles(join(__dirname, "fixtures", "sample.mp4"));
  await expect(page.getByText(/upload complete/i).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({
    path: "test-results/screens/04-upload.png",
    fullPage: true,
  });
});

test("bulk analysis with cost confirmation completes the pipeline", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  // Select all videos in list view and start analysis.
  await page.getByRole("button", { name: /^list$/i }).click();
  await page.getByLabel("Select all").check();
  await page.getByRole("button", { name: /analyze selected/i }).click();
  await expect(page.getByRole("dialog")).toContainText(/estimated cost/i);
  await page.screenshot({ path: "test-results/screens/05-cost-confirm.png" });
  await page.getByRole("button", { name: /start analysis/i }).click();
  await expect(page.getByText(/analysis started/i)).toBeVisible({
    timeout: 20_000,
  });

  // Wait for the worker to finish both videos.
  await expect
    .poll(
      async () => {
        await page.goto("/videos?state=analyzed&view=list");
        return page.getByRole("row").count();
      },
      { timeout: 240_000, intervals: [4000] },
    )
    .toBeGreaterThan(2); // header + 2 videos

  await page.screenshot({
    path: "test-results/screens/06-analyzed-library.png",
    fullPage: true,
  });
});

test("analysis detail shows evidence-grounded output; notes are user-owned", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  await page.goto("/videos?state=analyzed&view=list");
  await page.getByRole("row").nth(1).getByRole("link").first().click();
  await page.waitForURL("**/videos/**");
  videoAUrl = page.url();

  await expect(page.getByText(/mock ai output|cached result/i)).toBeVisible();
  await expect(page.getByRole("tab", { name: /transcript/i })).toBeVisible();
  await page.getByRole("tab", { name: /transcript/i }).click();
  await expect(page.locator("button.timecode").first()).toBeVisible();

  await page.getByRole("tab", { name: /structure/i }).click();
  await expect(
    page.getByText(/source evidence \(do not reuse\)/i),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /save mechanism to hook library/i })
    .click();
  await expect(page.getByText(/hook mechanism saved/i)).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("tab", { name: /my notes/i }).click();
  await page
    .getByLabel(/personal notes/i)
    .fill("The single-variable framing is the steal here.");
  await page.getByRole("button", { name: /save notes/i }).click();
  await expect(page.getByText(/notes saved/i)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: "test-results/screens/07-analysis-detail.png",
    fullPage: true,
  });
});

test("ideas can be shortlisted and converted into a script", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  await page.goto("/ideas");
  await expect(page.getByRole("tab", { name: /inbox/i })).toContainText(
    /[1-9]/,
  );
  await page
    .getByRole("button", { name: /develop into script/i })
    .first()
    .click();
  await page.waitForURL("**/scripts/**/wizard", { timeout: 30_000 });
  await page.screenshot({
    path: "test-results/screens/08-wizard-topic.png",
    fullPage: true,
  });
});

test("wizard walks Topic → Research → Hook → Script without losing data", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  await page.goto("/scripts");
  await page
    .getByRole("link")
    .filter({ hasText: /wizard|untitled|test|30-day|one-variable|flops/i })
    .first()
    .click();
  await page.waitForURL("**/wizard");

  // Topic
  const topicField = page.getByLabel(/^topic$/i);
  await topicField.fill("The one-variable rule for better hooks");
  await page.getByRole("button", { name: /save.*research/i }).click();

  // Research
  await page.getByRole("button", { name: /run research/i }).click();
  await expect(page.getByText(/angle summary/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/needs verification/i).first()).toBeVisible();

  // Backward nav must preserve the topic.
  await page.getByRole("button", { name: /← topic/i }).click();
  await expect(page.getByLabel(/^topic$/i)).toHaveValue(/one-variable/i);
  await page.getByRole("button", { name: /save.*research/i }).click();
  await page.getByRole("button", { name: /continue to hooks/i }).click();

  // Hooks
  await page.getByRole("button", { name: /generate hooks/i }).click();
  await expect(page.getByRole("radio").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("radio").first().click();
  await expect(page.getByText(/hook selected/i)).toBeVisible();
  await page.getByRole("button", { name: /continue to script/i }).click();

  // Script
  await page.getByRole("button", { name: /generate script/i }).click();
  await page.waitForURL(/\/scripts\/[^/]+$/, { timeout: 60_000 });
  await expect(page.getByText(/claims to verify/i)).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/09-script-editor.png",
    fullPage: true,
  });
});

test("editor: autosave, targeted revision, section regen, versions, export, manual status", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  await page.goto("/scripts");
  await page
    .getByRole("link")
    .filter({ hasText: /v[0-9]/ })
    .first()
    .click();
  await page.waitForURL(/\/scripts\/[^/]+$/);

  // Direct edit + autosave
  const hookBox = page.getByLabel(/hook content/i);
  await hookBox.fill("A hand-edited hook line for the autosave test.");
  await expect(page.getByText(/^Saved$/)).toBeVisible({ timeout: 15_000 });

  // Targeted revision creates a new version
  await page.getByLabel(/revision instruction/i).fill("make it tighter");
  await page.getByRole("button", { name: /^revise$/i }).click();
  await expect(page.getByText(/revision created/i)).toBeVisible({
    timeout: 30_000,
  });

  // Regenerate one section only
  await page
    .getByRole("button", { name: /regenerate section/i })
    .first()
    .click();
  await expect(
    page.getByText(/regenerated \(other sections untouched\)/i),
  ).toBeVisible({ timeout: 30_000 });

  // Version history shows AI and user versions; restore an old one.
  // (Let the post-regen router.refresh settle so the editor doesn't remount mid-click.)
  await page.waitForTimeout(2500);
  await expect(page.getByText(/^v1$/).first()).toBeVisible();
  await page.getByText(/^v1$/).first().click();
  await page.getByRole("button", { name: /restore this version/i }).click();
  const restoreDialog = page.getByRole("dialog");
  await expect(restoreDialog).toBeVisible();
  await restoreDialog.getByRole("button", { name: /^restore$/i }).click();
  await expect(page.getByText(/restored v1/i)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500); // let the post-restore refresh remount settle

  // Export both formats
  const dl1 = page.waitForEvent("download");
  await page.getByRole("button", { name: /export/i }).click();
  await page.getByRole("menuitem", { name: /plain text/i }).click();
  expect((await dl1).suggestedFilename()).toMatch(/\.txt$/);
  const dl2 = page.waitForEvent("download");
  await page.getByRole("button", { name: /export/i }).click();
  await page.getByRole("menuitem", { name: /markdown/i }).click();
  expect((await dl2).suggestedFilename()).toMatch(/\.md$/);

  // Manual status change (never automatic)
  await page.getByLabel(/script status/i).click();
  await page.getByRole("option", { name: /ready/i }).click();
  await expect(page.getByText(/status set to ready/i)).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: "test-results/screens/10-editor-final.png",
    fullPage: true,
  });
});

test("budget caps block analysis visibly and reversibly", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(USER_A.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/videos");

  // Choke the per-run charge cap.
  await page.goto("/settings");
  const capField = page.getByLabel(/per-run.*charge cap/i);
  await capField.fill("0.01");
  await page.getByRole("button", { name: /save/i }).first().click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // Add a fresh video and try to analyze it.
  await page.goto("/add");
  await page.getByLabel(/video link/i).fill("https://youtu.be/9bZkp7q19f0");
  await page.getByRole("button", { name: /add video/i }).click();
  await expect(page.getByText(/^Added$/)).toBeVisible({ timeout: 20_000 });

  await page.goto("/videos?state=unanalyzed");
  await page.getByRole("button", { name: /^list$/i }).click();
  await page.getByLabel("Select all").check();
  await page.getByRole("button", { name: /analyze selected/i }).click();
  await page.getByRole("button", { name: /start analysis/i }).click();
  await expect(page.getByText(/blocked by budget/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.screenshot({
    path: "test-results/screens/11-budget-blocked.png",
    fullPage: true,
  });

  // Restore the cap and confirm ledger has rows.
  await page.goto("/settings");
  await page.getByLabel(/per-run.*charge cap/i).fill("2");
  await page.getByRole("button", { name: /save/i }).first().click();
  await expect(page.getByText(/mock/i).first()).toBeVisible();
  await expect(
    page.getByText(/video_understanding|idea_generation|research/i).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/12-usage-ledger.png",
    fullPage: true,
  });
});

test("cross-workspace access is denied", async ({ page }) => {
  await signUp(page, USER_B);
  // User B visits user A's video detail URL → not found, no data leak.
  await page.goto(videoAUrl);
  await expect(page.getByText(/not found|404/i).first()).toBeVisible({
    timeout: 20_000,
  });
  // And B's library is empty.
  await page.goto("/videos");
  await expect(page.getByText("Start your research library")).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/13-workspace-isolation.png",
    fullPage: true,
  });
});
