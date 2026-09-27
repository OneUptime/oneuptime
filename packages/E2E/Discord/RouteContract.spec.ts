import {
  APIResponse,
  Browser,
  Cookie,
  BrowserContext,
  Page,
  expect,
  test,
} from "@playwright/test";
import { registerAndCreateProject } from "../Tests/Dashboard/Helpers/ProductOnboarding";

const origin: string = `http://${process.env["HOST"] || "oneuptime.test:3002"}`;
let context: BrowserContext;
let page: Page;
let projectId: string;

test.beforeAll(async ({ browser }: { browser: Browser }): Promise<void> => {
  test.setTimeout(180000);
  context = await browser.newContext();
  page = await context.newPage();
  projectId = await registerAndCreateProject({
    page,
    projectNamePrefix: "Discord route contract",
  });
});
test.afterAll(async (): Promise<void> => {
  await context?.close();
});

test("public setup endpoint exists before enabling install UI", async (): Promise<void> => {
  const response: APIResponse = await page.request.get(
    `${origin}/api/discord/config`,
    {
      headers: { tenantid: projectId, projectid: projectId },
    },
  );
  expect(
    response.status(),
    "Missing setup endpoint is the expected pre-implementation failure",
  ).toBe(200);
});

test("authenticated installation initiation exists", async (): Promise<void> => {
  const response: APIResponse = await page.request.get(
    `${origin}/api/discord/install-url`,
    {
      headers: { tenantid: projectId, projectid: projectId },
    },
  );
  expect(
    response.status(),
    "Missing initiation endpoint is the expected pre-implementation failure",
  ).toBe(200);
});

test("invalid state receives a deliberate refusal, not route 404", async (): Promise<void> => {
  const response: APIResponse = await page.request.get(
    `${origin}/api/discord/oauth/install?state=invalid&code=unused`,
    { maxRedirects: 0 },
  );
  const status: number = response.status();
  expect(
    [400, 401, 403].includes(status) ||
      ([302, 303].includes(status) &&
        new RegExp("[?&]error=").test(response.headers()["location"] || "")),
    "Missing callback must not masquerade as authorization protection",
  ).toBe(true);
});

test("generic CRUD rejects a client-forged Discord account binding", async (): Promise<void> => {
  const userId: string =
    (await context.cookies()).find((cookie: Cookie) => {
      return cookie.name === "user-id";
    })?.value ||
    (await page.evaluate(() => {
      return localStorage.getItem("user_id") || "";
    }));
  const response: APIResponse = await page.request.post(
    `${origin}/api/workspace-user-auth-token`,
    {
      headers: { tenantid: projectId, projectid: projectId },
      data: {
        data: {
          projectId,
          userId,
          workspaceType: "Discord",
          workspaceUserId: "100000000000000003",
          authToken: "untrusted-placeholder",
          miscData: { userId: "100000000000000003" },
        },
      },
    },
  );
  expect(
    [400, 401, 403].includes(response.status()),
    "Generic CRUD must not create a verified Discord identity",
  ).toBe(true);
});
