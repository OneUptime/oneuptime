import { Locator, Page, expect, test } from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * The Frustration Signals page (issue #6443) against the offline fixture:
 * the production page, side menu, switches, rule editor and dialog, with
 * only the API replaced. The fixture keeps what a save sends and reads it
 * back, as the server does, so each test can hold what the page sent to
 * what the person did, and see the page read it again.
 *
 * ?frustration=custom stores a changed rule and two signals of the
 * application's own; ?frustration=fail-read and ?frustration=fail-save fail
 * the first read and the first save; ?signals=custom gives two rows of the
 * session list, and the session the player opens, signals of the
 * application's own; ?access=view draws the pages for a project Viewer, who
 * may read the application but not change it. ?lang= and ?theme=dark draw
 * the page in another language and in the dark theme, which is what the
 * screenshots at the end are for.
 */

const projectId: string = "10000000-0000-4000-8000-000000000001";
const appId: string = "20000000-0000-4000-8000-000000000001";
const applicationRoute: string = `/dashboard/${projectId}/rum/${appId}`;
const pageRoute: string = `${applicationRoute}/session-replay-frustration-signals`;
const listRoute: string = `${applicationRoute}/session-replay`;
const playerRoute: string = `${listRoute}/${"a".repeat(32)}`;

/*
 * Beside the other replay suites' screenshots, which is where App Test's
 * upload looks (output/playwright/session-replay-ui/*.png): a folder of
 * their own was never uploaded.
 */
const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/session-replay-ui",
);

// The four default rules, as the page builds them from the default numbers.
const defaultDefinitions: Record<string, string> = {
  rageClick:
    "3 or more clicks within 30 px of each other, each within 1 second of the one before.",
  deadClick:
    "A click on something that looks clickable, after which nothing on the page changes for 3 seconds.",
  errorClick: "An error within 1 second of a click.",
  refreshRage: "The same page loaded 3 times within 60 seconds.",
};

type SavedSettings = Record<string, Record<string, unknown>> & {
  customSignals: Array<Record<string, unknown>>;
};

interface FixtureState {
  frustrationSaves: Array<SavedSettings>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }): Promise<void> => {
  const errors: Array<string> = [];

  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
});

test.afterEach(async ({ page }: { page: Page }): Promise<void> => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

const saves: (page: Page) => Promise<Array<SavedSettings>> = async (
  page: Page,
): Promise<Array<SavedSettings>> => {
  return page.evaluate((): Array<SavedSettings> => {
    return (window as unknown as { __sessionReplayFixture: FixtureState })
      .__sessionReplayFixture.frustrationSaves;
  });
};

const expectSaveCount: (page: Page, count: number) => Promise<void> = async (
  page: Page,
  count: number,
): Promise<void> => {
  await expect
    .poll(async (): Promise<number> => {
      return (await saves(page)).length;
    })
    .toBe(count);
};

const lastSave: (page: Page) => Promise<SavedSettings> = async (
  page: Page,
): Promise<SavedSettings> => {
  const all: Array<SavedSettings> = await saves(page);

  return all[all.length - 1] as SavedSettings;
};

const openPage: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${pageRoute}${query}`);
  await expect(page.getByTestId("frustration-signals-built-in")).toBeVisible();
};

const definition: (page: Page, key: string) => Locator = (
  page: Page,
  key: string,
): Locator => {
  return page.getByTestId(`frustration-signal-${key}-definition`);
};

// A screenshot for the UI review, named for this suite.
const screenshot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: path.join(artifacts, `frustration-signals-${name}.png`),
    fullPage: true,
  });
};

test("opens from the side menu and states the default rules, with nothing of the application's own yet", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.goto(`${applicationRoute}/session-replay-settings`);
  await page.getByRole("link", { name: "Frustration Signals" }).click();

  await expect(page).toHaveURL(
    new RegExp(`${appId}/session-replay-frustration-signals$`),
  );
  await expect(page.getByTestId("frustration-signals-built-in")).toBeVisible();

  for (const [key, sentence] of Object.entries(defaultDefinitions)) {
    await expect(definition(page, key)).toHaveText(sentence);
  }

  for (const name of [
    "Rage clicks",
    "Dead clicks",
    "Error clicks",
    "Refresh rage",
  ]) {
    await expect(page.getByRole("switch", { name })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  }

  await expect(page.getByTestId("frustration-signals-applies")).toContainText(
    "Changes apply to sessions recorded from now on.",
  );
  /*
   * The product's empty list: what is true, and what one is for. The way
   * in is the card's own Add signal, so the list has no second one.
   */
  await expect(
    page.getByTestId("frustration-signals-custom-empty-title"),
  ).toHaveText("No signals of your own yet");
  await expect(
    page.getByTestId("frustration-signals-custom-empty-description"),
  ).toHaveText("Add one to mark a moment that matters to you.");
  await expect(page.getByRole("button", { name: "Add signal" })).toHaveCount(1);
  await expect(page.getByTestId("frustration-signals-mobile-note")).toHaveText(
    "The React Native recorder detects your page, event and error signals. Click signals and the built-in rules are for the browser recorder.",
  );
  expect(await saves(page)).toEqual([]);
});

test("switching a built-in signal off saves it at once, and only that", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await openPage(page);

  await page.getByRole("switch", { name: "Dead clicks" }).click();

  await expectSaveCount(page, 1);
  expect((await lastSave(page))["deadClick"]).toEqual({
    isEnabled: false,
    timeoutMs: 3000,
    ignoreSelectors: [],
  });
  expect((await lastSave(page))["rageClick"]?.["isEnabled"]).toBe(true);
  await expect(
    page.getByTestId("frustration-signal-deadClick-status"),
  ).toContainText("Saved");
  await expect(
    page.getByRole("switch", { name: "Dead clicks" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("a changed rule is saved in milliseconds, its sentence follows, and the page reads it back", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await openPage(page);

  const fold: Locator = page.getByTestId("frustration-signal-rageClick-rule");

  await fold.getByRole("button", { name: "Change the rule" }).click();
  await page.getByTestId("frustration-signal-rageClick-clickCount").fill("5");
  await page.getByTestId("frustration-signal-rageClick-windowMs").fill("1.5");
  await page.getByTestId("frustration-signal-rageClick-radiusPx").fill("40");
  await page
    .getByTestId("frustration-signal-rageClick-ignore")
    .fill(".quantity-stepper");
  await page.getByTestId("frustration-signal-rageClick-save-rule").click();

  await expectSaveCount(page, 1);
  expect((await lastSave(page))["rageClick"]).toEqual({
    isEnabled: true,
    clickCount: 5,
    windowMs: 1500,
    radiusPx: 40,
    ignoreSelectors: [".quantity-stepper"],
  });

  const changed: string =
    "5 or more clicks within 40 px of each other, each within 1.5 seconds of the one before.";

  await expect(definition(page, "rageClick")).toHaveText(changed);

  // Away and back through the side menu: the page reads what was saved.
  await page.getByRole("link", { name: "Replay Policy" }).click();
  await page.getByRole("link", { name: "Frustration Signals" }).click();
  await expect(definition(page, "rageClick")).toHaveText(changed);
  await expect(page.getByTestId("frustration-signals-built-in")).toContainText(
    "Clicks on 1 element you listed never count.",
  );
});

test("a number outside its range is refused under the field, and nothing is saved", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await openPage(page);

  const fold: Locator = page.getByTestId("frustration-signal-refreshRage-rule");

  await fold.getByRole("button", { name: "Change the rule" }).click();
  await page
    .getByTestId("frustration-signal-refreshRage-reloadCount")
    .fill("11");
  await page.getByTestId("frustration-signal-refreshRage-save-rule").click();

  await expect(fold).toContainText("Enter a whole number from 2 to 10.");
  expect(await saves(page)).toEqual([]);
});

/*
 * What is wrong with a number goes under the number and its unit, as the
 * product's other number settings place it. Drawn by the input itself it
 * sat between the two, squeezing "clicks or more" into a word a line, with
 * its icon at the card's far edge. Save rule began 12px in from the fields
 * above it, and the box for a few short selectors ran the card's width.
 */
test("a refused number is said under its field, its unit stays on one line, and Save rule lines up with the fields", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPage(page);

  const fold: Locator = page.getByTestId("frustration-signal-rageClick-rule");
  const input: Locator = page.getByTestId(
    "frustration-signal-rageClick-clickCount",
  );
  const error: Locator = page.getByTestId(
    "frustration-signal-rageClick-clickCount-error",
  );

  await fold.getByRole("button", { name: "Change the rule" }).click();
  await input.fill("1");
  await page.getByTestId("frustration-signal-rageClick-save-rule").click();

  await expect(error).toHaveText("Enter a whole number from 3 to 10.");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(
    "Enter a whole number from 3 to 10.",
  );
  await expect(
    page.getByTestId("frustration-signal-rageClick-ignore"),
  ).toHaveAccessibleDescription(
    "One CSS selector a line, such as .quantity-stepper. A click on a matching element, or inside one, never counts.",
  );
  expect(await saves(page)).toEqual([]);

  const [field, unit, said, label, saveRule, selectors] = await boxesInOneFrame(
    [
      input,
      fold.getByText("clicks or more", { exact: true }),
      error,
      fold.locator('label[for="frustration-signal-rageClick-clickCount"]'),
      page.getByTestId("frustration-signal-rageClick-save-rule"),
      page.getByTestId("frustration-signal-rageClick-ignore"),
    ],
  );

  // The unit is beside the number, on one line, centred on it.
  expect(unit!.x).toBeGreaterThanOrEqual(field!.x + field!.width);
  expect(unit!.height).toBeLessThanOrEqual(label!.height + 0.5);
  expect(
    Math.abs(unit!.y + unit!.height / 2 - (field!.y + field!.height / 2)),
  ).toBeLessThanOrEqual(1);
  // What is wrong is under them both, where the field starts.
  expect(said!.y).toBeGreaterThanOrEqual(field!.y + field!.height);
  expect(Math.abs(said!.x - field!.x)).toBeLessThanOrEqual(0.5);
  // Save rule starts where the fields do.
  expect(Math.abs(saveRule!.x - label!.x)).toBeLessThanOrEqual(0.5);
  // A box for a few short selectors: max-w-xl, 36rem.
  expect(selectors!.width).toBeLessThanOrEqual(576.5);
  await screenshot(page, "rule-error-1280");
});

test("adds a signal of the application's own, which counts as frustration unless switched", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await openPage(page);

  await page.getByRole("button", { name: "Add signal" }).click();
  await expect(page.getByTestId("custom-signal-form")).toBeVisible();
  await page.getByTestId("custom-signal-name").fill("Payment failed");
  await page.getByTestId("card-select-option-page").click();
  await page.getByTestId("custom-signal-match").fill("checkout/error");
  await page.getByTestId("modal-footer-submit-button").click();

  // A path that does not start with / cannot match one: said, not saved.
  await expect(page.getByTestId("custom-signal-form")).toContainText(
    "/checkout/error",
  );
  expect(await saves(page)).toEqual([]);

  await page.getByTestId("custom-signal-match").fill("/checkout/error");
  await page.getByTestId("modal-footer-submit-button").click();

  await expectSaveCount(page, 1);
  expect((await lastSave(page)).customSignals).toEqual([
    expect.objectContaining({
      name: "Payment failed",
      trigger: "page",
      match: "/checkout/error",
      isFrustration: true,
      isEnabled: true,
    }),
  ]);
  await expect(page.getByTestId("custom-signal-form")).toHaveCount(0);

  const custom: Locator = page.getByTestId("frustration-signals-custom");

  await expect(custom).toContainText("Payment failed");
  await expect(custom).toContainText("Frustration");
  await expect(custom).toContainText("The page /checkout/error");
  await expect(
    page.getByRole("switch", { name: "Payment failed" }),
  ).toHaveAttribute("aria-checked", "true");
});

/*
 * The dialog's fields draw the icon of what is wrong inside their own box.
 * It sat at the dialog's far edge, half way down the dialog: the field's
 * box was not one an icon could be placed in.
 */
test("a refused field of the dialog draws its icon inside its own box, and is described by its hint and its error", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPage(page);

  await page.getByRole("button", { name: "Add signal" }).click();
  await expect(page.getByTestId("custom-signal-form")).toBeVisible();
  await page.getByTestId("modal-footer-submit-button").click();

  const name: Locator = page.getByTestId("custom-signal-name");
  const match: Locator = page.getByTestId("custom-signal-match");

  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription(
    "Shown on the session list and the replay timeline, and what the list's filter finds it by. Give the signal a name.",
  );
  await expect(match).toHaveAttribute("aria-invalid", "true");
  await expect(match).toHaveAccessibleDescription(
    "A click on a matching element, or anything inside it, sets the signal off. Enter the CSS selector of the element, such as #pay-button.",
  );
  expect(await saves(page)).toEqual([]);

  const icon: (field: Locator) => Locator = (field: Locator): Locator => {
    return field.locator("xpath=following-sibling::*[@aria-hidden='true']");
  };
  const [nameBox, nameIcon, matchBox, matchIcon] = await boxesInOneFrame([
    name,
    icon(name),
    match,
    icon(match),
  ]);

  for (const [box, mark] of [
    [nameBox!, nameIcon!],
    [matchBox!, matchIcon!],
  ]) {
    expect(mark!.x).toBeGreaterThanOrEqual(box!.x);
    expect(mark!.x + mark!.width).toBeLessThanOrEqual(box!.x + box!.width);
    expect(mark!.y).toBeGreaterThanOrEqual(box!.y - 0.5);
    expect(mark!.y + mark!.height).toBeLessThanOrEqual(
      box!.y + box!.height + 0.5,
    );
  }

  await screenshot(page, "dialog-error-1280");
});

test("lists the stored signals with their kinds, and the stored rules", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await openPage(page, "?frustration=custom");

  await expect(definition(page, "rageClick")).toHaveText(
    "5 or more clicks within 40 px of each other, each within 1.5 seconds of the one before.",
  );
  await expect(
    page.getByRole("switch", { name: "Dead clicks" }),
  ).toHaveAttribute("aria-checked", "false");

  const payment: Locator = page.getByTestId(
    "custom-signal-signal-payment-failed",
  );
  const chat: Locator = page.getByTestId("custom-signal-signal-support-chat");

  await expect(payment).toContainText("Payment failed");
  await expect(
    page.getByTestId("custom-signal-signal-payment-failed-kind"),
  ).toHaveText("Frustration");
  await expect(chat).toContainText("Support chat opened");
  await expect(
    page.getByTestId("custom-signal-signal-support-chat-kind"),
  ).toHaveText("Marker");
  await expect(chat).toContainText("A click on #open-support-chat");
});

test("a failed read says so, and Refresh reads again", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.goto(`${pageRoute}?frustration=fail-read`);

  const failure: Locator = page.getByTestId("frustration-signals-load-error");

  await expect(failure).toContainText(
    "The frustration settings could not be loaded.",
  );
  await expect(failure).toContainText("The server did not answer.");

  await failure.getByTestId("refresh-button").click();

  await expect(page.getByTestId("frustration-signals-built-in")).toBeVisible();
  await expect(definition(page, "deadClick")).toHaveText(
    defaultDefinitions["deadClick"] as string,
  );
});

test("a refused save says why and puts the switch back", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await openPage(page, "?frustration=fail-save");

  await page.getByRole("switch", { name: "Rage clicks" }).click();

  await expect(page.getByTestId("frustration-signals-built-in")).toContainText(
    "The server is restarting. Try again in a moment.",
  );
  await expect(
    page.getByRole("switch", { name: "Rage clicks" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(await saves(page)).toEqual([]);
});

/*
 * Someone who may only view the application reads the page, and is told
 * once, at its top, why they cannot change it: no switch moves, and there
 * is no rule editor, no Add signal, and no empty list asking them to add
 * one.
 */
test("a project Viewer reads the settings, and is told why they cannot change them", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await openPage(page, "?access=view");

  await expect(page.getByTestId("frustration-signals-read-only")).toHaveText(
    "You do not have permission to update this RUM Application. You need this permission: Edit RUM Application.",
  );
  await expect(page.getByTestId("frustration-signals-applies")).toBeVisible();

  const rage: Locator = page.getByRole("switch", { name: "Rage clicks" });

  await expect(rage).toHaveAttribute("aria-disabled", "true");
  await rage.focus();
  await page.keyboard.press("Space");
  await rage.click({ force: true });
  await expect(rage).toHaveAttribute("aria-checked", "true");

  await expect(
    page.getByRole("button", { name: "Change the rule" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add signal" })).toHaveCount(0);
  await expect(
    page.getByTestId("frustration-signals-custom-empty-title"),
  ).toHaveText("No signals of your own yet");
  await expect(
    page.getByTestId("frustration-signals-custom-empty-description"),
  ).toHaveCount(0);
  expect(await saves(page)).toEqual([]);
});

test("the session list names the signals of the application's own a row hit", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.goto(`${listRoute}?signals=custom`);

  const rows: Locator = page.getByTestId("session-row");

  await expect(rows.first()).toBeVisible();
  await expect(
    rows.filter({ hasText: "Payment failed +1" }).first(),
  ).toBeVisible();
  await expect(
    rows.filter({ hasText: "Support chat opened" }).first(),
  ).toBeVisible();
});

/*
 * At a laptop's width a name of the application's own is drawn on one
 * line, ending in "..." where the Signals column ends - the whole of it on
 * hover - and how many more is a badge of its own, never cut. One badge of
 * "Payment failed +1" ran onto a second line, "+1" alone on it; a long name
 * never pushes Recording under the sticky Watch column.
 */
test("at 1280px the session list draws each name of the application's own on one line, and still fits its card", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${listRoute}?signals=custom`);

  const rows: Locator = page.getByTestId("session-row");
  const payment: Locator = rows.filter({ hasText: "Payment failed" }).first();
  const chat: Locator = rows.filter({ hasText: "Support chat opened" }).first();
  const paymentName: Locator = payment.getByTestId("status-badge-text");
  const more: Locator = payment.getByTestId("session-row-more-own-signals");
  const chatName: Locator = chat.getByTestId("status-badge-text");

  await expect(paymentName).toHaveText("Payment failed");
  await expect(more).toHaveText("+1");
  await expect(chatName).toHaveText("Support chat opened");
  await expect(
    payment.getByTitle("Payment failed, Support chat opened"),
  ).toBeVisible();
  await expect(chat.getByTitle("Support chat opened")).toBeVisible();

  const [paymentBadge, moreBadge, chatBadge, chatCell] = await boxesInOneFrame([
    paymentName.locator(".."),
    more,
    chatName.locator(".."),
    chatName.locator("xpath=ancestor::td[1]"),
  ]);

  // Each badge one line high, as "+1" is.
  expect(Math.abs(paymentBadge!.height - moreBadge!.height)).toBeLessThan(0.5);
  expect(Math.abs(chatBadge!.height - moreBadge!.height)).toBeLessThan(0.5);
  expect(chatBadge!.x + chatBadge!.width).toBeLessThanOrEqual(
    chatCell!.x + chatCell!.width + 0.5,
  );

  const scroll: Locator = page.getByTestId("table-scroll");

  await expect(scroll).toHaveAttribute("data-overflowing", "false");

  // The last data column ends before the sticky Actions column begins.
  const headers: Array<Locator> = await scroll.locator("thead th").all();
  const [lastData, actions] = await boxesInOneFrame([
    headers[headers.length - 2]!,
    headers[headers.length - 1]!,
  ]);

  expect(lastData!.x + lastData!.width).toBeLessThanOrEqual(actions!.x + 0.5);
  await expectNoSidewaysScroll(page, { tolerance: 1 });
  await screenshot(page, "session-list-1280");
});

/*
 * In the player, the detail of a signal of the application's own says
 * what it counted as. A marker read as a track() event of the same name -
 * "Event: Support chat opened", "Properties: none" - and said nothing of
 * the click that set it off; it names the signal and what sets it off, as
 * a frustrating one does, says it is a marker, and shows where its click
 * was.
 */
test("the player's detail of a signal of the application's own says what it counts as, and where a click was", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${playerRoute}?signals=custom&rail=interactions`);
  await expect(page.getByTestId("replay-phase")).toHaveText("playing", {
    timeout: 30000,
  });
  await page.getByTestId("replay-play-pause").click();
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");

  const rail: Locator = page.getByTestId("replay-rail");
  const row: (title: string) => Locator = (title: string): Locator => {
    return rail.getByTestId("rail-row").filter({
      has: page.locator("[data-rail-row-body]", { hasText: title }),
    });
  };
  const fact: (detail: Locator, label: string) => Locator = (
    detail: Locator,
    label: string,
  ): Locator => {
    return detail
      .locator("dt", { hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]");
  };

  await row("Support chat opened").locator("[data-rail-row-body]").click();

  const marker: Locator = row("Support chat opened").getByTestId(
    "rail-row-detail",
  );

  await expect(fact(marker, "Signal")).toHaveText(
    "Support chat opened (your signal: a click)",
  );
  await expect(fact(marker, "Counts as")).toHaveText(
    "a marker, not frustration",
  );
  await expect(fact(marker, "Position")).toHaveText("1080, 690");
  await expect(marker.locator("dt", { hasText: "Properties" })).toHaveCount(0);

  // Show on stage rings the click where it was recorded.
  await page.evaluate((): void => {
    const rings: Array<{ left: string; top: string }> = [];

    (window as unknown as { __rings: typeof rings }).__rings = rings;
    new MutationObserver((records: Array<MutationRecord>): void => {
      for (const record of records) {
        record.addedNodes.forEach((node: Node): void => {
          if (
            node instanceof HTMLElement &&
            node.classList.contains("oneuptime-replay-touch-ring")
          ) {
            rings.push({ left: node.style.left, top: node.style.top });
          }
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await marker.getByTestId("rail-show-on-stage").click();
  await expect
    .poll(async (): Promise<Array<{ left: string; top: string }>> => {
      return page.evaluate((): Array<{ left: string; top: string }> => {
        return (
          window as unknown as {
            __rings: Array<{ left: string; top: string }>;
          }
        ).__rings;
      });
    })
    .toEqual([{ left: "1080px", top: "690px" }]);
  await screenshot(page, "player-marker-1280");

  await row("Payment failed").locator("[data-rail-row-body]").click();

  const frustration: Locator =
    row("Payment failed").getByTestId("rail-row-detail");

  await expect(fact(frustration, "Signal")).toHaveText(
    "Payment failed (your signal: a page)",
  );
  await expect(fact(frustration, "Counts as")).toHaveText("frustration");
});

test("fits a phone, with the rule editor and the dialog open", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "?frustration=custom");
  await expectNoSidewaysScroll(page);

  await page
    .getByTestId("frustration-signal-rageClick-rule")
    .getByRole("button", { name: "Change the rule" })
    .click();
  await expect(
    page.getByTestId("frustration-signal-rageClick-clickCount"),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);

  // Said in the card's body: a card's description is not shown on a phone.
  await expect(page.getByTestId("frustration-signals-applies")).toBeVisible();

  await page.getByRole("button", { name: "Add signal" }).click();
  await expect(page.getByTestId("custom-signal-form")).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test("draws the page at each width, light and dark, in German and Persian, for the UI review", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  test.setTimeout(240000);

  const shots: Array<{ name: string; query: string; width: number }> = [];

  for (const width of [1280, 1024, 768, 390]) {
    shots.push({ name: `new-${width}-light`, query: "", width });
    shots.push({
      name: `busy-${width}-light`,
      query: "?frustration=custom",
      width,
    });
    shots.push({
      name: `busy-${width}-dark`,
      query: "?frustration=custom&theme=dark",
      width,
    });
  }

  for (const language of ["de", "fa"]) {
    for (const width of [1280, 390]) {
      shots.push({
        name: `busy-${width}-${language}`,
        query: `?frustration=custom&lang=${language}`,
        width,
      });
    }
  }

  for (const width of [1280, 390]) {
    shots.push({
      name: `view-only-${width}-light`,
      query: "?frustration=custom&access=view",
      width,
    });
  }

  shots.push({
    name: "failed-read-1280",
    query: "?frustration=fail-read",
    width: 1280,
  });

  for (const shot of shots) {
    await page.setViewportSize({ width: shot.width, height: 900 });
    await page.goto(`${pageRoute}${shot.query}`);

    if (shot.query.includes("fail-read")) {
      await expect(
        page.getByTestId("frustration-signals-load-error"),
      ).toBeVisible();
    } else {
      await expect(
        page.getByTestId("frustration-signals-built-in"),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
    }

    // The Persian shots are of the page laid out right to left.
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      shot.query.includes("lang=fa") ? "rtl" : "ltr",
    );

    await screenshot(page, shot.name);
  }
});
