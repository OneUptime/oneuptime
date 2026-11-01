import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * How Data Security's pages read, as its UI review left them: every list
 * fits a laptop's card beside the side menu, the Overview's figures line
 * up and its day chart keeps its dates inside it in the reader's language,
 * a store names its owners, an issue says what is wrong on a phone, the
 * menu's names translate as nouns, Compliance says why a framework has no
 * score, a store's scans read as the product's do, and a new project, a
 * busy one and one whose reads fail each read as they should.
 *
 * Against the same offline fixture as DataSecurity.spec.ts (the product's
 * real route tree, only the data boundary synthetic), with its ?data= and
 * ?fail= scenarios. Screenshots land in output/playwright/data-security-ui/.
 */

const PORT: string = process.env["DATA_SECURITY_FIXTURE_PORT"] || "4255";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

const BASE: string = `/dashboard/${PROJECT_ID}/data-security`;
const BUCKET: string = "20000000-0000-4000-8000-000000000001";
const PUBLIC_BUCKET_ISSUE: string = "30000000-0000-4000-8000-000000000001";
const STORE: string = `${BASE}/stores/${BUCKET}`;
const ISSUE: string = `${BASE}/issues/${PUBLIC_BUCKET_ISSUE}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/data-security-ui",
);

// Beside the side menu at 1280 pixels a card is about 875 wide.
const LAPTOP: number = 1280;
const PHONE: number = 390;

const WHITESPACE: RegExp = /\s+/g;

interface OpenOptions {
  width?: number | undefined;
  lang?: "en" | "de" | "fa" | undefined;
  theme?: "light" | "dark" | undefined;
  data?: "default" | "empty" | "busy" | undefined;
  fail?: "reads" | undefined;
}

// A piece of a store's kind-and-region line, as drawn.
interface StorePiece {
  text: string;
  cut: boolean;
  inside: boolean;
  top: number;
}

interface UnhandledRequest {
  kind: string;
  modelName?: string;
  url?: string;
}

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();
const abortedRequests: WeakMap<Page, Array<string>> = new WeakMap();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<UnhandledRequest> | null = await page
    .evaluate((): Array<UnhandledRequest> => {
      return JSON.parse(
        JSON.stringify(
          (
            window as unknown as {
              __dataSecurityFixture: { unhandled: Array<UnhandledRequest> };
            }
          ).__dataSecurityFixture.unhandled,
        ),
      ) as Array<UnhandledRequest>;
    })
    .catch(() => {
      return null;
    });

  if (unhandled) {
    expect(unhandled, "requests the fixture does not model").toEqual([]);
  }
});

async function open(
  page: Page,
  pathname: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({ width: options.width || LAPTOP, height: 1000 });
  await page.clock.setFixedTime(NOW);
  const params: URLSearchParams = new URLSearchParams();
  if (options.lang && options.lang !== "en") {
    params.set("lang", options.lang);
  }
  if (options.theme === "dark") {
    params.set("theme", "dark");
  }
  if (options.data && options.data !== "default") {
    params.set("data", options.data);
  }
  if (options.fail) {
    params.set("fail", options.fail);
  }
  const query: string = params.toString();
  await page.goto(query ? `${pathname}?${query}` : pathname);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // A dialog or a menu grows in over 150ms: read boxes once it is at rest.
  await page.waitForTimeout(300);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

interface TableFit {
  heads: string;
  overflow: number;
}

/*
 * How far past its card each table on the page runs: 0 when the table is no
 * wider than the box it scrolls in. A table wider than its card scrolls
 * sideways under its sticky Actions column, its last columns out of sight.
 */
async function tableFits(page: Page): Promise<Array<TableFit>> {
  return page.evaluate((): Array<TableFit> => {
    return Array.from(document.querySelectorAll("table")).map(
      (table: HTMLTableElement): TableFit => {
        let box: HTMLElement | null = table.parentElement;

        while (box && getComputedStyle(box).overflowX === "visible") {
          box = box.parentElement;
        }

        const heads: string = Array.from(table.querySelectorAll("thead th"))
          .map((cell: Element): string => {
            return (cell.textContent || "").trim();
          })
          .join(" | ");

        return {
          heads,
          overflow: box
            ? Math.max(0, Math.round(box.scrollWidth - box.clientWidth))
            : 0,
        };
      },
    );
  });
}

/*
 * ---------------------------------------------------------------------------
 * Every list fits a laptop's card
 * ---------------------------------------------------------------------------
 */

const LISTS: ReadonlyArray<[string, string]> = [
  ["Data Stores", `${BASE}/stores`],
  ["Issues", `${BASE}/issues`],
  ["Sensitive Data", `${BASE}/sensitive-data`],
  ["In Your Telemetry", `${BASE}/telemetry`],
  ["Data Flows", `${BASE}/flows`],
  ["Access", `${BASE}/access`],
  ["Scans", `${BASE}/scans`],
  ["a store's What's Inside", `${STORE}/inside`],
  ["a store's Who Can Reach It", `${STORE}/access`],
  ["a store's Issues", `${STORE}/issues`],
  ["a store's Data Flows", `${STORE}/flows`],
  ["a store's Scans", `${STORE}/scans`],
];

test.describe("every list fits a laptop's card beside the side menu", () => {
  for (const [name, pathname] of LISTS) {
    test(`${name}, in German and Persian, with a busy project`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // German's words are the longest; Persian reads right to left.
      for (const options of [
        { data: "busy", lang: "de" },
        { data: "busy", lang: "fa" },
      ] as Array<OpenOptions>) {
        await open(page, pathname, options);
        await expect(page.locator("table").first()).toBeVisible();
        await settle(page);

        const fits: Array<TableFit> = await tableFits(page);

        expect(fits.length).toBeGreaterThan(0);

        for (const fit of fits) {
          expect(
            fit.overflow,
            `${name} (${JSON.stringify(options)}): ${fit.heads}`,
          ).toBe(0);
        }
      }
    });
  }

  test("Data Stores reads name, sensitivity, exposure and risk; the rest are a click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/stores`, { data: "busy" });
    const table: Locator = page.locator("table").first();
    await expect(table).toBeVisible();

    const heads: string = (await table.locator("thead").innerText()).replace(
      WHITESPACE,
      " ",
    );

    for (const column of ["Name", "Sensitivity", "Exposure", "Risk"]) {
      expect(heads).toContain(column);
    }

    for (const column of [
      "Data Types",
      "Owners",
      "Environment",
      "Last Checked",
      "Open Issues",
    ]) {
      expect(heads).not.toContain(column);
    }

    // The riskiest store first: its score, its worst issue and how many are open.
    const first: Locator = table.locator("tbody tr").first();
    await expect(first).toContainText("customer-exports");
    await expect(first).toContainText("94");
    await expect(first).toContainText("Critical");
    await expect(first).toContainText("2 open issues");

    await screenshot(page, "layout-stores-busy-1280");
  });

  /*
   * A store's name is cut to its column; its kind and region never are: the
   * region moves under the kind when the two do not fit side by side. A
   * name reads left to right on a Persian page too, so it is cut at its own
   * end there as well - cut from the right it lost its start.
   */
  test("Data Stores keeps each store's kind and region whole, and cuts a long name at its end in Persian too", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const lang of ["en", "fa"] as Array<"en" | "fa">) {
      await open(page, `${BASE}/stores`, { data: "busy", lang });
      await expect(page.locator("table").first()).toBeVisible();
      await settle(page);

      // Each row's kind, then its region: whole, and inside the cell.
      const rows: Array<Array<StorePiece>> = await page
        .getByTestId("data-store-kind-and-region")
        .evaluateAll((elements: Array<Element>): Array<Array<StorePiece>> => {
          return elements.map((element: Element): Array<StorePiece> => {
            const clip: DOMRect = element.getBoundingClientRect();

            return Array.from(element.querySelectorAll("span")).map(
              (piece: HTMLSpanElement): StorePiece => {
                const words: Range = document.createRange();
                words.selectNodeContents(piece);
                const box: DOMRect = words.getBoundingClientRect();

                return {
                  text: piece.textContent || "",
                  cut: piece.scrollWidth > piece.clientWidth + 1,
                  inside:
                    box.left >= clip.left - 1 && box.right <= clip.right + 1,
                  top: box.top,
                };
              },
            );
          });
        });

      // A full page of stores, each with its kind and its region.
      expect(rows.length).toBe(10);

      for (const pieces of rows) {
        expect(pieces.length).toBe(2);

        for (const piece of pieces) {
          expect(piece.cut, `${lang}: ${piece.text} is cut`).toBe(false);
          expect(piece.inside, `${lang}: ${piece.text} shows whole`).toBe(true);
        }
      }

      // A short pair shares its line; a long one puts the region under it.
      const besideItsKind: Array<boolean> = rows.map(
        (pieces: Array<StorePiece>): boolean => {
          return Math.abs(pieces[1]!.top - pieces[0]!.top) < 2;
        },
      );
      expect(besideItsKind).toContain(true);
      expect(besideItsKind).toContain(false);

      const cutNames: Array<{ text: string; startShows: boolean }> = await page
        .getByTestId("data-store-name")
        .evaluateAll(
          (
            elements: Array<Element>,
          ): Array<{ text: string; startShows: boolean }> => {
            return elements
              .filter((element: Element): boolean => {
                return element.scrollWidth > element.clientWidth + 1;
              })
              .map(
                (element: Element): { text: string; startShows: boolean } => {
                  const box: DOMRect = element.getBoundingClientRect();
                  const text: Node | null = document
                    .createTreeWalker(element, NodeFilter.SHOW_TEXT)
                    .nextNode();
                  const firstLetter: Range = document.createRange();
                  firstLetter.setStart(text!, 0);
                  firstLetter.setEnd(text!, 1);
                  const letterBox: DOMRect =
                    firstLetter.getBoundingClientRect();

                  return {
                    text: element.textContent || "",
                    startShows:
                      letterBox.left >= box.left - 1 &&
                      letterBox.right <= box.right + 1,
                  };
                },
              );
          },
        );

      expect(cutNames.length).toBeGreaterThan(0);

      for (const name of cutNames) {
        expect(name.startShows, `${lang}: ${name.text} keeps its start`).toBe(
          true,
        );
      }
    }
  });

  test("Issues reads severity, issue, store and risk; an accepted issue says so beside its title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/issues`);
    const table: Locator = page.locator("table").first();
    await expect(table).toBeVisible();

    const heads: string = (await table.locator("thead").innerText()).replace(
      WHITESPACE,
      " ",
    );

    for (const column of ["Severity", "Issue", "Data Store", "Risk Score"]) {
      expect(heads).toContain(column);
    }

    for (const column of ["Data Types", "Assignee", "Status"]) {
      expect(heads).not.toContain(column);
    }

    // The list opens on the open issues: none says where it stands.
    await expect(table.locator("tbody")).not.toContainText("Accepted");

    // A store's accepted issue still says so, beside its title.
    await open(page, `${STORE}/issues`);
    const accepted: Locator = page
      .locator("table")
      .nth(1)
      .locator("tbody tr")
      .first();
    await expect(accepted).toContainText("Unencrypted connections are allowed");
    await expect(accepted).toContainText("Accepted");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Overview
 * ---------------------------------------------------------------------------
 */

test.describe("the Overview", () => {
  test("its four figures' numbers sit on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, BASE);
    const figures: Locator = page.getByRole("group", {
      name: "Data security figures",
    });
    await expect(figures).toBeVisible();
    await settle(page);

    const tops: Array<number> = await figures.evaluate(
      (bar: Element): Array<number> => {
        return Array.from(bar.children).map((cell: Element): number => {
          const value: Element | null = cell.children.item(1);
          return value ? Math.round(value.getBoundingClientRect().top) : -1;
        });
      },
    );

    expect(tops).toHaveLength(4);
    expect(new Set(tops).size, `the values' tops: ${tops.join(", ")}`).toBe(1);
    await expect(figures).toContainText("Exposed Stores");
    await expect(figures).toContainText("In Your Telemetry");
    await expect(figures).toContainText("Not scrubbed, of 1 finding");
  });

  test("Fix These First names each issue in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, BASE, { lang: "de" });
    const charts: Locator = page.getByTestId("data-security-overview-charts");
    await expect(charts).toContainText("Jeder im Internet kann ihn lesen");
    await expect(charts).not.toContainText(
      "Anyone on the internet can read it",
    );
  });

  test("each data category opens Sensitive Data", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, BASE);
    await page
      .getByTestId("data-security-overview-charts")
      .getByRole("link", { name: "Financial" })
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${BASE}/sensitive-data`;
    });
  });

  /*
   * A laptop's chart has room for five dates; a phone's keeps the first, the
   * middle and the last - five ran into each other there where months are
   * long ("28. Sept.5. Okt.", Persian's "۵ اکتبر۲۸ سپتامبر"). Each date in
   * the reader's language, inside the chart and apart from the next.
   */
  const CHART_CASES: Array<{
    width: number;
    lang: "en" | "de" | "fa";
    count: number;
    lastDate: string;
  }> = [
    { width: LAPTOP, lang: "en", count: 5, lastDate: "Oct 27" },
    { width: LAPTOP, lang: "fa", count: 5, lastDate: "۲۷ اکتبر" },
    { width: PHONE, lang: "de", count: 3, lastDate: "27. Okt." },
    { width: PHONE, lang: "fa", count: 3, lastDate: "۲۷ اکتبر" },
  ];

  for (const chartCase of CHART_CASES) {
    test(`the day chart's dates stay inside it and apart, at ${chartCase.width} pixels in ${chartCase.lang}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, BASE, { width: chartCase.width, lang: chartCase.lang });
      const card: Locator = page
        .getByTestId("data-security-overview-coverage")
        .locator("[role=img]")
        .first();
      await expect(card).toBeVisible();
      await settle(page);

      const labels: Locator = page
        .getByTestId("stacked-day-bars-label")
        .filter({ visible: true });
      await expect(labels).toHaveCount(chartCase.count);
      // Today's date is the last one written, at the chart's far end.
      await expect(labels.last()).toHaveText(chartCase.lastDate);

      const chart: { left: number; right: number } = await card.evaluate(
        (element: Element): { left: number; right: number } => {
          const box: DOMRect = element.getBoundingClientRect();
          return { left: box.left, right: box.right };
        },
      );

      // Left to right as drawn: a Persian chart runs from right to left.
      const boxes: Array<{ left: number; right: number }> = (
        await labels.evaluateAll(
          (
            elements: Array<Element>,
          ): Array<{ left: number; right: number }> => {
            return elements.map(
              (element: Element): { left: number; right: number } => {
                const box: DOMRect = element.getBoundingClientRect();
                return { left: box.left, right: box.right };
              },
            );
          },
        )
      ).sort(
        (
          a: { left: number; right: number },
          b: { left: number; right: number },
        ): number => {
          return a.left - b.left;
        },
      );

      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(chart.left - 1);
        expect(box.right).toBeLessThanOrEqual(chart.right + 1);
      }

      for (let index: number = 1; index < boxes.length; index++) {
        expect(
          boxes[index]!.left - boxes[index - 1]!.right,
          `label ${index} starts at least 4 pixels after label ${index - 1} ends`,
        ).toBeGreaterThanOrEqual(4);
      }
    });
  }

  test("a new project starts with the three steps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, BASE, { data: "empty" });
    await expect(page.getByText("Find your sensitive data")).toBeVisible();
    await expect(
      page.getByText("Connect a cloud account").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Review what to fix first").first(),
    ).toBeVisible();
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);
    await screenshot(page, "layout-overview-new-project-1280");
  });

  test("when every read fails, the Overview and a list say so and offer a way back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, BASE, { fail: "reads" });
    await expect(
      page.getByText("OneUptime could not be reached. Try again in a minute."),
    ).toBeVisible();
    await expect(page.getByText("Refresh?")).toBeVisible();

    await open(page, `${BASE}/stores`, { fail: "reads" });
    await expect(
      page
        .getByText("OneUptime could not be reached. Try again in a minute.")
        .first(),
    ).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * A store, and an issue
 * ---------------------------------------------------------------------------
 */

test.describe("a store's Overview", () => {
  test("names its owners, and keeps What's Inside's figures on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STORE);
    const owners: Locator = page.getByTestId("data-store-owners-list");
    await expect(owners).toContainText("Diego Alvarez");
    await expect(owners).toContainText("diego.alvarez@acme-commerce.example");

    // Scan Now on What's Inside's title line, as Check Now on Configuration's.
    const inside: Locator = page.getByRole("heading", {
      name: "What's Inside",
    });
    const scanNow: Locator = page.getByRole("button", { name: "Scan Now" });
    const titleBox: { y: number; height: number } | null =
      await inside.boundingBox();
    const buttonBox: { y: number; height: number } | null =
      await scanNow.boundingBox();
    expect(
      Math.abs(
        titleBox!.y +
          titleBox!.height / 2 -
          (buttonBox!.y + buttonBox!.height / 2),
      ),
    ).toBeLessThan(8);

    await expect(
      page.getByRole("link", { name: "See every finding" }),
    ).toHaveAttribute("href", `${STORE}/inside`);

    await screenshot(page, "layout-store-overview-1280");
  });

  test("writes what the server stores in English in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STORE, { lang: "de" });
    const about: Locator = page.locator("#data-store-about");
    await expect(about).toContainText("Produktion");
    await expect(about).toContainText("Cloud-Inventar");
    await expect(about).toContainText("Erfolgreich");
    await expect(about).not.toContainText("Cloud inventory");
    await expect(about).not.toContainText("Succeeded");
  });

  test("in Persian, the cloud's own reason reads the way it is written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STORE, { lang: "fa" });
    const reason: Locator = page
      .getByTestId("data-store-public-reason")
      .locator("bdi");
    await expect(reason).toHaveAttribute("dir", "ltr");
    // Its full stop at its end, not at its start.
    await expect(reason).toHaveText(
      'The bucket policy grants s3:GetObject to Principal "*".',
    );
  });

  test("its Scans read as the product's: when, what was read and the details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STORE}/scans`);
    const rows: Locator = page.locator("table").first().locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText("5 hours ago");
    await expect(rows.nth(1)).toContainText("24 objects");
    await rows.nth(1).getByRole("button", { name: "Show details" }).click();
    await expect(rows.nth(1)).toContainText("exports/orders-2026-10-26.csv");
    await expect(rows.nth(1)).toContainText(
      "is larger than the 50 MB a sample reads",
    );
  });
});

test.describe("an issue", () => {
  test("says what is wrong and why it matters on a phone too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ISSUE, { width: PHONE });
    await expect(
      page.getByTestId("data-security-issue-what-is-wrong"),
    ).toContainText("let anyone read its data without signing in");
    await expect(
      page.getByTestId("data-security-issue-why-it-matters"),
    ).toBeVisible();
    await screenshot(page, "layout-issue-390");
  });

  test("Accept Risk quotes the issue's title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ISSUE);
    await page.getByRole("button", { name: "Accept Risk" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      'Accept the risk of "Anyone on the internet can read it" until a date.',
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Settings, the menu and Compliance
 * ---------------------------------------------------------------------------
 */

test.describe("the menu", () => {
  test("Scans sit in Advanced, and the settings page is Scan Settings - never 'Scan läuft'", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/scans`);
    const scans: Locator = page.getByRole("link", { name: "Scans" }).first();
    await expect(scans).toBeVisible();
    await expect(page.getByText("Archived Stores")).toBeVisible();
    await expect(page.getByText("Scanning", { exact: true })).toHaveCount(0);

    await open(page, `${BASE}/settings/scanning`, { lang: "de" });
    await expect(
      page.getByRole("link", { name: "Scan-Einstellungen" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Scan läuft")).toHaveCount(0);
  });

  test("the incident and alert severity pickers keep German's placeholder on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/settings/scanning`, { lang: "de" });
    const placeholder: Locator = page
      .getByTestId("data-security-alert-severity")
      .getByText("Der höchste Schweregrad des Projekts", { exact: true });
    await expect(placeholder).toBeVisible();
    const box: { height: number } | null = await placeholder.boundingBox();
    // One line of 14px text.
    expect(box!.height).toBeLessThan(28);
  });

  test("each check's severities sit on one line under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/settings/checks`);
    const severities: Locator = page.getByTestId(
      "data-security-check-public-read-severities",
    );
    await expect(severities).toHaveText(
      "RestrictedCriticalConfidentialCriticalInternalHighPublicLow",
    );
    const box: { height: number } | null = await severities.boundingBox();
    expect(box!.height).toBeLessThan(24);
  });
});

test.describe("Compliance", () => {
  test("a framework without a score says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/compliance`);
    const tiles: Locator = page.getByTestId(
      "data-security-compliance-framework",
    );
    await expect(tiles).toHaveCount(9);

    const hipaa: Locator = tiles.filter({ hasText: "HIPAA" });
    await expect(hipaa).toContainText("Not evaluated");
    await expect(hipaa).toContainText("No store holds the data it protects");
    await expect(hipaa).not.toContainText("No requirement failing");

    const gdpr: Locator = tiles.filter({ hasText: "GDPR" });
    await expect(gdpr).toContainText("requirements failing");

    await screenshot(page, "layout-compliance-1280");
  });
});
