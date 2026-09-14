import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

interface FixtureControl {
  fail: boolean;
  stall: boolean;
  advance: () => void;
  startAgain: () => void;
  scheduleAgain: () => void;
  complete: () => void;
  requests: Array<{ model: string }>;
}

const route: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/network-devices/discovery";
const screenshots: string = path.resolve(
  __dirname,
  "../../output/playwright/discovery",
);

async function openPage(page: Page): Promise<void> {
  await page.goto(route);
  await expect(
    page.getByText("Discovery Scans", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toBeVisible();
}

test("shows live large-range progress, zero-response progress and retained partial results", async ({
  page,
}: {
  page: Page;
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
  await openPage(page);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(active).toContainText("6,144 of 15,360 addresses swept");
  await expect(active).toContainText("Running for");
  const actionBox: Awaited<ReturnType<Locator["boundingBox"]>> = await active
    .getByRole("button", { name: /Review/ })
    .boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(1440);
  const rowBox: Awaited<ReturnType<Locator["boundingBox"]>> =
    await active.boundingBox();
  expect(rowBox!.height).toBeLessThan(260);
  const silent: Locator = page
    .getByRole("row")
    .filter({ hasText: "Branch offices" });
  await expect(silent.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "37",
  );
  await expect(silent).toContainText("96 of 254 addresses swept");
  await page.screenshot({
    path: path.join(screenshots, "discovery-progress-desktop.png"),
    fullPage: true,
  });

  const failed: Locator = page
    .getByRole("row")
    .filter({ hasText: "Remote office — Partial results" });
  await failed.getByRole("button", { name: /Review/ }).click();
  await expect(page.getByText("WBHQ-Core-01", { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "discovery-partial-results.png"),
    fullPage: false,
  });
  expect(errors).toEqual([]);
});

test("polling updates existing rows without hiding them, then stops when all scans finish", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.advance();
  });
  await page.clock.runFor(10001);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "80",
  );
  await expect(active).toContainText("12,288 of 15,360 addresses swept");
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.complete();
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Scan results up to date", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  const count: number = await page.evaluate((): number => {
    return (window as unknown as { __discoveryFixture: FixtureControl })
      .__discoveryFixture.requests.length;
  });
  await page.clock.runFor(30000);
  expect(
    await page.evaluate((): number => {
      return (window as unknown as { __discoveryFixture: FixtureControl })
        .__discoveryFixture.requests.length;
    }),
  ).toBe(count);
});

test("refresh errors preserve last known progress and recover through retry", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.fail = true;
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await page.screenshot({
    path: path.join(screenshots, "discovery-refresh-recovery.png"),
    fullPage: true,
  });
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.fail = false;
  });
  await page.getByRole("button", { name: /Retry/ }).click();
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toHaveCount(0);
});

test("a stalled live request times out without losing progress and allows retry", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.route("**/discovery-stalled-poll", (): void => {
    // Leave the request pending to exercise the browser's actual HTTP timeout.
  });
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.stall = true;
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Refreshing progress…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await page.evaluate((): void => {
    const fixture: FixtureControl = (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture;
    fixture.stall = false;
    fixture.advance();
  });
  await page.getByRole("button", { name: /Retry/ }).click();
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "80",
  );
});

test("progress remains readable on a narrow screen", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page);
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await page.screenshot({
    path: path.join(screenshots, "discovery-progress-mobile.png"),
    fullPage: false,
  });
});

test("a finished recurring scan resumes live progress when its next run becomes due", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    const fixture: FixtureControl = (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture;
    fixture.complete();
    fixture.scheduleAgain();
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Scan results up to date", { exact: true }),
  ).toBeVisible();
  const requestsBeforeDue: number = await page.evaluate((): number => {
    return (window as unknown as { __discoveryFixture: FixtureControl })
      .__discoveryFixture.requests.length;
  });
  await page.clock.runFor(10000);
  expect(
    await page.evaluate((): number => {
      return (window as unknown as { __discoveryFixture: FixtureControl })
        .__discoveryFixture.requests.length;
    }),
  ).toBe(requestsBeforeDue);
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.startAgain();
  });
  await page.clock.runFor(10001);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active).toContainText("Waiting for the first progress update");
  await expect(active.getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
  );
  await expect(
    page.getByText("1 scan in progress or queued", { exact: true }),
  ).toBeVisible();
});

test("a newly claimed recurring scan waits for current progress instead of displaying old completion", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.startAgain();
  });
  await page.clock.runFor(10001);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active).toContainText("Waiting for the first progress update");
  await expect(active.getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
  );
  await expect(active.getByRole("button", { name: /Review/ })).toHaveCount(0);
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.advance();
  });
  await page.clock.runFor(10001);
  await expect(active.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "80",
  );
  await expect(active.getByRole("button", { name: /Review/ })).toBeVisible();
});
