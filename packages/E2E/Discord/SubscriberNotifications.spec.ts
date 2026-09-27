import {
  APIRequestContext,
  Browser,
  BrowserContext,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  JSONish,
  ProjectDefaults,
  buildUrl,
  createItem,
  getItem,
  getProjectDefaults,
  listItems,
  pollUntil,
  toId,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import { publicPostStatus } from "../Tests/Dashboard/Helpers/StatusPagePublic";
import identities from "./Fixture/identities.json";

/*
 * HOM-45: status-page Discord subscriber vertical slice, end to end.
 *
 * The public subscribe -> delivery -> manage -> unsubscribe flow runs against
 * the disposable HTTPS Discord fixture: the subscriber's incoming webhook URL
 * points at a webhook seeded over the fixture control plane
 * (/__fixture/seed, webhooks collection), which the fixture network alias
 * serves. Deliveries land in the fixture's postedMessages with webhook_id set,
 * so delivery assertions below read fixture state rather than trusting a 200
 * from the public API. The failed-delivery case uses the fixture's one-shot
 * fault injector (seed fault on POST /webhooks/{id}/{token}).
 *
 * Failure-first by design: the enable gate, the persisted Failed delivery
 * status, and the unsubscribe readback are all asserted on real state (API
 * 400s, the subscriber-notification status column, the get-subscription
 * endpoint), not on UI text.
 */

const WEBHOOK_ID: string = "900000000000000001";
const WEBHOOK_URL: string = `https://discord.com/api/webhooks/${WEBHOOK_ID}/fixture-token`;
const CHANNEL_NAME: string = "hom45-e2e-alerts";

interface PostedMessage {
  webhook_id?: string;
  webhook_kind?: string;
  content?: string;
  timestamp?: string;
}

interface FixtureState {
  postedMessages: Array<PostedMessage>;
}

async function fixtureControl(
  path: string,
  body?: unknown,
): Promise<FixtureState> {
  const token: string | undefined =
    process.env["DISCORD_FIXTURE_CONTROL_TOKEN"];
  if (!token) {
    throw new Error("DISCORD_FIXTURE_CONTROL_TOKEN is required");
  }
  /*
   * Fixture control methods differ per endpoint: "state" is GET, "reset"
   * and "seed" are POST. A wrong method 404s.
   */
  const method: string = path === "state" ? "GET" : "POST";
  const response: globalThis.Response = await fetch(
    `https://discord.com/__fixture/${path}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        "x-fixture-control": token,
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    },
  );
  expect(response.status, "Discord fixture control call failed").toBe(200);
  return (await response.json()) as FixtureState;
}

async function deliveriesFor(webhookId: string): Promise<Array<PostedMessage>> {
  const state: FixtureState = await fixtureControl("state");
  return state.postedMessages.filter((message: PostedMessage) => {
    return (
      message.webhook_id === webhookId && message.webhook_kind === "subscriber"
    );
  });
}

async function waitForDelivery(data: {
  webhookId: string;
  count: number;
  description: string;
  timeoutMs?: number;
}): Promise<Array<PostedMessage>> {
  const deadline: number = Date.now() + (data.timeoutMs || 120000);
  while (Date.now() < deadline) {
    const deliveries: Array<PostedMessage> = await deliveriesFor(
      data.webhookId,
    );
    if (deliveries.length >= data.count) {
      return deliveries;
    }
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 2000);
    });
  }
  throw new Error(
    `Timed out waiting for ${data.count} fixture deliveries to webhook ${data.webhookId}: ${data.description}`,
  );
}

async function pollIncidentNotificationStatus(data: {
  page: Page;
  projectId: string;
  incidentId: string;
  status: string;
}): Promise<void> {
  await pollUntil<boolean>({
    page: data.page,
    description: `incident subscriber notification status to become ${data.status}`,
    timeoutMs: 180000,
    check: async (): Promise<boolean | null> => {
      const row: JSONish = await getItem({
        page: data.page,
        projectId: data.projectId,
        path: "/api/incident",
        id: data.incidentId,
        select: { subscriberNotificationStatusOnIncidentCreated: true },
      });
      const status: string = String(
        row["subscriberNotificationStatusOnIncidentCreated"] || "",
      );
      return [data.status, "Failed"].includes(status) ? true : null;
    },
  });
  const row: JSONish = await getItem({
    page: data.page,
    projectId: data.projectId,
    path: "/api/incident",
    id: data.incidentId,
    select: { subscriberNotificationStatusOnIncidentCreated: true },
  });
  expect(
    String(row["subscriberNotificationStatusOnIncidentCreated"] || ""),
    "the incident subscriber notification status",
  ).toBe(data.status);
}

test.describe.configure({ mode: "serial", retries: 0 });

test.describe("Discord status page subscribers", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour, one engine is enough");

  let context: BrowserContext;
  let page: Page;
  let projectId: string;
  let statusPageId: string;
  let monitorId: string;
  let subscriberId: string;
  let severityId: string;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(600000);
    context = await browser.newContext();
    page = await context.newPage();
    await fixtureControl("reset");
    /*
     * Seed the subscriber webhook destination; the fixture 401s unseeded
     * incoming webhooks.
     */
    await fixtureControl("seed", {
      webhooks: [
        {
          id: WEBHOOK_ID,
          token: "fixture-token",
          channelId: identities.channelId,
          kind: "subscriber",
        },
      ],
    });

    const unique: string = `hom45-${Date.now().toString(36)}`;
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "Discord Subscriber E2E",
    });
    const defaults: ProjectDefaults = await getProjectDefaults({
      page,
      projectId,
    });
    severityId = defaults.incidentSeverityId;

    const monitor: JSONish = await createItem({
      page,
      projectId,
      path: "/api/monitor",
      item: {
        name: `${unique}-monitor`,
        description: "Manual monitor backing the Discord subscriber spec.",
        projectId,
        monitorType: "Manual",
        currentMonitorStatusId: defaults.operationalMonitorStatusId,
      },
    });
    monitorId = toId(monitor["_id"]);

    const statusPage: JSONish = await createItem({
      page,
      projectId,
      path: "/api/status-page",
      item: {
        name: `Status Page ${unique}`,
        pageTitle: `Status Page ${unique}`,
        description: "Created by SubscriberNotifications.spec.ts",
        projectId,
        isPublicStatusPage: true,
        showSubscriberPageOnStatusPage: true,
        enableEmailSubscribers: true,
        enableDiscordSubscribers: false,
      },
    });
    statusPageId = toId(statusPage["_id"]);

    await createItem({
      page,
      projectId,
      path: "/api/status-page-resource",
      item: {
        projectId,
        statusPageId,
        monitorId,
        displayName: `${unique} checkout`,
        displayDescription: "Resource for the Discord subscriber spec.",
        showStatusHistoryChart: false,
        showCurrentStatus: true,
        order: 1,
      },
    });
  });

  test("rejects a Discord subscription while the dashboard toggle is off", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const anonymous: APIRequestContext = (await browser.newContext()).request;

    const status: number = await publicPostStatus({
      request: anonymous,
      path: `/status-page-api/subscribe/${statusPageId}`,
      body: {
        data: {
          discordChannelName: CHANNEL_NAME,
          discordIncomingWebhookUrl: WEBHOOK_URL,
          isSubscribedToAllResources: true,
          isSubscribedToAllEventTypes: true,
        },
      },
    });
    expect(
      status,
      "subscribe must be rejected while enableDiscordSubscribers is false",
    ).toBe(400);

    const subscribers: Array<JSONish> = await listItems({
      page,
      projectId,
      path: "/api/status-page-subscriber",
      query: { statusPageId, discordChannelName: CHANNEL_NAME },
      select: { _id: true },
    });
    expect(
      subscribers.length,
      "no subscriber row may persist from a rejected subscribe",
    ).toBe(0);
  });

  test("dashboard enable path turns on Discord subscribers", async () => {
    const statusPage: JSONish = await getItem({
      page,
      projectId,
      path: "/api/status-page",
      id: statusPageId,
      select: { enableDiscordSubscribers: true },
    });
    expect(
      statusPage["enableDiscordSubscribers"],
      "setup leaves Discord subscribers disabled",
    ).toBe(false);

    /*
     * Open the subscriber settings card directly; the table route is
     * /dashboard/{projectId}/status-pages/{modelId}/subscriber-settings.
     */
    await page.goto(
      buildUrl(
        `/dashboard/${projectId}/status-pages/${statusPageId}/subscriber-settings`,
      ),
    );

    /*
     * The Discord card is a CardModelDetail titled "Discord Subscribers".
     * Card action buttons carry data-testid="card-button" and identical
     * titles ("Edit Status Page"), so anchor on the card that contains the
     * Discord heading, then click its card-button. Edit opens a modal with
     * the enableDiscordSubscribers toggle.
     */
    const discordHeading: Locator = page.getByRole("heading", {
      name: "Discord Subscribers",
      exact: true,
    });
    const discordCard: Locator = discordHeading.locator(
      'xpath=ancestor::div[.//*[@data-testid="card-button"]][1]',
    );
    await discordCard.getByTestId("card-button").first().click();
    /*
     * The modal is portaled as a top-level dialog; [data-testid="modal"]
     * does not wrap it. Scope to the dialog role.
     */
    const modal: Locator = page.getByRole("dialog").last();
    await modal.waitFor({ timeout: 60000 });
    await modal
      .getByRole("switch", { name: /Enable Discord Subscribers/ })
      .click();
    await modal.getByRole("button", { name: "Save Changes" }).click();

    await pollUntil<boolean>({
      page,
      description: "enableDiscordSubscribers to persist as true",
      timeoutMs: 60000,
      check: async (): Promise<boolean | null> => {
        const refreshed: JSONish = await getItem({
          page,
          projectId,
          path: "/api/status-page",
          id: statusPageId,
          select: { enableDiscordSubscribers: true },
        });
        return refreshed["enableDiscordSubscribers"] === true ? true : null;
      },
    });
  });

  test("subscribes through the public form and delivers the welcome message", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const anonymousContext: BrowserContext = await browser.newContext();
    const anonPage: Page = await anonymousContext.newPage();

    await anonPage.goto(
      buildUrl(`/status-page/${statusPageId}/subscribe/discord`),
    );
    await anonPage.waitForSelector("#discord-form", { timeout: 120000 });
    const subscribeForm: Locator = anonPage.locator("#discord-form");
    /*
     * ModelForm renders inputs without a name attribute (React useId only),
     * so fields are located by their label text within the form container.
     */
    await subscribeForm.getByLabel(/Discord Channel Name/).fill(CHANNEL_NAME);
    await subscribeForm
      .getByLabel(/Discord Incoming Webhook URL/)
      .fill(WEBHOOK_URL);
    // BasicForm renders the submit control as type="button" with a deterministic id.
    await anonPage.locator("#discord-form-submit-button").click();
    await expect(
      anonPage.getByText("You have been subscribed successfully."),
    ).toBeVisible({ timeout: 60000 });

    const subscribers: Array<JSONish> = await pollUntil<Array<JSONish>>({
      page,
      description: "the Discord subscriber row to persist",
      timeoutMs: 60000,
      check: async (): Promise<Array<JSONish> | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId,
          path: "/api/status-page-subscriber",
          query: { statusPageId, discordChannelName: CHANNEL_NAME },
          select: {
            _id: true,
            isSubscriptionConfirmed: true,
            isUnsubscribed: true,
          },
        });
        return rows.length > 0 ? rows : null;
      },
    });
    subscriberId = toId(subscribers[0]!["_id"]);
    expect(subscribers[0]!["isSubscriptionConfirmed"]).toBe(true);
    expect(subscribers[0]!["isUnsubscribed"]).toBe(false);

    const welcome: Array<PostedMessage> = await waitForDelivery({
      webhookId: WEBHOOK_ID,
      count: 1,
      description: "the welcome message on the subscriber webhook",
    });
    expect(welcome[0]!.content).toContain("New Subscription");

    await anonymousContext.close();
  });

  test("records a persisted Failed status when the webhook rejects an incident delivery", async () => {
    await fixtureControl("seed", {
      fault: {
        method: "POST",
        /*
         * The fixture normalizes webhook routes by stripping the /api prefix
         * (server.cjs: route = pathname.replace(/^\/api(\/v10)?/, "")), so the
         * fault path must be /webhooks/..., not /api/webhooks/...
         */
        path: `/webhooks/${WEBHOOK_ID}/fixture-token`,
        status: 403,
        body: { message: "Unknown Webhook", code: 10015 },
        remaining: 5,
      },
    });

    const incident: JSONish = await createItem({
      page,
      projectId,
      path: "/api/incident",
      item: {
        projectId,
        title: `hom45 failed delivery ${Date.now().toString(36)}`,
        incidentSeverityId: severityId,
        description:
          "Incident notification must fail against the flagged webhook.",
        monitors: [{ _id: monitorId }],
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
    });

    await pollIncidentNotificationStatus({
      page,
      projectId,
      incidentId: toId(incident["_id"]),
      status: "Failed",
    });

    await fixtureControl("seed", { fault: null });
  });

  test("delivers an incident notification to the working webhook", async () => {
    const before: number = (await deliveriesFor(WEBHOOK_ID)).length;
    /*
     * Unique title so the delivery assertion cannot match an earlier message
     * (the welcome message also posts to this webhook with nonempty content).
     */
    const incidentTitle: string = `hom45 delivered ${Date.now().toString(36)}`;

    await createItem({
      page,
      projectId,
      path: "/api/incident",
      item: {
        projectId,
        title: incidentTitle,
        incidentSeverityId: severityId,
        description: "Incident notification must reach the working webhook.",
        monitors: [{ _id: monitorId }],
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
    });

    const deliveries: Array<PostedMessage> = await waitForDelivery({
      webhookId: WEBHOOK_ID,
      count: before + 1,
      description: "the incident notification on the subscriber webhook",
    });
    expect(
      deliveries.some((delivery: PostedMessage) => {
        return Boolean(
          delivery.content && delivery.content.includes(incidentTitle),
        );
      }),
      "the fixture records a delivery carrying this incident's unique title",
    ).toBe(true);
  });

  test("sends the manage link to Discord through the public manage form", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const anonymousContext: BrowserContext = await browser.newContext();
    const anonPage: Page = await anonymousContext.newPage();

    const before: number = (await deliveriesFor(WEBHOOK_ID)).length;

    await anonPage.goto(
      buildUrl(`/status-page/${statusPageId}/subscribe/discord`),
    );
    /*
     * The manage form only mounts after switching to the Manage tab; waiting
     * for #discord-manage-form before the click can never resolve.
     */
    await anonPage.locator("text=Manage Existing").first().click();
    await anonPage.waitForSelector("#discord-manage-form", { timeout: 120000 });
    await anonPage
      .locator("#discord-manage-form")
      .getByLabel(/Discord channel name you have subscribed with/)
      .fill(CHANNEL_NAME);
    await anonPage.locator("#discord-manage-form-submit-button").click();
    await expect(
      anonPage.getByText(
        "If a subscription matches the details you entered, we have sent a link to manage it.",
      ),
    ).toBeVisible({ timeout: 60000 });

    const deliveries: Array<PostedMessage> = await waitForDelivery({
      webhookId: WEBHOOK_ID,
      count: before + 1,
      description: "the manage-subscription link on the subscriber webhook",
    });
    const link: PostedMessage = deliveries[deliveries.length - 1]!;
    expect(link.content).toContain("/update-subscription/");
    expect(link.content).toContain(subscriberId);

    await anonymousContext.close();
  });

  test("unsubscribes through the update-subscription page and stops delivery", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    /*
     * The closing negative check idles two worker cycles (150s), so this test
     * needs a larger budget than the 90s config default.
     */
    test.setTimeout(300000);
    const anonymousContext: BrowserContext = await browser.newContext();
    const anonPage: Page = await anonymousContext.newPage();

    await anonPage.goto(
      buildUrl(
        `/status-page/${statusPageId}/update-subscription/${subscriberId}`,
      ),
    );
    await anonPage.waitForSelector("#email-form", { timeout: 120000 });
    await anonPage.getByRole("switch", { name: "Unsubscribe" }).click();
    await anonPage.locator("#email-form-submit-button").click();
    await expect(
      anonPage.getByText("Your changes have been saved."),
    ).toBeVisible({
      timeout: 60000,
    });

    await pollUntil<boolean>({
      page,
      description: "the subscriber to read back unsubscribed",
      timeoutMs: 60000,
      check: async (): Promise<boolean | null> => {
        const row: JSONish = await getItem({
          page,
          projectId,
          path: "/api/status-page-subscriber",
          id: subscriberId,
          select: { isUnsubscribed: true },
        });
        return row["isUnsubscribed"] === true ? true : null;
      },
    });

    const before: number = (await deliveriesFor(WEBHOOK_ID)).length;
    const incident: JSONish = await createItem({
      page,
      projectId,
      path: "/api/incident",
      item: {
        projectId,
        title: `hom45 post-unsubscribe ${Date.now().toString(36)}`,
        incidentSeverityId: severityId,
        description: "No delivery may follow an unsubscribe.",
        monitors: [{ _id: monitorId }],
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
    });

    /*
     * The worker marks even the no-subscriber path Success
     * (SendNotificationToSubscribers.ts:817-818), so waiting for the persisted
     * status proves this incident's job ran to completion; a bare idle wait
     * would also pass with a dead worker. 180s > two worker cycles.
     */
    await pollIncidentNotificationStatus({
      page,
      projectId,
      incidentId: toId(incident["_id"]),
      status: "Success",
    });
    expect(
      (await deliveriesFor(WEBHOOK_ID)).length,
      "no delivery after unsubscribe",
    ).toBe(before);

    await anonymousContext.close();
  });
});
