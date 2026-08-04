import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The pre-merge Runbook Agent hardcoded /runbook-agent-ingest. The Runner
 * merge renamed that mount to /runner-ingest, which meant an agent container
 * that had not been redeployed got a 404 on every heartbeat and every claim
 * the moment its server upgraded — the container kept running and logging, the
 * dashboard showed the Runner Disconnected, and steps targeting it failed with
 * TimedOut. Nothing in that chain names the cause.
 *
 * Both paths are mounted now. These tests pin the two properties that make
 * that a compatibility shim rather than a second, weaker door:
 *
 *   - the LEGACY path serves the SAME router, so authorization, capability
 *     checks and credential resolution are identical on both, and
 *   - the deprecation notice is once per agent, not once per request — an old
 *     agent polls every few seconds, and a line per poll would bury the very
 *     signal that tells an operator who still needs upgrading.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface MountedRoute {
  path: string;
  handlers: Array<unknown>;
}

const mounts: Array<MountedRoute> = [];

const mockRouter: Record<string, jest.Mock> = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};

const mockApp: { use: jest.Mock } = {
  use: jest.fn().mockImplementation((path: string, ...rest: Array<unknown>) => {
    mounts.push({ path, handlers: rest });
  }),
};

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getExpressApp: (): unknown => {
        return mockApp;
      },
      getRouter: (): unknown => {
        return mockRouter;
      },
    },
  };
});

const warnSpy: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      warn: (...args: Array<unknown>) => {
        return warnSpy(...args);
      },
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

/*
 * The queue plumbing pulls BullMQ in at import time and would try to reach
 * Redis on init; none of it is under test here.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: { Runbook: "Runbook" },
    default: { addJob: jest.fn() },
  };
});

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: { getWorker: jest.fn() },
  };
});

jest.mock("Common/Server/Services/RunbookRuleEngineService", () => {
  return {
    __esModule: true,
    default: { registerExecutionEnqueuer: jest.fn() },
  };
});

// Imported after the hoisted mocks above.
import RunbookFeatureSet from "../../FeatureSet/Runbook/Index";

const CURRENT_PATH: string = "/runner-ingest";
const LEGACY_PATH: string = "/runbook-agent-ingest";

function mountFor(path: string): MountedRoute {
  const mount: MountedRoute | undefined = mounts.find((m: MountedRoute) => {
    return m.path === path;
  });

  if (!mount) {
    throw new Error(
      `Nothing mounted at ${path}. Mounted: ${mounts
        .map((m: MountedRoute) => {
          return m.path;
        })
        .join(", ")}`,
    );
  }

  return mount;
}

function legacyMiddleware(): RouterFunction {
  return mountFor(LEGACY_PATH).handlers[0] as RouterFunction;
}

function callLegacy(data: {
  body?: Record<string, unknown> | undefined;
  headers?: Record<string, string> | undefined;
}): { nextCalled: boolean } {
  const req: ExpressRequest = {
    body: data.body,
    headers: data.headers || {},
  } as unknown as ExpressRequest;

  let nextCalled: boolean = false;
  const next: NextFunction = (): void => {
    nextCalled = true;
  };

  legacyMiddleware()(req, {} as ExpressResponse, next);

  return { nextCalled };
}

describe("the legacy runbook-agent-ingest path", () => {
  beforeAll(async () => {
    mounts.length = 0;
    await RunbookFeatureSet.init!();
  });

  afterEach(() => {
    warnSpy.mockClear();
  });

  test("the current path is still mounted", () => {
    expect(mountFor(CURRENT_PATH)).toBeDefined();
  });

  /*
   * The whole point: an un-redeployed agent keeps working. If this mount ever
   * disappears, every pre-merge agent goes dark on the next server upgrade.
   */
  test("the pre-merge path is mounted too", () => {
    expect(mountFor(LEGACY_PATH)).toBeDefined();
  });

  /*
   * Same router on both paths. A legacy mount that reached a different or
   * older handler would be a second door with its own authorization
   * behaviour — exactly what a compatibility shim must not become.
   */
  test("both paths serve the same ingress router", () => {
    const current: MountedRoute = mountFor(CURRENT_PATH);
    const legacy: MountedRoute = mountFor(LEGACY_PATH);

    // The legacy mount is [deprecationMiddleware, router].
    expect(legacy.handlers).toHaveLength(2);

    const currentRouter: unknown =
      current.handlers[current.handlers.length - 1];
    const legacyRouter: unknown = legacy.handlers[legacy.handlers.length - 1];

    expect(legacyRouter).toBe(currentRouter);
  });

  test("a legacy request is always passed through to the router", () => {
    expect(callLegacy({ body: { agentId: "agent-a" } }).nextCalled).toBe(true);
  });

  test("the first call from an agent logs an actionable upgrade notice", () => {
    callLegacy({ body: { agentId: "agent-warned-once" } });

    expect(warnSpy).toHaveBeenCalledTimes(1);

    const message: string = String(warnSpy.mock.calls[0]![0]);
    expect(message).toContain("agent-warned-once");
    // Names the image and both renamed variables, so the log IS the runbook.
    expect(message).toContain("oneuptime/runner");
    expect(message).toContain("ONEUPTIME_RUNNER_ID");
    expect(message).toContain("ONEUPTIME_RUNNER_KEY");
  });

  /*
   * An old agent polls every few seconds. Logging per request would be tens of
   * thousands of lines a day per agent and would bury the signal.
   */
  test("repeated calls from the same agent log only once", () => {
    callLegacy({ body: { agentId: "agent-repeat" } });
    callLegacy({ body: { agentId: "agent-repeat" } });
    callLegacy({ body: { agentId: "agent-repeat" } });

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("a different agent gets its own notice", () => {
    callLegacy({ body: { agentId: "agent-one" } });
    callLegacy({ body: { agentId: "agent-two" } });

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  // The old client sends credentials in the body OR as headers.
  test("the agent is identified from the x-agent-id header too", () => {
    callLegacy({ headers: { "x-agent-id": "header-agent" } });

    expect(String(warnSpy.mock.calls[0]![0])).toContain("header-agent");
  });

  /*
   * The id is read off an unauthenticated request purely to name the agent, so
   * a malformed one must not throw before the router gets to reject it.
   */
  test.each([
    ["no body at all", undefined],
    ["an empty body", {}],
    ["a non-string agentId", { agentId: { nested: true } }],
  ])(
    "%s still passes through without throwing",
    (_label: string, body: Record<string, unknown> | undefined) => {
      expect(() => {
        return callLegacy({ body });
      }).not.toThrow();

      expect(callLegacy({ body }).nextCalled).toBe(true);
    },
  );
});
