const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures } = require("./fixtures");

/*
 * Hinge and posture, in a real browser rendering of the app.
 *
 * On a device the app learns where its window folds from its Android module
 * (Jetpack WindowManager); the web build reads the same thing from the
 * browser's viewport segments, and Chromium's DevTools emulate a fold the way
 * they do for any foldable - a display feature across the viewport. So here
 * the phone is half closed on a table, half closed like a book and opened
 * flat, and each posture is checked as the reader would see it:
 *
 *   tabletop  the incident stands above the fold, the inbox lies below it,
 *             the bar along the bottom, nothing on the crease
 *   book      the panes meet on the fold, and the divider stays there
 *   flat      a handle on the divider: drag it, it stays; reload, it is
 *             remembered; double tap, it goes back
 *   unknown   a window nothing reports a fold for - the iPhone Duo today, a
 *             browser without viewport segments - keeps today's layout
 *
 * Playwright's own screenshot puts its viewport back and so drops the
 * emulated fold; these captures go through DevTools instead.
 */

const WINDOWS = {
  // A Galaxy Z Fold's inner screen, on its side and upright.
  innerLandscape: { width: 1104, height: 884 },
  inner: { width: 884, height: 1104 },
  // A Galaxy Z Flip held open.
  flip: { width: 412, height: 914 },
  // The iPhone Duo held open.
  duoOpen: { width: 951, height: 669 },
};

const INCIDENT_TITLE = "Checkout API latency above threshold";

// The band the layout keeps clear around a seamless tabletop fold (windowLayout.ts).
const TABLETOP_FOLD_GAP = 24;

async function devtools(page) {
  if (!page.__postureSession) {
    page.__postureSession = await page.context().newCDPSession(page);
  }
  return page.__postureSession;
}

/*
 * Emulates the window, and a fold across it: { orientation, offset } in
 * points, as DevTools takes it; null for a window that does not fold.
 */
async function emulate(page, size, fold) {
  const session = await devtools(page);
  const params = {
    width: size.width,
    height: size.height,
    deviceScaleFactor: 1,
    mobile: false,
  };
  if (fold) {
    params.displayFeature = { ...fold, maskLength: 0 };
    params.devicePosture = { type: "folded" };
  }
  await session.send("Emulation.setDeviceMetricsOverride", params);
  // React Native Web lays the app out again on the change.
  await page.waitForTimeout(300);
}

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  await page.waitForTimeout(350);
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(__dirname, "../../docs/screenshots", `foldables-${name}.png`)
    : testInfo.outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const session = await devtools(page);
  const { data } = await session.send("Page.captureScreenshot", {
    format: "png",
  });
  fs.writeFileSync(destination, Buffer.from(data, "base64"));
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
  // Nothing on any window may scroll sideways.
  expect(
    await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);
}

async function openApp(page, size, fold = null) {
  await page.setViewportSize(size);
  const fixtures = await installFixtures(page);
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await emulate(page, size, fold);
  return fixtures;
}

function destinations(page) {
  return page.locator('[role="tablist"]:not([aria-label="Inbox categories"])');
}

async function box(locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result;
}

/*
 * Below a tabletop fold the list opens at its first row. Waiting for it, as a
 * reader's eye does, also keeps Playwright from scrolling a row into view by
 * itself before the list has settled - which the list rightly takes for the
 * reader scrolling, and leaves where it was put.
 */
async function waitForFirstRow(listPane) {
  const categories = listPane.getByRole("tablist", {
    name: "Inbox categories",
  });
  const search = listPane.getByPlaceholder("Search title or ID");
  await expect
    .poll(async () => {
      const top = await categories.boundingBox();
      const field = await search.boundingBox();
      return Boolean(
        top && field && field.y + field.height <= top.y + top.height,
      );
    })
    .toBe(true);
}

/*
 * The detail pane ends above the fold's band and the list pane starts below
 * it: no pane - so no card, row or button in one - reaches the crease.
 */
async function expectPanesClearOfFold(page, foldY) {
  const detail = await box(page.getByTestId("detail-pane"));
  const list = await box(page.getByTestId("list-pane"));
  expect(detail.y + detail.height).toBeLessThanOrEqual(
    foldY - TABLETOP_FOLD_GAP / 2 + 1,
  );
  expect(list.y).toBeGreaterThanOrEqual(foldY + TABLETOP_FOLD_GAP / 2 - 1);
}

test.describe("half open on a table", () => {
  test("the unfolded phone on its side: the incident above the fold, the inbox below it, the bar under the hand", async ({
    page,
  }, testInfo) => {
    await openApp(page, WINDOWS.innerLandscape, {
      orientation: "horizontal",
      offset: 442,
    });

    // The bar runs along the bottom - the half lying on the table - not down the side.
    const bar = await box(destinations(page));
    expect(bar.width).toBeGreaterThanOrEqual(WINDOWS.innerLandscape.width - 1);
    expect(bar.y + bar.height).toBeLessThanOrEqual(
      WINDOWS.innerLandscape.height,
    );
    expect(bar.y).toBeGreaterThan(442);

    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    const listPane = page.getByTestId("list-pane");
    await expect(
      listPane.getByText(INCIDENT_TITLE, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No incident selected", { exact: true }),
    ).toBeVisible();
    await waitForFirstRow(listPane);
    await expectPanesClearOfFold(page, 442);

    /*
     * Half a screen is too short for the list's header and its rows: the
     * list opens at its first row, the search a short scroll up, out of
     * sight above the categories.
     */
    const categories = await box(
      listPane.getByRole("tablist", { name: "Inbox categories" }),
    );
    const listTop = categories.y + categories.height;
    const firstRow = await box(
      listPane.getByRole("button", { name: /^Incident INC-1042/ }),
    );
    const list = await box(listPane);
    expect(firstRow.y).toBeGreaterThanOrEqual(listTop);
    expect(firstRow.y).toBeLessThan(list.y + list.height - 100);
    const search = await box(listPane.getByPlaceholder("Search title or ID"));
    expect(search.y + search.height).toBeLessThanOrEqual(listTop);

    // The project switcher heads the window, above the fold, as on a phone.
    const switcher = await box(
      page.getByRole("button", { name: /^Switch project, current project/ }),
    );
    expect(switcher.y + switcher.height).toBeLessThan(442);

    await listPane.getByText(INCIDENT_TITLE, { exact: true }).click();
    const detailPane = page.getByTestId("detail-pane");
    await expect(
      detailPane.getByRole("button", { name: "Acknowledge incident" }),
    ).toBeVisible();
    await expect(
      listPane.getByRole("button", { name: /^Incident INC-1042/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pane-divider")).toHaveCount(0);
    await expectPanesClearOfFold(page, 442);
    await capture(page, "tabletop-incident", testInfo);

    // The next incident from below replaces the one above.
    await listPane
      .getByText("Background jobs processing slowly", { exact: true })
      .click();
    await expect(
      listPane.getByRole("button", { name: /^Incident INC-1041/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      detailPane
        .getByText("Background jobs processing slowly", { exact: true })
        .first(),
    ).toBeVisible();
  });

  test("a Galaxy Z Flip half open: the list it never had room for, below its incident", async ({
    page,
  }, testInfo) => {
    await openApp(page, WINDOWS.flip, {
      orientation: "horizontal",
      offset: 457,
    });
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    const listPane = page.getByTestId("list-pane");
    await waitForFirstRow(listPane);
    await listPane.getByText(INCIDENT_TITLE, { exact: true }).click();
    await expect(
      page
        .getByTestId("detail-pane")
        .getByRole("button", { name: "Acknowledge incident" }),
    ).toBeVisible();
    await expectPanesClearOfFold(page, 457);

    // The bar stays the bar a phone has, along the bottom.
    const bar = await box(destinations(page));
    expect(bar.y).toBeGreaterThan(457);
    await capture(page, "tabletop-flip-incident", testInfo);

    // Opened flat again it is a phone: one pane, the incident full height, Back to the list.
    await emulate(page, WINDOWS.flip, null);
    await expect(page.getByTestId("list-pane")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Acknowledge incident" }),
    ).toBeVisible();
  });

  test("closing flat and half again keeps the open incident and a half-written note", async ({
    page,
  }) => {
    const { mutations } = await openApp(page, WINDOWS.innerLandscape, null);
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    await page
      .getByTestId("list-pane")
      .getByText(INCIDENT_TITLE, { exact: true })
      .click();
    await page.getByTestId("add-note-button").click();
    const note = page.getByTestId("add-note-input");
    await note.fill("Rolled back the deploy; error rate is falling");

    await emulate(page, WINDOWS.innerLandscape, {
      orientation: "horizontal",
      offset: 442,
    });
    await expect(page.getByTestId("add-note-sheet")).toBeVisible();
    await expect(note).toHaveValue(
      "Rolled back the deploy; error rate is falling",
    );

    await emulate(page, WINDOWS.innerLandscape, null);
    await expect(note).toHaveValue(
      "Rolled back the deploy; error rate is falling",
    );
    expect(
      mutations.filter((mutation) => {
        return mutation.path.includes("note");
      }),
    ).toEqual([]);
  });
});

test.describe("half open like a book", () => {
  test("the panes meet on the fold, and there is no handle to drag the divider off it", async ({
    page,
  }, testInfo) => {
    await openApp(page, WINDOWS.inner, {
      orientation: "vertical",
      offset: 442,
    });
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    const listPane = page.getByTestId("list-pane");
    await listPane.getByText(INCIDENT_TITLE, { exact: true }).click();
    await expect(
      page.getByTestId("detail-pane").getByText("Impact", { exact: true }),
    ).toBeVisible();

    const pane = await box(listPane);
    expect(Math.abs(pane.x + pane.width - 442)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("pane-divider")).toHaveCount(0);
    await capture(page, "book-incident", testInfo);
  });
});

test.describe("lying flat", () => {
  test("the divider has a handle: drag it, it stays; reload, it is remembered; double tap, it goes back", async ({
    page,
  }, testInfo) => {
    await openApp(page, WINDOWS.inner, null);
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    const listPane = page.getByTestId("list-pane");
    await listPane.getByText(INCIDENT_TITLE, { exact: true }).click();
    await expect(
      page.getByTestId("detail-pane").getByText("Impact", { exact: true }),
    ).toBeVisible();

    // Until it is moved, the divider sits on the fold's line.
    const before = await box(listPane);
    expect(Math.abs(before.x + before.width - 442)).toBeLessThanOrEqual(1);
    const handle = page.getByTestId("pane-divider");
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute("aria-label", "List width");
    await capture(page, "flat-divider", testInfo);

    const grip = await box(handle);
    const startX = grip.x + grip.width / 2;
    const startY = grip.y + grip.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY, { steps: 3 });
    await page.mouse.move(startX + 60, startY, { steps: 3 });
    await page.mouse.up();

    const after = await box(listPane);
    expect(after.width).toBeGreaterThanOrEqual(before.width + 55);
    expect(after.width).toBeLessThanOrEqual(before.width + 65);
    await capture(page, "flat-divider-moved", testInfo);

    // The width is the reader's until they move it again: a reload keeps it.
    await page.reload();
    await expect(page.getByText("Overview", { exact: true })).toBeVisible();
    await emulate(page, WINDOWS.inner, null);
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    const reloaded = await box(page.getByTestId("list-pane"));
    expect(Math.abs(reloaded.width - after.width)).toBeLessThanOrEqual(1);

    // A double tap puts it back on the fold's line.
    await page.getByTestId("pane-divider").dblclick();
    await expect
      .poll(async () => {
        const pane = await box(page.getByTestId("list-pane"));
        return Math.round(pane.x + pane.width);
      })
      .toBe(442);
  });

  test("let go near the fold's line, the divider settles exactly on it", async ({
    page,
  }) => {
    await openApp(page, WINDOWS.inner, null);
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    const grip = await box(page.getByTestId("pane-divider"));
    const startX = grip.x + grip.width / 2;
    const startY = grip.y + grip.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY, { steps: 3 });
    await page.mouse.move(startX + 10, startY, { steps: 3 });
    await page.mouse.up();

    const pane = await box(page.getByTestId("list-pane"));
    expect(Math.round(pane.x + pane.width)).toBe(442);
  });
});

test.describe("where nothing reports a fold", () => {
  test("the iPhone Duo held open keeps today's layout: the divider on its centre line, and no handle", async ({
    page,
  }) => {
    // No viewport segments: as on iOS today, nothing says where the hinge is.
    await page.addInitScript(() => {
      Object.defineProperty(window, "viewport", {
        value: undefined,
        configurable: true,
      });
    });
    await openApp(page, WINDOWS.duoOpen, null);
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();

    const pane = await box(page.getByTestId("list-pane"));
    expect(Math.abs(pane.x + pane.width - 475.5)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("pane-divider")).toHaveCount(0);
  });
});

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("the tabletop incident and the flat divider read from the dark palette", async ({
    page,
  }, testInfo) => {
    await openApp(page, WINDOWS.innerLandscape, {
      orientation: "horizontal",
      offset: 442,
    });
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    await waitForFirstRow(page.getByTestId("list-pane"));
    await page
      .getByTestId("list-pane")
      .getByText(INCIDENT_TITLE, { exact: true })
      .click();
    await expect(
      page
        .getByTestId("detail-pane")
        .getByRole("button", { name: "Acknowledge incident" }),
    ).toBeVisible();
    const canvas = await page.getByTestId("list-pane").evaluate((element) => {
      return getComputedStyle(element).backgroundColor;
    });
    // The dark canvas, not the light one.
    expect(canvas).not.toBe("rgb(243, 244, 247)");
    await capture(page, "tabletop-incident-dark", testInfo);

    await emulate(page, WINDOWS.inner, null);
    await expect(page.getByTestId("pane-divider")).toBeVisible();
    await capture(page, "flat-divider-dark", testInfo);
  });
});
