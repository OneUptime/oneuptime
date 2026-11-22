import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { assertSendWebhookCertificatesParse } from "../../../../Server/Services/SecurityPlaybookService";
import WebhookService from "../../../../Server/Services/WebhookService";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import EmptyResponseData from "../../../../Types/API/EmptyResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import WebhookMessage from "../../../../Types/Webhook/WebhookMessage";
import API from "../../../../Utils/API";
import {
  TestCertificates,
  generateTestCertificates,
  removeTestCertificates,
} from "../../TestingUtils/SelfSignedHttpsFixture";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A PLAYBOOK'S SEND WEBHOOK, WITH THE CERTIFICATE SETTINGS OF ITS OWN
 * (issue #10440).
 *
 * The step takes a Runbook HTTP step's two settings, Allow self-signed
 * certificates and CA certificate. A save parses the CA certificate as the
 * server parses one (assertSendWebhookCertificatesParse); the step hands
 * both to WebhookService, whose body carries them to the Notification
 * API's sender (Notification/Services/WebhookService, which applies them to
 * the request alone); and a send that failed says why.
 */

const URL_TEXT: string = "https://hooks.internal.example/soc";

let certificates: TestCertificates;

beforeAll(() => {
  certificates = generateTestCertificates("hooks.internal.example");
});

afterAll(() => {
  removeTestCertificates(certificates);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sendWebhookStep(config: JSONObject): SecurityPlaybookStep {
  return parseSecurityPlaybookSteps([
    {
      id: "step-1",
      action: SecurityPlaybookActionType.SendWebhook,
      config: { url: URL_TEXT, ...config },
    },
  ])[0]!;
}

function contextFor(step: SecurityPlaybookStep): PlaybookStepContext {
  return {
    projectId: ObjectID.generate(),
    runId: ObjectID.generate(),
    playbookName: "Contain a phishing case",
    step,
    stepNumber: 1,
    securityCase: new SecurityCase(),
  };
}

// The step run, WebhookService answering as `answer` says; what it was handed.
async function runStep(
  config: JSONObject,
  answer: HTTPResponse<EmptyResponseData> | HTTPErrorResponse,
): Promise<{ outcome: PlaybookStepOutcome; sent: Array<WebhookMessage> }> {
  const sent: Array<WebhookMessage> = [];

  jest
    .spyOn(SecurityPlaybookActions, "getCasePayload")
    .mockResolvedValue({ caseNumber: 7 });
  jest
    .spyOn(WebhookService, "sendWebhook")
    .mockImplementation(
      async (
        message: WebhookMessage,
      ): Promise<HTTPResponse<EmptyResponseData> | HTTPErrorResponse> => {
        sent.push(message);
        return answer;
      },
    );

  const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
    contextFor(sendWebhookStep(config)),
  );

  return { outcome, sent };
}

const DELIVERED: HTTPResponse<EmptyResponseData> =
  new HTTPResponse<EmptyResponseData>(200, {}, {});

describe("what the step hands WebhookService", () => {
  test("with neither setting, the receiver's certificate is checked as every request's", async () => {
    const { outcome, sent } = await runStep({}, DELIVERED);

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(URL_TEXT);
    expect(sent[0]!.certificates).toEqual({
      allowSelfSignedCertificates: false,
    });
  });

  test("Allow self-signed certificates on", async () => {
    const { sent } = await runStep(
      { allowSelfSignedCertificates: true },
      DELIVERED,
    );

    expect(sent[0]!.certificates).toEqual({
      allowSelfSignedCertificates: true,
    });
  });

  test("a CA certificate of its own", async () => {
    const { sent } = await runStep(
      { caCertificate: certificates.caCertificate },
      DELIVERED,
    );

    expect(sent[0]!.certificates).toEqual({
      allowSelfSignedCertificates: false,
      caCertificate: certificates.caCertificate.trim(),
    });
  });
});

describe("a send that failed", () => {
  test("says why, as the sender said it", async () => {
    const reason: string =
      "The server's certificate is self-signed, or signed by a CA OneUptime does not trust, so the request was not sent. Under the step's More fields, paste that CA's certificate in CA certificate, or turn on Allow self-signed certificates.";

    const { outcome } = await runStep(
      {},
      new HTTPErrorResponse(400, { error: reason }, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(
      `The webhook could not be sent to ${URL_TEXT}: ${reason}`,
    );
  });

  test("with nothing said, says only that it could not be sent", async () => {
    const { outcome } = await runStep({}, new HTTPErrorResponse(500, {}, {}));

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(`The webhook could not be sent to ${URL_TEXT}.`);
  });
});

describe("WebhookService's body for the Notification API", () => {
  test("carries the step's settings, and nothing for a webhook that has none", async () => {
    const bodies: Array<JSONObject> = [];

    jest
      .spyOn(API, "post")
      .mockImplementation((async (request: { data?: JSONObject }) => {
        bodies.push(request.data || {});
        return DELIVERED;
      }) as never);

    await WebhookService.sendWebhook({
      url: URL_TEXT,
      eventType: "security.case.playbook",
      payload: {},
      certificates: {
        allowSelfSignedCertificates: false,
        caCertificate: certificates.caCertificate,
      },
    });
    await WebhookService.sendWebhook({
      url: URL_TEXT,
      eventType: "incident.created",
      payload: {},
    });

    expect(bodies[0]!["certificates"]).toEqual({
      allowSelfSignedCertificates: false,
      caCertificate: certificates.caCertificate,
    });
    expect("certificates" in bodies[1]!).toBe(false);
  });
});

describe("a save parses the CA certificate as the server parses one", () => {
  test("a certificate passes", () => {
    expect(() => {
      assertSendWebhookCertificatesParse([
        sendWebhookStep({ caCertificate: certificates.caCertificate }),
      ]);
    }).not.toThrow();
  });

  test("PEM markers around something that is no certificate are refused, naming the step", () => {
    expect(() => {
      assertSendWebhookCertificatesParse([
        sendWebhookStep({
          caCertificate:
            "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
        }),
      ]);
    }).toThrow(
      /^Step 1 \(.+\): the CA certificate is not a certificate in PEM\./,
    );
  });

  test("with the switch on, the CA certificate is not used, so not parsed", () => {
    const step: SecurityPlaybookStep = sendWebhookStep({
      allowSelfSignedCertificates: true,
    });
    // As a step stored before the save check would hold one.
    (step.config as JSONObject)["caCertificate"] =
      "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----";

    expect(() => {
      assertSendWebhookCertificatesParse([step]);
    }).not.toThrow();
  });
});
