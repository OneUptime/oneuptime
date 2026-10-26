/*
 * ---------------------------------------------------------------------------
 * Registration tells a Runner whether it is global.
 *
 * A global Runner - one the OneUptime server runs for every project - is
 * created by a master admin and started with its id and key, exactly as a
 * project's Runner is. Its first request, the ingest heartbeat, is answered
 * with isGlobalRunner, and the Runner adopts it before it claims anything.
 * ---------------------------------------------------------------------------
 */

import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (): Promise<void> => {},
    },
  };
});

const infoLog: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: (value: unknown) => {
        infoLog.push(String(value));
      },
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import Register, {
  GLOBAL_RUNNER_STARTED_MESSAGE,
  RegistrationRefusedError,
} from "../../Services/RegisterRunner";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger from "Common/Server/Utils/Logger";
import { GLOBAL_AI_AGENT_GONE_MESSAGE } from "Common/Types/Runner/GlobalAIAgentsGone";

function response(
  statusCode: number,
  data?: JSONObject,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(statusCode, data || {}, {});
}

beforeEach(() => {
  postMock.mockReset();
  infoLog.length = 0;
  GlobalRunnerMode.reset();
});

afterEach(() => {
  GlobalRunnerMode.reset();
  LocalCache.setString("RUNNER", "RUNNER_ID", "");
  RunnerCapabilities.setGrantedByServer({
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: false,
  });
});

describe("registering", () => {
  test("a Runner the server calls global becomes one, and says so once", async () => {
    postMock.mockResolvedValue(
      response(200, {
        status: "ok",
        isGlobalRunner: true,
        globalStepTypes: ["JavaScript"],
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
      }) as never,
    );

    await Register.registerRunner();

    expect(GlobalRunnerMode.isActive()).toBe(true);
    expect(
      infoLog.filter((line: string) => {
        return line.startsWith("This is a global Runner");
      }),
    ).toHaveLength(1);
    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
  });

  test("a Runner the server does not call global is a project's own", async () => {
    postMock.mockResolvedValue(
      response(200, {
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        },
      }) as never,
    );

    await Register.registerRunner();

    expect(GlobalRunnerMode.isActive()).toBe(false);
    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(true);
    expect(
      infoLog.some((line: string) => {
        return line.startsWith("This is a global Runner");
      }),
    ).toBe(false);
  });

  test("a value that is not a yes is not taken as one", async () => {
    postMock.mockResolvedValue(
      response(200, { status: "ok", isGlobalRunner: "yes" }) as never,
    );

    await Register.registerRunner();

    expect(GlobalRunnerMode.isActive()).toBe(false);
  });

  test("a global Runner the server grants code fixes takes them, and its start line says what it runs and never runs", async () => {
    postMock.mockResolvedValue(
      response(200, {
        status: "ok",
        isGlobalRunner: true,
        globalStepTypes: ["JavaScript"],
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: true,
        },
      }) as never,
    );

    await Register.registerRunner();

    expect(GlobalRunnerMode.isActive()).toBe(true);
    // Code fixes as granted; AI commands never, whatever the server says.
    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });

    const startLines: Array<string> = infoLog.filter((line: string) => {
      return line.startsWith("This is a global Runner");
    });

    expect(startLines).toEqual([GLOBAL_RUNNER_STARTED_MESSAGE]);
    expect(GLOBAL_RUNNER_STARTED_MESSAGE).toContain("JavaScript steps");
    expect(GLOBAL_RUNNER_STARTED_MESSAGE).toContain("AI code fixes");
    expect(GLOBAL_RUNNER_STARTED_MESSAGE).toContain(
      "none of a repository's commands",
    );
  });
});

describe("a Runner started with a global AI agent's id and key", () => {
  test("is told, as the server says it, that global Runners replaced it and what to start instead", async () => {
    // The ingest heartbeat knows no Runner of that id; the AI agent heartbeat knows the global agent.
    postMock
      .mockResolvedValueOnce(
        response(400, { message: "Invalid Runner ID or Key" }) as never,
      )
      .mockResolvedValueOnce(
        response(400, { message: GLOBAL_AI_AGENT_GONE_MESSAGE }) as never,
      );

    const errorLog: jest.Mock = logger.error as unknown as jest.Mock;
    errorLog.mockClear();

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });

    const registered: boolean = await Register.tryRegisterRunner({
      maxAttempts: 1,
    });

    expect(registered).toBe(false);
    // Nothing is granted: it takes no code-fix work it could only fail.
    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);

    const loggedErrors: Array<unknown> = errorLog.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0];
      },
    );
    const refusal: unknown = loggedErrors.find((value: unknown) => {
      return value instanceof Error;
    });

    expect(refusal).toBeInstanceOf(RegistrationRefusedError);
    expect((refusal as Error).message).toBe(GLOBAL_AI_AGENT_GONE_MESSAGE);
    expect((refusal as RegistrationRefusedError).statusCode).toBe(400);
  });

  test("another refusal of the AI agent heartbeat keeps its own words", async () => {
    postMock
      .mockResolvedValueOnce(
        response(400, { message: "Invalid Runner ID or Key" }) as never,
      )
      .mockResolvedValueOnce(
        response(400, {
          message: "Invalid AI Agent ID or AI Agent Key",
        }) as never,
      );

    const errorLog: jest.Mock = logger.error as unknown as jest.Mock;
    errorLog.mockClear();

    await Register.tryRegisterRunner({ maxAttempts: 1 });

    const refusal: unknown = errorLog.mock.calls
      .map((call: Array<unknown>) => {
        return call[0];
      })
      .find((value: unknown) => {
        return value instanceof Error;
      });

    expect((refusal as Error).message).not.toBe(GLOBAL_AI_AGENT_GONE_MESSAGE);
    expect((refusal as Error).message).toContain("Failed to register Runner");
  });
});
