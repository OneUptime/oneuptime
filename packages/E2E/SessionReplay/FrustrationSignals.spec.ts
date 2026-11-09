import { Locator, Page, expect, test } from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

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
 * session list signals of the application's own. ?lang= and ?theme=dark
 * draw the page in another language and in the dark theme, which is what
 * the screenshots at the end are for.
 */

const projectId: string = "10000000-0000-4000-8000-000000000001";
const appId: string = "20000000-0000-4000-8000-000000000001";
const applicationRoute: string = `/dashboard/${projectId}/rum/${appId}`;
const pageRoute: string = `${applicationRoute}/session-replay-frustration-signals`;

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/session-replay-ui/frustration-signals",
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

// The page is no wider than the window: nothing scrolls sideways.
const expectNoSidewaysScroll: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });

  expect(overflow).toBeLessThanOrEqual(0);
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
  await expect(
    page.getByTestId("frustration-signals-custom-empty"),
  ).toContainText("No signals of your own yet.");
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

test("the session list names the signals of the application's own a row hit", async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  await page.goto(`${applicationRoute}/session-replay?signals=custom`);

  const rows: Locator = page.getByTestId("session-row");

  await expect(rows.first()).toBeVisible();
  await expect(
    rows.filter({ hasText: "Payment failed +1" }).first(),
  ).toBeVisible();
  await expect(
    rows.filter({ hasText: "Support chat opened" }).first(),
  ).toBeVisible();
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
  await mkdir(artifacts, { recursive: true });

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

    await page.screenshot({
      path: path.join(artifacts, `${shot.name}.png`),
      fullPage: true,
    });
  }
});
