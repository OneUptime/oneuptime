const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures } = require("./fixtures");

/*
 * Security cases on foldables, in the web rendering of the app: the inner
 * screen sets the open cases beside the case opened from them, the cover
 * screen is a phone, and a fold in the middle of a decision keeps the case,
 * its approval sheet and the comment being written. Light and dark.
 *
 * Sizes are in points, as the devices report them to apps:
 *   cover  344 x 882   Galaxy Z Fold, folded
 *   inner  884 x 1104  the same phone unfolded, held like a book
 */
const WINDOWS = {
  cover: { width: 344, height: 882 },
  inner: { width: 884, height: 1104 },
};

const SPRAY = "Password spray against the VPN ended in a sign-in for alice@acme.test";

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  await page.waitForTimeout(400);
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(__dirname, "../../docs/screenshots", `foldables-${name}.png`)
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

async function openSecurityCases(page, size) {
  await page.setViewportSize(size);
  await installFixtures(page, { security: true });
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await page.getByTestId("inbox-category-security").filter({ visible: true }).click();
  await expect(page.getByText("CASE-142 · Security case").first()).toBeVisible();
}

async function fold(page, size) {
  await page.setViewportSize(size);
  // React Native Web re-lays the app out on the resize event.
  await page.waitForTimeout(250);
}

function caseRow(page) {
  return page
    .getByRole("button", { name: /^Security case CASE-142/ })
    .filter({ visible: true });
}

test("the inner screen sets the open cases beside the case opened from them", async ({
  page,
}, testInfo) => {
  await openSecurityCases(page, WINDOWS.inner);

  const listPane = page.getByTestId("list-pane");
  await expect(listPane).toBeVisible();
  await expect(
    page.getByTestId("detail-pane-empty").filter({ visible: true }),
  ).toContainText("No case selected");

  await caseRow(page).click();
  const detailPane = page.getByTestId("detail-pane");
  await expect(
    detailPane.getByTestId("playbook-approval-card").filter({ visible: true }),
  ).toBeVisible();
  await expect(caseRow(page)).toHaveAttribute("aria-selected", "true");

  // The list stays on the left of the fold, the case on the right.
  const list = await listPane.boundingBox();
  const detail = await detailPane.boundingBox();
  expect(list.x + list.width).toBeLessThanOrEqual(detail.x + 1);
  await capture(page, "inner-security-case", testInfo);

  // Opening another case from the list replaces the one on the right.
  await page
    .getByRole("button", { name: /^Security case CASE-139/ })
    .filter({ visible: true })
    .click();
  await expect(
    detailPane.getByText("You have this case", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(caseRow(page)).toHaveAttribute("aria-selected", "false");
});

test("the cover screen is a phone: the case's actions stack and fit", async ({
  page,
}, testInfo) => {
  await openSecurityCases(page, WINDOWS.cover);
  await expect(page.getByTestId("list-pane")).toHaveCount(0);
  await page.getByText(SPRAY, { exact: true }).filter({ visible: true }).first().click();

  for (const name of ["Assign CASE-142 to me", "Close CASE-142"]) {
    const button = page.getByRole("button", { name, exact: true }).filter({ visible: true });
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(WINDOWS.cover.width);
    expect(
      await button.evaluate((element) => {
        return element.scrollWidth <= element.clientWidth + 1;
      }),
    ).toBe(true);
  }
  const assign = await page
    .getByRole("button", { name: "Assign CASE-142 to me", exact: true })
    .filter({ visible: true })
    .boundingBox();
  const close = await page
    .getByRole("button", { name: "Close CASE-142", exact: true })
    .filter({ visible: true })
    .boundingBox();
  // One above the other, each the card's width.
  expect(close.y).toBeGreaterThanOrEqual(assign.y + assign.height);
  expect(Math.abs(close.width - assign.width)).toBeLessThanOrEqual(1);
  await capture(page, "cover-security-case", testInfo);
});

test("a fold in the middle of an approval keeps the case, the sheet and the comment", async ({
  page,
}) => {
  await openSecurityCases(page, WINDOWS.inner);
  await caseRow(page).click();
  await page.getByTestId("playbook-approve").filter({ visible: true }).click();
  const comment = page.getByTestId("playbook-decision-comment");
  await comment.fill("Alice confirmed by phone.");

  await fold(page, WINDOWS.cover);
  await expect(page.getByTestId("playbook-approve-sheet")).toBeVisible();
  await expect(page.getByTestId("playbook-decision-comment")).toHaveValue(
    "Alice confirmed by phone.",
  );

  await fold(page, WINDOWS.inner);
  await expect(page.getByTestId("playbook-decision-comment")).toHaveValue(
    "Alice confirmed by phone.",
  );
});

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("the inner screen's case and list read from the dark palette", async ({
    page,
  }, testInfo) => {
    await openSecurityCases(page, WINDOWS.inner);
    await caseRow(page).click();
    await expect(
      page.getByTestId("playbook-approval-card").filter({ visible: true }),
    ).toBeVisible();
    const canvas = await page
      .getByTestId("security-case-detail-scroll")
      .filter({ visible: true })
      .evaluate((element) => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(canvas).not.toBe("rgb(255, 255, 255)");
    await capture(page, "inner-security-case-dark", testInfo);
  });

  test("the cover screen's case in the dark", async ({ page }, testInfo) => {
    await openSecurityCases(page, WINDOWS.cover);
    await page.getByText(SPRAY, { exact: true }).filter({ visible: true }).first().click();
    await expect(
      page.getByTestId("playbook-approval-card").filter({ visible: true }),
    ).toBeVisible();
    await capture(page, "cover-security-case-dark", testInfo);
  });
});
