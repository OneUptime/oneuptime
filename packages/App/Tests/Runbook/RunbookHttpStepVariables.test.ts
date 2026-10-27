import axios from "axios";
import dns from "dns";
import RunbookVariableResolver, {
  RunbookVariableResolution,
} from "Common/Server/Utils/Runbook/RunbookVariableResolver";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import {
  HttpRequestStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  RunbookVariableReference,
  RunbookVariableScope,
  getRunbookVariableReferenceKey,
} from "Common/Types/Runbook/RunbookVariableReference";
import { RunbookVariableProblemReason } from "Common/Types/Runbook/RunbookVariableProblems";
import { REDACTED_SECRET_TEXT } from "Common/Types/Runbook/SecretOutputRedaction";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  HTTP_STEP_VARIABLES_OUTSIDE_RUN_MESSAGE,
  HTTP_STEP_VARIABLES_UNREAD_MESSAGE,
  StepExecutionContext,
  StepRunResult,
  runHttpStep,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * AN HTTP REQUEST STEP FILLS IN THE RUNBOOK VARIABLES IT NAMES.
 *
 * Bash, JavaScript, SSH and kubectl steps had variables; an HTTP request
 * step did not, so a token had to be typed into the step itself. Now:
 *
 *   - its URL, headers and body name variables as scripts do, and the
 *     request is sent with them filled in - the URL the address guard
 *     checks and pins is the one sent;
 *   - OneUptime sends the request itself, so the variables are read for
 *     the server (no Runner's list applies): every variable of the step's
 *     project, and of its runbook, a secret too;
 *   - a variable the step may not have fails it, naming the variable, and
 *     nothing is sent with a placeholder in it;
 *   - what it records - the response, or an error - hides every secret it
 *     was given, as sent and as a URL carries it;
 *   - outside a runbook's run, a step that names variables is refused.
 *
 * Only the network and the variables' storage are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a1",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-0000000000b1",
);

const TOKEN: string = "sk_live_51Hc9nM2eZvKYlo2C";

const CTX: StepExecutionContext = {
  projectId: PROJECT_ID,
  runbookExecutionId: new ObjectID("30000000-0000-4000-8000-0000000000c1"),
  runbookId: RUNBOOK_ID,
};

interface StoredVariable {
  value: string;
  isSecret: boolean;
}

// The project's variables, by "global:NAME" / "local:NAME".
let stored: Record<string, StoredVariable> = {};
let resolveCalls: Array<Record<string, unknown>> = [];

let lookupSpy: jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;
let requestSpy: jest.SpyInstance;
let responseData: unknown = "ok";

function httpStep(config: Partial<HttpRequestStepConfig>): RunbookStep {
  return {
    id: "s1",
    order: 0,
    type: RunbookStepType.HttpRequest,
    title: "Call the API",
    config: {
      url: "https://api.example.com/health",
      method: "POST",
      ...config,
    } as HttpRequestStepConfig,
  };
}

// The request axios was asked to send.
function sent(): Record<string, unknown> {
  expect(requestSpy).toHaveBeenCalledTimes(1);

  return requestSpy.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  stored = {
    "global:API_BASE": {
      value: "https://api.statuspage.example.com/v1",
      isSecret: false,
    },
    "global:STATUSPAGE_TOKEN": { value: TOKEN, isSecret: true },
    "local:COMPONENT": { value: "checkout", isSecret: false },
    "global:URL_KEY": { value: "p@ss/word+1=", isSecret: true },
  };
  resolveCalls = [];
  responseData = "ok";

  jest
    .spyOn(RunbookVariableResolver, "resolve")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        runbookId: ObjectID | null;
        references: Array<RunbookVariableReference>;
        access: unknown;
        includeValues: boolean;
      }): Promise<RunbookVariableResolution> => {
        resolveCalls.push(data as unknown as Record<string, unknown>);

        const resolution: RunbookVariableResolution = {
          variables: new Map(),
          problems: [],
          secretValues: [],
        };

        for (const reference of data.references) {
          const key: string = getRunbookVariableReferenceKey(reference);
          const variable: StoredVariable | undefined = stored[key];

          if (!variable) {
            resolution.problems.push({
              reference,
              reason: RunbookVariableProblemReason.Missing,
            });
            continue;
          }

          resolution.variables.set(key, {
            reference,
            isSecret: variable.isSecret,
            value: variable.value,
          });

          if (variable.isSecret) {
            resolution.secretValues.push(variable.value);
          }
        }

        return resolution;
      },
    );

  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as typeof lookupSpy;
  lookupSpy.mockImplementation((hostname: string) => {
    if (hostname === "metadata.internal.example.com") {
      return Promise.resolve([{ address: "169.254.169.254", family: 4 }]);
    }

    return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
  });

  requestSpy = jest.spyOn(axios, "request").mockImplementation((async () => {
    return {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      data: responseData,
    };
  }) as never);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an HTTP request step's variables are filled in", () => {
  test("in the URL, as written: a whole base URL, and a runbook's own variable", async () => {
    const result: StepRunResult = await runHttpStep(
      httpStep({
        url: "{{global.variables.API_BASE}}/components/{{local.variables.COMPONENT}}",
      }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(sent()["url"]).toBe(
      "https://api.statuspage.example.com/v1/components/checkout",
    );
  });

  test("in the headers: a secret token, as the step names it", async () => {
    await runHttpStep(
      httpStep({
        headersJson: JSON.stringify({
          Authorization: "OAuth {{global.variables.STATUSPAGE_TOKEN}}",
        }),
      }),
      CTX,
    );

    expect(sent()["headers"]).toEqual({ Authorization: `OAuth ${TOKEN}` });
  });

  test("in the body, inside its JSON's strings", async () => {
    await runHttpStep(
      httpStep({
        body: JSON.stringify({
          component: { name: "{{local.variables.COMPONENT}}", status: "ok" },
        }),
      }),
      CTX,
    );

    expect(sent()["data"]).toEqual({
      component: { name: "checkout", status: "ok" },
    });
  });

  test("they are read for the step's own project and runbook, as the server - values included", async () => {
    await runHttpStep(
      httpStep({ url: "{{global.variables.API_BASE}}/x" }),
      CTX,
    );

    expect(resolveCalls).toHaveLength(1);
    expect(String(resolveCalls[0]!["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(resolveCalls[0]!["runbookId"])).toBe(RUNBOOK_ID.toString());
    expect(resolveCalls[0]!["access"]).toEqual({ kind: "server" });
    expect(resolveCalls[0]!["includeValues"]).toBe(true);
    expect(resolveCalls[0]!["references"]).toEqual([
      { scope: RunbookVariableScope.Global, name: "API_BASE" },
    ]);
  });

  test("each variable is read once, however often the step names it", async () => {
    await runHttpStep(
      httpStep({
        url: "{{global.variables.API_BASE}}/{{global.variables.API_BASE}}",
        body: '{"a": "{{global.variables.API_BASE}}"}',
      }),
      CTX,
    );

    expect(resolveCalls[0]!["references"]).toEqual([
      { scope: RunbookVariableScope.Global, name: "API_BASE" },
    ]);
  });

  test("a step that names no variable reads none", async () => {
    await runHttpStep(httpStep({}), CTX);

    expect(resolveCalls).toHaveLength(0);
    expect(sent()["url"]).toBe("https://api.example.com/health");
  });
});

describe("a variable the step may not have", () => {
  test("fails the step, naming it, and nothing is sent", async () => {
    const result: StepRunResult = await runHttpStep(
      httpStep({ url: "{{global.variables.MISSING_BASE}}/x" }),
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('"MISSING_BASE"');
    expect(result.errorMessage).toMatch(
      /^This step names variables it cannot use, so it was not run: /,
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("its variables cannot be read: not sent, and said so", async () => {
    (
      RunbookVariableResolver.resolve as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new Error("database down");
    });

    const result: StepRunResult = await runHttpStep(
      httpStep({ url: "{{global.variables.API_BASE}}/x" }),
      CTX,
    );

    expect(result).toEqual({
      success: false,
      output: "",
      errorMessage: HTTP_STEP_VARIABLES_UNREAD_MESSAGE,
    });
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("outside a runbook's run, a step that names variables is refused", async () => {
    const result: StepRunResult = await runHttpStep(
      httpStep({ url: "{{global.variables.API_BASE}}/x" }),
    );

    expect(result).toEqual({
      success: false,
      output: "",
      errorMessage: HTTP_STEP_VARIABLES_OUTSIDE_RUN_MESSAGE,
    });
    expect(resolveCalls).toHaveLength(0);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

describe("what the step records hides every secret it was given", () => {
  test("a response that echoes the token", async () => {
    responseData = { headers: { Authorization: `OAuth ${TOKEN}` } };

    const result: StepRunResult = await runHttpStep(
      httpStep({
        headersJson: JSON.stringify({
          Authorization: "OAuth {{global.variables.STATUSPAGE_TOKEN}}",
        }),
      }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(result.output).not.toContain(TOKEN);
    expect(result.output).toContain(`OAuth ${REDACTED_SECRET_TEXT}`);
  });

  test("a response that echoes the URL, which carries the secret percent-encoded", async () => {
    responseData = {
      url: `https://api.example.com/hook?key=${encodeURIComponent("p@ss/word+1=")}`,
    };

    const result: StepRunResult = await runHttpStep(
      httpStep({
        url: "https://api.example.com/hook?key={{global.variables.URL_KEY}}",
      }),
      CTX,
    );

    expect(result.output).not.toContain(encodeURIComponent("p@ss/word+1="));
    expect(result.output).toContain(`key=${REDACTED_SECRET_TEXT}`);
  });

  test("an error that names the request, secret and all", async () => {
    requestSpy.mockImplementation(async () => {
      throw new Error(`connect ECONNREFUSED for Bearer ${TOKEN}`);
    });

    const result: StepRunResult = await runHttpStep(
      httpStep({
        headersJson: JSON.stringify({
          Authorization: "Bearer {{global.variables.STATUSPAGE_TOKEN}}",
        }),
      }),
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      `connect ECONNREFUSED for Bearer ${REDACTED_SECRET_TEXT}`,
    );
  });

  test("headers that do not read as JSON once filled say so without the secret", async () => {
    stored["global:STATUSPAGE_TOKEN"] = {
      value: `${TOKEN}, "x": `,
      isSecret: true,
    };

    const result: StepRunResult = await runHttpStep(
      httpStep({
        // A reference where a value goes: filled in as text.
        headersJson:
          '{ "Authorization": {{global.variables.STATUSPAGE_TOKEN}} }',
      }),
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/^Invalid headers JSON: /);
    expect(result.errorMessage).not.toContain(TOKEN);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a plain value is recorded as it came back", async () => {
    responseData = { component: "checkout" };

    const result: StepRunResult = await runHttpStep(
      httpStep({ body: '{"component": "{{local.variables.COMPONENT}}"}' }),
      CTX,
    );

    expect(result.output).toContain('"component": "checkout"');
  });
});

describe("the address guard checks the URL that is sent", () => {
  test("a variable that leads to an internal address is refused, and nothing is sent", async () => {
    stored["global:API_BASE"] = {
      value: "http://metadata.internal.example.com",
      isSecret: false,
    };

    const result: StepRunResult = await runHttpStep(
      httpStep({ url: "{{global.variables.API_BASE}}/latest/meta-data/" }),
      CTX,
    );

    expect(result.success).toBe(false);
    expect(requestSpy).not.toHaveBeenCalled();
    expect(lookupSpy).toHaveBeenCalledWith(
      "metadata.internal.example.com",
      expect.anything(),
    );
  });

  test("a variable that is a public address is pinned and sent", async () => {
    const result: StepRunResult = await runHttpStep(
      httpStep({ url: "{{global.variables.API_BASE}}/x" }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(lookupSpy).toHaveBeenCalledWith(
      "api.statuspage.example.com",
      expect.anything(),
    );
    expect(sent()["maxRedirects"]).toBe(0);
  });
});
