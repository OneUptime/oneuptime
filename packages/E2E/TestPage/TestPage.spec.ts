import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Sending a test page (#6811), in a browser, against the offline fixture
 * (TestPage/Fixture): "Test your pages" as User Settings shows it, and "Test
 * this policy" as a policy's escalation rules show it.
 *
 * What is pinned here: the dialog says what the test will send before it
 * does - each method, in the order a real page reaches it, and where to for
 * the person themselves; for a policy, who its first level pages and how,
 * and who it can't reach and why; what it costs, when it costs anything -
 * then sends what the dialog names, and shows each message as it goes out:
 * who acknowledged it, by what and how fast, a message that did not go out
 * with where to fix it, and the channels that can't be acknowledged from.
 * At 1280 and 390 pixels, with nothing to scroll sideways, in dark mode and
 * in German. The fixture records every request, so the tests check what was
 * sent as well as what was drawn.
 *
 * And since #7015 and #7016: the preview's warnings, its "why them" and who
 * it can't reach are worded in the reader's language from the codes the
 * server sends (the server's English for a server that sends none), and a
 * policy's test that walks every level shows each level it reaches, when,
 * and what the walk costs at most - as a timeline, a numbered marker for
 * each level with a line down to the next, on the side a reader starts
 * from: the left, or the right in Arabic and Persian. A phone number in
 * the preview keeps its own direction beside Persian words.
 *
 * And since #7262 and #7263: a person with no rule for the severity is
 * listed with the methods the project's fallback sends to, under a line
 * that says so, and the cost line lists only what the project's balance
 * pays for - never a text the project's own Twilio account sends.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000e1";
const POLICY_ID: string = "20000000-0000-4000-8000-0000000000e1";
const CRITICAL_ID: string = "60000000-0000-4000-8000-0000000000e1";
const HIGH_ID: string = "60000000-0000-4000-8000-0000000000e3";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/user-settings/notification-methods`;
const PORT: string = process.env["TEST_PAGE_FIXTURE_PORT"] || "4293";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/test-page-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

// The Dashboard's Arabic words, as the fixture draws them with ?lang=ar.
const ARABIC: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/ar.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

// A sentence of a locale, with its values in.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  let sentence: string = locale[key]!;

  expect(sentence).toBeTruthy();

  for (const [name, value] of Object.entries(values)) {
    sentence = sentence.replace(`{{${name}}}`, value);
  }

  return sentence;
}

// What an element reads, without the marks that set its values apart.
async function wordsOf(locator: Locator): Promise<string> {
  return ((await locator.textContent()) || "").replace(/[\u2066-\u2069]/g, "");
}

// Between a German amount and its sign, as Intl writes it ("0,35 $").
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box).not.toBeNull();

  return box!;
}

/*
 * A walked level as a timeline draws it: its marker on the side the reader
 * starts from, beside its heading, and the line to the next level running
 * down from the middle of the marker.
 */
async function expectTimelineLevel(
  level: Locator,
  side: "left" | "right",
): Promise<void> {
  const marker: Box = await boxOf(level.getByTestId("test-page-walk-marker"));
  const heading: Box = await boxOf(
    level.getByTestId("test-page-walk-level-heading"),
  );
  const line: Box = await boxOf(level.getByTestId("test-page-walk-line"));

  if (side === "left") {
    expect(marker.x + marker.width).toBeLessThanOrEqual(heading.x);
  } else {
    expect(marker.x).toBeGreaterThanOrEqual(heading.x + heading.width);
  }

  expect(
    Math.abs(line.x + line.width / 2 - (marker.x + marker.width / 2)),
  ).toBeLessThanOrEqual(1);
  expect(line.y).toBeGreaterThan(marker.y + marker.height);
}

interface RecordedRequest {
  url: string;
  data: Record<string, unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/*
 * The counter style the browser numbers the dialog's list of methods with
 * ("1.", "۱."): Theme.css's html:lang(fa) rule on a Persian page (#7258).
 */
async function methodsListStyle(page: Page): Promise<string> {
  return dialog(page)
    .getByTestId("test-page-preview-method")
    .first()
    .evaluate((element: Element): string => {
      return getComputedStyle(element.parentElement as Element).listStyleType;
    });
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: (await dialog(page).count()) === 0,
    animations: "disabled",
  });
}

async function openPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${PAGE_PATH}${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

async function requests(page: Page): Promise<Array<RecordedRequest>> {
  return page.evaluate((): Array<RecordedRequest> => {
    return (
      window as unknown as { __fixture: { requests: Array<RecordedRequest> } }
    ).__fixture.requests;
  });
}

async function openDialog(page: Page, buttonName: string): Promise<void> {
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText(buttonName).first()).toBeVisible();
  // The preview has been read.
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();
}

async function send(page: Page): Promise<void> {
  await dialog(page).getByRole("button", { name: "Send test page" }).click();
  await expect(dialog(page).getByTestId("test-page-result")).toBeVisible();
}

test("Test your pages: the dialog says what it will send, in the order a page reaches it, before it does", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  await expect(page.getByText("Test your pages")).toBeVisible();
  await openDialog(page, "Send me a test page");

  const methods: Locator = dialog(page).getByTestId("test-page-preview-method");

  await expect(methods).toHaveCount(4);
  await expect(methods.nth(0)).toContainText("SMS");
  await expect(methods.nth(0)).toContainText("+1 415 555 0100");
  await expect(methods.nth(1)).toContainText("dana@example.com");
  await expect(methods.nth(2)).toContainText("Push notification");
  await expect(methods.nth(3)).toContainText("Phone call");

  // Free on a project with its own provider, or with none: no cost line.
  await expect(dialog(page).getByTestId("test-page-cost")).toHaveCount(0);

  // It asked about the first severity, an incident's, for the person themselves.
  const preview: RecordedRequest | undefined = (await requests(page)).find(
    (request: RecordedRequest): boolean => {
      return request.url.endsWith("/on-call-test-page/preview");
    },
  );

  expect(preview?.data).toEqual({
    recordKind: "Incident",
    severityId: CRITICAL_ID,
  });

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-1280");
});

test("a test says what the project's balance pays for, before it is sent - not the text its own Twilio account sends", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?cost=1");
  await openDialog(page, "Send me a test page");

  // The preview still lists the text: it is sent, only not paid from the balance.
  await expect(
    dialog(page).getByTestId("test-page-preview-method").nth(0),
  ).toContainText("SMS");

  const cost: Locator = dialog(page).getByTestId("test-page-cost");

  await expect(cost).toHaveText(
    "This test sends 1 phone call, paid from this project's SMS and call balance: about $0.25.",
  );
  await expect(cost).not.toContainText("1 SMS");

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-cost-1280");
});

test("sent, it shows each message as it goes out, and who acknowledged it, by what and how fast", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await openDialog(page, "Send me a test page");
  await send(page);

  const sent: RecordedRequest | undefined = (await requests(page)).find(
    (request: RecordedRequest): boolean => {
      return request.url.endsWith("/on-call-test-page/page-person");
    },
  );

  // A test page to yourself names nobody else.
  expect(sent?.data).toEqual({
    recordKind: "Incident",
    severityId: CRITICAL_ID,
  });

  const result: Locator = dialog(page).getByTestId("test-page-result");

  await expect(result).toContainText("Dana Kim");
  await expect(result).toContainText("SMS");
  await expect(result).toContainText("14 seconds");
  await expect(dialog(page).getByTestId("test-page-delivery")).toHaveCount(3);

  // One way out once it is sent: Done. A Cancel would read as cancelling the test.
  await expect(
    dialog(page).getByRole("button", { name: "Done" }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: "Cancel" }),
  ).toHaveCount(0);

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-result-acknowledged-1280");
});

test("a message that did not go out says why, and where to fix it", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?result=failed");
  await openDialog(page, "Send me a test page");
  await send(page);

  const failed: Locator = dialog(page)
    .getByTestId("test-page-delivery")
    .filter({ hasText: "dana@example.com" });

  await expect(failed).toContainText(
    "Email notification not sent because email dana@example.com is not verified.",
  );

  const fix: Locator = failed.getByRole("link", {
    name: "Open Notification Methods",
  });

  await expect(fix).toBeVisible();
  await expect(fix).toHaveAttribute(
    "href",
    `/dashboard/${PROJECT_ID}/user-settings/notification-methods`,
  );

  await screenshot(page, "self-result-failed-1280");
});

test("Test this policy: who its first level pages, how, and who it can't reach and why", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?view=policy");
  await openDialog(page, "Test Payments primary");

  const people: Locator = dialog(page).getByTestId("test-page-preview-person");

  await expect(people).toHaveCount(2);
  await expect(people.nth(0)).toContainText("Dana Kim");
  expect(await wordsOf(people.nth(0))).toContain("Schedule Payments primary");
  await expect(people.nth(0)).toContainText(
    "This email method is not verified, so the test can't use it.",
  );
  await expect(people.nth(1)).toContainText("Sam Rivera");

  /*
   * Sam has no rule for the severity: the method the fallback sends to is
   * listed, and the line under it says why (#7262).
   */
  const samsMethods: Locator = people
    .nth(1)
    .getByTestId("test-page-preview-method");

  await expect(samsMethods).toHaveCount(1);
  await expect(samsMethods.first()).toHaveText("Email");
  // One method listed: "the method above", never "the methods above".
  await expect(
    people.nth(1).getByTestId("test-page-preview-warning"),
  ).toHaveText(
    "No on-call rule covers this severity: like a real page, the test falls back to the method above.",
  );
  await expect(
    dialog(page).getByTestId("test-page-preview-not-paged"),
  ).toContainText("Lee Park is away until");

  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-dialog-1280");
});

test("walking every level: each level it reaches, when, who it pages, and what the walk costs at most", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?view=policy&cost=1");
  await openDialog(page, "Test Payments primary");

  // Off: the first level, and what it costs.
  const cost: Locator = dialog(page).getByTestId("test-page-cost");

  await expect(cost).toContainText(
    "This test sends 1 SMS, paid from this project's SMS and call balance: about $0.10.",
  );
  await expect(dialog(page).getByTestId("test-page-walk")).toHaveCount(0);

  await dialog(page).getByText("Walk every escalation level").click();

  const levels: Locator = dialog(page).getByTestId("test-page-walk-level");

  await expect(levels).toHaveCount(3);
  await expect(
    levels.nth(0).getByTestId("test-page-walk-level-heading"),
  ).toHaveText("Level 1, right away");
  await expect(levels.nth(0)).toContainText("Dana Kim");
  await expect(levels.nth(0)).toContainText("Lee Park is away until");
  await expect(levels.nth(1)).toContainText("Level 2, after 2 minutes");
  await expect(levels.nth(1)).toContainText("Ravi Shah");
  expect(await wordsOf(levels.nth(1))).toContain("Team Database");
  await expect(levels.nth(2)).toContainText("Level 3, after 4 minutes");
  await expect(levels.nth(2)).toContainText(
    "Escalation rule 3 pages nobody yet.",
  );
  await expect(cost).toContainText(
    "If nobody acknowledges it, walking every level sends up to 1 SMS and 1 phone call, paid from this project's SMS and call balance: about $0.35.",
  );

  // A timeline read from the left: each marker numbered, a line down to the next.
  await expect(dialog(page).getByTestId("test-page-walk-marker")).toHaveText([
    "1",
    "2",
    "3",
  ]);
  await expectTimelineLevel(levels.nth(0), "left");
  await expectTimelineLevel(levels.nth(1), "left");
  await expect(levels.nth(2).getByTestId("test-page-walk-line")).toHaveCount(0);

  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-walk-1280");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-walk-390");

  // Off again: the first level's cost.
  await dialog(page).getByText("Walk every escalation level").click();
  await expect(dialog(page).getByTestId("test-page-walk")).toHaveCount(0);
  await expect(cost).toContainText("about $0.10.");
});

test("a server from before the codes and the walk: its English, and a walk priced as before", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?view=policy&cost=1&old=1&lang=de");
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();

  await expect(
    dialog(page).getByTestId("test-page-preview-warning").first(),
  ).toHaveText("This Email method is not verified, so the test can't use it.");
  await expect(
    dialog(page).getByTestId("test-page-preview-not-paged"),
  ).toHaveText("Lee Park is away until Nov 14, 2026, with nobody covering.");

  // An older server listed no method for a person with no rule, and said so in English.
  const sam: Locator = dialog(page)
    .getByTestId("test-page-preview-person")
    .nth(1);

  await expect(sam.getByTestId("test-page-preview-method")).toHaveCount(0);
  await expect(sam.getByTestId("test-page-preview-warning")).toHaveText(
    "No on-call rule covers this severity: like a real page, the test goes to every verified method instead.",
  );

  await dialog(page).getByText(GERMAN["Walk every escalation level"]!).click();

  await expect(dialog(page).getByTestId("test-page-walk")).toHaveCount(0);
  await expect(dialog(page).getByTestId("test-page-cost")).toContainText(
    worded(
      GERMAN,
      "This test sends {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
      {
        items: worded(GERMAN, "{{count}} SMS_one", { count: "1" }),
        amount: `0,10${NO_BREAK_SPACE}$`,
      },
    ),
  );
});

test("a policy's test walks every level only when asked to, and names the policy and severity it tests", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?view=policy&result=paging");
  await openDialog(page, "Test Payments primary");

  // An alert's severity, from the list grouped by kind.
  await dialog(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "Alert: High" }).click();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();

  await dialog(page).getByText("Walk every escalation level").click();
  await send(page);

  const sent: RecordedRequest | undefined = (await requests(page)).find(
    (request: RecordedRequest): boolean => {
      return request.url.endsWith("/on-call-test-page/page-policy");
    },
  );

  expect(sent?.data).toEqual({
    recordKind: "Alert",
    severityId: HIGH_ID,
    policyId: POLICY_ID,
    walksEscalation: true,
  });
});

test("on a 390px phone, the dialog and its result fit, with nothing to scroll sideways", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page);
  await openDialog(page, "Send me a test page");

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-390");

  await send(page);
  await expect(dialog(page).getByTestId("test-page-delivery")).toHaveCount(3);

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-result-390");
});

test("in dark mode", async ({ page }: { page: Page }) => {
  await openPage(page, "?theme=dark&view=policy&result=failed");
  await openDialog(page, "Test Payments primary");
  await send(page);

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-result-dark-1280");
});

test("in German, the dialog and its result are worded in German", async ({
  page,
}: {
  page: Page;
}) => {
  const sendLabel: string = GERMAN["Send test page"]!;
  const cardTitle: string = GERMAN["Test your pages"]!;

  expect(sendLabel).toBeTruthy();
  expect(sendLabel).not.toBe("Send test page");

  await openPage(page, "?lang=de");

  await expect(page.getByText(cardTitle)).toBeVisible();
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: sendLabel }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-de-390");
});

test("in German, the policy's preview, its levels and the walk's cost are worded in German", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?view=policy&cost=1&lang=de");
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();

  const people: Locator = dialog(page).getByTestId("test-page-preview-person");

  expect(await wordsOf(people.nth(0))).toContain(
    worded(GERMAN, "Schedule {{name}}", { name: "Payments primary" }),
  );
  await expect(
    dialog(page).getByTestId("test-page-preview-warning").first(),
  ).toHaveText(
    worded(
      GERMAN,
      "This email method is not verified, so the test can't use it.",
    ),
  );
  expect(
    await wordsOf(dialog(page).getByTestId("test-page-preview-not-paged")),
  ).toMatch(/^Lee Park ist bis .+, ohne Vertretung\.$/);
  /*
   * Sam falls back to the one method listed above the line, in German: the
   * sentence's "one" form (#7262).
   */
  await expect(
    people.nth(1).getByTestId("test-page-preview-warning"),
  ).toHaveText(
    worded(
      GERMAN,
      "No on-call rule covers this severity: like a real page, the test falls back to the methods above._one",
    ),
  );

  await dialog(page).getByText(GERMAN["Walk every escalation level"]!).click();

  const levels: Locator = dialog(page).getByTestId("test-page-walk-level");

  await expect(levels).toHaveCount(3);
  await expect(levels.nth(1)).toContainText("Stufe 2, nach 2 Minuten");
  expect(await wordsOf(levels.nth(2))).toContain(
    worded(
      GERMAN,
      "Escalation rule {{order}} pages nobody yet. Add people, a team or a schedule to it.",
      { order: "3" },
    ),
  );
  await expect(dialog(page).getByTestId("test-page-cost")).toContainText(
    worded(
      GERMAN,
      "If nobody acknowledges it, walking every level sends up to {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
      {
        items: worded(GERMAN, "{{items}} and {{last}}", {
          items: worded(GERMAN, "{{count}} SMS_one", { count: "1" }),
          last: worded(GERMAN, "{{count}} phone calls_one", { count: "1" }),
        }),
        amount: `0,35${NO_BREAK_SPACE}$`,
      },
    ),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-walk-de-390");
});

test("in Arabic, the policy's levels read from the right", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "?view=policy&cost=1&lang=ar");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();
  // Arabic writes Latin digits by choice: its numbered lists stay "1. 2.".
  expect(await methodsListStyle(page)).toBe("decimal");
  await dialog(page).getByText(ARABIC["Walk every escalation level"]!).click();

  const levels: Locator = dialog(page).getByTestId("test-page-walk-level");

  await expect(levels).toHaveCount(3);
  expect(
    await wordsOf(levels.nth(0).getByTestId("test-page-walk-level-heading")),
  ).toBe(worded(ARABIC, "Level {{order}}, right away", { order: "1" }));
  expect(
    await wordsOf(levels.nth(1).getByTestId("test-page-walk-level-heading")),
  ).toBe(
    worded(ARABIC, "Level {{order}}, after {{count}} minutes", {
      order: "2",
      count: "2",
    }),
  );
  // Read from the right: each marker is on the right of its heading.
  await expectTimelineLevel(levels.nth(0), "right");
  await expectTimelineLevel(levels.nth(1), "right");
  await expect(
    dialog(page).getByTestId("test-page-preview-warning").first(),
  ).toHaveText(
    worded(
      ARABIC,
      "This email method is not verified, so the test can't use it.",
    ),
  );

  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-walk-ar-390");
});

test("walking every level, in dark mode", async ({ page }: { page: Page }) => {
  await openPage(page, "?theme=dark&view=policy&cost=1");
  await openDialog(page, "Test Payments primary");
  await dialog(page).getByText("Walk every escalation level").click();
  await expect(dialog(page).getByTestId("test-page-walk-level")).toHaveCount(3);

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-walk-dark-1280");
});

test("in Persian, the dialog and its result read from the right", async ({
  page,
}: {
  page: Page;
}) => {
  const PERSIAN: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../App/FeatureSet/Dashboard/src/Locales/fa.json",
      ),
      "utf8",
    ),
  ) as Record<string, string>;
  const sendLabel: string = PERSIAN["Send test page"]!;

  expect(sendLabel).toBeTruthy();
  expect(sendLabel).not.toBe("Send test page");

  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "?lang=fa");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: sendLabel }),
  ).toBeVisible();

  /*
   * Its numbered list of methods counts in Persian digits, "۱. ۲. ۳.", as
   * the page writes every other number - not "1. 2. 3." (#7258).
   */
  expect(await methodsListStyle(page)).toBe("persian");

  /*
   * The preview's phone number keeps its own direction beside Persian words
   * too: drawn "+1 415 555 0100", its country code first from the left.
   */
  const call: Locator = dialog(page)
    .getByTestId("test-page-preview-method")
    .filter({ hasText: PERSIAN["Phone call"]! });
  const drawnAt: Array<number> = await call.evaluate(
    (element: Element): Array<number> => {
      const text: Text = Array.from(element.childNodes).find(
        (node: ChildNode): boolean => {
          return (node.textContent || "").includes("+1 415 555 0100");
        },
      ) as Text;

      return ["+1", "415", "555", "0100"].map((part: string): number => {
        const range: Range = document.createRange();
        const at: number = text.data.indexOf(part);

        range.setStart(text, at);
        range.setEnd(text, at + part.length);

        return range.getBoundingClientRect().left;
      });
    },
  );

  expect(drawnAt).toEqual(
    [...drawnAt].sort((a: number, b: number): number => {
      return a - b;
    }),
  );

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-fa-390");

  await dialog(page).getByRole("button", { name: sendLabel }).click();
  await expect(dialog(page).getByTestId("test-page-result")).toBeVisible();
  await expect(dialog(page).getByTestId("test-page-delivery")).toHaveCount(3);

  // A phone number keeps its own direction: "+1 415 555 0100", not "0100 555 415 +1".
  const phone: Locator = dialog(page)
    .getByTestId("test-page-delivery-address")
    .first();

  await expect(phone).toHaveText("+1 415 555 0100");
  await expect(phone).toHaveAttribute("dir", "auto");
  expect(
    await phone.evaluate((element: Element): string => {
      return getComputedStyle(element).direction;
    }),
  ).toBe("ltr");

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-result-fa-390");
});
