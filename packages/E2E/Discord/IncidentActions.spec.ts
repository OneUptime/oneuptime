import {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import identities from "./Fixture/identities.json";

/*
 * HOM-35 (test-first): incident thread actions + lifecycle + durable binding.
 * These tests are written BEFORE the server implementation and are expected to
 * fail until it lands. Fixture control token and signing key come from the
 * disposable stack (config.env), never from production credentials.
 *
 * Scope per the failure-modes list in
 * ~/.buzz/PLANS/2026-09-25_HOM35_DISCORD_INCIDENT_ACTIONS.md:
 * signatures/replays, member authorization, state-machine guards, binding
 * durability, lifecycle dispatch. New specs never call /api/discord/config
 * (shared 600/60s setup window owned by RateLimit.spec).
 */

const app: string = `http://${process.env["HOST"] || "oneuptime.test:7849"}`;
const projectTokens: string = "/api/workspace-project-auth-token";
const userTokens: string = "/api/workspace-user-auth-token";

interface Binding {
  _id: string;
  workspaceProjectId?: string;
  workspaceUserId?: string;
  miscData?: { incidentChannelId?: string };
}
interface ProviderEvent {
  method: string;
  path: string;
  status: number;
  body?: unknown;
}
interface ProviderState {
  events: Array<ProviderEvent>;
  unhandled: Array<string>;
}
interface IncidentRow {
  _id: string;
  projectId?: string;
  currentIncidentState?: { order?: number; name?: string };
  currentIncidentStateId?: string;
}

let context: BrowserContext;
let page: Page;
let projectId: string;
let userId: string;
let incidentSeverityId: string | undefined;

const headers: () => Record<string, string> = (): Record<string, string> => {
  return { tenantid: projectId, projectid: projectId };
};
const url: (path: string) => string = (path: string): string => {
  return `${app}/api/discord/${path}`;
};

function signed(body: string, timestamp: string): Record<string, string> {
  const path: string | undefined = process.env["DISCORD_FIXTURE_SIGNING_KEY"];
  if (!path) {
    throw new Error("Disposable DISCORD_FIXTURE_SIGNING_KEY is required");
  }
  return {
    "content-type": "application/json",
    "x-signature-timestamp": timestamp,
    "x-signature-ed25519": sign(
      null,
      Buffer.from(timestamp + body),
      readFileSync(path),
    ).toString("hex"),
  };
}

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

async function clearBindings(): Promise<void> {
  for (const path of [userTokens, projectTokens]) {
    for (const row of await bindings(path)) {
      await deleteItem({ page, projectId, path, id: row._id });
    }
  }
}

async function install(): Promise<Binding> {
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
  const row: Binding = (await bindings(projectTokens))[0]!;
  expect(row.workspaceProjectId).toBe(identities.guildId);
  return row;
}

async function setIncidentChannel(channelId: string): Promise<void> {
  const response: APIResponse = await page.request.put(
    url("incident-channel"),
    { headers: headers(), data: { channelId } },
  );
  expect(response.ok(), "Setting the incident channel must succeed").toBe(true);
}

async function createIncident(title: string): Promise<IncidentRow> {
  if (!incidentSeverityId) {
    const severities: Array<{ _id: string }> = (await listItems({
      page,
      projectId,
      path: "/api/incident-severity",
      query: { projectId },
      select: { _id: true },
    })) as Array<{ _id: string }>;
    expect(
      severities.length,
      "The project must have at least one incident severity",
    ).toBeGreaterThan(0);
    incidentSeverityId = severities[0]!._id;
  }
  const row: unknown = await createItem({
    page,
    projectId,
    path: "/api/incident",
    item: {
      projectId,
      title,
      incidentSeverityId,
      description: "HOM-35 E2E incident",
    },
  });
  const incident: IncidentRow = row as IncidentRow;
  expect(incident._id, "Incident creation must return an id").toBeTruthy();
  return incident;
}

async function currentIncidentState(
  incidentId: string,
): Promise<{ order?: number; name?: string; id?: string }> {
  const row: unknown = await getItem({
    page,
    projectId,
    path: "/api/incident",
    id: incidentId,
  });
  const incident: IncidentRow = row as IncidentRow;
  return {
    order: incident.currentIncidentState?.order,
    name: incident.currentIncidentState?.name,
    id: incident.currentIncidentStateId,
  };
}

function componentInteraction(data: {
  customId: string;
  incidentId: string;
  discordUserId?: string;
  messageId?: string;
}): string {
  return JSON.stringify({
    type: 3,
    application_id: identities.applicationId,
    guild_id: identities.guildId,
    channel_id: identities.channelId,
    token: `fixture-interaction-${data.customId}-${data.incidentId}`,
    id: `10000000000000${Math.floor(Math.random() * 900 + 100)}`,
    user: { id: data.discordUserId || identities.userId },
    message: {
      id:
        data.messageId ||
        `1000000000000100${Math.floor(Math.random() * 90 + 10)}`,
      interaction: {
        name: "oneuptime-incident",
        user: { id: identities.userId },
      },
    },
    data: {
      component_type: 2,
      custom_id: `${data.customId}:${data.incidentId}`,
    },
  });
}

async function postInteraction(body: string): Promise<APIResponse> {
  const timestamp: string = Math.floor(Date.now() / 1000).toString();
  return await page.request.post(url("interactions"), {
    data: body,
    headers: signed(body, timestamp),
  });
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(180000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord incident actions E2E",
  });
});

test.beforeEach(async (): Promise<void> => {
  await clearBindings();
  await fixture("reset", {});
});

// Playwright requires destructured fixtures even when this hook uses only testInfo.
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

test("incident created in a bound project posts a lifecycle message to the incident channel", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  await fixture("reset", {});
  const incident: IncidentRow = await createIncident(
    "HOM-35 lifecycle created",
  );
  expect(incident._id).toBeTruthy();
  // Lifecycle dispatch is asynchronous: poll the fixture for a message POST.
  const posted: ProviderEvent | undefined = await expect
    .poll(
      async (): Promise<ProviderEvent | undefined> =>
        (await fixture("state")).events.find(
          (event: ProviderEvent): boolean =>
            event.method === "POST" &&
            event.path.endsWith(
              "/channels/" + identities.channelId + "/messages",
            ),
        ),
      { timeout: 30_000 },
    )
    .toBeTruthy();
  expect(
    JSON.stringify(posted?.body || ""),
    "The lifecycle message must name the incident",
  ).toContain("HOM-35 lifecycle created");
});

test("component interaction acknowledges an incident and replies with the new state", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  const incident: IncidentRow = await createIncident("HOM-35 ack target");
  const before: { order?: number } = await currentIncidentState(incident._id);
  const response: APIResponse = await postInteraction(
    componentInteraction({
      customId: "AcknowledgeIncident",
      incidentId: incident._id,
    }),
  );
  expect(
    response.status(),
    "Component interactions must be handled, not 404",
  ).toBe(200);
  await expect
    .poll(
      async (): Promise<number | undefined> =>
        (await currentIncidentState(incident._id)).order,
    )
    .toBeGreaterThan(before.order || 0);
});

test("component interaction resolves an incident", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  const incident: IncidentRow = await createIncident("HOM-35 resolve target");
  const response: APIResponse = await postInteraction(
    componentInteraction({
      customId: "ResolveIncident",
      incidentId: incident._id,
    }),
  );
  expect(response.status()).toBe(200);
  await expect
    .poll(
      async (): Promise<number | undefined> =>
        (await currentIncidentState(incident._id)).order,
    )
    .toBeGreaterThanOrEqual(3);
});

test("resolved incidents cannot be regressed by an acknowledge button", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  const incident: IncidentRow = await createIncident("HOM-35 no-regress");
  await postInteraction(
    componentInteraction({
      customId: "ResolveIncident",
      incidentId: incident._id,
    }),
  );
  await expect
    .poll(
      async (): Promise<number | undefined> =>
        (await currentIncidentState(incident._id)).order,
    )
    .toBeGreaterThanOrEqual(3);
  const before: { order?: number } = await currentIncidentState(incident._id);
  const response: APIResponse = await postInteraction(
    componentInteraction({
      customId: "AcknowledgeIncident",
      incidentId: incident._id,
    }),
  );
  expect(
    [200, 409].includes(response.status()),
    "A regression attempt must be acknowledged or refused, never 5xx",
  ).toBe(true);
  expect(await currentIncidentState(incident._id)).toEqual(
    expect.objectContaining({ order: before.order }),
  );
});

test("unknown custom ids are ignored without crashing", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  const response: APIResponse = await postInteraction(
    componentInteraction({
      customId: "NotARealAction",
      incidentId: "000000000000000000000000",
    }),
  );
  expect(
    [200, 400, 404].includes(response.status()),
    "Unknown actions must not produce server errors",
  ).toBe(true);
});

test("forged component signatures are refused", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  const body: string = componentInteraction({
    customId: "AcknowledgeIncident",
    incidentId: "000000000000000000000000",
  });
  const timestamp: string = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = signed(body, timestamp);
  headers["x-signature-ed25519"] = "00".repeat(64);
  const response: APIResponse = await page.request.post(url("interactions"), {
    data: body,
    headers,
  });
  expect(
    [400, 401, 403].includes(response.status()),
    "Forged signatures must be refused, not executed",
  ).toBe(true);
});

test("component interactions from unmapped Discord users cannot transition incidents", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  const incident: IncidentRow = await createIncident("HOM-35 unmapped user");
  const before: { order?: number } = await currentIncidentState(incident._id);
  const response: APIResponse = await postInteraction(
    componentInteraction({
      customId: "AcknowledgeIncident",
      incidentId: incident._id,
      discordUserId: "999999999999999999",
    }),
  );
  expect(
    [200, 401, 403, 404].includes(response.status()),
    "Unmapped users must be refused or ignored, never 5xx",
  ).toBe(true);
  expect(await currentIncidentState(incident._id)).toEqual(
    expect.objectContaining({ order: before.order }),
  );
});

test("interactions with a foreign project incident id do not cross tenants", async (): Promise<void> => {
  await install();
  await setIncidentChannel(identities.channelId);
  const response: APIResponse = await postInteraction(
    componentInteraction({
      customId: "AcknowledgeIncident",
      incidentId: "000000000000000000000000",
    }),
  );
  expect(
    [200, 400, 401, 403, 404].includes(response.status()),
    "Foreign incident ids must be refused or ignored, never 5xx",
  ).toBe(true);
});
