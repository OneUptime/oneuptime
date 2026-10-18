import RunnerAuthorization from "../../FeatureSet/Runbook/Middleware/RunnerAuthorization";
import { RunnerExpressRequest } from "../../FeatureSet/Runbook/Types/Request";
import RunnerService from "Common/Server/Services/RunnerService";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The runbook protocol refuses a Runner key the repository ships.
 *
 * A Runner proves who it is on every /runner-ingest request - its heartbeat,
 * the jobs it claims (with the runbook secrets and credentials substituted
 * in), the results it reports - with its id and key, which
 * RunnerAuthorization.isAuthorizedAgent checks before any of those routes
 * runs. A key that is public in the repository (blank, "secret", or a
 * config.example.env placeholder) never gets a caller past it, though a row
 * from before the write rule may hold exactly that key: the request is
 * refused as an invalid key would be, req.runner is never set, and no route
 * runs. A Runner with its real key is let through as before.
 *
 * The middleware, RunnerService and its query are real; the table is held in
 * memory.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
    },
  };
});

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUNNER_ID: string = "22222222-2222-4222-8222-222222222222";
const REAL_KEY: string = "33333333-3333-4333-8333-333333333333";

const SHIPPED_KEYS: Array<[string, string]> = [
  ["the old fallback", "secret"],
  ["the placeholder", "please-change-this-to-random-value"],
  ["a bundled probe's placeholder", "probe-2-please-change-this-to-random-value"],
  ["a placeholder with something added", "please-change-this-to-random-value-x"],
  ["a padded placeholder", "  please-change-this-to-random-value  "],
  ["a key of spaces", "    "],
];

function runnerRow(key: string): StoredRow {
  return {
    _id: RUNNER_ID,
    projectId: PROJECT_ID,
    name: "Site A Runner",
    key: key,
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: false,
  };
}

interface Outcome {
  passed: boolean;
  runner: unknown;
  refusal: unknown;
}

// The request a Runner sends: its id and key in the body, or in the headers.
async function authorize(data: {
  body?: JSONObject;
  headers?: JSONObject;
}): Promise<Outcome> {
  const req: RunnerExpressRequest = {
    body: data.body || {},
    headers: data.headers || {},
    params: {},
    query: {},
  } as unknown as RunnerExpressRequest;
  const next: jest.Mock = jest.fn();

  await RunnerAuthorization.isAuthorizedAgent(
    req,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    passed: next.mock.calls.length === 1,
    runner: (req as unknown as { runner?: unknown }).runner,
    refusal: errorCalls[0]?.[2],
  };
}

let table: InMemoryTable;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RunnerAuthorization refuses a shipped Runner key", () => {
  test.each(SHIPPED_KEYS)(
    "%s in the body: refused as an invalid key, though the Runner's row holds it, and no route runs",
    async (_label: string, key: string) => {
      table = useInMemoryTable(RunnerService, [runnerRow(key)]);

      const outcome: Outcome = await authorize({
        body: { agentId: RUNNER_ID, agentKey: key },
      });

      expect(outcome.passed).toBe(false);
      expect(outcome.runner).toBeUndefined();
      expect(outcome.refusal).toBeInstanceOf(BadDataException);
      expect((outcome.refusal as Error).message).toBe(
        "Invalid agentId or agentKey",
      );
      // Refused before the table is read.
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );

  test.each(SHIPPED_KEYS)(
    "%s in the x-agent-key header: refused the same way",
    async (_label: string, key: string) => {
      table = useInMemoryTable(RunnerService, [runnerRow(key)]);

      const outcome: Outcome = await authorize({
        headers: { "x-agent-id": RUNNER_ID, "x-agent-key": key },
      });

      expect(outcome.passed).toBe(false);
      expect(outcome.runner).toBeUndefined();
      expect((outcome.refusal as Error).message).toBe(
        "Invalid agentId or agentKey",
      );
    },
  );

  test("the refusal says nothing a wrong key would not: it never names the shipped values", async () => {
    table = useInMemoryTable(RunnerService, [runnerRow("secret")]);

    const shipped: Outcome = await authorize({
      body: { agentId: RUNNER_ID, agentKey: "secret" },
    });

    jest.clearAllMocks();
    table = useInMemoryTable(RunnerService, [runnerRow(REAL_KEY)]);

    const wrong: Outcome = await authorize({
      body: {
        agentId: RUNNER_ID,
        agentKey: "44444444-4444-4444-8444-444444444444",
      },
    });

    expect((shipped.refusal as Error).message).toBe(
      (wrong.refusal as Error).message,
    );
  });
});

describe("a Runner with its real key", () => {
  test("is let through, with its row on the request", async () => {
    table = useInMemoryTable(RunnerService, [runnerRow(REAL_KEY)]);

    const outcome: Outcome = await authorize({
      body: { agentId: RUNNER_ID, agentKey: REAL_KEY },
    });

    expect(outcome.passed).toBe(true);
    expect(outcome.refusal).toBeUndefined();
    expect(
      (outcome.runner as { id?: { toString: () => string } }).id?.toString(),
    ).toBe(RUNNER_ID);
    expect(table.repository.find).toHaveBeenCalled();
  });

  test("is let through when it sends its id and key as headers", async () => {
    table = useInMemoryTable(RunnerService, [runnerRow(REAL_KEY)]);

    const outcome: Outcome = await authorize({
      headers: { "x-agent-id": RUNNER_ID, "x-agent-key": REAL_KEY },
    });

    expect(outcome.passed).toBe(true);
  });

  test("another Runner's key, or none, still gets nowhere", async () => {
    table = useInMemoryTable(RunnerService, [runnerRow(REAL_KEY)]);

    const wrong: Outcome = await authorize({
      body: {
        agentId: RUNNER_ID,
        agentKey: "55555555-5555-4555-8555-555555555555",
      },
    });
    expect(wrong.passed).toBe(false);

    jest.clearAllMocks();

    const missing: Outcome = await authorize({
      body: { agentId: RUNNER_ID },
    });
    expect(missing.passed).toBe(false);
    expect((missing.refusal as Error).message).toBe(
      "agentId or agentKey is missing",
    );
  });
});
