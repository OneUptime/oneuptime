import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A pool's OneUptime AI, in a real browser through the real router: the
 * XCP-ng AI agent's card at the end of the Overview, and AI > Insights,
 * Logs and AI agent in the pool's side menu. What the server answers is
 * made up (Fixture/AiAgent.js). Whether the server writes that is
 * ResourceAiAccessService's own tests (Common/Tests/Server/Services/
 * XcpNgPoolAiAccess.test.ts), and what the agent reads and changes in a
 * pool is agents/ResourceAIAgent's (XcpNgExecutor.test.ts). Nothing here
 * has met a live OneUptime stack, an agent or a Xen Orchestra.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const POOL_ID: string = "71000000-0000-4000-8000-000000000001";
const POOL_PATH: string = `/dashboard/${PROJECT_ID}/xcp-ng/${POOL_ID}`;
const AGENT_PAGE: string = `${POOL_PATH}/ai/agent`;
const POOL_UUID: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/xcp-ng-pages-ui",
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

const GERMAN: Record<string, string> = locale("de");
const PERSIAN: Record<string, string> = locale("fa");

interface Recorded {
  unhandled: Array<Record<string, unknown>>;
  apiRequests: Array<{ method: string; url: string }>;
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
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);

  if (!page.isClosed()) {
    // Every read the page made is one the fixture answers as the server does.
    expect((await recorded(page)).unhandled).toEqual([]);
  }
});

async function recorded(page: Page): Promise<Recorded> {
  return page.evaluate((): Recorded => {
    const fixture: Recorded | undefined = (
      window as unknown as { __xcpNgPagesFixture?: Recorded }
    ).__xcpNgPagesFixture;
    return fixture || { unhandled: [], apiRequests: [] };
  });
}

async function statusRequests(page: Page): Promise<number> {
  return (await recorded(page)).apiRequests.filter(
    (request: { url: string }): boolean => {
      return request.url.endsWith("/resource-ai-access/status");
    },
  ).length;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

function body(page: Page): Locator {
  return page.locator("body");
}

test.describe("the Overview's AI agent card", () => {
  test("no agent yet: the card says so, last on the page, and leads to the AI agent page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(POOL_PATH);

    const card: Locator = page.getByTestId("ai-agent-status-summary");

    await expect(card).toContainText("XCP-ng AI agent");
    await expect(card).toContainText(/not (installed|connected)/i);
    expect(await statusRequests(page)).toBeGreaterThan(0);
    await expect(
      card.locator(`a[href*="/xcp-ng/${POOL_ID}/ai/agent"]`).first(),
    ).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await screenshot(page, "ai-overview-card-none");
  });

  test("a connected agent reads as connected, with its version", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${POOL_PATH}?aiAgent=connected`);

    const card: Locator = page.getByTestId("ai-agent-status-summary");

    await expect(card).toContainText("14.1.0");
    await expect(card).toContainText("XCP-ng AI agent");
  });
});

test.describe("the side menu", () => {
  test("has an AI section, after Basic, reaching Insights, Logs and the AI agent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=connected`);

    const menu: Locator = page.getByRole("navigation");

    for (const [title, segment] of [
      ["Insights", "ai/insights"],
      ["Logs", "ai/logs"],
      ["AI agent", "ai/agent"],
    ] as const) {
      await expect(
        menu.locator(`a[href$="/xcp-ng/${POOL_ID}/${segment}"]`),
      ).toBeVisible();
      await expect(
        menu.locator(`a[href$="/xcp-ng/${POOL_ID}/${segment}"]`),
      ).toContainText(title);
    }
  });
});

test.describe("AI > AI agent", () => {
  test("not installed: the service under its profile, this pool's UUID, both tokens, and fixes off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(AGENT_PAGE);

    await expect(body(page)).toContainText("oneuptime-xcp-ng-ai-agent");
    await expect(body(page)).toContainText("xcp-ng-ai-agent");
    // Pinned to exactly this pool, by the UUID its telemetry carries.
    await expect(body(page)).toContainText(`XCP_NG_POOL_ID=${POOL_UUID}`);
    await expect(body(page)).toContainText("ONEUPTIME_AI_XO_READ_TOKEN");
    await expect(body(page)).toContainText("ONEUPTIME_AI_XO_WRITE_TOKEN");
    await expect(body(page)).toContainText(
      "copy of the built-in Read only role and nothing else",
    );
    await expect(page.getByTestId("ai-access-fixes")).toContainText(
      "AI never proposes or runs a fix.",
    );
    // Never the collector's OpenMetrics secret.
    await expect(body(page)).not.toContainText("XO_OPENMETRICS_SECRET");
    await screenshot(page, "ai-agent-not-installed");
  });

  test("connected: the pool master's XCP-ng version, and every fix mode with what always asks a person", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=connected`);

    await expect(body(page)).toContainText("XCP-ng 8.3.0");

    await page.getByTestId("ai-access-change-button").click();

    const dialog: Locator = page.getByRole("dialog");
    const modes: Locator = page.getByTestId("ai-remediation-mode-field");

    await expect(dialog).toBeVisible();
    await expect(modes).toBeVisible();

    for (const words of [
      "Off",
      "Ask for approval",
      "Automatic",
      "Bypass approval",
    ]) {
      await expect(modes).toContainText(words);
    }

    await expect(modes).toContainText(
      "migrating a VM, and restarting a host's toolstack",
    );
    await expect(modes).toContainText(
      "rebooting, shutting down or snapshotting a VM",
    );
    // Investigations are on, as a pool's row says from the start.
    await expect(dialog.getByRole("switch")).toBeChecked();
    await screenshot(page, "ai-agent-connected-change");
  });

  test("writes allowed with a token for changes that works: nothing stands in a fix's way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=writes`);

    await expect(page.getByTestId("ai-access-fixes")).toContainText(
      "A person approves each one before it runs.",
    );
    await expect(body(page)).not.toContainText(
      "token for changes does not work",
    );
    await screenshot(page, "ai-agent-writes");
  });

  test("a token for changes Xen Orchestra refuses is said now, not on the night of the fix", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=broken-token`);

    await expect(body(page)).toContainText(
      "The XCP-ng AI agent's token for changes does not work",
    );
    await expect(body(page)).toContainText(
      "did not accept ONEUPTIME_AI_XO_WRITE_TOKEN",
    );
    await screenshot(page, "ai-agent-broken-token");
  });

  test("Xen Orchestra's own certificate: why the agent cannot reach the pool, and what to check", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=unreachable`);

    await expect(body(page)).toContainText("the certificate names no address");
    await screenshot(page, "ai-agent-unreachable");
  });
});

test.describe("AI > Insights and AI > Logs", () => {
  test("each is the pool's own, and reads as nothing done yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [segment, name] of [
      ["ai/insights", "ai-insights"],
      ["ai/logs", "ai-logs"],
    ] as const) {
      await page.goto(`${POOL_PATH}/${segment}?aiAgent=connected`);
      // The pool's own page, under its pool.
      await expect(page.getByText("Production").first()).toBeVisible();
      await expect(body(page)).not.toContainText(
        /cannot read|Something went wrong|This page stopped working/,
      );
      await expectNoSidewaysScroll(page);
      await screenshot(page, name);
    }
  });
});

test.describe("on a phone, in the dark, and in other languages", () => {
  test("a phone: the AI agent page and the Overview's card fit, nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(AGENT_PAGE);
    await expect(body(page)).toContainText("oneuptime-xcp-ng-ai-agent");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ai-agent-phone");

    await page.goto(`${POOL_PATH}?aiAgent=connected`);
    await expect(page.getByTestId("ai-agent-status-summary")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("dark mode", async ({ page }: { page: Page }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=broken-token&theme=dark`);

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(body(page)).toContainText(
      "did not accept ONEUPTIME_AI_XO_WRITE_TOKEN",
    );
    await screenshot(page, "ai-agent-dark");
  });

  test("German: the agent's own words in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?lang=de`);

    const german: string | undefined = GERMAN["Investigate with xo-cli"];

    expect(german).toBeTruthy();
    expect(german).not.toBe("Investigate with xo-cli");
    await expect(body(page)).toContainText("oneuptime-xcp-ng-ai-agent");
    await screenshot(page, "ai-agent-de");
  });

  test("Persian: right to left, in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=connected&lang=fa`);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(PERSIAN["XCP-ng AI agent"]).toBeTruthy();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ai-agent-fa");
  });
});
