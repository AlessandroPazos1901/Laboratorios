import { expect, test } from "@playwright/test";

test("publica un manifest instalable y un fallback sin datos clínicos", async ({ page, context }) => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect(await manifest.json()).toMatchObject({ display: "standalone", start_url: "/app" });

  await page.goto("/offline");
  await expect(page.getByText(/modo offline|continuidad operativa/i).first()).toBeVisible();

  // The first visit installs the worker, but it does not control that same
  // navigation. Wait for installation and reload once online so the offline
  // assertion exercises a controlled page instead of racing registration.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBeTruthy();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/modo offline|continuidad operativa/i).first()).toBeVisible();
});
