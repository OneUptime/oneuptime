const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures } = require("./fixtures");

/*
 * A PAGE AGAIN: the on-call policy's acknowledgement timeout ran out with the
 * record still acknowledged and not resolved, so it pages the reader again.
 * The record's own Acknowledge is gone - it was acknowledged all along - so
 * the record's screen offers Acknowledge again, first, then Resolve and
 * Escalate, under "You are paged again". Acknowledging again answers the page
 * (POST /api/on-call-page/acknowledge/...), and the record is a response in
 * progress again, with nothing left to answer.
 */

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  // Let the native-stack transition finish before freezing the rendered screen.
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

async function openInboxCategory(page, category) {
  const inbox = page.getByRole("tab", { name: "Inbox", exact: true });
  if ((await inbox.getAttribute("aria-selected")) !== "true") {
    await inbox.click();
  }
  const tab = page.getByTestId(`inbox-category-${category}`);
  await expect(tab).toBeVisible();
  await tab.click();
}

const RECORDS = [
  {
    kind: "incident",
    category: "incidents",
    acknowledgePath: "/api/on-call-page/acknowledge/incident/incident-2",
  },
  {
    kind: "alert",
    category: "alerts",
    acknowledgePath: "/api/on-call-page/acknowledge/alert/alert-2",
  },
];

for (const record of RECORDS) {
  test(`paged again about an acknowledged ${record.kind}: Acknowledge again comes first, and answers the page`, async ({
    page,
  }, testInfo) => {
    const { mutations } = await installFixtures(page, { pagedAgain: true });
    const failures = [];
    page.on("pageerror", (error) => {
      failures.push(error.message);
    });

    await page.goto("/");
    await expect(page.getByText("Overview", { exact: true })).toBeVisible();
    await openInboxCategory(page, record.category);
    await page
      .getByText("Background jobs processing slowly", { exact: true })
      .first()
      .click();

    const guidance = page.getByTestId("response-guidance");
    const acknowledgeAgain = page.getByRole("button", {
      name: `Acknowledge this ${record.kind} again`,
      exact: true,
    });
    const escalate = page.getByRole("button", {
      name: `Escalate this ${record.kind}`,
      exact: true,
    });

    await expect(guidance).toContainText("You are paged again");
    await expect(guidance).toContainText(
      `This ${record.kind} is still not resolved, so you are paged again. Acknowledge again if you are still on it, or escalate it.`,
    );
    await expect(acknowledgeAgain).toBeVisible();
    await expect(escalate).toBeVisible();
    // The record's own Acknowledge is gone: it was acknowledged all along.
    await expect(
      page.getByRole("button", {
        name: `Acknowledge ${record.kind}`,
        exact: true,
      }),
    ).toHaveCount(0);

    // Acknowledge again first, Escalate after it, in reading order.
    const labels = await page
      .getByTestId("response-actions")
      .getByRole("button")
      .evaluateAll((buttons) => {
        return buttons.map((button) => {
          return button.getAttribute("aria-label");
        });
      });
    expect(labels[0]).toBe(`Acknowledge this ${record.kind} again`);
    expect(labels.indexOf(`Escalate this ${record.kind}`)).toBeGreaterThan(0);

    /*
     * "Acknowledge again" stays on one line inside its button: the buttons
     * stack before the label would break across two lines (one line of the
     * headline is 22 points).
     */
    const acknowledgeAgainBox = await acknowledgeAgain.boundingBox();
    expect(acknowledgeAgainBox).not.toBeNull();
    expect(acknowledgeAgainBox.height).toBeGreaterThanOrEqual(44);
    const labelBox = await acknowledgeAgain
      .getByText("Acknowledge again", { exact: true })
      .boundingBox();
    expect(labelBox).not.toBeNull();
    expect(labelBox.height).toBeLessThan(30);
    expect(
      await acknowledgeAgain.evaluate((button) => {
        return button.scrollWidth <= button.clientWidth + 1;
      }),
    ).toBe(true);
    await capture(page, `${record.kind}-paged-again`, testInfo);

    await acknowledgeAgain.click();

    await expect(guidance).toContainText("Response in progress");
    await expect(acknowledgeAgain).toHaveCount(0);
    // Acknowledged and no longer paged: there is nothing to escalate.
    await expect(escalate).toHaveCount(0);
    expect(
      mutations.filter((mutation) => {
        return mutation.path === record.acknowledgePath;
      }),
    ).toHaveLength(1);
    expect(failures).toEqual([]);
  });
}

test("in dark mode, the page again reads as a warning on the dark surface", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "iphone-size",
    "one size is enough for the dark surface",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await installFixtures(page, { pagedAgain: true });
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await openInboxCategory(page, "incidents");
  await page
    .getByText("Background jobs processing slowly", { exact: true })
    .first()
    .click();
  await expect(page.getByTestId("response-guidance")).toContainText(
    "You are paged again",
  );
  await expect(
    page.getByRole("button", {
      name: "Acknowledge this incident again",
      exact: true,
    }),
  ).toBeVisible();
  // Light words on the dark surface, not the light palette's dark ones.
  const titleColor = await page
    .getByText("You are paged again", { exact: true })
    .evaluate((element) => {
      return getComputedStyle(element).color;
    });
  const [red, green, blue] = titleColor.match(/\d+/g).map(Number);
  expect(red + green + blue).toBeGreaterThan(3 * 128);
  await capture(page, "incident-paged-again-dark", testInfo);
});
