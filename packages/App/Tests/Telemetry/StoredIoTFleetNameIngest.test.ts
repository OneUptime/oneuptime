import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import {
  IOT_FLEET_NAME_ATTRIBUTE_KEYS,
  stampStoredIoTFleetName,
} from "../../FeatureSet/Telemetry/Utils/StoredIoTFleetName";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A fleet is found by its name case aside, but a reading kept the case its
 * sender used: a gateway sending `iot.fleet.name=warehouse` landed in the
 * fleet "Warehouse", and the fleet's pages - which filter on the stored
 * name exactly - left its readings out. Ingest now writes the stored name
 * onto the reading before its rows are built.
 */

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

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const FLEET_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "iot/warehouse";

const OTHER_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type IngestTestMethods = Record<string, any>;

const ingest: IngestTestMethods =
  OtelMetricsIngestService as unknown as IngestTestMethods;

let rows: Array<JSONObject>;
let findFleet: jest.Mock;

function fleetReading(fleetName: string): JSONObject {
  return {
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: SERVICE_NAME } },
        { key: "iot.fleet.name", value: { stringValue: fleetName } },
      ],
    },
    scopeMetrics: [
      {
        metrics: [
          {
            name: "humidity_percent",
            unit: "%",
            gauge: {
              dataPoints: [
                {
                  asDouble: 41.5,
                  timeUnixNano: `${Date.now()}000000`,
                  attributes: [
                    { key: "device.id", value: { stringValue: "door-1" } },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function ingestReadings(resources: JSONArray): Promise<void> {
  await OtelMetricsIngestService.processMetricsFromQueue({
    projectId: PROJECT_ID,
    body: { resourceMetrics: resources },
    headers: {},
  } as unknown as TelemetryRequest);
}

function storedFleetNames(): Array<unknown> {
  return rows.map((row: JSONObject) => {
    return (row["attributes"] as JSONObject)["resource.iot.fleet.name"];
  });
}

beforeEach(() => {
  rows = [];
  (ingest["storedIoTFleetNames"] as Map<string, unknown>).clear();

  jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
  for (const method of OTHER_DISCOVERY_METHODS) {
    jest.spyOn(ingest, method).mockResolvedValue(null);
  }
  // The fleet the name resolves to, as fleet find-or-create resolves it.
  jest.spyOn(ingest, "discoverMatchedIoTFleet").mockResolvedValue(FLEET_ID);
  findFleet = jest
    .spyOn(IoTFleetService, "findOneById")
    .mockResolvedValue({ name: "Warehouse" } as never) as unknown as jest.Mock;
  jest.spyOn(ingest, "flushIoTSnapshotBuffers").mockResolvedValue(undefined);
  jest.spyOn(ingest, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as TelemetryServiceMetadata);
  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
    projectRules: [],
    rulesByServiceId: new Map(),
  });
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (_target: FanInInsertTarget, batch: Array<JSONObject>) => {
        rows.push(...batch);
        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ingest stamps the stored fleet name on a reading", () => {
  test("a reading sent for 'warehouse' is stored under the fleet's own 'Warehouse'", async () => {
    await ingestReadings([fleetReading("warehouse")]);

    expect(rows.length).toBeGreaterThan(0);
    expect(storedFleetNames()).toEqual(
      rows.map(() => {
        return "Warehouse";
      }),
    );
    expect(findFleet).toHaveBeenCalledTimes(1);
  });

  test("the spaces around a name go too", async () => {
    await ingestReadings([fleetReading("  WAREHOUSE ")]);

    expect(storedFleetNames()).toEqual(
      rows.map(() => {
        return "Warehouse";
      }),
    );
  });

  test("the stored name is read once a minute per fleet, not per reading", async () => {
    await ingestReadings([
      fleetReading("warehouse"),
      fleetReading("WareHouse"),
    ]);
    await ingestReadings([fleetReading("warehouse")]);

    expect(findFleet).toHaveBeenCalledTimes(1);
    expect(new Set(storedFleetNames())).toEqual(new Set(["Warehouse"]));
  });

  test("a name that is not the stored fleet's in another case is left as sent", async () => {
    // The fleet was renamed since the id cache last read it.
    findFleet.mockResolvedValue({ name: "Warehouse-EU" } as never);

    await ingestReadings([fleetReading("warehouse")]);

    expect(storedFleetNames()).toEqual(
      rows.map(() => {
        return "warehouse";
      }),
    );
  });

  test("a failed read leaves the name as sent, and the readings are still stored", async () => {
    findFleet.mockRejectedValue(new Error("connection refused"));

    await ingestReadings([fleetReading("warehouse")]);

    expect(rows.length).toBeGreaterThan(0);
    expect(storedFleetNames()).toEqual(
      rows.map(() => {
        return "warehouse";
      }),
    );
  });
});

describe("stampStoredIoTFleetName", () => {
  function attributes(key: string, value: unknown): JSONArray {
    return [
      { key: "service.name", value: { stringValue: "iot/warehouse" } },
      { key, value: { stringValue: value } as JSONObject },
    ] as JSONArray;
  }

  test("rewrites both keys a fleet name rides under, and nothing else", () => {
    for (const key of IOT_FLEET_NAME_ATTRIBUTE_KEYS) {
      const list: JSONArray = attributes(key, "warehouse");

      expect(
        stampStoredIoTFleetName({ attributes: list, storedName: "Warehouse" }),
      ).toBe(true);
      expect(
        ((list[1] as JSONObject)["value"] as JSONObject)["stringValue"],
      ).toBe("Warehouse");
      // service.name is the sender's.
      expect(
        ((list[0] as JSONObject)["value"] as JSONObject)["stringValue"],
      ).toBe("iot/warehouse");
    }
  });

  test("changes nothing when the name already matches, differs, is not text, or no name is stored", () => {
    for (const [sent, stored] of [
      ["Warehouse", "Warehouse"],
      ["dock", "Warehouse"],
      [42, "Warehouse"],
      ["warehouse", "  "],
    ] as Array<[unknown, string]>) {
      const list: JSONArray = attributes("iot.fleet.name", sent);

      expect(
        stampStoredIoTFleetName({ attributes: list, storedName: stored }),
      ).toBe(false);
      expect(
        ((list[1] as JSONObject)["value"] as JSONObject)["stringValue"],
      ).toBe(sent);
    }
  });
});
