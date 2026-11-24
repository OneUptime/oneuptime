import DataSourceEgressGuard, {
  PinnedAgents,
  PinnedTarget,
  TargetTlsOptions,
} from "Common/Server/Utils/DataSource/EgressGuard";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  HttpRequestStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import {
  LocalHttpServer,
  PROXY_HOST_NAME,
  approveOnLoopback,
  canListenOn,
  clearOutboundProxyEnvironmentForEachTest,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import {
  HTTP_STEP_MAX_RESPONSE_BYTES,
  runHttpStep,
  StepRunResult,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * A RUNBOOK HTTP STEP ON THE NETWORK: behind an outbound proxy (issue
 * #8873), and with an answer larger than it reads (#8875).
 *
 * The step's target is checked by the egress guard and its socket pinned
 * to the addresses the check approved. Behind HTTPS_PROXY / HTTP_PROXY /
 * ALL_PROXY the step goes through the proxy, as every request of the
 * worker does - and a proxy named by host name used to be dialled at the
 * target's address instead, because the pinned lookup answered the proxy's
 * name too. A host in NO_PROXY is dialled directly, pinned. Its agents
 * open the tunnel, not axios (createPinnedAgentsForNodeHttp, #10277), so a
 * proxy that will not open one is said to have refused. The step reads
 * at most 10 MB of an answer (its output keeps 50 KB of it), so a step
 * pointed at an endpoint that streams forever no longer fills the
 * worker's memory.
 *
 * These run the step for real against a proxy and servers on this machine
 * (Common's OutboundProxyFixture says how): the proxy at 127.0.0.1 named
 * "localhost", the target approved at 127.0.0.2 under a name only the
 * check knows.
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

let canUse127002: boolean = false;

beforeAll(async () => {
  canUse127002 = await canListenOn("127.0.0.2");
});

afterEach(() => {
  jest.restoreAllMocks();
});

const HOST: string = "runbook-target.example.test";

function step(url: string): RunbookStep {
  return {
    id: "s1",
    order: 0,
    type: RunbookStepType.HttpRequest,
    title: "Call the service",
    config: {
      url: url,
      method: "GET",
    } as HttpRequestStepConfig,
  };
}

function targetAddress(): string {
  return canUse127002 ? "127.0.0.2" : "127.0.0.1";
}

async function proxyAndTarget(): Promise<{
  proxy: LocalHttpServer;
  target: LocalHttpServer;
}> {
  const proxy: LocalHttpServer = await serve({ name: "proxy" });
  const target: LocalHttpServer = await serve({
    host: targetAddress(),
    name: "target",
  });

  approveOnLoopback({ [HOST]: [target.host] });

  return { proxy, target };
}

// An answer of exactly `bytes` bytes.
function answerWithBytes(server: LocalHttpServer, bytes: number): void {
  server.handler = (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("x".repeat(bytes));
  };
}

describe("a Runbook HTTP step behind an outbound proxy", () => {
  test("over http goes to a proxy named by host name, which is asked for the target by name", async () => {
    const { proxy, target } = await proxyAndTarget();
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    const url: string = `http://${HOST}:${target.port}/health`;

    const result: StepRunResult = await runHttpStep(step(url));

    expect(result.success).toBe(true);
    expect(result.output).toContain('"answeredBy": "proxy"');
    expect(
      proxy.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual([url]);
    expect(target.isUntouched).toBe(true);
  });

  test("over https is tunnelled through a proxy named by host name, to the target by name", async () => {
    const { proxy, target } = await proxyAndTarget();
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const result: StepRunResult = await runHttpStep(
      step(`https://${HOST}/health`),
    );

    /*
     * The proxy refuses every tunnel here, and the step reports what it
     * said - as the proxy's answer, never as the target's (it read "HTTP
     * 403" while axios opened the tunnel), and without the proxy's address,
     * which is the operator's.
     */
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      `The outbound proxy did not open a connection to ${HOST}:443: it answered HTTP/1.1 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
    );
    expect(result.errorMessage).not.toContain(String(proxy.port));
    expect(proxy.connects).toEqual([`${HOST}:443`]);
    expect(target.isUntouched).toBe(true);
  });

  test("a host in NO_PROXY is dialled directly, at the address the guard approved", async () => {
    const { proxy, target } = await proxyAndTarget();
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = HOST;

    const result: StepRunResult = await runHttpStep(
      step(`http://${HOST}:${target.port}/health`),
    );

    // The name resolves nowhere real: only the pin reaches the server.
    expect(result.success).toBe(true);
    expect(result.output).toContain('"answeredBy": "target"');
    expect(target.requests).toHaveLength(1);
    expect(proxy.isUntouched).toBe(true);
  });

  test("its agents are freed once the request is over", async () => {
    const { target } = await proxyAndTarget();
    const destroyed: Array<string> = [];
    const realCreate: (
      target: PinnedTarget,
      tls?: TargetTlsOptions | undefined,
    ) => PinnedAgents =
      DataSourceEgressGuard.createPinnedAgentsForNodeHttp.bind(
        DataSourceEgressGuard,
      );

    jest
      .spyOn(DataSourceEgressGuard, "createPinnedAgentsForNodeHttp")
      .mockImplementation(
        (
          pinnedTarget: PinnedTarget,
          tls?: TargetTlsOptions | undefined,
        ): PinnedAgents => {
          const agents: PinnedAgents = realCreate(pinnedTarget, tls);
          const destroyHttp: () => void = agents.httpAgent.destroy.bind(
            agents.httpAgent,
          );
          const destroyHttps: () => void = agents.httpsAgent.destroy.bind(
            agents.httpsAgent,
          );

          agents.httpAgent.destroy = (): void => {
            destroyed.push("http");
            destroyHttp();
          };
          agents.httpsAgent.destroy = (): void => {
            destroyed.push("https");
            destroyHttps();
          };

          return agents;
        },
      );

    await runHttpStep(step(`http://${HOST}:${target.port}/health`));

    expect(destroyed.sort()).toEqual(["http", "https"]);
  });
});

describe("how much of an answer a Runbook HTTP step reads", () => {
  test("is 10 MB, as a workflow's API steps", () => {
    expect(HTTP_STEP_MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024);
  });

  test("an answer larger than that fails the step, unread, and says so", async () => {
    const { target } = await proxyAndTarget();
    answerWithBytes(target, HTTP_STEP_MAX_RESPONSE_BYTES + 1);

    const result: StepRunResult = await runHttpStep(
      step(`http://${HOST}:${target.port}/export`),
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe("");
    expect(result.errorMessage).toBe(
      "The answer was larger than 10\u00A0MB, so it was not read.",
    );
  });

  test("an answer of exactly 10 MB is read, and its output keeps the first 50 KB", async () => {
    const { target } = await proxyAndTarget();
    answerWithBytes(target, HTTP_STEP_MAX_RESPONSE_BYTES);

    const result: StepRunResult = await runHttpStep(
      step(`http://${HOST}:${target.port}/export`),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Status: 200");
    expect(result.output.endsWith("... [output truncated]")).toBe(true);
    expect(Buffer.byteLength(result.output)).toBeLessThan(60_000);
  });
});
