import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { describePageLanguages } from "../SuiteHelpers/LocaleChunks";

/*
 * How to Reach Me's ladder in a browser (#6820, #7453), against the offline
 * fixture (HowToReachMe/Fixture): the real User Settings > How to Reach Me
 * page for a person with one ladder and for one whose cards differ, both
 * views - the ladder and the grid of cards behind it - and the inline add
 * under the ladder (#7451); and the real Default Ladder for New Members
 * card of Project Settings > Notification Channels (#7449).
 *
 * #6820's "Done when" asked for the page at 1280 and 390; #7448 tested it
 * in jsdom and took its pictures with a one-off script. Here every view is
 * drawn at a laptop's and a phone's width, light and dark, in German and
 * in Persian (right to left): nothing scrolls sideways, the steps come in
 * the order they page, the cards that differ are named under the steps and
 * tagged in the grid, and the confirmation names them before a ladder
 * replaces them.
 *
 * The fixture records every ladder saved, every update and every number
 * added, so the tests check what the page sent as well as what it drew.
 *
 * In a project with a default ladder, Start From the Project's Default
 * fills the steps with it (#9445); on a server that can't send email, SMS
 * or calls, each such step is marked and the page says once who can set it
 * up (#9446) - both drawn in every language, width and theme too.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000007453";
const ROUTE: string = `/dashboard/${PROJECT}/user-settings/on-call-rules`;
const SETTINGS_ROUTE: string = `/dashboard/${PROJECT}/settings/notification-settings`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/how-to-reach-me-ui",
);

interface LadderStepSent {
  methodColumn: string;
  methodId: string;
  notifyAfterMinutes: number;
}

interface LadderSave {
  steps: Array<LadderStepSent>;
  keepCards?: Array<{ ruleType: string; severityId: string }>;
}

interface Recorded {
  ladderSaves: Array<LadderSave>;
  updates: Array<{
    tableName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
  creates: Array<{ tableName: string; phone: string }>;
  verifications: Array<{ table: string; code: string }>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

async function dialogScreenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await dialog(page).screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    animations: "disabled",
  });
}

// The dialog's box once it has finished growing in.
async function restingDialogBox(
  page: Page,
): Promise<{ x: number; width: number }> {
  await expect(dialog(page)).toHaveCSS("opacity", "1");
  await dialog(page).evaluate(async (element: Element): Promise<void> => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation: Animation): Promise<Animation> => {
          return animation.finished;
        }),
    );
  });

  const box: { x: number; width: number } | null =
    await dialog(page).boundingBox();

  expect(box).not.toBeNull();

  return box!;
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __fixture: Recorded }).__fixture;
  });
}

function howToReachMe(page: Page): Locator {
  return page.getByTestId("how-to-reach-me");
}

// How to Reach Me for one of the fixture's people, once its ladder is drawn.
async function open(page: Page, search: string): Promise<void> {
  await page.goto(`${ROUTE}${search}`);
  await expect(howToReachMe(page)).toHaveAttribute("data-view", "ladder");
  await expect(
    page.getByTestId("paging-ladder-wait-group").first(),
  ).toBeVisible();
}

function query(person: string, language: string, theme: string): string {
  return `?person=${person}${language === "en" ? "" : `&lang=${language}`}${theme === "dark" ? "&theme=dark" : ""}`;
}

/*
 * The ladder's steps, as drawn: each wait in the order they page, the
 * step's number beside it, and how many ways each step reaches.
 */
async function expectStepsInOrder(
  page: Page,
  expected: {
    waits: Array<string>;
    numbers: Array<string>;
    methodCounts: Array<number>;
  },
): Promise<void> {
  const groups: Locator = page.getByTestId("paging-ladder-wait-group");

  await expect(groups).toHaveCount(expected.waits.length);
  await expect(groups.getByTestId("paging-ladder-step-wait")).toHaveText(
    expected.waits,
  );
  await expect(groups.getByTestId("paging-ladder-step-number")).toHaveText(
    expected.numbers,
  );

  for (const [index, count] of expected.methodCounts.entries()) {
    await expect(
      groups.nth(index).getByTestId("paging-ladder-step"),
    ).toHaveCount(count);
  }
}

// Maya's ladder: push and email at once, SMS after 5 minutes, a call after 15.
const MAYAS_STEPS: {
  waits: Array<string>;
  numbers: Array<string>;
  methodCounts: Array<number>;
} = {
  waits: ["At once", "After 5 minutes", "After 15 minutes"],
  numbers: ["1", "2", "3"],
  methodCounts: [2, 1, 1],
};

async function openGrid(page: Page): Promise<void> {
  await page.getByTestId("paging-ladder-open-grid").click();
  await expect(howToReachMe(page)).toHaveAttribute("data-view", "grid");
  await expect(
    page.getByTestId("on-call-rules-severity-title").first(),
  ).toBeVisible();
}

test.describe("a person with one ladder", () => {
  test("the steps in the order they page, and every card on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, query("one-ladder", "en", "light"));

    await expectStepsInOrder(page, MAYAS_STEPS);

    // Nothing differs: the ladder says it is for every severity.
    await expect(page.getByTestId("paging-ladder-scope")).toBeVisible();
    await expect(
      page.getByTestId("paging-ladder-differences-section"),
    ).toHaveCount(0);

    // She has a phone and the app; this browser is not registered yet.
    await expect(
      page.getByTestId("paging-ladder-use-this-browser"),
    ).toBeVisible();
    await expect(page.getByTestId("paging-ladder-add-phone")).toHaveCount(0);
    await expect(page.getByTestId("paging-ladder-get-the-app")).toHaveCount(0);
    await expect(page.getByTestId("paging-ladder-phone-asked")).toHaveCount(0);

    // The grid: the Incidents tab's three cards, none of them tagged.
    await openGrid(page);
    await expect(page.getByTestId("on-call-rules-severity-title")).toHaveText([
      "Critical",
      "Major",
      "Minor",
    ]);
    await expect(page.getByTestId("on-call-rules-differs-tag")).toHaveCount(0);

    await page.getByRole("button", { name: "Back to One Ladder" }).click();
    await expect(howToReachMe(page)).toHaveAttribute("data-view", "ladder");
    await expectStepsInOrder(page, MAYAS_STEPS);
  });
});

test.describe("a person whose cards differ", () => {
  test("the cards are named under the steps and tagged in the grid", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, query("differing", "en", "light"));

    // The ladder is what most cards do.
    await expectStepsInOrder(page, MAYAS_STEPS);

    const differences: Locator = page.getByTestId("paging-ladder-difference");

    await expect(differences).toHaveCount(2);
    await expect(
      differences.nth(0).getByTestId("paging-ladder-card-name"),
    ).toContainText("Critical");
    await expect(
      differences.nth(1).getByTestId("paging-ladder-card-name"),
    ).toContainText("Minor");
    // Critical calls at once too; Minor never calls.
    await expect(differences.nth(0)).toContainText("Also");
    await expect(differences.nth(1)).toContainText("Not");

    await openGrid(page);

    const titles: Locator = page.getByTestId("on-call-rules-severity-title");

    await expect(titles).toHaveCount(3);
    await expect(page.getByTestId("on-call-rules-differs-tag")).toHaveCount(2);
    await expect(
      titles.nth(0).getByTestId("on-call-rules-differs-tag"),
    ).toHaveText("Differs from the ladder");
    await expect(
      titles.nth(1).getByTestId("on-call-rules-differs-tag"),
    ).toHaveCount(0);
    await expect(
      titles.nth(2).getByTestId("on-call-rules-differs-tag"),
    ).toHaveText("Differs from the ladder");
  });

  test("the confirmation names the cards, and the ladder replaces them once confirmed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, query("differing", "en", "light"));

    await page.getByTestId("paging-ladder-use-for-every-severity").click();

    await expect(dialog(page)).toContainText(
      "These cards lose what makes them different, and page you by this ladder instead:",
    );

    const named: Locator = dialog(page).getByTestId("paging-ladder-card-name");

    await expect(named).toHaveCount(2);
    await expect(named.nth(0)).toContainText("Critical");
    await expect(named.nth(1)).toContainText("Minor");

    // Nothing is sent until it is confirmed.
    expect((await recorded(page)).ladderSaves).toEqual([]);

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    // One request: the ladder's steps, and no card kept.
    const saves: Array<LadderSave> = (await recorded(page)).ladderSaves;

    expect(saves).toHaveLength(1);
    expect(saves[0]!.keepCards).toBeUndefined();
    expect(
      saves[0]!.steps.map((step: LadderStepSent): string => {
        return `${step.methodColumn}@${step.notifyAfterMinutes}`;
      }),
    ).toEqual([
      "userPushId@0",
      "userEmailId@0",
      "userSmsId@5",
      "userCallId@15",
    ]);

    // Every card pages by the ladder now.
    await expect(page.getByTestId("paging-ladder-saved")).toBeVisible();
    await expect(
      page.getByTestId("paging-ladder-differences-section"),
    ).toHaveCount(0);
    await expectStepsInOrder(page, MAYAS_STEPS);

    await openGrid(page);
    await expect(page.getByTestId("on-call-rules-differs-tag")).toHaveCount(0);
  });
});

test.describe("adding a way to reach you, from the ladder", () => {
  test("a phone: its number, its code, and the ladder that pages it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, query("email-only", "en", "light"));

    await expectStepsInOrder(page, {
      waits: ["At once"],
      numbers: ["1"],
      methodCounts: [1],
    });

    // The project asks everyone on call for a phone method; she has none.
    await expect(page.getByTestId("paging-ladder-phone-asked")).toHaveText(
      "This project asks everyone on call to have a phone method.",
    );
    await expect(
      page.getByTestId("paging-ladder-use-this-browser"),
    ).toBeVisible();

    // The app's codes open under the buttons, and close again.
    await page.getByTestId("paging-ladder-get-the-app").click();
    await expect(page.getByTestId("paging-ladder-app-codes")).toBeVisible();
    await page.getByTestId("paging-ladder-get-the-app").click();
    await expect(page.getByTestId("paging-ladder-app-codes")).toHaveCount(0);

    await page.getByTestId("paging-ladder-add-phone").click();
    await page.getByTestId("paging-ladder-phone").fill("+1 555 010 4821");
    await page.getByTestId("paging-ladder-send-code").click();

    // Its code, in the dialog every number is verified in.
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByTestId("verification-code-input").fill("123456");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const sent: Recorded = await recorded(page);

    // One code, for SMS: the same number for calls needed none.
    expect(sent.creates).toEqual([
      { tableName: "UserSMS", phone: "+15550104821" },
      { tableName: "UserCall", phone: "+15550104821" },
    ]);
    expect(sent.verifications).toEqual([{ table: "UserSMS", code: "123456" }]);

    // The ladder read again: her number pages at once by SMS and by call.
    await expect(
      page
        .getByTestId("paging-ladder-wait-group")
        .first()
        .getByTestId("paging-ladder-step"),
    ).toHaveCount(3);
    await expect(page.getByTestId("paging-ladder-add-phone")).toHaveCount(0);
    await expect(page.getByTestId("paging-ladder-phone-asked")).toHaveCount(0);
  });
});

test.describe("the project's default ladder", () => {
  test("is made of channels, never anybody's devices, and saved for the members to come", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SETTINGS_ROUTE}?page=default-ladder`);

    const card: Locator = page.getByTestId("default-ladder-card");

    await expect(card.getByTestId("paging-ladder-empty")).toContainText(
      "No default ladder: a member is paged by every method they verify, at once.",
    );

    await card.getByTestId("paging-ladder-add-first").click();
    await page.getByTestId("paging-ladder-add-option-userPushId:Push").click();
    await card.getByTestId("paging-ladder-add-step-button").click();
    await page.getByTestId("paging-ladder-add-option-userSmsId:SMS").click();

    // A channel's name, with no device or number after it.
    await expect(card.getByTestId("paging-ladder-method")).toHaveCount(2);
    for (const method of await card.getByTestId("paging-ladder-method").all()) {
      await expect(method).not.toContainText(":");
    }

    await card.getByTestId("paging-ladder-save").click();
    await expect(card.getByTestId("paging-ladder-saved")).toHaveText(
      "Saved. Members are paged this way as they verify a way to be reached.",
    );

    const update: Recorded["updates"][number] | undefined = (
      await recorded(page)
    ).updates.find((candidate: Recorded["updates"][number]): boolean => {
      return "defaultPagingLadder" in candidate.data;
    });

    expect(update?.tableName).toBe("Project");
    expect(
      (
        update?.data["defaultPagingLadder"] as Array<{
          channel: string;
          notifyAfterMinutes: number;
        }>
      ).map((step: { channel: string; notifyAfterMinutes: number }): string => {
        return `${step.channel}@${step.notifyAfterMinutes}`;
      }),
    ).toEqual(["Push@0", "SMS@5"]);

    // The phone ask: a switch, saved when flipped.
    await page
      .getByTestId("phone-for-on-call-card")
      .getByRole("switch")
      .click();
    await expect
      .poll(async (): Promise<unknown> => {
        return (await recorded(page)).updates
          .map((candidate: Recorded["updates"][number]): unknown => {
            return candidate.data["requirePhoneMethodForOnCall"];
          })
          .filter((value: unknown): boolean => {
            return value !== undefined;
          });
      })
      .toEqual([true]);
  });
});

test.describe("starting from the project's default ladder", () => {
  test("fills the steps with the default as Maya's own methods, and Save Changes sends them in one request", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?person=one-ladder&default=on");
    await expectStepsInOrder(page, MAYAS_STEPS);

    await page.getByTestId("paging-ladder-start-from-default").click();

    // Push and SMS at once, then a call after 5 minutes.
    await expectStepsInOrder(page, {
      waits: ["At once", "After 5 minutes"],
      numbers: ["1", "2"],
      methodCounts: [2, 1],
    });
    await expect(
      page.getByTestId("paging-ladder-started-from-default"),
    ).toHaveText("Started from the project's default ladder.");
    await expect(
      page.getByTestId("paging-ladder-start-from-default"),
    ).toHaveCount(0);
    expect((await recorded(page)).ladderSaves).toEqual([]);

    await page.getByTestId("paging-ladder-save").click();
    await expect(page.getByTestId("paging-ladder-saved")).toBeVisible();

    const saves: Array<LadderSave> = (await recorded(page)).ladderSaves;

    expect(saves).toHaveLength(1);
    expect(
      saves[0]!.steps.map((step: LadderStepSent): string => {
        return `${step.methodColumn}@${step.notifyAfterMinutes}`;
      }),
    ).toEqual(["userPushId@0", "userSmsId@0", "userCallId@5"]);
    // Their ladder is the default now: nothing more to start from.
    await expect(
      page.getByTestId("paging-ladder-start-from-default"),
    ).toHaveCount(0);
  });

  test("names a way it leaves out, and keeps Maya's own steps in its place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?person=one-ladder&default=left-out");
    await page.getByTestId("paging-ladder-start-from-default").click();

    await expect(page.getByTestId("paging-ladder-default-left-out")).toHaveText(
      "You have not verified Telegram yet, so those steps are left out, and your own email, SMS, phone call steps stay meanwhile.",
    );
  });
});

test.describe("steps this server can't send right now", () => {
  test("are marked, and the page says once who can set it up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?person=one-ladder&send=none");

    // Email, SMS and the call; never the push.
    await expect(
      page.getByTestId("paging-ladder-not-sent-now-mark"),
    ).toHaveCount(3);

    const notice: Locator = page.getByTestId("paging-ladder-not-sent-now");

    await expect(notice).toHaveCount(1);
    await expect(notice.locator("p")).toHaveText([
      "This server can't send email right now, so these addresses get no email. Ask your server's admin to set up email.",
      "This server can't send SMS or make calls right now, so these numbers get no SMS or calls. Ask your server's admin to set up SMS and calls.",
    ]);

    await openGrid(page);
    await expect(
      page
        .getByTestId("paging-ladder-summary")
        .getByTestId("paging-ladder-not-sent-now"),
    ).toHaveCount(1);
  });

  test("leave Add your phone saying why, rather than asking for a number no code could reach", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?person=email-only&send=none");
    await page.getByTestId("paging-ladder-add-phone").click();

    await expect(page.getByTestId("paging-ladder-sms-not-sent")).toBeVisible();
    await expect(page.getByTestId("paging-ladder-phone-form")).toHaveCount(0);
  });
});

interface LanguageCase {
  lang: "de" | "fa";
  // The steps' waits, in the order they page, and their numbers.
  waits: Array<string>;
  numbers: Array<string>;
  differsTag: string;
  confirm: string;
  phoneAsked: string;
  defaultTitle: string;
}

const LANGUAGES: Array<LanguageCase> = [
  {
    lang: "de",
    waits: ["Sofort", "Nach 5 Minuten", "Nach 15 Minuten"],
    numbers: ["1", "2", "3"],
    differsTag: "Weicht vom Ablauf ab",
    confirm:
      "Diese Karten verlieren ihre Abweichung und alarmieren Sie stattdessen nach diesem Ablauf:",
    phoneAsked:
      "Dieses Projekt verlangt von allen im Bereitschaftsdienst eine Telefonmethode.",
    defaultTitle: "Standardablauf für neue Mitglieder",
  },
  {
    lang: "fa",
    // Its counts in Persian digits.
    waits: ["بی‌درنگ", "پس از ۵ دقیقه", "پس از ۱۵ دقیقه"],
    numbers: ["۱", "۲", "۳"],
    differsTag: "با ترتیب تماس فرق دارد",
    confirm:
      "این کارت‌ها تفاوت خود را از دست می‌دهند و به‌جای آن با این ترتیب تماس شما را فرامی‌خوانند:",
    phoneAsked:
      "این پروژه از همهٔ افراد آنکال می‌خواهد یک روش تلفنی داشته باشند.",
    defaultTitle: "ترتیب تماس پیش‌فرض برای اعضای جدید",
  },
];

for (const language of LANGUAGES) {
  for (const theme of ["light", "dark"]) {
    test.describe(`in ${language.lang}, ${theme}`, () => {
      for (const width of [1280, 390]) {
        const shot: string = `${width}-${theme}-${language.lang}`;

        test(`one ladder and cards that differ, both views, at ${width}px`, async ({
          page,
        }: {
          page: Page;
        }) => {
          await page.setViewportSize({
            width: width,
            height: width === 390 ? 844 : 900,
          });

          // One ladder.
          await open(page, query("one-ladder", language.lang, theme));

          expect(
            await page.evaluate((): string => {
              return document.documentElement.dir;
            }),
          ).toBe(language.lang === "fa" ? "rtl" : "ltr");

          await expectStepsInOrder(page, {
            waits: language.waits,
            numbers: language.numbers,
            methodCounts: [2, 1, 1],
          });
          await expectNoSidewaysScroll(page);
          await screenshot(page, `ladder-one-${shot}`);

          await openGrid(page);
          await expect(
            page.getByTestId("on-call-rules-differs-tag"),
          ).toHaveCount(0);
          await expectNoSidewaysScroll(page);
          await screenshot(page, `grid-one-${shot}`);

          // Cards that differ: named under the steps.
          await open(page, query("differing", language.lang, theme));
          await expectStepsInOrder(page, {
            waits: language.waits,
            numbers: language.numbers,
            methodCounts: [2, 1, 1],
          });
          await expect(
            page.getByTestId("paging-ladder-difference"),
          ).toHaveCount(2);
          await expectNoSidewaysScroll(page);
          await screenshot(page, `ladder-differing-${shot}`);

          // The confirmation names them before the ladder replaces them.
          await page
            .getByTestId("paging-ladder-use-for-every-severity")
            .click();
          await expect(dialog(page)).toContainText(language.confirm);

          const named: Locator = dialog(page).getByTestId(
            "paging-ladder-card-name",
          );

          await expect(named).toHaveCount(2);
          await expect(named.nth(0)).toContainText("Critical");
          await expect(named.nth(1)).toContainText("Minor");

          const box: { x: number; width: number } =
            await restingDialogBox(page);

          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);

          await dialogScreenshot(page, `confirm-cards-${shot}`);

          await dialog(page).getByTestId("modal-footer-close-button").click();
          await expect(dialog(page)).toHaveCount(0);

          // And the grid tags them.
          await openGrid(page);

          const tags: Locator = page.getByTestId("on-call-rules-differs-tag");

          await expect(tags).toHaveCount(2);
          await expect(tags.first()).toHaveText(language.differsTag);
          await expectNoSidewaysScroll(page);
          await screenshot(page, `grid-differing-${shot}`);
        });

        test(`the inline add and the project's default ladder at ${width}px`, async ({
          page,
        }: {
          page: Page;
        }) => {
          await page.setViewportSize({
            width: width,
            height: width === 390 ? 844 : 900,
          });

          await open(page, query("email-only", language.lang, theme));
          await expect(
            page.getByTestId("paging-ladder-phone-asked"),
          ).toHaveText(language.phoneAsked);

          // The phone form, open under the ladder: its number left to right.
          await page.getByTestId("paging-ladder-add-phone").click();
          await expect(page.getByTestId("paging-ladder-phone")).toBeVisible();
          await page.getByTestId("paging-ladder-get-the-app").click();
          await expect(
            page.getByTestId("paging-ladder-app-codes"),
          ).toBeVisible();

          /*
           * A laptop scans a code; a phone, which shows none, is sent to the
           * stores - each sentence with the address to sign in to, on one
           * line ("ht" / "tp://localhost" until #7451's suite saw it).
           */
          const serverUrl: Locator = page.getByTestId(
            width === 390
              ? "paging-ladder-app-server-url-on-phone"
              : "paging-ladder-app-server-url",
          );

          await expect(serverUrl).toBeVisible();
          await expect(
            page.getByTestId(
              width === 390
                ? "paging-ladder-app-server-url"
                : "paging-ladder-app-server-url-on-phone",
            ),
          ).toBeHidden();
          expect(
            await serverUrl.evaluate((element: Element): number => {
              return element.getClientRects().length;
            }),
          ).toBe(1);
          await expect(
            page.getByTestId("paging-ladder-app-codes").getByTestId("qr-code"),
          ).toHaveCount(2);

          await expectNoSidewaysScroll(page);
          await screenshot(page, `add-ways-${shot}`);

          await page.goto(
            `${SETTINGS_ROUTE}?page=default-ladder${query("one-ladder", language.lang, theme).replace("?person=one-ladder", "")}`,
          );

          const card: Locator = page.getByTestId("default-ladder-card");

          await expect(card).toContainText(language.defaultTitle);
          await card.getByTestId("paging-ladder-add-first").click();
          await page
            .getByTestId("paging-ladder-add-option-userPushId:Push")
            .click();
          await card.getByTestId("paging-ladder-add-step-button").click();
          await page
            .getByTestId("paging-ladder-add-option-userCallId:Call")
            .click();
          await expect(
            card.getByTestId("paging-ladder-wait-group"),
          ).toHaveCount(2);
          await expectNoSidewaysScroll(page);
          await screenshot(page, `default-ladder-${shot}`);
        });

        test(`the project's default and steps the server can't send at ${width}px`, async ({
          page,
        }: {
          page: Page;
        }) => {
          await page.setViewportSize({
            width: width,
            height: width === 390 ? 844 : 900,
          });

          // A server that can send nothing, in a project with a default.
          await open(
            page,
            `${query("one-ladder", language.lang, theme)}&default=on&send=none`,
          );
          await expect(
            page.getByTestId("paging-ladder-not-sent-now"),
          ).toHaveCount(1);
          await expect(
            page.getByTestId("paging-ladder-not-sent-now-mark"),
          ).toHaveCount(3);
          await expect(
            page.getByTestId("paging-ladder-start-from-default"),
          ).toBeVisible();
          await expectNoSidewaysScroll(page);
          await screenshot(page, `ladder-not-sent-${shot}`);

          // Started from the default: two steps, said where they came from.
          await page.getByTestId("paging-ladder-start-from-default").click();
          await expectStepsInOrder(page, {
            waits: [language.waits[0]!, language.waits[1]!],
            numbers: [language.numbers[0]!, language.numbers[1]!],
            methodCounts: [2, 1],
          });
          await expect(
            page.getByTestId("paging-ladder-started-from-default"),
          ).toBeVisible();
          await expectNoSidewaysScroll(page);
          await screenshot(page, `ladder-from-default-${shot}`);

          // A way the default uses that Maya has not linked: named.
          await open(
            page,
            `${query("one-ladder", language.lang, theme)}&default=left-out`,
          );
          await page.getByTestId("paging-ladder-start-from-default").click();
          await expect(
            page.getByTestId("paging-ladder-default-left-out"),
          ).toBeVisible();
          await expectNoSidewaysScroll(page);
          await screenshot(page, `ladder-left-out-${shot}`);

          // Add your phone, on a server that can't send SMS.
          await open(
            page,
            `${query("email-only", language.lang, theme)}&send=none`,
          );
          await page.getByTestId("paging-ladder-add-phone").click();
          await expect(
            page.getByTestId("paging-ladder-sms-not-sent"),
          ).toBeVisible();
          await expectNoSidewaysScroll(page);
          await screenshot(page, `add-phone-not-sent-${shot}`);
        });
      }
    });
  }
}

/*
 * The fixture loads its locales as the Dashboard does (#8645): English in
 * the bundle, and each other language a chunk of its own, loaded only by a
 * page drawn in it (SuiteHelpers/FixtureLocales.js).
 */
describePageLanguages({
  languages: ["de", "fa"],
  address: (language: string): string => {
    return `${ROUTE}${query("one-ladder", language, "light")}`;
  },
});
