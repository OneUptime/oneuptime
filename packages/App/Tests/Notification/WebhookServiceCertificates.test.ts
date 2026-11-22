import WebhookService from "../../FeatureSet/Notification/Services/WebhookService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import SafeWebhookRequest, {
  WebhookTarget,
} from "Common/Server/Utils/SafeWebhookRequest";
import WebhookLog from "Common/Models/DatabaseModels/WebhookLog";
import {
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
  useDefaultCaRestored,
  useSelfSignedHttps,
} from "Common/Tests/Server/TestingUtils/SelfSignedHttpsFixture";
import {
  CaCertificateProblem,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE,
  HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE,
} from "Common/Types/Runbook/HttpStepCertificates";
import ObjectID from "Common/Types/ObjectID";
import { WebhookCertificates } from "Common/Types/Webhook/WebhookMessage";
import WebhookStatus from "Common/Types/WebhookStatus";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * THE NOTIFICATION SERVICE'S WEBHOOK SENDER, FOR A STEP WITH CERTIFICATE
 * SETTINGS (issue #10440).
 *
 * A playbook's Send Webhook hands its Allow self-signed certificates and CA
 * certificate through the Notification API to this sender, which applies
 * them to that request alone, checks the CA certificate before anything is
 * sent, and words a refused certificate as a Runbook HTTP step does. A
 * webhook with no such settings - every notification webhook - is checked
 * and worded as it always was. These send for real, to HTTPS servers on
 * this machine whose certificates nobody trusts (SelfSignedHttpsFixture);
 * the URL check is stood in for with the address it would approve.
 */

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

const { serve, proxy: startProxy } = useSelfSignedHttps();

const HOST: string = "playbook-hooks.example.test";
const PROJECT_ID: ObjectID = new ObjectID(
  "10440000-0000-4000-8000-000000000001",
);

let certificates: TestCertificates;
let canUse127002: boolean = false;
let logs: Array<WebhookLog> = [];

beforeAll(async () => {
  certificates = generateTestCertificates(HOST);
  canUse127002 = await canListenOn("127.0.0.2");
});

afterAll(() => {
  removeTestCertificates(certificates);
});

afterEach(() => {
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

async function serverWith(
  certificate: TestCertificate,
): Promise<LocalHttpsServer> {
  const server: LocalHttpsServer = await serve({
    host: canUse127002 ? "127.0.0.2" : "127.0.0.1",
    certificate,
  });

  jest
    .spyOn(SafeWebhookRequest, "resolveTarget")
    .mockImplementation(async (url: unknown): Promise<WebhookTarget> => {
      return {
        url: new globalThis.URL(String(url)),
        addresses: [{ address: server.host, family: 4 }],
      };
    });

  logs = [];
  jest.spyOn(WebhookLogService, "create").mockImplementation((async (data: {
    data: WebhookLog;
  }) => {
    logs.push(data.data);
    return data.data;
  }) as never);

  return server;
}

// One send; what it threw, if it threw.
async function send(
  server: LocalHttpsServer,
  settings: WebhookCertificates | undefined,
): Promise<Error | null> {
  try {
    await WebhookService.sendWebhook(
      {
        url: `https://${HOST}:${server.port}/soc`,
        eventType: "security.case.playbook",
        payload: { caseNumber: 7 },
        ...(settings ? { certificates: settings } : {}),
      },
      { projectId: PROJECT_ID },
    );
    return null;
  } catch (error) {
    return error as Error;
  }
}

describe("a step's settings, applied to its request", () => {
  test("Allow self-signed certificates on: delivered", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(
      await send(server, { allowSelfSignedCertificates: true }),
    ).toBeNull();
    expect(server.requests).toHaveLength(1);
    expect(logs[0]!.status).toBe(WebhookStatus.Success);
  });

  test("a CA certificate that signed the server's: delivered", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    expect(
      await send(server, {
        allowSelfSignedCertificates: false,
        caCertificate: certificates.caCertificate,
      }),
    ).toBeNull();
    expect(server.requests).toHaveLength(1);
  });

  test("neither: refused, saying which setting would let it through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const error: Error | null = await send(server, {
      allowSelfSignedCertificates: false,
    });

    expect(error?.message).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(logs[0]!.status).toBe(WebhookStatus.Error);
    expect(logs[0]!.statusMessage).toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(server.isUntouched).toBe(true);
  });

  test("a CA certificate of another key: refused, saying the step's CA certificate did not sign it", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const error: Error | null = await send(server, {
      caCertificate: certificates.otherSelfSigned.certificate,
    });

    expect(error?.message).toBe(HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE);
    expect(server.isUntouched).toBe(true);
  });

  test("a CA certificate that is not one: refused before anything is sent", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const error: Error | null = await send(server, {
      caCertificate:
        "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
    });

    expect(error?.message).toBe(
      HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[
        CaCertificateProblem.NotACertificate
      ],
    );
    expect(server.isUntouched).toBe(true);
  });

  test("behind an http:// proxy, the CA certificate reaches the server through the tunnel", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await startProxy({
      route: (authority: string): TunnelEnd | null => {
        return authority === `${HOST}:${server.port}`
          ? { host: server.host, port: server.port }
          : null;
      },
    });
    process.env["HTTPS_PROXY"] = proxy.url;

    expect(
      await send(server, { caCertificate: certificates.selfSigned.certificate }),
    ).toBeNull();
    expect(proxy.connects).toEqual([`${HOST}:${server.port}`]);
    expect(server.requests).toHaveLength(1);
  });
});

describe("a webhook with no settings, as every notification webhook", () => {
  test("is checked as it always was, and its error is the request's own", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const error: Error | null = await send(server, undefined);

    expect(error).not.toBeNull();
    // No step's settings to point to: not a step's words.
    expect(error?.message).not.toBe(HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE);
    expect(error?.message).toContain("self-signed certificate");
    expect(server.isUntouched).toBe(true);
  });
});
