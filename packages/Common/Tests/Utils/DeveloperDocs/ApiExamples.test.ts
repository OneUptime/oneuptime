import { describe, expect, test } from "@jest/globals";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import {
  CollectionApiExamples,
  getApiBaseUrl,
  getApiReferenceUrl,
  getCollectionApiExamples,
  getCurlCommand,
  getExampleCreateData,
  getExampleSelect,
  getModelApiPath,
  getResourceApiExamples,
  ResourceApiExamples,
  shellQuote,
} from "../../../Utils/DeveloperDocs/ApiExamples";
import { getApiKeyExportCommand } from "../../../Utils/DeveloperDocs/ExampleValues";

/*
 * The curl commands on the Developer > API pages. They run against this
 * installation's API, read the key from the environment (never inline), and
 * must survive whatever a resource is called: a name with a quote in it must
 * not end the shell's quoted JSON.
 */

const API: string = "https://oneuptime.com/api";
const ID: string = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";

describe("shell quoting", () => {
  test("plain words stay bare", () => {
    expect(shellQuote("https://oneuptime.com/api/workflow")).toBe(
      "https://oneuptime.com/api/workflow",
    );
  });

  test("anything else is single-quoted, with quotes inside escaped", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("https://x/get-list?skip=0&limit=10")).toBe(
      "'https://x/get-list?skip=0&limit=10'",
    );
    expect(shellQuote("Bob's API")).toBe("'Bob'\\''s API'");
    expect(shellQuote("$HOME `rm -rf /`")).toBe("'$HOME `rm -rf /`'");
  });
});

describe("curl commands", () => {
  test("read the API key from the environment and send JSON", () => {
    expect(
      getCurlCommand({
        method: "PUT",
        url: `${API}/workflow/${ID}`,
        body: { data: { name: "Report" } },
      }),
    ).toBe(
      [
        `curl -X PUT ${API}/workflow/${ID} \\`,
        '  -H "ApiKey: $ONEUPTIME_API_KEY" \\',
        '  -H "Content-Type: application/json" \\',
        "  -d '{",
        '  "data": {',
        '    "name": "Report"',
        "  }",
        "}'",
      ].join("\n"),
    );
  });

  test("a request without a body sends none", () => {
    expect(getCurlCommand({ method: "DELETE", url: `${API}/workflow/${ID}` })).toBe(
      `curl -X DELETE ${API}/workflow/${ID} \\\n  -H "ApiKey: $ONEUPTIME_API_KEY"`,
    );
  });

  test("a value with a single quote cannot break out of the body", () => {
    const curl: string = getCurlCommand({
      method: "PUT",
      url: `${API}/workflow/${ID}`,
      body: { data: { name: "Bob's report'; rm -rf / #" } },
    });

    expect(curl).toContain(`"name": "Bob'\\''s report'\\''; rm -rf / #"`);
  });

  test("the key export the guides start with", () => {
    expect(getApiKeyExportCommand()).toBe(
      'export ONEUPTIME_API_KEY="your-api-key"',
    );
  });
});

describe("urls", () => {
  test("the API base and a model's path", () => {
    expect(getApiBaseUrl("https://oneuptime.com/")).toBe(
      "https://oneuptime.com/api",
    );
    expect(getModelApiPath(Workflow)).toBe("/workflow");
    expect(getModelApiPath(StatusPage)).toBe("/status-page");
  });

  test("the API reference page for a model", () => {
    expect(
      getApiReferenceUrl({
        modelType: StatusPage,
        oneuptimeUrl: "https://oneuptime.com",
      }),
    ).toBe("https://oneuptime.com/reference/status-page");
  });
});

describe("one resource", () => {
  test("read, change and delete it by its id", () => {
    const examples: ResourceApiExamples = getResourceApiExamples({
      modelType: Workflow,
      apiBaseUrl: API,
      id: ID,
      displayName: "Report",
    });

    expect(examples.read?.method).toBe("POST");
    expect(examples.read?.url).toBe(`${API}/workflow/${ID}/get-item`);
    expect(examples.read?.body).toEqual({
      select: { _id: true, name: true, description: true, isEnabled: true },
    });

    expect(examples.update?.method).toBe("PUT");
    expect(examples.update?.url).toBe(`${API}/workflow/${ID}`);
    expect(examples.update?.body).toEqual({
      data: { description: "Updated with the OneUptime API" },
    });

    expect(examples.delete?.method).toBe("DELETE");
    expect(examples.delete?.url).toBe(`${API}/workflow/${ID}`);
    expect(examples.delete?.body).toBeUndefined();
  });

  test("the read example asks for plain fields only: no secrets, no server state", () => {
    const select: Record<string, unknown> = getExampleSelect(Monitor);

    expect(select["_id"]).toBe(true);
    expect(select["name"]).toBe(true);
    expect(Object.keys(select)).not.toContain("currentMonitorStatusId");
    expect(Object.keys(select)).not.toContain("monitorSteps");
    expect(Object.keys(getExampleSelect(StatusPage))).not.toContain(
      "masterPassword",
    );
  });

  test("a model the API cannot change has no change or delete example", () => {
    const examples: ResourceApiExamples = getResourceApiExamples({
      modelType: AIInsight,
      apiBaseUrl: API,
      id: ID,
    });

    expect(examples.read).not.toBeNull();
    expect(examples.update).toBeNull();
  });

  test("a model outside the public API has no examples", () => {
    expect(
      getResourceApiExamples({
        modelType: EmailVerificationToken,
        apiBaseUrl: API,
        id: ID,
      }),
    ).toEqual({ read: null, update: null, delete: null });
  });
});

describe("a resource type", () => {
  test("list, count and create", () => {
    const examples: CollectionApiExamples = getCollectionApiExamples({
      modelType: Incident,
      apiBaseUrl: API,
      singularName: "Incident",
    });

    expect(examples.list?.url).toBe(`${API}/incident/get-list?skip=0&limit=10`);
    expect(examples.list?.body?.["sort"]).toEqual({ createdAt: "DESC" });
    expect(examples.count?.url).toBe(`${API}/incident/count`);
    expect(examples.create?.url).toBe(`${API}/incident`);
    expect(examples.create?.body).toEqual({
      data: {
        title: "My incident",
        description: "Created with the OneUptime API",
        incidentSeverityId: "<incident severity id>",
      },
    });
  });

  test("the create example puts the name first and takes a page's own values", () => {
    expect(
      Object.keys(
        getExampleCreateData({
          modelType: Monitor,
          singularName: "Monitor",
          exampleValues: { monitorType: "Manual" },
        }),
      )[0],
    ).toBe("name");
    expect(
      getExampleCreateData({
        modelType: Monitor,
        singularName: "Monitor",
        exampleValues: { monitorType: "Manual" },
      })["monitorType"],
    ).toBe("Manual");
  });

  test("a model that cannot be created has no create example", () => {
    expect(
      getCollectionApiExamples({
        modelType: AIInsight,
        apiBaseUrl: API,
        singularName: "AI Insight",
      }).create,
    ).toBeNull();
  });
});
