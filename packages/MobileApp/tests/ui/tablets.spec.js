const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures, projects } = require("./fixtures");

/*
 * A tablet on its side - 1280 x 800 points, an Android tablet in landscape -
 * where every wide-window layout shows at once: the rail down the left, each
 * list beside its detail, Home in two columns and the sheets at their
 * readable width. These are the tablet gallery's wide-window screenshots
 * (docs/screenshots/tablet-landscape-*), light and dark, and the checks that
 * the layouts hold.
 *
 * On an Android build the divider carries a handle the reader can drag (the
 * posture module reports that the window does not fold); the web build reads
 * the same from the browser, so the handle shows here too.
 */

const WINDOW = { width: 1280, height: 800 };

const INCIDENT_TITLE = "Checkout API latency above threshold";
const SPRAY =
  "Password spray against the VPN ended in a sign-in for alice@acme.test";

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  // Let the native-stack transition and the relayout settle.
  await page.waitForTimeout(350);
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(
        __dirname,
        "../../docs/screenshots",
        `tablet-landscape-${name}.png`,
      )
    : testInfo.outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, animations: "disabled" });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
  // Nothing on a wide window may scroll sideways.
  expect(
    await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);
}

async function openApp(page, options = {}) {
  await page.setViewportSize(WINDOW);
  const fixtures = await installFixtures(page, options);
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  return fixtures;
}

function destinations(page) {
  return page.locator('[role="tablist"]:not([aria-label="Inbox categories"])');
}

async function expectBesideEachOther(page) {
  const list = await page.getByTestId("list-pane").boundingBox();
  const detail = await page.getByTestId("detail-pane").boundingBox();
  expect(list).not.toBeNull();
  expect(detail).not.toBeNull();
  expect(list.x + list.width).toBeLessThanOrEqual(detail.x + 1);
  expect(Math.abs(list.y - detail.y)).toBeLessThanOrEqual(1);
}

test("Home in two columns beside the rail, and the Inbox beside the incident it opens", async ({
  page,
}, testInfo) => {
  await openApp(page);

  // The five destinations run down a rail on the left.
  const rail = await destinations(page).boundingBox();
  expect(rail.x).toBe(0);
  expect(rail.width).toBeLessThanOrEqual(81);
  expect(rail.height).toBeGreaterThan(rail.width);

  const response = await page.getByTestId("home-column-response").boundingBox();
  const health = await page.getByTestId("home-column-health").boundingBox();
  expect(Math.abs(response.y - health.y)).toBeLessThanOrEqual(1);
  expect(health.x).toBeGreaterThan(response.x + response.width);
  await capture(page, "home", testInfo);

  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  const listPane = page.getByTestId("list-pane");
  await expect(
    listPane.getByText(INCIDENT_TITLE, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No incident selected", { exact: true }),
  ).toBeVisible();
  await expectBesideEachOther(page);
  await capture(page, "inbox", testInfo);

  await listPane.getByText(INCIDENT_TITLE, { exact: true }).click();
  const detailPane = page.getByTestId("detail-pane");
  await expect(detailPane.getByText("Impact", { exact: true })).toBeVisible();
  await expect(
    listPane.getByRole("button", { name: /^Incident INC-1042/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expectBesideEachOther(page);
  await capture(page, "incident", testInfo);

  // The note sheet opens over the pane at its readable width.
  await detailPane.getByTestId("add-note-button").click();
  await page
    .getByTestId("add-note-input")
    .fill("Rolled back the deploy; error rate is falling");
  const sheet = await page.getByTestId("add-note-sheet").boundingBox();
  expect(sheet.width).toBeLessThanOrEqual(640);
  await capture(page, "add-note", testInfo);
  await page.getByTestId("add-note-cancel").click();

  await listPane.getByTestId("inbox-category-alerts").click();
  await listPane
    .getByText("Database CPU usage above 80%", { exact: true })
    .click();
  await expect(
    detailPane.getByRole("button", { name: "Acknowledge alert", exact: true }),
  ).toBeVisible();
  await capture(page, "alert", testInfo);

  await listPane.getByTestId("inbox-category-incidents").click();
  await listPane.getByRole("button", { name: "Episodes", exact: true }).click();
  await listPane
    .getByText("Checkout service degradation", { exact: true })
    .click();
  await expect(
    detailPane.getByRole("button", {
      name: "Acknowledge incident episode",
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "incident-episode", testInfo);
});

test("Monitors and On-Call beside their details, Settings at a readable width, and the project sheet", async ({
  page,
}, testInfo) => {
  await openApp(page);

  await page.getByRole("tab", { name: "Monitors", exact: true }).click();
  const listPane = page.getByTestId("list-pane");
  await listPane
    .getByRole("button", { name: /^Monitor Checkout API\. Status/ })
    .click();
  await expect(
    page
      .getByTestId("detail-pane")
      .getByRole("heading", { name: "Description", exact: true }),
  ).toBeVisible();
  await expectBesideEachOther(page);
  await capture(page, "monitor", testInfo);

  // On-Call shows the team's roster beside the overview, its tile marked.
  await page.getByRole("tab", { name: "On-Call", exact: true }).click();
  await expect(
    page
      .getByTestId("detail-pane")
      .getByText(/Engineering primary/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("quick-action-roster")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await capture(page, "on-call", testInfo);

  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("Manage Projects", { exact: true }),
  ).toBeVisible();
  const row = await page
    .getByRole("button", { name: /Manage Projects/ })
    .boundingBox();
  expect(row.width).toBeLessThanOrEqual(720);
  await capture(page, "settings", testInfo);

  await page
    .getByRole("button", { name: /^Switch project, current project/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Switch project", exact: true }),
  ).toBeVisible();
  const sheet = await page.getByTestId("project-switcher-sheet").boundingBox();
  expect(sheet.width).toBeLessThanOrEqual(640);
  await capture(page, "project-switcher", testInfo);
  await page.getByRole("radio", { name: projects[1].name, exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: /^Switch project, current project/ })
      .first(),
  ).toContainText(projects[1].name);
});

test("security cases beside the case opened from them", async ({
  page,
}, testInfo) => {
  await openApp(page, { security: true });
  await page.getByTestId("home-row-security-cases").click();
  await expect(
    page.getByTestId("inbox-category-security").filter({ visible: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByTestId("list-pane")
    .getByText(SPRAY, { exact: true })
    .first()
    .click();
  await expect(
    page
      .getByTestId("detail-pane")
      .getByTestId("playbook-approval-card")
      .filter({ visible: true }),
  ).toBeVisible();
  await expectBesideEachOther(page);
  await capture(page, "security-case", testInfo);
});

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("Home, an incident beside the Inbox, On-Call and a security case, from the dark palette", async ({
    page,
  }, testInfo) => {
    await openApp(page, { security: true });
    const canvas = await page.locator("body").evaluate(() => {
      const root = document.querySelector("#root > div") || document.body;
      return getComputedStyle(root).backgroundColor;
    });
    expect(canvas).not.toBe("rgb(243, 244, 247)");
    await capture(page, "home-dark", testInfo);

    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    await page
      .getByTestId("list-pane")
      .getByText(INCIDENT_TITLE, { exact: true })
      .click();
    await expect(
      page.getByTestId("detail-pane").getByText("Impact", { exact: true }),
    ).toBeVisible();
    await capture(page, "incident-dark", testInfo);

    await page.getByRole("tab", { name: "On-Call", exact: true }).click();
    await expect(page.getByTestId("quick-action-roster")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await capture(page, "on-call-dark", testInfo);

    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    await page
      .getByTestId("inbox-category-security")
      .filter({ visible: true })
      .click();
    await page
      .getByTestId("list-pane")
      .getByText(SPRAY, { exact: true })
      .first()
      .click();
    await expect(
      page
        .getByTestId("detail-pane")
        .getByTestId("playbook-approval-card")
        .filter({ visible: true }),
    ).toBeVisible();
    await capture(page, "security-case-dark", testInfo);
  });
});
