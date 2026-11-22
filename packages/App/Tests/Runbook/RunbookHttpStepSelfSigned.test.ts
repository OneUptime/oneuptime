import DataSourceEgressGuard, {
  PinnedAgents,
  PinnedTarget,
  PinnedAgentOptions,
} from "Common/Server/Utils/DataSource/EgressGuard";
import RunbookVariableResolver, {
  RunbookVariableResolution,
} from "Common/Server/Utils/Runbook/RunbookVariableResolver";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  HttpRequestStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import {
  CaCertificatePemProblem,
  CaCertificateProblem,
  HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE,
  HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE,
  getHttpStepCaCertificateVariableProblemMessage,
  getHttpStepCertificateForAnotherHostMessage,
  getHttpStepCertificateNotFromVariableCaMessage,
  getHttpStepProxyCertificateMessage,
} from "Common/Types/Runbook/HttpStepCertificates";
import {
  RunbookVariableReference,
  RunbookVariableScope,
  getRunbookVariableReferenceKey,
} from "Common/Types/Runbook/RunbookVariableReference";
import {
  RunbookVariableProblemReason,
  describeRunbookVariableProblems,
} from "Common/Types/Runbook/RunbookVariableProblems";
import {
  MIN_REDACTED_SECRET_PIECE_LENGTH,
  REDACTED_SECRET_TEXT,
} from "Common/Types/Runbook/SecretOutputRedaction";
import {
  approveOnLoopback,
  canListenOn,
  clearOutboundProxyEnvironmentForEachTest,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import {
  LocalHttpsServer,
  TestCertificate,
  TestCertificates,
  TunnelEnd,
  TunnellingProxy,
  generateTestCertificates,
  removeTestCertificates,
  trustAsDefaultCa,
  useDefaultCaRestored,
  useSelfSignedHttps,
} from "Common/Tests/Server/TestingUtils/SelfSignedHttpsFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";
import https from "https";
import tls from "tls";
import {
  HTTP_STEP_VARIABLES_OUTSIDE_RUN_MESSAGE,
  runHttpStep,
  StepExecutionContext,
  StepRunResult,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * A RUNBOOK HTTP STEP TO A SERVER WITH A SELF-SIGNED CERTIFICATE (issue
 * #10277), against real HTTPS servers on this machine.
 *
 * "When adding an HTTP step to a Runbook, there is currently no option to
 * trust self-signed certificates." A step now takes, under More fields,
 * Allow self-signed certificates - no check at all, as a monitor's switch
 * of that name - and CA certificate, the safer way: the certificate it
 * trusts alone, still checking the host name and the dates
 * (Common/Types/Runbook/HttpStepCertificates).
 *
 *   - Off, a self-signed certificate is refused, nothing is sent, and the
 *     error says what in the step lets it through.
 *   - On, it goes through. So does a step that trusts the server's own
 *     certificate, or the CA that signed it - and that step still refuses a
 *     certificate for another host, which the switch does not.
 *   - Only that step's request: the next step, a step run beside it and any
 *     other request of the process are checked as before, and nothing
 *     global is set (NODE_TLS_REJECT_UNAUTHORIZED, the global agent, the
 *     default CAs).
 *   - Behind an outbound proxy the setting reaches the server through the
 *     tunnel, and never the proxy's own connection: an https:// proxy keeps
 *     the CAs the process trusts.
 *   - The CA certificate may be one runbook variable alone (#10441): the
 *     step trusts the variable's value, global or the runbook's own. A
 *     value that is another CA is refused by the server's handshake; one
 *     that is no certificate, holds a private key or is too long, and a
 *     variable that is not there, are refused before anything is sent,
 *     naming the variable and never its value. A secret one is hidden in
 *     what the step records. With the switch on, the variable is not read.
 *
 * The servers answer at a made-up name only the egress guard's check is
 * told of (approveOnLoopback), so only a request dialled at the address the
 * check approved reaches them. Only the variables' storage is stubbed
 * (RunbookVariableResolver.resolve), as RunbookHttpStepVariables stubs it.
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();
useDefaultCaRestored();

const { serve, proxy: startProxy } = useSelfSignedHttps();

const HOST: string = "runbook-tls.example.test";
// Another name for the same server, which its certificates do not list.
const OTHER_HOST: string = "runbook-tls-other.example.test";

let certificates: TestCertificates;
let canUse127002: boolean = false;

beforeAll(async () => {
  certificates = generateTestCertificates(HOST);
  canUse127002 = await canListenOn("127.0.0.2");
});

afterAll(() => {
  removeTestCertificates(certificates);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function serverAddress(): string {
  return canUse127002 ? "127.0.0.2" : "127.0.0.1";
}

// A server with `certificate`, which the made-up names resolve to.
async function serverWith(
  certificate: TestCertificate,
): Promise<LocalHttpsServer> {
  const server: LocalHttpsServer = await serve({
    host: serverAddress(),
    certificate,
  });

  approveOnLoopback({ [HOST]: [server.host], [OTHER_HOST]: [server.host] });

  return server;
}

function step(
  server: LocalHttpsServer,
  // As stored: a value of any type, as the API or Terraform may write it.
  config: Record<string, unknown> = {},
  host: string = HOST,
): RunbookStep {
  return {
    id: "s1",
    order: 0,
    type: RunbookStepType.HttpRequest,
    title: "Call the internal service",
    config: {
      url: `https://${host}:${server.port}/health`,
      method: "GET",
      ...config,
    } as HttpRequestStepConfig,
  };
}

// The code a plain request of this process, on the global agent, fails with.
async function plainRequestFailure(
  server: LocalHttpsServer,
): Promise<string | undefined> {
  return await new Promise<string | undefined>(
    (resolve: (code: string | undefined) => void) => {
      const request: ReturnType<typeof https.request> = https.request(
        {
          host: server.host,
          port: server.port,
          servername: HOST,
          path: "/health",
          method: "GET",
        },
        (response: { resume: () => void }) => {
          response.resume();
          resolve(undefined);
        },
      );

      request.on("error", (error: NodeJS.ErrnoException) => {
        resolve(error.code);
      });
      request.end();
    },
  );
}

describe("a server whose certificate it signed itself", () => {
  test("with the option off, is refused: nothing is sent, and the error points to the option", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: StepRunResult = await runHttpStep(step(server));

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(result.errorMessage).toContain(
      "turn on Allow self-signed certificates",
    );
    expect(result.errorMessage).toContain("in CA certificate");
    // Not Node's advice to whoever runs Node.
    expect(result.errorMessage).not.toContain("--use-system-ca");
    expect(result.output).toBe("");
    expect(server.isUntouched).toBe(true);
  });

  test("with Allow self-signed certificates on, goes through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: StepRunResult = await runHttpStep(
      step(server, { allowSelfSignedCertificates: true }),
    );

    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
    expect(result.output).toContain("Status: 200");
    expect(result.output).toContain('"answeredBy": "target"');
    expect(server.requests).toEqual([
      { method: "GET", url: "/health", host: `${HOST}:${server.port}` },
    ]);
  });

  test("with its own certificate as the step's CA certificate, goes through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: certificates.selfSigned.certificate }),
    );

    expect(result.success).toBe(true);
    expect(server.requests).toHaveLength(1);
  });

  test("with another certificate as the step's CA certificate, is refused, saying the CA certificate did not sign it", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: StepRunResult = await runHttpStep(
      step(server, {
        caCertificate: certificates.otherSelfSigned.certificate,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE,
    );
    expect(server.isUntouched).toBe(true);
  });

  test.each([
    ["the string 'true'", "true"],
    ["1", 1],
    ["false", false],
  ])(
    "with allowSelfSignedCertificates written as %s, is still checked",
    async (_what: string, value: unknown) => {
      const server: LocalHttpsServer = await serverWith(
        certificates.selfSigned,
      );

      const result: StepRunResult = await runHttpStep(
        step(server, { allowSelfSignedCertificates: value }),
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
      expect(server.isUntouched).toBe(true);
    },
  );

  test("with both set, the checks are off and the CA certificate is not used", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: StepRunResult = await runHttpStep(
      step(server, {
        allowSelfSignedCertificates: true,
        caCertificate: certificates.otherSelfSigned.certificate,
      }),
    );

    expect(result.success).toBe(true);
  });
});

describe("a server whose certificate a private CA signed", () => {
  test("is refused without the CA, and goes through with it", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    const refused: StepRunResult = await runHttpStep(step(server));

    expect(refused.success).toBe(false);
    expect(refused.errorMessage).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);

    const trusted: StepRunResult = await runHttpStep(
      step(server, { caCertificate: certificates.caCertificate }),
    );

    expect(trusted.success).toBe(true);
    expect(server.requests).toHaveLength(1);
  });

  test("with its CA, still refuses a certificate that is not for the URL's host", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: certificates.caCertificate }, OTHER_HOST),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      getHttpStepCertificateForAnotherHostMessage(OTHER_HOST),
    );
    expect(server.isUntouched).toBe(true);
  });

  test("Allow self-signed certificates checks the host name no more than the rest", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    const result: StepRunResult = await runHttpStep(
      step(server, { allowSelfSignedCertificates: true }, OTHER_HOST),
    );

    // Exactly why the CA certificate is the safer way.
    expect(result.success).toBe(true);
  });
});

describe("a CA certificate that is not one", () => {
  test.each([
    ["text", "hello", CaCertificateProblem.NotACertificate],
    [
      "PEM markers around something else",
      "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
      CaCertificateProblem.NotACertificate,
    ],
    ["a private key", "", CaCertificateProblem.PrivateKey],
  ])(
    "(%s) is refused before anything is sent",
    async (_what: string, text: string, problem: CaCertificateProblem) => {
      const server: LocalHttpsServer = await serverWith(
        certificates.selfSigned,
      );
      let agentsBuilt: number = 0;
      const realCreate: (
        target: PinnedTarget,
        options?: PinnedAgentOptions | undefined,
      ) => PinnedAgents = DataSourceEgressGuard.createPinnedAgents.bind(
        DataSourceEgressGuard,
      );

      jest
        .spyOn(DataSourceEgressGuard, "createPinnedAgents")
        .mockImplementation(
          (
            target: PinnedTarget,
            options?: PinnedAgentOptions | undefined,
          ): PinnedAgents => {
            agentsBuilt++;
            return realCreate(target, options);
          },
        );

      const result: StepRunResult = await runHttpStep(
        step(server, {
          caCertificate:
            problem === CaCertificateProblem.PrivateKey
              ? certificates.selfSigned.key
              : text,
        }),
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe(
        HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[problem],
      );
      expect(agentsBuilt).toBe(0);
      expect(server.isUntouched).toBe(true);
    },
  );

  test("is not read while Allow self-signed certificates is on", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: StepRunResult = await runHttpStep(
      step(server, { allowSelfSignedCertificates: true, caCertificate: "hi" }),
    );

    expect(result.success).toBe(true);
  });
});

describe("only that step's request", () => {
  test("the step after one with the option on is checked again", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const first: StepRunResult = await runHttpStep(
      step(server, { allowSelfSignedCertificates: true }),
    );
    const second: StepRunResult = await runHttpStep(step(server));

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.errorMessage).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(server.requests).toHaveLength(1);
  });

  test("of two steps run at once, only the one with the option goes through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const results: Array<StepRunResult> = await Promise.all([
      runHttpStep(step(server)),
      runHttpStep(step(server, { allowSelfSignedCertificates: true })),
      runHttpStep(step(server)),
      runHttpStep(
        step(server, { caCertificate: certificates.selfSigned.certificate }),
      ),
    ]);

    expect(
      results.map((result: StepRunResult): boolean => {
        return result.success;
      }),
    ).toEqual([false, true, false, true]);
    expect(server.requests).toHaveLength(2);
  });

  test("sets nothing global, and the process's other requests are checked as before", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const defaultCas: Array<string> = tls.getCACertificates("default");
    const globalAgentOptions: string = JSON.stringify({
      rejectUnauthorized: https.globalAgent.options.rejectUnauthorized,
      ca: https.globalAgent.options.ca,
    });

    expect(process.env["NODE_TLS_REJECT_UNAUTHORIZED"]).toBeUndefined();

    await runHttpStep(step(server, { allowSelfSignedCertificates: true }));
    await runHttpStep(
      step(server, { caCertificate: certificates.selfSigned.certificate }),
    );

    expect(process.env["NODE_TLS_REJECT_UNAUTHORIZED"]).toBeUndefined();
    expect(
      JSON.stringify({
        rejectUnauthorized: https.globalAgent.options.rejectUnauthorized,
        ca: https.globalAgent.options.ca,
      }),
    ).toBe(globalAgentOptions);
    expect(tls.getCACertificates("default")).toEqual(defaultCas);

    // A plain request, and one through axios, still refuse the certificate.
    expect(await plainRequestFailure(server)).toBe(
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    );

    const axiosFailure: unknown = await axios
      .get(`https://${server.host}:${server.port}/health`, { proxy: false })
      .then(
        () => {
          return undefined;
        },
        (error: { code?: string }) => {
          return error.code;
        },
      );

    expect(axiosFailure).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(server.requests).toHaveLength(2);
  });

  test("the step's own https agent carries the setting, its http agent none, and both are freed", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const built: Array<{ agents: PinnedAgents; destroyed: Array<string> }> = [];
    const realCreate: (
      target: PinnedTarget,
      options?: PinnedAgentOptions | undefined,
    ) => PinnedAgents = DataSourceEgressGuard.createPinnedAgents.bind(
      DataSourceEgressGuard,
    );

    jest
      .spyOn(DataSourceEgressGuard, "createPinnedAgents")
      .mockImplementation(
        (
          target: PinnedTarget,
          options?: PinnedAgentOptions | undefined,
        ): PinnedAgents => {
          const agents: PinnedAgents = realCreate(target, options);
          const entry: { agents: PinnedAgents; destroyed: Array<string> } = {
            agents,
            destroyed: [],
          };

          for (const kind of ["httpAgent", "httpsAgent"] as const) {
            const destroy: () => void = agents[kind].destroy.bind(agents[kind]);

            agents[kind].destroy = (): void => {
              entry.destroyed.push(kind);
              destroy();
            };
          }

          built.push(entry);
          return agents;
        },
      );

    await runHttpStep(step(server, { allowSelfSignedCertificates: true }));
    await runHttpStep(
      step(server, { caCertificate: certificates.selfSigned.certificate }),
    );
    await runHttpStep(step(server));

    expect(built).toHaveLength(3);

    const [skips, trusts, checks] = built as [
      { agents: PinnedAgents; destroyed: Array<string> },
      { agents: PinnedAgents; destroyed: Array<string> },
      { agents: PinnedAgents; destroyed: Array<string> },
    ];

    expect(skips.agents.httpsAgent.options.rejectUnauthorized).toBe(false);
    expect(skips.agents.httpsAgent.options.ca).toBeUndefined();
    expect(trusts.agents.httpsAgent.options.rejectUnauthorized).toBeUndefined();
    expect(trusts.agents.httpsAgent.options.ca).toBe(
      certificates.selfSigned.certificate.trim(),
    );
    expect(checks.agents.httpsAgent.options.rejectUnauthorized).toBeUndefined();
    expect(checks.agents.httpsAgent.options.ca).toBeUndefined();

    for (const entry of built) {
      // An http.Agent's options are not in its type: they are at run time.
      const httpOptions: Record<string, unknown> = (
        entry.agents.httpAgent as unknown as {
          options: Record<string, unknown>;
        }
      ).options;

      expect(httpOptions["rejectUnauthorized"]).toBeUndefined();
      expect(httpOptions["ca"]).toBeUndefined();
      expect(entry.destroyed.sort()).toEqual(["httpAgent", "httpsAgent"]);
    }
  });
});

describe("behind an outbound proxy", () => {
  // A proxy that tunnels the server's name and port to the server.
  async function proxyTo(
    server: LocalHttpsServer,
    certificate?: TestCertificate | undefined,
  ): Promise<TunnellingProxy> {
    return await startProxy({
      certificate,
      route: (authority: string): TunnelEnd | null => {
        return authority === `${HOST}:${server.port}`
          ? { host: server.host, port: server.port }
          : null;
      },
    });
  }

  test("an http:// proxy: the step's setting reaches the server through the tunnel", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server);
    process.env["HTTPS_PROXY"] = proxy.url;

    const refused: StepRunResult = await runHttpStep(step(server));

    expect(refused.success).toBe(false);
    expect(refused.errorMessage).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(server.isUntouched).toBe(true);

    const skipped: StepRunResult = await runHttpStep(
      step(server, { allowSelfSignedCertificates: true }),
    );
    const trusted: StepRunResult = await runHttpStep(
      step(server, { caCertificate: certificates.selfSigned.certificate }),
    );

    expect(skipped.success).toBe(true);
    expect(trusted.success).toBe(true);
    expect(proxy.connects).toEqual([
      `${HOST}:${server.port}`,
      `${HOST}:${server.port}`,
      `${HOST}:${server.port}`,
    ]);
    expect(server.requests).toHaveLength(2);
  });

  test("an https:// proxy the process trusts: the step's CA certificate is for the server alone", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server, certificates.proxy);
    trustAsDefaultCa(certificates.proxy.certificate);
    process.env["HTTPS_PROXY"] = proxy.url;

    /*
     * Had the step's CA certificate reached the proxy's connection, the
     * proxy's certificate - not signed by it - would have been refused.
     */
    const trusted: StepRunResult = await runHttpStep(
      step(server, { caCertificate: certificates.selfSigned.certificate }),
    );
    const skipped: StepRunResult = await runHttpStep(
      step(server, { allowSelfSignedCertificates: true }),
    );
    const checked: StepRunResult = await runHttpStep(step(server));

    expect(trusted.success).toBe(true);
    expect(skipped.success).toBe(true);
    expect(checked.success).toBe(false);
    expect(checked.errorMessage).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(proxy.connects).toHaveLength(3);
    expect(server.requests).toHaveLength(2);
  });

  test("an https:// proxy nobody trusts: Allow self-signed certificates never loosens the proxy's connection", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server, certificates.proxy);
    process.env["HTTPS_PROXY"] = proxy.url;

    const result: StepRunResult = await runHttpStep(
      step(server, { allowSelfSignedCertificates: true }),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      getHttpStepProxyCertificateMessage("DEPTH_ZERO_SELF_SIGNED_CERT"),
    );
    // The proxy's certificate was refused before anything was asked of it.
    expect(proxy.connects).toEqual([]);
    expect(server.isUntouched).toBe(true);
  });
});

/*
 * One CA, kept in a runbook variable, for many steps (#10441). The step's
 * CA certificate is "{{global.variables.INTERNAL_CA}}" (or a runbook's own
 * variable), and the step trusts the variable's value as it would a
 * certificate pasted in.
 */
describe("a CA certificate kept in a runbook variable", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10441000-0000-4000-8000-0000000000a1",
  );
  const RUNBOOK_ID: ObjectID = new ObjectID(
    "10441000-0000-4000-8000-0000000000b1",
  );

  const CTX: StepExecutionContext = {
    projectId: PROJECT_ID,
    runbookExecutionId: new ObjectID("10441000-0000-4000-8000-0000000000c1"),
    runbookId: RUNBOOK_ID,
  };

  const INTERNAL_CA: RunbookVariableReference = {
    scope: RunbookVariableScope.Global,
    name: "INTERNAL_CA",
  };

  interface StoredVariable {
    value: string;
    isSecret: boolean;
  }

  // The project's variables, by "global:NAME" / "local:NAME".
  let stored: Record<string, StoredVariable> = {};
  // Each time the step's variables were read, as it read them.
  let reads: Array<Record<string, unknown>> = [];

  function plain(value: string): StoredVariable {
    return { value, isSecret: false };
  }

  // The variables' storage, and nothing else: the resolver's answer to it.
  function useVariables(variables: Record<string, StoredVariable>): void {
    stored = variables;
    reads = [];

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
          reads.push(data as unknown as Record<string, unknown>);

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
  }

  // The TLS settings of every agent built for a request, as they were asked for.
  function watchAgents(): Array<TargetTlsOptions | undefined> {
    const asked: Array<TargetTlsOptions | undefined> = [];
    const realCreate: (
      target: PinnedTarget,
      targetTls?: TargetTlsOptions | undefined,
    ) => PinnedAgents =
      DataSourceEgressGuard.createPinnedAgentsForNodeHttp.bind(
        DataSourceEgressGuard,
      );

    jest
      .spyOn(DataSourceEgressGuard, "createPinnedAgentsForNodeHttp")
      .mockImplementation(
        (
          target: PinnedTarget,
          targetTls?: TargetTlsOptions | undefined,
        ): PinnedAgents => {
          asked.push(targetTls);
          return realCreate(target, targetTls);
        },
      );

    return asked;
  }

  // The lines of a PEM text that are its own: its base64, not its markers.
  function bodyLines(pem: string): Array<string> {
    return pem.split("\n").filter((line: string): boolean => {
      return line.trim().length > 0 && !line.startsWith("-----");
    });
  }

  /*
   * The lines of a secret that what a step records is searched for: a
   * shorter one could be anywhere in a text (SecretOutputRedaction).
   */
  function secretLines(pem: string): Array<string> {
    return bodyLines(pem).filter((line: string): boolean => {
      return line.trim().length >= MIN_REDACTED_SECRET_PIECE_LENGTH;
    });
  }

  test("from a global variable, lets the request through: the step trusts the variable's value", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);
    useVariables({ "global:INTERNAL_CA": plain(certificates.caCertificate) });
    const agents: Array<TargetTlsOptions | undefined> = watchAgents();

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: "{{global.variables.INTERNAL_CA}}" }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Status: 200");
    expect(server.requests).toHaveLength(1);

    // Read for the step's own project and runbook, as the server, once.
    expect(reads).toHaveLength(1);
    expect(String(reads[0]!["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(reads[0]!["runbookId"])).toBe(RUNBOOK_ID.toString());
    expect(reads[0]!["access"]).toEqual({ kind: "server" });
    expect(reads[0]!["includeValues"]).toBe(true);
    expect(reads[0]!["references"]).toEqual([INTERNAL_CA]);

    // The agent trusts the certificate, never the reference.
    expect(agents).toEqual([
      { rejectUnauthorized: true, ca: certificates.caCertificate.trim() },
    ]);
  });

  test("from the runbook's own variable, written with white space around it, too", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    useVariables({
      "local:LAB_CA": plain(certificates.selfSigned.certificate),
    });

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: "\n  {{local.variables.LAB_CA}} \n" }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(server.requests).toHaveLength(1);
    expect(reads[0]!["references"]).toEqual([
      { scope: RunbookVariableScope.Local, name: "LAB_CA" },
    ]);
  });

  test("still refuses a certificate that is not for the URL's host: the variable's CA checks everything a pasted one does", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);
    useVariables({ "global:INTERNAL_CA": plain(certificates.caCertificate) });

    const result: StepRunResult = await runHttpStep(
      step(
        server,
        { caCertificate: "{{global.variables.INTERNAL_CA}}" },
        OTHER_HOST,
      ),
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      getHttpStepCertificateForAnotherHostMessage(OTHER_HOST),
    );
    expect(server.isUntouched).toBe(true);
  });

  test("a variable that holds another CA is refused by the handshake, and the error says which variable to change", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    useVariables({
      "global:INTERNAL_CA": plain(certificates.otherSelfSigned.certificate),
    });

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: "{{global.variables.INTERNAL_CA}}" }),
      CTX,
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      getHttpStepCertificateNotFromVariableCaMessage(INTERNAL_CA),
    );
    expect(result.errorMessage).not.toBe(
      HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE,
    );
    expect(server.isUntouched).toBe(true);
  });

  test("each run reads the variable again: the CA set there once is the one every next run trusts", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const caStep: RunbookStep = step(server, {
      caCertificate: "{{global.variables.INTERNAL_CA}}",
    });

    useVariables({
      "global:INTERNAL_CA": plain(certificates.otherSelfSigned.certificate),
    });
    const before: StepRunResult = await runHttpStep(caStep, CTX);

    stored["global:INTERNAL_CA"] = plain(certificates.selfSigned.certificate);
    const after: StepRunResult = await runHttpStep(caStep, CTX);

    expect(before.success).toBe(false);
    expect(after.success).toBe(true);
    expect(server.requests).toHaveLength(1);
  });

  test.each([
    [
      "text that is no certificate",
      "my internal CA",
      CaCertificateProblem.NotACertificate,
    ],
    [
      "PEM markers around something else",
      "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
      CaCertificateProblem.NotACertificate,
    ],
    ["nothing", "", CaCertificateProblem.NotACertificate],
    [
      "another reference, which is never read again",
      "{{global.variables.OTHER_CA}}",
      CaCertificateProblem.NotACertificate,
    ],
    ["a private key", "key", CaCertificateProblem.PrivateKey],
    ["more than a CA certificate can be", "long", CaCertificateProblem.TooLong],
  ] as Array<[string, string, CaCertificatePemProblem]>)(
    "a variable that holds %s is refused before anything is sent, naming the variable and never its value",
    async (
      _what: string,
      written: string,
      problem: CaCertificatePemProblem,
    ) => {
      const value: string =
        written === "key"
          ? certificates.selfSigned.key
          : written === "long"
            ? certificates.caCertificate.repeat(
                Math.ceil(
                  HTTP_STEP_CA_CERTIFICATE_MAX_LENGTH /
                    certificates.caCertificate.length,
                ) + 1,
              )
            : written;
      const server: LocalHttpsServer = await serverWith(
        certificates.selfSigned,
      );
      useVariables({ "global:INTERNAL_CA": plain(value) });
      const agents: Array<TargetTlsOptions | undefined> = watchAgents();

      const result: StepRunResult = await runHttpStep(
        step(server, { caCertificate: "{{global.variables.INTERNAL_CA}}" }),
        CTX,
      );

      expect(result).toEqual({
        success: false,
        output: "",
        errorMessage: getHttpStepCaCertificateVariableProblemMessage({
          problem,
          reference: INTERNAL_CA,
        }),
      });
      expect(result.errorMessage).toContain('the variable "INTERNAL_CA"');

      if (value.trim()) {
        expect(result.errorMessage).not.toContain(value.trim());
      }

      for (const line of secretLines(value)) {
        expect(result.errorMessage).not.toContain(line);
      }

      expect(agents).toEqual([]);
      expect(server.isUntouched).toBe(true);
    },
  );

  test("a variable that is not there is refused as every missing variable is, and nothing is sent", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    useVariables({});
    const agents: Array<TargetTlsOptions | undefined> = watchAgents();

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: "{{global.variables.INTERNAL_CA}}" }),
      CTX,
    );

    expect(result).toEqual({
      success: false,
      output: "",
      errorMessage: describeRunbookVariableProblems([
        {
          reference: INTERNAL_CA,
          reason: RunbookVariableProblemReason.Missing,
        },
      ]),
    });
    expect(result.errorMessage).toContain(
      'there is no global variable named "INTERNAL_CA"',
    );
    expect(agents).toEqual([]);
    expect(server.isUntouched).toBe(true);
  });

  test("a secret variable's certificate never shows in what the step records", async () => {
    const server: LocalHttpsServer = await serve({
      host: serverAddress(),
      certificate: certificates.selfSigned,
      // A server that answers with the certificate, as an echo would.
      name: certificates.selfSigned.certificate,
    });
    approveOnLoopback({ [HOST]: [server.host] });
    useVariables({
      "global:INTERNAL_CA": {
        value: certificates.selfSigned.certificate,
        isSecret: true,
      },
    });

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: "{{global.variables.INTERNAL_CA}}" }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Status: 200");
    expect(result.output).toContain(REDACTED_SECRET_TEXT);

    const hidden: Array<string> = secretLines(
      certificates.selfSigned.certificate,
    );

    expect(hidden.length).toBeGreaterThan(0);

    for (const line of hidden) {
      expect(result.output).not.toContain(line);
    }
  });

  test("a plain variable's certificate is not a secret: what the server answers is recorded as it came", async () => {
    const server: LocalHttpsServer = await serve({
      host: serverAddress(),
      certificate: certificates.selfSigned,
      name: certificates.selfSigned.certificate,
    });
    approveOnLoopback({ [HOST]: [server.host] });
    useVariables({
      "global:INTERNAL_CA": plain(certificates.selfSigned.certificate),
    });

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: "{{global.variables.INTERNAL_CA}}" }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(result.output).not.toContain(REDACTED_SECRET_TEXT);

    for (const line of bodyLines(certificates.selfSigned.certificate)) {
      expect(result.output).toContain(line);
    }
  });

  test("is read with the step's other variables, in one read", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);
    useVariables({
      "global:INTERNAL_CA": plain(certificates.caCertificate),
      "local:PORT": plain(String(server.port)),
    });

    const result: StepRunResult = await runHttpStep(
      step(server, {
        url: `https://${HOST}:{{local.variables.PORT}}/health`,
        caCertificate: "{{global.variables.INTERNAL_CA}}",
      }),
      CTX,
    );

    expect(result.success).toBe(true);
    expect(reads).toHaveLength(1);
    expect(reads[0]!["references"]).toEqual([
      { scope: RunbookVariableScope.Local, name: "PORT" },
      INTERNAL_CA,
    ]);
  });

  test("with Allow self-signed certificates on, a variable that is not there fails nothing: it is not read", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    useVariables({ "local:PORT": plain(String(server.port)) });

    const alone: StepRunResult = await runHttpStep(
      step(server, {
        allowSelfSignedCertificates: true,
        caCertificate: "{{global.variables.GONE}}",
      }),
      CTX,
    );

    expect(alone.success).toBe(true);
    expect(reads).toEqual([]);

    // Beside a variable the step does use, only that one is read.
    const beside: StepRunResult = await runHttpStep(
      step(server, {
        url: `https://${HOST}:{{local.variables.PORT}}/health`,
        allowSelfSignedCertificates: true,
        caCertificate: "{{global.variables.GONE}}",
      }),
      CTX,
    );

    expect(beside.success).toBe(true);
    expect(reads).toHaveLength(1);
    expect(reads[0]!["references"]).toEqual([
      { scope: RunbookVariableScope.Local, name: "PORT" },
    ]);
    expect(server.requests).toHaveLength(2);
  });

  test("outside a runbook's run, a step whose CA certificate names a variable is refused", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    useVariables({
      "global:INTERNAL_CA": plain(certificates.selfSigned.certificate),
    });

    const result: StepRunResult = await runHttpStep(
      step(server, { caCertificate: "{{global.variables.INTERNAL_CA}}" }),
    );

    expect(result).toEqual({
      success: false,
      output: "",
      errorMessage: HTTP_STEP_VARIABLES_OUTSIDE_RUN_MESSAGE,
    });
    expect(reads).toEqual([]);
    expect(server.isUntouched).toBe(true);
  });

  test("a CA certificate stored with a variable beside a certificate is refused before anything is sent, and reads nothing", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    useVariables({
      "global:INTERNAL_CA": plain(certificates.selfSigned.certificate),
    });
    const agents: Array<TargetTlsOptions | undefined> = watchAgents();

    const result: StepRunResult = await runHttpStep(
      step(server, {
        caCertificate: `${certificates.selfSigned.certificate}\n{{global.variables.INTERNAL_CA}}`,
      }),
      CTX,
    );

    expect(result).toEqual({
      success: false,
      output: "",
      errorMessage:
        HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[
          CaCertificateProblem.VariableAmongText
        ],
    });
    expect(reads).toEqual([]);
    expect(agents).toEqual([]);
    expect(server.isUntouched).toBe(true);
  });
});
