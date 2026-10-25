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
 * Security on an incident's page: the security case that declared the
 * incident - the attack an outage may be the impact of - and the open cases
 * naming a host or a cluster it affects, each with which. Drawn only when
 * Security Events has something to say about the incident, and only for a
 * reader who may read security cases.
 *
 * On the Event Overview fixture's Incident #1042 (Fixture/Fixture.js,
 * ?security=), with the clock pinned and the network fenced; afterEach fails
 * a test on an uncaught page error, or on anything the fixture does not
 * model.
 */

const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const INCIDENT_PATH: string = `${DASHBOARD}/incidents/20000000-0000-4000-8000-000000001042`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-overview-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });

  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __eventOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__eventOverviewFixture;
      return JSON.parse(JSON.stringify(state?.unhandled || []));
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(
  page: Page,
  options: {
    width?: number;
    theme?: "dark";
    security?: "declared" | "naming" | "both";
    role?: "member";
  } = {},
): Promise<void> {
  const width: number = options.width || 1280;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const query: URLSearchParams = new URLSearchParams();
  if (options.theme) {
    query.set("theme", options.theme);
  }
  if (options.security) {
    query.set("security", options.security);
  }
  if (options.role) {
    query.set("role", options.role);
  }
  await page.goto(
    `${INCIDENT_PATH}${query.toString() ? `?${query.toString()}` : ""}`,
  );
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 30000,
  });
}

function card(page: Page): Locator {
  return page.getByTestId("incident-security-card");
}

async function securityReads(page: Page): Promise<number> {
  return page.evaluate((): number => {
    const state: { apiRequests?: Array<{ url: string }> } =
      (
        window as unknown as {
          __eventOverviewFixture?: { apiRequests?: Array<{ url: string }> };
        }
      ).__eventOverviewFixture || {};
    return (state.apiRequests || []).filter((request: { url: string }) => {
      return request.url.endsWith("/security-case/incident-security");
    }).length;
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

async function partsOutsideTheCard(page: Page): Promise<Array<string>> {
  return card(page).evaluate((root: Element): Array<string> => {
    const box: DOMRect = root.getBoundingClientRect();
    const outside: Array<string> = [];

    root.querySelectorAll("*").forEach((element: Element): void => {
      const part: DOMRect = element.getBoundingClientRect();

      if (part.width === 0 || part.height === 0) {
        return;
      }

      if (part.left < box.left - 1 || part.right > box.right + 1) {
        outside.push(
          `${element.tagName.toLowerCase()} "${(element.textContent || "").trim().slice(0, 40)}"`,
        );
      }
    });

    return outside;
  });
}

test.describe("an incident's Security card", () => {
  test("names the case that declared it, and the open cases naming what it affects", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { security: "both" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(card(page)).toContainText(
      "The security case behind this incident, and the open cases naming what it affects.",
    );

    const declared: Locator = card(page).getByTestId(
      "incident-security-declared",
    );
    await expect(declared).toContainText("Declared from");
    await expect(declared).toContainText(
      "SEC-12Credential stuffing against the checkout sign-in",
    );
    expect(
      await declared
        .getByRole("link", { name: /Credential stuffing/ })
        .getAttribute("href"),
    ).toBe(
      `${DASHBOARD}/security-events/cases/2f000000-0000-4000-8000-000000000012`,
    );

    const naming: Locator = card(page).getByTestId("incident-security-naming");
    await expect(naming).toContainText("Open cases naming what it affects");
    await expect(naming).toContainText(
      "Names checkout-api-2 and prod-eu-west-1",
    );
    await expect(naming).toContainText("Names checkout-api-2");
    await expect(naming).toContainText("1 more open case");
  });

  test("an incident only declared from a case, or only named by others, draws only what it has", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { security: "declared" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(
      card(page).getByTestId("incident-security-naming"),
    ).toHaveCount(0);

    await open(page, { security: "naming" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(
      card(page).getByTestId("incident-security-declared"),
    ).toHaveCount(0);
  });

  test("an incident Security Events has nothing to say about draws nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    // Read (again whenever the page refreshes its feed), and nothing drawn.
    await expect
      .poll(
        (): Promise<number> => {
          return securityReads(page);
        },
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    await expect(card(page)).toHaveCount(0);
  });

  test("a reader who may not read security cases is told nothing, and nothing is read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { security: "both", role: "member" });
    // The page has drawn what it reads on its own.
    await expect(page.getByTestId("what-happened")).toBeVisible({
      timeout: 30000,
    });
    expect(await securityReads(page)).toBe(0);
    await expect(card(page)).toHaveCount(0);
  });

  for (const [width, theme] of [
    [1280, undefined],
    [1280, "dark"],
    [390, undefined],
    [390, "dark"],
  ] as Array<[number, "dark" | undefined]>) {
    test(`at ${width}${theme ? `, ${theme}` : ""}, the card reads whole beside what it affects`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, {
        width,
        security: "both",
        ...(theme ? { theme } : {}),
      });
      await expect(card(page)).toBeVisible({ timeout: 30000 });
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await partsOutsideTheCard(page)).toEqual([]);

      await fs.mkdir(SCREENSHOTS, { recursive: true });
      await card(page).scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await card(page).screenshot({
        path: path.join(
          SCREENSHOTS,
          `incident-security-card-${width}${theme ? `-${theme}` : ""}-synthetic.png`,
        ),
        animations: "disabled",
      });
    });
  }
});
