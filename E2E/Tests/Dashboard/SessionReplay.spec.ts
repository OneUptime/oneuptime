import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIResponse,
  Locator,
  Page,
  Request,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import { createTelemetryIngestionKey } from "./Helpers/Telemetry";
import {
  SESSION_REPLAY_FIXTURE_TEXT,
  SessionReplayConfig,
  ShortSession,
  clickEvent,
  consoleEvent,
  createRumApplication,
  errorEvent,
  fetchSessionReplayConfig,
  hexId,
  networkEvent,
  openRumApplications,
  openSessionReplayList,
  openSessionReplayPlayer,
  postSessionReplayChunk,
  postShortSession,
  rageClickEvent,
  readListedSessionIds,
  readRumApplicationId,
  readSessionReplayViewCount,
  routeEvent,
  searchSessionReplayList,
  selectSessionReplaySort,
  traceId,
  updateRumApplication,
} from "./Helpers/SessionReplay";

/*
 * Session Replay, end to end.
 *
 * Everything below the recorder bundle, exercised the way a customer's
 * browser exercises it: a real ingestion key, real chunk frames posted to
 * /telemetry/session-replay/v1/chunk, and then the real dashboard reading
 * them back - the roster's Connected pill, the health strip, the list with
 * its search grammar and sort, the player, the rail and the audit log.
 *
 * This is the only coverage of several hops that unit tests cannot reach,
 * and each of them has been broken in a way nothing else caught:
 *
 *   - Creating a RUM application from the dashboard was impossible. The
 *     required appIdentifier column had an empty create ACL, so ModelForm
 *     stripped the field and the server then rejected the POST for the very
 *     value it had just removed. Compiles fine, unit tests all green.
 *   - The session header's exitUrl and routes[] were frozen at chunk 0, so a
 *     single-page app reported its landing page as its exit page forever and
 *     the route filter could not match a page the user demonstrably reached.
 *   - The end-user reference was accepted on the wire and then written as
 *     "", so every session read "Anonymous" while the settings page said
 *     identity capture was on.
 *   - The player rendered its chrome and then never played (#3601), and the
 *     spec of the day asserted only that the chrome was there.
 *   - A replay-only install read "Disconnected" on the roster (#3527)
 *     because liveness was refreshed from the OTel path alone.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/SessionReplay.spec.ts --project=chromium
 */

/* The fixture journey's clock, in ms from the session's start. */
const CHUNK_MS: number = 15000;
const ERROR_OFFSET_MS: number = CHUNK_MS + 5000;
const JOURNEY_DURATION_MS: number = 6 * CHUNK_MS;

/* Chunk 2 is never delivered: footage stops at 30s and resumes at 45s. */
const GAP_START_OFFSET_MS: number = 2 * CHUNK_MS;

/*
 * Where the idle stretch starts: the last mouse move of chunk 3 sits 13s
 * into it (moves every 2.5s from +0.5s), chunk 4 is silent, and chunk 5's
 * first move is 0.5s in. So the player's idle map reads 58s -> 75.5s and a
 * skip lands on 1:15.
 */
const IDLE_START_OFFSET_MS: number = 3 * CHUNK_MS + 13000;

test.describe("Session Replay", () => {
  /*
   * Register + project + billing + ingest key + a RUM application, then an
   * ingest->query poll, then the player's own 30s live poll. Ten minutes is
   * the headroom the whole journey needs; the delivery test uses a fraction.
   */
  test.beforeEach(() => {
    test.setTimeout(600000);
  });

  test("records a session end to end and plays it back from the dashboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Growth when billing is on: every replay READ route refuses a lower
     * plan with 402, while ingest has no plan gate at all - so on a Free
     * project the chunks below would be accepted and stored and then be
     * unreadable, which would fail this spec for a reason that has nothing
     * to do with what it is testing.
     */
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Session Replay Project",
      ...(IS_BILLING_ENABLED ? { preferredPlanName: "Growth" } : {}),
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E Replay Key " + Faker.generateName().toString(),
    });

    const appIdentifier: string =
      "e2e-replay-" + Faker.generateName().toString().toLowerCase();

    /* Hop 1: the create form must actually be usable. */
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

    const sessionId: string = hexId();
    const tabId: string = hexId();

    /*
     * The session began 90s of footage plus a minute of slack ago, so every
     * event timestamp - all derived from this one instant - is in the past
     * when it arrives. A start the server had to clamp would silently move
     * every ?at= link this spec later follows.
     */
    const sessionStartUnixMs: number = Date.now() - JOURNEY_DURATION_MS - 60000;
    const userRef: string = `e2e-user-${Faker.generateName().toString().toLowerCase()}@example.com`;
    const buildTag: string = `e2e-${hexId().slice(0, 8)}`;
    const cartTraceId: string = traceId();
    const checkoutTraceId: string = traceId();

    const origin: string = "https://shop.e2e.example.com";
    const home: string = `${origin}/`;
    const cart: string = `${origin}/cart`;
    const checkout: string = `${origin}/checkout`;

    /*
     * One journey in six 15-second slots, with slot 2 deliberately never
     * delivered and slot 4 deliberately silent:
     *
     *   0  land on /, add to cart, navigate to /cart        (identity, tags)
     *   1  /cart throws, the checkout call fails            (the error)
     *   2  MISSING - the recorder never delivered it        (the gap)
     *   3  /checkout, a fresh snapshot                      (anchor after the hole)
     *   4  the user reads the page and touches nothing      (the idle stretch)
     *   5  a rage click, the final chunk                    (identity again)
     *
     * The URLs differ per chunk on purpose - that is what makes exitUrl and
     * routes[] falsifiable - and every custom event lands at a known offset
     * so the rail and the timeline can be checked against it.
     */
    await postSessionReplayChunk({
      page,
      ingestionKey,
      appIdentifier,
      sessionId,
      tabId,
      chunkIndex: 0,
      sessionStartUnixMs,
      url: home,
      routes: [home, cart],
      entryUrl: home,
      routeCount: 1,
      identifiedUserRef: userRef,
      identifiedUserTraits: { plan: "pro", company: "E2E Ltd" },
      tags: { build: buildTag, team: "checkout" },
      traceIds: [cartTraceId],
      events: [
        clickEvent({
          atOffsetMs: 1000,
          selector: "button#add-to-cart",
          text: "Add to cart",
        }),
        consoleEvent({
          atOffsetMs: 3000,
          level: "warn",
          message: "cart total recomputed twice",
        }),
        networkEvent({
          atOffsetMs: 5000,
          method: "GET",
          url: `${origin}/api/cart`,
          status: 200,
          durationMs: 120,
          traceId: cartTraceId,
        }),
        routeEvent({ atOffsetMs: 8000, from: home, to: cart }),
        clickEvent({
          atOffsetMs: 12000,
          selector: "a.checkout",
          text: "Checkout",
        }),
      ],
    });

    await postSessionReplayChunk({
      page,
      ingestionKey,
      appIdentifier,
      sessionId,
      tabId,
      chunkIndex: 1,
      sessionStartUnixMs,
      url: cart,
      routes: [cart],
      errorCount: 1,
      traceIds: [checkoutTraceId],
      events: [
        consoleEvent({
          atOffsetMs: 2000,
          level: "error",
          message: "Uncaught TypeError: cart is undefined",
        }),
        errorEvent({
          atOffsetMs: ERROR_OFFSET_MS - CHUNK_MS,
          message: "TypeError: cart is undefined",
        }),
        networkEvent({
          atOffsetMs: 9000,
          method: "POST",
          url: `${origin}/api/checkout`,
          status: 500,
          durationMs: 480,
          traceId: checkoutTraceId,
        }),
        clickEvent({
          atOffsetMs: 11000,
          selector: "button#retry",
          text: "Try again",
        }),
      ],
    });

    /* Chunk 2 is never posted: the gap. */

    await postSessionReplayChunk({
      page,
      ingestionKey,
      appIdentifier,
      sessionId,
      tabId,
      chunkIndex: 3,
      sessionStartUnixMs,
      url: checkout,
      routes: [checkout],
      routeCount: 1,
      hasFullSnapshot: true,
      events: [
        routeEvent({ atOffsetMs: 1000, from: cart, to: checkout }),
        clickEvent({
          atOffsetMs: 4000,
          selector: "button#pay-now",
          text: "Pay now",
        }),
      ],
    });

    await postSessionReplayChunk({
      page,
      ingestionKey,
      appIdentifier,
      sessionId,
      tabId,
      chunkIndex: 4,
      sessionStartUnixMs,
      url: checkout,
      activityEveryMs: null,
    });

    await postSessionReplayChunk({
      page,
      ingestionKey,
      appIdentifier,
      sessionId,
      tabId,
      chunkIndex: 5,
      sessionStartUnixMs,
      url: checkout,
      routes: [checkout],
      entryUrl: home,
      isFinal: true,
      rageClickCount: 1,
      identifiedUserRef: userRef,
      identifiedUserTraits: { plan: "pro", company: "E2E Ltd" },
      tags: { build: buildTag, team: "checkout" },
      events: [
        clickEvent({
          atOffsetMs: 1500,
          selector: "button#pay-now",
          text: "Pay now",
        }),
        rageClickEvent({ atOffsetMs: 6000, clickCount: 5 }),
        consoleEvent({
          atOffsetMs: 9000,
          level: "warn",
          message: "payment form submitted 5 times",
        }),
      ],
    });

    /*
     * Hop 2: replay traffic keeps the application alive (#3527).
     *
     * Liveness used to be refreshed from the OTel path only, so a site
     * instrumented with the replay snippet alone read "Disconnected" on the
     * roster while its recorders were posting to this very server. The
     * stamp is fire-and-forget and throttled, hence the poll.
     */
    await pollUntil({
      page,
      what: `application ${appIdentifier} reading Connected`,
      timeoutMs: 120000,
      run: async (): Promise<boolean> => {
        await openRumApplications({ page, projectId });

        const row: Locator = page
          .getByRole("row")
          .filter({ hasText: appIdentifier });

        return row.getByText("Connected", { exact: true }).first().isVisible();
      },
    });

    /* Hop 3: the session reaches the list. */
    const listRow: Locator = page.locator(
      `[data-testid="session-row"][data-session-id="${sessionId}"]`,
    );

    await pollUntil({
      page,
      what: `session ${sessionId.slice(0, 12)} in the list`,
      run: async (): Promise<boolean> => {
        await openSessionReplayList({ page, projectId, rumApplicationId });
        await page.waitForTimeout(4000);

        return listRow.isVisible();
      },
    });

    /*
     * Hop 4: the end user is named.
     *
     * The recorder sends the reference, the parser accepts it, and the ingest
     * used to throw it away - so this cell read "Anonymous" for every session
     * ever recorded, the "User" filter could never match, and a
     * right-to-erasure request naming that person resolved zero sessions.
     */
    await expect(
      listRow.getByTestId("session-row-user"),
      "The end-user reference the page supplied must be stored and rendered",
    ).toHaveText(userRef, { timeout: 30000 });

    /*
     * Not finalized yet (the finalizer waits for ten idle minutes), so the
     * row is honest about it: Recording now, a live dot, and Watch offered
     * because footage exists.
     */
    await expect(
      listRow.getByTestId("session-row-playability"),
    ).toHaveAttribute("data-kind", "recording");
    await expect(listRow.getByTestId("session-row-live")).toBeVisible();

    /*
     * The provisional header carries the routes of its NEWEST meta-bearing
     * chunk (the final one, on /checkout); the union across every chunk is
     * the finalizer's, and is pinned at the unit level.
     */
    await expect(listRow.getByTestId("session-row-routes")).toContainText(
      "/checkout",
    );
    await expect(listRow.getByTestId("session-row-watch")).toBeVisible();

    /*
     * Hop 5: the health strip agrees with the ingest.
     *
     * Its word is the diagnosis state. "healthy" needs the last-chunk stamp,
     * which the ingest writes only after the chunk is durably flushed, so
     * the strip can lag the list by a poll.
     */
    await pollUntil({
      page,
      what: "health strip reading healthy",
      timeoutMs: 120000,
      run: async (): Promise<boolean> => {
        await openSessionReplayList({ page, projectId, rumApplicationId });

        const level: Locator = page.getByTestId("health-strip-level");

        await level.waitFor({ state: "attached", timeout: 30000 });

        return (await level.textContent())?.trim() === "healthy";
      },
    });

    await expect(page.getByTestId("health-strip")).toContainText(
      "Recording healthy",
    );

    /*
     * Hop 6: Watch opens the player and the player PLAYS (#3601).
     *
     * "Play did nothing" passed the previous spec, which checked only that
     * the transport buttons existed. Now: the engine's phase word must reach
     * "playing", the clock must move, and the reconstructed page must show
     * the fixture's own text inside the stage iframe.
     */
    await listRow.getByTestId("session-row-watch").click();

    await expect(page.getByTestId("replay-header")).toBeVisible({
      timeout: 60000,
    });

    await expect(page.getByTestId("replay-header-user")).toHaveText(userRef);
    await expect(page.getByTestId("replay-header-traits")).toHaveText(
      "2 traits",
    );

    /* One browser tab: the header shows no tab pills at all, not one. */
    await expect(page.getByTestId("replay-tab-pill")).toHaveCount(0);

    /* Provisional session: the header says so and the shell polls. */
    await expect(page.getByTestId("replay-live-pill")).toBeVisible();
    await expect(page.getByTestId("replay-player")).toHaveAttribute(
      "data-replay-live",
      "true",
    );

    await expect(page.getByTestId("replay-stage")).toBeVisible({
      timeout: 60000,
    });

    const phase: Locator = page.getByTestId("replay-phase");
    const clock: Locator = page.getByTestId("replay-time");

    await expect(phase).toHaveText("playing", { timeout: 60000 });

    /* Duration comes from the chunk bounds: six slots, 1:30. */
    await expect(clock).toHaveText(/\/ 1:30$/);

    const clockBefore: string = (await clock.textContent()) ?? "";

    await expect(clock, "The clock must advance while playing").not.toHaveText(
      clockBefore,
      { timeout: 15000 },
    );

    await expect(
      page
        .frameLocator('[data-testid="replay-stage"] iframe')
        .getByText(SESSION_REPLAY_FIXTURE_TEXT)
        .first(),
      "The stage iframe must show the recorded page",
    ).toBeVisible({ timeout: 30000 });

    /* Pause and resume are engine events; the phase word reflects each. */
    await page.getByTestId("replay-play-pause").click();
    await expect(phase).toHaveText("paused", { timeout: 10000 });
    await page.getByTestId("replay-play-pause").click();
    await expect(phase).toHaveText("playing", { timeout: 10000 });

    /*
     * Hop 7: the session says where it began.
     *
     * meta.entryUrl used to be read from location.href when the envelope was
     * built, and meta rides the FINAL chunk as well as chunk 0 - so the last
     * chunk overwrote the header with the exit url and every session that
     * navigated was filed as beginning wherever its user stopped. Here the
     * final chunk carries the same entryUrl as chunk 0, and the panel has to
     * agree.
     *
     * EXACT: `checkout` has `home` as a prefix, so a substring match would
     * hold even when the Entry URL row shows the checkout page - which is
     * precisely the regression this assertion exists to catch.
     */
    await page.getByTestId("replay-open-details").click();

    await expect(
      page.getByTestId("details-tab-session").getByText(home, { exact: true }),
    ).toBeVisible({ timeout: 30000 });

    /* The panel overlays the rail; close it before driving the rail. */
    await page.getByTestId("side-over").getByTestId("close-button").click();
    await page
      .getByTestId("side-over")
      .waitFor({ state: "hidden", timeout: 10000 });

    /*
     * Hop 8: the rail follows the playhead.
     *
     * Exactly one row is "now"; as the footage plays that row moves on to
     * a later signal. Forty-five seconds covers the longest silence in the
     * fixture (the 26s click to the 46s route, across the gap).
     */
    await expect(page.getByTestId("rail-row").first()).toBeVisible({
      timeout: 30000,
    });

    const activeRow: Locator = page.locator(
      '[data-testid="rail-row"]:has([data-testid="rail-row-active"])',
    );

    await expect(activeRow).toHaveCount(1, { timeout: 30000 });

    const firstActiveSignalId: string =
      (await activeRow.getAttribute("data-signal-id")) ?? "";

    expect(firstActiveSignalId).not.toBe("");

    await expect(
      activeRow,
      "The active rail row must move on as playback advances",
    ).not.toHaveAttribute("data-signal-id", firstActiveSignalId, {
      timeout: 45000,
    });

    /*
     * Hop 9: a rail row click seeks.
     *
     * The Errors tab holds the client error from chunk 1 (offset 20s). A
     * click seeks one second before it, so the clock lands on 0:19 and
     * the row is the selected one.
     */
    await page.getByTestId("rail-tab-errors").click();
    await expect(page.getByTestId("rail-tab-errors")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const errorRow: Locator = page.getByTestId("rail-row").first();

    await expect(errorRow).toContainText("TypeError: cart is undefined", {
      timeout: 30000,
    });

    const errorSignalId: string =
      (await errorRow.getAttribute("data-signal-id")) ?? "";

    expect(errorSignalId).toMatch(/^rec:1:\d+$/);

    await errorRow.locator("[title^='Seek to']").first().click();

    await expect(errorRow).toHaveAttribute("aria-selected", "true");
    await expect(
      clock,
      "A rail row click must seek to 1s before it",
    ).toHaveText(/^0:(19|2[0-3])/, { timeout: 15000 });

    /*
     * Hop 10: the timeline draws what the manifest and the idle map know.
     *
     * The hole between chunks 1 and 3 is a gap band labelled by its size;
     * the silent chunk 4 becomes an idle band before it is even decoded
     * (too few events to be active); the custom events are markers.
     */
    await expect(page.getByTestId("timeline-track")).toBeVisible();
    await expect(page.getByTestId("timeline-gap-band")).toHaveCount(1);
    await expect(page.getByTestId("timeline-gap-band")).toHaveAttribute(
      "aria-label",
      /15s missing/,
    );
    await expect(page.getByTestId("timeline-idle-band").first()).toBeVisible();
    await expect(page.getByTestId("timeline-marker").first()).toBeVisible();

    /*
     * Hop 11: ?t= lands on the moment and the gap is explained, not
     * silently skipped.
     *
     * Landing at 0:27 plays the last three seconds of chunk 1 and then hits
     * the hole; the engine jumps to chunk 3 and says so for two seconds.
     * ?t= is in whole seconds.
     */
    await openSessionReplayPlayer({
      page,
      projectId,
      rumApplicationId,
      sessionId,
      query: `t=${GAP_START_OFFSET_MS / 1000 - 3}`,
    });

    await expect(page.getByTestId("replay-overlay-gap")).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByTestId("replay-overlay-gap")).toContainText(
      "Skipped 15s",
    );
    await expect(clock).toHaveText(/^0:(4[5-9]|5\d)/, { timeout: 15000 });

    /*
     * Hop 12: skip idle jumps the silent stretch and announces it.
     *
     * The preference is off by default and persists per browser, so it is
     * switched on here and expected to still be on after the next
     * navigation. Landing two seconds before the idle band starts, the
     * playhead enters it while playing and the engine skips to its end.
     */
    const skipIdle: Locator = page.getByTestId("replay-skip-idle");

    await expect(skipIdle).toHaveAttribute("aria-checked", "false");
    await skipIdle.click();
    await expect(skipIdle).toHaveAttribute("aria-checked", "true");

    await openSessionReplayPlayer({
      page,
      projectId,
      rumApplicationId,
      sessionId,
      query: `t=${Math.floor(IDLE_START_OFFSET_MS / 1000) - 2}`,
    });

    await expect(skipIdle).toHaveAttribute("aria-checked", "true", {
      timeout: 60000,
    });
    await expect(page.getByTestId("replay-overlay-idle-skip")).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByTestId("replay-overlay-idle-skip")).toContainText(
      "idle",
    );
    /* The band ends at 75.5s: the clock lands on 1:15 or later. */
    await expect(clock).toHaveText(/^1:(1[5-9]|[2-9]\d)/, { timeout: 15000 });

    /*
     * Hop 13: an inbound link lands on the absolute moment and the row.
     *
     * Logs, spans and exceptions link with ?at=<unix ms> because they know
     * the wall clock, not the session's start; the player converts with the
     * header's start. With an explicit moment the ?signal= row is only
     * selected (no pre-roll seek), on its home tab.
     */
    const atUnixMs: number = sessionStartUnixMs + 50000;

    await openSessionReplayPlayer({
      page,
      projectId,
      rumApplicationId,
      sessionId,
      query: `at=${atUnixMs}&rail=errors&signal=${encodeURIComponent(errorSignalId)}`,
    });

    await expect(clock, "?at= must land on the moment").toHaveText(
      /^0:5[0-7]/,
      { timeout: 60000 },
    );
    await expect(page.getByTestId("rail-tab-errors")).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 30000 },
    );
    await expect(
      page.locator(
        `[data-testid="rail-row"][data-signal-id="${errorSignalId}"]`,
      ),
    ).toHaveAttribute("aria-selected", "true", { timeout: 30000 });

    /*
     * Hop 14: one audit row per view, even while the player polls.
     *
     * A live session re-fetches its manifest every 30s with isRefresh and
     * the view id it was given, and the server must reuse the audit row
     * rather than logging a "view" per poll. The count is read before and
     * after one complete poll cycle.
     */
    const viewsBefore: number = await readSessionReplayViewCount({
      page,
      projectId,
      rumApplicationId,
      sessionId,
    });

    const refreshRequest: Promise<Request> = page.waitForRequest(
      (request: Request): boolean => {
        if (
          !request.url().includes("/telemetry/rum/session-replay/manifest") ||
          request.method() !== "POST"
        ) {
          return false;
        }

        try {
          const body: { isRefresh?: boolean } | null =
            request.postDataJSON() as { isRefresh?: boolean } | null;

          return body?.isRefresh === true;
        } catch {
          return false;
        }
      },
      { timeout: 120000 },
    );

    await openSessionReplayPlayer({
      page,
      projectId,
      rumApplicationId,
      sessionId,
    });

    await expect(page.getByTestId("replay-player")).toHaveAttribute(
      "data-replay-live",
      "true",
      { timeout: 60000 },
    );

    await refreshRequest;

    /* Let the refresh response land before counting. */
    await page.waitForTimeout(3000);

    const viewsAfter: number = await readSessionReplayViewCount({
      page,
      projectId,
      rumApplicationId,
      sessionId,
    });

    expect(
      viewsAfter - viewsBefore,
      "Opening the player once must write exactly one audit row, live polling included",
    ).toBe(1);

    /*
     * Hop 15: wide mode hides the application menu.
     *
     * Wide is the default, so the menu is gone on arrival; toggling it
     * brings the menu (and its Recommendations link) back.
     */
    const wideToggle: Locator = page.getByTestId("replay-toggle-wide");
    const menuLink: Locator = page.getByRole("link", {
      name: "Recommendations",
    });

    await expect(wideToggle).toHaveAttribute("aria-pressed", "true");
    await expect(menuLink).toHaveCount(0);

    await wideToggle.click();

    await expect(wideToggle).toHaveAttribute("aria-pressed", "false");
    await expect(menuLink).toBeVisible({ timeout: 10000 });

    await wideToggle.click();
    await expect(menuLink).toHaveCount(0);

    /*
     * The FINALIZED exitUrl and routes[] are deliberately not asserted here.
     * Finalization is a 5-minute cron behind a 10-minute idle cutoff, so
     * proving it end to end means idling this spec for a quarter of an hour -
     * a cost the whole suite would pay, and the kind of long sleep that makes
     * a suite flaky rather than thorough.
     *
     * That derivation is covered exhaustively at the unit level instead, in
     * App/Tests/Workers/SessionReplayFinalizer.test.ts: exit url from the last
     * chunk rather than chunk 0, every page in routes[], routes.length tied to
     * pageCount, routes visited and left inside one chunk, two page loads, two
     * concurrent tabs, a session straddling the url migration, and a session
     * with no header at all.
     */
  });

  /*
   * The list: the search grammar, sort, and the explained empty state of an
   * application whose recorder loads but never uploads.
   *
   * Two sessions that differ in every searchable way - identity, tags, URL,
   * length and start - so each token can be shown to keep exactly the row it
   * should. A second application with sampling at 0% has fetched its policy
   * and posted nothing: the honest answer is neither "no sessions" nor
   * "install the snippet", and the list has to say which.
   */
  test("finds sessions by user, URL, tag and id, sorts by length, and explains a not-sampled application", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Replay List Project",
      ...(IS_BILLING_ENABLED ? { preferredPlanName: "Growth" } : {}),
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E Replay List Key " + Faker.generateName().toString(),
    });

    const appIdentifier: string =
      "e2e-list-" + Faker.generateName().toString().toLowerCase();

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

    const origin: string = "https://shop.e2e.example.com";
    const userRef: string = `e2e-user-${Faker.generateName().toString().toLowerCase()}@example.com`;
    const buildTag: string = `e2e-${hexId().slice(0, 8)}`;
    const now: number = Date.now();

    /* Older and longer: identified, tagged, on /cart. */
    const longSession: ShortSession = await postShortSession({
      page,
      ingestionKey,
      appIdentifier,
      sessionStartUnixMs: now - 180000,
      chunkCount: 3,
      url: `${origin}/cart`,
      identifiedUserRef: userRef,
      tags: { build: buildTag },
    });

    /* Newer and shorter: anonymous, untagged, on /pricing. */
    const shortSession: ShortSession = await postShortSession({
      page,
      ingestionKey,
      appIdentifier,
      sessionStartUnixMs: now - 60000,
      chunkCount: 1,
      url: `${origin}/pricing`,
    });

    await pollUntil({
      page,
      what: "both sessions in the list",
      run: async (): Promise<boolean> => {
        await openSessionReplayList({ page, projectId, rumApplicationId });
        await page.waitForTimeout(4000);

        const ids: Array<string> = await readListedSessionIds(page);

        return (
          ids.includes(longSession.sessionId) &&
          ids.includes(shortSession.sessionId)
        );
      },
    });

    /*
     * Each token must keep exactly the row it names. The list re-queries
     * on Enter; expect.poll re-reads the rows until the answer settles.
     */
    const listedIds: () => Promise<Array<string>> = (): Promise<
      Array<string>
    > => {
      return readListedSessionIds(page);
    };

    await searchSessionReplayList({ page, query: `user:${userRef}` });
    await expect
      .poll(listedIds, {
        message: "user: must match the identified session only",
        timeout: 30000,
      })
      .toEqual([longSession.sessionId]);

    await searchSessionReplayList({ page, query: `url:${origin}/cart` });
    await expect
      .poll(listedIds, {
        message: "url: must match the session that visited the prefix",
        timeout: 30000,
      })
      .toEqual([longSession.sessionId]);

    await searchSessionReplayList({ page, query: `tag:build=${buildTag}` });
    await expect
      .poll(listedIds, {
        message: "tag:key=value must match the tagged session only",
        timeout: 30000,
      })
      .toEqual([longSession.sessionId]);

    /* Bare text is a free-text search; a session id prefix finds its row. */
    await searchSessionReplayList({
      page,
      query: shortSession.sessionId.slice(0, 12),
    });
    await expect
      .poll(listedIds, {
        message: "bare text must match the session id prefix",
        timeout: 30000,
      })
      .toEqual([shortSession.sessionId]);

    await searchSessionReplayList({ page, query: "" });
    await expect
      .poll(listedIds, {
        message: "clearing the search must bring both rows back",
        timeout: 30000,
      })
      .toHaveLength(2);

    /*
     * Sort is server-side: Longest puts the 45s session first, Newest the
     * one that started a minute ago.
     */
    await selectSessionReplaySort({ page, label: "Longest" });
    await expect
      .poll(
        async (): Promise<string | undefined> => {
          return (await readListedSessionIds(page))[0];
        },
        { message: "Longest must lead with the 45s session", timeout: 30000 },
      )
      .toBe(longSession.sessionId);

    await selectSessionReplaySort({ page, label: "Newest" });
    await expect
      .poll(
        async (): Promise<string | undefined> => {
          return (await readListedSessionIds(page))[0];
        },
        { message: "Newest must lead with the later session", timeout: 30000 },
      )
      .toBe(shortSession.sessionId);

    /*
     * A second application: sampling 0%, the policy fetched once, nothing
     * ever posted. Fetching the policy is the one request a page makes
     * under such a policy, and the ingest stamps liveness from it - so the
     * list can tell "loaded but never uploaded" apart from "never loaded".
     */
    const quietIdentifier: string =
      "e2e-quiet-" + Faker.generateName().toString().toLowerCase();

    await createRumApplication({
      page,
      projectId,
      name: quietIdentifier,
      appIdentifier: quietIdentifier,
    });

    const quietApplicationId: string = await readRumApplicationId({
      page,
      projectId,
      appIdentifier: quietIdentifier,
    });

    await updateRumApplication({
      page,
      projectId,
      rumApplicationId: quietApplicationId,
      data: { sessionReplaySamplePercentage: 0 },
    });

    const config: SessionReplayConfig = await fetchSessionReplayConfig({
      page,
      ingestionKey,
      appIdentifier: quietIdentifier,
    });

    expect(
      config.samplePercentage,
      "The policy the recorder fetches must reflect the edit",
    ).toBe(0);

    await pollUntil({
      page,
      what: "the not-sampled application's empty state",
      timeoutMs: 120000,
      run: async (): Promise<boolean> => {
        await openSessionReplayList({
          page,
          projectId,
          rumApplicationId: quietApplicationId,
        });

        const variant: Locator = page.getByTestId("list-empty-variant");

        await variant.waitFor({ state: "attached", timeout: 30000 });

        return (
          (await variant.textContent())?.trim() === "installed-not-uploading"
        );
      },
    });

    await expect(page.getByTestId("health-strip-level")).toHaveText(
      "loaded-never-uploaded",
    );
    await expect(page.getByTestId("list-empty-detail")).toContainText(
      "sample percentage is 0%",
    );
  });

  /*
   * The delivery path, which is invisible until it is broken.
   *
   * Every install failure here is silent in the customer's browser by
   * design: a 404 on the artifact, a config that says "disabled", or a
   * version the loader refuses to build a URL from all produce a page that
   * simply never records, with nothing logged anywhere the server can see.
   * The recorder bundle is also built once by dev.sh with no watcher, so a
   * checkout that never ran the build serves 404 for the script and reports
   * the whole feature as disabled - which looks exactly like a policy
   * decision.
   */
  test("serves the recorder, the pinned artifact and a usable policy", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Replay Delivery Project",
      ...(IS_BILLING_ENABLED ? { preferredPlanName: "Growth" } : {}),
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E Replay Delivery Key " + Faker.generateName().toString(),
    });

    const appIdentifier: string =
      "e2e-delivery-" + Faker.generateName().toString().toLowerCase();

    await createRumApplication({
      page,
      projectId,
      name: appIdentifier,
      appIdentifier: appIdentifier,
    });

    const base: string = BASE_URL.toString();

    /* The loader stub: fixed path, short cache, so a rollback can reach it. */
    const loader: APIResponse = await page.request.get(
      URL.fromString(base)
        .addRoute("/telemetry/session-replay/v1/recorder.js")
        .toString(),
    );

    expect(loader.status(), await loader.text()).toBe(200);
    expect(loader.headers()["content-type"]).toContain("javascript");
    expect(loader.headers()["cache-control"]).toContain("max-age=300");

    /* The policy the loader fetches before it will load anything. */
    const config: SessionReplayConfig = await fetchSessionReplayConfig({
      page,
      ingestionKey,
      appIdentifier,
    });

    expect(
      config.enabled,
      "A freshly created application must be recordable without configuring anything",
    ).toBe(true);
    expect(config.directive).toBe("continue");

    /*
     * The version is interpolated straight into a script URL, so the loader
     * refuses anything that is not a semver the build could have stamped.
     */
    expect(config.recorderVersion).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+/);

    /* Without SRI the immutable pinned artifact is unverifiable. */
    expect(config.recorderIntegrity).toMatch(/^sha384-/);

    /* The pinned artifact the loader would inject. */
    const artifact: APIResponse = await page.request.get(
      URL.fromString(base)
        .addRoute(
          `/telemetry/session-replay/v${config.recorderVersion}/recorder.js`,
        )
        .toString(),
    );

    expect(artifact.status(), await artifact.text()).toBe(200);
    expect(artifact.headers()["cache-control"]).toContain("immutable");

    /*
     * A version this build did not publish must 404 rather than being served
     * today's bytes under yesterday's number with a year-long cache.
     */
    const wrongVersion: APIResponse = await page.request.get(
      URL.fromString(base)
        .addRoute(
          "/telemetry/session-replay/v0.0.1-never-published/recorder.js",
        )
        .toString(),
    );

    expect(wrongVersion.status()).toBe(404);

    /*
     * The probe an install script or the dashboard's test panel uses to tell
     * "bad key" apart from "replay is off for this application".
     */
    const validate: APIResponse = await page.request.get(
      URL.fromString(base)
        .addRoute("/telemetry/session-replay/v1/validate")
        .toString(),
      {
        headers: {
          "x-oneuptime-token": ingestionKey,
          "x-oneuptime-app-identifier": appIdentifier,
        },
      },
    );

    expect(validate.status(), await validate.text()).toBe(200);

    const validation: { valid?: boolean; tokenProvided?: boolean } =
      (await validate.json()) as { valid?: boolean; tokenProvided?: boolean };

    expect(validation.tokenProvided).toBe(true);
    expect(validation.valid).toBe(true);
  });
});

type PollUntilFunction = (data: {
  page: Page;
  what: string;
  run: () => Promise<boolean>;
  timeoutMs?: number;
}) => Promise<void>;

/*
 * Retry a check until it passes or the deadline expires, logging each
 * attempt. Mirrors waitForTelemetryText's shape; the session replay checks
 * need to re-run navigation AND clicks between attempts, which that helper
 * does not model.
 */
const pollUntil: PollUntilFunction = async (data: {
  page: Page;
  what: string;
  run: () => Promise<boolean>;
  timeoutMs?: number;
}): Promise<void> => {
  const deadline: number = Date.now() + (data.timeoutMs ?? 180000);
  let attempt: number = 0;

  while (Date.now() < deadline) {
    attempt++;

    try {
      if (await data.run()) {
        return;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(
        `[sessionReplay] ${data.what} attempt=${attempt} error=${(error as Error).message}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(`[sessionReplay] waiting for ${data.what} attempt=${attempt}`);

    await data.page.waitForTimeout(5000);
  }

  throw new Error(`Timed out waiting for ${data.what}`);
};
