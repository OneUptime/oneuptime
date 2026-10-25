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
  connections?: "fail" | "partial";
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
    await expect.poll(() => new URL(page.url()).pathname).toBe(SPRAY_CASE);
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

    await expect(runner.getByTestId("security-connected-alerts")).toHaveText(
      "1 active alert: ALR-311 Outbound DNS to a threat feed domain (Acknowledged)",
    );
    await expect(
      runner.getByTestId("security-connected-incidents"),
    ).toHaveCount(0);
    await expect(runner.getByTestId("security-connected-monitors")).toHaveText(
      "Watched by 1 monitor: build-runner-07 heartbeat",
    );
    await expect(
      runner.getByTestId("security-connected-changes"),
    ).toContainText(
      "Changed in this window: Fixed: rotated the runner's registration token",
    );
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
    await expect(web.getByTestId("security-connected-incidents")).toHaveText(
      "2 active incidents: INC-1042 Checkout returns 502s (Investigating) +1 more",
    );
    expect(
      await hrefOf(
        web.getByRole("link", { name: "INC-1042 Checkout returns 502s" }),
      ),
    ).toBe(`${DASHBOARD}/incidents/2e000000-0000-4000-8000-000000000004`);
    await expect(web.getByTestId("security-connected-monitors")).toHaveText(
      "Watched by 3 monitors: web-03 ping · Checkout API +1 more",
    );
    expect(
      await hrefOf(web.getByTestId("security-connected-record-name")),
    ).toBe(`${DASHBOARD}/host/${WEB_03_ID}`);
    await expect(
      record(page, "web-03.staging.acme-commerce.example").getByTestId(
        "security-connected-possible",
      ),
    ).toBeVisible();
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
