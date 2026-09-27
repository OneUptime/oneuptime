import {
  APIResponse,
  Browser,
  BrowserContext,
  Locator,
  Page,
  PlaywrightTestArgs,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  createItem,
  createOnCallPolicyForUser,
  deleteItem,
  ensureUserCanBeNotified,
  getItem,
  getProjectDefaults,
  getSessionUser,
  listItems,
  toId,
  type ProjectDefaults,
  type SessionUser,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import identities from "./Fixture/identities.json";

/*
 * HOM-44 (test-first): personal Discord notification methods and on-call
 * direct-message paging. Written BEFORE the implementation; every case is
 * expected to fail on the baseline. The failure inventory is
 * PERSONAL_PAGING_FAILURES.md next to this file.
 *
 * Needs the fixture's direct-message route (POST /users/@me/channels plus
 * `dmChannels` in the state snapshot), the `dm-blocked` scenario (Discord
 * error 50007 on a DM post) and the `second-user` scenario (the sign-in flow
 * returns identities.secondUserId).
 */

const app: string = `http://${process.env["HOST"] || "oneuptime.test:7849"}`;
const projectTokens: string = "/api/workspace-project-auth-token";
const userTokens: string = "/api/workspace-user-auth-token";
const methodsPath: string = "/api/user-discord";
const rulesPath: string = "/api/user-notification-rule";
const timelinePath: string = "/api/user-notification-log-timeline";

interface Binding {
  _id: string;
  workspaceUserId?: string;
}
interface Method {
  _id: string;
  discordUserId?: string;
  discordUserName?: string;
  isVerified?: boolean;
}
interface PostedMessage {
  channel_id?: string;
  content?: string;
}
interface DirectMessageChannel {
  id: string;
  recipient_id: string;
}
interface ProviderState {
  events: Array<{ method: string; path: string; status: number }>;
  unhandled: Array<string>;
  postedMessages: Array<PostedMessage>;
  dmChannels?: Array<DirectMessageChannel>;
}
interface TimelineRow {
  _id: string;
  status?: string;
  statusMessage?: string;
  userDiscordId?: unknown;
  userEmailId?: unknown;
  userNotificationRuleId?: unknown;
  triggeredByIncidentId?: unknown;
}
interface RuleRow {
  _id: string;
  ruleType?: string;
  notifyAfterMinutes?: number;
  incidentSeverityId?: unknown;
}

let context: BrowserContext;
let page: Page;
let projectId: string;
let userId: string;
let defaults: ProjectDefaults;

const headers: () => Record<string, string> = (): Record<string, string> => {
  return { tenantid: projectId, projectid: projectId };
};
const discordUrl: (path: string) => string = (path: string): string => {
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
    /*
     * Project bindings have no workspaceUserId column; selecting it, even as
     * false, makes the list API reject the request.
     */
    select:
      path === userTokens
        ? { _id: true, workspaceUserId: true }
        : { _id: true },
  })) as Array<Binding>;
}

async function authorize(
  flow: "install-url" | "sign-in-url",
  expectedRows: number,
): Promise<void> {
  const response: APIResponse = await page.request.get(discordUrl(flow), {
    headers: headers(),
  });
  expect(response.status(), `${flow} must exist`).toBe(200);
  const body: { authorizationUrl: string } = (await response.json()) as {
    authorizationUrl: string;
  };
  await page.goto(body.authorizationUrl);
  await expect
    .poll(async (): Promise<number> => {
      return (
        await bindings(flow === "install-url" ? projectTokens : userTokens)
      ).length;
    })
    .toBe(expectedRows);
}

async function methods(): Promise<Array<Method>> {
  return (await listItems({
    page,
    projectId,
    path: methodsPath,
    query: { projectId },
    select: {
      _id: true,
      discordUserId: true,
      discordUserName: true,
      isVerified: true,
    },
  })) as Array<Method>;
}

async function rulesForMethod(methodId: string): Promise<number> {
  return (
    await listItems({
      page,
      projectId,
      path: rulesPath,
      query: { userDiscordId: methodId },
      select: { _id: true },
    })
  ).length;
}

async function tryCreateMethod(
  extra: Record<string, unknown> = {},
): Promise<APIResponse> {
  return await page.request.post(`${app}${methodsPath}`, {
    headers: { ...headers(), "content-type": "application/json" },
    data: { data: { projectId, userId, ...extra } },
  });
}

async function addMethod(): Promise<Method> {
  const response: APIResponse = await tryCreateMethod();
  expect(
    response.ok(),
    `Adding a Discord method must succeed: ${await response.text()}`,
  ).toBe(true);
  const rows: Array<Method> = await methods();
  expect(rows.length, "Exactly one Discord method").toBe(1);
  return rows[0]!;
}

async function sendTest(
  itemId: string,
): Promise<{ ok: boolean; statusMessage: string }> {
  const response: APIResponse = await page.request.post(
    `${app}${methodsPath}/test`,
    {
      headers: { ...headers(), "content-type": "application/json" },
      data: { itemId },
    },
  );
  expect(response.status(), "The test endpoint must answer").toBe(200);
  return (await response.json()) as { ok: boolean; statusMessage: string };
}

function directMessagesTo(
  state: ProviderState,
  discordUserId: string,
): Array<PostedMessage> {
  const channelIds: Array<string> = (state.dmChannels || [])
    .filter((channel: DirectMessageChannel): boolean => {
      return channel.recipient_id === discordUserId;
    })
    .map((channel: DirectMessageChannel): string => {
      return channel.id;
    });
  return state.postedMessages.filter((message: PostedMessage): boolean => {
    return channelIds.includes(message.channel_id || "");
  });
}

async function pageUserForIncident(title: string): Promise<string> {
  const policyId: string = await createOnCallPolicyForUser({
    page,
    projectId,
    userId,
    policyName: `HOM-44 ${title}`,
  });
  const incident: unknown = await createItem({
    page,
    projectId,
    path: "/api/incident",
    item: {
      projectId,
      title,
      description: "HOM-44 personal paging E2E",
      incidentSeverityId: defaults.incidentSeverityId,
      onCallDutyPolicies: [{ _id: policyId }],
    },
  });
  const incidentId: string = toId((incident as { _id?: unknown })._id);
  expect(incidentId, "Incident creation must return an id").toBeTruthy();
  return incidentId;
}

async function discordTimelineRows(
  incidentId: string,
): Promise<Array<TimelineRow>> {
  return (await listItems({
    page,
    projectId,
    path: timelinePath,
    query: { userId, triggeredByIncidentId: incidentId },
    select: {
      _id: true,
      status: true,
      statusMessage: true,
      userDiscordId: true,
      userEmailId: true,
      userNotificationRuleId: true,
      triggeredByIncidentId: true,
    },
  })) as Array<TimelineRow>;
}

async function waitForDiscordTimeline(
  incidentId: string,
  methodId: string,
  status: string,
): Promise<TimelineRow> {
  let found: TimelineRow | undefined;
  await expect
    .poll(
      async (): Promise<string> => {
        found = (await discordTimelineRows(incidentId)).find(
          (row: TimelineRow): boolean => {
            return toId(row.userDiscordId) === methodId;
          },
        );
        return found?.status || "";
      },
      { timeout: 90_000 },
    )
    .toBe(status);
  return found!;
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(240000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord personal paging E2E",
  });
  userId = (await getSessionUser({ page })).userId;
  defaults = await getProjectDefaults({ page, projectId });
});

test.beforeEach(async (): Promise<void> => {
  for (const row of await methods()) {
    await deleteItem({ page, projectId, path: methodsPath, id: row._id });
  }
  for (const path of [userTokens, projectTokens]) {
    for (const row of await bindings(path)) {
      await deleteItem({ page, projectId, path, id: row._id });
    }
  }
  await fixture("reset", {});
});

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
  },
);

test.afterAll(async (): Promise<void> => {
  await context?.close();
});

test("a method needs a live installation and a linked account", async (): Promise<void> => {
  const noInstall: APIResponse = await tryCreateMethod();
  expect(noInstall.ok(), "No installation must refuse the method").toBe(false);
  expect(await noInstall.text()).toContain("not connected to Discord");

  await authorize("install-url", 1);
  const noLink: APIResponse = await tryCreateMethod();
  expect(noLink.ok(), "No account link must refuse the method").toBe(false);
  expect(await noLink.text()).toContain("Discord account is not connected");
  expect(await methods()).toHaveLength(0);
});

test("the client cannot choose the Discord identity or verification", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  for (const forged of [
    { discordUserId: "199999999999999999" },
    { discordUserName: "someone-else" },
    { isVerified: true },
  ]) {
    const response: APIResponse = await tryCreateMethod(forged);
    expect(
      response.ok(),
      `Forged ${Object.keys(forged)[0]} must be refused`,
    ).toBe(false);
  }
  expect(await methods()).toHaveLength(0);
});

test("adding a method stamps the linked identity and seeds default rules", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();
  expect(method.discordUserId).toBe(identities.userId);
  expect(method.isVerified).toBe(true);
  expect(method.discordUserName, "Label from the OAuth identity").toBeTruthy();
  await expect
    .poll(async (): Promise<number> => {
      return await rulesForMethod(method._id);
    })
    .toBeGreaterThan(0);

  const duplicate: APIResponse = await tryCreateMethod();
  expect(duplicate.ok(), "A second method must be refused").toBe(false);
  expect(await methods()).toHaveLength(1);
});

test("test delivery reaches the linked account and reports a blocked DM", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();
  await fixture("reset", {});

  const sent: { ok: boolean; statusMessage: string } = await sendTest(
    method._id,
  );
  expect(sent.ok, sent.statusMessage).toBe(true);
  const delivered: Array<PostedMessage> = directMessagesTo(
    await fixture("state"),
    identities.userId,
  );
  expect(delivered, "Exactly one DM to the linked account").toHaveLength(1);
  expect(delivered[0]!.content || "").toContain("test notification");

  await fixture("scenario", { scenario: "dm-blocked" });
  const blocked: { ok: boolean; statusMessage: string } = await sendTest(
    method._id,
  );
  expect(blocked.ok, "A refused DM must not be reported as sent").toBe(false);
  expect(blocked.statusMessage).toMatch(/refused the direct message/i);
});

test("an on-call page is delivered as a DM and recorded as Sent", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();
  await fixture("reset", {});

  const title: string = `HOM-44 page ${Date.now()}`;
  const incidentId: string = await pageUserForIncident(title);
  const row: TimelineRow = await waitForDiscordTimeline(
    incidentId,
    method._id,
    "Sent",
  );
  expect(row.statusMessage || "").toContain("Discord");

  const delivered: Array<PostedMessage> = directMessagesTo(
    await fixture("state"),
    identities.userId,
  );
  const page_: PostedMessage | undefined = delivered.find(
    (message: PostedMessage): boolean => {
      return (message.content || "").includes(title);
    },
  );
  expect(page_, "The DM names the incident").toBeTruthy();
  expect(page_!.content || "").toContain("Acknowledge");
});

test("a blocked on-call DM is recorded as Error", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();
  await fixture("scenario", { scenario: "dm-blocked" });

  const incidentId: string = await pageUserForIncident(
    `HOM-44 blocked ${Date.now()}`,
  );
  const row: TimelineRow = await waitForDiscordTimeline(
    incidentId,
    method._id,
    "Error",
  );
  expect(row.statusMessage || "").toMatch(/refused the direct message/i);
});

test("unlink removes the method and its rules but keeps page history", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();
  const incidentId: string = await pageUserForIncident(
    `HOM-44 history ${Date.now()}`,
  );
  await waitForDiscordTimeline(incidentId, method._id, "Sent");

  const link: Binding = (await bindings(userTokens))[0]!;
  await deleteItem({ page, projectId, path: userTokens, id: link._id });

  expect(await methods(), "Unlink removes the method").toHaveLength(0);
  expect(await rulesForMethod(method._id)).toBe(0);
  const history: Array<TimelineRow> = await discordTimelineRows(incidentId);
  expect(
    history.some((row: TimelineRow): boolean => {
      return row.status === "Sent" && !row.userDiscordId;
    }),
    "The Sent row survives with its method reference cleared",
  ).toBe(true);
});

test("deleting the method removes its rules but keeps page history", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();
  const incidentId: string = await pageUserForIncident(
    `HOM-44 deleted ${Date.now()}`,
  );
  await waitForDiscordTimeline(incidentId, method._id, "Sent");

  await deleteItem({ page, projectId, path: methodsPath, id: method._id });

  expect(await methods(), "Delete removes the method").toHaveLength(0);
  expect(await rulesForMethod(method._id)).toBe(0);
  const history: Array<TimelineRow> = await discordTimelineRows(incidentId);
  expect(
    history.some((row: TimelineRow): boolean => {
      return row.status === "Sent" && !row.userDiscordId;
    }),
    "The Sent row survives with its method reference cleared",
  ).toBe(true);
});

test("relinking a different account drops the method; the same account keeps it", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const kept: Method = await addMethod();

  await authorize("sign-in-url", 1);
  expect(
    (await methods()).map((row: Method): string => {
      return row._id;
    }),
    "Same-account relink keeps the method",
  ).toEqual([kept._id]);

  await fixture("scenario", { scenario: "second-user" });
  await authorize("sign-in-url", 1);
  await expect
    .poll(async (): Promise<string | undefined> => {
      return (await bindings(userTokens))[0]?.workspaceUserId;
    })
    .toBe(identities.secondUserId);
  expect(await methods(), "Different-account relink drops it").toHaveLength(0);
  expect(await rulesForMethod(kept._id)).toBe(0);

  await fixture("reset", {});
  const incidentId: string = await pageUserForIncident(
    `HOM-44 relinked ${Date.now()}`,
  );
  await page.waitForTimeout(10_000);
  expect(
    directMessagesTo(await fixture("state"), identities.userId),
    "Nothing reaches the old account",
  ).toHaveLength(0);
  expect(
    (await discordTimelineRows(incidentId)).filter(
      (row: TimelineRow): boolean => {
        return Boolean(row.userDiscordId);
      },
    ),
  ).toHaveLength(0);
});

test("project disconnect removes every Discord method", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();

  const installation: Binding = (await bindings(projectTokens))[0]!;
  await deleteItem({
    page,
    projectId,
    path: projectTokens,
    id: installation._id,
  });

  expect(await methods()).toHaveLength(0);
  expect(await rulesForMethod(method._id)).toBe(0);
});

test("the settings UI adds a Discord method and sends a test DM", async (): Promise<void> => {
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  await fixture("reset", {});

  await page.goto(
    `${app}/dashboard/${projectId}/user-settings/notification-methods`,
  );
  await page.getByText("Workspace Apps", { exact: true }).click();
  const card: Locator = page.getByTestId("card").filter({
    has: page.getByRole("heading", {
      name: "Discord Account for Notifications",
      exact: true,
    }),
  });
  await expect(
    card.getByText("Discord Account for Notifications"),
  ).toBeVisible();
  await card.getByRole("button", { name: "Add Discord Account" }).click();
  await expect(card.getByText("Discord E2E", { exact: false })).toBeVisible();
  expect(await methods()).toHaveLength(1);

  await card.getByRole("button", { name: "Send Test Message" }).click();
  await expect(
    page.getByText("Check your Discord direct messages", { exact: false }),
  ).toBeVisible();
  expect(
    directMessagesTo(await fixture("state"), identities.userId),
  ).toHaveLength(1);
});

test("a Discord on-call rule saved in the rules page survives reload and pages", async (): Promise<void> => {
  test.setTimeout(240_000);
  const user: SessionUser = await getSessionUser({ page });
  // Email rules match every severity, so an unmatched page cannot fall back to Discord.
  await ensureUserCanBeNotified({ page, projectId, user });
  await authorize("install-url", 1);
  await authorize("sign-in-url", 1);
  const method: Method = await addMethod();
  await expect
    .poll(async (): Promise<number> => {
      return await rulesForMethod(method._id);
    })
    .toBeGreaterThan(0);
  for (const rule of await listItems({
    page,
    projectId,
    path: rulesPath,
    query: { userDiscordId: method._id },
    select: { _id: true },
  })) {
    await deleteItem({
      page,
      projectId,
      path: rulesPath,
      id: toId(rule["_id"]),
    });
  }
  expect(await rulesForMethod(method._id)).toBe(0);

  // Control: with no Discord rule the page goes to email and not to Discord.
  await fixture("reset", {});
  const controlTitle: string = `HOM-44 control ${Date.now()}`;
  const controlIncidentId: string = await pageUserForIncident(controlTitle);
  await expect
    .poll(
      async (): Promise<number> => {
        return (await discordTimelineRows(controlIncidentId)).filter(
          (row: TimelineRow): boolean => {
            return Boolean(row.userEmailId);
          },
        ).length;
      },
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0);
  expect(
    (await discordTimelineRows(controlIncidentId)).filter(
      (row: TimelineRow): boolean => {
        return Boolean(row.userDiscordId);
      },
    ),
    "No Discord row without a Discord rule",
  ).toHaveLength(0);
  expect(
    directMessagesTo(await fixture("state"), identities.userId).filter(
      (message: PostedMessage): boolean => {
        return (message.content || "").includes(controlTitle);
      },
    ),
    "No Discord DM without a Discord rule",
  ).toHaveLength(0);

  const severityName: string = String(
    (
      await getItem({
        page,
        projectId,
        path: "/api/incident-severity",
        id: defaults.incidentSeverityId,
        select: { name: true },
      })
    )["name"],
  );
  const rulesUrl: string = `${app}/dashboard/${projectId}/user-settings/incident-on-call-rules`;
  const severityCard: () => Locator = (): Locator => {
    return page.getByTestId("card").filter({
      has: page.getByRole("heading", { name: `${severityName} Severity:` }),
    });
  };

  await page.goto(rulesUrl);
  await severityCard()
    .getByRole("button", { name: "Add Notification Rule" })
    .click();
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog.getByTestId("modal-title")).toHaveText(
    "Add New Notification Rule",
  );
  const selects: Locator = dialog.locator(".ou-select__control");
  await selects.nth(0).click();
  await page
    .locator(".ou-select__option")
    .filter({ hasText: /^Discord: / })
    .click();
  await selects.nth(1).click();
  await page
    .locator(".ou-select__option")
    .filter({ hasText: /^Immediately$/ })
    .click();
  await dialog.getByRole("button", { name: "Add Notification Rule" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(severityCard().getByText(/^Discord: /)).toBeVisible();

  await page.reload();
  await expect(
    severityCard().getByText(/^Discord: /),
    "The saved Discord rule is listed after a reload",
  ).toBeVisible();

  const saved: Array<RuleRow> = (await listItems({
    page,
    projectId,
    path: rulesPath,
    query: { userDiscordId: method._id },
    select: {
      _id: true,
      ruleType: true,
      notifyAfterMinutes: true,
      incidentSeverityId: true,
    },
  })) as Array<RuleRow>;
  expect(saved, "Exactly the rule saved in the UI").toHaveLength(1);
  expect(saved[0]!.ruleType || "").toContain("incident on-call policy");
  expect(saved[0]!.notifyAfterMinutes).toBe(0);
  expect(toId(saved[0]!.incidentSeverityId)).toBe(defaults.incidentSeverityId);

  await fixture("reset", {});
  const title: string = `HOM-44 saved rule ${Date.now()}`;
  const incidentId: string = await pageUserForIncident(title);
  const row: TimelineRow = await waitForDiscordTimeline(
    incidentId,
    method._id,
    "Sent",
  );
  expect(
    toId(row.userNotificationRuleId),
    "The page followed the rule saved in the UI",
  ).toBe(saved[0]!._id);
  const delivered: Array<PostedMessage> = directMessagesTo(
    await fixture("state"),
    identities.userId,
  ).filter((message: PostedMessage): boolean => {
    return (message.content || "").includes(title);
  });
  expect(delivered, "One DM for the incident").toHaveLength(1);
  expect(delivered[0]!.content || "").toContain("Acknowledge");
});
