const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures } = require("./fixtures");

/*
 * GET READY FOR ON-CALL (#7041): the app's first steps, opened from
 * Settings. The browser preview has no notifications to allow and no
 * critical alerts to turn on, so those two steps say so and are not
 * counted, and the test page is the step to do: sent, followed while it
 * pages, and once it is acknowledged the screen says you are ready.
 *
 * The phone's own prompts - allowing notifications, Critical Alerts, Do
 * Not Disturb access - and a test page arriving on a phone are checked on
 * a device before each release (RELEASING.md).
 */

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  // Let the sheet's transition finish before freezing the rendered screen.
  await page.waitForTimeout(350);
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(
        __dirname,
        "../../docs/screenshots",
        `${testInfo.project.name}-${name}.png`,
      )
    : testInfo.outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, animations: "disabled" });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
  expect(
    await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);
}

/*
 * The project's most severe incident severity, and a test page the test
 * says when to acknowledge: it pages until `testPage.acknowledged` is set.
 * Routed after installFixtures, so these answers win.
 */
async function installTestPage(page) {
  const testPage = { acknowledged: false, sent: [], resultReads: 0 };
  await page.route(
    /\/api\/(incident-severity\/get-list|on-call-test-page\/)/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const reply = (value) => {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(value),
        });
      };
      if (url.pathname === "/api/incident-severity/get-list") {
        return reply({
          data: [{ _id: "severity-critical", name: "Critical" }],
          count: 1,
        });
      }
      if (url.pathname === "/api/on-call-test-page/page-person") {
        testPage.sent.push({
          projectId: request.headers().tenantid,
          body: request.postDataJSON(),
        });
        return reply({ executionLogId: "test-page-1" });
      }
      testPage.resultReads += 1;
      return reply(
        testPage.acknowledged
          ? {
              status: "Acknowledged",
              statusMessage:
                "Test page acknowledged by Alex Morgan from the mobile app after 9 seconds.",
            }
          : { status: "Paging", statusMessage: "" },
      );
    },
  );
  return testPage;
}

async function openGetReady(page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const row = page.getByTestId("settings-row-get-ready");
  await expect(row).toContainText("Get Ready for On-Call");
  await row.click();
  await expect(page.getByTestId("get-ready-heading")).toHaveText(
    "Get ready for on-call",
  );
}

test("Get Ready for On-Call opens from Settings, sends a test page and says when you are ready", async ({
  page,
}, testInfo) => {
  await installFixtures(page);
  const testPage = await installTestPage(page);
  const failures = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });

  await openGetReady(page);

  // Nothing to allow in a browser: said so, and not counted.
  await expect(
    page.getByTestId("get-ready-step-notifications-detail"),
  ).toHaveText("Not available on this device.");
  await expect(
    page.getByTestId("get-ready-step-critical_alerts-detail"),
  ).toHaveText("Not available on this device.");
  await expect(page.getByTestId("get-ready-progress")).toContainText("0 of 1");
  await expect(page.getByTestId("get-ready-close")).toContainText("Not Now");
  await capture(page, "get-ready", testInfo);

  await page.getByTestId("get-ready-step-test_page-action").click();
  await expect(
    page.getByTestId("get-ready-step-test_page-detail"),
  ).toContainText("acknowledge it from its notification");
  expect(testPage.sent).toEqual([
    {
      projectId: "project-aurora",
      body: { recordKind: "Incident", severityId: "severity-critical" },
    },
  ]);
  await capture(page, "get-ready-test-page-sent", testInfo);

  // Acknowledged from its notification: read on the next look.
  testPage.acknowledged = true;
  await expect(page.getByTestId("get-ready-heading")).toHaveText(
    "You are ready",
  );
  await expect(page.getByTestId("get-ready-step-test_page-detail")).toHaveText(
    "Test page acknowledged by Alex Morgan from the mobile app after 9 seconds.",
  );
  await expect(page.getByTestId("get-ready-close")).toContainText("Done");
  await capture(page, "get-ready-ready", testInfo);

  // Done puts it away, back where it opened from.
  await page.getByTestId("get-ready-close").click();
  await expect(page.getByTestId("settings-row-get-ready")).toBeVisible();
  await expect(page.getByTestId("get-ready-screen")).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("in dark mode, Get Ready for On-Call reads from the dark palette", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "iphone-size",
    "one size is enough for the dark surface",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await installFixtures(page);
  await installTestPage(page);

  await openGetReady(page);

  // Light words on the dark surface, not the light palette's dark ones.
  const headingColor = await page
    .getByTestId("get-ready-heading")
    .evaluate((element) => {
      return getComputedStyle(element).color;
    });
  const [red, green, blue] = headingColor.match(/\d+/g).map(Number);
  expect(red + green + blue).toBeGreaterThan(3 * 128);
  await capture(page, "get-ready-dark", testInfo);
});
