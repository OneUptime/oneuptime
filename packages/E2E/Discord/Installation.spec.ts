import {
  Browser,
  Cookie,
  TestInfo,
  APIResponse,
  BrowserContext,
  Page,
  expect,
  test,
  APIRequestContext,
} from "@playwright/test";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  deleteItem,
  listItems,
} from "../Tests/Dashboard/Helpers/MonitorAlerting";
import identities from "./Fixture/identities.json";

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
}
interface ProviderState {
  events: Array<ProviderEvent>;
  unhandled: Array<string>;
}
let context: BrowserContext;
let page: Page;
let projectId: string;
let userId: string;

const headers: () => Record<string, string> = (): Record<string, string> => {
  return {
    tenantid: projectId,
    projectid: projectId,
  };
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

async function clearBindings(): Promise<void> {
  for (const path of [userTokens, projectTokens]) {
    for (const row of await bindings(path)) {
      await deleteItem({ page, projectId, path, id: row._id });
    }
  }
}

function assertNoSecrets(body: string): void {
  for (const name of ["DISCORD_BOT_TOKEN", "DISCORD_APP_CLIENT_SECRET"]) {
    const secret: string | undefined = process.env[name];
    if (!secret) {
      throw new Error(
        `${name} must be present for a meaningful credential leak assertion`,
      );
    }
    expect(body.includes(secret), `${name} must not appear in a response`).toBe(
      false,
    );
  }
  expect(
    new RegExp("fixture-(access|refresh)-[a-f0-9]{16}").test(body),
    "OAuth credentials must not appear in an app response",
  ).toBe(false);
}

async function authorize(
  flow: "install" | "user" = "install",
): Promise<string> {
  const response: APIResponse = await page.request.get(
    url(flow === "install" ? "install-url" : "sign-in-url"),
    { headers: headers() },
  );
  expect(
    response.status(),
    "Authenticated initiation must exist and return 200",
  ).toBe(200);
  const body: { authorizationUrl: string } = (await response.json()) as {
    authorizationUrl: string;
  };
  const target: URL = new URL(body.authorizationUrl);
  expect(target.origin).toBe("https://discord.com");
  expect(target.searchParams.get("state")).toBeTruthy();
  expect(target.searchParams.get("redirect_uri")).toBe(url(`oauth/${flow}`));
  return target.toString();
}

async function callback(authorizationUrl: string): Promise<string> {
  const response: APIResponse = await page.request.get(authorizationUrl, {
    maxRedirects: 0,
  });
  expect(
    response.status(),
    "The Discord fixture must issue a real OAuth redirect",
  ).toBe(302);
  return response.headers()["location"]!;
}

async function install(): Promise<Binding> {
  await page.goto(await authorize());
  await expect
    .poll(async (): Promise<number> => {
      return (await bindings(projectTokens)).length;
    })
    .toBe(1);
  const row: Binding = (await bindings(projectTokens))[0]!;
  expect(row.workspaceProjectId).toBe(identities.guildId);
  return row;
}

async function refused(response: APIResponse): Promise<void> {
  const status: number = response.status();
  const location: string = response.headers()["location"] || "";
  expect(
    [400, 401, 403].includes(status) ||
      ([302, 303].includes(status) && new RegExp("[?&]error=").test(location)),
    "Refusal must be explicit; a missing endpoint is not a security pass",
  ).toBe(true);
  assertNoSecrets(await response.text());
}

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(180000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord installation E2E",
  });
  userId =
    (await context.cookies()).find((cookie: Cookie) => {
      return cookie.name === "user-id";
    })?.value ||
    (await page.evaluate(() => {
      return localStorage.getItem("user_id") || "";
    }));
  try {
    userId = JSON.parse(decodeURIComponent(userId)) as string;
  } catch {
    userId = decodeURIComponent(userId);
  }
  expect(
    userId,
    "Generic CRUD security tests require the real authenticated user UUID",
  ).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
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
    const provider: ProviderState = await fixture("state");
    await testInfo.attach("provider-transcript", {
      body: JSON.stringify(provider, null, 2),
      contentType: "application/json",
    });
    const persisted: { project: Array<Binding>; user: Array<Binding> } = {
      project: await bindings(projectTokens),
      user: await bindings(userTokens),
    };
    assertNoSecrets(JSON.stringify(persisted));
    await testInfo.attach("persisted-bindings", {
      body: JSON.stringify(persisted, null, 2),
      contentType: "application/json",
    });
    expect(
      provider.unhandled,
      "Every provider call must be modeled explicitly",
    ).toEqual([]);
  },
);

test.afterAll(async (): Promise<void> => {
  await context?.close();
});

test("setup config exposes only public application metadata", async (): Promise<void> => {
  const response: APIResponse = await page.request.get(url("config"), {
    headers: headers(),
  });
  expect(response.status()).toBe(200);
  const body: Record<string, unknown> = (await response.json()) as Record<
    string,
    unknown
  >;
  expect(Object.keys(body).sort()).toEqual(
    [
      "enabled",
      "applicationId",
      "installCallbackUrl",
      "userCallbackUrl",
      "interactionUrl",
    ].sort(),
  );
  expect(body["enabled"]).toBe(true);
  expect(body["applicationId"]).toBe(identities.applicationId);
  assertNoSecrets(JSON.stringify(body));
  const frontend: APIResponse = await page.request.get(
    `${app}/dashboard/env.js`,
  );
  assertNoSecrets(await frontend.text());
});

test("anonymous and foreign-project callers cannot initiate installation", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  await refused(await request.get(url("install-url")));
  await refused(
    await page.request.get(url("install-url"), {
      headers: {
        tenantid: "20000000-0000-4000-8000-000000000001",
        projectid: "20000000-0000-4000-8000-000000000001",
      },
    }),
  );
  expect((await bindings(projectTokens)).length).toBe(0);
});

test("browser OAuth installs verified guild and persists eligible incident parent", async (): Promise<void> => {
  await install();
  const channels: APIResponse = await page.request.get(url("channels"), {
    headers: headers(),
  });
  expect(channels.status()).toBe(200);
  const body: { channels: Array<{ id: string; name: string }> } =
    (await channels.json()) as {
      channels: Array<{ id: string; name: string }>;
    };
  expect(
    body.channels.map((channel: { id: string; name: string }) => {
      return channel.id;
    }),
  ).toEqual([identities.channelId]);
  const update: APIResponse = await page.request.put(url("incident-channel"), {
    headers: headers(),
    data: { channelId: identities.channelId },
  });
  expect(update.ok()).toBe(true);
  expect((await bindings(projectTokens))[0]!.miscData?.incidentChannelId).toBe(
    identities.channelId,
  );
  await page.goto(`${app}/dashboard/${projectId}/settings/discord-integration`);
  await expect(
    page.getByText(identities.guildName, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("incidents-e2e", { exact: true }).first(),
  ).toBeVisible();
});

for (const scenario of [
  "denied-consent",
  "forged-guild",
  "no-manage-guild",
  "bot-missing",
  "token-failure",
  "identity-failure",
]) {
  // Each scenario registers an independent serial Playwright test.
  // eslint-disable-next-line no-loop-func
  test(`installation rejects ${scenario} without a partial binding`, async (): Promise<void> => {
    await fixture("scenario", { scenario });
    const target: string = await callback(await authorize());
    await refused(await page.request.get(target, { maxRedirects: 0 }));
    expect((await bindings(projectTokens)).length).toBe(0);
  });
}

test("missing and malformed OAuth state are refused", async (): Promise<void> => {
  for (const state of ["", "not-a-state"]) {
    await refused(
      await page.request.get(
        `${url("oauth/install")}?code=unused&state=${state}`,
        { maxRedirects: 0 },
      ),
    );
  }
  expect((await fixture("state")).events).toEqual([]);
  expect((await bindings(projectTokens)).length).toBe(0);
});

test("wrong-browser OAuth consumes the state and cannot be retried", async ({
  browser,
}: {
  browser: Browser;
}): Promise<void> => {
  const target: string = await callback(await authorize());
  const other: BrowserContext = await browser.newContext();
  try {
    await refused(await other.request.get(target, { maxRedirects: 0 }));
  } finally {
    await other.close();
  }
  await refused(await page.request.get(target, { maxRedirects: 0 }));
  expect((await bindings(projectTokens)).length).toBe(0);
});

test("concurrent callbacks spend state once and create one binding", async (): Promise<void> => {
  const target: string = await callback(await authorize());
  const responses: Array<APIResponse> = await Promise.all([
    page.request.get(target, { maxRedirects: 0 }),
    page.request.get(target, { maxRedirects: 0 }),
  ]);
  expect(
    responses.every((response: APIResponse) => {
      return response.status() !== 404;
    }),
  ).toBe(true);
  expect((await bindings(projectTokens)).length).toBe(1);
  const provider: ProviderState = await fixture("state");
  expect(
    provider.events.filter((event: ProviderEvent) => {
      return event.path.endsWith("/oauth2/token");
    }),
  ).toHaveLength(1);
  await refused(await page.request.get(target, { maxRedirects: 0 }));
});

for (const channelId of [
  identities.foreignChannelId,
  identities.voiceChannelId,
  identities.threadChannelId,
  identities.deniedChannelId,
]) {
  // eslint-disable-next-line no-loop-func
  test(`incident parent rejects ineligible channel ${channelId}`, async (): Promise<void> => {
    await install();
    await refused(
      await page.request.put(url("incident-channel"), {
        headers: headers(),
        data: { channelId },
      }),
    );
    expect(
      (await bindings(projectTokens))[0]!.miscData?.incidentChannelId,
    ).toBeFalsy();
  });
}

test("same-guild reconnect preserves parent and different guild cannot replace it", async (): Promise<void> => {
  await install();
  expect(
    (
      await page.request.put(url("incident-channel"), {
        headers: headers(),
        data: { channelId: identities.channelId },
      })
    ).ok(),
  ).toBe(true);
  await install();
  expect((await bindings(projectTokens))[0]!.miscData?.incidentChannelId).toBe(
    identities.channelId,
  );
  await fixture("scenario", { scenario: "different-guild" });
  await refused(
    await page.request.get(await callback(await authorize()), {
      maxRedirects: 0,
    }),
  );
  expect((await bindings(projectTokens))[0]!.workspaceProjectId).toBe(
    identities.guildId,
  );
});

test("linked account is verified and unlink leaves project installed", async (): Promise<void> => {
  await install();
  await page.goto(await authorize("user"));
  await expect
    .poll(async (): Promise<number> => {
      return (await bindings(userTokens)).length;
    })
    .toBe(1);
  const row: Binding = (await bindings(userTokens))[0]!;
  expect(row.workspaceUserId).toBe(identities.userId);
  await deleteItem({ page, projectId, path: userTokens, id: row._id });
  expect((await bindings(userTokens)).length).toBe(0);
  expect((await bindings(projectTokens)).length).toBe(1);
});

test("account linking rejects a user outside the connected guild", async (): Promise<void> => {
  await install();
  await fixture("scenario", { scenario: "user-not-in-guild" });
  await refused(
    await page.request.get(await callback(await authorize("user")), {
      maxRedirects: 0,
    }),
  );
  expect((await bindings(userTokens)).length).toBe(0);
});

test("generic CRUD cannot forge a verified Discord identity", async (): Promise<void> => {
  const response: APIResponse = await page.request.post(`${app}${userTokens}`, {
    headers: headers(),
    data: {
      data: {
        projectId,
        userId,
        workspaceType: "Discord",
        workspaceUserId: identities.userId,
        authToken: "untrusted-placeholder",
        miscData: { userId: identities.userId },
      },
    },
  });
  await refused(response);
  expect(
    await response.text(),
    "Refusal must come from verified-identity authorization, not malformed input",
  ).toMatch(
    /Discord account identities must be verified|verified Discord binding flow/i,
  );
  expect((await bindings(userTokens)).length).toBe(0);
});

test("disconnect removes local account bindings without revoking the shared bot", async (): Promise<void> => {
  const row: Binding = await install();
  await page.goto(await authorize("user"));
  await expect
    .poll(async (): Promise<number> => {
      return (await bindings(userTokens)).length;
    })
    .toBe(1);
  const before: number = (await fixture("state")).events.length;
  await deleteItem({ page, projectId, path: projectTokens, id: row._id });
  expect(await bindings(projectTokens)).toEqual([]);
  expect(await bindings(userTokens)).toEqual([]);
  expect((await fixture("state")).events.slice(before)).toEqual([]);
});

test("pending reinstall cannot resurrect a disconnected project", async (): Promise<void> => {
  const row: Binding = await install();
  const pending: string = await callback(await authorize());
  await deleteItem({ page, projectId, path: projectTokens, id: row._id });
  await refused(await page.request.get(pending, { maxRedirects: 0 }));
  expect(await bindings(projectTokens)).toEqual([]);
  expect(await bindings(userTokens)).toEqual([]);
});

test("initial pending install is stale after another install and disconnect", async (): Promise<void> => {
  const pending: string = await callback(await authorize());
  const row: Binding = await install();
  await deleteItem({ page, projectId, path: projectTokens, id: row._id });
  await refused(await page.request.get(pending, { maxRedirects: 0 }));
  expect(await bindings(projectTokens)).toEqual([]);
});

test("pending user link cannot survive project disconnect", async (): Promise<void> => {
  const project: Binding = await install();
  const pending: string = await callback(await authorize("user"));
  await deleteItem({ page, projectId, path: projectTokens, id: project._id });
  await refused(await page.request.get(pending, { maxRedirects: 0 }));
  expect(await bindings(projectTokens)).toEqual([]);
  expect(await bindings(userTokens)).toEqual([]);
});

test("pending relink cannot resurrect an explicitly unlinked account", async (): Promise<void> => {
  await install();
  await page.goto(await authorize("user"));
  await expect
    .poll(async (): Promise<number> => {
      return (await bindings(userTokens)).length;
    })
    .toBe(1);
  const user: Binding = (await bindings(userTokens))[0]!;
  const pending: string = await callback(await authorize("user"));
  await deleteItem({ page, projectId, path: userTokens, id: user._id });
  await refused(await page.request.get(pending, { maxRedirects: 0 }));
  expect(await bindings(userTokens)).toEqual([]);
  expect((await bindings(projectTokens)).length).toBe(1);
});

test("explicit credential column selection cannot disclose project or user secrets", async (): Promise<void> => {
  await install();
  await page.goto(await authorize("user"));
  await expect
    .poll(async (): Promise<number> => {
      return (await bindings(userTokens)).length;
    })
    .toBe(1);
  for (const path of [projectTokens, userTokens]) {
    const row: Binding = (await bindings(path))[0]!;
    for (const endpoint of [
      `${path}/get-list`,
      `${path}/${row._id}/get-item`,
    ]) {
      const response: APIResponse = await page.request.post(
        `${app}${endpoint}`,
        {
          headers: headers(),
          data: {
            query: { projectId, workspaceType: "Discord" },
            select: { _id: true, authToken: true },
            limit: 10,
            skip: 0,
          },
        },
      );
      const body: string = await response.text();
      assertNoSecrets(body);
      expect(
        [200, 400, 401, 403].includes(response.status()),
        "The protected-column request must reach a real model ACL",
      ).toBe(true);
      if (response.ok()) {
        expect(body).not.toMatch(/"authToken"\s*:\s*"[^"\s]+"/);
      } else {
        expect(body).toMatch(
          /permission|access|read|column|select|unauthori|forbidden/i,
        );
      }
    }
  }
});
