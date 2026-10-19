import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * The change-events ingest endpoint and a key pinned to one service. The
 * key's Pinned Service Name promises that everything it writes lands under
 * that service; before this held for change events, a pinned key could put
 * a deploy marker on any service's charts, or a project-wide marker on
 * every chart.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
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
    },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  return {
    __esModule: true,
    default: { telemetryServiceFromName: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  return {
    __esModule: true,
    default: { submit: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { sendJsonObjectResponse: jest.fn() },
  };
});

import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import Response from "Common/Server/Utils/Response";
import ChangeEventsIngestService from "../../FeatureSet/Telemetry/Services/ChangeEventsIngestService";

type MockedFn = jest.Mock;

const telemetryServiceFromNameMock: MockedFn =
  OTelIngestService.telemetryServiceFromName as unknown as MockedFn;
const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;
const sendMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_IDS: Map<string, ObjectID> = new Map<string, ObjectID>();

function serviceIdFor(name: string): ObjectID {
  if (!SERVICE_IDS.has(name)) {
    SERVICE_IDS.set(name, ObjectID.generate());
  }
  return SERVICE_IDS.get(name)!;
}

function makeRequest(data: {
  body: unknown;
  pinnedServiceName?: string | null;
  headerServiceName?: string;
}): JSONObject {
  return {
    projectId: PROJECT_ID,
    body: data.body,
    headers: data.headerServiceName
      ? { "x-oneuptime-service-name": data.headerServiceName }
      : {},
    ingestionKeyPolicy: {
      pinnedServiceName: data.pinnedServiceName ?? null,
    },
  } as unknown as JSONObject;
}

async function ingest(request: JSONObject): Promise<Array<JSONObject>> {
  const next: MockedFn = jest.fn();

  await ChangeEventsIngestService.ingestChangeEvents(
    request as never,
    {} as never,
    next as never,
  );

  expect(next).not.toHaveBeenCalled();
  expect(sendMock).toHaveBeenCalledTimes(1);

  return submitMock.mock.calls[0]![1] as Array<JSONObject>;
}

function namesResolved(): Array<string> {
  return telemetryServiceFromNameMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { serviceName: string }).serviceName;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  telemetryServiceFromNameMock.mockImplementation((async (data: {
    serviceName: string;
  }) => {
    return {
      serviceName: data.serviceName,
      primaryEntityId: serviceIdFor(data.serviceName),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  }) as never);
  submitMock.mockReturnValue({ flushed: Promise.resolve() } as never);
});

describe("change-events ingest with a pinned key", () => {
  test("an unpinned key writes each event under the service it names", async () => {
    const rows: Array<JSONObject> = await ingest(
      makeRequest({
        body: {
          events: [
            { title: "Deploy 1", serviceName: "checkout" },
            { title: "Deploy 2", serviceName: "payments-api" },
          ],
        },
      }),
    );

    expect(namesResolved()).toEqual(["checkout", "payments-api"]);
    expect(
      rows.map((row: JSONObject) => {
        return row["primaryEntityId"];
      }),
    ).toEqual([
      serviceIdFor("checkout").toString(),
      serviceIdFor("payments-api").toString(),
    ]);
  });

  test("a pinned key writes every event under its service, whatever the body names", async () => {
    const rows: Array<JSONObject> = await ingest(
      makeRequest({
        pinnedServiceName: "web-frontend",
        body: {
          events: [
            { title: "Deploy 1", serviceName: "payments-api" },
            { title: "Deploy 2", serviceName: "checkout" },
          ],
        },
      }),
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row["primaryEntityId"]).toBe(
        serviceIdFor("web-frontend").toString(),
      );
    }
    expect(namesResolved()).not.toContain("payments-api");
    expect(namesResolved()).not.toContain("checkout");
  });

  test("a pinned key overrides the service-name header too", async () => {
    await ingest(
      makeRequest({
        pinnedServiceName: "web-frontend",
        headerServiceName: "payments-api",
        body: { title: "Deploy" },
      }),
    );

    expect(namesResolved()).toEqual(["web-frontend"]);
  });

  test("a pinned key cannot write a project-wide marker", async () => {
    const rows: Array<JSONObject> = await ingest(
      makeRequest({
        pinnedServiceName: "web-frontend",
        body: { events: [{ title: "Config change", eventType: "config" }] },
      }),
    );

    expect(rows[0]!["primaryEntityId"]).toBe(
      serviceIdFor("web-frontend").toString(),
    );
  });

  test("an unpinned key still writes a project-wide marker when no service is named", async () => {
    const rows: Array<JSONObject> = await ingest(
      makeRequest({ body: { events: [{ title: "Config change" }] } }),
    );

    expect(telemetryServiceFromNameMock).not.toHaveBeenCalled();
    expect(rows[0]!["primaryEntityId"]).toBeUndefined();
  });
});
