/*
 * A REQUEST ONEUPTIME ANSWERED AS A VERIFICATION HANDSHAKE SAYS SO, ON THE
 * MONITOR.
 *
 * https://github.com/OneUptime/oneuptime/issues/8429
 *
 * The endpoint answers Azure Event Grid's validation code itself now, and the
 * job it queues names the service it answered (answeredVerification). The
 * worker keeps that on the request it evaluates - and so on the monitor's
 * latest request, in both copies - so the monitor's summary no longer asks
 * someone to open the validation link for a subscription OneUptime already
 * validated. A value no service is named by is dropped.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      // The key's lookup, by its value, through findOneBy above (#9012).
      findOneByPresentedKey: jest.requireActual<{
        default: unknown;
      }>("./Helpers/PresentedKeyByValue").default,
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  type ActualStore = {
    default: { getReceivedAtAsOf: (receivedAt: Date, checkedAt: Date) => Date };
  };

  const actual: ActualStore = jest.requireActual(
    "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore",
  ) as ActualStore;

  return {
    __esModule: true,
    default: {
      track: jest.fn((input: { receivedAt: Date }) => {
        return Promise.resolve(new Date(input.receivedAt));
      }),
      getReceivedAtAsOf: actual.default.getReceivedAtAsOf,
    },
  };
});

// Every request counts here: the secret requirement has suites of its own.
jest.mock("Common/Server/Utils/Monitor/IncomingRequestSecretGate", () => {
  return {
    __esModule: true,
    default: {
      decideInWorker: async (data: {
        requestHeaders?: Record<string, string> | undefined;
      }): Promise<{
        verdict: string;
        isRefused: boolean;
        requestHeaders: Record<string, string>;
      }> => {
        return {
          verdict: "NotRequired",
          isRefused: false,
          requestHeaders: data.requestHeaders || {},
        };
      },
    },
  };
});

import { processIncomingRequestFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorRecordEvidence from "Common/Server/Utils/Monitor/MonitorRecordEvidence";
import MonitorService from "Common/Server/Services/MonitorService";
import { toStorableJson } from "Common/Server/Utils/Database/PostgresStorableValue";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import WebhookVerificationProvider from "Common/Types/Monitor/IncomingMonitor/WebhookVerificationProvider";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const SECRET_KEY: string = "8429dddd-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const MONITOR_ID: string = "9f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

function activeMonitor(): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.isArchived = false;
  row.disableActiveMonitoring = false;
  row.disableActiveMonitoringBecauseOfManualIncident = false;
  row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  return row;
}

// As the worker sees a job: the JSON the queue stored.
function job(answeredVerification?: unknown): IncomingRequestIngestJobData {
  return {
    secretKey: SECRET_KEY,
    requestHeaders: { "aeg-event-type": "SubscriptionValidation" },
    requestBody: [
      {
        eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
        data: { validationCode: "512d38b6-c7b8-40c8-89fe-f46f9e9622b6" },
      },
    ] as never,
    requestMethod: "POST",
    ingestionTimestamp: new Date().toISOString() as unknown as Date,
    ...(answeredVerification !== undefined
      ? { answeredVerification: answeredVerification as never }
      : {}),
  };
}

async function evaluated(
  data: IncomingRequestIngestJobData,
): Promise<IncomingMonitorRequest> {
  await processIncomingRequestFromQueue(data);

  expect(monitorResource).toHaveBeenCalledTimes(1);

  return monitorResource.mock.calls[0]![0] as IncomingMonitorRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  findOneBy.mockResolvedValue(activeMonitor() as never);
});

describe("the request the worker evaluates", () => {
  test("names the service the endpoint answered", async () => {
    expect(
      (await evaluated(job(WebhookVerificationProvider.AzureEventGrid)))
        .answeredVerification,
    ).toBe(WebhookVerificationProvider.AzureEventGrid);
  });

  test.each(Object.values(WebhookVerificationProvider))(
    "names %s, when the endpoint answered it",
    async (provider: WebhookVerificationProvider) => {
      expect((await evaluated(job(provider))).answeredVerification).toBe(
        provider,
      );
    },
  );

  test("names nothing for a request the endpoint did not answer as one", async () => {
    const request: IncomingMonitorRequest = await evaluated(job());

    expect("answeredVerification" in request).toBe(false);
  });

  test("drops a value no service is named by", async () => {
    const request: IncomingMonitorRequest = await evaluated(
      job("Totally Real Service"),
    );

    expect("answeredVerification" in request).toBe(false);
  });
});

describe("the monitor's latest request", () => {
  test("keeps it in the copy people read, and in the copy as it came", async () => {
    const request: IncomingMonitorRequest = await evaluated(
      job(WebhookVerificationProvider.AzureEventGrid),
    );

    expect(
      MonitorRecordEvidence.toStoredLatestRequest({
        request: request,
        keepResponseContent: true,
      }).answeredVerification,
    ).toBe(WebhookVerificationProvider.AzureEventGrid);
    expect(
      MonitorRecordEvidence.toStoredLatestRequest({
        request: request,
        keepResponseContent: false,
      }).answeredVerification,
    ).toBe(WebhookVerificationProvider.AzureEventGrid);
    expect(
      (toStorableJson(request) as unknown as IncomingMonitorRequest)
        .answeredVerification,
    ).toBe(WebhookVerificationProvider.AzureEventGrid);
  });
});
