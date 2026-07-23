import { expect, test } from "@playwright/test";

/**
 * Provider-outage drill. Run with the dev server started under
 * EFFEN_MOCK_OUTAGE=tiktok — the TikTok mock provider then throws
 * provider_down, and the app must save the video, mark it retryable, and
 * explain what happened instead of losing the input.
 */

const runId = Date.now().toString(36);

test("a provider outage yields a visible, retryable failure — not data loss", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Email").fill(`e2e-outage-${runId}@example.com`);
  await page.getByLabel("Password").fill("e2e-password-1234");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/videos");

  // TikTok ingestion is off by default (policy) — enable it to reach the outage path.
  await page.goto("/settings");
  await page.getByLabel(/tiktok via apify/i).click();
  await expect(page.getByText(/tiktok via apify enabled/i)).toBeVisible({
    timeout: 15_000,
  });

  await page.goto("/add");
  await page
    .getByLabel(/video link/i)
    .fill("https://www.tiktok.com/@some.creator/video/7301234567890123456");
  await page.getByRole("button", { name: /add video/i }).click();

  await expect(page.getByText(/couldn't add this video/i)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/simulated provider outage/i)).toBeVisible();
  await expect(page.getByText(/marked retryable/i)).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/14-provider-outage.png",
    fullPage: true,
  });

  // The video row exists in a retryable state with a Retry affordance.
  await page.getByRole("link", { name: /its detail page/i }).click();
  await page.waitForURL("**/videos/**");
  await expect(
    page.getByText(/failed — retry available/i).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^retry$/i })).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/15-outage-retryable.png",
    fullPage: true,
  });
});
