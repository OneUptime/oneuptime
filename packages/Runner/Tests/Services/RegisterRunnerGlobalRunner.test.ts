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

import Register from "../../Services/RegisterRunner";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import LocalCache from "Common/Server/Infrastructure/LocalCache";

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
});
