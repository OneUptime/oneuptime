import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import { createTelemetryIngestionKey } from "./Helpers/Telemetry";
import {
  createRumApplication,
  hexId,
  openSessionReplayList,
  postSessionReplayChunk,
  readRumApplicationId,
} from "./Helpers/SessionReplay";

/*
 * Session Replay, end to end.
 *
 * Everything below the recorder bundle, exercised the way a customer's
 * browser exercises it: a real ingestion key, real chunk frames posted to
 * /telemetry/session-replay/v1/chunk, and then the real dashboard reading
 * them back.
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
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/SessionReplay.spec.ts --project=chromium
 */
test.describe("Session Replay", () => {
  /*
   * Register + project + billing + ingest key + a RUM application, then an
   * ingest→query poll. Same headroom the telemetry spec takes.
   */
  test.beforeEach(() => {
    test.setTimeout(420000);
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
    const sessionStartUnixMs: number = Date.now() - 60000;
    const userRef: string = `e2e-user-${Faker.generateName().toString().toLowerCase()}@example.com`;

    const origin: string = "https://shop.e2e.example.com";
    const home: string = `${origin}/`;
    const cart: string = `${origin}/cart`;
    const checkout: string = `${origin}/checkout`;

    /*
     * Three chunks describing one journey: land on /, navigate to /cart, then
     * to /checkout and throw. The URLs differ per chunk on purpose - that is
     * what makes exitUrl and routes[] falsifiable.
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
      routes: [home],
      identifiedUserRef: userRef,
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
      routeCount: 1,
    });

    await postSessionReplayChunk({
      page,
      ingestionKey,
      appIdentifier,
      sessionId,
      tabId,
      chunkIndex: 2,
      sessionStartUnixMs,
      url: checkout,
      routes: [checkout],
      routeCount: 1,
      errorCount: 1,
      isFinal: true,
      identifiedUserRef: userRef,
    });

    /* Hop 2: the session reaches the list. */
    await pollUntil({
      page,
      what: `session ${sessionId.slice(0, 12)} in the list`,
      run: async (): Promise<boolean> => {
        await openSessionReplayList({ page, projectId, rumApplicationId });
        await page.waitForTimeout(4000);

        return page.getByText(sessionId.slice(0, 12)).first().isVisible();
      },
    });

    /*
     * Hop 3: the end user is named.
     *
     * The recorder sends the reference, the parser accepts it, and the ingest
     * used to throw it away - so this cell read "Anonymous" for every session
     * ever recorded, the "User" filter could never match, and a
     * right-to-erasure request naming that person resolved zero sessions.
     */
    await expect(
      page.getByText(userRef).first(),
      "The end-user reference the page supplied must be stored and rendered",
    ).toBeVisible({ timeout: 30000 });

    /*
     * Hop 4: the session is playable.
     *
     * "Watch" opens the player, which fetches the manifest and then the
     * chunk frames over the binary framing endpoint and hands them to rrweb.
     */
    await page.getByRole("button", { name: "Watch" }).first().click();

    await expect(page.getByText("Session details").first()).toBeVisible({
      timeout: 60000,
    });

    /* The transport controls the player is useless without. */
    await expect(page.getByRole("button", { name: "1x" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next error" }),
    ).toBeVisible();

    /*
     * Hop 5: the journey is described correctly.
     *
     * The finalizer derives entryUrl / exitUrl / routes from the chunk rows.
     * Before that it was copied from the provisional header, written once on
     * chunk 0 - so this panel said the session both began AND ended on "/",
     * for a session that plainly ended on /checkout.
     */
    await page.getByRole("button", { name: "Session details" }).click();

    /*
     * EXACT. `checkout` has `home` as a prefix, so a substring match would
     * hold even when the Entry URL row shows the checkout page - which is
     * precisely the regression this assertion exists to catch.
     */
    await expect(page.getByText(home, { exact: true }).first()).toBeVisible({
      timeout: 30000,
    });

    await pollUntil({
      page,
      what: "the finalized exit URL",
      /*
       * Finalization is a 5-minute cron with a 10-minute idle cutoff, so this
       * is the one assertion that has to wait for a worker rather than for a
       * request.
       */
      timeoutMs: 240000,
      run: async (): Promise<boolean> => {
        await page.reload();
        await page.waitForTimeout(5000);
        await page
          .getByRole("button", { name: "Session details" })
          .click()
          .catch((): void => {
            /* Panel may already be open after a reload. */
          });

        return page.getByText(checkout).first().isVisible();
      },
    });
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
    const configResponse: APIResponse = await page.request.get(
      URL.fromString(base)
        .addRoute("/telemetry/session-replay/v1/config")
        .toString(),
      {
        headers: {
          "x-oneuptime-token": ingestionKey,
          "x-oneuptime-app-identifier": appIdentifier,
        },
      },
    );

    expect(configResponse.status(), await configResponse.text()).toBe(200);

    const config: {
      enabled?: boolean;
      directive?: string;
      recorderVersion?: string;
      recorderIntegrity?: string;
      maskingMode?: string;
    } = (await configResponse.json()) as {
      enabled?: boolean;
      directive?: string;
      recorderVersion?: string;
      recorderIntegrity?: string;
      maskingMode?: string;
    };

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
