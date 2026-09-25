import {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  createItem,
  getProjectDefaults,
  listItems,
  toId,
  type ProjectDefaults,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import identities from "./Fixture/identities.json";

/*
 * HOM-36 (test-first): Discord notification routing through the standard
 * WorkspaceNotificationRule engine, not a channel-bound bypass.
 *
 * These tests are written BEFORE the rule-path implementation and are
 * expected to fail until it lands. Two invariants, from the 2026-09-25
 * review directive:
 *   1. An alert notification must NOT land in the Discord incident channel
 *      just because the project has one — non-incident notifications reach
 *      Discord only through matching notification rules.
 *   2. One incident, one thread, one post: the incident lifecycle message
 *      goes to a thread under the configured incident parent, created by
 *      the rule engine (createChannelsBasedOnRules -> Discord.createChannel),
 *      exactly once.
 */

const app: string = `http://${process.env["HOST"] || "oneuptime.test:7849"}`;
const projectTokens: string = "/api/workspace-project-auth-token";
const userTokens: string = "/api/workspace-user-auth-token";
const rulesPath: string = "/api/workspace-notification-rule";
const monitorsPath: string = "/api/monitor";
const alertsPath: string = "/api/alert";

interface Binding {
  _id: string;
  workspaceProjectId?: string;
  workspaceUserId?: string;
  miscData?: { incidentChannelId?: string };
}
interface PostedMessage {
  channel_id?: string;
  content?: string;
  embeds?: Array<unknown>;
  components?: Array<unknown>;
  interaction_token?: string;
}
interface ProviderState {
  events: Array<{ method: string; path: string; status: number }>;
  unhandled: Array<string>;
  postedMessages: Array<PostedMessage>;
}
interface IncidentRow {
  _id: string;
  projectId?: string;
}

let context: BrowserContext;
let page: Page;
let projectId: string;
let defaults: ProjectDefaults;

const headers: () => Record<string, string> = (): Record<string, string> => {
  return { tenantid: projectId, projectid: projectId };
};
const url: (path: string) => string = (path: string): string => {
  return `${app}/api/discord/${path}`;
};

async function fixture(path: string, body?: unknown): Promise<ProviderState> {
  const token: string | undefined =
    process.env["DISCORD_FIXTURE_CONTROL_TOKEN"];
  if (!token) {
    throw new Error("DISCORD_FIXTURE_CONTROL_TOKEN is required");
  }
  const response: Response = await fetch(
    `https://discord.com/__fixture/${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-fixture-control": token,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  expect(response.status, "Discord HTTPS fixture control failed").toBe(200);
  return (await response.json()) as ProviderState;
}

async function bindings(path: string): Promise<Array<Binding>> {
  return (await listItems({
    page,
    projectId,
    path,
    query: { projectId, workspaceType: "Discord" },
    select: {
      _id: true,
      ...(path === projectTokens
        ? { workspaceProjectId: true }
        : { workspaceUserId: true }),
      miscData: true,
    },
  })) as Array<Binding>;
}

async function install(): Promise<void> {
  const response: APIResponse = await page.request.get(url("install-url"), {
    headers: headers(),
  });
  expect(response.status(), "Install initiation must exist").toBe(200);
  const body: { authorizationUrl: string } = (await response.json()) as {
    authorizationUrl: string;
  };
  await page.goto(body.authorizationUrl);
  await expect
    .poll(async (): Promise<number> => (await bindings(projectTokens)).length)
    .toBe(1);
}

async function linkUser(): Promise<void> {
  const response: APIResponse = await page.request.get(url("sign-in-url"), {
    headers: headers(),
  });
  expect(response.status(), "User link initiation must exist").toBe(200);
  const body: { authorizationUrl: string } = (await response.json()) as {
    authorizationUrl: string;
  };
  await page.goto(body.authorizationUrl);
  await expect
    .poll(async (): Promise<number> => (await bindings(userTokens)).length)
    .toBe(1);
}

async function setIncidentChannel(channelId: string): Promise<void> {
  const response: APIResponse = await page.request.put(
    url("incident-channel"),
    { headers: headers(), data: { channelId } },
  );
  expect(response.ok(), "Setting the incident channel must succeed").toBe(
    true,
  );
}

/*
 * A rule that routes notifications for the given event type to the project's
 * incident channel by name, exercising the standard engine end to end
 * (filters, channel resolution, delivery). Discord.createChannel turns
 * "create a channel for this notification" into "create a thread under the
 * configured incident parent", so a rule with shouldCreateNewChannel posts
 * to a fresh thread named after the incident.
 */
async function createDiscordRule(eventType: string): Promise<string> {
  const created: unknown = await createItem({
    page,
    projectId,
    path: rulesPath,
    item: {
      projectId,
      name: `Discord routing ${eventType}`,
      description: "E2E rule",
      workspaceType: "Discord",
      eventType,
      notificationRule: {
        _type: "IncidentNotificationRule",
        filterCondition: "and",
        filters: [],
        shouldPostToExistingChannel: false,
        existingChannelNames: "",
        shouldCreateNewChannel: true,
        newChannelTemplateName: "Incident",
        teamToCreateChannelIn: undefined,
        inviteTeamsToNewChannel: [],
        inviteUsersToNewChannel: [],
        shouldInviteOwnersToNewChannel: false,
        shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
        archiveChannelAutomatically: false,
      },
    },
  });
  const ruleId: string = toId((created as { _id?: unknown })._id);
  expect(ruleId, "Rule creation must return an id").toBeTruthy();
  return ruleId;
}

async function createIncident(title: string): Promise<IncidentRow> {
  const row: unknown = await createItem({
    page,
    projectId,
    path: "/api/incident",
    item: {
      projectId,
      title,
      incidentSeverityId: defaults.incidentSeverityId,
      description: "HOM-36 E2E incident",
    },
  });
  const incident: IncidentRow = row as IncidentRow;
  expect(incident._id, "Incident creation must return an id").toBeTruthy();
  return incident;
}

/*
 * Creates a real monitor and a real alert for it, driving
 * AlertService.onCreateSuccess -> AlertFeedService.createAlertFeedItem ->
 * sendWorkspaceMarkdownNotification — the exact path the bypass leaked on.
 */
function buildMonitorSteps(
  defaults: ProjectDefaults,
  name: string,
): Record<string, unknown> {
  return {
    _type: "MonitorSteps",
    value: {
      defaultMonitorStatusId: defaults.operationalMonitorStatusId,
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: ObjectID.generate().toString(),
            monitorDestination: URL.fromString(
              `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example.com`,
            ).toJSON(),
            requestType: "GET",
            requestHeaders: {},
            requestBody: "",
            requestTimeoutInMs: 5000,
            retryCount: 0,
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: ObjectID.generate().toString(),
                      name: "Availability",
                      description: `Criteria for ${name}`,
                      filterCondition: "All",
                      filters: [{ checkOn: "Is Online", filterType: "True" }],
                      createIncidents: false,
                      createAlerts: false,
                      changeMonitorStatus: false,
                      incidents: [],
                      alerts: [],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
}

async function createAlert(title: string): Promise<string> {
  const severities: Array<{ _id: string }> = (await listItems({
    page,
    projectId,
    path: "/api/alert-severity",
    query: { projectId },
    select: { _id: true },
  })) as Array<{ _id: string }>;
  expect(
    severities.length,
    "The project must have at least one alert severity",
  ).toBeGreaterThan(0);
  const monitor: unknown = await createItem({
    page,
    projectId,
    path: monitorsPath,
    item: {
      projectId,
      name: title,
      monitorType: "API",
      monitorSteps: buildMonitorSteps(defaults, title),
      monitoringInterval: "*/5 * * * *",
      minimumProbeAgreement: 1,
    },
  });
  const monitorId: string = toId((monitor as { _id?: unknown })._id);
  expect(monitorId, "Monitor creation must return an id").toBeTruthy();
  const alert: unknown = await createItem({
    page,
    projectId,
    path: alertsPath,
    item: {
      projectId,
      title,
      monitorId,
      alertSeverityId: toId(severities[0]!._id),
    },
  });
  const alertId: string = toId((alert as { _id?: unknown })._id);
  expect(alertId, "Alert creation must return an id").toBeTruthy();
  return alertId;
}

async function postedToIncidentChannel(): Promise<Array<PostedMessage>> {
  const state: ProviderState = await fixture("state");
  return state.postedMessages.filter(
    (message: PostedMessage): boolean =>
      message.channel_id === identities.channelId,
  );
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(240000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord notification routing E2E",
  });
  defaults = await getProjectDefaults({ page, projectId });
});

test.beforeEach(async (): Promise<void> => {
  for (const path of [projectTokens, userTokens]) {
    for (const row of await bindings(path)) {
      await page.request.delete(`${app}${path}/${row._id}`, {
        headers: headers(),
      });
    }
  }
  await fixture("reset", {});
});

test.afterEach(
  // eslint-disable-next-line no-empty-pattern
  async ({}: Record<string, unknown>, testInfo: TestInfo): Promise<void> => {
    if (!page || !projectId) {
      return;
    }
    await testInfo.attach("browser-final", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  },
);

test.afterAll(async (): Promise<void> => {
  await context?.close();
});

test("alert notification must NOT reach the Discord incident channel", async (): Promise<void> => {
  await install();
  await linkUser();
  await setIncidentChannel(identities.channelId);
  await fixture("reset", {});
  await createAlert("HOM-36 alert must stay out");
  // Give the asynchronous feed chain time to run before asserting absence.
  await page.waitForTimeout(10_000);
  const leaked: Array<PostedMessage> = await postedToIncidentChannel();
  expect(
    leaked.length,
    "No alert-driven message may land in the incident channel without a matching Discord notification rule",
  ).toBe(0);
});

test("one incident, one thread, one post", async (): Promise<void> => {
  await install();
  await linkUser();
  await setIncidentChannel(identities.channelId);
  await createDiscordRule("Incident");
  await fixture("reset", {});
  await createIncident("HOM-36 one thread one post");
  // Wait for the lifecycle message with the title to land in a thread (not
  // the parent channel). Polling the thread-creation count alone resolves
  // before the message POST that follows it.
  await expect
    .poll(
      async (): Promise<boolean> =>
        (await fixture("state")).postedMessages.some(
          (message: PostedMessage): boolean =>
            message.channel_id !== identities.channelId &&
            (message.content || "").includes("HOM-36 one thread one post"),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  // Settle window: a double-post landing one async tick later must not slip
  // past a snapshot taken at first arrival. The double-post is the bug this
  // spec exists to catch.
  await page.waitForTimeout(10_000);
  const state: ProviderState = await fixture("state");
  // The fixture records the raw pathname under DiscordClient.BASE_URL
  // (https://discord.com/api/v10), so match on the suffix, like
  // Installation.spec.ts does for /oauth2/token.
  const threadPosts: number = state.events.filter(
    (event: { method: string; path: string }): boolean =>
      event.method === "POST" &&
      event.path.endsWith(`/channels/${identities.channelId}/threads`),
  ).length;
  expect(
    threadPosts,
    "Exactly one thread must be created under the incident parent",
  ).toBe(1);
  const withTitle: Array<PostedMessage> = state.postedMessages.filter(
    (message: PostedMessage): boolean =>
      (message.content || "").includes("HOM-36 one thread one post"),
  );
  expect(
    withTitle.length,
    "The incident lifecycle must post exactly once, anywhere",
  ).toBe(1);
  const threadId: string | undefined = withTitle[0]?.channel_id;
  expect(threadId, "The message must be in a thread").toBeTruthy();
  // A thread also carries the owner feed line and the state-change line
  // (Slack parity through sendWorkspaceMarkdownNotification), so the thread
  // message count is not asserted. The double-post signature is the title
  // card appearing in the parent channel.
  expect(
    state.postedMessages.filter(
      (message: PostedMessage): boolean =>
        message.channel_id === identities.channelId &&
        (message.content || "").includes("HOM-36 one thread one post"),
    ).length,
    "The title card must not also be posted to the parent channel",
  ).toBe(0);
});
