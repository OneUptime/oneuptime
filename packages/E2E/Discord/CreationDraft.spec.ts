import {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
  PlaywrightTestArgs,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  deleteItem,
  getSessionUser,
  listItems,
  toId,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import identities from "./Fixture/identities.json";

/*
 * Failure-first signed workflow: the baseline has no native creation draft.
 * Run alone on the disposable source-built fixture stack, never production.
 */
const app: string = `http://${process.env["HOST"] || "oneuptime.test:7849"}`;
let context: BrowserContext;
let page: Page;
let projectId: string;
let actorId: string;
const created: Array<{ path: string; id: string }> = [];

test.describe.configure({ mode: "serial" });

async function provider(): Promise<Record<string, unknown>> {
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
async function messages(): Promise<Array<Record<string, unknown>>> {
  return (
    (await provider())["postedMessages"] as Array<Record<string, unknown>>
  ).filter((row: Record<string, unknown>): boolean => {
    return row["webhook_kind"] === "interaction";
  });
}
function component(
  message: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const visit: (value: unknown) => Record<string, unknown> | undefined = (
    value: unknown,
  ): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        const found: Record<string, unknown> | undefined = visit(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    }
    const item: Record<string, unknown> = value as Record<string, unknown>;
    if (item["label"] === label || item["placeholder"] === label) {
      return item;
    }
    for (const child of Object.values(item)) {
      const found: Record<string, unknown> | undefined = visit(child);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  const result: Record<string, unknown> | undefined = visit(message);
  expect(result, `Missing native component ${label}`).toBeDefined();
  return result!;
}
function body(kind: number, data: Record<string, unknown>): string {
  const id: string = (
    BigInt(`0x${randomBytes(7).toString("hex")}`) + BigInt("100000000000000000")
  ).toString();
  return JSON.stringify({
    id,
    token: `fixture-interaction-${id}`,
    application_id: identities.applicationId,
    guild_id: identities.guildId,
    channel_id: identities.channelId,
    member: { user: { id: identities.userId } },
    type: kind,
    data,
  });
}
async function send(raw: string): Promise<Record<string, unknown>> {
  const key: string | undefined = process.env["DISCORD_FIXTURE_SIGNING_KEY"];
  if (!key) {
    throw new Error("Disposable signing key required");
  }
  const timestamp: string = Math.floor(Date.now() / 1000).toString();
  const response: APIResponse = await page.request.post(
    `${app}/api/discord/interactions`,
    {
      data: raw,
      headers: {
        "content-type": "application/json",
        "x-signature-timestamp": timestamp,
        "x-signature-ed25519": sign(
          null,
          Buffer.from(timestamp + raw),
          readFileSync(key),
        ).toString("hex"),
      },
    },
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}
async function completed(raw: string): Promise<void> {
  /*
   * A one-row assertion before both handlers finish can miss a later duplicate.
   * Replay the exact signed envelope until its persisted receipt is terminal.
   */
  await expect
    .poll(
      async (): Promise<unknown> => {
        const response: Record<string, unknown> = await send(raw);
        return (response["data"] as Record<string, unknown> | undefined)?.[
          "content"
        ];
      },
      { timeout: 30000 },
    )
    .toBe("This Discord interaction was already processed.");
}
async function invoke(
  kind: number,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const before: number = (await messages()).length;
  const response: Record<string, unknown> = await send(body(kind, data));
  if (response["type"] === 9 || response["type"] === 4) {
    return response;
  }
  await expect
    .poll(async (): Promise<number> => {
      return (await messages()).length;
    })
    .toBeGreaterThan(before);
  const posted: Array<Record<string, unknown>> = await messages();
  return posted[posted.length - 1]!;
}
async function click(
  message: Record<string, unknown>,
  label: string,
): Promise<Record<string, unknown>> {
  return invoke(3, {
    custom_id: component(message, label)["custom_id"],
    component_type: 2,
  });
}
async function openMaintenance(
  title: string,
): Promise<Record<string, unknown>> {
  const opened: Record<string, unknown> = await invoke(2, {
    name: "oneuptime-maintenance",
  });
  const modal: Record<string, unknown> = await click(opened, "Edit text");
  expect(modal["type"]).toBe(9);
  const values: Record<string, string> = {
    title,
    description: "Created through a reviewed native Discord draft",
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    endsAt: new Date(Date.now() + 7200000).toISOString(),
  };
  return invoke(5, {
    custom_id: (modal["data"] as Record<string, unknown>)["custom_id"],
    components: Object.entries(values).map(
      ([key, value]: [string, string]): Record<string, unknown> => {
        return {
          type: 18,
          component: { type: 4, custom_id: key, value },
        };
      },
    ),
  });
}
async function rows(title: string): Promise<Array<Record<string, unknown>>> {
  return listItems({
    page,
    projectId,
    path: "/api/scheduled-maintenance",
    query: { projectId, title },
    select: {
      _id: true,
      title: true,
      createdByUserId: true,
      startsAt: true,
      endsAt: true,
    },
  });
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(180000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord creation drafts",
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
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixtures even when only testInfo is used.
  async ({}: PlaywrightTestArgs, testInfo: TestInfo): Promise<void> => {
    await testInfo.attach("discord-provider", {
      body: JSON.stringify(await provider()),
      contentType: "application/json",
    });
  },
);
test.afterAll(async (): Promise<void> => {
  if (page && projectId) {
    for (const resource of created) {
      await deleteItem({ page, projectId, ...resource });
    }
    for (const path of [
      "/api/workspace-user-auth-token",
      "/api/workspace-project-auth-token",
    ]) {
      for (const row of await listItems({
        page,
        projectId,
        path,
        query: { projectId, workspaceType: "Discord" },
        select: { _id: true },
      })) {
        await deleteItem({ page, projectId, path, id: toId(row["_id"]) });
      }
    }
  }
  await context?.close();
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixtures even when only testInfo is used.
test("two distinct signed final interactions create exactly one maintenance resource", async ({}: PlaywrightTestArgs, testInfo: TestInfo): Promise<void> => {
  const title: string = `Reviewed Discord maintenance ${Date.now()}`;
  const reviewed: Record<string, unknown> = await click(
    await openMaintenance(title),
    "Review",
  );
  const customId: unknown = component(reviewed, "Submit")["custom_id"];
  const first: string = body(3, { custom_id: customId, component_type: 2 });
  const second: string = body(3, { custom_id: customId, component_type: 2 });
  await Promise.all([send(first), send(second)]);
  await Promise.all([completed(first), completed(second)]);
  const result: Array<Record<string, unknown>> = await rows(title);
  expect(result).toHaveLength(1);
  expect(toId(result[0]!["createdByUserId"])).toBe(actorId);
  created.push({
    path: "/api/scheduled-maintenance",
    id: toId(result[0]!["_id"]),
  });
  await send(first);
  await send(second);
  expect(await rows(title)).toHaveLength(1);
  await testInfo.attach("created-resource", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});
test("cancel and forged ordinary submission create no resource", async (): Promise<void> => {
  const title: string = `Cancelled Discord maintenance ${Date.now()}`;
  await click(await openMaintenance(title), "Cancel");
  const forged: Record<string, unknown> = await invoke(3, {
    custom_id: "SubmitNewScheduledMaintenance",
    component_type: 2,
  });
  expect(JSON.stringify(forged)).not.toContain("Maintenance created");
  expect(await rows(title)).toHaveLength(0);
});
