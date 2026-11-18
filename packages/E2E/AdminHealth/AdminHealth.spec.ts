import { BrowserContext, expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * ADMIN > ONEUPTIME HEALTH, IN A BROWSER (#7048).
 *
 * The production landing page, against the fixture's in-page server
 * (AdminHealth/Fixture/Answers.js): "What needs attention" at its top - the
 * findings `npm run doctor` prints, worked out by the server's own rules -
 * then, on the Community Edition, the note about the Enterprise live
 * overview and the tools every edition has. What the component tests
 * cannot show is pinned here, at a laptop's and a phone's width, light and
 * dark, in German and Persian, and never a page that scrolls sideways:
 *
 *   - everything right in one line;
 *   - things to fix before things worth a look, each finding's title on a
 *     line of its own over what is wrong and its fix, where it is fixed a
 *     link away, and a long word (a migration's name) broken inside the
 *     card on a phone, not run out of it;
 *   - the doctor's command in the card's description, one box with a copy
 *     button;
 *   - a read that failed: what failed, the server's reference with its copy
 *     button, where to look - the command on one line, in Persian on a
 *     phone too (#7539) - no link to the page the reader is on, and Try
 *     again reading it again;
 *   - the Enterprise live overview as a short note, and the tools every
 *     edition has.
 *
 * Screenshots land in output/playwright/admin-health-ui/, for the people
 * who review the page.
 */

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/admin-health-ui",
);

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/AdminDashboard/src/Locales",
);

// The reference the fixture's failed read names (Fixture/Answers.js).
const REFERENCE: string = "9c4e1a07";

// The card's words, in English: the keys of the Admin Dashboard's locales.
const WORDS: {
  title: string;
  allRight: string;
  loadFailed: string;
  setupFix: string;
  readTheGuide: string;
  emailNotSetUp: string;
  whereToLook: string;
  serverDown: string;
} = {
  title: "What needs attention",
  allRight: "Everything looks right.",
  loadFailed: "What needs attention could not be read.",
  setupFix: "Finish it on the Server setup page.",
  readTheGuide: "Read the guide",
  emailNotSetUp:
    "Not set up yet: OneUptime cannot send invitations, password resets or alerts by email.",
  whereToLook:
    "To see what failed, run npm run doctor -- --logs in the server's oneuptime folder and look for this reference.",
  serverDown: "The OneUptime server did not answer.",
};

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

// Unicode's isolate marks, which set a sentence's values apart.
const ISOLATE_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
  "g",
);

// What a reader reads: the text without its isolate marks, spaces as one.
async function readText(locator: Locator): Promise<string> {
  return ((await locator.textContent()) || "")
    .replace(ISOLATE_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();
}

function spaced(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface FixtureRecord {
  reads: Array<string>;
  unmodeled: Array<Record<string, unknown>>;
}

async function recordOf(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __adminHealthFixture: FixtureRecord })
          .__adminHealthFixture,
      ),
    ) as FixtureRecord;
  });
}

// The card, once it has drawn the server's answer.
async function open(
  page: Page,
  options: {
    scene?: "attention" | "all-right" | "reference" | "down" | undefined;
    lang?: "de" | "fa" | undefined;
    theme?: "dark" | undefined;
    size?: { width: number; height: number } | undefined;
  } = {},
): Promise<Locator> {
  await page.setViewportSize(options.size || LAPTOP);

  const query: URLSearchParams = new URLSearchParams({
    scene: options.scene || "attention",
  });

  if (options.lang) {
    query.set("lang", options.lang);
  }

  if (options.theme) {
    query.set("theme", options.theme);
  }

  await page.goto(`/admin/health?${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });

  // The first load parses the bundle.
  const card: Locator = page.getByTestId("installation-health");
  await expect(card).toBeVisible({ timeout: 60000 });

  return card;
}

async function shoot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `admin-health-${name}.png`),
    fullPage: true,
  });
}

// Everything the page read, the fixture answered as the server does.
async function expectEverythingModelled(page: Page): Promise<void> {
  expect((await recordOf(page)).unmodeled).toEqual([]);
}

/*
 * Each box of a locator laid out on one line: its text's line boxes share
 * one top.
 */
async function linesOf(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    const tops: Set<number> = new Set<number>();

    for (const rect of Array.from(element.getClientRects())) {
      if (rect.width > 0) {
        tops.add(Math.round(rect.top));
      }
    }

    return tops.size;
  });
}

test.describe("Admin > OneUptime Health: What needs attention", () => {
  test("a healthy server says so in one line, at a laptop's and a phone's width, light and dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [LAPTOP, PHONE]) {
      for (const theme of [undefined, "dark" as const]) {
        const card: Locator = await open(page, {
          scene: "all-right",
          size,
          theme,
        });
        const allRight: Locator = card.getByTestId(
          "installation-health-all-right",
        );

        await expect(allRight).toHaveText(WORDS.allRight);
        await expect(card.getByRole("listitem")).toHaveCount(0);
        await expectNoSidewaysScroll(page, {
          message: `all right, ${size.width}${theme ? ", dark" : ""}`,
        });
        await shoot(page, `all-right-${size.width}${theme ? "-dark" : ""}`);
      }
    }

    await expectEverythingModelled(page);
  });

  test("things to fix come before things worth a look, each title on a line of its own over what is wrong and its fix, where it is fixed a link away", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page);
    const rows: Locator = card.getByRole("listitem");

    // Worst first, by the server's own rules.
    await expect(rows).toHaveCount(5);
    expect(
      await rows.evaluateAll((items: Array<Element>): Array<string> => {
        return items.map((item: Element): string => {
          return `${item.getAttribute("data-level")} ${item.getAttribute("data-testid")}`;
        });
      }),
    ).toEqual([
      "fix installation-health-migration-failed",
      "fix installation-health-setup-email",
      "warn installation-health-clickhouse-disk",
      "warn installation-health-setup-probes",
      "warn installation-health-update-available",
    ]);

    // The title over what is wrong, never run into it.
    for (const index of [0, 1, 2, 3, 4]) {
      const row: Locator = rows.nth(index);
      const [title, words] = await Promise.all([
        row.getByTestId("installation-health-finding-title").boundingBox(),
        row.getByTestId("installation-health-finding-words").boundingBox(),
      ]);

      expect(title).not.toBeNull();
      expect(words).not.toBeNull();
      expect(title!.y + title!.height).toBeLessThanOrEqual(words!.y + 1);
    }

    const email: Locator = card.getByTestId("installation-health-setup-email");

    await expect(
      email.getByTestId("installation-health-finding-words"),
    ).toHaveText(WORDS.emailNotSetUp);
    // A step of the server setup checklist is finished on its own page.
    await expect(
      email.getByRole("link", { name: WORDS.setupFix }),
    ).toHaveAttribute("href", "/admin/setup");
    // A finding with a page of its own links it.
    await expect(
      card
        .getByTestId("installation-health-migration-failed")
        .getByRole("link", { name: "Database migrations" }),
    ).toHaveAttribute("href", "/admin/health/migrations");
    // A guide opens in a new tab.
    const guide: Locator = card
      .getByTestId("installation-health-update-available")
      .getByRole("link", { name: WORDS.readTheGuide });

    await expect(guide).toHaveAttribute("href", "/docs/installation/upgrading");
    await expect(guide).toHaveAttribute("target", "_blank");

    // Red for what is broken, amber for what is worth a look.
    const colorOf: (testId: string) => Promise<string> = async (
      testId: string,
    ): Promise<string> => {
      return await card
        .getByTestId(testId)
        .locator("svg")
        .first()
        .evaluate((icon: Element): string => {
          return window.getComputedStyle(icon).color;
        });
    };
    const fixColor: string = await colorOf("installation-health-setup-email");
    const warnColor: string = await colorOf("installation-health-setup-probes");

    expect(fixColor).not.toBe(warnColor);

    await expectNoSidewaysScroll(page, { message: "attention, 1280" });
    await shoot(page, "attention-1280");
    await expectEverythingModelled(page);
  });

  test("on a phone, a word too long for the line breaks inside the card rather than run out of it, light and dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of [undefined, "dark" as const]) {
      const card: Locator = await open(page, { size: PHONE, theme });
      const list: Locator = card.getByRole("list");
      const words: Locator = card
        .getByTestId("installation-health-migration-failed")
        .getByTestId("installation-health-finding-words");

      await expect(words).toContainText("AddIncidentLabelsIndex");

      const [listBox, overflow] = await Promise.all([
        list.boundingBox(),
        words.evaluate((element: Element): number => {
          return element.scrollWidth - element.clientWidth;
        }),
      ]);
      const wordsBox: { x: number; width: number } | null =
        await words.boundingBox();

      expect(overflow).toBeLessThanOrEqual(0);
      expect(wordsBox!.x + wordsBox!.width).toBeLessThanOrEqual(
        listBox!.x + listBox!.width,
      );
      await expectNoSidewaysScroll(page, {
        message: `attention, 390${theme ? ", dark" : ""}`,
      });
      await shoot(page, `attention-390${theme ? "-dark" : ""}`);
    }
  });

  test("its description draws npm run doctor as one box with a copy button that copies it", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);

    const description: Locator = page.getByTestId(
      "installation-health-description",
    );
    const command: Locator = description.getByTestId(
      "error-where-to-look-command",
    );

    await expect(command.locator("code")).toHaveText("npm run doctor");
    expect(await linesOf(command.locator("code"))).toBe(1);

    await command.getByRole("button").click();
    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe("npm run doctor");
  });

  test("a read the server could not explain says what failed, its reference and where to look, with no link to the page it is on, and Try again reads it again", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const card: Locator = await open(page, { scene: "reference" });

    await expect(card.getByTestId("error-what-failed")).toHaveText(
      WORDS.loadFailed,
    );

    // The reference, in code, with its copy button, centred under the lines above it.
    const reference: Locator = card.getByTestId("error-reference");

    await expect(reference.locator("code")).toHaveText(REFERENCE);

    const [referenceBox, cardBox] = await Promise.all([
      reference.locator("code").boundingBox(),
      card.boundingBox(),
    ]);
    const referenceRowCentre: number =
      referenceBox!.x +
      ((await reference.getByRole("button").boundingBox())!.x +
        (await reference.getByRole("button").boundingBox())!.width -
        referenceBox!.x) /
        2;

    expect(
      Math.abs(referenceRowCentre - (cardBox!.x + cardBox!.width / 2)),
    ).toBeLessThan(12);

    // Where to look: the doctor's command, one box on one line, with a copy button.
    const whereToLook: Locator = card.getByTestId("error-where-to-look");

    expect(spaced(await readText(whereToLook))).toBe(spaced(WORDS.whereToLook));

    const command: Locator = whereToLook.getByTestId(
      "error-where-to-look-command",
    );

    await expect(command.locator("code")).toHaveText(
      "npm run doctor -- --logs",
    );
    expect(await linesOf(command.locator("code"))).toBe(1);
    await command.getByRole("button").click();
    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe("npm run doctor -- --logs");

    // The reader is on OneUptime Health: nothing sends them to it.
    await expect(card.getByTestId("error-open-health")).toHaveCount(0);

    await shoot(page, "reference-1280");

    const readsBefore: number = (await recordOf(page)).reads.filter(
      (url: string): boolean => {
        return url.endsWith("/admin/health/doctor");
      },
    ).length;

    await card.getByRole("button", { name: "Try again" }).click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recordOf(page)).reads.filter((url: string): boolean => {
          return url.endsWith("/admin/health/doctor");
        }).length;
      })
      .toBe(readsBefore + 1);
    await expect(card.getByTestId("error-what-failed")).toBeVisible();
    await expectEverythingModelled(page);
  });

  test("in Persian on a phone, a failed read keeps the command one box on one line, read left to right", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, {
      scene: "reference",
      lang: "fa",
      size: PHONE,
    });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(card.getByTestId("error-what-failed")).toHaveText(
      adminWord("fa", WORDS.loadFailed),
    );

    const whereToLook: Locator = card.getByTestId("error-where-to-look");

    expect(spaced(await readText(whereToLook))).toBe(
      spaced(adminWord("fa", WORDS.whereToLook)),
    );

    const code: Locator = whereToLook
      .getByTestId("error-where-to-look-command")
      .locator("code");

    await expect(code).toHaveText("npm run doctor -- --logs");
    await expect(code).toHaveAttribute("dir", "ltr");
    expect(await linesOf(code)).toBe(1);
    await expectNoSidewaysScroll(page, { message: "Persian reference, 390" });
    await shoot(page, "reference-fa-390");
  });

  test("a gateway's 502 says the server did not answer, with where to look and no reference", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { scene: "down", theme: "dark" });

    await expect(card.getByTestId("error-what-failed")).toHaveText(
      WORDS.loadFailed,
    );
    await expect(card.getByTestId("error-why-and-next")).toContainText(
      WORDS.serverDown,
    );
    await expect(card.getByTestId("error-reference")).toHaveCount(0);
    await expect(
      card.getByTestId("error-where-to-look-command").locator("code"),
    ).toHaveText("npm run doctor");
    await shoot(page, "down-1280-dark");
  });

  for (const language of ["de", "fa"] as Array<"de" | "fa">) {
    test(`reads wholly in ${language}, at a laptop's and a phone's width`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const size of [LAPTOP, PHONE]) {
        const card: Locator = await open(page, { lang: language, size });

        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          language === "fa" ? "rtl" : "ltr",
        );
        await expect(
          page.getByText(adminWord(language, WORDS.title)).first(),
        ).toBeVisible();

        const email: Locator = card.getByTestId(
          "installation-health-setup-email",
        );

        expect(
          spaced(
            await readText(
              email.getByTestId("installation-health-finding-words"),
            ),
          ),
        ).toBe(spaced(adminWord(language, WORDS.emailNotSetUp)));
        await expect(
          email.getByRole("link", {
            name: adminWord(language, WORDS.setupFix),
          }),
        ).toBeVisible();
        // Nothing of the card is left in English.
        expect(await readText(card)).not.toContain(WORDS.emailNotSetUp);
        expect(await readText(card)).not.toContain(WORDS.setupFix);

        // Right to left in Persian: the icon at the row's start, on its right.
        if (language === "fa") {
          const row: Locator = card.getByRole("listitem").first();
          const [icon, words] = await Promise.all([
            row.locator("svg").first().boundingBox(),
            row.getByTestId("installation-health-finding-words").boundingBox(),
          ]);

          expect(icon!.x).toBeGreaterThan(words!.x);
        }

        await expectNoSidewaysScroll(page, {
          message: `${language}, ${size.width}`,
        });
        await shoot(page, `attention-${language}-${size.width}`);
      }
    });
  }
});

test.describe("Admin > OneUptime Health on the Community Edition", () => {
  test("the Enterprise live overview is a short note, and the tools every edition has are a click away, under what needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page);

    await expect(page.getByText("Live instance health")).toBeVisible();

    const tools: Locator = page
      .getByText("Available on every edition")
      .locator("xpath=ancestor::div[.//a][1]");

    for (const [name, route] of [
      ["ClickHouse", "/admin/health/clickhouse"],
      ["Instance Logs", "/admin/health/instance-logs"],
      ["Global Probes", "/admin/health/probes"],
      ["Migrations", "/admin/health/migrations"],
      ["Support Bundle", "/admin/health/support-bundle"],
    ]) {
      await expect(
        tools.getByRole("link", { name: new RegExp(`^${name}`) }),
      ).toHaveAttribute("href", route!);
    }

    // What needs attention comes first.
    const [cardBox, toolsBox] = await Promise.all([
      card.boundingBox(),
      page.getByText("Available on every edition").boundingBox(),
    ]);

    expect(cardBox!.y).toBeLessThan(toolsBox!.y);

    // The page read the doctor's answer, ClickHouse at a glance and who shares an address.
    expect(
      new Set(
        (await recordOf(page)).reads.map((url: string): string => {
          return new URL(url).pathname;
        }),
      ),
    ).toEqual(
      new Set([
        "/api/admin/health/doctor",
        "/api/admin/health/clickhouse-capacity",
        "/api/admin/health/visitor-addresses",
      ]),
    );
    await expectEverythingModelled(page);
  });
});
