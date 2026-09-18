import axios from "axios";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  HttpRequestStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import dns from "dns";
import {
  runHttpStep,
  StepRunResult,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * A Runbook HTTP step's url, method, headers and body come verbatim out of the
 * Runbook's steps JSON column, and the step's output builder writes the full
 * status, headers and body of the response into
 * RunbookExecution.stepExecutions — which any project member can read. That is
 * a fully attacker-shaped request into the Worker's network with the answer
 * handed back, and an attacker-chosen method plus headers is exactly what
 * IMDSv2 asks for.
 *
 * These tests assert no socket is opened for an internal target, that the
 * checked address is pinned into the one that is opened, and that redirects
 * are refused (raw axios, so maxRedirects rather than the API wrapper's
 * doNotFollowRedirects).
 */

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

let lookupSpy: LookupSpy;
let requestSpy: jest.SpyInstance;

function makeHttpStep(
  config: Partial<HttpRequestStepConfig> = {},
): RunbookStep {
  return {
    id: "s1",
    order: 0,
    type: RunbookStepType.HttpRequest,
    title: "Call API",
    config: {
      url: "https://api.example.com/health",
      method: "GET",
      ...config,
    } as HttpRequestStepConfig,
  };
}

beforeEach(() => {
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;

  // Stand in for getaddrinfo, so the tests are deterministic and offline.
  lookupSpy.mockImplementation((hostname: string) => {
    if (hostname === "localhost") {
      return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
    }

    return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
  });

  requestSpy = jest.spyOn(axios, "request").mockResolvedValue({
    status: 200,
    statusText: "OK",
    headers: {},
    data: "",
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("runHttpStep refuses internal targets", () => {
  const blockedUrls: Array<string> = [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://169.254.169.254:80/latest/meta-data/",
    "http://127.0.0.1:9200/_search",
    "http://localhost:9200/_search",
    "http://0.0.0.0:8080/",
    "http://[::1]:8080/",
    "http://[0:0:0:0:0:ffff:127.0.0.1]:8080/",
  ];

  test.each(blockedUrls)("never opens a socket for %s", async (url: string) => {
    const result: StepRunResult = await runHttpStep(makeHttpStep({ url }));

    expect(result.success).toBe(false);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("the IMDSv2 shape is blocked even with an attacker-chosen method and headers", async () => {
    const result: StepRunResult = await runHttpStep(
      makeHttpStep({
        url: "http://169.254.169.254/latest/api/token",
        method: "PUT",
        headersJson: JSON.stringify({
          "X-aws-ec2-metadata-token-ttl-seconds": "21600",
        }),
      }),
    );

    expect(result.success).toBe(false);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a hostname that resolves to the metadata address is blocked", async () => {
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    const result: StepRunResult = await runHttpStep(
      makeHttpStep({
        url: "https://rebind.attacker.example/latest/meta-data/",
      }),
    );

    expect(result.success).toBe(false);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a blocked step fails as a step result, not an unhandled throw", async () => {
    const result: StepRunResult = await runHttpStep(
      makeHttpStep({ url: "http://169.254.169.254/" }),
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe("");
    expect(result.errorMessage).toContain("not allowed");
  });

  test("an empty URL is rejected rather than dialed", async () => {
    const result: StepRunResult = await runHttpStep(makeHttpStep({ url: "" }));

    expect(result.success).toBe(false);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a non-http scheme is rejected", async () => {
    const result: StepRunResult = await runHttpStep(
      makeHttpStep({ url: "file:///etc/passwd" }),
    );

    expect(result.success).toBe(false);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

describe("runHttpStep pins and refuses redirects for allowed targets", () => {
  test("a public target is dialed with maxRedirects 0 and pinned agents", async () => {
    const result: StepRunResult = await runHttpStep(makeHttpStep());

    expect(result.success).toBe(true);

    const config: Record<string, unknown> = requestSpy.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(config["maxRedirects"]).toBe(0);
    expect(config["httpAgent"]).toBeDefined();
    expect(config["httpsAgent"]).toBeDefined();
  });

  test("the pinned agent dials the address the guard validated", async () => {
    await runHttpStep(makeHttpStep());

    const config: Record<string, unknown> = requestSpy.mock
      .calls[0]![0] as Record<string, unknown>;

    const lookup: (
      hostname: string,
      lookupOptions: { all?: boolean },
      callback: (error: Error | null, address: string) => void,
    ) => void = (
      config["httpsAgent"] as unknown as {
        options: {
          lookup: (
            hostname: string,
            lookupOptions: { all?: boolean },
            callback: (error: Error | null, address: string) => void,
          ) => void;
        };
      }
    ).options.lookup;

    const dialed: string = await new Promise((resolve: (v: string) => void) => {
      lookup(
        "api.example.com",
        { all: false },
        (_error: Error | null, address: string) => {
          resolve(address);
        },
      );
    });

    expect(dialed).toBe("93.184.216.34");
  });

  test("a self-hosted private target is still reachable by default", async () => {
    lookupSpy.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    /*
     * "Default" here means a self-hosted install: billing off and no explicit
     * SaaS opt-in. The CI test harness turns BILLING_ENABLED on (SaaS), so
     * force it off for this scenario and restore it afterwards — otherwise the
     * private range is correctly blocked and this asserts the wrong contract.
     */
    const originalBillingEnabled: string | undefined =
      process.env["BILLING_ENABLED"];
    delete process.env["BILLING_ENABLED"];

    try {
      const result: StepRunResult = await runHttpStep(
        makeHttpStep({ url: "http://internal-api.corp/health" }),
      );

      expect(result.success).toBe(true);
      expect(requestSpy).toHaveBeenCalled();
    } finally {
      if (originalBillingEnabled === undefined) {
        delete process.env["BILLING_ENABLED"];
      } else {
        process.env["BILLING_ENABLED"] = originalBillingEnabled;
      }
    }
  });

  test("but not when the install opts into SaaS policy", async () => {
    lookupSpy.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";

    try {
      const result: StepRunResult = await runHttpStep(
        makeHttpStep({ url: "http://internal-api.corp/health" }),
      );

      expect(result.success).toBe(false);
      expect(requestSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
    }
  });
});
