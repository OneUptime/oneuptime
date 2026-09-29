import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { createTelemetryIngestionKey } from "./Helpers/Telemetry";
import {
  createRumApplication,
  hexId,
  postSessionReplayChunk,
  readRumApplicationId,
  routeEvent,
} from "./Helpers/SessionReplay";

/*
 * User Flows, end to end against the full stack.
 *
 * Real recordings go in through the public chunk endpoint with a real
 * ingestion key - the same frames the browser recorder sends - and the
 * dashboard's User Flows page has to read them back out of ClickHouse as
 * journeys and draw them. This is the only place the whole path is
 * exercised: ingest writing each chunk's ordered route list, the
 * SessionReplayUserFlowReadService statements running on the real server,
 * the route's plan / permission / application checks, and the page.
 *
 * The page's own behaviour (every control, the tables, the findings) is
 * covered in the offline UI suite, packages/E2E/UserFlows; this spec keeps
 * to what only the real backend can prove.
 *
 * To run locally against a full stack:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/UserFlows.spec.ts --project=chromium
 */

const ORIGIN: string = "https://shop.flows.e2e.example.com";
const CHUNK_MS: number = 15000;

interface SeededJourney {
  sessionId: string;
  /* One entry per tab (a page load mints a new tab), each a list of chunks. */
  tabs: Array<Array<{ routes: Array<string>; errorCount?: number }>>;
}

const pageUrl: (path: string) => string = (path: string): string => {
  return `${ORIGIN}${path}`;
};

test.describe("User Flows", () => {
  test.beforeEach(() => {
    test.setTimeout(600000);
  });

  test("draws the journeys of real recordings and links back to them", async ({
    page,
  }: {
    page: Page;
  }) => {
    /* Every replay read route refuses a plan below Growth with 402. */
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E User Flows Project",
      ...(IS_BILLING_ENABLED ? { preferredPlanName: "Growth" } : {}),
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E Flows Key " + Faker.generateName().toString(),
    });

    const appIdentifier: string =
      "e2e-flows-" + Faker.generateName().toString().toLowerCase();

    await createRumApplication({
      page,
      projectId,
      name: appIdentifier,
      appIdentifier: appIdentifier,
    });

    const rumApplicationId: string = await readRumApplicationId({
      page,
      projectId,
      appIdentifier,
    });

    /*
     * Four sessions:
     *   buyer    / -> /products/41 -> /cart   | new page load: /checkout
     *   browser  / -> /products/77 -> /cart
     *   bouncer  /
     *   broken   / -> /products/41, which throws
     *
     * The buyer's checkout is a second TAB, because the browser recorder
     * mints a new tab id on every full page load: the journey only reads
     * right if chunks are ordered by time across tabs.
     */
    const journeys: Array<SeededJourney> = [
      {
        sessionId: hexId(),
        tabs: [
          [
            { routes: ["/", "/products/41"] },
            { routes: ["/products/41", "/cart"] },
          ],
          [{ routes: ["/checkout"] }],
        ],
      },
      {
        sessionId: hexId(),
        tabs: [[{ routes: ["/", "/products/77", "/cart"] }]],
      },
      { sessionId: hexId(), tabs: [[{ routes: ["/"] }]] },
      {
        sessionId: hexId(),
        tabs: [[{ routes: ["/", "/products/41"], errorCount: 1 }]],
      },
    ];

    const sessionStartUnixMs: number = Date.now() - 10 * 60 * 1000;

    for (const journey of journeys) {
      let offsetMs: number = 0;

      for (
        let tabPosition: number = 0;
        tabPosition < journey.tabs.length;
        tabPosition++
      ) {
        const tabId: string = hexId();
        const chunks: Array<{ routes: Array<string>; errorCount?: number }> =
          journey.tabs[tabPosition]!;

        for (
          let chunkIndex: number = 0;
          chunkIndex < chunks.length;
          chunkIndex++
        ) {
          const chunk: { routes: Array<string>; errorCount?: number } =
            chunks[chunkIndex]!;
          const urls: Array<string> = chunk.routes.map(pageUrl);
          const isLastChunkOfSession: boolean =
            tabPosition === journey.tabs.length - 1 &&
            chunkIndex === chunks.length - 1;

          await postSessionReplayChunk({
            page,
            ingestionKey,
            appIdentifier,
            sessionId: journey.sessionId,
            tabId: tabId,
            chunkIndex: chunkIndex,
            sessionStartUnixMs,
            chunkStartOffsetMs: offsetMs,
            chunkEndOffsetMs: offsetMs + CHUNK_MS,
            hasFullSnapshot: chunkIndex === 0,
            url: urls[urls.length - 1]!,
            routes: urls,
            entryUrl: pageUrl(journey.tabs[0]![0]!.routes[0]!),
            routeCount: Math.max(0, urls.length - 1),
            isFinal: isLastChunkOfSession,
            ...(chunk.errorCount ? { errorCount: chunk.errorCount } : {}),
            events:
              urls.length > 1
                ? [
                    routeEvent({
                      atOffsetMs: 5000,
                      from: urls[0]!,
                      to: urls[1]!,
                    }),
                  ]
                : [],
          });

          offsetMs += CHUNK_MS;
        }
      }
    }

    const flowsUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/rum/${rumApplicationId}/user-flows`)
      .toString();

    const node: (pageKey: string, step: number) => Locator = (
      pageKey: string,
      step: number,
    ): Locator => {
      return page.locator(
        `[data-testid="user-flow-node"][data-page="${pageKey}"][data-step="${step}"]`,
      );
    };

    /*
     * Ingest is asynchronous (a queue in front of ClickHouse), so the page
     * is reloaded until all four sessions are in the map.
     */
    await expect(async () => {
      await gotoProjectPage({
        page,
        projectId,
        url: flowsUrl,
        ready: page.getByTestId("user-flow-page"),
      });
      await expect(page.getByTestId("user-flow-map")).toBeVisible({
        timeout: 15000,
      });
      await expect(node("/", 0)).toHaveAttribute("data-sessions", "4", {
        timeout: 5000,
      });
    }).toPass({ timeout: 300000, intervals: [5000, 10000, 15000] });

    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "4",
    );
    /* 1 of 4 sessions never left the landing page. */
    await expect(page.getByTestId("user-flow-tile-bounce-value")).toHaveText(
      "25%",
    );

    /* Product ids are grouped, and the order survives chunks and tabs. */
    await expect(node("/products/:id", 1)).toHaveAttribute(
      "data-sessions",
      "3",
    );
    await expect(node("/cart", 2)).toHaveAttribute("data-sessions", "2");
    await expect(node("/checkout", 3)).toHaveAttribute("data-sessions", "1");
    await expect(
      page.locator(
        '[data-testid="user-flow-link"][data-from="/cart"][data-to="/checkout"]',
      ),
    ).toHaveAttribute("data-sessions", "1");

    /* The error was recorded on the product page. */
    await expect(
      node("/products/:id", 1).getByTestId("user-flow-node-errors"),
    ).toHaveCount(1);

    /* How did people reach /cart? Backward from it. */
    await node("/cart", 2).click();
    await page.getByTestId("user-flow-anchor-backward").click();
    await expect(page).toHaveURL(/page=%2Fcart/);
    await expect(node("/cart", 0)).toHaveAttribute("data-sessions", "2");
    await expect(node("/products/:id", 1)).toHaveAttribute(
      "data-sessions",
      "2",
    );

    /* A sample session opens the real player on that recording. */
    await node("/cart", 0).click();

    const sample: Locator = page
      .getByTestId("user-flow-sample-sessions")
      .locator("a")
      .first();

    await expect(sample).toBeVisible();
    await sample.click();
    await expect(page).toHaveURL(
      new RegExp(`/rum/${rumApplicationId}/session-replay/[0-9a-f]{32}`),
    );
    await expect(
      page
        .getByTestId("replay-player")
        .or(page.getByTestId("replay-loading"))
        .first(),
    ).toBeVisible({ timeout: 60000 });

    /* The page is in the side menu. */
    await page.goBack();
    await expect(
      page.getByRole("link", { name: "User Flows" }).first(),
    ).toBeVisible();
  });
});
