import { RESOURCE_AI_AGENT_INGEST_PATH } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The Runbook feature set mounts the resource AI agents' router at
 * /resource-ai-agent-ingest — its own path, next to the Runner's and the
 * Kubernetes AI agent's and never inside either: the agent is not a Runner,
 * and nothing that authorizes a Runner (or a Kubernetes AI agent) request
 * may apply to it, or the other way round.
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

describe("the resource AI agents' mount", () => {
  beforeAll(async () => {
    mounts.length = 0;
    await RunbookFeatureSet.init!();
  });

  test("is mounted at the path the agent calls (RESOURCE_AI_AGENT_INGEST_PATH), straight to its router", () => {
    expect(RESOURCE_AI_AGENT_INGEST_PATH).toBe("/resource-ai-agent-ingest");

    const mount: MountedRoute = mountFor(RESOURCE_AI_AGENT_INGEST_PATH);

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

  test("is neither the Runner's router nor the Kubernetes AI agent's", () => {
    const resourceRouter: unknown = mountFor(RESOURCE_AI_AGENT_INGEST_PATH)
      .handlers[0];
    const runnerMount: MountedRoute = mountFor("/runner-ingest");
    const runnerRouter: unknown =
      runnerMount.handlers[runnerMount.handlers.length - 1];
    const kubernetesRouter: unknown = mountFor("/kubernetes-ai-agent-ingest")
      .handlers[0];

    expect(resourceRouter).not.toBe(runnerRouter);
    expect(resourceRouter).not.toBe(kubernetesRouter);
  });

  test("the other mounts are still there", () => {
    expect(mountFor("/runner-ingest")).toBeDefined();
    expect(mountFor("/runbook-agent-ingest")).toBeDefined();
    expect(mountFor("/kubernetes-ai-agent-ingest")).toBeDefined();
  });

  test("is mounted once", () => {
    expect(
      mounts.filter((m: MountedRoute) => {
        return m.path === RESOURCE_AI_AGENT_INGEST_PATH;
      }),
    ).toHaveLength(1);
  });
});
