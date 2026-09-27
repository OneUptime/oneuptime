import {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  createItem,
  deleteItem,
  getItem,
  getSessionUser,
  listItems,
  toId,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import identities from "./Fixture/identities.json";

// Authored before HOM-41. Run against both the baseline and assembled feature app.
const app: string = `http://${process.env["HOST"] || "oneuptime.test:7849"}`;
let context: BrowserContext;
let page: Page;
let projectId: string;
let actorId: string;
const resources: Array<{ path: string; id: string }> = [];

function toActorId(row: Record<string, unknown>): string {
  return toId(row["createdByUserId"]);
}

async function providerState(): Promise<Record<string, unknown>> {
  const token: string | undefined =
    process.env["DISCORD_FIXTURE_CONTROL_TOKEN"];
  if (!token) {
    throw new Error("Disposable fixture control token required");
  }
  const response: Response = await fetch(
    "https://discord.com/__fixture/state",
    { headers: { "x-fixture-control": token } },
  );
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

function payload(
  action: string,
  resourceId: string,
  values?: Record<string, string>,
): string {
  const id: string = (
    BigInt(`0x${randomBytes(8).toString("hex")}`) + BigInt("100000000000000000")
  ).toString();
  return JSON.stringify({
    id,
    token: `fixture-interaction-${id}`,
    application_id: identities.applicationId,
    guild_id: identities.guildId,
    channel_id: identities.channelId,
    member: { user: { id: identities.userId } },
    type: values ? 5 : 3,
    data: {
      custom_id: `${action}:${resourceId}`,
      ...(values
        ? {
            components: Object.entries(values).map(
              ([key, value]: [string, string]): Record<string, unknown> => {
                return {
                  type: 18,
                  component:
                    key === "noteType"
                      ? { type: 3, custom_id: key, values: [value] }
                      : { type: 4, custom_id: key, value },
                };
              },
            ),
          }
        : { component_type: 2 }),
    },
  });
}

async function send(body: string): Promise<Record<string, unknown>> {
  const signingKey: string | undefined =
    process.env["DISCORD_FIXTURE_SIGNING_KEY"];
  if (!signingKey) {
    throw new Error("Disposable signing key required");
  }
  const timestamp: string = Math.floor(Date.now() / 1000).toString();
  const response: APIResponse = await page.request.post(
    `${app}/api/discord/interactions`,
    {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-signature-timestamp": timestamp,
        "x-signature-ed25519": sign(
          null,
          Buffer.from(timestamp + body),
          readFileSync(signingKey),
        ).toString("hex"),
      },
    },
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function complete(body: string): Promise<void> {
  await send(body);
  await expect
    .poll(async (): Promise<string> => {
      const response: Record<string, unknown> = await send(body);
      const data: { content?: string } | undefined = response["data"] as
        | { content?: string }
        | undefined;
      return response["type"] === 4 &&
        data?.content &&
        !data.content.toLowerCase().includes("in progress")
        ? data.content
        : "";
    })
    .not.toBe("");
}

async function maintenance(): Promise<string> {
  const row: Record<string, unknown> = await createItem({
    page,
    projectId,
    path: "/api/scheduled-maintenance",
    item: {
      projectId,
      title: `Discord maintenance ${Date.now()}`,
      description: "Operations acceptance",
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
    },
  });
  const id: string = toId(row["_id"]);
  resources.push({ path: "/api/scheduled-maintenance", id });
  return id;
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(180000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord operations parity",
  });
  actorId = (await getSessionUser({ page })).userId;
  for (const route of ["install-url", "sign-in-url"]) {
    const response: APIResponse = await page.request.get(
      `${app}/api/discord/${route}`,
      { headers: { tenantid: projectId, projectid: projectId } },
    );
    expect(response.status()).toBe(200);
    const result: { authorizationUrl: string } = (await response.json()) as {
      authorizationUrl: string;
    };
    await page.goto(result.authorizationUrl);
  }
});

test.afterEach(
  async (
    { browser: _browser }: { browser: Browser },
    testInfo: TestInfo,
  ): Promise<void> => {
    await testInfo.attach("discord-provider", {
      body: JSON.stringify(await providerState()),
      contentType: "application/json",
    });
  },
);

test.afterAll(async (): Promise<void> => {
  if (page && projectId) {
    for (const resource of resources.reverse()) {
      await deleteItem({ page, projectId, ...resource });
    }
    for (const path of [
      "/api/workspace-user-auth-token",
      "/api/workspace-project-auth-token",
    ]) {
      const rows: Array<Record<string, unknown>> = await listItems({
        page,
        projectId,
        path,
        query: { projectId, workspaceType: "Discord" },
        select: { _id: true },
      });
      for (const row of rows) {
        await deleteItem({ page, projectId, path, id: toId(row["_id"]) });
      }
    }
  }
  await context?.close();
});

test("maintenance start, custom state and completion persist actor attribution", async (): Promise<void> => {
  const id: string = await maintenance();
  for (const [action, flag] of [
    ["MarkScheduledMaintenanceAsOngoing", "isOngoingState"],
    ["MarkScheduledMaintenanceAsComplete", "isResolvedState"],
  ]) {
    const states: Array<Record<string, unknown>> = await listItems({
      page,
      projectId,
      path: "/api/scheduled-maintenance-state",
      query: { projectId, [flag!]: true },
      select: { _id: true },
    });
    expect(states).toHaveLength(1);
    const target: string = toId(states[0]!["_id"]);
    await complete(payload(action!, id));
    const row: Record<string, unknown> = await getItem({
      page,
      projectId,
      path: "/api/scheduled-maintenance",
      id,
      select: { currentScheduledMaintenanceStateId: true },
    });
    expect(toId(row["currentScheduledMaintenanceStateId"])).toBe(target);
    const timeline: Array<Record<string, unknown>> = await listItems({
      page,
      projectId,
      path: "/api/scheduled-maintenance-state-timeline",
      query: {
        projectId,
        scheduledMaintenanceId: id,
        scheduledMaintenanceStateId: target,
      },
      select: { _id: true, createdByUserId: true },
    });
    expect(timeline.map(toActorId).includes(actorId)).toBe(true);
  }
  const states: Array<Record<string, unknown>> = await listItems({
    page,
    projectId,
    path: "/api/scheduled-maintenance-state",
    query: { projectId, isOngoingState: true },
    select: { _id: true },
  });
  await complete(
    payload("SubmitChangeScheduledMaintenanceState", id, {
      stateId: toId(states[0]!["_id"]),
    }),
  );
  const timeline: Array<Record<string, unknown>> = await listItems({
    page,
    projectId,
    path: "/api/scheduled-maintenance-state-timeline",
    query: {
      projectId,
      scheduledMaintenanceId: id,
      scheduledMaintenanceStateId: states[0]!["_id"],
    },
    select: { _id: true, createdByUserId: true },
  });
  expect(
    timeline.every((entry: Record<string, unknown>): boolean => {
      return toId(entry["createdByUserId"]) === actorId;
    }),
  ).toBe(true);
});

["private", "public"].forEach((noteType: string): void => {
  test(`maintenance ${noteType} note modal and replay write once`, async (): Promise<void> => {
    const id: string = await maintenance();
    expect(
      (await send(payload("ViewAddScheduledMaintenanceNote", id)))["type"],
    ).toBe(9);
    const body: string = payload("SubmitScheduledMaintenanceNote", id, {
      noteType,
      note: "Operations note <@everyone>",
    });
    await complete(body);
    await complete(body);
    const rows: Array<Record<string, unknown>> = await listItems({
      page,
      projectId,
      path: `/api/scheduled-maintenance-${noteType === "public" ? "public" : "internal"}-note`,
      query: { projectId, scheduledMaintenanceId: id },
      select: { _id: true, note: true, createdByUserId: true },
    });
    expect(rows).toHaveLength(1);
    expect(toId(rows[0]!["createdByUserId"])).toBe(actorId);
    expect(rows[0]!["note"]).toBe("Operations note <@everyone>");
  });
});

test("monitor enable and disable persist through signed components", async (): Promise<void> => {
  const row: Record<string, unknown> = await createItem({
    page,
    projectId,
    path: "/api/monitor",
    item: {
      projectId,
      name: `Discord monitor ${Date.now()}`,
      monitorType: "Manual",
      disableActiveMonitoring: false,
    },
  });
  const id: string = toId(row["_id"]);
  resources.push({ path: "/api/monitor", id });
  for (const [action, disabled] of [
    ["DisableMonitor", true],
    ["EnableMonitor", false],
  ] as const) {
    await complete(payload(action, id));
    const updated: Record<string, unknown> = await getItem({
      page,
      projectId,
      path: "/api/monitor",
      id,
      select: { disableActiveMonitoring: true },
    });
    expect(updated["disableActiveMonitoring"]).toBe(disabled);
  }
});
