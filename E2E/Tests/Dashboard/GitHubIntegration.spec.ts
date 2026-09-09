import {
  test,
  expect,
  Page,
  APIResponse,
  Locator,
  Request,
} from "@playwright/test";
import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import path from "path";
import fs from "fs";

const baseUrl: string = BASE_URL.toString().replace(/\/$/, "");

const screenshots: string = path.resolve(
  process.env["GITHUB_SCREENSHOT_DIR"] || "../output/playwright/github",
);
const VARIABLE_CREATE_PATH_PATTERN: RegExp = /\/api\/workflow-variable\/?$/;

async function list(
  page: Page,
  projectId: string,
  resource: string,
  select: JSONObject,
): Promise<Array<JSONObject>> {
  const response: APIResponse = await page.request.post(
    `${baseUrl}/api/${resource}/get-list`,
    {
      headers: { tenantid: projectId, projectid: projectId },
      data: { query: {}, select, limit: 50, skip: 0 },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const json: JSONObject = await response.json();
  return json["data"] as Array<JSONObject>;
}

function toId(value: JSONValue | undefined): string {
  return typeof value === "string"
    ? value
    : ((value as JSONObject)["value"] as string);
}

test("GitHub onboarding creates a configured disabled comment workflow with native steps", async ({
  page,
}: {
  page: Page;
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 1080 });
  fs.mkdirSync(screenshots, { recursive: true });
  const projectId: string = await registerAndCreateProject({
    page,
    projectNamePrefix: "GitHub Automation",
    preferredPlanName: "Growth",
  });
  const repoUrl: string = `${baseUrl}/dashboard/${projectId}/code-repository`;
  const panel: Locator = page.getByRole("region", {
    name: "GitHub automation",
  });
  await gotoProjectPage({ page, projectId, url: repoUrl, ready: panel });
  await expect(
    panel.getByRole("button", { name: /Use template:/ }),
  ).toHaveCount(3);
  await expect(page.getByText(/^No repositories connected\./)).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(screenshots, "github-automation.png"),
    fullPage: true,
  });

  await panel
    .getByRole("button", {
      name: "Use template: Declare an incident from a comment",
    })
    .click();
  await expect(page.getByTestId("workflow-name-input")).toHaveValue(
    "GitHub comment to incident",
  );
  await page
    .getByTestId("workflow-name-input")
    .fill("GitHub comments → incidents");
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(
    page.locator("#workflow-variable-githubRepository"),
  ).toBeVisible();
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByTestId("modal")).toBeVisible();
  await expect(
    page.getByText("GitHub repository is required.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Incident severity ID is required.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("OneUptime incidents page URL is required.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await list(page, projectId, "workflow", { _id: true })).toHaveLength(
    0,
  );

  let severities: Array<JSONObject> = [];
  await expect
    .poll(
      async () => {
        severities = await list(page, projectId, "incident-severity", {
          _id: true,
        });
        return severities.length;
      },
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  const severityId: string = toId(severities[0]!["_id"]);
  const incidentListUrl: string = `${baseUrl}/dashboard/${projectId}/incidents`;
  await page
    .locator("#workflow-variable-githubRepository")
    .fill("acme/payments-service");
  await page.locator("#workflow-variable-incidentSeverityId").fill(severityId);
  await page
    .locator("#workflow-variable-incidentListUrl")
    .fill(incidentListUrl);
  await page.screenshot({
    path: path.join(screenshots, "github-template-setup.png"),
    fullPage: false,
  });
  /*
   * Variable content is write-only. Observe the real create requests, then
   * verify the readable persisted rows below without bypassing authorization.
   */
  const expectedVariables: Record<string, string> = {
    githubRepository: "acme/payments-service",
    incidentSeverityId: severityId,
    incidentListUrl,
  };
  const variableWrites: Array<Promise<Request>> = Object.keys(
    expectedVariables,
  ).map((name: string): Promise<Request> => {
    return page.waitForRequest((request: Request): boolean => {
      if (
        request.method() !== "POST" ||
        !VARIABLE_CREATE_PATH_PATTERN.test(new URL(request.url()).pathname)
      ) {
        return false;
      }
      const data: JSONObject | undefined = (
        request.postDataJSON() as JSONObject
      )["data"] as JSONObject | undefined;
      return data?.["name"] === name;
    });
  });
  await page.getByTestId("modal-footer-submit-button").click();
  const writtenVariables: Array<Request> = await Promise.all(variableWrites);
  for (const request of writtenVariables) {
    const data: JSONObject = (request.postDataJSON() as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data).toMatchObject({
      content: expectedVariables[data["name"] as string],
      isSecret: false,
    });
  }
  await expect(page).toHaveURL(/\/workflows\/[a-f0-9-]+\/builder/, {
    timeout: 30000,
  });
  await expect(
    page.getByText("GitHub Event", { exact: true }).first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("Comment on GitHub Issue or PR", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "github-workflow-builder.png"),
    fullPage: true,
  });

  /*
   * triggerId/triggerArguments are internal denormalized columns and cannot
   * be selected by a browser user. The builder's persisted graph is readable.
   */
  const workflows: Array<JSONObject> = await list(page, projectId, "workflow", {
    _id: true,
    name: true,
    isEnabled: true,
    graph: true,
  });
  expect(workflows).toHaveLength(1);
  expect(workflows[0]!["name"]).toBe("GitHub comments → incidents");
  expect(workflows[0]!["isEnabled"]).toBe(false);
  const graph: JSONObject = workflows[0]!["graph"] as JSONObject;
  const components: Array<JSONObject> = (
    graph["nodes"] as Array<JSONObject>
  ).map((node: JSONObject): JSONObject => {
    return node["data"] as JSONObject;
  });
  const trigger: JSONObject | undefined = components.find(
    (component: JSONObject): boolean => {
      return component["id"] === "github-event-1";
    },
  );
  expect(trigger).toMatchObject({
    metadataId: "github-event",
    arguments: {
      repository: "{{local.variables.githubRepository}}",
      event: "issue_comment",
      actions: "created",
      commentCommand: "@oneuptime incident",
      requireWriteAccess: true,
      ignoreBots: true,
    },
  });
  expect(components).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ metadataId: "incident-create-one" }),
      expect.objectContaining({ metadataId: "github-add-comment" }),
    ]),
  );
  const variables: Array<JSONObject> = await list(
    page,
    projectId,
    "workflow-variable",
    { name: true, workflowId: true, isSecret: true },
  );
  expect(variables).toHaveLength(3);
  expect(
    variables
      .map((variable: JSONObject): string => {
        return variable["name"] as string;
      })
      .sort(),
  ).toEqual(Object.keys(expectedVariables).sort());
  for (const variable of variables) {
    expect(variable["isSecret"]).toBe(false);
    expect(toId(variable["workflowId"])).toBe(toId(workflows[0]!["_id"]));
  }
});
