import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "Common/Types/ReadingDirection";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Connected Signals: what a security case names in the rest of OneUptime -
 * the project's hosts and members - as the fixture's records and the
 * server's own matching rules have it (Fixture/ConnectionsFixture.js), on a
 * case's own page and on an entity's; and under them, where what it names
 * appears in the logs and traces themselves
 * (Fixture/TelemetryMentionsFixture.js).
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
  telemetry?: "fail" | "limited" | "slow";
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
  if (options.telemetry) {
    url.searchParams.set("telemetry", options.telemetry);
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
          anchor.querySelector('[data-testid="side-menu-item-title"]')
            ?.textContent ||
          anchor.textContent ||
          ""
        ).trim();
      });
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
        "[data-testid='security-connected-record'] *, [data-testid='security-connected-not-found'] *, [data-testid='security-telemetry-mentions'] *",
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
    for (const fact of [
      "security-connected-incidents",
      "security-connected-alerts",
      "security-connected-monitors",
      "security-connected-changes",
    ]) {
      await expect(kai.getByTestId(fact)).toHaveCount(0);
    }

    /*
     * Who to reach: the on-call schedules they are on, the one they are on
     * call for now first and saying so, and the teams they are in - each
     * opening its page.
     */
    const schedules: Locator = factRow(kai, "security-connected-schedules");
    await expect(
      schedules.getByTestId("security-connected-fact-label"),
    ).toHaveText("On 2 on-call schedules");
    expect(await factItems(schedules)).toEqual([
      "Identity on-call",
      "Checkout primary",
    ]);
    const scheduleItems: Locator = schedules.getByTestId(
      "security-connected-fact-item",
    );
    await expect(
      scheduleItems.nth(0).getByTestId("security-connected-on-call-now"),
    ).toHaveText("On call now");
    await expect(
      scheduleItems.nth(1).getByTestId("security-connected-on-call-now"),
    ).toHaveCount(0);
    expect(
      await hrefOf(
        scheduleItems
          .nth(0)
          .getByRole("link", { name: "Identity on-call", exact: true }),
      ),
    ).toBe(
      `${DASHBOARD}/on-call-duty/schedules/3e000000-0000-4000-8000-000000000001`,
    );

    const teams: Locator = factRow(kai, "security-connected-teams");
    await expect(teams.getByTestId("security-connected-fact-label")).toHaveText(
      "In 2 teams",
    );
    expect(await factItems(teams)).toEqual(["Checkout SRE", "Identity"]);
    expect(
      await hrefOf(teams.getByRole("link", { name: "Identity", exact: true })),
    ).toBe(`${DASHBOARD}/teams/81000000-0000-4000-8000-000000000021`);
    // Each on a line of its own, its label beside or above it.
    expect(itemsOnLinesOfTheirOwn(await factRowLayouts(page))).toEqual([]);

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
    // No matching record found - never "no record matches what it names" - while a kind could not be read.
    const partly: Locator = page.getByTestId(
      "security-connected-partial-empty",
    );
    await expect(partly).toContainText("No matching record was found");
    await expect(partly).toContainText(
      "Some kinds of record could not be read, so one may still match.",
    );
    await expect(page.getByTestId("security-connected-empty")).toHaveCount(0);
    await expect(connected(page)).not.toContainText(
      "No record matches what it names",
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

        await expectNoSidewaysScroll(page, {
          tolerance: 1,
          message: `${target} at ${width}`,
        });
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

      // Exact first, then by kind, then by name - as the server orders them.
      expect(await names(page)).toEqual([
        "checkout-web-01",
        "prod-eu-west-1",
        "edge-fw-01",
        "checkout-alb",
        "orders-webhook",
        "checkout-api",
        "Storefront",
        "Kai Morgan",
        "checkout-web-01.staging.acme-commerce.example",
        "db-replica-2",
        "cache-docker-1",
        "lab-podman-01",
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
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      expect(await partsOutsideTheCard(page)).toEqual([]);
      await screenshot(
        page,
        `case-connected-signals-busy-${width}${theme ? `-${theme}` : ""}`,
      );
    });
  }

  test("a monitor with its status, a cloud resource and a serverless function, each by what named it, and a member's schedules and teams", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE, { width: 1280, connections: "busy" });
    await waitForRecords(page);
    // The busy answer's records (ConnectionsFixture.js's busyAnswer).
    const recordId: (n: number) => string = (n: number): string => {
      return `2d000000-0000-4000-8000-${String(200 + n).padStart(12, "0")}`;
    };

    /*
     * The monitor: by the host of a URL it checks, its status beside its
     * name, its incidents, and its Logs and Metrics - what it saw on each
     * check. Nothing watches a monitor, and it has no changes of its own.
     */
    const monitor: Locator = record(page, "Storefront");
    await expect(monitor).toHaveAttribute("data-kind", "Monitor");
    await expect(monitor).toHaveAttribute("data-certainty", "Exact");
    await expect(
      monitor.getByTestId("security-connected-monitor-status"),
    ).toHaveText("Degraded");
    await expect(
      monitor.getByTestId("security-connected-record-reason"),
    ).toHaveText(
      "Named https://shop.acme-commerce.example/login, on shop.acme-commerce.example, the address it checks.",
    );
    expect(
      await hrefOf(monitor.getByTestId("security-connected-record-name")),
    ).toBe(`${DASHBOARD}/monitors/${recordId(12)}`);
    const monitorLinks: Locator = monitor.getByTestId(
      "security-connected-signal-links",
    );
    expect(
      (await monitorLinks.getByRole("link").allInnerTexts()).map(
        (text: string) => {
          return text.trim();
        },
      ),
    ).toEqual(["Logs", "Metrics"]);
    expect(await hrefOf(monitorLinks.getByRole("link", { name: "Logs" }))).toBe(
      `${DASHBOARD}/monitors/${recordId(12)}/logs`,
    );
    expect(
      await factItems(factRow(monitor, "security-connected-incidents")),
    ).toEqual(["INC-1043 Storefront slow for EU visitors"]);
    for (const fact of [
      "security-connected-monitors",
      "security-connected-changes",
    ]) {
      await expect(monitor.getByTestId(fact)).toHaveCount(0);
    }

    // The cloud resource: by a name it answers on, with the monitor watching it.
    const alb: Locator = record(page, "checkout-alb");
    await expect(alb).toHaveAttribute("data-kind", "CloudResource");
    await expect(
      alb.getByTestId("security-connected-record-reason"),
    ).toHaveText(
      "Named checkout-alb-1234.eu-west-1.elb.amazonaws.com, a name it answers on.",
    );
    expect(
      await hrefOf(alb.getByTestId("security-connected-record-name")),
    ).toBe(`${DASHBOARD}/cloud/${recordId(10)}`);
    const albLogs: URL = new URL(
      (await hrefOf(
        alb
          .getByTestId("security-connected-signal-links")
          .getByRole("link", { name: "Logs" }),
      ))!,
      `http://127.0.0.1:${PORT}`,
    );
    expect(albLogs.pathname).toBe(`${DASHBOARD}/logs`);
    expect(JSON.parse(albLogs.searchParams.get("filters") || "[]")).toEqual([
      ["cloudResourceId", [recordId(10)]],
    ]);
    const watching: Locator = factRow(alb, "security-connected-monitors");
    expect(await factItems(watching)).toEqual(["Storefront"]);
    expect(await hrefOf(watching.getByRole("link"))).toBe(
      `${DASHBOARD}/monitors/${recordId(12)}`,
    );
    expect(await factItems(factRow(alb, "security-connected-changes"))).toEqual(
      ["Changed the listener rule: /checkout to the canary target group"],
    );

    // The serverless function: by its own logs, and what changed on it.
    const webhook: Locator = record(page, "orders-webhook");
    await expect(webhook).toHaveAttribute("data-kind", "ServerlessFunction");
    await expect(
      webhook.getByTestId("security-connected-record-reason"),
    ).toHaveText("Read from its logs.");
    expect(
      await hrefOf(webhook.getByTestId("security-connected-record-name")),
    ).toBe(`${DASHBOARD}/serverless/${recordId(11)}`);
    expect(
      await factItems(factRow(webhook, "security-connected-changes")),
    ).toEqual(["Deployed version 42"]);
    await expect(
      webhook.getByTestId("security-connected-incidents"),
    ).toHaveCount(0);

    // The member: more schedules than are listed.
    const schedules: Locator = factRow(
      record(page, "Kai Morgan"),
      "security-connected-schedules",
    );
    await expect(
      schedules.getByTestId("security-connected-fact-label"),
    ).toHaveText("On 3 on-call schedules");
    await expect(schedules).toContainText("+1 more");
    await expect(
      schedules.getByTestId("security-connected-on-call-now"),
    ).toHaveCount(1);
    await expect(
      factRow(record(page, "Kai Morgan"), "security-connected-teams"),
    ).toContainText("Checkout SRE");

    // Each new kind's line as it is drawn, for the UI review.
    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await page.mouse.move(0, 0);
    for (const [name, file] of [
      ["Storefront", "monitor"],
      ["checkout-alb", "cloud-resource"],
      ["orders-webhook", "serverless-function"],
      ["Kai Morgan", "member"],
    ] as Array<[string, string]>) {
      await record(page, name).screenshot({
        path: path.join(
          SCREENSHOTS,
          `case-connected-signals-busy-${file}-synthetic.png`,
        ),
        animations: "disabled",
      });
    }
  });

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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    ).toContainText("Kein passender Datensatz");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
      // The host the case named, set apart from the sentence read from the right.
      await expect(
        runner.getByTestId("security-connected-record-reason"),
      ).toHaveText(
        `با نام ${FIRST_STRONG_ISOLATE}build-runner-07${POP_DIRECTIONAL_ISOLATE} شناسایی شد؛ نامی که گزارش می‌کند.`,
      );

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

      await expectNoSidewaysScroll(page, { tolerance: 1 });
      expect(await partsOutsideTheCard(page)).toEqual([]);
      await screenshot(page, `case-connected-signals-fa-${width}`);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * A member's own page: the way back
 * ---------------------------------------------------------------------------
 */

test.describe("a member's own page", () => {
  test("a connected member's name opens their page, whose Security card says the cases naming them and their week, and opens Security Events on them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE, { width: 1280 });
    await waitForRecords(page);
    await record(page, "Kai Morgan")
      .getByTestId("security-connected-record-name")
      .click();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD}/users/${KAI_ID}$`));

    const card: Locator = page.getByTestId("resource-security-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute("data-state", "news");
    await expect(card).toContainText(
      "What Security Events found about it in the last 7 days.",
    );

    // The open cases naming their email, the one detected last first.
    const cases: Locator = card.getByTestId("resource-security-case");
    await expect(cases).toHaveCount(2);
    await expect(cases.nth(0)).toContainText("Password spray against Okta");
    await expect(cases.nth(1)).toContainText(
      "Impossible travel for k.morgan@acme-commerce.example",
    );
    expect(
      await cases
        .nth(0)
        .getByRole("link", { name: /Password spray against Okta/ })
        .getAttribute("href"),
    ).toBe(`${PRODUCT}/cases/20000000-0000-4000-8000-000000000142`);

    // Their week, opening the explorer on what named their email.
    const events: Locator = card.getByTestId("resource-security-open");
    await expect(events).toHaveText("58");
    const search: URL = new URL(
      (await hrefOf(events))!,
      `http://127.0.0.1:${PORT}`,
    );
    expect(search.pathname).toBe(PRODUCT);
    expect(decodeURIComponent(search.searchParams.get("search") || "")).toBe(
      "observable:k.morgan@acme-commerce.example",
    );

    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await page.mouse.move(0, 0);
    await card.screenshot({
      path: path.join(SCREENSHOTS, "member-security-card-1280-synthetic.png"),
      animations: "disabled",
    });

    // Open in Security Events: their entity's page, where OneUptime knows them.
    await card.getByRole("link", { name: "Open in Security Events" }).click();
    await expect(page).toHaveURL(/\/security-events\/entity-risk\/entity\?/);
    const entity: URL = new URL(page.url());
    expect(entity.searchParams.get("value")).toBe(
      "k.morgan@acme-commerce.example",
    );
    expect(entity.searchParams.get("type")).toBe("User");
    await waitForRecords(page);
    expect(await names(page)).toEqual(["Kai Morgan"]);
  });

  test("on a phone, dark: the member's Security card reads whole, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${DASHBOARD}/users/${KAI_ID}`, {
      width: 390,
      theme: "dark",
    });
    const card: Locator = page.getByTestId("resource-security-card");
    await expect(
      card.getByTestId("resource-security-case").first(),
    ).toBeVisible({ timeout: 30000 });
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    const outside: Array<string> = await card.evaluate(
      (root: Element): Array<string> => {
        const box: DOMRect = root.getBoundingClientRect();
        const found: Array<string> = [];
        root.querySelectorAll("*").forEach((element: Element): void => {
          const part: DOMRect = element.getBoundingClientRect();
          if (
            part.width > 0 &&
            part.height > 0 &&
            (part.left < box.left - 1 || part.right > box.right + 1)
          ) {
            found.push((element.textContent || "").trim().slice(0, 40));
          }
        });
        return found;
      },
    );
    expect(outside).toEqual([]);
    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await card.screenshot({
      path: path.join(
        SCREENSHOTS,
        "member-security-card-390-dark-synthetic.png",
      ),
      animations: "disabled",
    });
  });
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
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      expect(await partsOutsideTheCard(page)).toEqual([]);
      await screenshot(
        page,
        `entity-connected-signals-${width}${theme ? `-${theme}` : ""}`,
      );
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * In your logs and traces: where what a case names appears in the logs and
 * traces themselves (Fixture/TelemetryMentionsFixture.js lays the lines and
 * spans out, and counts them with the server's own rules)
 * ---------------------------------------------------------------------------
 */

function telemetry(page: Page): Locator {
  return page.getByTestId("security-telemetry-mentions");
}

function telemetryValues(page: Page): Locator {
  return telemetry(page).getByTestId("security-telemetry-value");
}

// A value's entry, by the value its chip shows.
function telemetryValue(page: Page, value: string): Locator {
  return telemetryValues(page).filter({
    has: page
      .getByTestId("security-telemetry-value-name")
      .getByText(value, { exact: true }),
  });
}

async function waitForTelemetry(page: Page): Promise<void> {
  await expect(telemetryValues(page).first()).toBeVisible({ timeout: 30000 });
}

// The places a row lists, each as it reads: where, then how many.
async function placeTexts(row: Locator): Promise<Array<string>> {
  return (
    await row.getByTestId("security-telemetry-place").allInnerTexts()
  ).map((text: string): string => {
    return text.replace(/\s+/g, " ").trim();
  });
}

async function sourceNames(row: Locator): Promise<Array<string>> {
  return (
    await row
      .getByTestId("security-telemetry-source")
      .locator("bdi")
      .allInnerTexts()
  ).map((text: string): string => {
    return text.trim();
  });
}

// How many of the lines or spans each sender sent, as each says it.
async function sourceCounts(row: Locator): Promise<Array<string>> {
  return (
    await row.getByTestId("security-telemetry-source-count").allInnerTexts()
  ).map((text: string): string => {
    return text.replace(/\s+/g, " ").trim();
  });
}

function telemetryReads(
  requests: Array<{ url: string; body: Record<string, unknown> }>,
): Array<{ url: string; body: Record<string, unknown> }> {
  return requests.filter((item: { url: string }) => {
    return new URL(item.url).pathname.endsWith(
      "/security-case/connections/telemetry",
    );
  });
}

async function fixtureRequests(
  page: Page,
): Promise<Array<{ url: string; body: Record<string, unknown> }>> {
  return page.evaluate(() => {
    const state: {
      apiRequests: Array<{ url: string; body: Record<string, unknown> }>;
    } = (
      window as unknown as {
        __securityOperationsFixture: {
          apiRequests: Array<{ url: string; body: Record<string, unknown> }>;
        };
      }
    ).__securityOperationsFixture;
    return JSON.parse(JSON.stringify(state.apiRequests));
  });
}

function linkOf(href: string | null): URL {
  expect(href).toBeTruthy();
  return new URL(href!, `http://127.0.0.1:${PORT}`);
}

interface TelemetryRowLayout {
  row: string;
  // The value's text column: the size container the row reads, as a record's.
  sectionWidth: number;
  label: Box;
  labelText: Box;
  items: Box;
}

// Every row of every value, as the browser lays it out.
async function telemetryRowLayouts(
  page: Page,
): Promise<Array<TelemetryRowLayout>> {
  return telemetry(page).evaluate(
    (root: Element): Array<TelemetryRowLayout> => {
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

      return Array.from(
        root.querySelectorAll(
          "[data-testid='security-telemetry-logs'], [data-testid='security-telemetry-spans']",
        ),
      ).map((row: Element): TelemetryRowLayout => {
        const label: Element = row.querySelector("dt")!;
        const words: Range = document.createRange();
        words.selectNodeContents(label);

        const container: Element | null = row.closest(
          "[class*='container-type']",
        );

        return {
          row: `${(row.closest("[data-testid='security-telemetry-value']")?.textContent || "").slice(0, 24)} ${row.getAttribute("data-testid")}`,
          sectionWidth: container ? container.getBoundingClientRect().width : 0,
          label: boxOf(label),
          labelText: boxOf(words),
          items: boxOf(row.querySelector("dd")!),
        };
      });
    },
  );
}

/*
 * The lines of each value's name that do not end at its row's right edge,
 * on a right-to-left page: none may - a value that wraps keeps every line at
 * the page's start.
 */
async function valueLinesOffTheStart(page: Page): Promise<Array<string>> {
  return telemetry(page).evaluate((root: Element): Array<string> => {
    const off: Array<string> = [];

    root
      .querySelectorAll("[data-testid='security-telemetry-value-name']")
      .forEach((row: Element): void => {
        const value: Element | null = row.querySelector("bdi");

        if (!value) {
          return;
        }

        const rowRight: number = row.getBoundingClientRect().right;
        const words: Range = document.createRange();
        words.selectNodeContents(value);

        Array.from(words.getClientRects()).forEach((line: DOMRect): void => {
          if (Math.abs(line.right - rowRight) > 2) {
            off.push(
              `${(value.textContent || "").slice(0, 32)}: a line ends at ${Math.round(line.right)}, its row at ${Math.round(rowRight)}`,
            );
          }
        });
      });

    return off;
  });
}

// The parts of the section that run past the card around it: none may.
async function telemetryPartsOutside(page: Page): Promise<Array<string>> {
  return connected(page).evaluate((root: Element): Array<string> => {
    const card: DOMRect = root.getBoundingClientRect();
    const outside: Array<string> = [];

    root
      .querySelectorAll("[data-testid='security-telemetry-mentions'] *")
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

// The services and the host TelemetryMentionsFixture.js names.
const OKTA_GATEWAY_ID: string = "2f000000-0000-4000-8000-000000000001";

test.describe("In your logs and traces", () => {
  test("under the spray case's records: the values found, in the order named, each with its log lines and spans, where in them and who sent them; the rest are not in them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE, { width: 1280 });
    await waitForRecords(page);
    await waitForTelemetry(page);

    // Under the records, a rule between, its own heading and the window.
    await expect(telemetry(page).getByRole("heading", { level: 3 })).toHaveText(
      "In your logs and traces",
    );
    await expect(telemetry(page)).toContainText(
      "Where the values it names appear in your logs and traces from",
    );
    const below: boolean = await page.evaluate((): boolean => {
      const section: Element | null = document.querySelector(
        "[data-testid='security-telemetry-mentions']",
      );
      const lastRecord: Element | null = Array.from(
        document.querySelectorAll("[data-testid='security-connected-record']"),
      ).pop() as Element | null;
      return Boolean(
        section &&
          lastRecord &&
          lastRecord.compareDocumentPosition(section) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(below).toBe(true);

    // Its rows line up with the records' facts above them: the same columns.
    const recordRows: Array<FactRowLayout> = await factRowLayouts(page);
    const valueRows: Array<TelemetryRowLayout> =
      await telemetryRowLayouts(page);
    expect(
      Math.abs(recordRows[0]!.label.left - valueRows[0]!.label.left),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(recordRows[0]!.items[0]!.left - valueRows[0]!.items.left),
    ).toBeLessThanOrEqual(1);

    // The values found, in the order the case names them.
    await expect(telemetryValues(page)).toHaveCount(2);
    /*
     * Each as it is written, in the product's monospace face, as its chips
     * draw values - set on its isolate, which the page's "* { font-family }"
     * rule would otherwise draw in Inter.
     */
    expect(
      await telemetryValues(page)
        .first()
        .getByTestId("security-telemetry-value-name")
        .locator("bdi")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).fontFamily;
        }),
    ).toContain("monospace");
    await expect(telemetryValues(page).nth(0)).toContainText("203.0.113.47");
    await expect(telemetryValues(page).nth(1)).toContainText(
      "k.morgan@acme-commerce.example",
    );

    // The spray's address: in 1,344 log lines - 7 lines of 203.0.113.470 and 3 of 1203.0.113.47 left out.
    const attacker: Locator = telemetryValue(page, "203.0.113.47");
    const logs: Locator = attacker.getByTestId("security-telemetry-logs");
    await expect(logs.getByTestId("security-connected-fact-label")).toHaveText(
      "In 1,344 log lines",
    );
    expect(await placeTexts(logs)).toEqual([
      "In the message 1,260",
      "client_ip 84",
    ]);
    expect(await sourceNames(logs)).toEqual(["okta-gateway", "waf"]);
    // How many of the lines each sent, said as lines - never a bare number.
    expect(await sourceCounts(logs)).toEqual(["1,284 lines", "20 lines"]);
    // A service the reader cannot name is counted, never listed.
    await expect(logs).toContainText("+1 more");

    const message: URL = linkOf(
      await logs
        .getByTestId("security-telemetry-place")
        .nth(0)
        .getAttribute("href"),
    );
    expect(message.pathname).toBe(`${DASHBOARD}/logs`);
    expect(JSON.parse(message.searchParams.get("filters") || "[]")).toEqual([
      ["body", ["203.0.113.47"]],
    ]);
    expect(message.searchParams.get("range")).toBe("Custom");
    expect(
      await logs
        .getByTestId("security-telemetry-place")
        .nth(0)
        .getAttribute("title"),
    ).toBe("Open in Logs");

    const attribute: URL = linkOf(
      await logs
        .getByTestId("security-telemetry-place")
        .nth(1)
        .getAttribute("href"),
    );
    expect(JSON.parse(attribute.searchParams.get("filters") || "[]")).toEqual([
      ["attributes.client_ip", ["203.0.113.47"]],
    ]);

    expect(
      await logs
        .getByTestId("security-telemetry-source")
        .first()
        .getByRole("link")
        .getAttribute("href"),
    ).toBe(`${DASHBOARD}/service/${OKTA_GATEWAY_ID}`);

    // Its spans: one place each key holding it, opening the Traces explorer's search.
    const spans: Locator = attacker.getByTestId("security-telemetry-spans");
    await expect(spans.getByTestId("security-connected-fact-label")).toHaveText(
      "In 312 spans",
    );
    expect(await placeTexts(spans)).toEqual([
      "client.address 300",
      "net.peer.ip 12",
    ]);
    expect(await sourceNames(spans)).toEqual(["auth"]);
    expect(await sourceCounts(spans)).toEqual(["312 spans"]);
    const traces: URL = linkOf(
      await spans
        .getByTestId("security-telemetry-place")
        .first()
        .getAttribute("href"),
    );
    expect(traces.pathname).toBe(`${DASHBOARD}/traces`);
    expect(traces.searchParams.get("search")).toBe(
      "@client.address:203.0.113.47",
    );

    // Kai's email: as user.email in auth's lines, as enduser.id in checkout-api's spans.
    const kai: Locator = telemetryValue(page, "k.morgan@acme-commerce.example");
    expect(
      await placeTexts(kai.getByTestId("security-telemetry-logs")),
    ).toEqual(["user.email 3"]);
    expect(
      await sourceNames(kai.getByTestId("security-telemetry-spans")),
    ).toEqual(["checkout-api"]);

    // Searched in both, named by neither.
    const notFound: Locator = telemetry(page).getByTestId(
      "security-telemetry-not-found",
    );
    await expect(notFound).toContainText("Not in your logs or traces");
    for (const value of [
      "j.wilson@acme-commerce.example",
      "a.ng@acme-commerce.example",
      "acme-commerce.okta.example",
    ]) {
      await expect(notFound).toContainText(value);
    }
    await expect(notFound).not.toContainText("203.0.113.47");

    // One read, of the case, beside the records' own.
    expect(telemetryReads(await fixtureRequests(page))).toEqual([
      expect.objectContaining({
        body: { caseId: "20000000-0000-4000-8000-000000000142" },
      }),
    ]);
    await screenshot(page, "case-telemetry-mentions-1280");
  });

  test("the domain case: a name never inside a longer one, a resource attribute never a place, a span's attribute as the span holds it, a bare host name not searched for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE, { width: 1280 });
    await waitForTelemetry(page);

    const domain: Locator = telemetryValue(page, "update-sync.bad-cdn.example");
    const logs: Locator = domain.getByTestId("security-telemetry-logs");
    // 18 lookups and 6 CONNECTs; the 4 lookups of sub.update-sync.bad-cdn.example are another name.
    await expect(logs.getByTestId("security-connected-fact-label")).toHaveText(
      "In 24 log lines",
    );
    expect(await sourceNames(logs)).toEqual([
      "build-runner-07",
      "egress-proxy",
    ]);
    await expect(
      logs.getByTestId("security-telemetry-source").first(),
    ).toContainText("Host");

    const span: Locator = domain
      .getByTestId("security-telemetry-spans")
      .getByTestId("security-telemetry-place");
    await expect(span).toHaveText(/server\.address\s*2/);
    expect(
      linkOf(await span.getAttribute("href")).searchParams.get("search"),
    ).toBe("@server.address:UPDATE-SYNC.BAD-CDN.EXAMPLE");

    // The runner's address in the proxy's 6 CONNECTs - never the 120 heartbeats that only came from it.
    await expect(
      telemetryValue(page, "198.51.100.23")
        .getByTestId("security-telemetry-logs")
        .getByTestId("security-connected-fact-label"),
    ).toHaveText("In 6 log lines");

    // build-runner-07 is a bare name: its own record is its answer.
    await expect(telemetryValue(page, "build-runner-07")).toHaveCount(0);
    await expect(
      telemetry(page).getByTestId("security-telemetry-not-found"),
    ).toHaveCount(0);
  });

  test("a case that names nothing searched for shows no section at all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, POWERSHELL_CASE, { width: 1280 });
    await waitForRecords(page);
    await expect
      .poll(async () => {
        return telemetryReads(await fixtureRequests(page)).length;
      })
      .toBe(1);
    await expect(telemetry(page)).toHaveCount(0);
    await expect(connected(page)).not.toContainText("In your logs and traces");
  });

  test("a search that fails says so on one line under its heading, why, and Try again searches again; the records stay", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE, { width: 1280, telemetry: "fail" });
    await waitForRecords(page);

    const error: Locator = page.getByTestId("security-telemetry-error");
    await expect(error).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("security-connected-error")).toHaveCount(0);
    /*
     * Said as a signal that could not be searched is, then why, then Try
     * again. The fixture's answer says nothing ("Server Error"), so why is
     * that the server could not explain it (#6836) - said once: the line
     * already says the search did not finish, and Try again is its button.
     */
    await expect(error).toHaveText(
      "Logs and Traces could not be searched just now. The server ran into a problem it could not explain. Try again",
    );
    await expect(error).not.toContainText("Server Error");
    await expect(telemetry(page).getByRole("heading", { level: 3 })).toHaveText(
      "In your logs and traces",
    );
    // One line under the heading - never the app's large centred error.
    await expect(telemetry(page).getByTestId("refresh-button")).toHaveCount(0);
    const line: Box = await error.evaluate((element: Element): Box => {
      const box: DOMRect = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    });
    expect(line.bottom - line.top).toBeLessThan(32);
    const heading: Box = await telemetry(page)
      .getByRole("heading", { level: 3 })
      .evaluate((element: Element): Box => {
        const box: DOMRect = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      });
    // At the heading's start, right under it.
    expect(Math.abs(line.left - heading.left)).toBeLessThanOrEqual(1);
    expect(line.top - heading.bottom).toBeLessThan(16);
    await telemetry(page).screenshot({
      path: path.join(
        SCREENSHOTS,
        "case-telemetry-mentions-failed-synthetic.png",
      ),
      animations: "disabled",
    });

    await error.getByRole("button", { name: "Try again" }).click();
    await waitForTelemetry(page);
    await expect(error).toHaveCount(0);
    await expect(records(page).first()).toBeVisible();
  });

  test("while the search runs, the records show first, one quiet line under them says it is searching, and its answer takes the line's place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE, { width: 1280, telemetry: "slow" });
    await waitForRecords(page);

    const searching: Locator = page.getByTestId("security-telemetry-loading");
    await expect(searching).toHaveText("Searching your logs and traces…");
    await expect(searching).toHaveAttribute("role", "status");
    // No heading, and no loader's blank band, while nothing is known.
    await expect(telemetry(page)).toHaveCount(0);
    await expect(connected(page).getByTestId("component-loader")).toHaveCount(
      0,
    );
    const lastRecord: Box = await records(page)
      .last()
      .evaluate((element: Element): Box => {
        const box: DOMRect = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      });
    const line: Box = await searching.evaluate((element: Element): Box => {
      const box: DOMRect = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    });
    // Under the records, one line high.
    expect(line.top).toBeGreaterThan(lastRecord.bottom);
    expect(line.bottom - line.top).toBeLessThan(28);
    await connected(page).screenshot({
      path: path.join(
        SCREENSHOTS,
        "case-telemetry-mentions-searching-synthetic.png",
      ),
      animations: "disabled",
    });

    await page.evaluate((): void => {
      (
        window as unknown as {
          __securityOperationsFixture: { releaseTelemetrySearch: () => void };
        }
      ).__securityOperationsFixture.releaseTelemetrySearch();
    });
    await waitForTelemetry(page);
    await expect(searching).toHaveCount(0);
    await expect(telemetryValues(page)).toHaveCount(2);
  });

  test("what the role keeps from it and what could not be searched are said - never that a value is not in them - and Try again searches", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE, { width: 1280, telemetry: "limited" });
    await waitForRecords(page);

    await expect(page.getByTestId("security-telemetry-unreadable")).toHaveText(
      "Your role cannot read Logs, so they were not searched.",
      {
        timeout: 30000,
      },
    );
    const failed: Locator = page.getByTestId("security-telemetry-failed");
    await expect(failed).toContainText(
      "Traces could not be searched just now.",
    );
    await expect(telemetryValues(page)).toHaveCount(0);
    await expect(page.getByTestId("security-telemetry-not-found")).toHaveCount(
      0,
    );

    await failed.getByRole("button", { name: "Try again" }).click();
    await waitForTelemetry(page);
    await expect(page.getByTestId("security-telemetry-unreadable")).toHaveCount(
      0,
    );
    // The records were not read again.
    expect(
      (await fixtureRequests(page)).filter((item: { url: string }) => {
        return new URL(item.url).pathname.endsWith(
          "/security-case/connections",
        );
      }),
    ).toHaveLength(1);
  });

  for (const view of [
    { width: 1280, theme: undefined },
    { width: 1024, theme: undefined },
    { width: 768, theme: "dark" as const },
    { width: 390, theme: undefined },
    { width: 390, theme: "dark" as const },
  ]) {
    test(`at ${view.width}${view.theme ? ", dark" : ""}: each row's label beside its places from 32rem of the section, above them below it, nothing past the card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, SPRAY_CASE, { width: view.width, theme: view.theme });
      await waitForTelemetry(page);

      const rows: Array<TelemetryRowLayout> = await telemetryRowLayouts(page);
      expect(rows.length).toBe(4);

      for (const row of rows) {
        if (row.sectionWidth >= FACTS_BESIDE_FROM) {
          // Beside: the label's column ends where the places start, on one line with them.
          expect(row.label.right, row.row).toBeLessThanOrEqual(
            row.items.left + 1,
          );
          expect(Math.abs(row.label.top - row.items.top), row.row).toBeLessThan(
            4,
          );
        } else {
          expect(row.label.bottom, row.row).toBeLessThanOrEqual(
            row.items.top + 1,
          );
        }
      }

      await expectNoSidewaysScroll(page, { tolerance: 1 });
      expect(await telemetryPartsOutside(page)).toEqual([]);
      await telemetry(page).screenshot({
        path: path.join(
          SCREENSHOTS,
          `case-telemetry-mentions-section-${view.width}${view.theme ? `-${view.theme}` : ""}-synthetic.png`,
        ),
        animations: "disabled",
      });
    });
  }

  test("in German: the section's own words, its counts as German writes them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE, { width: 1280, lang: "de" });
    await waitForTelemetry(page);

    await expect(telemetry(page).getByRole("heading", { level: 3 })).toHaveText(
      "In Ihren Protokollen und Traces",
    );
    const logs: Locator = telemetryValue(page, "203.0.113.47").getByTestId(
      "security-telemetry-logs",
    );
    await expect(logs.getByTestId("security-connected-fact-label")).toHaveText(
      "In 1.344 Protokollzeilen",
    );
    expect((await placeTexts(logs))[0]).toBe("In der Nachricht 1.260");
    expect(await sourceCounts(logs)).toEqual(["1.284 Zeilen", "20 Zeilen"]);
    await expect(telemetry(page)).toContainText(
      "Wo die Werte, die es nennt, in Ihren Protokollen und Traces vorkommen",
    );
    await expect(
      telemetry(page).getByTestId("security-telemetry-not-found"),
    ).toContainText("Nicht in Ihren Protokollen oder Traces");
    expect(await telemetryPartsOutside(page)).toEqual([]);
    await screenshot(page, "case-telemetry-mentions-de");
  });

  for (const width of [1280, 390]) {
    test(`in Persian at ${width}: right to left, each label on the section's right, nothing past the card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, SPRAY_CASE, { width, lang: "fa" });
      await waitForTelemetry(page);

      await expect(
        telemetry(page).getByRole("heading", { level: 3 }),
      ).toHaveText(
        "\u{062F}\u{0631} \u{0644}\u{0627}\u{06AF}\u{200C}\u{0647}\u{0627} \u{0648} \u{062A}\u{0631}\u{0650}\u{06CC}\u{0633}\u{200C}\u{0647}\u{0627}\u{06CC} \u{0634}\u{0645}\u{0627}",
      );

      const rows: Array<TelemetryRowLayout> = await telemetryRowLayouts(page);
      for (const row of rows) {
        if (row.sectionWidth >= FACTS_BESIDE_FROM) {
          // Right to left: the label's column on the right, the places to its left.
          expect(row.label.left, row.row).toBeGreaterThanOrEqual(
            row.items.right - 1,
          );
        } else {
          // Above them, its words starting on the right.
          expect(row.label.bottom, row.row).toBeLessThanOrEqual(
            row.items.top + 1,
          );
          expect(
            Math.abs(row.labelText.right - row.items.right),
            row.row,
          ).toBeLessThanOrEqual(2);
        }
      }

      /*
       * A value is written left to right, and its lines start at the
       * page's start all the same: Kai's email, which wraps on a phone,
       * keeps each of its lines on the right, as a record's long name does.
       */
      expect(await valueLinesOffTheStart(page)).toEqual([]);

      await expectNoSidewaysScroll(page, { tolerance: 1 });
      expect(await telemetryPartsOutside(page)).toEqual([]);
      await screenshot(page, `case-telemetry-mentions-fa-${width}`);
    });
  }

  test("an entity's page: its value searched over the hour around its last event", async ({
    page,
  }: {
    page: Page;
  }) => {
    const query: URLSearchParams = new URLSearchParams({
      value: "203.0.113.47",
      type: "IP Address",
    });
    await open(page, `${PRODUCT}/entity-risk/entity?${query.toString()}`, {
      width: 1280,
    });
    await waitForTelemetry(page);

    await expect(
      telemetryValue(page, "203.0.113.47")
        .getByTestId("security-telemetry-logs")
        .getByTestId("security-connected-fact-label"),
    ).toHaveText("In 1,344 log lines");

    const [read] = telemetryReads(await fixtureRequests(page));
    expect(read?.body).toMatchObject({
      entities: [{ type: "IP Address", value: "203.0.113.47" }],
    });
    // Only what the search reads: the records' own knobs stay with them.
    expect(Object.keys(read?.body || {}).sort()).toEqual(["entities", "time"]);
    await screenshot(page, "entity-telemetry-mentions-1280");
  });

  for (const view of [
    { width: 1280, theme: undefined },
    { width: 390, theme: "dark" as const },
  ]) {
    test(`at ${view.width}${view.theme ? ", dark" : ""}, no record: one entry of the list, its value under its sentence, the logs and traces close under it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const query: URLSearchParams = new URLSearchParams({
        value: "203.0.113.47",
        type: "IP Address",
      });
      await open(page, `${PRODUCT}/entity-risk/entity?${query.toString()}`, {
        width: view.width,
        theme: view.theme,
      });
      await waitForTelemetry(page);

      const empty: Locator = page.getByTestId("security-connected-empty");
      await expect(empty).toContainText("No record matches what it names.");
      await expect(empty).toContainText(
        "OneUptime looked for them among your hosts, clusters, devices, cloud resources, services, monitors and users, and found none.",
      );
      // What it looked for, under its sentence - not again under a heading.
      await expect(
        empty.getByTestId("security-connected-not-found"),
      ).toContainText("203.0.113.47");
      await expect(
        page.getByTestId("security-connected-not-found"),
      ).toHaveCount(1);
      await expect(connected(page)).not.toContainText("No matching record");
      // Not a page's large empty state.
      await expect(
        connected(page).getByTestId("table-empty-state"),
      ).toHaveCount(0);

      const boxOf: (locator: Locator) => Promise<Box> = async (
        locator: Locator,
      ): Promise<Box> => {
        return locator.evaluate((element: Element): Box => {
          const box: DOMRect = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          };
        });
      };
      const entry: Box = await boxOf(empty);
      const section: Box = await boxOf(telemetry(page));
      const firstValue: Box = await boxOf(telemetryValues(page).first());
      // An entry's height, and the found value's icon on the same left edge as its own.
      expect(entry.bottom - entry.top).toBeLessThan(
        view.width === 390 ? 220 : 140,
      );
      expect(section.top - entry.bottom).toBeLessThan(48);
      expect(Math.abs(entry.left - firstValue.left)).toBeLessThanOrEqual(1);

      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await connected(page).screenshot({
        path: path.join(
          SCREENSHOTS,
          `entity-no-record-${view.width}${view.theme ? `-${view.theme}` : ""}-synthetic.png`,
        ),
        animations: "disabled",
      });
    });
  }
});
