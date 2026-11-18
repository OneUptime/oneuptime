import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { dashboardWord } from "../SuiteHelpers/LocaleChunks";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * SERVER SETUP, ITS TEST CARDS AND THE DASHBOARD'S CARD, IN A BROWSER (#7027).
 *
 * The production pages, against the fixture's in-page server
 * (ServerSetup/Fixture/Checklist.js): the Admin Dashboard's Server setup
 * (/admin/setup), Settings > Emails and Settings > Call and SMS, and the
 * Dashboard's "This server is not finished" card. What the component tests
 * cannot show is pinned here, at a laptop's and a phone's width, light and
 * dark, in German and Persian, and never a page that scrolls sideways:
 *
 *   - Server setup's required, recommended and optional groups, the optional
 *     one folded until asked for; each row's fix drawn as a button and the
 *     admin's own choices beside it quiet - muted, underlined words, as
 *     tall as a finger needs on a phone (#7030) - yet as readable;
 *   - a choice made and undone;
 *   - Set up email opening Settings > Emails in the mail server's form
 *     (#7460), and How to back up opening steps the install can run, both
 *     of them named while the server cannot tell (#9378);
 *   - the test sends - Send test email and Send test SMS on their settings
 *     pages' cards, Make test call, and Send test push on the push row
 *     (#7028) - answered accepted, refused and not set up, each in its
 *     words;
 *   - the Dashboard's card: how many things are left, Finish setup, and
 *     Hide, which the server keeps.
 *
 * Screenshots land in output/playwright/server-setup-ui/, for the people who
 * review the pages.
 */

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/server-setup-ui",
);

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/AdminDashboard/src/Locales",
);

const ADMIN_EMAIL: string = "ada@acme-commerce.example";
const MAIL_SERVER: string = "smtp.acme-commerce.example";

// The admin's own choices on a fresh server, and the fix beside each.
const CHOICES: Array<{ row: string; choice: string; fix: string }> = [
  {
    row: "signups",
    choice: "Keep sign-ups open",
    fix: "server-setup-signups-route",
  },
  {
    row: "sms-and-calls",
    choice: "Use email and push only",
    fix: "server-setup-sms-and-calls-route",
  },
  { row: "probes", choice: "Not needed", fix: "server-setup-probes-route" },
  {
    row: "backups",
    choice: "This server is backed up",
    fix: "server-setup-backups-guide-0",
  },
];

// The server's own Kubernetes page (#9438), at the page's origin.
const HELM_BACKUP_GUIDE_PATH: string =
  "/docs/installation/kubernetes#back-up-your-data";

type Words = Record<string, unknown>;

const adminLocales: Map<string, Words> = new Map<string, Words>();

// The Admin Dashboard's words for an English sentence, in a language it speaks.
function adminWord(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  if (!adminLocales.has(language)) {
    adminLocales.set(
      language,
      JSON.parse(
        fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf8"),
      ) as Words,
    );
  }

  const words: unknown = adminLocales.get(language)![english];

  return typeof words === "string" && words ? words : english;
}

interface FixtureRecord {
  posts: Array<{ url: string; body: Record<string, unknown> }>;
  unmodeled: Array<Record<string, unknown>>;
}

async function recordOf(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __serverSetupFixture: FixtureRecord })
          .__serverSetupFixture,
      ),
    ) as FixtureRecord;
  });
}

// Everything the pages read and wrote, the fixture answered as the server does.
async function expectEverythingModelled(page: Page): Promise<void> {
  expect((await recordOf(page)).unmodeled).toEqual([]);
}

async function postsTo(
  page: Page,
  route: string,
): Promise<Array<Record<string, unknown>>> {
  return (await recordOf(page)).posts
    .filter((post: { url: string }) => {
      return post.url.endsWith(route);
    })
    .map((post: { body: Record<string, unknown> }) => {
      return post.body;
    });
}

async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

async function openSetup(page: Page, query: string = ""): Promise<Locator> {
  await open(page, `/admin/setup${query ? `?${query}` : ""}`);

  const checklist: Locator = page.getByTestId("server-setup-checklist");

  await expect(checklist).toBeVisible();
  return checklist;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

/*
 * How readable an element's words are on the surface they are drawn on:
 * the WCAG contrast ratio of its color to the first background behind it.
 */
async function contrastOf(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    const channels: (color: string) => Array<number> = (
      color: string,
    ): Array<number> => {
      return (color.match(/[\d.]+/g) || []).map(Number);
    };
    let surface: Array<number> = [255, 255, 255];
    let current: Element | null = element;

    while (current) {
      const color: Array<number> = channels(
        getComputedStyle(current).backgroundColor,
      );

      if (color.length >= 3 && (color.length < 4 || color[3]! > 0)) {
        surface = color.slice(0, 3);
        break;
      }

      current = current.parentElement;
    }

    const luminance: (rgb: Array<number>) => number = (
      rgb: Array<number>,
    ): number => {
      const [r, g, b] = rgb.map((value: number) => {
        const share: number = value / 255;

        return share <= 0.03928
          ? share / 12.92
          : Math.pow((share + 0.055) / 1.055, 2.4);
      });

      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const text: number = luminance(
      channels(getComputedStyle(element).color).slice(0, 3),
    );
    const back: number = luminance(surface);

    return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
  });
}

// The surface a card is drawn on: light, or dark in dark mode.
async function surfaceBrightnessOf(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    const queue: Array<Element> = [element];

    while (queue.length > 0) {
      const current: Element = queue.shift()!;
      const color: Array<number> = (
        getComputedStyle(current).backgroundColor.match(/[\d.]+/g) || []
      ).map(Number);

      if (color.length >= 3 && (color.length < 4 || color[3]! > 0)) {
        return (color[0]! + color[1]! + color[2]!) / 3;
      }

      queue.push(...Array.from(current.children));
    }

    return -1;
  });
}

interface DrawnStyle {
  underline: boolean;
  boxShadow: string;
  background: string;
  height: number;
}

async function drawnStyleOf(locator: Locator): Promise<DrawnStyle> {
  return await locator.evaluate((element: Element): DrawnStyle => {
    const style: CSSStyleDeclaration = getComputedStyle(element);

    return {
      underline: style.textDecorationLine.includes("underline"),
      boxShadow: style.boxShadow,
      background: style.backgroundColor,
      height: element.getBoundingClientRect().height,
    };
  });
}

/*
 * The actions drawn past their row's edges, read in one frame: none, in
 * any language. On a phone "How to back up with Docker Compose" ran 9px
 * past the card's edge until its words could wrap.
 */
async function actionsPastTheirRow(checklist: Locator): Promise<Array<string>> {
  return await checklist.evaluate((root: Element): Array<string> => {
    const past: Array<string> = [];

    for (const row of Array.from(root.querySelectorAll("li"))) {
      const edges: DOMRect = row.getBoundingClientRect();

      for (const action of Array.from(row.querySelectorAll("a, button"))) {
        const box: DOMRect = action.getBoundingClientRect();

        if (
          box.width > 0 &&
          (box.left < edges.left - 0.5 || box.right > edges.right + 0.5)
        ) {
          past.push(
            `${action.getAttribute("data-testid") || action.textContent}: ${Math.round(
              Math.max(edges.left - box.left, box.right - edges.right),
            )}px`,
          );
        }
      }
    }

    return past;
  });
}

async function isDark(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    return document.documentElement.classList.contains("dark");
  });
}

async function isPointerCoarse(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    return window.matchMedia("(pointer: coarse)").matches;
  });
}

// What a dialog says, without the marks that set code apart in a sentence.
async function dialogText(page: Page): Promise<string> {
  return ((await page.getByRole("dialog").textContent()) || "")
    .replace(/[⁦-⁩]/g, "")
    .replace(/\s+/g, " ");
}

async function submitDialog(page: Page): Promise<void> {
  await page
    .getByRole("dialog")
    .getByTestId("modal-footer-submit-button")
    .click();
}

const DEVICES: Array<{
  name: string;
  use: {
    viewport: { width: number; height: number };
    hasTouch?: boolean;
    isMobile?: boolean;
  };
}> = [
  { name: "laptop", use: { viewport: LAPTOP } },
  // A phone's width, and its finger: the media query (pointer: coarse) matches.
  { name: "phone", use: { viewport: PHONE, hasTouch: true, isMobile: true } },
];

for (const device of DEVICES) {
  test.describe(`Server setup on a ${device.name}`, () => {
    test.use(device.use);

    for (const theme of ["light", "dark"]) {
      test(`the groups, each fix loud and each choice quiet, and nothing past the window, ${theme}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const checklist: Locator = await openSetup(page, `theme=${theme}`);

        expect(await isDark(page)).toBe(theme === "dark");

        const brightness: number = await surfaceBrightnessOf(checklist);

        if (theme === "dark") {
          expect(brightness).toBeLessThan(90);
        } else {
          expect(brightness).toBeGreaterThan(200);
        }

        // Required, then recommended, open; optional folded until asked for.
        await expect(
          checklist.getByTestId("server-setup-required-progress"),
        ).toHaveText("0 of 3 done");
        await expect(
          checklist.getByTestId("server-setup-recommended-progress"),
        ).toHaveText("1 of 4 done");

        for (const row of ["email", "https", "signups"]) {
          await expect(
            checklist
              .getByTestId("server-setup-required")
              .getByTestId(`server-setup-${row}`),
          ).toBeVisible();
        }

        for (const row of [
          "sms-and-calls",
          "probes",
          "backups",
          "update-checks",
        ]) {
          await expect(
            checklist
              .getByTestId("server-setup-recommended")
              .getByTestId(`server-setup-${row}`),
          ).toBeVisible();
        }

        const toggle: Locator = checklist.getByTestId(
          "server-setup-optional-toggle",
        );

        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(
          checklist.getByTestId("server-setup-browser-push"),
        ).toHaveCount(0);

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");

        for (const row of ["browser-push", "ai-provider", "single-sign-on"]) {
          await expect(
            checklist
              .getByTestId("server-setup-optional")
              .getByTestId(`server-setup-${row}`),
          ).toBeVisible();
        }

        /*
         * The fix is a button's frame; the choice beside it muted,
         * underlined words with no frame (#7030) - and as readable.
         */
        const coarse: boolean = await isPointerCoarse(page);

        expect(coarse).toBe(device.name === "phone");

        for (const { row, choice, fix } of CHOICES) {
          const quiet: Locator = checklist.getByTestId(
            `server-setup-${row}-choose`,
          );

          await expect(quiet).toHaveText(choice);

          const quietStyle: DrawnStyle = await drawnStyleOf(quiet);
          const fixStyle: DrawnStyle = await drawnStyleOf(
            checklist.getByTestId(fix),
          );

          expect(quietStyle.underline, `${choice} is underlined`).toBe(true);
          expect(quietStyle.boxShadow, `${choice} has no frame`).toBe("none");
          expect(fixStyle.boxShadow, `${row}'s fix is framed`).not.toBe("none");
          expect(fixStyle.underline).toBe(false);
          expect(
            await contrastOf(quiet),
            `${choice} reads on its surface`,
          ).toBeGreaterThanOrEqual(4.5);

          if (coarse) {
            // A finger can hit it (Docs/ux/README.md).
            expect(quietStyle.height).toBeGreaterThanOrEqual(44);
          }
        }

        expect(await actionsPastTheirRow(checklist)).toEqual([]);
        await expectNoSidewaysScroll(page, {
          message: `Server setup on a ${device.name}, ${theme}`,
        });
        await screenshot(page, `setup-${device.name}-${theme}`);
        await expectEverythingModelled(page);
      });
    }

    test("the Dashboard's card: how many things are left, Finish setup, and Hide, light and dark", async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const theme of ["light", "dark"]) {
        await open(page, `/dashboard/home?theme=${theme}`);

        const card: Locator = page.getByTestId("server-setup-card");

        await expect(card).toBeVisible();
        await expect(page.getByTestId("server-setup-card-title")).toHaveText(
          "This server is not finished: 3 things to set up",
        );
        await expect(
          page.getByText("Only you see this, as the server's admin."),
        ).toBeVisible();
        expect(
          await contrastOf(page.getByTestId("server-setup-card-title")),
        ).toBeGreaterThanOrEqual(4.5);

        const finish: Locator = page.getByTestId("server-setup-card-finish");

        await expect(finish).toHaveText("Finish setup");
        expect(await finish.getAttribute("href")).toMatch(/\/admin\/setup$/);

        await expectNoSidewaysScroll(page, {
          message: `The card on a ${device.name}, ${theme}`,
        });
        await screenshot(page, `card-${device.name}-${theme}`);

        // Hidden for this admin, kept on the server.
        await page.getByTestId("server-setup-card-hide").click();
        await expect(card).toHaveCount(0);
        expect(
          await postsTo(page, "/global-config/setup-checklist/hide"),
        ).toEqual([{}]);
        await expect(page.getByTestId("fixture-home-rest")).toBeVisible();
        await expectEverythingModelled(page);
      }
    });
  });
}

test.describe("Server setup in German and in Persian, on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  for (const language of ["de", "fa"]) {
    test(`in ${language}: the page and the card in its words, read in its direction, nothing past the window`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const checklist: Locator = await openSetup(page, `lang=${language}`);

      expect(
        await page.evaluate((): string => {
          return document.documentElement.dir;
        }),
      ).toBe(language === "fa" ? "rtl" : "ltr");
      await expect(
        checklist.getByText(
          adminWord(language, "Finish setting up this server"),
        ),
      ).toBeVisible();
      await expect(
        checklist.getByTestId("server-setup-signups-choose"),
      ).toHaveText(adminWord(language, "Keep sign-ups open"));
      await expect(
        checklist.getByTestId("server-setup-email-route"),
      ).toHaveText(adminWord(language, "Set up email"));

      // What Email's settings are missing, in its words too, never English (#9437).
      const missing: Locator = checklist
        .getByTestId("server-setup-email-checked")
        .first();

      await expect(missing).toHaveText(
        adminWord(language, "Nothing is set up under Settings > Emails yet."),
      );
      await expect(missing).not.toContainText("Nothing is set up");

      // How far along each group is, in the digits its language writes.
      const progress: string =
        (await checklist
          .getByTestId("server-setup-required-progress")
          .textContent()) || "";

      if (language === "fa") {
        expect(progress).toContain("۰");
        expect(progress).toContain("۳");
        expect(progress).not.toMatch(/[0-9]/);
      } else {
        expect(progress).toContain("0");
        expect(progress).toContain("3");
      }

      await checklist.getByTestId("server-setup-optional-toggle").click();
      await expect(
        checklist.getByTestId("server-setup-browser-push-test-push"),
      ).toBeVisible();

      expect(await actionsPastTheirRow(checklist)).toEqual([]);
      await expectNoSidewaysScroll(page, {
        message: `Server setup in ${language} on a phone`,
      });
      await screenshot(page, `setup-phone-${language}`);

      // The Dashboard's card, in the Dashboard's words.
      await open(page, `/dashboard/home?lang=${language}`);

      const title: string = dashboardWord(
        language,
        "This server is not finished: {{count}} things to set up",
      );

      for (const part of title.split("{{count}}")) {
        if (part.trim()) {
          await expect(
            page.getByTestId("server-setup-card-title"),
          ).toContainText(part.trim());
        }
      }

      await expect(page.getByTestId("server-setup-card-hide")).toHaveText(
        dashboardWord(language, "Hide"),
      );
      await expect(page.getByTestId("server-setup-card-finish")).toHaveText(
        dashboardWord(language, "Finish setup"),
      );
      await expectNoSidewaysScroll(page, {
        message: `The card in ${language} on a phone`,
      });
      await screenshot(page, `card-phone-${language}`);
      await expectEverythingModelled(page);

      // A test SMS that sent nothing says what is missing in its words too (#9437).
      await open(
        page,
        `/admin/settings/call-and-sms?scene=untested&answer=not-set-up&lang=${language}`,
      );
      await page.getByTestId("server-test-sms").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByPlaceholder("+14155550100").fill("+14155550100");
      await submitDialog(page);

      const nothingSent: string = adminWord(
        language,
        "Nothing was sent: {{reason}}",
      ).replace(
        "{{reason}}",
        adminWord(
          language,
          "No Twilio account or SMS gateway is set up under Settings > Call and SMS.",
        ),
      );

      await expect
        .poll(async (): Promise<string> => {
          return await dialogText(page);
        })
        .toContain(nothingSent.replace(/\s+/g, " "));
      expect(await dialogText(page)).not.toContain("No Twilio account");
      await expectEverythingModelled(page);
    });
  }
});

test.describe("what Server setup's actions do", () => {
  test("a choice is made on the server and undone, each a quiet button", async ({
    page,
  }: {
    page: Page;
  }) => {
    const checklist: Locator = await openSetup(page);

    await checklist.getByTestId("server-setup-signups-choose").click();
    await expect(checklist.getByTestId("server-setup-signups")).toHaveAttribute(
      "data-done",
      "true",
    );
    await expect(
      checklist.getByTestId("server-setup-required-progress"),
    ).toHaveText("1 of 3 done");

    const undo: Locator = checklist.getByTestId("server-setup-signups-undo");

    await expect(undo).toHaveText("Undo");
    expect((await drawnStyleOf(undo)).boxShadow).toBe("none");

    await undo.click();
    await expect(checklist.getByTestId("server-setup-signups")).toHaveAttribute(
      "data-done",
      "false",
    );
    expect(
      await postsTo(page, "/global-config/setup-checklist/choice"),
    ).toEqual([
      { check: "signups", choice: "skipped" },
      { check: "signups", choice: null },
    ]);
    await expectEverythingModelled(page);
  });

  // #7460: one click from Server setup to the mail server's form.
  test("Set up email opens Settings > Emails in the mail server's form", async ({
    page,
  }: {
    page: Page;
  }) => {
    const checklist: Locator = await openSetup(page);

    await checklist.getByTestId("server-setup-email-route").click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Edit SMTP Config",
    });

    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Hostname", { exact: false }).first(),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/admin/settings/smtp");
    expect(new URL(page.url()).search).toBe("");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await screenshot(page, "set-up-email");
    await expectEverythingModelled(page);
  });

  // #9378: steps each install can run, both named while it is not known.
  test("How to back up: the install's own steps, or both, each named", async ({
    page,
  }: {
    page: Page;
  }) => {
    let checklist: Locator = await openSetup(page);

    const dockerCompose: Locator = checklist.getByTestId(
      "server-setup-backups-guide-0",
    );
    const kubernetes: Locator = checklist.getByTestId(
      "server-setup-backups-guide-1",
    );

    await expect(dockerCompose).toContainText(
      "How to back up with Docker Compose",
    );
    expect(await dockerCompose.getAttribute("href")).toBe(
      `${new URL(page.url()).origin}/docs/installation/docker-compose#back-up-and-restore`,
    );
    await expect(kubernetes).toContainText("How to back up on Kubernetes");
    expect(await kubernetes.getAttribute("href")).toBe(
      `${new URL(page.url()).origin}${HELM_BACKUP_GUIDE_PATH}`,
    );
    await expect(kubernetes).toHaveAttribute("target", "_blank");

    checklist = await openSetup(page, "install=kubernetes");

    const helm: Locator = checklist.getByTestId("server-setup-backups-guide");

    await expect(helm).toContainText("How to back up");
    await expect(helm).not.toContainText("Docker Compose");
    expect(await helm.getAttribute("href")).toBe(
      `${new URL(page.url()).origin}${HELM_BACKUP_GUIDE_PATH}`,
    );

    checklist = await openSetup(page, "install=docker-compose");

    const compose: Locator = checklist.getByTestId(
      "server-setup-backups-guide",
    );

    await expect(compose).not.toContainText("Kubernetes");
    expect(await compose.getAttribute("href")).toBe(
      `${new URL(page.url()).origin}/docs/installation/docker-compose#back-up-and-restore`,
    );
    await expectEverythingModelled(page);
  });
});

/*
 * What each test send answered, said where it was asked: accepted closes
 * its dialog and is said on the card; refused, or not set up, stays in the
 * dialog, in the provider's or the server's words.
 */
const ANSWERS: Array<{
  answer: string;
  email: string;
  sms: string;
  call: string;
  push: string;
}> = [
  {
    answer: "accepted",
    email: `${MAIL_SERVER} accepted the test email to ${ADMIN_EMAIL}.`,
    sms: "Twilio accepted the test SMS to +14155550100.",
    call: "Twilio accepted the test call to +14155550100.",
    push: "",
  },
  {
    answer: "refused",
    email: `${MAIL_SERVER} refused it: 535 5.7.8 Username and Password not accepted`,
    sms: "Twilio refused it: The 'From' phone number +14155550100 is not a valid, SMS-capable inbound phone number.",
    call: "Twilio refused it: The 'From' phone number +14155550100 is not a valid, voice-capable inbound phone number.",
    push: "None of your devices took the test push: Chrome on Linux: 410 Gone",
  },
  {
    answer: "not-set-up",
    email: "Nothing was sent: Nothing is set up under Settings > Emails yet.",
    sms: "Nothing was sent: No Twilio account or SMS gateway is set up under Settings > Call and SMS.",
    call: "Nothing was sent: No Twilio account or call gateway is set up under Settings > Call and SMS.",
    push: "Nothing was sent: You have no phone or browser registered for push notifications. Register one under User Settings > Notification Methods in the Dashboard.",
  },
];

test.describe("the test sends' answers", () => {
  for (const expected of ANSWERS) {
    const isAccepted: boolean = expected.answer === "accepted";

    test(`${expected.answer}: on Settings > Emails, Settings > Call and SMS and the push row`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // Settings > Emails: its card, and Send test email to the admin's own address.
      await open(
        page,
        `/admin/settings/smtp?scene=untested&answer=${expected.answer}`,
      );
      await expect(
        page.getByTestId("server-test-card-email-status"),
      ).toContainText("Set up, but not tested yet");

      await page.getByTestId("server-test-email").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByPlaceholder("you@company.com")).toHaveValue(
        ADMIN_EMAIL,
      );
      await submitDialog(page);

      if (isAccepted) {
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
          page.getByTestId("server-test-card-email-accepted"),
        ).toContainText(expected.email);
        // The card reads where email stands again: it worked.
        await expect(
          page.getByTestId("server-test-card-email-status"),
        ).toContainText(`${MAIL_SERVER} accepted an email on`);
      } else {
        await expect
          .poll(async (): Promise<string> => {
            return await dialogText(page);
          })
          .toContain(expected.email);
        await expect(
          page.getByTestId("server-test-card-email-accepted"),
        ).toHaveCount(0);
      }

      expect(await postsTo(page, "/server-test/email")).toEqual([
        { toEmail: ADMIN_EMAIL },
      ]);
      await screenshot(page, `test-email-${expected.answer}`);
      await expectEverythingModelled(page);

      // Settings > Call and SMS: Send test SMS and Make test call.
      for (const channel of ["sms", "call"]) {
        await open(
          page,
          `/admin/settings/call-and-sms?scene=untested&answer=${expected.answer}`,
        );
        await page.getByTestId(`server-test-${channel}`).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.getByPlaceholder("+14155550100").fill("+14155550100");
        await submitDialog(page);

        const words: string = channel === "sms" ? expected.sms : expected.call;

        if (isAccepted) {
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(
            page.getByTestId("server-test-card-sms-and-calls-accepted"),
          ).toContainText(words);
        } else {
          await expect
            .poll(async (): Promise<string> => {
              return await dialogText(page);
            })
            .toContain(words);
        }

        expect(await postsTo(page, `/server-test/${channel}`)).toEqual([
          { toPhone: "+14155550100" },
        ]);
        await expectEverythingModelled(page);
      }

      // Server setup's push row: Send test push, to the admin's own devices (#7028).
      const checklist: Locator = await openSetup(
        page,
        `answer=${expected.answer}`,
      );

      await checklist.getByTestId("server-setup-optional-toggle").click();
      await checklist
        .getByTestId("server-setup-browser-push-test-push")
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "A test notification goes to the phones and browsers you registered for push notifications, and to nobody else.",
      );
      await submitDialog(page);

      if (isAccepted) {
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } else {
        await expect
          .poll(async (): Promise<string> => {
            return await dialogText(page);
          })
          .toContain(expected.push);
      }

      // A test push asks for no address: it goes to whoever pressed it.
      expect(await postsTo(page, "/server-test/push")).toEqual([{}]);
      await screenshot(page, `test-push-${expected.answer}`);
      await expectEverythingModelled(page);
    });
  }
});
