import { describe, expect, test } from "@jest/globals";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import {
  getApiBaseUrl,
  getApiReferenceUrl,
  getCurlCommand,
  getModelApiPath,
  shellQuote,
} from "../../../Utils/DeveloperDocs/ApiExamples";
import { isModelInPublicApi } from "../../../Utils/DeveloperDocs/TerraformSchema";
import {
  getApiKeyExportCommand,
  toSentenceCaseName,
} from "../../../Utils/DeveloperDocs/ExampleValues";

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
    expect(
      getCurlCommand({ method: "DELETE", url: `${API}/workflow/${ID}` }),
    ).toBe(
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

describe("which models have a path", () => {
  test("a documented model's path is its CRUD path", () => {
    expect(getModelApiPath(Incident)).toBe("/incident");
    expect(getModelApiPath(Monitor)).toBe("/monitor");
    expect(isModelInPublicApi(AIInsight)).toBe(true);
  });

  test("an undocumented one has a path, but no public API: the pages say so instead of showing it", () => {
    expect(getModelApiPath(EmailVerificationToken)).toBe(
      "/email-verification-token",
    );
    expect(isModelInPublicApi(EmailVerificationToken)).toBe(false);
  });
});

describe("resource names inside a sentence", () => {
  test.each([
    ["Workflow", "workflow"],
    ["Status Page", "status page"],
    ["On-Call Policy", "on-call policy"],
    ["Scheduled Maintenance Events", "scheduled maintenance events"],
    ["AI Insight", "AI insight"],
    ["SLOs", "SLOs"],
    ["IoT Fleet", "IoT fleet"],
    ["RUM Application", "RUM application"],
    ["Kubernetes Cluster", "Kubernetes cluster"],
    ["Docker Swarm Clusters", "Docker Swarm clusters"],
    ["vCenter", "vCenter"],
  ])("%s -> %s", (name: string, expected: string) => {
    expect(toSentenceCaseName(name)).toBe(expected);
  });
});
