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
 * Connected Signals: what a security case names in the rest of OneUptime -
 * the project's hosts and members - as the fixture's records and the
 * server's own matching rules have it (Fixture/ConnectionsFixture.js), on a
 * case's own page and on an entity's.
 *
 * What the unit tests cannot see: that a record's line - its name, why it
 * is connected, the possible match's pill, its signals and what is going on
 * there - reads whole and fits beside the case's side menu at every width,
 * in both themes, in German and in Persian (right to left), and that the
 * links open what they say on the record and the case's window.
 *
 * Every test pins the clock and fences the network, as the suite's other
 * specs do; afterEach fails a test on an uncaught page error, a request the
 * fence aborted, or anything the fixture does not model.
 */

const PORT: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const PRODUCT: string = `${DASHBOARD}/security-events`;

function casePath(number: number): string {
  return `${PRODUCT}/cases/20000000-0000-4000-8000-000000000${number}/connected-signals`;
}

// The spray against Okta: a member's account among its targets.
const SPRAY_CASE: string = casePath(142);
// The known-bad domain build-runner-07 looked up, read from its own logs.
const DOMAIN_CASE: string = casePath(141);
// Credential dumping on fin-ws-112: a host only possibly the one it names.
const DUMP_CASE: string = casePath(140);
// Suspicious PowerShell on web-03: a host with incidents open on it.
const POWERSHELL_CASE: string = casePath(138);

// The fixture's records (ConnectionsFixture.js).
const BUILD_RUNNER_ID: string = "2d000000-0000-4000-8000-000000000001";
const WEB_03_ID: string = "2d000000-0000-4000-8000-000000000002";
const KAI_ID: string = "80000000-0000-4000-8000-000000000021";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface OpenOptions {
  width?: number;
  height?: number;
  theme?: "dark" | undefined;
  lang?: "de" | "fa";
  role?: "viewer";
  connections?: "fail" | "partial" | "busy";
}

test.use({ deviceScaleFactor: 2, actionTimeout: 15000 });

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing the page asks for may leave the fixture server.
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

  const unhandled: Array<unknown> | null = await page
    .evaluate((): Array<unknown> | null => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __securityOperationsFixture?: { unhandled?: Array<unknown> };
        }
      ).__securityOperationsFixture;
      return state ? JSON.parse(JSON.stringify(state.unhandled || [])) : null;
    })
    .catch((): null => {
      return null;
    });
  if (unhandled) {
    expect(unhandled, "requests the fixture does not model").toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  target: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1440,
    height: options.height || (options.width === 390 ? 844 : 1000),
  });
  await page.clock.setFixedTime(NOW);
  const url: URL = new URL(target, `http://127.0.0.1:${PORT}`);
  if (options.theme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  if (options.lang) {
    url.searchParams.set("lang", options.lang);
  }
  if (options.role) {
    url.searchParams.set("role", options.role);
  }
  if (options.connections) {
    url.searchParams.set("connections", options.connections);
  }
  await page.goto(`${url.pathname}${url.search}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

function connected(page: Page): Locator {
  return page.getByTestId("security-connected-signals");
}

function records(page: Page): Locator {
  return page.getByTestId("security-connected-record");
}

// A record's line, by the name it is drawn with.
function record(page: Page, name: string): Locator {
  return records(page).filter({
    has: page.getByTestId("security-connected-record-name").getByText(name, {
      exact: true,
    }),
  });
}

async function waitForRecords(page: Page): Promise<void> {
  await expect(records(page).first()).toBeVisible({ timeout: 30000 });
}

async function names(page: Page): Promise<Array<string>> {
  return page
    .getByTestId("security-connected-record-name")
    .allInnerTexts()
    .then((texts: Array<string>): Array<string> => {
      return texts.map((text: string): string => {
        return text.trim();
      });
    });
}

function hrefOf(locator: Locator): Promise<string | null> {
  return locator.getAttribute("href");
}

function factRow(scope: Locator, testId: string): Locator {
  return scope.getByTestId(testId);
}

// A fact's items, each as its link reads: its number and its title.
async function factItems(row: Locator): Promise<Array<string>> {
  return row
    .getByTestId("security-connected-fact-item")
    .locator("bdi")
    .allInnerTexts()
    .then((texts: Array<string>): Array<string> => {
      return texts.map((text: string): string => {
        return text.trim();
      });
    });
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface FactRowLayout {
  record: string;
  fact: string;
  // The width of the record's text column, the size container the row reads.
  recordWidth: number;
  label: Box;
  // The label's words themselves, where they sit on its line.
  labelText: Box;
  items: Array<Box>;
}

// The width from which a fact's label sits beside its items (32rem).
const FACTS_BESIDE_FROM: number = 32 * 16;

/*
 * Every fact row of every record, as the browser lays it out: the width of
 * the record's text column, its label's box and words, and each of its
 * items' boxes.
 */
async function factRowLayouts(page: Page): Promise<Array<FactRowLayout>> {
  return connected(page).evaluate((root: Element): Array<FactRowLayout> => {
    const boxOf: (element: Element | Range) => Box = (
      element: Element | Range,
    ): Box => {
      const box: DOMRect = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    };
    const rows: Array<FactRowLayout> = [];

    root
      .querySelectorAll("[data-testid='security-connected-record']")
      .forEach((record: Element): void => {
        const name: string = (
          record.querySelector("[data-testid='security-connected-record-name']")
            ?.textContent || ""
        ).trim();

        record
          .querySelectorAll("[data-testid='security-connected-facts'] dl > div")
          .forEach((row: Element): void => {
            const label: Element | null = row.querySelector(
              "[data-testid='security-connected-fact-label']",
            );

            if (!label) {
              return;
            }

            const words: Range = document.createRange();
            words.selectNodeContents(label);
            const container: Element | null = row.closest(
              "[class*='container-type']",
            );

            rows.push({
              record: name,
              fact: row.getAttribute("data-testid") || "",
              recordWidth: container
                ? container.getBoundingClientRect().width
                : 0,
              label: boxOf(label),
              labelText: boxOf(words),
              items: Array.from(row.querySelectorAll("li")).map(boxOf),
            });
          });
      });

    return rows;
  });
}

// Each item of a fact on a line of its own: none starts above the one before it ends.
function itemsOnLinesOfTheirOwn(rows: Array<FactRowLayout>): Array<string> {
  const problems: Array<string> = [];

  for (const row of rows) {
    for (let index: number = 1; index < row.items.length; index++) {
      if (row.items[index]!.top < row.items[index - 1]!.bottom - 1) {
        problems.push(`${row.record} ${row.fact} item ${index}`);
      }
    }
  }

  return problems;
}

function sideMenu(page: Page): Locator {
  return page.locator('aside[role="navigation"]');
}

function menuEntry(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("link", { name: title, exact: true });
}

async function litEntries(page: Page): Promise<Array<string>> {
  return sideMenu(page)
    .locator("a.bg-indigo-50")
    .evaluateAll((anchors: Array<Element>): Array<string> => {
      return anchors.map((anchor: Element): string => {
        return (
          anchor.querySelector("span.truncate")?.textContent ||
          anchor.textContent ||
          ""
        ).trim();
      });
    });
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

/*
 * The parts of every record's line that run past the card around them: none
 * may, however long a name or a sentence, at any width.
 */
async function partsOutsideTheCard(page: Page): Promise<Array<string>> {
  return connected(page).evaluate((root: Element): Array<string> => {
    const card: DOMRect = root.getBoundingClientRect();
    const outside: Array<string> = [];

    root
      .querySelectorAll(
        "[data-testid='security-connected-record'] *, [data-testid='security-connected-not-found'] *",
      )
      .forEach((element: Element): void => {
        const box: DOMRect = element.getBoundingClientRect();

        if (box.width === 0 || box.height === 0) {
          return;
        }

        if (box.left < card.left - 1 || box.right > card.right + 1) {
          outside.push(
            `${element.tagName.toLowerCase()} "${(element.textContent || "").trim().slice(0, 40)}" ${Math.round(box.left)}-${Math.round(box.right)} outside ${Math.round(card.left)}-${Math.round(card.right)}`,
          );
        }
      });

    return outside;
  });
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

/*
 * ---------------------------------------------------------------------------
 * A case's Connected Signals
 * ---------------------------------------------------------------------------
 */

test.describe("a case's Connected Signals", () => {
  test("is a page of the case's own, under Investigation after Entities, its entry lit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE.replace("/connected-signals", "/entities"));
    await expect(menuEntry(page, "Connected Signals")).toBeVisible({
      timeout: 30000,
    });

    const investigation: Array<string> = await sideMenu(page)
      .getByRole("link")
      .allInnerTexts();
    const entities: number = investigation.findIndex((text: string) => {
      return text.trim().startsWith("Entities");
    });
    expect(investigation[entities + 1]?.trim()).toBe("Connected Signals");

    await menuEntry(page, "Connected Signals").click();
    await expect
      .poll((): string => {
        return new URL(page.url()).pathname;
      })
      .toBe(SPRAY_CASE);
    await waitForRecords(page);
    expect(await litEntries(page)).toEqual(["Connected Signals"]);
    // The trail names the case by its number, then the page.
    expect(
      (
        await page
          .getByRole("navigation", { name: "Breadcrumb" })
          .getByRole("listitem")
          .allInnerTexts()
      ).map((crumb: string): string => {
        return crumb.trim();
      }),
    ).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "CASE-142",
      "Connected Signals",
    ]);
  });

  test("the spray case: the member whose account it targets, and what OneUptime does not know", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE);
    await waitForRecords(page);

    expect(await names(page)).toEqual(["Kai Morgan"]);

    const kai: Locator = record(page, "Kai Morgan");
    await expect(kai).toHaveAttribute("data-kind", "User");
    await expect(kai).toHaveAttribute("data-certainty", "Exact");
    await expect(
      kai.getByTestId("security-connected-record-reason"),
    ).toHaveText("Named by k.morgan@acme-commerce.example, their email.");
    expect(
      await hrefOf(kai.getByTestId("security-connected-record-name")),
    ).toBe(`${DASHBOARD}/users/${KAI_ID}`);
    // A member's page is the link: no signals, and nothing open on a person.
    await expect(
      kai.getByTestId("security-connected-signal-links"),
    ).toHaveCount(0);
    await expect(
      kai.getByTestId("security-connected-nothing-active"),
    ).toHaveCount(0);

    const notFound: Locator = page.getByTestId("security-connected-not-found");
    for (const value of [
      "203.0.113.47",
      "j.wilson@acme-commerce.example",
      "a.ng@acme-commerce.example",
      "acme-commerce.okta.example",
    ]) {
      await expect(notFound).toContainText(value);
    }
    await expect(notFound).not.toContainText("k.morgan@acme-commerce.example");
    // The case's window: from before its first detection to after its last.
    await expect(page.getByTestId("security-connected-window")).toContainText(
      "Signals from",
    );
  });

  test("the domain case: the build runner by its name, its address and its own logs, with what is going on there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE);
    await waitForRecords(page);

    expect(await names(page)).toEqual(["build-runner-07"]);

    const runner: Locator = record(page, "build-runner-07");
    await expect(runner).toHaveAttribute("data-certainty", "Exact");
    await expect(
      runner.getByTestId("security-connected-record-reason"),
    ).toHaveText("Named build-runner-07, the name it reports.");
    expect(
      await hrefOf(runner.getByTestId("security-connected-record-name")),
    ).toBe(`${DASHBOARD}/host/${BUILD_RUNNER_ID}`);

    // Its signals, each opening its explorer on the host and the case's window.
    const links: Locator = runner.getByTestId(
      "security-connected-signal-links",
    );
    await expect(links).toHaveAttribute(
      "aria-label",
      "Signals of build-runner-07 in this window",
    );
    expect(
      (await links.getByRole("link").allInnerTexts()).map((text: string) => {
        return text.trim();
      }),
    ).toEqual(["Logs", "Traces", "Metrics", "Topology", "Inventory"]);

    const logs: URL = new URL(
      (await hrefOf(links.getByRole("link", { name: "Logs" })))!,
      `http://127.0.0.1:${PORT}`,
    );
    expect(logs.pathname).toBe(`${DASHBOARD}/logs`);
    expect(JSON.parse(logs.searchParams.get("filters") || "[]")).toEqual([
      ["hostId", [BUILD_RUNNER_ID]],
    ]);
    expect(logs.searchParams.get("range")).toBe("Custom");
    // CASE-141: first detected 48 minutes ago, last 31; the window pads both by half an hour.
    expect(new Date(logs.searchParams.get("start")!).toISOString()).toBe(
      "2026-10-14T10:42:00.000Z",
    );
    expect(new Date(logs.searchParams.get("end")!).toISOString()).toBe(
      "2026-10-14T11:59:00.000Z",
    );
    expect(
      new URL(
        (await hrefOf(links.getByRole("link", { name: "Metrics" })))!,
        `http://127.0.0.1:${PORT}`,
      ).pathname,
    ).toBe(`${DASHBOARD}/host/${BUILD_RUNNER_ID}/metrics`);

    // What is going on there: one fact a row, its label and then its items, each with where it stands.
    const alerts: Locator = factRow(runner, "security-connected-alerts");
    await expect(
      alerts.getByTestId("security-connected-fact-label"),
    ).toHaveText("1 active alert");
    expect(await factItems(alerts)).toEqual([
      "ALR-311 Outbound DNS to a threat feed domain",
    ]);
    await expect(
      alerts.getByTestId("security-connected-fact-item"),
    ).toContainText("Acknowledged");
    await expect(
      runner.getByTestId("security-connected-incidents"),
    ).toHaveCount(0);
    const monitors: Locator = factRow(runner, "security-connected-monitors");
    await expect(
      monitors.getByTestId("security-connected-fact-label"),
    ).toHaveText("Watched by 1 monitor");
    expect(await factItems(monitors)).toEqual(["build-runner-07 heartbeat"]);
    await expect(
      monitors.getByTestId("security-connected-fact-item"),
    ).toContainText("Operational");
    const changes: Locator = factRow(runner, "security-connected-changes");
    await expect(
      changes.getByTestId("security-connected-fact-label"),
    ).toHaveText("Changed in this window");
    expect(await factItems(changes)).toEqual([
      "Fixed: rotated the runner's registration token",
    ]);
    expect(await changes.locator("time").getAttribute("datetime")).toBeTruthy();
    await expect(
      page.getByTestId("security-connected-not-found"),
    ).toContainText("update-sync.bad-cdn.example");
    // The address only it holds, and its logs, name it too: not found they are not.
    await expect(
      page.getByTestId("security-connected-not-found"),
    ).not.toContainText("198.51.100.23");
  });

  test("a host that only possibly is the one a case names says so, and why, and is never counted", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DUMP_CASE);
    await waitForRecords(page);

    const host: Locator = record(page, "fin-ws-112.corp.acme-commerce.example");
    await expect(host).toHaveAttribute("data-certainty", "Possible");
    await expect(
      host.getByTestId("security-connected-record-reason"),
    ).toHaveText(
      "Named fin-ws-112, a short or full form of its name fin-ws-112.corp.acme-commerce.example. Another machine may share it.",
    );

    const pill: Locator = host.getByTestId("security-connected-possible");
    await expect(pill).toHaveText("Possible match");
    await pill.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "Probably the same thing, but OneUptime cannot be sure. It is not counted on its page or linked to incidents.",
    );
    await expect(
      host.getByTestId("security-connected-nothing-active"),
    ).toHaveText("No active incidents or alerts.");
    // Under the heading that says what possible means.
    const group: Locator = page.getByTestId(
      "security-connected-possible-group",
    );
    await expect(group.getByRole("heading", { level: 3 })).toHaveText(
      "Possible matches",
    );
    await expect(group).toContainText(
      "OneUptime cannot be sure these are the same records, so they are not counted on their pages or linked to incidents.",
    );
    await expect(group.getByTestId("security-connected-record")).toHaveCount(1);
    // A process is not something OneUptime keys a record by: not looked up, not "not found".
    await expect(
      page.getByTestId("security-connected-not-found"),
    ).not.toContainText("procdump64.exe");
    await expect(
      page.getByTestId("security-connected-not-found"),
    ).toContainText("r.alvarez@acme-commerce.example");
  });

  test("exact connections first: web-03, with its incidents and monitors, before the staging host it may be", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, POWERSHELL_CASE);
    await waitForRecords(page);

    expect(await names(page)).toEqual([
      "web-03",
      "web-03.staging.acme-commerce.example",
    ]);

    const web: Locator = record(page, "web-03");
    const incidents: Locator = factRow(web, "security-connected-incidents");
    await expect(
      incidents.getByTestId("security-connected-fact-label"),
    ).toHaveText("2 active incidents");
    expect(await factItems(incidents)).toEqual([
      "INC-1042 Checkout returns 502s",
    ]);
    await expect(incidents).toContainText("Investigating");
    await expect(incidents).toContainText("+1 more");
    expect(
      await hrefOf(
        web.getByRole("link", { name: "INC-1042 Checkout returns 502s" }),
      ),
    ).toBe(`${DASHBOARD}/incidents/2e000000-0000-4000-8000-000000000004`);
    const monitors: Locator = factRow(web, "security-connected-monitors");
    await expect(
      monitors.getByTestId("security-connected-fact-label"),
    ).toHaveText("Watched by 3 monitors");
    expect(await factItems(monitors)).toEqual(["web-03 ping", "Checkout API"]);
    await expect(monitors).toContainText("+1 more");
    expect(
      await hrefOf(web.getByTestId("security-connected-record-name")),
    ).toBe(`${DASHBOARD}/host/${WEB_03_ID}`);
    const staging: Locator = record(
      page,
      "web-03.staging.acme-commerce.example",
    );
    await expect(
      staging.getByTestId("security-connected-possible"),
    ).toBeVisible();
    // The exact host before the group of possible ones; the staging host inside it.
    const group: Locator = page.getByTestId(
      "security-connected-possible-group",
    );
    await expect(group).toBeVisible();
    await expect(group.getByTestId("security-connected-record")).toHaveCount(1);
    await expect(
      group.getByTestId("security-connected-record-name"),
    ).toHaveText("web-03.staging.acme-commerce.example");
    expect(
      await web.evaluate((element: Element): boolean => {
        return !element.closest(
          "[data-testid='security-connected-possible-group']",
        );
      }),
    ).toBe(true);
  });

  test("a read that fails says so in the product's words, and Try again reads it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE, { connections: "fail" });
    const error: Locator = page.getByTestId("security-connected-error");
    await expect(error).toBeVisible({ timeout: 30000 });
    await expect(records(page)).toHaveCount(0);

    await error.getByRole("button").click();
    await waitForRecords(page);
    expect(await names(page)).toEqual(["build-runner-07"]);
  });

  test("what the role keeps from it, and what could not be read, are said; nothing is called not in OneUptime that may be", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE, { connections: "partial" });
    const unreadable: Locator = page.getByTestId(
      "security-connected-unreadable",
    );
    await expect(unreadable).toHaveText(
      "Your role cannot see Users, so none is shown.",
      { timeout: 30000 },
    );
    const failed: Locator = page.getByTestId("security-connected-failed");
    await expect(failed).toContainText(
      "Kubernetes Clusters could not be read just now.",
    );
    // Nothing found - never "nothing it names is in OneUptime" - while a kind could not be read.
    const partly: Locator = page.getByTestId(
      "security-connected-partial-empty",
    );
    await expect(partly).toContainText("Nothing it names was found");
    await expect(partly).toContainText(
      "Some kinds of record could not be read, so it may still be in OneUptime.",
    );
    await expect(page.getByTestId("security-connected-empty")).toHaveCount(0);
    await expect(connected(page)).not.toContainText(
      "Nothing it names is in OneUptime",
    );
    // The emails may be members it cannot see, and the domain a cluster it could not read.
    const notFound: Locator = page.getByTestId("security-connected-not-found");
    await expect(notFound).toContainText("203.0.113.47");
    for (const value of [
      "k.morgan@acme-commerce.example",
      "j.wilson@acme-commerce.example",
      "acme-commerce.okta.example",
    ]) {
      await expect(notFound).not.toContainText(value);
    }

    await failed.getByRole("button", { name: "Try again" }).click();
    await waitForRecords(page);
    expect(await names(page)).toEqual(["Kai Morgan"]);
    await expect(page.getByTestId("security-connected-unreadable")).toHaveCount(
      0,
    );
  });

  test("a Security Viewer reads it too", async ({ page }: { page: Page }) => {
    await open(page, DOMAIN_CASE, { role: "viewer" });
    await waitForRecords(page);
    expect(await names(page)).toEqual(["build-runner-07"]);
  });

  /*
   * Every line whole: at a laptop's width and a phone's, in both themes; at
   * 1024 and 768, beside the case's side menu; nothing scrolls sideways and
   * no part of a record runs past its card.
   */
  for (const [width, theme] of [
    [1280, undefined],
    [1280, "dark"],
    [1024, undefined],
    [768, undefined],
    [390, undefined],
    [390, "dark"],
  ] as Array<[number, "dark" | undefined]>) {
    test(`at ${width}${theme ? `, ${theme}` : ""}, every record reads whole inside its card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const [target, name] of [
        [POWERSHELL_CASE, "web-03"],
        [DOMAIN_CASE, "build-runner-07"],
      ] as Array<[string, string]>) {
        await open(page, target, { width, theme });
        await waitForRecords(page);
        await expect(record(page, name)).toBeVisible();

        expect(
          await pageOverflow(page),
          `${target} at ${width}`,
        ).toBeLessThanOrEqual(1);
        expect(
          await partsOutsideTheCard(page),
          `${target} at ${width}`,
        ).toEqual([]);
      }

      await screenshot(
        page,
        `case-connected-signals-${width}${theme ? `-${theme}` : ""}`,
      );
    });
  }

  /*
   * A busy case: one record of every kind, every fact a record can have,
   * four possible matches. The facts read as a column - their labels beside
   * their items from 32rem of a record's own width (a laptop's page, the
   * event drawer), above them below it (a phone, a tablet beside the case's
   * menu) - one item a line, never run into the next, and nothing past the
   * card.
   */
  for (const [width, theme, isBeside] of [
    [1280, undefined, true],
    [1280, "dark", true],
    [768, undefined, false],
    [390, undefined, false],
    [390, "dark", false],
  ] as Array<[number, "dark" | undefined, boolean]>) {
    test(`a busy case at ${width}${theme ? `, ${theme}` : ""}: each fact a column of items, its label ${isBeside ? "beside" : "above"} them`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, DOMAIN_CASE, { width, theme, connections: "busy" });
      await waitForRecords(page);

      expect(await names(page)).toEqual([
        "checkout-web-01",
        "prod-eu-west-1",
        "checkout-api",
        "edge-fw-01",
        "Kai Morgan",
        "checkout-web-01.staging.acme-commerce.example",
        "lab-podman-01",
        "db-replica-2",
        "cache-docker-1",
      ]);
      const group: Locator = page.getByTestId(
        "security-connected-possible-group",
      );
      await expect(group.getByTestId("security-connected-record")).toHaveCount(
        4,
      );
      await expect(
        group.getByTestId("security-connected-possible"),
      ).toHaveCount(4);

      const rows: Array<FactRowLayout> = await factRowLayouts(page);
      expect(rows.length).toBeGreaterThanOrEqual(8);
      expect(itemsOnLinesOfTheirOwn(rows)).toEqual([]);

      for (const row of rows) {
        const first: Box = row.items[0]!;

        // The rule, by the record's own width: beside from 32rem, above below it.
        expect(
          row.recordWidth >= FACTS_BESIDE_FROM,
          `${row.record} ${row.fact} at ${Math.round(row.recordWidth)}px`,
        ).toBe(isBeside);

        if (isBeside) {
          // Beside: the label ends before its first item starts, on the same line.
          expect(
            row.label.right,
            `${row.record} ${row.fact}`,
          ).toBeLessThanOrEqual(first.left + 1);
          expect(
            Math.abs(row.label.top - first.top),
            `${row.record} ${row.fact}`,
          ).toBeLessThanOrEqual(4);
        } else {
          // Above: the label's line ends before its first item's starts.
          expect(
            row.label.bottom,
            `${row.record} ${row.fact}`,
          ).toBeLessThanOrEqual(first.top + 1);
        }
      }

      /*
       * A change's title beside its time while it keeps 16rem there, under
       * it otherwise (a phone, a tablet beside the case's menu): never in a
       * column a few words wide.
       */
      const change: Locator = record(page, "checkout-web-01")
        .getByTestId("security-connected-changes")
        .getByTestId("security-connected-fact-item")
        .last();
      const placed: {
        item: number;
        time: { top: number; bottom: number; width: number };
        title: { top: number; width: number };
      } = await change.evaluate((item: Element) => {
        const time: DOMRect = item
          .querySelector("time")!
          .getBoundingClientRect();
        const title: DOMRect = item
          .querySelector("time + span")!
          .getBoundingClientRect();
        return {
          item: item.getBoundingClientRect().width,
          time: { top: time.top, bottom: time.bottom, width: time.width },
          title: { top: title.top, width: title.width },
        };
      });
      const isTitleBeside: boolean =
        placed.item >= placed.time.width + 12 + 16 * 16;
      if (isTitleBeside) {
        expect(
          Math.abs(placed.title.top - placed.time.top),
        ).toBeLessThanOrEqual(4);
        expect(placed.title.width).toBeGreaterThanOrEqual(16 * 16 - 1);
      } else {
        expect(placed.title.top).toBeGreaterThanOrEqual(placed.time.bottom - 1);
      }
      // On a phone the title is under its time; on a laptop's page beside it.
      expect(isTitleBeside).toBe(width === 1280);

      await expect(
        page.getByTestId("security-connected-more-records"),
      ).toBeVisible();
      await expect(
        page.getByTestId("security-connected-not-found"),
      ).toContainText("kiosk-17");
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await partsOutsideTheCard(page)).toEqual([]);
      await screenshot(
        page,
        `case-connected-signals-busy-${width}${theme ? `-${theme}` : ""}`,
      );
    });
  }

  test("a busy case in Persian on a phone: right to left, each item on a line of its own, nothing past the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE, {
      width: 390,
      lang: "fa",
      connections: "busy",
    });
    await waitForRecords(page);

    await expect(
      page
        .getByTestId("security-connected-possible-group")
        .getByRole("heading", { level: 3 }),
    ).toHaveText(
      "\u{062A}\u{0637}\u{0627}\u{0628}\u{0642}\u{200C}\u{0647}\u{0627}\u{06CC} \u{0627}\u{062D}\u{062A}\u{0645}\u{0627}\u{0644}\u{06CC}",
    );
    const rows: Array<FactRowLayout> = await factRowLayouts(page);
    expect(itemsOnLinesOfTheirOwn(rows)).toEqual([]);
    for (const row of rows) {
      expect(row.label.bottom).toBeLessThanOrEqual(row.items[0]!.top + 1);
      // Right to left: a label's words start at the record's right edge, where its items start.
      expect(
        Math.abs(row.labelText.right - row.items[0]!.right),
        `${row.record} ${row.fact}`,
      ).toBeLessThanOrEqual(2);
      expect(row.labelText.left).toBeGreaterThan(row.items[0]!.left + 8);
    }
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    expect(await partsOutsideTheCard(page)).toEqual([]);
    await screenshot(page, "case-connected-signals-busy-fa-390");
  });

  test("in German: the page's own words, each record's reason a whole German sentence", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DUMP_CASE, { width: 1280, lang: "de" });
    await waitForRecords(page);

    await expect(menuEntry(page, "Verbundene Signale")).toBeVisible();
    await expect(connected(page)).toContainText("Verbundene Signale");
    const host: Locator = record(page, "fin-ws-112.corp.acme-commerce.example");
    await expect(
      host.getByTestId("security-connected-record-reason"),
    ).toHaveText(
      "Als fin-ws-112 genannt, eine Kurz- oder Langform seines Namens fin-ws-112.corp.acme-commerce.example. Ein anderer Rechner kann ihn ebenfalls haben.",
    );
    await expect(host.getByTestId("security-connected-possible")).toHaveText(
      "Mögliche Übereinstimmung",
    );
    await expect(
      page.getByTestId("security-connected-not-found"),
    ).toContainText("Nicht in OneUptime");
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    expect(await partsOutsideTheCard(page)).toEqual([]);
    await screenshot(page, "case-connected-signals-de");
  });

  for (const width of [1280, 390]) {
    test(`in Persian at ${width}: right to left, each line on the card's right, nothing running past it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, DOMAIN_CASE, { width, lang: "fa" });
      await waitForRecords(page);

      expect(
        await page.evaluate((): string => {
          return document.documentElement.dir;
        }),
      ).toBe("rtl");
      await expect(connected(page)).toContainText("سیگنال‌های مرتبط");

      const runner: Locator = record(page, "build-runner-07");
      await expect(
        runner.getByTestId("security-connected-record-reason"),
      ).toHaveText("با نام build-runner-07 شناسایی شد؛ نامی که گزارش می‌کند.");

      // The record's icon starts the line on the right, its name to its left.
      const card: { left: number; right: number } = await connected(
        page,
      ).evaluate((element: Element) => {
        const box: DOMRect = element.getBoundingClientRect();
        return { left: box.left, right: box.right };
      });
      const icon: { left: number; right: number } = await runner
        .locator("svg")
        .first()
        .evaluate((element: Element) => {
          const box: DOMRect = element.getBoundingClientRect();
          return { left: box.left, right: box.right };
        });
      const nameBox: { left: number; right: number } = await runner
        .getByTestId("security-connected-record-name")
        .evaluate((element: Element) => {
          const box: DOMRect = element.getBoundingClientRect();
          return { left: box.left, right: box.right };
        });
      expect(icon.right).toBeGreaterThan(nameBox.right);
      expect(card.right - icon.right).toBeLessThan(card.right - card.left);

      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await partsOutsideTheCard(page)).toEqual([]);
      await screenshot(page, `case-connected-signals-fa-${width}`);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * An entity's page
 * ---------------------------------------------------------------------------
 */

test.describe("an entity's page", () => {
  test("says where OneUptime knows it, around its last event", async ({
    page,
  }: {
    page: Page;
  }) => {
    const query: URLSearchParams = new URLSearchParams({
      value: "k.morgan@acme-commerce.example",
      type: "User",
    });
    await open(page, `${PRODUCT}/entity-risk/entity?${query.toString()}`);
    await waitForRecords(page);

    await expect(connected(page)).toContainText(
      "Where OneUptime knows it, and what was happening there around its last security event.",
    );
    expect(await names(page)).toEqual(["Kai Morgan"]);

    const request: { body: Record<string, unknown> } | undefined =
      await page.evaluate(() => {
        const state: {
          apiRequests: Array<{ url: string; body: Record<string, unknown> }>;
        } = (
          window as unknown as {
            __securityOperationsFixture: {
              apiRequests: Array<{
                url: string;
                body: Record<string, unknown>;
              }>;
            };
          }
        ).__securityOperationsFixture;
        return JSON.parse(
          JSON.stringify(
            state.apiRequests.find((item: { url: string }) => {
              return item.url.endsWith("/security-case/connections");
            }),
          ),
        );
      });
    expect(request?.body).toMatchObject({
      entities: [{ type: "User", value: "k.morgan@acme-commerce.example" }],
      readLogResources: true,
    });

    for (const [width, theme] of [
      [1280, undefined],
      [390, "dark"],
    ] as Array<[number, "dark" | undefined]>) {
      await open(page, `${PRODUCT}/entity-risk/entity?${query.toString()}`, {
        width,
        theme,
      });
      await waitForRecords(page);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await partsOutsideTheCard(page)).toEqual([]);
      await screenshot(
        page,
        `entity-connected-signals-${width}${theme ? `-${theme}` : ""}`,
      );
    }
  });
});
