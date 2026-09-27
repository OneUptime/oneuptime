import {
  APIResponse,
  Browser,
  BrowserContext,
  Cookie,
  Page,
  PlaywrightTestArgs,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  createItem,
  deleteItem,
  listItems,
  toId,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import identities from "./Fixture/identities.json";

/*
 * HOM-42 (test-first): durable resource thread ownership and crash-safe
 * lifecycle. Written before the implementation; every test here fails on
 * base 4e1b7a424e because the ownership model, the reconcile endpoint and
 * the archive/reopen PATCH routes do not exist yet.
 *
 * Failure inventory F1..F15 (F16..F24 on the tests themselves) lives in
 * ~/.buzz/PLANS/HOM42_DISCORD_THREAD_LIFECYCLE.md. Each test names the rows
 * it covers. Fixture control operations used here and owned by HOM-47:
 *
 *   POST /__fixture/scenario {scenario}   thread-create-timeout | thread-create-500
 *                                         | thread-create-accepted-500 (thread and
 *                                         audit reason stored, then HTTP 500)
 *                                         | thread-create-slow[:ms] | audit-log-forbidden
 *                                         | channel-get-slow:<ms> | channel-patch-slow:<ms>
 *   POST /__fixture/threads  {id, archived?, name?, deleted?, type?, owner_id?}
 *                            (creates the thread under the parent when unknown)
 *   GET  /__fixture/state                 createdThreads[] carry name, type,
 *                                         parent_id, thread_metadata.archived,
 *                                         audit_reason (X-Audit-Log-Reason)
 *
 * The provider endpoints the app must be able to call against the fixture:
 *   PATCH /channels/{thread} {archived, locked}
 *   GET   /channels/{thread}  -> thread_metadata, owner_id, parent_id
 *   GET   /guilds/{guild}/audit-logs?action_type=110
 *
 * New specs never call /api/discord/config (shared 600/60s setup window
 * owned by RateLimit.spec).
 */

const app: string = `http://${process.env["HOST"] || "oneuptime.test:7849"}`;
const projectTokens: string = "/api/workspace-project-auth-token";
const userTokens: string = "/api/workspace-user-auth-token";
const rulesPath: string = "/api/workspace-notification-rule";
const threadsPath: string = "/api/discord-resource-thread";
const timelinePath: string = "/api/incident-state-timeline";

interface Binding {
  _id: string;
  workspaceProjectId?: string;
  workspaceUserId?: string;
  miscData?: { incidentChannelId?: string };
}
interface FixtureThread {
  id: string;
  name: string;
  type: number;
  parent_id: string;
  thread_metadata?: { archived?: boolean; locked?: boolean };
  audit_reason?: string;
}
interface ProviderEvent {
  method: string;
  path: string;
  // null while the fixture is still answering the request
  status: number | null;
}
interface PostedMessage {
  channel_id?: string;
  content?: string;
}
interface ProviderState {
  events: Array<ProviderEvent>;
  unhandled: Array<string>;
  postedMessages: Array<PostedMessage>;
  createdThreads: Array<FixtureThread>;
}
interface OwnershipRow {
  _id: string;
  resourceType?: string;
  resourceId?: string;
  notificationRuleId?: string;
  installationId?: string;
  installationVersion?: number;
  guildId?: string;
  parentChannelId?: string;
  threadId?: string | null;
  isPrivate?: boolean;
  state?: string;
  operationKey?: string;
  failureReason?: string | null;
}
interface IncidentRow {
  _id: string;
  currentIncidentStateId?: string;
}

let context: BrowserContext;
let page: Page;
let projectId: string;
/*
 * Rules created by the running test; removed in afterEach so no later
 * one-thread case inherits an extra template (HOM-47 isolation finding).
 */
let createdRules: Array<{ id: string; project: string }> = [];
let incidentSeverityId: string | undefined;
const stateIds: { resolved?: string; acknowledged?: string } = {};

const headers: (project?: string) => Record<string, string> = (
  project: string = projectId,
): Record<string, string> => {
  return { tenantid: project, projectid: project };
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

async function scenario(name: string): Promise<void> {
  await fixture("scenario", { scenario: name });
}

// A definite rejection: 403 before anything is created (fixture fault seed).
async function rejectNextCreate(): Promise<void> {
  await fixture("seed", {
    fault: {
      method: "POST",
      path: `/channels/${identities.channelId}/threads`,
      status: 403,
      remaining: 1,
    },
  });
}

async function bindings(
  path: string,
  project: string = projectId,
): Promise<Array<Binding>> {
  return (await listItems({
    page,
    projectId: project,
    path,
    query: { projectId: project, workspaceType: "Discord" },
    select: {
      _id: true,
      ...(path === projectTokens
        ? { workspaceProjectId: true }
        : { workspaceUserId: true }),
      miscData: true,
    },
  })) as Array<Binding>;
}

async function clearBindings(project: string = projectId): Promise<void> {
  for (const path of [userTokens, projectTokens]) {
    for (const row of await bindings(path, project)) {
      await deleteItem({ page, projectId: project, path, id: row._id });
    }
  }
}

// Verified user link, so an owner invite resolves a Discord user id.
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
    .poll(async (): Promise<number> => {
      return (await bindings(userTokens)).length;
    })
    .toBe(1);
}

async function currentUserId(): Promise<string> {
  const raw: string =
    (await context.cookies()).find((cookie: Cookie): boolean => {
      return cookie.name === "user-id";
    })?.value || "";
  try {
    return JSON.parse(decodeURIComponent(raw)) as string;
  } catch {
    return decodeURIComponent(raw);
  }
}

async function install(project: string = projectId): Promise<Binding> {
  const response: APIResponse = await page.request.get(url("install-url"), {
    headers: headers(project),
  });
  expect(response.status(), "Install initiation must exist").toBe(200);
  const body: { authorizationUrl: string } = (await response.json()) as {
    authorizationUrl: string;
  };
  await page.goto(body.authorizationUrl);
  await expect
    .poll(async (): Promise<number> => {
      return (await bindings(projectTokens, project)).length;
    })
    .toBe(1);
  const row: Binding = (await bindings(projectTokens, project))[0]!;
  expect(row.workspaceProjectId).toBe(identities.guildId);
  return row;
}

async function setIncidentChannel(
  channelId: string,
  project: string = projectId,
): Promise<void> {
  const response: APIResponse = await page.request.put(
    url("incident-channel"),
    { headers: headers(project), data: { channelId } },
  );
  expect(response.ok(), "Setting the incident channel must succeed").toBe(true);
}

async function createRule(data: {
  name: string;
  template?: string;
  archive?: boolean;
  project?: string;
  // Also post to this existing channel by name (an intentional destination).
  existing?: string;
  // Invite incident owners into the thread (the membership path).
  inviteOwners?: boolean;
}): Promise<string> {
  const project: string = data.project || projectId;
  const created: unknown = await createItem({
    page,
    projectId: project,
    path: rulesPath,
    item: {
      projectId: project,
      name: data.name,
      description: "HOM-42 E2E rule",
      workspaceType: "Discord",
      eventType: "Incident",
      notificationRule: {
        _type: "IncidentNotificationRule",
        filterCondition: "and",
        filters: [],
        shouldPostToExistingChannel: Boolean(data.existing),
        existingChannelNames: data.existing || "",
        shouldCreateNewChannel: true,
        newChannelTemplateName: data.template || "Incident",
        teamToCreateChannelIn: undefined,
        inviteTeamsToNewChannel: [],
        inviteUsersToNewChannel: [],
        shouldInviteOwnersToNewChannel: data.inviteOwners === true,
        shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
        archiveChannelAutomatically: data.archive === true,
      },
    },
  });
  const ruleId: string = toId((created as { _id?: unknown })._id);
  expect(ruleId, "Rule creation must return an id").toBeTruthy();
  createdRules.push({ id: ruleId, project });
  return ruleId;
}

/*
 * A second project for the user who is already signed in. The onboarding
 * helper re-registers through /accounts/register, which the app bounces to
 * the dashboard for a live session (hom42-f32-runtime-01 timed out there).
 * This is the same create the project picker's modal sends.
 */
async function createSecondProject(prefix: string): Promise<string> {
  const response: APIResponse = await page.request.post(`${app}/api/project`, {
    headers: {
      "content-type": "application/json",
      "is-multi-tenant-query": "true",
    },
    data: { data: { name: `${prefix} ${Date.now()}` } },
  });
  expect(
    response.ok(),
    `POST /api/project failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  const created: { _id?: unknown; data?: { _id?: unknown } } =
    (await response.json()) as { _id?: unknown; data?: { _id?: unknown } };
  const id: string = toId(created._id ?? created.data?._id);
  expect(id, "Project creation must return an id").toBeTruthy();
  return id;
}

async function severity(project: string = projectId): Promise<string> {
  if (incidentSeverityId && project === projectId) {
    return incidentSeverityId;
  }
  const severities: Array<{ _id: string }> = (await listItems({
    page,
    projectId: project,
    path: "/api/incident-severity",
    query: { projectId: project },
    select: { _id: true },
  })) as Array<{ _id: string }>;
  expect(
    severities.length,
    "Project needs an incident severity",
  ).toBeGreaterThan(0);
  if (project === projectId) {
    incidentSeverityId = severities[0]!._id;
  }
  return severities[0]!._id;
}

async function createIncident(data: {
  title: string;
  isPrivate?: boolean;
  project?: string;
}): Promise<IncidentRow> {
  const project: string = data.project || projectId;
  const row: unknown = await createItem({
    page,
    projectId: project,
    path: "/api/incident",
    item: {
      projectId: project,
      title: data.title,
      incidentSeverityId: await severity(project),
      description: "HOM-42 E2E incident",
      ...(data.isPrivate ? { isPrivate: true } : {}),
    },
  });
  const incident: IncidentRow = row as IncidentRow;
  expect(incident._id, "Incident creation must return an id").toBeTruthy();
  return incident;
}

async function incidentNumber(incidentId: string): Promise<number> {
  const found: Array<{ incidentNumber?: number }> = (await listItems({
    page,
    projectId,
    path: "/api/incident",
    query: { projectId, _id: incidentId },
    select: { incidentNumber: true },
  })) as Array<{ incidentNumber?: number }>;
  const number: number = Number(found[0]?.incidentNumber);
  expect(number, "Incident must carry its project counter").toBeGreaterThan(0);
  return number;
}

async function stateId(kind: "resolved" | "acknowledged"): Promise<string> {
  if (stateIds[kind]) {
    return stateIds[kind]!;
  }
  const rows: Array<{
    _id: string;
    isResolvedState?: boolean;
    isAcknowledgedState?: boolean;
  }> = (await listItems({
    page,
    projectId,
    path: "/api/incident-state",
    query: { projectId },
    select: { _id: true, isResolvedState: true, isAcknowledgedState: true },
  })) as Array<{
    _id: string;
    isResolvedState?: boolean;
    isAcknowledgedState?: boolean;
  }>;
  const match: { _id: string } | undefined = rows.find(
    (row: {
      isResolvedState?: boolean;
      isAcknowledgedState?: boolean;
    }): boolean => {
      return kind === "resolved"
        ? row.isResolvedState === true
        : row.isAcknowledgedState === true;
    },
  );
  expect(match, `Project needs a ${kind} incident state`).toBeTruthy();
  stateIds[kind] = match!._id;
  return match!._id;
}

async function changeState(
  incidentId: string,
  kind: "resolved" | "acknowledged",
): Promise<void> {
  await createItem({
    page,
    projectId,
    path: timelinePath,
    item: { projectId, incidentId, incidentStateId: await stateId(kind) },
  });
}

interface TimelineEntry {
  _id: string;
  incidentStateId?: string;
}

async function timelineEntries(
  incidentId: string,
): Promise<Array<TimelineEntry>> {
  return (await listItems({
    page,
    projectId,
    path: timelinePath,
    query: { projectId, incidentId },
    select: { _id: true, incidentStateId: true },
  })) as Array<TimelineEntry>;
}

async function timelineEntry(
  incidentId: string,
  kind: "resolved" | "acknowledged",
): Promise<TimelineEntry> {
  const wanted: string = await stateId(kind);
  const entry: TimelineEntry | undefined = (
    await timelineEntries(incidentId)
  ).find((row: TimelineEntry): boolean => {
    return toId(row.incidentStateId) === wanted;
  });
  expect(entry, `Incident needs a ${kind} timeline entry`).toBeTruthy();
  return entry!;
}

/*
 * The product refuses any timeline entry whose state sits before the
 * current one, so an incident cannot be moved back out of Resolved. The
 * only way it leaves that state is deleting the Resolved entry, which the
 * timeline page offers; the previous entry becomes current again.
 */
async function reopen(incidentId: string): Promise<void> {
  await deleteItem({
    page,
    projectId,
    path: timelinePath,
    id: (await timelineEntry(incidentId, "resolved"))._id,
  });
}

async function rows(incidentId: string): Promise<Array<OwnershipRow>> {
  return (await listItems({
    page,
    projectId,
    path: threadsPath,
    query: { projectId, resourceType: "incident", resourceId: incidentId },
    select: {
      _id: true,
      resourceType: true,
      resourceId: true,
      notificationRuleId: true,
      installationId: true,
      installationVersion: true,
      guildId: true,
      parentChannelId: true,
      threadId: true,
      isPrivate: true,
      state: true,
      operationKey: true,
      failureReason: true,
    },
  })) as Array<OwnershipRow>;
}

async function waitForRowState(
  incidentId: string,
  state: string,
  timeout: number = 30_000,
): Promise<OwnershipRow> {
  await expect
    .poll(
      async (): Promise<string | undefined> => {
        return (await rows(incidentId))[0]?.state;
      },
      { timeout },
    )
    .toBe(state);
  return (await rows(incidentId))[0]!;
}

async function reconcile(
  rowId: string,
  body: { threadId?: string; recreate?: boolean },
): Promise<APIResponse> {
  return await page.request.post(url(`resource-thread/${rowId}/reconcile`), {
    headers: headers(),
    data: body,
  });
}

function threadPosts(state: ProviderState): number {
  return state.events.filter((event: ProviderEvent): boolean => {
    return (
      event.method === "POST" &&
      event.path.endsWith(`/channels/${identities.channelId}/threads`)
    );
  }).length;
}

function archivePatches(state: ProviderState, threadId: string): number {
  return state.events.filter((event: ProviderEvent): boolean => {
    return (
      event.method === "PATCH" && event.path.endsWith(`/channels/${threadId}`)
    );
  }).length;
}

function posts(state: ProviderState, channelId: string): number {
  return state.postedMessages.filter((m: PostedMessage): boolean => {
    return m.channel_id === channelId;
  }).length;
}

/*
 * The fixture records the raw request path, `/api/v10/channels/...`, so
 * every path match here is on the tail, never on a bare `/channels/` prefix
 * (hom42-f32-runtime-01: three invite cases counted zero writes that the app
 * log showed being made).
 */
function memberWrites(state: ProviderState, threadId: string): number {
  return state.events.filter((event: ProviderEvent): boolean => {
    return (
      event.method === "PUT" &&
      event.path.includes(`/channels/${threadId}/thread-members/`)
    );
  }).length;
}

// GET /channels/{thread} requests, split by whether the fixture answered yet.
function channelGets(
  state: ProviderState,
  threadId: string,
  finished: boolean,
): number {
  return state.events.filter((event: ProviderEvent): boolean => {
    return (
      event.method === "GET" &&
      event.path.endsWith(`/channels/${threadId}`) &&
      (event.status !== null) === finished
    );
  }).length;
}

/*
 * The resource cache (postUpdatesToWorkspaceChannels) is not readable
 * through the API, so its contents are asserted through what it drives: a
 * state change posts into every cached thread and nowhere else.
 */
async function waitForPost(threadId: string, above: number): Promise<void> {
  await expect
    .poll(
      async (): Promise<number> => {
        return posts(await fixture("state"), threadId);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(above);
}

async function waitForThreadPosts(count: number): Promise<void> {
  await expect
    .poll(
      async (): Promise<number> => {
        return threadPosts(await fixture("state"));
      },
      {
        timeout: 30_000,
      },
    )
    .toBe(count);
}

/*
 * Fire the owner-invite path for the current user. The creator is already
 * an owner of a new incident, and a second owner row is rejected, so the
 * existing row is removed first (removal invites nobody) and re-added.
 */
async function reAddOwner(incidentId: string): Promise<void> {
  const userId: string = await currentUserId();
  const existing: Array<{ _id: string }> = (await listItems({
    page,
    projectId,
    path: "/api/incident-owner-user",
    query: { projectId, incidentId, userId },
    select: { _id: true },
  })) as Array<{ _id: string }>;
  for (const row of existing) {
    await deleteItem({
      page,
      projectId,
      path: "/api/incident-owner-user",
      id: row._id,
    });
  }
  await createItem({
    page,
    projectId,
    path: "/api/incident-owner-user",
    item: { projectId, incidentId, userId },
  });
}

/*
 * Negative delivery check for a thread the resource must not be pointing
 * at. The rule also posts to the parent channel (existing: "incidents-e2e"),
 * so a state change landing there proves the update was processed; the
 * thread under test must have received nothing by then, plus a grace period
 * for a late fan-out.
 */
async function expectNoDelivery(
  incidentId: string,
  threadId: string,
  kind: "resolved" | "acknowledged" = "acknowledged",
): Promise<void> {
  let state: ProviderState = await fixture("state");
  const threadBefore: number = posts(state, threadId);
  const parentBefore: number = posts(state, identities.channelId);
  await changeState(incidentId, kind);
  await waitForPost(identities.channelId, parentBefore);
  await page.waitForTimeout(3_000);
  state = await fixture("state");
  expect(
    posts(state, threadId),
    `Nothing is delivered to the unowned thread ${threadId}`,
  ).toBe(threadBefore);
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(180000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord thread lifecycle E2E",
  });
});

test.beforeEach(async (): Promise<void> => {
  await clearBindings();
  await fixture("reset", {});
  await install();
  await setIncidentChannel(identities.channelId);
});

// Playwright requires destructured fixtures even when this hook uses only testInfo.
test.afterEach(
  // eslint-disable-next-line no-empty-pattern
  async ({}: PlaywrightTestArgs, testInfo: TestInfo): Promise<void> => {
    if (!page || !projectId) {
      return;
    }
    await testInfo.attach("provider-state", {
      body: JSON.stringify(await fixture("state"), null, 2),
      contentType: "application/json",
    });
    for (const rule of createdRules) {
      await deleteItem({
        page,
        projectId: rule.project,
        path: rulesPath,
        id: rule.id,
      });
    }
    createdRules = [];
  },
);

test.afterAll(async (): Promise<void> => {
  await context?.close();
});

/*
 * F14, F15: the binding is a database row keyed by resource, rule and
 * installation, and it carries the private flag. Surviving a restart is a
 * property of the row, so this asserts the row, not a container restart.
 */
test("thread creation persists a durable ownership row", async (): Promise<void> => {
  const ruleId: string = await createRule({ name: "durable" });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 durable",
    isPrivate: true,
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  const state: ProviderState = await fixture("state");
  const thread: FixtureThread = state.createdThreads[0]!;
  expect(threadPosts(state)).toBe(1);
  expect(row.threadId).toBe(thread.id);
  expect(row.notificationRuleId && toId(row.notificationRuleId)).toBe(ruleId);
  expect(row.guildId).toBe(identities.guildId);
  expect(row.parentChannelId).toBe(identities.channelId);
  expect(row.isPrivate).toBe(true);
  expect(thread.type, "Private incident must create a private thread").toBe(12);
  const installation: Binding = (await bindings(projectTokens))[0]!;
  expect(row.installationId && toId(row.installationId)).toBe(installation._id);
  expect(typeof row.installationVersion).toBe("number");
  // Opaque operation id, never a title or user field.
  expect(row.operationKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(thread.audit_reason).toBe(`oneuptime:${row.operationKey}`);
  // The resource cache still points at the thread: an update reaches it.
  const before: number = posts(state, thread.id);
  await changeState(incident._id, "acknowledged");
  await waitForPost(thread.id, before);
  expect(threadPosts(await fixture("state"))).toBe(1);
});

// F2, F3 handled with two rules here and two projects below.
test("two rules with one template share a thread; different templates get their own", async (): Promise<void> => {
  await createRule({ name: "shared-a", template: "Incident" });
  await createRule({ name: "shared-b", template: "Incident" });
  const shared: IncidentRow = await createIncident({ title: "HOM-42 shared" });
  await waitForRowState(shared._id, "active");
  await page.waitForTimeout(5_000);
  expect(threadPosts(await fixture("state"))).toBe(1);
  expect((await rows(shared._id)).length).toBe(1);

  await fixture("reset", {});
  await createRule({ name: "distinct", template: "War-room" });
  const distinct: IncidentRow = await createIncident({
    title: "HOM-42 distinct",
  });
  await waitForThreadPosts(2);
  await expect
    .poll(async (): Promise<number> => {
      return (await rows(distinct._id)).length;
    })
    .toBe(2);
  const states: Array<string | undefined> = (await rows(distinct._id)).map(
    (row: OwnershipRow): string | undefined => {
      return row.state;
    },
  );
  expect(states).toEqual(["active", "active"]);
});

/*
 * F6 + F5: the create is accepted remotely but the app never sees the answer.
 * The row must record ambiguity, nothing may retry, and the audit reason is
 * the only correlation that adopts the thread.
 */
test("ambiguous create is never retried and is adopted through the audit log", async (): Promise<void> => {
  await createRule({ name: "timeout", existing: "incidents-e2e" });
  await scenario("thread-create-timeout");
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 timeout",
  });
  const row: OwnershipRow = await waitForRowState(
    incident._id,
    "ambiguous",
    45_000,
  );
  expect(row.threadId).toBeFalsy();
  await page.waitForTimeout(5_000);
  const during: ProviderState = await fixture("state");
  expect(threadPosts(during), "No blind retry after a timeout").toBe(1);
  expect(during.createdThreads.length).toBe(1);
  // The resource must not point at a thread nobody confirmed.
  await expectNoDelivery(incident._id, during.createdThreads[0]!.id);
  expect(threadPosts(await fixture("state")), "No retry on redelivery").toBe(1);

  await scenario("valid");
  const response: APIResponse = await reconcile(row._id, {});
  expect(response.ok(), "Audit-log reconciliation must succeed").toBe(true);
  const adopted: OwnershipRow = await waitForRowState(incident._id, "active");
  expect(adopted.threadId).toBe(during.createdThreads[0]!.id);
  expect(threadPosts(await fixture("state")), "Adoption creates nothing").toBe(
    1,
  );
  // Adoption filled the resource cache: an update now reaches the thread.
  const before: number = posts(await fixture("state"), adopted.threadId!);
  await changeState(incident._id, "resolved");
  await waitForPost(adopted.threadId!, before);
  expect(threadPosts(await fixture("state"))).toBe(1);
});

/*
 * Astra 2026-09-25: no time-window or name-based adoption. Without the audit
 * log the row stays ambiguous until an admin names the thread explicitly.
 */
test("without VIEW_AUDIT_LOG an ambiguous create stays ambiguous until explicit reconcile", async (): Promise<void> => {
  await createRule({ name: "forbidden" });
  await scenario("thread-create-timeout");
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 forbidden",
  });
  const row: OwnershipRow = await waitForRowState(
    incident._id,
    "ambiguous",
    45_000,
  );
  await scenario("audit-log-forbidden");
  const automatic: APIResponse = await reconcile(row._id, {});
  expect(automatic.status(), "No correlation means no adoption").toBe(409);
  expect((await rows(incident._id))[0]!.state).toBe("ambiguous");

  const bogus: APIResponse = await reconcile(row._id, {
    threadId: identities.foreignChannelId,
  });
  expect(bogus.status(), "A thread outside the parent is rejected").toBe(400);
  expect((await rows(incident._id))[0]!.state).toBe("ambiguous");

  const created: FixtureThread = (await fixture("state")).createdThreads[0]!;
  const explicit: APIResponse = await reconcile(row._id, {
    threadId: created.id,
  });
  expect(explicit.ok()).toBe(true);
  expect((await waitForRowState(incident._id, "active")).threadId).toBe(
    created.id,
  );
  expect(threadPosts(await fixture("state"))).toBe(1);
});

/*
 * F7 and F9: a definite failure is recorded; recreate works while the
 * incident is open and is refused once it is resolved.
 */
test("definite create failure is recorded, recreate honours resolution", async (): Promise<void> => {
  await createRule({ name: "failure" });
  await rejectNextCreate();
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 failure",
  });
  const failed: OwnershipRow = await waitForRowState(incident._id, "failed");
  expect(failed.threadId).toBeFalsy();
  expect(failed.failureReason).toContain("403");

  await scenario("valid");
  await changeState(incident._id, "resolved");
  await page.waitForTimeout(3_000);
  const refused: APIResponse = await reconcile(failed._id, { recreate: true });
  expect(refused.status(), "No thread for a resolved incident").toBe(409);
  const state: ProviderState = await fixture("state");
  expect(threadPosts(state)).toBe(1);
  expect(state.createdThreads.length).toBe(0);
  expect((await rows(incident._id))[0]!.state).toBe("failed");
});

// F1: two concurrent recreate calls race on the same claim; one POST.
test("concurrent recreate serializes to one thread", async (): Promise<void> => {
  await createRule({ name: "race" });
  await rejectNextCreate();
  const incident: IncidentRow = await createIncident({ title: "HOM-42 race" });
  const failed: OwnershipRow = await waitForRowState(incident._id, "failed");
  await scenario("thread-create-slow");
  const results: Array<APIResponse> = await Promise.all([
    reconcile(failed._id, { recreate: true }),
    reconcile(failed._id, { recreate: true }),
    reconcile(failed._id, { recreate: true }),
  ]);
  const okCount: number = results.filter((r: APIResponse): boolean => {
    return r.ok();
  }).length;
  expect(
    okCount,
    "Every caller gets the same outcome or a conflict",
  ).toBeGreaterThan(0);
  await waitForRowState(incident._id, "active");
  await page.waitForTimeout(5_000);
  const state: ProviderState = await fixture("state");
  expect(state.createdThreads.length, "Exactly one thread").toBe(1);
  expect((await rows(incident._id)).length).toBe(1);
});

/*
 * F8: resolution lands while the create is in flight. The thread exists, so
 * it is persisted as orphaned and archived; nothing is posted into it.
 */
test("resolution during an in-flight create orphans and archives the thread", async (): Promise<void> => {
  await createRule({ name: "orphan", archive: true });
  await scenario("thread-create-slow");
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 orphan",
  });
  await expect
    .poll(async (): Promise<number> => {
      return (await rows(incident._id)).length;
    })
    .toBe(1);
  await changeState(incident._id, "resolved");
  const orphaned: OwnershipRow = await waitForRowState(
    incident._id,
    "orphaned",
  );
  expect(orphaned.threadId).toBeTruthy();
  await scenario("valid");
  const reconciled: APIResponse = await reconcile(orphaned._id, {});
  expect(reconciled.ok()).toBe(true);
  await waitForRowState(incident._id, "archived");
  const state: ProviderState = await fixture("state");
  expect(archivePatches(state, orphaned.threadId!)).toBe(1);
  expect(
    state.postedMessages.filter((m: PostedMessage): boolean => {
      return m.channel_id === orphaned.threadId;
    }).length,
    "Nothing is posted into an orphaned thread",
  ).toBe(0);
});

/*
 * F10: a new installation generation appears while the create is in flight.
 * The remote thread exists, the row records it as stale, and it is not
 * attached to the resource under the new generation.
 */
test("create result from a previous installation generation is not attached", async (): Promise<void> => {
  await createRule({ name: "stale", existing: "incidents-e2e" });
  await scenario("thread-create-slow:8000");
  const incident: IncidentRow = await createIncident({ title: "HOM-42 stale" });
  await expect
    .poll(async (): Promise<number> => {
      return (await rows(incident._id)).length;
    })
    .toBe(1);
  const before: OwnershipRow = (await rows(incident._id))[0]!;
  await clearBindings();
  await install();
  await setIncidentChannel(identities.channelId);
  const stale: OwnershipRow = await waitForRowState(
    incident._id,
    "stale",
    45_000,
  );
  expect(stale.threadId).toBeTruthy();
  /*
   * The row keeps the generation it was claimed under, which is now behind
   * the live installation (same auth row id, version bumped by reinstall).
   */
  expect(stale.installationVersion).toBe(before.installationVersion);
  expect((await bindings(projectTokens)).length).toBe(1);
  expect(threadPosts(await fixture("state"))).toBe(1);
  // Not attached under the new generation: an update never reaches it.
  await expectNoDelivery(incident._id, stale.threadId!);
  expect(
    threadPosts(await fixture("state")),
    "No replacement thread on an update",
  ).toBe(1);
});

/*
 * F11: the thread is deleted in Discord. Later updates must not error or
 * create a replacement; the row becomes orphaned.
 */
test("remote thread deletion is detected and never replaced automatically", async (): Promise<void> => {
  await createRule({ name: "deleted" });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 deleted",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  // The creation post lands after the row turns active; let it arrive.
  await waitForPost(row.threadId!, 0);
  await fixture("threads", { id: row.threadId, deleted: true });
  await changeState(incident._id, "acknowledged");
  await waitForRowState(incident._id, "orphaned");
  await page.waitForTimeout(5_000);
  const state: ProviderState = await fixture("state");
  expect(threadPosts(state)).toBe(1);
  expect(
    state.postedMessages.filter((m: PostedMessage): boolean => {
      return m.channel_id === row.threadId;
    }).length,
    "Only the creation-time posts reached the thread",
  ).toBeGreaterThan(0);
});

// F4: a rename must not break delivery because identity is the thread id.
test("renamed thread still receives updates", async (): Promise<void> => {
  await createRule({ name: "rename" });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 rename",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  const before: number = (await fixture("state")).postedMessages.filter(
    (m: PostedMessage): boolean => {
      return m.channel_id === row.threadId;
    },
  ).length;
  await fixture("threads", { id: row.threadId, name: "renamed-by-a-human" });
  await changeState(incident._id, "acknowledged");
  await expect
    .poll(
      async (): Promise<number> => {
        return (await fixture("state")).postedMessages.filter(
          (m: PostedMessage): boolean => {
            return m.channel_id === row.threadId;
          },
        ).length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(before);
  expect(threadPosts(await fixture("state"))).toBe(1);
  expect((await rows(incident._id))[0]!.state).toBe("active");
});

/*
 * F12, F13, F15: archive on resolve, reopen on leaving the resolved state,
 * archive again; each transition is one PATCH and the private type persists.
 * Leaving Resolved means deleting its timeline entry (see reopen()); the
 * v14 run tried a backward state change the product refuses with a 400.
 */
test("archive, intentional reopen and re-archive are serialized and idempotent", async (): Promise<void> => {
  await createRule({ name: "reopen", archive: true });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 reopen",
    isPrivate: true,
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  await changeState(incident._id, "acknowledged");
  await changeState(incident._id, "resolved");
  await waitForRowState(incident._id, "archived");
  let state: ProviderState = await fixture("state");
  expect(archivePatches(state, row.threadId!)).toBe(1);
  expect(state.createdThreads[0]!.thread_metadata?.archived).toBe(true);

  await reopen(incident._id);
  await waitForRowState(incident._id, "active");
  state = await fixture("state");
  expect(archivePatches(state, row.threadId!)).toBe(2);
  expect(state.createdThreads[0]!.thread_metadata?.archived).toBe(false);
  expect(state.createdThreads[0]!.type, "Reopen keeps the private type").toBe(
    12,
  );

  await changeState(incident._id, "resolved");
  await waitForRowState(incident._id, "archived");
  await page.waitForTimeout(5_000);
  state = await fixture("state");
  expect(archivePatches(state, row.threadId!)).toBe(3);
  expect(threadPosts(state), "No new thread across the cycle").toBe(1);
});

// F3: two projects bound to the same guild and parent, same thread name.
test("same thread name in two projects never cross-delivers", async (): Promise<void> => {
  // Two installs and two incidents do not fit the 90 s default.
  test.setTimeout(180_000);
  await createRule({ name: "project-a" });
  const other: string = await createSecondProject(
    "Discord thread lifecycle E2E B",
  );
  await install(other);
  await setIncidentChannel(identities.channelId, other);
  await page.goto(`${app}/dashboard/${projectId}/home`);
  const a: IncidentRow = await createIncident({ title: "HOM-42 twin" });
  const rowA: OwnershipRow = await waitForRowState(a._id, "active");
  /*
   * The thread name is the rule template plus the incident number, and the
   * number is a per-project counter. This project has been creating
   * incidents all run while the new one starts at 1 (hom42-v13-runtime-01
   * saw "Incidentinc-13" against "Incidentinc-1"), so the second project
   * burns counter values until its next incident carries the same number.
   * No rule exists there yet, so the filler incidents create no thread.
   */
  const numberA: number = await incidentNumber(a._id);
  for (let n: number = 1; n < numberA; n++) {
    await createIncident({
      title: `HOM-42 counter filler ${n}`,
      project: other,
    });
  }
  await createRule({ name: "project-b", project: other });
  const b: IncidentRow = await createIncident({
    title: "HOM-42 twin",
    project: other,
  });
  await waitForThreadPosts(2);
  /*
   * The fixture sees the thread create before the ownership row leaves
   * "creating", so a one-shot read here can return threadId null and a
   * null-vs-A comparison passes vacuously (hom42-v13-compose-02). Poll the
   * second project's own row until it is active, then compare thread ids.
   */
  const rowsOf: () => Promise<Array<OwnershipRow>> = async (): Promise<
    Array<OwnershipRow>
  > => {
    return (await listItems({
      page,
      projectId: other,
      path: threadsPath,
      query: { projectId: other, resourceType: "incident", resourceId: b._id },
      select: { _id: true, threadId: true, state: true },
    })) as Array<OwnershipRow>;
  };
  await expect
    .poll(
      async (): Promise<string | undefined> => {
        return (await rowsOf())[0]?.state;
      },
      { timeout: 30_000 },
    )
    .toBe("active");
  const rowsB: Array<OwnershipRow> = await rowsOf();
  expect(rowsB.length).toBe(1);
  expect(
    rowsB[0]!.threadId,
    "Project B's row must hold its thread",
  ).toBeTruthy();
  expect(rowsB[0]!.threadId).not.toBe(rowA.threadId);
  const state: ProviderState = await fixture("state");
  expect(
    state.createdThreads.map((t: FixtureThread): string => {
      return t.name;
    }),
  ).toEqual([state.createdThreads[0]!.name, state.createdThreads[0]!.name]);
  /*
   * A post count is not a stable baseline here: waitForThreadPosts counts
   * thread creates, and each incident's own creation, state and owner posts
   * trail its thread by seconds (hom42-v13-runtime-red-01 saw 0 -> 2 in
   * project B's thread, both project B's own). Cross-delivery is a message
   * about one project's incident in the other project's thread, so that is
   * what is asserted, once project A's update has demonstrably been posted.
   */
  const threadB: string = rowsB[0]!.threadId!;
  const mentions: (
    state: ProviderState,
    threadId: string,
    incidentId: string,
  ) => Array<PostedMessage> = (
    state: ProviderState,
    threadId: string,
    incidentId: string,
  ): Array<PostedMessage> => {
    return state.postedMessages.filter((m: PostedMessage): boolean => {
      return (
        m.channel_id === threadId && (m.content ?? "").includes(incidentId)
      );
    });
  };
  await waitForPost(threadB, 0);
  await changeState(a._id, "acknowledged");
  await expect
    .poll(
      async (): Promise<number> => {
        return mentions(await fixture("state"), rowA.threadId!, a._id).filter(
          (m: PostedMessage): boolean => {
            return (m.content ?? "").includes("Acknowledged");
          },
        ).length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(5_000);
  const after: ProviderState = await fixture("state");
  expect(
    mentions(after, threadB, a._id),
    "Project A's update must not land in project B's thread",
  ).toEqual([]);
  expect(
    mentions(after, rowA.threadId!, b._id),
    "Project B's posts must not land in project A's thread",
  ).toEqual([]);
  expect(
    mentions(after, threadB, b._id).length,
    "Project B's thread carries its own incident",
  ).toBeGreaterThan(0);
});

/*
 * F16: any installation move makes existing rows stale on their next use.
 * Only an explicit reconcile re-stamps a row under the live generation.
 */
test("reconnect makes an active thread stale until explicitly reconciled", async (): Promise<void> => {
  await createRule({ name: "stale-reconnect" });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 reconnect",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  await clearBindings();
  await install();
  await setIncidentChannel(identities.channelId);
  const before: number = (await fixture("state")).postedMessages.filter(
    (m: PostedMessage): boolean => {
      return m.channel_id === row.threadId;
    },
  ).length;
  await changeState(incident._id, "acknowledged");
  await waitForRowState(incident._id, "stale");
  await page.waitForTimeout(5_000);
  let state: ProviderState = await fixture("state");
  expect(
    state.postedMessages.filter((m: PostedMessage): boolean => {
      return m.channel_id === row.threadId;
    }).length,
    "Nothing is posted into a thread from a previous generation",
  ).toBe(before);
  expect(threadPosts(state), "No replacement thread is created").toBe(1);

  const response: APIResponse = await reconcile(row._id, {
    threadId: row.threadId!,
  });
  expect(response.ok()).toBe(true);
  const active: OwnershipRow = await waitForRowState(incident._id, "active");
  expect(active.threadId).toBe(row.threadId);
  await changeState(incident._id, "resolved");
  await expect
    .poll(
      async (): Promise<number> => {
        return (await fixture("state")).postedMessages.filter(
          (m: PostedMessage): boolean => {
            return m.channel_id === row.threadId;
          },
        ).length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(before);
  state = await fixture("state");
  expect(threadPosts(state)).toBe(1);
});

/*
 * F17: disconnect lands while a manual adopt is between its GET and its
 * row write. The fence must refuse the write.
 */
test("disconnect during adoption leaves the row unchanged", async (): Promise<void> => {
  await createRule({ name: "disconnect-adopt", existing: "incidents-e2e" });
  await scenario("thread-create-timeout");
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 adopt race",
  });
  const row: OwnershipRow = await waitForRowState(
    incident._id,
    "ambiguous",
    45_000,
  );
  const created: FixtureThread = (await fixture("state")).createdThreads[0]!;
  await scenario("channel-get-slow:6000");
  const pending: Promise<APIResponse> = reconcile(row._id, {
    threadId: created.id,
  });
  await page.waitForTimeout(1_500);
  await clearBindings();
  const response: APIResponse = await pending;
  expect(response.status(), "Generation moved under the adopt").toBe(409);
  await scenario("valid");
  const after: OwnershipRow = (await rows(incident._id))[0]!;
  expect(after.state).toBe("ambiguous");
  expect(after.threadId).toBeFalsy();
  // Reconnected, the thread nobody confirmed still receives nothing.
  await install();
  await setIncidentChannel(identities.channelId);
  await expectNoDelivery(incident._id, created.id);
});

/*
 * F18, F19: manual adoption validates ownership, type, bot owner and
 * archive state, and never lets two rows own one thread.
 */
test("manual adoption rejects owned, foreign, wrong-type and archived threads", async (): Promise<void> => {
  await createRule({ name: "adopt-validate", archive: true });
  const owner: IncidentRow = await createIncident({
    title: "HOM-42 owner",
    isPrivate: true,
  });
  const ownerRow: OwnershipRow = await waitForRowState(owner._id, "active");

  await rejectNextCreate();
  const other: IncidentRow = await createIncident({ title: "HOM-42 claimant" });
  const failed: OwnershipRow = await waitForRowState(other._id, "failed");
  await scenario("valid");

  // Owned by another row.
  expect(
    (await reconcile(failed._id, { threadId: ownerRow.threadId! })).status(),
  ).toBe(400);
  // Wrong type: the claimant is public, the owner's thread is private.
  await fixture("threads", {
    id: identities.threadChannelId,
    type: 12,
    owner_id: identities.botId,
  });
  expect(
    (
      await reconcile(failed._id, { threadId: identities.threadChannelId })
    ).status(),
  ).toBe(400);
  // Not created by the bot.
  await fixture("threads", {
    id: identities.threadChannelId,
    type: 11,
    owner_id: identities.userId,
  });
  expect(
    (
      await reconcile(failed._id, { threadId: identities.threadChannelId })
    ).status(),
  ).toBe(400);
  // Archived thread for an active adoption.
  await fixture("threads", {
    id: identities.threadChannelId,
    type: 11,
    owner_id: identities.botId,
    archived: true,
  });
  expect(
    (
      await reconcile(failed._id, { threadId: identities.threadChannelId })
    ).status(),
  ).toBe(400);
  expect((await rows(other._id))[0]!.state).toBe("failed");
  expect((await rows(other._id))[0]!.threadId).toBeFalsy();
  // A matching unarchived bot thread is adopted.
  await fixture("threads", {
    id: identities.threadChannelId,
    type: 11,
    owner_id: identities.botId,
    archived: false,
  });
  expect(
    (
      await reconcile(failed._id, { threadId: identities.threadChannelId })
    ).ok(),
  ).toBe(true);
  expect((await waitForRowState(other._id, "active")).threadId).toBe(
    identities.threadChannelId,
  );
});

/*
 * F20: a resolve lands while a reopen is between its PATCH and its row
 * write. The resource is final, so the thread must end archived.
 */
test("resolve during reopen leaves the thread archived", async (): Promise<void> => {
  await createRule({ name: "reopen-race", archive: true });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 reopen race",
  });
  await waitForRowState(incident._id, "active");
  await changeState(incident._id, "acknowledged");
  await changeState(incident._id, "resolved");
  await waitForRowState(incident._id, "archived");
  await scenario("channel-patch-slow:6000");
  const pending: Promise<void> = reopen(incident._id);
  await page.waitForTimeout(1_500);
  await scenario("valid");
  await changeState(incident._id, "resolved");
  await pending;
  await page.waitForTimeout(8_000);
  const state: ProviderState = await fixture("state");
  expect((await rows(incident._id))[0]!.state).toBe("archived");
  expect(state.createdThreads[0]!.thread_metadata?.archived).toBe(true);
  expect(threadPosts(state)).toBe(1);
});

/*
 * F13 boundary: only a deletion that changes the effective state reopens.
 * Removing an older entry leaves the incident Resolved, so the thread stays
 * archived and no PATCH is sent.
 */
test("deleting an older timeline entry does not reopen the thread", async (): Promise<void> => {
  await createRule({ name: "reopen-older", archive: true });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 reopen older entry",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  await changeState(incident._id, "acknowledged");
  await changeState(incident._id, "resolved");
  await waitForRowState(incident._id, "archived");

  await deleteItem({
    page,
    projectId,
    path: timelinePath,
    id: (await timelineEntry(incident._id, "acknowledged"))._id,
  });
  await page.waitForTimeout(5_000);
  const state: ProviderState = await fixture("state");
  expect((await rows(incident._id))[0]!.state).toBe("archived");
  expect(archivePatches(state, row.threadId!)).toBe(1);
  expect(state.createdThreads[0]!.thread_metadata?.archived).toBe(true);
});

/*
 * F13 boundary: a deletion the API refuses changes nothing, so nothing may
 * reopen. The refusal here is tenant scope: the entry is addressed under a
 * project the user is not in.
 */
test("a refused timeline deletion does not reopen the thread", async (): Promise<void> => {
  await createRule({ name: "reopen-refused", archive: true });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 reopen refused",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  await changeState(incident._id, "acknowledged");
  await changeState(incident._id, "resolved");
  await waitForRowState(incident._id, "archived");

  const resolved: TimelineEntry = await timelineEntry(incident._id, "resolved");
  const foreign: string = "00000000-0000-0000-0000-000000000000";
  const refused: APIResponse = await page.request.delete(
    `${app}${timelinePath}/${resolved._id}`,
    { headers: { "content-type": "application/json", ...headers(foreign) } },
  );
  expect(refused.ok(), "The foreign-tenant delete must be refused").toBe(false);
  await page.waitForTimeout(5_000);
  const state: ProviderState = await fixture("state");
  expect(
    (await timelineEntries(incident._id)).map((row: TimelineEntry): string => {
      return row._id;
    }),
    "The refused delete leaves the Resolved entry in place",
  ).toContain(resolved._id);
  expect((await rows(incident._id))[0]!.state).toBe("archived");
  expect(archivePatches(state, row.threadId!)).toBe(1);
  expect(state.createdThreads[0]!.thread_metadata?.archived).toBe(true);
});

/*
 * Review findings, Astra 2026-09-25 (F21..F24). Each test below was red on
 * 2998171d76 and is fixed by its own corrective commit.
 */

/*
 * F21: the disconnect lands while a verification GET is in flight. The
 * verifier captured the installation before the GET, so without a re-read
 * under the binding lock it hands back a usable channel from a generation
 * that no longer exists. The row must end stale and nothing may be posted.
 */
test("disconnect during verification marks the thread stale and posts nothing", async (): Promise<void> => {
  await createRule({ name: "disconnect-verify" });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 verify race",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  const before: number = posts(await fixture("state"), row.threadId!);
  await scenario("channel-get-slow:6000");
  const pending: Promise<void> = changeState(incident._id, "acknowledged");
  await page.waitForTimeout(1_500);
  await clearBindings();
  await pending;
  await scenario("valid");
  await waitForRowState(incident._id, "stale");
  await page.waitForTimeout(3_000);
  const state: ProviderState = await fixture("state");
  expect(
    posts(state, row.threadId!),
    "Nothing is posted through a verification that a disconnect overtook",
  ).toBe(before);
  expect(threadPosts(state)).toBe(1);
});

/*
 * F22: the resource column caches the thread id. When ownership rejects the
 * row (here: archived by a human), the cached id must be fenced too, or the
 * post goes through the cache and silently unarchives the thread. A
 * destination the rule names on purpose is not an ownership row and keeps
 * receiving.
 */
test("thread archived outside OneUptime is fenced from the resource cache", async (): Promise<void> => {
  await createRule({ name: "cache-fence", existing: "incidents-e2e" });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 cache fence",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  // The cache under test must hold the thread: the creation post reaches it.
  await waitForPost(row.threadId!, 0);
  let state: ProviderState = await fixture("state");
  const threadBefore: number = posts(state, row.threadId!);
  const parentBefore: number = posts(state, identities.channelId);
  await fixture("threads", { id: row.threadId, archived: true });
  await changeState(incident._id, "acknowledged");
  await waitForRowState(incident._id, "archived");
  await expect
    .poll(
      async (): Promise<number> => {
        return posts(await fixture("state"), identities.channelId);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(parentBefore);
  await page.waitForTimeout(3_000);
  state = await fixture("state");
  expect(
    posts(state, row.threadId!),
    "The cached id is not posted to once ownership rejects the row",
  ).toBe(threadBefore);
  expect(state.createdThreads[0]!.thread_metadata?.archived).toBe(true);
  expect(threadPosts(state)).toBe(1);
});

/*
 * F23: audit-log adoption must apply the same privacy and archive checks as
 * manual adoption. A private incident's ambiguous create is matched in the
 * audit log; the thread has since been archived, then swapped to public.
 */
test("audit-log adoption rejects an archived or wrong-type thread", async (): Promise<void> => {
  await createRule({ name: "audit-validate" });
  await scenario("thread-create-timeout");
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 audit validate",
    isPrivate: true,
  });
  const row: OwnershipRow = await waitForRowState(
    incident._id,
    "ambiguous",
    45_000,
  );
  await scenario("valid");
  const created: FixtureThread = (await fixture("state")).createdThreads[0]!;
  expect(created.type).toBe(12);

  await fixture("threads", { id: created.id, archived: true });
  expect(
    (await reconcile(row._id, {})).status(),
    "An archived thread is not adopted for an open incident",
  ).toBe(400);
  expect((await rows(incident._id))[0]!.state).toBe("ambiguous");

  await fixture("threads", { id: created.id, archived: false, type: 11 });
  expect(
    (await reconcile(row._id, {})).status(),
    "A public thread is not adopted for a private incident",
  ).toBe(400);
  expect((await rows(incident._id))[0]!.state).toBe("ambiguous");
  expect((await rows(incident._id))[0]!.threadId).toBeFalsy();

  await fixture("threads", { id: created.id, type: 12 });
  expect((await reconcile(row._id, {})).ok()).toBe(true);
  expect((await waitForRowState(incident._id, "active")).threadId).toBe(
    created.id,
  );
  expect(threadPosts(await fixture("state"))).toBe(1);
});

/*
 * F24: an adopt reads the row as failed, then a recreate claims it while the
 * adopt's GET is in flight. The adopt must compare the fresh row with what it
 * read (state and operation key), not just "is it active", or it overwrites
 * the live claim and the created thread is lost. Adopting into a row that is
 * already creating is refused outright.
 */
test("adoption refuses a row whose claim moved after it was read", async (): Promise<void> => {
  await createRule({ name: "adopt-vs-recreate" });
  await rejectNextCreate();
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 adopt race",
  });
  const failed: OwnershipRow = await waitForRowState(incident._id, "failed");
  /*
   * A thread of this test's own. The shared fixture thread is adopted for
   * good by the manual-adoption case above, and ownership rows outlive the
   * fixture reset, so adopting it here is refused as owned elsewhere (400)
   * before the moved claim is ever compared (hom42-v13-runtime-01).
   */
  const raceThreadId: string = "100000000000000024";
  await fixture("threads", { id: raceThreadId, owner_id: identities.botId });

  await scenario("channel-get-slow:3000");
  const adopt: Promise<APIResponse> = reconcile(failed._id, {
    threadId: raceThreadId,
  });
  await page.waitForTimeout(500);
  await scenario("thread-create-slow:8000");
  const recreate: Promise<APIResponse> = reconcile(failed._id, {
    recreate: true,
  });
  await page.waitForTimeout(1_000);
  expect((await rows(incident._id))[0]!.state).toBe("creating");
  expect(
    (await adopt).status(),
    "The claim moved between the adopt's read and its write",
  ).toBe(409);
  expect(
    (await reconcile(failed._id, { threadId: raceThreadId })).status(),
    "A row that is creating cannot adopt",
  ).toBe(409);

  await scenario("valid");
  expect((await recreate).ok()).toBe(true);
  const active: OwnershipRow = await waitForRowState(incident._id, "active");
  const state: ProviderState = await fixture("state");
  expect(state.createdThreads.length).toBe(1);
  expect(active.threadId).toBe(state.createdThreads[0]!.id);
  expect(active.threadId).not.toBe(raceThreadId);
  expect((await rows(incident._id)).length).toBe(1);
});

/*
 * F25: the membership path reads the resource cache and invites by channel
 * name, so a same-guild reconnect could add a new owner to a private thread
 * from the previous generation. The invitation boundary must refuse an
 * ownership-managed thread that is not active under the live installation,
 * while a thread active under the new generation keeps taking members.
 */
test("owner invite is refused for a thread from a previous installation generation", async (): Promise<void> => {
  await createRule({ name: "invite-fence", inviteOwners: true });
  const stale: IncidentRow = await createIncident({
    title: "HOM-42 invite fence",
    isPrivate: true,
  });
  const staleRow: OwnershipRow = await waitForRowState(stale._id, "active");

  await clearBindings();
  await install();
  await setIncidentChannel(identities.channelId);
  await linkUser();
  const fresh: IncidentRow = await createIncident({
    title: "HOM-42 invite fresh",
    isPrivate: true,
  });
  const freshRow: OwnershipRow = await waitForRowState(fresh._id, "active");
  expect(freshRow.threadId).not.toBe(staleRow.threadId);

  for (const incident of [stale, fresh]) {
    await reAddOwner(incident._id);
  }
  await expect
    .poll(
      async (): Promise<number> => {
        return memberWrites(await fixture("state"), freshRow.threadId!);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(3_000);
  const state: ProviderState = await fixture("state");
  expect(
    memberWrites(state, staleRow.threadId!),
    "No thread-members write reaches a thread from the previous generation",
  ).toBe(0);
  expect(threadPosts(state)).toBe(2);
});

/*
 * F26: a recreate (or adopt) replaces the row's thread T with T2. The
 * resource cache still lists T, no ownership row names it any more, so the
 * post and invite paths treat T as an unmanaged destination. Replacing the
 * thread must remove T from the resource cache; T2 and the named parent
 * keep receiving.
 */
test("replacing a row's thread removes the old thread from the resource cache", async (): Promise<void> => {
  await createRule({
    name: "replace-cache",
    existing: "incidents-e2e",
    inviteOwners: true,
  });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 replace cache",
    isPrivate: true,
  });
  const first: OwnershipRow = await waitForRowState(incident._id, "active");
  const oldThread: string = first.threadId!;

  await clearBindings();
  await install();
  await setIncidentChannel(identities.channelId);
  await linkUser();
  await changeState(incident._id, "acknowledged");
  await waitForRowState(incident._id, "stale");
  const recreated: APIResponse = await reconcile(first._id, { recreate: true });
  expect(recreated.ok()).toBe(true);
  const second: OwnershipRow = await waitForRowState(incident._id, "active");
  const newThread: string = second.threadId!;
  expect(newThread).not.toBe(oldThread);

  let state: ProviderState = await fixture("state");
  const oldPosts: number = posts(state, oldThread);
  const parentPosts: number = posts(state, identities.channelId);
  /*
   * The owner change is what drives both the post and the invite. The
   * thread stays active for it: an archived thread refuses members by
   * design, which is its own case below.
   */
  await reAddOwner(incident._id);
  await expect
    .poll(
      async (): Promise<number> => {
        return posts(await fixture("state"), newThread);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      async (): Promise<number> => {
        return memberWrites(await fixture("state"), newThread);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(3_000);
  state = await fixture("state");
  expect(
    posts(state, oldThread),
    "Nothing is posted to the replaced thread",
  ).toBe(oldPosts);
  expect(
    memberWrites(state, oldThread),
    "Nobody is added to the replaced thread",
  ).toBe(0);
  expect(posts(state, identities.channelId)).toBeGreaterThan(parentPosts);
  expect(threadPosts(state)).toBe(2);
});

/*
 * F25 boundary: an archived thread is not an active thread. The invite
 * path must refuse it even though the row still owns it and the resource
 * cache still lists it. The parent channel receiving the owner-change post
 * proves the update was processed before the thread is checked.
 */
test("owner invite into an archived thread is refused", async (): Promise<void> => {
  await createRule({
    name: "archived-invite",
    existing: "incidents-e2e",
    archive: true,
    inviteOwners: true,
  });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 archived invite",
    isPrivate: true,
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "active");
  await changeState(incident._id, "resolved");
  await waitForRowState(incident._id, "archived");

  const parentBefore: number = posts(
    await fixture("state"),
    identities.channelId,
  );
  await reAddOwner(incident._id);
  await waitForPost(identities.channelId, parentBefore);
  await page.waitForTimeout(3_000);
  const state: ProviderState = await fixture("state");
  expect(
    memberWrites(state, row.threadId!),
    "No member is added to an archived thread",
  ).toBe(0);
  expect(state.createdThreads[0]!.thread_metadata?.archived).toBe(true);
  expect(threadPosts(state)).toBe(1);
});

/*
 * F28: Discord documents a generic 5xx as a processing error with no
 * no-side-effect guarantee, so an HTTP 500 on create is not a definite
 * rejection. The fixture stores the thread and audit reason, then answers
 * 500. The row must be ambiguous (operation key retained), nothing may
 * create again on redelivery or recreate, and reconciliation adopts the
 * original thread through the audit log.
 */
test("HTTP 500 on create is ambiguous, never retried, and reconciles to the original thread", async (): Promise<void> => {
  await createRule({ name: "accepted-500" });
  await scenario("thread-create-accepted-500");
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 accepted 500",
  });
  const row: OwnershipRow = await waitForRowState(incident._id, "ambiguous");
  expect(row.threadId).toBeFalsy();
  expect(row.operationKey).toMatch(/^[0-9a-f-]{36}$/);
  await scenario("valid");
  const during: ProviderState = await fixture("state");
  expect(during.createdThreads.length).toBe(1);
  expect(during.createdThreads[0]!.audit_reason).toBe(
    `oneuptime:${row.operationKey}`,
  );

  await changeState(incident._id, "acknowledged");
  await page.waitForTimeout(5_000);
  expect(threadPosts(await fixture("state")), "No retry on redelivery").toBe(1);
  expect(
    (await reconcile(row._id, { recreate: true })).status(),
    "An ambiguous record cannot be recreated blind",
  ).toBe(409);
  expect(threadPosts(await fixture("state")), "No retry on recreate").toBe(1);
  expect((await rows(incident._id))[0]!.operationKey).toBe(row.operationKey);

  const reconciled: APIResponse = await reconcile(row._id, {});
  expect(reconciled.ok()).toBe(true);
  const adopted: OwnershipRow = await waitForRowState(incident._id, "active");
  expect(adopted.threadId).toBe(during.createdThreads[0]!.id);
  expect(threadPosts(await fixture("state"))).toBe(1);
  // Adoption filled the resource cache: an update now reaches the thread.
  const before: number = posts(await fixture("state"), adopted.threadId!);
  await changeState(incident._id, "resolved");
  await waitForPost(adopted.threadId!, before);
});

/*
 * F29: F26 removes the replaced thread T from the cache, but an invite that
 * read T before the replacement still holds it. It pauses inside
 * GET /channels/T, the row moves to T2 and forgets T, then the invite
 * resumes. With no row naming T, the invitation boundary would treat T as a
 * destination a rule named on purpose and add the member. A thread this
 * service ever owned must stay fenced after it is retired.
 */
test("an invite that read the old thread before its replacement is still refused", async (): Promise<void> => {
  await createRule({
    name: "retired-invite",
    existing: "incidents-e2e",
    inviteOwners: true,
  });
  const incident: IncidentRow = await createIncident({
    title: "HOM-42 retired invite",
    isPrivate: true,
  });
  const first: OwnershipRow = await waitForRowState(incident._id, "active");
  const oldThread: string = first.threadId!;

  await clearBindings();
  await install();
  await setIncidentChannel(identities.channelId);
  await linkUser();
  await changeState(incident._id, "acknowledged");
  await waitForRowState(incident._id, "stale");

  // The invite resolves T from the cache, then pauses inside GET /channels/T.
  await scenario("channel-get-slow:8000");
  await reAddOwner(incident._id);
  await expect
    .poll(
      async (): Promise<number> => {
        return channelGets(await fixture("state"), oldThread, false);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  // Meanwhile the row replaces T with T2 and T leaves the cache.
  await scenario("valid");
  const recreated: APIResponse = await reconcile(first._id, { recreate: true });
  expect(recreated.ok()).toBe(true);
  const second: OwnershipRow = await waitForRowState(incident._id, "active");
  expect(second.threadId).not.toBe(oldThread);

  // The paused invite resumes after the replacement.
  await expect
    .poll(
      async (): Promise<number> => {
        return channelGets(await fixture("state"), oldThread, true);
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(3_000);
  const state: ProviderState = await fixture("state");
  expect(
    memberWrites(state, oldThread),
    "The retired thread takes no member from an invite that read it before the replacement",
  ).toBe(0);
  expect(threadPosts(state)).toBe(2);
});
