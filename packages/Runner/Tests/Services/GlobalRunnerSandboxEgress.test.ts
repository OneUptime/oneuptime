/*
 * ---------------------------------------------------------------------------
 * A global Runner's JavaScript step, in the real sandbox.
 *
 * A global Runner runs the steps of every project that uses global Runners,
 * so the one way a step could reach past its own project is the network: the
 * host it runs on, the networks that host sits in, a cloud metadata
 * endpoint. RunbookExecutorGlobalRunner.test.ts checks the policy the
 * Runner hands the sandbox; this runs a claimed step through
 * Executor.executeAndReport with the REAL isolate (isolated-vm, VMRunner's
 * axios bridge and its SSRF guard), from the position a project's script
 * occupies, and checks what the server is told:
 *
 *   - a private address is refused before a socket opens, in a sentence
 *     that says what to do instead;
 *   - the host's own services (a loopback server stands in for them) and a
 *     cloud metadata endpoint are refused, and the loopback server never
 *     sees a request;
 *   - a step that asks for nothing outside the sandbox runs, and its
 *     returned value comes back as the step's output.
 *
 * Only the Runner's link to the server (RunnerClient) and its logger are
 * mocked. Nothing here needs a network.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../Services/RunnerClient", () => {
  return {
    __esModule: true,
    default: {
      submitJobResult: jest.fn().mockResolvedValue(true),
      jobHeartbeat: jest.fn().mockResolvedValue(true),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import Executor from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import http from "http";
import { AddressInfo } from "net";

jest.setTimeout(60_000);

const submitJobResult: jest.Mock = AgentClient.submitJobResult as jest.Mock;

const PRIVATE_ADDRESS_REFUSAL: string =
  "Request URL points to a private network address and is not allowed. Global Runners reach the internet only. Pick one of your own Runners for a step that calls an address on your network.";

const LOCAL_ADDRESS_REFUSAL: string =
  "Request URL points to a private, loopback, or link-local address and is not allowed.";

interface LoopbackServer {
  port: number;
  requestCount: () => number;
  close: () => Promise<void>;
}

// The global Runner's host's own services: a server only it can reach.
async function startLoopbackServer(): Promise<LoopbackServer> {
  let requests: number = 0;
  const server: http.Server = http.createServer(
    (_request: http.IncomingMessage, response: http.ServerResponse): void => {
      requests += 1;
      response.end("the host's own service");
    },
  );

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", (): void => {
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    requestCount: (): number => {
      return requests;
    },
    close: async (): Promise<void> => {
      await new Promise<void>((resolve: () => void): void => {
        server.close((): void => {
          resolve();
        });
      });
    },
  };
}

function step(script: string): ClaimedJob {
  return {
    jobId: "global-job-1",
    stepId: "global-step-1",
    origin: "Runbook",
    stepType: "JavaScript",
    script,
    timeoutInMs: 20_000,
  } as ClaimedJob;
}

// What the server was told about the step.
function reported(): Record<string, unknown> {
  expect(submitJobResult).toHaveBeenCalledTimes(1);
  return submitJobResult.mock.calls[0]![0] as Record<string, unknown>;
}

function fetchScript(url: string): string {
  return `const response = await axios.get(${JSON.stringify(url)});\nreturn response.status;`;
}

beforeEach(() => {
  submitJobResult.mockClear();
  submitJobResult.mockResolvedValue(true);
  GlobalRunnerMode.setFromServer(true);
  jest.spyOn(RunnerCapabilities, "resolve").mockReturnValue({
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: false,
  });
});

afterEach(() => {
  GlobalRunnerMode.reset();
  jest.restoreAllMocks();
});

describe("a JavaScript step on a global Runner, in the real sandbox", () => {
  test("a private address is refused, saying to pick one of your own Runners", async () => {
    await Executor.executeAndReport(step(fetchScript("http://10.20.30.40/")));

    const result: Record<string, unknown> = reported();

    expect(result["success"]).toBe(false);
    expect(String(result["errorMessage"])).toContain(PRIVATE_ADDRESS_REFUSAL);
  });

  test("the host's own services are refused, and never see a request", async () => {
    const host: LoopbackServer = await startLoopbackServer();

    try {
      await Executor.executeAndReport(
        step(fetchScript(`http://127.0.0.1:${host.port}/`)),
      );

      const result: Record<string, unknown> = reported();

      expect(result["success"]).toBe(false);
      expect(String(result["errorMessage"])).toContain(LOCAL_ADDRESS_REFUSAL);
      expect(host.requestCount()).toBe(0);
    } finally {
      await host.close();
    }
  });

  test("a cloud metadata endpoint is refused", async () => {
    await Executor.executeAndReport(
      step(fetchScript("http://169.254.169.254/latest/meta-data/")),
    );

    const result: Record<string, unknown> = reported();

    expect(result["success"]).toBe(false);
    expect(String(result["errorMessage"])).toContain(LOCAL_ADDRESS_REFUSAL);
  });

  test("a step that asks for nothing outside the sandbox runs, and returns its value", async () => {
    await Executor.executeAndReport(
      step('console.log("checked");\nreturn { sum: 40 + 2 };'),
    );

    const result: Record<string, unknown> = reported();

    expect(result["success"]).toBe(true);
    expect(String(result["output"])).toContain("checked");
    expect(String(result["output"])).toContain('"sum": 42');
  });
});
