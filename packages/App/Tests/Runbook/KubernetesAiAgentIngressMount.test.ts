import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The Runbook feature set mounts the Kubernetes AI agent's router at
 * /kubernetes-ai-agent-ingest — its own path, next to the Runner's and never
 * inside it: the agent is not a Runner, and nothing that authorizes a Runner
 * request may apply to it (or the other way round).
 * ---------------------------------------------------------------------------
 */

interface MountedRoute {
  path: string;
  handlers: Array<unknown>;
}

const mounts: Array<MountedRoute> = [];

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
      // A fresh recorder per router, so the mounted routers can be told apart.
      getRouter: (): unknown => {
        const uris: Array<string> = [];
        return {
          uris,
          get: jest.fn(),
          put: jest.fn(),
          delete: jest.fn(),
          post: jest.fn().mockImplementation((uri: string) => {
            uris.push(uri);
          }),
        };
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

// BullMQ and Redis are pulled in at import time; none of it is under test.
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

function routesOf(router: unknown): Array<string> {
  return ((router as { uris?: Array<string> }).uris || []).slice().sort();
}

describe("the Kubernetes AI agent's mount", () => {
  beforeAll(async () => {
    mounts.length = 0;
    await RunbookFeatureSet.init!();
  });

  test("is mounted at /kubernetes-ai-agent-ingest, straight to its router", () => {
    const mount: MountedRoute = mountFor("/kubernetes-ai-agent-ingest");

    // No path-specific middleware in front: the router authorizes itself.
    expect(mount.handlers).toHaveLength(1);
    expect(routesOf(mount.handlers[0])).toEqual(
      [
        "/claim-next-job",
        "/disconnect",
        "/heartbeat",
        "/job/:jobId/heartbeat",
        "/job/:jobId/result",
        "/register",
      ].sort(),
    );
  });

  test("is not the Runner's router, and the Runner's mounts do not serve it", () => {
    const agentRouter: unknown = mountFor("/kubernetes-ai-agent-ingest")
      .handlers[0];
    const runnerMount: MountedRoute = mountFor("/runner-ingest");
    const runnerRouter: unknown =
      runnerMount.handlers[runnerMount.handlers.length - 1];

    expect(agentRouter).not.toBe(runnerRouter);
    expect(routesOf(runnerRouter)).not.toContain("/register");
  });

  test("the Runner's mounts are still there", () => {
    expect(mountFor("/runner-ingest")).toBeDefined();
    expect(mountFor("/runbook-agent-ingest")).toBeDefined();
  });

  test("is mounted once", () => {
    expect(
      mounts.filter((m: MountedRoute) => {
        return m.path === "/kubernetes-ai-agent-ingest";
      }),
    ).toHaveLength(1);
  });
});
