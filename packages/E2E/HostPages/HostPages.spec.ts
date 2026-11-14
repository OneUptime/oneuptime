import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";

/*
 * The Hosts product's pages, in a browser, against the offline fixture
 * (HostPages/Fixture).
 *
 * The maintainer: "How can we make the Proxmox product a lot better and
 * world-class? Can you please do those things for other resources as well,
 * like Kubernetes, Host, and VMware ... feature-rich, simple to use, and
 * natural to use."
 *
 * So, read the way someone who runs servers reads them: the Hosts list says
 * which hosts need attention first, the most urgent first, and why - a
 * filesystem nearly full, memory or swap short, more work queued than
 * cores, failed systemd units, a collector config that did not start, a
 * host gone quiet and since when - each row one step from the host's page;
 * then every host's health in a word, with its CPU, memory and fullest disk
 * as it last reported them. A host's own page says whether OneUptime hears
 * from it and how it is, how long it has been up, what on it needs a look,
 * and which of the alerts OneUptime recommends watch it, with "Turn on N
 * alerts" opening Recommendations with exactly those selected. A calm fleet
 * draws no card; a read that fails says so. At a laptop's and a phone's
 * width, in dark mode, in German and in Persian. The fixture records every
 * read, so the tests check that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HOSTS_PATH: string = `/dashboard/${PROJECT_ID}/host`;

function uuid(prefix: string, number: number): string {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

// The busy fleet's hosts (Fixture/Data.js).
const HOST_IDS: Record<string, string> = {
  web01: uuid("75000000", 1),
  db01: uuid("75000000", 2),
  web03: uuid("75000000", 3),
  app02: uuid("75000000", 4),
  edge01: uuid("75000000", 5),
  build01: uuid("75000000", 6),
  mac01: uuid("75000000", 7),
  new01: uuid("75000000", 8),
  legacy01: uuid("75000000", 9),
  win01: uuid("75000000", 10),
};

function hostPath(id: string): string {
  return `${HOSTS_PATH}/${id}`;
}

// The busy fleet's Needs attention rows, most urgent first.
const BUSY_ATTENTION: Array<{ key: string; severity: string }> = [
  { key: HOST_IDS["db01"]!, severity: "critical" },
  { key: HOST_IDS["web03"]!, severity: "critical" },
  { key: HOST_IDS["edge01"]!, severity: "warning" },
  { key: HOST_IDS["app02"]!, severity: "warning" },
  { key: HOST_IDS["build01"]!, severity: "warning" },
  { key: HOST_IDS["mac01"]!, severity: "warning" },
];

// The alerts OneUptime recommends for every host (getAllHostAlertTemplates).
const HOST_ALERT_IDS: Array<string> = [
  "Host:host-stopped-reporting",
  "Host:host-restarted",
  "Host:host-high-cpu",
  "Host:host-high-memory",
  "Host:host-high-swap",
  "Host:host-high-filesystem",
  "Host:host-running-out-of-inodes",
  "Host:host-high-load-average",
  "Host:host-high-processes",
  "Host:host-systemd-unit-failed",
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/host-pages-ui",
);

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's German and Persian words, as the fixture draws them.
const GERMAN: Record<string, string> = locale("de");
const PERSIAN: Record<string, string> = locale("fa");

// A sentence of the locale with its values put in.
function fill(
  words: Record<string, string>,
  key: string,
  values: Record<string, string>,
): string {
  let sentence: string = words[key] as string;
  expect(sentence, `the locale has "${key}"`).toBeTruthy();
  for (const name of Object.keys(values)) {
    sentence = sentence.split(`{{${name}}}`).join(values[name] as string);
  }
  return sentence;
}

// A value set apart from a right-to-left sentence (FSI ... PDI).
function isolated(value: string): string {
  return `⁨${value}⁩`;
}

// A Latin digit, which a Persian count should not mix with its own.
const LATIN_DIGIT: RegExp = /[0-9]/;

// An uptime chip that names seconds beside a day count: "Up 41d 7s".
const DAYS_WITH_SECONDS: RegExp = /^Up \d+d \d+s$/;

// The marks a sentence sets its values apart with (LRI, RLI, FSI and PDI).
const ISOLATE_MARKS: RegExp = /[\u2066-\u2069]/g;

// Text as read, without the marks that set its values apart (FSI ... PDI).
function withoutIsolateMarks(text: string): string {
  return text.replace(ISOLATE_MARKS, "");
}

interface Recorded {
  apiRequests: Array<{ method: string; url: string }>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const outsideRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  // Nothing may leave the fixture: no CDN, no telemetry, no real API.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }

    outside.push(url.toString());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);

  if (!page.isClosed()) {
    const unhandled: Array<Record<string, unknown>> = await page.evaluate(
      (): Array<Record<string, unknown>> => {
        const fixture: Recorded | undefined = (
          window as unknown as { __hostPagesFixture?: Recorded }
        ).__hostPagesFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled).toEqual([]);
  }
});

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __hostPagesFixture: Recorded })
      .__hostPagesFixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function openList(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${HOSTS_PATH}${query ? `?${query}` : ""}`);
  // The table has drawn its rows once a status cell is there.
  await expect(page.getByTestId("host-status").first()).toBeVisible();
}

async function openHost(
  page: Page,
  id: string,
  query: string = "",
): Promise<void> {
  await page.goto(`${hostPath(id)}${query ? `?${query}` : ""}`);
  // The tiles are drawn once the host and its metrics have loaded.
  await expect(page.locator("span.uppercase").first()).toBeVisible();
}

// The rows of a Needs attention card, as key and severity, in order.
async function attentionRows(
  card: Locator,
): Promise<Array<{ key: string; severity: string }>> {
  return await card
    .locator('[data-testid$="-attention-item"]')
    .evaluateAll(
      (elements: Array<Element>): Array<{ key: string; severity: string }> => {
        return elements.map((element: Element) => {
          return {
            key: element.getAttribute("data-key") || "",
            severity: element.getAttribute("data-severity") || "",
          };
        });
      },
    );
}

function attentionRow(card: Locator, key: string): Locator {
  return card.locator(`[data-key="${key}"]`);
}

// A row of the Hosts table, found by the host's name.
function tableRow(page: Page, name: string): Locator {
  return page
    .locator("tbody tr")
    .filter({ has: page.getByRole("link", { name: name, exact: true }) });
}

// The Hosts table is no wider than the card it is drawn in.
async function expectTableFitsItsCard(page: Page): Promise<void> {
  const widths: { table: number; box: number } = await page
    .locator("table")
    .first()
    .evaluate((table: Element): { table: number; box: number } => {
      return {
        table: Math.round(table.getBoundingClientRect().width),
        box: Math.round(
          (table.parentElement as Element).getBoundingClientRect().width,
        ),
      };
    });

  expect(widths.table).toBeLessThanOrEqual(widths.box);
}

// The direction the browser draws an element's text in.
async function drawnDirection(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    return getComputedStyle(element).direction;
  });
}

// Whether `later` is drawn below `earlier` on the page.
async function isBelow(earlier: Locator, later: Locator): Promise<boolean> {
  const [first, second] = await boxesInOneFrame([earlier, later]);
  return Boolean(first && second && second.y > first.y);
}

// A golden tile on the Overview, found by its title in the reader's language.
function goldenTile(page: Page, title: string): Locator {
  return page
    .locator("span.uppercase", { hasText: title })
    .first()
    .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
}

async function selectedRecommendations(
  page: Page,
  hostId: string,
): Promise<Array<string>> {
  await expect(page).toHaveURL((url: URL): boolean => {
    return url.pathname === `${hostPath(hostId)}/recommendations`;
  });
  return (new URL(page.url()).searchParams.get("select") || "")
    .split(",")
    .filter((id: string): boolean => {
      return id.length > 0;
    })
    .sort();
}

test.describe("the Hosts list", () => {
  test("says which hosts need attention first, the most urgent first, and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);

    const card: Locator = page.getByTestId("host-fleet-attention");
    await expect(card).toBeVisible();
    await expect(
      page.getByTestId("host-fleet-attention-summary").locator("span"),
    ).toHaveText(["2 critical", "4 to look at"]);
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION);

    // Each row says why, in the words of the rules the list follows.
    const db01: Locator = attentionRow(card, HOST_IDS["db01"]!);
    await expect(db01.getByTestId("host-fleet-attention-name")).toHaveText(
      "Payments database",
    );
    // Its host name, where its display name is another.
    await expect(db01.getByTestId("host-fleet-attention-detail")).toHaveText(
      "db-01.prod.internal",
    );
    await expect(db01.getByTestId("host-fleet-attention-reason")).toHaveText([
      "/var/lib/postgresql 96% full",
      "Memory 92% used",
    ]);
    await expect(
      attentionRow(card, HOST_IDS["edge01"]!).getByTestId(
        "host-fleet-attention-reason",
      ),
    ).toHaveText(["Swap 86% used", "15-minute load 9.6 on 4 cores"]);
    await expect(
      attentionRow(card, HOST_IDS["app02"]!).getByTestId(
        "host-fleet-attention-reason",
      ),
    ).toHaveText("2 failed systemd units");
    await expect(
      attentionRow(card, HOST_IDS["build01"]!).getByTestId(
        "host-fleet-attention-reason",
      ),
    ).toHaveText("Collector config failed");
    await expect(
      attentionRow(card, HOST_IDS["mac01"]!).getByTestId(
        "host-fleet-attention-reason",
      ),
    ).toHaveText("/System/Volumes/Data: 91% of inodes used");

    // A host gone quiet: since when, not what it said last.
    const web03: Locator = attentionRow(card, HOST_IDS["web03"]!);
    await expect(web03.getByTestId("host-fleet-attention-reason")).toHaveText(
      "Not reporting",
    );
    await expect(
      web03.getByTestId("host-fleet-attention-last-report"),
    ).toHaveText("Last reported 3 hours ago");
    await expect(web03).not.toContainText("99%");

    // Every row is a host: no "Host" chip on each.
    await expect(card.getByTestId("host-fleet-attention-kind")).toHaveCount(0);
    // A host starting up, or that needs nothing, is not listed.
    await expect(attentionRow(card, HOST_IDS["new01"]!)).toHaveCount(0);
    await expect(attentionRow(card, HOST_IDS["web01"]!)).toHaveCount(0);

    // One read of the hosts past a line, not every host.
    const reads: Array<{ method: string; url: string }> = (
      await recorded(page)
    ).apiRequests.filter((request: { method: string; url: string }) => {
      return request.url.endsWith("/host/needs-attention");
    });
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(reads[0]!.method).toBe("POST");

    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-list");

    // One step to the host's page, from anywhere on its row.
    await db01.getByTestId("host-fleet-attention-reason").first().click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === hostPath(HOST_IDS["db01"]!);
    });
    await expect(page.getByTestId("host-hero-health")).toBeVisible();
  });

  test("says each host's health in a word, why under it, and what it last reported", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);

    const status: (name: string) => Locator = (name: string): Locator => {
      return tableRow(page, name).getByTestId("host-status");
    };

    await expect(status("Payments database")).toHaveText("Unhealthy");
    await expect(status("Payments database")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    // The most urgent reason, and how many more there are.
    await expect(
      tableRow(page, "Payments database").getByTestId("host-status-reason"),
    ).toHaveText("/var/lib/postgresql 96% full +1 more");

    await expect(status("edge-01")).toHaveText("Degraded");
    await expect(status("edge-01")).toHaveAttribute("data-tone", "warning");
    await expect(status("app-02")).toHaveText("Degraded");
    await expect(
      tableRow(page, "app-02").getByTestId("host-status-reason"),
    ).toHaveText("2 failed systemd units");
    await expect(status("web-01")).toHaveText("Healthy");
    await expect(status("win-01")).toHaveText("Healthy");
    // Its collector is still starting: it says so, pulsing.
    await expect(status("new-01")).toHaveText("Starting");
    // Installed by hand, sending no host metrics: reporting, nothing more.
    await expect(status("legacy-01")).toHaveText("Reporting");

    // Gone quiet: when it last reported, and no numbers that are no longer true.
    await expect(status("web-03")).toHaveText("Not reporting");
    await expect(
      tableRow(page, "web-03").getByTestId("host-status-reason"),
    ).toHaveCount(0);
    await expect(
      tableRow(page, "web-03").getByTestId("host-status-last-report"),
    ).toHaveText("Last reported 3 hours ago");
    await expect(
      tableRow(page, "web-03").getByTestId("host-usage-disk"),
    ).toHaveCount(0);

    // CPU, memory and the fullest disk, each with what it is a share of.
    const web01: Locator = tableRow(page, "web-01");
    await expect(web01.getByTestId("host-usage-cpu")).toHaveText("34%8 cores");
    await expect(web01.getByTestId("host-usage-memory")).toHaveText(
      "53%of 32 GiB",
    );
    await expect(web01.getByTestId("host-usage-disk")).toHaveText("48%/");

    // Coloured where Needs attention draws its lines.
    const db01: Locator = tableRow(page, "Payments database");
    await expect(db01.getByTestId("host-usage-memory")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    await expect(db01.getByTestId("host-usage-disk")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await expect(db01.getByTestId("host-usage-mount")).toHaveAttribute(
      "title",
      "/var/lib/postgresql",
    );
    // A busy CPU is a host at work: amber, never red.
    await expect(
      tableRow(page, "edge-01").getByTestId("host-usage-cpu"),
    ).toHaveAttribute("data-tone", "warning");

    // The name, the host name under it and what it runs.
    await expect(db01.getByTestId("host-identifier")).toHaveText(
      "db-01.prod.internal",
    );
    await expect(db01.getByTestId("host-os")).toHaveText("linux amd64");

    /*
     * Whether OneUptime hears from a host is the Connection filter: a
     * Status filter offering Connected and Disconnected sat beside a
     * Status column that says the host's health.
     */
    const filters: Locator = page.getByTestId("facet-filter-bar");
    await expect(filters.getByTestId("filter-chip")).toHaveText([
      "Owner",
      "Labels",
      "Connection",
      "OS",
      "Architecture",
    ]);
    await page.getByRole("button", { name: "Connection", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "Connected", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Disconnected", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // The whole table fits its card at a laptop's width.
    await expectTableFitsItsCard(page);
    await expectNoSidewaysScroll(page);
  });

  test("a calm fleet draws no Needs attention card, and every host reads Healthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "fleet=calm");

    await expect(page.getByTestId("host-status")).toHaveCount(10);
    await expect(page.getByTestId("host-status")).toHaveText(
      new Array(10).fill("Healthy"),
    );
    await expect(page.getByTestId("host-fleet-attention")).toHaveCount(0);
    await expect(page.getByTestId("host-fleet-attention-error")).toHaveCount(0);
  });

  test("a project with no hosts yet reads no fleet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${HOSTS_PATH}?fleet=new`);
    await expect(page.getByText("Add Host").first()).toBeVisible();
    await expect(page.getByTestId("host-fleet-attention")).toHaveCount(0);

    const reads: Array<{ method: string; url: string }> = (
      await recorded(page)
    ).apiRequests.filter((request: { method: string; url: string }) => {
      return request.url.endsWith("/host/needs-attention");
    });
    expect(reads).toEqual([]);
  });

  test("a read that fails says so in the card, with Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "fail=attention");

    const error: Locator = page.getByTestId("host-fleet-attention-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(
      "Something went wrong on the server. Please try again.",
    );

    const before: number = (await recorded(page)).apiRequests.length;
    await error.getByTestId("refresh-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).apiRequests.length;
      })
      .toBeGreaterThan(before);
    // The table is still there below it.
    await expect(page.getByTestId("host-status").first()).toBeVisible();
  });

  test("sixty hosts: six rows first, the rest one click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "fleet=large");

    const card: Locator = page.getByTestId("host-fleet-attention");
    /*
     * Every seventh host is not reporting (8), every fifth short of memory
     * (3 past 95%, 7 past 90%; the 45th at 90% exactly is not), every
     * eleventh's disk past 85% (4).
     */
    await expect(
      page.getByTestId("host-fleet-attention-summary").locator("span"),
    ).toHaveText(["11 critical", "11 to look at"]);
    await expect(card.getByTestId("host-fleet-attention-item")).toHaveCount(6);
    await expect(page.getByTestId("host-fleet-attention-toggle")).toHaveText(
      "Show 16 more",
    );
    await page.getByTestId("host-fleet-attention-toggle").click();
    await expect(card.getByTestId("host-fleet-attention-item")).toHaveCount(22);

    // The critical ones first.
    const severities: Array<string> = (await attentionRows(card)).map(
      (row: { key: string; severity: string }): string => {
        return row.severity;
      },
    );
    expect(severities).toEqual([
      ...new Array(11).fill("critical"),
      ...new Array(11).fill("warning"),
    ]);
  });

  test("on a phone, the card and the hosts stack and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openList(page);

    await expect(page.getByTestId("host-fleet-attention")).toBeVisible();
    expect(
      await attentionRows(page.getByTestId("host-fleet-attention")),
    ).toEqual(BUSY_ATTENTION);
    await expect(page.getByTestId("host-status").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-list-phone");
  });

  test("in dark mode, the list draws on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "theme=dark");

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("host-fleet-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-list-dark");
  });

  test("in German, the card, the columns and the reasons are German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "lang=de");

    const card: Locator = page.getByTestId("host-fleet-attention");
    expect(GERMAN["Needs attention"]).not.toBe("Needs attention");
    await expect(
      card.getByText(GERMAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("host-fleet-attention-summary").locator("span"),
    ).toHaveText([
      fill(GERMAN, "{{count}} critical", { count: "2" }),
      fill(GERMAN, "{{count}} to look at", { count: "4" }),
    ]);
    expect(GERMAN["{{mount}} {{percent}} full"]).not.toBe(
      "{{mount}} {{percent}} full",
    );
    await expect(
      attentionRow(card, HOST_IDS["db01"]!).getByTestId(
        "host-fleet-attention-reason",
      ),
    ).toHaveText([
      // German's own percent, as the tiles write theirs (#7106).
      fill(GERMAN, "{{mount}} {{percent}} full", {
        mount: "/var/lib/postgresql",
        percent: "96\u00A0%",
      }),
      fill(GERMAN, "Memory {{percent}} used", { percent: "92\u00A0%" }),
    ]);
    await expect(
      attentionRow(card, HOST_IDS["web03"]!).getByTestId(
        "host-fleet-attention-last-report",
      ),
    ).toContainText(
      (GERMAN["Last reported {{time}}"] as string).split("{{time}}")[0]!.trim(),
    );

    expect(GERMAN["Unhealthy"]).not.toBe("Unhealthy");
    await expect(
      tableRow(page, "Payments database").getByTestId("host-status"),
    ).toHaveText(GERMAN["Unhealthy"] as string);
    await expect(
      tableRow(page, "web-01").getByTestId("host-usage-memory"),
    ).toContainText(fill(GERMAN, "of {{total}}", { total: "32 GiB" }));

    /*
     * The German headings leave the name its least width: "Payments
     * database" read "Payments datab...". It wraps onto a second line,
     * whole.
     */
    const name: { lines: number; isCut: boolean } = await page
      .getByRole("link", { name: "Payments database", exact: true })
      .first()
      .evaluate((link: Element): { lines: number; isCut: boolean } => {
        const line: HTMLElement = link.parentElement as HTMLElement;
        const lineHeight: number = parseFloat(
          getComputedStyle(line).lineHeight,
        );
        return {
          lines: Math.round(line.getBoundingClientRect().height / lineHeight),
          isCut: line.scrollHeight > line.clientHeight + 1,
        };
      });
    expect(name.isCut).toBe(false);
    expect(name.lines).toBeLessThanOrEqual(2);
    await expectTableFitsItsCard(page);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-list-german");
  });

  test("in Persian, the list reads right to left, and a mount keeps its slashes where they were written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const card: Locator = page.getByTestId("host-fleet-attention");
    await expect(
      card.getByText(PERSIAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    // "2 بحرانی" would mix two kinds of digit: every count is Persian.
    const summary: string =
      (await page.getByTestId("host-fleet-attention-summary").textContent()) ||
      "";
    expect(summary).toContain("۲");
    expect(summary).not.toMatch(LATIN_DIGIT);

    /*
     * The mount and the share set apart from the Persian sentence around
     * them, the share in Persian digits and Persian's percent sign (#7106).
     */
    const reasons: Array<string> = await attentionRow(card, HOST_IDS["db01"]!)
      .getByTestId("host-fleet-attention-reason")
      .allTextContents();
    expect(reasons[0]).toBe(
      fill(PERSIAN, "{{mount}} {{percent}} full", {
        mount: isolated("/var/lib/postgresql"),
        percent: isolated("۹۶٪"),
      }),
    );
    // A host's name reads the way it is written.
    await expect(
      attentionRow(card, HOST_IDS["db01"]!)
        .getByTestId("host-fleet-attention-name")
        .locator("bdi"),
    ).toHaveText("Payments database");

    // A mount cut short at its own end, lined up as the page's lines are.
    const mount: Locator = tableRow(page, "Payments database").getByTestId(
      "host-usage-mount",
    );
    await expect(mount).toHaveAttribute("dir", "ltr");
    await expect(
      tableRow(page, "Payments database").getByTestId("host-os"),
    ).toHaveAttribute("dir", "ltr");
    // "of 64 GiB" in Persian digits, set apart, so it never reads "GiB 64".
    await expect(
      tableRow(page, "Payments database").getByTestId("host-usage-memory"),
    ).toContainText(
      fill(PERSIAN, "of {{total}}", { total: isolated("۶۴ GiB") }),
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-list-persian");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-list-persian-phone");
  });
});

test.describe("a host on OpenStack", () => {
  const CLOUD: string = "71000000-0000-4000-8000-000000000009";
  const INSTANCE: string = "2e1cfc3e-0001-4c2e-a4fc-c5cf0f2db585";
  const HYPERVISOR: string = "RegionOne/compute-01.acme.example";

  test("a guest says which instance it is, on which hypervisor, in which zone and whose", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["db01"]!, "openstack=instance");

    const card: Locator = page.getByTestId("host-openstack-placement");
    await expect(card).toContainText("This host is an OpenStack instance");
    const cloudPath: string = `/dashboard/${PROJECT_ID}/openstack/${CLOUD}`;
    for (const [testId, words, href] of [
      ["openstack-placement-cloud", "acme-prod", cloudPath],
      [
        "openstack-placement-instance",
        "web-1",
        `${cloudPath}/instances/${INSTANCE}`,
      ],
      [
        "openstack-placement-hypervisor",
        "compute-01.acme.example",
        `${cloudPath}/hypervisors/${encodeURIComponent(HYPERVISOR)}`,
      ],
      ["openstack-placement-project", "acme-payments", cloudPath],
      ["openstack-placement-zone", "az-1", cloudPath],
    ] as Array<[string, string, string]>) {
      const row: Locator = card.getByTestId(testId);
      await expect(row).toContainText(words);
      await expect(row.getByRole("link")).toHaveAttribute(
        "href",
        new RegExp(`^${escapeRegExp(href)}`),
      );
    }
    await screenshot(page, "host-on-openstack");
  });

  test("the machine a hypervisor runs on says so, and is no instance of itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["db01"]!, "openstack=hypervisor");

    const card: Locator = page.getByTestId("host-openstack-placement");
    await expect(card).toContainText(
      "This machine is one of an OpenStack cloud's hypervisors",
    );
    await expect(card.getByTestId("openstack-placement-instance")).toHaveCount(
      0,
    );
    await expect(
      card.getByTestId("openstack-placement-hypervisor"),
    ).toContainText("compute-01.acme.example");
  });

  test("a host on no cloud says nothing of OpenStack at all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["db01"]!);

    await expect
      .poll(async (): Promise<boolean> => {
        return (await recorded(page)).apiRequests.some(
          (request: { url: string }): boolean => {
            return request.url.includes("/placement-of-host/");
          },
        );
      })
      .toBe(true);
    await expect(page.getByTestId("host-openstack-placement")).toHaveCount(0);
    await expect(page.getByText("On OpenStack")).toHaveCount(0);
  });

  test("it fits a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHost(page, HOST_IDS["db01"]!, "openstack=instance");
    await expect(page.getByTestId("host-openstack-placement")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test.describe("a host's Overview", () => {
  test("says how the host is, how long it has been up and what on it needs a look", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["db01"]!);

    // Whether OneUptime hears from it, then how it is.
    const health: Locator = page.getByTestId("host-hero-health");
    await expect(health).toHaveText("Unhealthy");
    await expect(health).toHaveAttribute("data-health", "unhealthy");
    /*
     * Up 41 days and 7 seconds, and more by the time it is drawn: its
     * largest unit and the next one down only, never days with seconds
     * (issue #7306), so this holds however long the page took to draw.
     */
    await expect(page.getByText("Up 41d", { exact: true })).toBeVisible();
    await expect(page.getByText(DAYS_WITH_SECONDS)).toHaveCount(0);

    // The filesystem first (critical), then the host's own memory.
    const card: Locator = page.getByTestId("host-needs-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "filesystem:/var/lib/postgresql", severity: "critical" },
      { key: "host", severity: "warning" },
    ]);
    const filesystem: Locator = attentionRow(
      card,
      "filesystem:/var/lib/postgresql",
    );
    await expect(
      filesystem.getByTestId("host-needs-attention-name"),
    ).toHaveText("/var/lib/postgresql");
    await expect(
      filesystem.getByTestId("host-needs-attention-kind"),
    ).toHaveText("Filesystem");
    await expect(
      filesystem.getByTestId("host-needs-attention-reason"),
    ).toHaveText("96% full");
    const own: Locator = attentionRow(card, "host");
    await expect(own.getByTestId("host-needs-attention-name")).toHaveText(
      "This host",
    );
    await expect(own.getByTestId("host-needs-attention-reason")).toHaveText(
      "Memory 92% used",
    );

    // The fullest mount, df's Use%, the same number the card judged.
    const tile: Locator = goldenTile(page, "Filesystem");
    await expect(tile).toContainText("96.4%");
    await expect(tile).toContainText("/var/lib/postgresql");

    // When it booted, in Host Details.
    await expect(page.getByText("Booted", { exact: true })).toBeVisible();

    /*
     * What the host is doing comes first - its tiles, charts and
     * Filesystems - then which alerts watch it, then its Host Details: ten
     * alert rows above the charts pushed them a screen down.
     */
    const filesystems: Locator = page.getByText("Filesystems", {
      exact: true,
    });
    const alerts: Locator = page.getByTestId("host-alerts");
    const details: Locator = page.getByText("Host Details", { exact: true });
    await expect(alerts.getByTestId("host-alerts-item")).toHaveCount(10);
    expect(await isBelow(filesystems, alerts)).toBe(true);
    expect(await isBelow(alerts, details)).toBe(true);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "host-overview");
  });

  test("more work than cores: the load tile is amber, never red, and Needs attention names the 15-minute load", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["edge01"]!);

    const own: Locator = attentionRow(
      page.getByTestId("host-needs-attention"),
      "host",
    );
    await expect(own.getByTestId("host-needs-attention-reason")).toHaveText([
      "Swap 86% used",
      "15-minute load 9.6 on 4 cores",
    ]);

    // Its 1-minute load, over twice its cores: amber, as the card says it.
    const load: Locator = goldenTile(page, "Load avg (1m)");
    const bar: Locator = load.locator(".rounded-full.transition-all");
    await expect(bar).toHaveClass(/bg-amber-500/);
    await expect(bar).not.toHaveClass(/bg-red-500/);
  });

  test("Host alerts turn on in one step, into Recommendations with exactly those selected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["db01"]!);

    const alerts: Locator = page.getByTestId("host-alerts");
    await expect(alerts.getByTestId("host-alerts-item")).toHaveCount(10);
    await expect(page.getByTestId("host-alerts-turn-on")).toHaveText(
      "Turn on 10 alerts",
    );

    await page.getByTestId("host-alerts-turn-on").click();
    expect(await selectedRecommendations(page, HOST_IDS["db01"]!)).toEqual(
      [...HOST_ALERT_IDS].sort(),
    );
    await expect(
      page.getByText("10 monitors selected", { exact: false }),
    ).toBeVisible();
    await screenshot(page, "host-recommendations");
  });

  test("alerts already on say On, and Turn on counts only the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["web01"]!, "alerts=some");

    const items: Locator = page.getByTestId("host-alerts-item");
    await expect(items).toHaveCount(10);
    await expect(
      page.locator('[data-testid="host-alerts-item"][data-status="Created"]'),
    ).toHaveCount(2);
    await expect(page.getByTestId("host-alerts-turn-on")).toHaveText(
      "Turn on 8 alerts",
    );
  });

  test("a role that may not read monitors sees no alerts card, and nothing breaks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["db01"]!, "alerts=denied");

    await expect(page.getByTestId("host-needs-attention")).toBeVisible();
    await expect(page.getByTestId("host-alerts")).toHaveCount(0);
  });

  test("failed systemd units each open their own page, the collector its Collector page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["app02"]!);

    const card: Locator = page.getByTestId("host-needs-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "systemd-unit:backup.service", severity: "warning" },
      { key: "systemd-unit:nginx.service", severity: "warning" },
    ]);
    await expect(
      attentionRow(card, "systemd-unit:nginx.service").getByTestId(
        "host-needs-attention-reason",
      ),
    ).toHaveText("Failed");

    await attentionRow(card, "systemd-unit:nginx.service")
      .getByTestId("host-needs-attention-name")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${hostPath(HOST_IDS["app02"]!)}/systemd/nginx.service`
      );
    });

    await openHost(page, HOST_IDS["build01"]!);
    const collector: Locator = attentionRow(
      page.getByTestId("host-needs-attention"),
      "collector",
    );
    await expect(collector.getByTestId("host-needs-attention-name")).toHaveText(
      "Build agents",
    );
    await expect(
      collector.getByTestId("host-needs-attention-reason"),
    ).toHaveText("Config failed");
    await collector.getByTestId("host-needs-attention-name").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${hostPath(HOST_IDS["build01"]!)}/documentation`;
    });
  });

  test("a host that stopped reporting has the connection card, not a stale health", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(hostPath(HOST_IDS["web03"]!));

    await expect(page.getByTestId("resource-connection-guide")).toBeVisible();
    await expect(page.getByTestId("resource-connection-guide")).toContainText(
      "3 hours ago",
    );
    await expect(page.getByTestId("host-hero-health")).toHaveText(
      "Health Unknown",
    );
    // The card above says it: no Needs attention saying "Not reporting" again.
    await expect(page.getByTestId("host-needs-attention")).toHaveCount(0);
  });

  test("a host still starting shows no health yet, and no numbers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(hostPath(HOST_IDS["new01"]!));

    await expect(page.getByTestId("resource-connection-guide")).toBeVisible();
    await expect(page.getByTestId("host-hero-health")).toHaveCount(0);
    await expect(page.getByTestId("host-needs-attention")).toHaveCount(0);
    /*
     * Starting, as its row in the Hosts list and the card under the hero
     * say - not an amber Disconnected a minute after Add Host.
     */
    const connection: Locator = page.getByTestId("host-hero-connection");
    await expect(connection).toHaveText("Starting");
    await expect(connection).toHaveAttribute("data-starting", "true");

    // A host that stopped reporting still says Disconnected.
    await page.goto(hostPath(HOST_IDS["web03"]!));
    await expect(page.getByTestId("host-hero-connection")).toHaveText(
      "Disconnected",
    );
  });

  test("a healthy host's page has no Needs attention card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST_IDS["web01"]!);

    await expect(page.getByTestId("host-hero-health")).toHaveText("Healthy");
    await expect(page.getByTestId("host-needs-attention")).toHaveCount(0);
  });

  test("on a phone, in dark mode, in German and in Persian, nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHost(page, HOST_IDS["db01"]!);
    await expect(page.getByTestId("host-needs-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "host-overview-phone");

    await page.setViewportSize({ width: 1280, height: 900 });
    await openHost(page, HOST_IDS["db01"]!, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await screenshot(page, "host-overview-dark");

    await openHost(page, HOST_IDS["db01"]!, "lang=de");
    expect(GERMAN["This host"]).not.toBe("This host");
    await expect(
      attentionRow(
        page.getByTestId("host-needs-attention"),
        "host",
      ).getByTestId("host-needs-attention-name"),
    ).toHaveText(GERMAN["This host"] as string);
    await expect(page.getByTestId("host-hero-health")).toHaveText(
      GERMAN["Unhealthy"] as string,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "host-overview-german");

    await openHost(page, HOST_IDS["db01"]!, "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // The mount, its leading slash at its start.
    await expect(
      attentionRow(
        page.getByTestId("host-needs-attention"),
        "filesystem:/var/lib/postgresql",
      )
        .getByTestId("host-needs-attention-name")
        .locator("bdi"),
    ).toHaveText("/var/lib/postgresql");
    /*
     * The Filesystem tile named it "var/lib/postgresql/", and the
     * Filesystems table its mounts, devices and "472 GiB / 500 GiB" the
     * other way round: each reads left to right now.
     */
    const tileMount: Locator = goldenTile(page, PERSIAN["Filesystem"] as string)
      .getByTestId("golden-metric-tile-sublabel")
      .locator("bdi");
    await expect(tileMount).toHaveText("/var/lib/postgresql");
    expect(await drawnDirection(tileMount)).toBe("ltr");
    for (const testId of [
      "host-filesystem-mount",
      "host-filesystem-device",
      "host-filesystem-used",
    ]) {
      expect({
        testId: testId,
        direction: await drawnDirection(page.getByTestId(testId).first()),
      }).toEqual({ testId: testId, direction: "ltr" });
    }
    /*
     * Its figures in Persian digits beyond the tiles too (#7106): the
     * reasons' shares, the cached process count in Details, and the
     * memory's size set apart, "۶۴ GiB" and never "GiB ۶۴".
     */
    const hostReasons: Array<string> = await attentionRow(
      page.getByTestId("host-needs-attention"),
      "host",
    )
      .getByTestId("host-needs-attention-reason")
      .allTextContents();
    expect(hostReasons.join(" ")).toContain("۹۲٪");
    expect(hostReasons.join(" ")).not.toMatch(LATIN_DIGIT);
    const details: Locator = page.getByTestId("detail-field");
    await expect(
      details
        .filter({ hasText: PERSIAN["Process Count (cached)"] as string })
        .getByTestId("detail-value"),
    ).toHaveText("۲۱۴");
    await expect(
      details
        .filter({ hasText: PERSIAN["Total Memory"] as string })
        .getByTestId("detail-value")
        .locator("bdi"),
    ).toHaveText("۶۴ GiB");
    await expect(
      goldenTile(page, PERSIAN["Filesystem"] as string)
        .getByTestId("golden-metric-tile-value")
        .locator("bdi"),
    ).toHaveText(/^[۰-۹٫]+٪$/);
    /*
     * How long it has been up, in Persian: its largest unit alone, "۴۱
     * روز", never days with seconds whatever the second it was drawn in
     * (#7306). And its auto-refresh interval as Persian writes a duration,
     * "هر ۳۰ ثانیه", never English's "30s" (#7303).
     */
    const upSince: string = (PERSIAN["Up {{duration}}"] as string).split(
      "{{duration}}",
    )[0] as string;
    expect(upSince.trim()).not.toBe("");
    const uptime: string = withoutIsolateMarks(
      (await page.getByText(upSince.trim()).first().textContent()) || "",
    );
    expect(uptime).toBe(
      fill(PERSIAN, "Up {{duration}}", { duration: "۴۱ روز" }),
    );
    expect(uptime).not.toMatch(LATIN_DIGIT);
    const interval: Locator = page.getByRole("combobox", {
      name: PERSIAN["Auto-refresh"] as string,
    });
    expect(
      withoutIsolateMarks(
        (await interval.locator("option:checked").textContent()) || "",
      ),
    ).toBe(fill(PERSIAN, "Every {{interval}}", { interval: "۳۰ ثانیه" }));
    for (const option of await interval.locator("option").allTextContents()) {
      expect(option).not.toMatch(LATIN_DIGIT);
    }
    await expectNoSidewaysScroll(page);
    await screenshot(page, "host-overview-persian");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoSidewaysScroll(page);
    await screenshot(page, "host-overview-persian-phone");
  });
});
