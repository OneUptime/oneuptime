const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures, projects } = require("./fixtures");

/*
 * The app on foldables, in a real browser rendering of the React Native UI:
 * the cover screen, the inner screen held as a book and on its side, the
 * iPhone Duo held open, a phone on its side - and a fold or an unfold in the
 * middle of a task, which is a window resize while the app is on screen.
 *
 * Sizes are in points, as the devices report them to apps:
 *   cover            344 x 882   Galaxy Z Fold, folded
 *   inner            884 x 1104  the same phone unfolded, held like a book
 *   innerLandscape  1104 x 884   unfolded, on its side
 *   duoOpen          951 x 669   iPhone Duo held open (2853 x 2007 px at 3x)
 *   phoneLandscape   852 x 393   a phone on its side
 */
const WINDOWS = {
  cover: { width: 344, height: 882 },
  inner: { width: 884, height: 1104 },
  innerLandscape: { width: 1104, height: 884 },
  duoOpen: { width: 951, height: 669 },
  phoneLandscape: { width: 852, height: 393 },
};

const INCIDENT_TITLE = "Checkout API latency above threshold";

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  // Let the native-stack transition and the relayout after a resize settle.
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
  // Nothing on any window may scroll sideways.
  expect(
    await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);
}

async function openApp(page, size) {
  await page.setViewportSize(size);
  const fixtures = await installFixtures(page);
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  return fixtures;
}

function destinations(page) {
  return page.locator('[role="tablist"]:not([aria-label="Inbox categories"])');
}

async function fold(page, size) {
  await page.setViewportSize(size);
  // React Native Web re-lays the app out on the resize event.
  await page.waitForTimeout(250);
}

async function expectLabelsFit(page) {
  for (const name of ["Home", "Monitors", "Inbox", "On-Call", "Settings"]) {
    const label = page
      .getByRole("tab", { name, exact: true })
      .getByText(name, { exact: true });
    expect(
      await label.evaluate((element) => {
        return element.scrollWidth <= element.clientWidth;
      }),
    ).toBe(true);
  }
}

test("the cover screen is a phone: one pane, the bar along the bottom, actions that fit", async ({
  page,
}, testInfo) => {
  await openApp(page, WINDOWS.cover);

  // The bar runs along the bottom, the full width of the cover screen.
  const bar = await destinations(page).boundingBox();
  expect(bar.width).toBeGreaterThanOrEqual(WINDOWS.cover.width - 1);
  expect(bar.y).toBeGreaterThan(WINDOWS.cover.height - 100);
  expect(bar.y + bar.height).toBeLessThanOrEqual(WINDOWS.cover.height);
  await expectLabelsFit(page);

  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(page.getByText(INCIDENT_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByTestId("list-pane")).toHaveCount(0);
  await page.getByText(INCIDENT_TITLE, { exact: true }).click();
  await expect(page.getByText("Impact", { exact: true })).toBeVisible();

  /*
   * 344 points is too narrow for Acknowledge and Resolve side by side: they
   * stack, each the card's width, and neither label runs out of its button.
   */
  for (const name of ["Acknowledge incident", "Resolve incident"]) {
    const button = page.getByRole("button", { name, exact: true });
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(WINDOWS.cover.width);
    expect(
      await button.evaluate((element) => {
        return element.scrollWidth <= element.clientWidth + 1;
      }),
    ).toBe(true);
  }
  const acknowledge = await page
    .getByRole("button", { name: "Acknowledge incident", exact: true })
    .boundingBox();
  const resolve = await page
    .getByRole("button", { name: "Resolve incident", exact: true })
    .boundingBox();
  expect(resolve.y).toBeGreaterThan(acknowledge.y);
  await capture(page, "cover-incident", testInfo);
});

test("unfolded, the inbox sits beside the incident, split on the fold, with the rail on the left", async ({
  page,
}, testInfo) => {
  await openApp(page, WINDOWS.inner);

  const rail = await destinations(page).boundingBox();
  expect(rail.x).toBe(0);
  expect(rail.width).toBeLessThanOrEqual(81);
  expect(rail.height).toBeGreaterThan(rail.width);
  await expectLabelsFit(page);

  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  const listPane = page.getByTestId("list-pane");
  await expect(
    listPane.getByText(INCIDENT_TITLE, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Choose an incident", { exact: true }),
  ).toBeVisible();

  // The divider lies on the window's centre line, where the fold runs.
  const pane = await listPane.boundingBox();
  expect(
    Math.abs(pane.x + pane.width - WINDOWS.inner.width / 2),
  ).toBeLessThanOrEqual(1);
  await capture(page, "inner-inbox", testInfo);

  await listPane.getByText(INCIDENT_TITLE, { exact: true }).click();
  const detailPane = page.getByTestId("detail-pane");
  await expect(detailPane.getByText("Impact", { exact: true })).toBeVisible();
  await expect(
    listPane.getByRole("button", { name: /^Incident INC-1042/ }),
  ).toHaveAttribute("aria-selected", "true");
  // Rows open on the right, so they carry no "go forward" chevron.
  await expect(listPane.getByTestId("response-row-chevron")).toHaveCount(0);

  // The next incident replaces the open one; there is still no Back button.
  await listPane
    .getByText("Background jobs processing slowly", { exact: true })
    .click();
  await expect(
    listPane.getByRole("button", { name: /^Incident INC-1041/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    listPane.getByRole("button", { name: /^Incident INC-1042/ }),
  ).toHaveAttribute("aria-selected", "false");
  await expect(detailPane.getByRole("button", { name: /back/i })).toHaveCount(
    0,
  );
  await capture(page, "inner-incident", testInfo);
});

test("folding and unfolding keep the open incident, a half-written note and the list's search", async ({
  page,
}, testInfo) => {
  const { mutations } = await openApp(page, WINDOWS.inner);
  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  const search = page.getByPlaceholder("Search title or ID");
  await search.fill("checkout");
  await page.getByText(INCIDENT_TITLE, { exact: true }).click();
  await expect(page.getByText("Impact", { exact: true })).toBeVisible();
  await page.getByTestId("add-note-button").click();
  const note = page.getByTestId("add-note-input");
  await note.fill("Rolled back the deploy; error rate is falling");

  // Fold: the cover screen shows the same incident, with the sheet still up.
  await fold(page, WINDOWS.cover);
  await expect(page.getByTestId("list-pane")).toHaveCount(0);
  await expect(page.getByTestId("add-note-sheet")).toBeVisible();
  await expect(note).toHaveValue(
    "Rolled back the deploy; error rate is falling",
  );
  await capture(page, "fold-note-cover", testInfo);

  // Unfold again: beside the list, which still has its search.
  await fold(page, WINDOWS.inner);
  await expect(note).toHaveValue(
    "Rolled back the deploy; error rate is falling",
  );
  await expect(
    page.getByTestId("list-pane").getByPlaceholder("Search title or ID"),
  ).toHaveValue("checkout");
  await expect(
    page
      .getByTestId("list-pane")
      .getByText("Background jobs processing slowly", { exact: true }),
  ).toHaveCount(0);
  await capture(page, "fold-note-inner", testInfo);

  // Nothing was filed while folding: the note is still only a draft.
  expect(
    mutations.filter((mutation) => {
      return mutation.path.includes("note");
    }),
  ).toEqual([]);
  await page.getByTestId("add-note-cancel").click();
  await expect(
    page.getByTestId("detail-pane").getByText("Impact", { exact: true }),
  ).toBeVisible();
});

test("the project sheet stays open, mid-search, through an unfold", async ({
  page,
}, testInfo) => {
  await openApp(page, WINDOWS.cover);
  await page
    .getByRole("button", { name: /^Switch project, current project/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Switch project", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search projects to switch").fill("Atlas");

  await fold(page, WINDOWS.inner);

  await expect(
    page.getByRole("heading", { name: "Switch project", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Search projects to switch")).toHaveValue(
    "Atlas",
  );
  const sheet = await page.getByTestId("project-switcher-sheet").boundingBox();
  expect(sheet.width).toBeLessThanOrEqual(640);
  await capture(page, "project-sheet-inner", testInfo);

  await page
    .getByRole("radio", { name: projects[1].name, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Switch project, current project/ }),
  ).toContainText(projects[1].name);
});

test("the iPhone Duo held open: the on-call overview beside the roster it opens", async ({
  page,
}, testInfo) => {
  await openApp(page, WINDOWS.duoOpen);
  await page.getByRole("tab", { name: "On-Call", exact: true }).click();
  await expect(
    page.getByText("Your team's on-call", { exact: true }),
  ).toBeVisible();
  await capture(page, "duo-oncall", testInfo);

  await page.getByTestId("detail-pane-shortcut-roster").click();
  await expect(
    page
      .getByTestId("detail-pane")
      .getByText(/Engineering primary/)
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("quick-action-roster")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await capture(page, "duo-oncall-roster", testInfo);

  // The cover form opens over the pane; Back returns to the roster beneath it.
  await page.getByTestId("quick-action-cover").click();
  await expect(page.getByText("New Override", { exact: true })).toBeVisible();
  await page
    .getByTestId("detail-pane")
    .getByRole("button", { name: /back/i })
    .first()
    .click();
  await expect(
    page
      .getByTestId("detail-pane")
      .getByText(/Engineering primary/)
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("quick-action-roster")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("on its side the unfolded phone sets Home in two columns and Settings in one readable column", async ({
  page,
}, testInfo) => {
  await openApp(page, WINDOWS.innerLandscape);
  const response = await page.getByTestId("home-column-response").boundingBox();
  const health = await page.getByTestId("home-column-health").boundingBox();
  expect(Math.abs(response.y - health.y)).toBeLessThanOrEqual(1);
  expect(health.x).toBeGreaterThan(response.x + response.width);
  await capture(page, "inner-landscape-home", testInfo);

  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("Manage Projects", { exact: true }),
  ).toBeVisible();
  const row = await page
    .getByRole("button", { name: /Manage Projects/ })
    .boundingBox();
  expect(row.width).toBeLessThanOrEqual(720);
  await capture(page, "inner-landscape-settings", testInfo);
});

test("a phone on its side: the rail, and the inbox gives its title's height to the list", async ({
  page,
}, testInfo) => {
  await openApp(page, WINDOWS.phoneLandscape);
  const rail = await destinations(page).boundingBox();
  expect(rail.x).toBe(0);
  expect(rail.height).toBeGreaterThan(rail.width);
  // All five destinations fit the short window.
  for (const name of ["Home", "Monitors", "Inbox", "On-Call", "Settings"]) {
    const tab = await page
      .getByRole("tab", { name, exact: true })
      .boundingBox();
    expect(tab.y + tab.height).toBeLessThanOrEqual(
      WINDOWS.phoneLandscape.height,
    );
  }

  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(page.getByTestId("inbox-category-incidents")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toHaveCount(0);
  await capture(page, "phone-landscape-inbox", testInfo);
});

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("the cover screen, the unfolded inbox and the iPhone Duo's on-call screen", async ({
    page,
  }, testInfo) => {
    await openApp(page, WINDOWS.cover);
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    await page.getByText(INCIDENT_TITLE, { exact: true }).click();
    await expect(page.getByText("Impact", { exact: true })).toBeVisible();
    await capture(page, "cover-incident-dark", testInfo);

    await fold(page, WINDOWS.inner);
    await expect(page.getByTestId("list-pane")).toBeVisible();
    await expect(
      page.getByTestId("detail-pane").getByText("Impact", { exact: true }),
    ).toBeVisible();
    const canvas = await page.getByTestId("list-pane").evaluate((element) => {
      return getComputedStyle(element).backgroundColor;
    });
    // The dark canvas, not the light one.
    expect(canvas).not.toBe("rgb(243, 244, 247)");
    await capture(page, "inner-incident-dark", testInfo);

    await fold(page, WINDOWS.duoOpen);
    await page.getByRole("tab", { name: "On-Call", exact: true }).click();
    await expect(
      page.getByText("Your team's on-call", { exact: true }),
    ).toBeVisible();
    await capture(page, "duo-oncall-dark", testInfo);
  });
});
