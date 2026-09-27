import {
  APIResponse,
  BrowserContext,
  Browser,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomBytes, sign } from "node:crypto";
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

// Authored before HOM-40. See RESPONDER_FAILURES.md for refusal and replay gates.
const app: string = `http://${process.env["HOST"] || "oneuptime.test:7849"}`;
let context: BrowserContext;
let page: Page;
let projectId: string;
let actorId: string;
const resources: Array<{ path: string; id: string }> = [];

interface Family {
  name: string;
  path: string;
  idField: string;
  statePath: string;
  stateField: string;
  severityPath: string;
  severityField: string;
  publicNotes: boolean;
}

const families: Array<Family> = [
  {
    name: "Incident",
    path: "incident",
    idField: "incidentId",
    statePath: "incident-state",
    stateField: "currentIncidentStateId",
    severityPath: "incident-severity",
    severityField: "incidentSeverityId",
    publicNotes: true,
  },
  {
    name: "Alert",
    path: "alert",
    idField: "alertId",
    statePath: "alert-state",
    stateField: "currentAlertStateId",
    severityPath: "alert-severity",
    severityField: "alertSeverityId",
    publicNotes: false,
  },
  {
    name: "IncidentEpisode",
    path: "incident-episode",
    idField: "incidentEpisodeId",
    statePath: "incident-state",
    stateField: "currentIncidentStateId",
    severityPath: "incident-severity",
    severityField: "incidentSeverityId",
    publicNotes: true,
  },
  {
    name: "AlertEpisode",
    path: "alert-episode",
    idField: "alertEpisodeId",
    statePath: "alert-state",
    stateField: "currentAlertStateId",
    severityPath: "alert-severity",
    severityField: "alertSeverityId",
    publicNotes: false,
  },
];

async function fixtureState(): Promise<Record<string, unknown>> {
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
  const interactionId: string = (
    BigInt(`0x${randomBytes(8).toString("hex")}`) + BigInt("100000000000000000")
  ).toString();
  return JSON.stringify({
    id: interactionId,
    token: `fixture-interaction-${interactionId}`,
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

async function interactionMessageCount(): Promise<number> {
  const state: Record<string, unknown> = await fixtureState();
  const messages: Array<Record<string, unknown>> = state[
    "postedMessages"
  ] as Array<Record<string, unknown>>;
  return messages.filter((message: Record<string, unknown>): boolean => {
    return message["webhook_kind"] === "interaction";
  }).length;
}

async function post(
  body: string,
  waitForCompletion: boolean = true,
): Promise<APIResponse> {
  const path: string | undefined = process.env["DISCORD_FIXTURE_SIGNING_KEY"];
  if (!path) {
    throw new Error("Disposable interaction signing key required");
  }
  const timestamp: string = Math.floor(Date.now() / 1000).toString();
  const before: number = waitForCompletion
    ? await interactionMessageCount()
    : 0;
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
          readFileSync(path),
        ).toString("hex"),
      },
    },
  );
  if (waitForCompletion && response.ok()) {
    const acknowledgment: { type?: number } = (await response.json()) as {
      type?: number;
    };
    if (acknowledgment.type === 5 || acknowledgment.type === 6) {
      // Wait for completion before checking a refusal's persistent effects.
      await expect.poll(interactionMessageCount).toBeGreaterThan(before);
    }
  }
  return response;
}

async function waitForTerminalReplay(
  body: string,
  expectedContent?: string,
): Promise<void> {
  if (!expectedContent) {
    const state: Record<string, unknown> = await fixtureState();
    const messages: Array<Record<string, unknown>> = (
      state["postedMessages"] as Array<Record<string, unknown>>
    ).filter((message: Record<string, unknown>): boolean => {
      return message["webhook_kind"] === "interaction";
    });
    expectedContent = String(messages[messages.length - 1]?.["content"] || "");
    expect(expectedContent).not.toBe("");
  }
  await expect
    .poll(async (): Promise<string> => {
      const response: APIResponse = await post(body, false);
      expect(response.status()).toBe(200);
      const replay: { type?: number; data?: { content?: string } } =
        (await response.json()) as {
          type?: number;
          data?: { content?: string };
        };
      return replay.type === 4 ? replay.data?.content || "" : "";
    })
    .toBe(expectedContent);
}

async function createResource(family: Family): Promise<string> {
  const severities: Array<Record<string, unknown>> = await listItems({
    page,
    projectId,
    path: `/api/${family.severityPath}`,
    select: { _id: true },
    query: { projectId },
  });
  expect(severities.length).toBeGreaterThan(0);
  const row: Record<string, unknown> = await createItem({
    page,
    projectId,
    path: `/api/${family.path}`,
    item: {
      projectId,
      title: `Discord ${family.name} parity ${Date.now()}`,
      description: "Signed responder acceptance",
      [family.severityField]: severities[0]!["_id"],
    },
  });
  const id: string = toId(row["_id"]);
  expect(id).toBeTruthy();
  resources.push({ path: `/api/${family.path}`, id });
  return id;
}

async function stateId(family: Family, id: string): Promise<string> {
  const row: Record<string, unknown> = await getItem({
    page,
    projectId,
    path: `/api/${family.path}`,
    id,
    select: { [family.stateField]: true },
  });
  return toId(row[family.stateField]);
}

async function notes(
  family: Family,
  id: string,
  visibility: string,
): Promise<Array<Record<string, unknown>>> {
  return listItems({
    page,
    projectId,
    path: `/api/${family.path}-${visibility === "public" ? "public" : "internal"}-note`,
    query: { projectId, [family.idField]: id },
    select: { _id: true, note: true, createdByUserId: true },
  });
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(180000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord responder parity",
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
  const linked: Array<Record<string, unknown>> = await listItems({
    page,
    projectId,
    path: "/api/workspace-user-auth-token",
    query: { projectId, workspaceType: "Discord" },
    select: { _id: true },
  });
  expect(linked).toHaveLength(1);
});

test.afterEach(
  async (
    { browser: _browser }: { browser: Browser },
    testInfo: TestInfo,
  ): Promise<void> => {
    await testInfo.attach("discord-provider", {
      body: JSON.stringify(await fixtureState()),
      contentType: "application/json",
    });
    await testInfo.attach("dashboard", {
      body: await page.screenshot(),
      contentType: "image/png",
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

families.forEach((family: Family): void => {
  test(`${family.name}: acknowledge and resolve persist`, async (): Promise<void> => {
    const id: string = await createResource(family);
    for (const [action, flag] of [
      ["Acknowledge", "isAcknowledgedState"],
      ["Resolve", "isResolvedState"],
    ]) {
      const expected: Array<Record<string, unknown>> = await listItems({
        page,
        projectId,
        path: `/api/${family.statePath}`,
        query: { projectId, [flag!]: true },
        select: { _id: true },
      });
      expect(expected).toHaveLength(1);
      expect(
        (await post(payload(`${action}${family.name}`, id))).status(),
      ).toBe(200);
      await expect
        .poll(async (): Promise<string> => {
          return stateId(family, id);
        })
        .toBe(toId(expected[0]!["_id"]));
    }
  });

  (family.publicNotes ? ["private", "public"] : ["private"]).forEach(
    (visibility: string): void => {
      test(`${family.name}: ${visibility} note modal persists once on replay`, async ({
        browser: _browser,
      }: {
        browser: Browser;
      }, testInfo: TestInfo): Promise<void> => {
        const id: string = await createResource(family);
        const open: APIResponse = await post(
          payload(`ViewAdd${family.name}Note`, id),
        );
        expect(open.status()).toBe(200);
        const form: Record<string, unknown> = (await open.json()) as Record<
          string,
          unknown
        >;
        expect(form["type"], "Opening the note form must return a modal").toBe(
          9,
        );
        expect(await notes(family, id, visibility)).toHaveLength(0);
        const text: string = `**${visibility}** @everyone <@12345678901234567>\nLiteral text.`;
        const body: string = payload(`Submit${family.name}Note`, id, {
          ...(family.publicNotes ? { noteType: visibility } : {}),
          note: text,
        });
        expect((await post(body)).status()).toBe(200);
        await waitForTerminalReplay(
          body,
          `${visibility === "public" ? "Public" : "Private"} note added.`,
        );
        await expect
          .poll(async (): Promise<number> => {
            return (await notes(family, id, visibility)).length;
          })
          .toBe(1);
        const saved: Array<Record<string, unknown>> = await notes(
          family,
          id,
          visibility,
        );
        expect(saved[0]!["note"]).toBe(text);
        expect(toId(saved[0]!["createdByUserId"])).toBe(actorId);
        if (family.publicNotes) {
          expect(
            await notes(
              family,
              id,
              visibility === "public" ? "private" : "public",
            ),
          ).toHaveLength(0);
        }
        await testInfo.attach("persisted-note", {
          body: JSON.stringify(saved),
          contentType: "application/json",
        });
      });
    },
  );

  test(`${family.name}: custom state is validated and preserves actor`, async ({
    browser: _browser,
  }: {
    browser: Browser;
  }, testInfo: TestInfo): Promise<void> => {
    const id: string = await createResource(family);
    const choices: Array<Record<string, unknown>> = await listItems({
      page,
      projectId,
      path: `/api/${family.statePath}`,
      query: { projectId, isResolvedState: true },
      select: { _id: true },
    });
    const next: string = toId(choices[0]!["_id"]);
    expect(
      (
        await post(
          payload(`SubmitChange${family.name}State`, id, { stateId: next }),
        )
      ).status(),
    ).toBe(200);
    await expect
      .poll(async (): Promise<string> => {
        return stateId(family, id);
      })
      .toBe(next);
    const timeline: Array<Record<string, unknown>> = await listItems({
      page,
      projectId,
      path: `/api/${family.path}-state-timeline`,
      query: {
        projectId,
        [family.idField]: id,
        [family.statePath === "incident-state"
          ? "incidentStateId"
          : "alertStateId"]: next,
      },
      select: { _id: true, createdByUserId: true },
    });
    expect(timeline).toHaveLength(1);
    await testInfo.attach("persisted-state-actor", {
      body: JSON.stringify({ actorId, timeline }),
      contentType: "application/json",
    });
    expect(toId(timeline[0]!["createdByUserId"])).toBe(actorId);
    expect(
      (
        await post(
          payload(`SubmitChange${family.name}State`, id, {
            stateId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          }),
        )
      ).status(),
    ).toBe(200);
    expect(await stateId(family, id)).toBe(next);
  });

  test(`${family.name}: on-call execution preserves trigger and deduplicates replay`, async ({
    browser: _browser,
  }: {
    browser: Browser;
  }, testInfo: TestInfo): Promise<void> => {
    const id: string = await createResource(family);
    const policy: Record<string, unknown> = await createItem({
      page,
      projectId,
      path: "/api/on-call-duty-policy",
      item: { projectId, name: `Discord ${family.name} policy ${Date.now()}` },
    });
    const policyId: string = toId(policy["_id"]);
    resources.push({ path: "/api/on-call-duty-policy", id: policyId });
    const body: string = payload(
      `SubmitExecute${family.name}OnCallPolicy`,
      id,
      {
        onCallPolicyId: policyId,
      },
    );
    expect((await post(body)).status()).toBe(200);
    await waitForTerminalReplay(body, "On-call policy executed.");
    const readExecutions: () => Promise<
      Array<Record<string, unknown>>
    > = async (): Promise<Array<Record<string, unknown>>> => {
      return listItems({
        page,
        projectId,
        path: "/api/on-call-duty-policy-execution-log",
        query: { projectId, onCallDutyPolicyId: policyId },
        select: {
          _id: true,
          [`triggeredBy${family.name}Id`]: true,
          userNotificationEventType: true,
        },
      });
    };
    await expect
      .poll(async (): Promise<number> => {
        return (await readExecutions()).length;
      })
      .toBe(1);
    const executions: Array<Record<string, unknown>> = await readExecutions();
    expect(toId(executions[0]![`triggeredBy${family.name}Id`])).toBe(id);
    expect(executions[0]!["userNotificationEventType"]).toBe(
      `${family.name.replace("Episode", " Episode")} Created`,
    );
    await testInfo.attach("persisted-policy-execution", {
      body: JSON.stringify(executions),
      contentType: "application/json",
    });
  });

  test(`${family.name}: missing policy and blank note produce no rows`, async (): Promise<void> => {
    const id: string = await createResource(family);
    const blankNote: string = payload(`Submit${family.name}Note`, id, {
      noteType: "private",
      note: " ",
    });
    expect((await post(blankNote)).status()).toBe(200);
    await waitForTerminalReplay(blankNote);
    const missingPolicy: string = payload(
      `SubmitExecute${family.name}OnCallPolicy`,
      id,
      {
        onCallPolicyId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
    );
    expect((await post(missingPolicy)).status()).toBe(200);
    await waitForTerminalReplay(missingPolicy);
    expect(await notes(family, id, "private")).toHaveLength(0);
    const executions: Array<Record<string, unknown>> = await listItems({
      page,
      projectId,
      path: "/api/on-call-duty-policy-execution-log",
      query: { projectId, [`triggeredBy${family.name}Id`]: id },
      select: { _id: true },
    });
    expect(executions).toHaveLength(0);
  });
});
