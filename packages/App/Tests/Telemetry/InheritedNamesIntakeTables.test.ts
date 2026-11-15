/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time; nothing queue-related is under test here.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

// See ServerlessFunctionNameStamp.test.ts: nothing password-related here.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

// The resolver, as it is, with what it is handed kept for the GCP tests.
jest.mock("Common/Types/Cloud/CloudMonitoredResource", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Types/Cloud/CloudMonitoredResource",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    resolveCloudMonitoredResource: jest.fn(
      actual["resolveCloudMonitoredResource"] as (
        ...args: Array<unknown>
      ) => unknown,
    ),
  };
});

import VercelLogDrain from "../../FeatureSet/Telemetry/Utils/VercelLogDrain";
import {
  CloudLoggingEntry,
  buildCloudLoggingResourceLogs,
  readCloudLoggingEntry,
} from "../../FeatureSet/Telemetry/Utils/GcpPubSub/CloudLoggingEntries";
import DatadogIntake, {
  DatadogLogsTranslation,
} from "../../FeatureSet/Telemetry/Utils/Compatible/DatadogIntake";
import SnmpTrapLogWriter from "../../FeatureSet/Telemetry/Services/SnmpTrapLogWriter";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import { computeSyslogEntry } from "./Helpers/FakePubSub";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import LogService from "Common/Server/Services/LogService";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { resolveCloudMonitoredResource } from "Common/Types/Cloud/CloudMonitoredResource";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { readOwnValue } from "Common/Utils/LookupTable";
import {
  INHERITED_PROPERTY_NAMES,
  INHERITED_PROPERTY_NAME_SPELLINGS,
} from "Common/Tests/Helpers/InheritedNames";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ISSUES #8220 AND #8221: TELEMETRY INTAKES AND THE NAMES EVERY OBJECT
 * INHERITS.
 *
 * Each intake below read a sender's text - a level, a resource type, an
 * OID, a scrub rule's pattern type - as the key of a table kept as a plain
 * object, or copied a sender's JSON with a spread. A plain object answers
 * for every name it inherits ("constructor" is the Object function,
 * "__proto__" the prototype every object shares), and a spread, compiled
 * to Object.assign on this code's ES2017 target, drops a key named
 * "__proto__". The tables are Maps now or read as their own keys, and the
 * copies keep every key:
 *
 *   - Vercel: a level named so is no severity, so the log keeps no severity
 *     number of a function's (it had none at all);
 *   - GCP: a resource type named so is no alias, so the resolver is handed
 *     the type itself, not a function;
 *   - Datadog: a log's field named "__proto__" is one of its attributes;
 *   - SNMP: a trap OID written so has no well-known name, so no function's
 *     source goes into the trap's name or its log's body;
 *   - scrub rules: a saved pattern type named so is no built-in pattern.
 */

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();
const OBJECT_FUNCTION_KEYS: Array<string> =
  Object.getOwnPropertyNames(Object).sort();

afterEach(() => {
  jest.restoreAllMocks();
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
  expect(Object.getOwnPropertyNames(Object).sort()).toEqual(
    OBJECT_FUNCTION_KEYS,
  );
});

// OTLP attributes as the logs ingest stores them: TelemetryUtil.getAttributes.
function storedAttributes(attributes: unknown): JSONObject {
  return TelemetryUtil.getAttributes({
    prefixKeysWithString: "",
    items: (attributes as JSONArray) || [],
  }) as JSONObject;
}

describe("Vercel's log levels (VercelLogDrain)", () => {
  test.each(INHERITED_PROPERTY_NAME_SPELLINGS)(
    "a record whose level is %s gets no severity number, and its level as the severity text",
    (level: string) => {
      const record: JSONObject = VercelLogDrain.toLogRecord(
        { level: level, message: "request failed", timestamp: 1700000000000 },
        "1700000000000000000",
      );

      expect(record["severityNumber"]).toBe(0);
      expect(record["severityText"]).toBe(level.toUpperCase());
    },
  );

  test("the levels Vercel writes still map to OpenTelemetry's severities", () => {
    expect(
      ["info", "warning", "error", "fatal", "debug"].map((level: string) => {
        const record: JSONObject = VercelLogDrain.toLogRecord(
          { level: level, message: "m" },
          "1700000000000000000",
        );

        return [record["severityNumber"], record["severityText"]];
      }),
    ).toEqual([
      [9, "INFO"],
      [13, "WARN"],
      [17, "ERROR"],
      [21, "FATAL"],
      [0, "DEBUG"],
    ]);
  });
});

describe("GCP Cloud Logging's resource types (CloudLoggingEntries)", () => {
  function buildFor(resourceType: string): void {
    const entry: CloudLoggingEntry | null = readCloudLoggingEntry(
      computeSyslogEntry({
        resource: {
          type: resourceType,
          labels: { instance_id: "4876543210987654321", zone: "us-central1-a" },
        },
      }),
    );

    expect(entry).not.toBeNull();

    buildCloudLoggingResourceLogs({
      entry: entry!,
      serviceName: "Production Google Cloud",
      connectionId: "33333333-3333-4333-8333-333333333333",
      observedAtMs: Date.UTC(2026, 10, 15, 10, 0, 0),
    });
  }

  function resolvedResourceTypes(): Array<unknown> {
    return (
      resolveCloudMonitoredResource as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): unknown => {
      return ((call[0] as JSONObject)["attributes"] as JSONObject)[
        "resource.gcp.resource_type"
      ];
    });
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "an entry filed under a resource type named %s hands the resolver that type, not what an object inherits",
    (name: string) => {
      (resolveCloudMonitoredResource as unknown as jest.Mock).mockClear();

      buildFor(name);

      expect(resolvedResourceTypes()).toEqual([name]);
    },
  );

  test("an aliased type is still read as the type its metrics are filed under", () => {
    (resolveCloudMonitoredResource as unknown as jest.Mock).mockClear();

    buildFor("http_load_balancer");
    buildFor("gce_instance");

    expect(resolvedResourceTypes()).toEqual(["https_lb_rule", "gce_instance"]);
  });
});

describe("Datadog's log fields (DatadogIntake)", () => {
  function recordsOf(body: string): Array<JSONObject> {
    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(body, {
      nowInMs: 1700000100000,
    });

    expect(translation.logs).not.toBeNull();

    return (
      (translation.logs as JSONObject)["resourceLogs"] as Array<JSONObject>
    ).flatMap((resource: JSONObject): Array<JSONObject> => {
      return (
        ((resource["scopeLogs"] as Array<JSONObject>)[0]![
          "logRecords"
        ] as Array<JSONObject>) || []
      );
    });
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "a log's field named %s is one of its attributes, beside the fields read as its message and status",
    (name: string) => {
      const [record] = recordsOf(
        `[{"message":"payment failed","status":"error",${JSON.stringify(name)}:"own ${name}","team":"payments"}]`,
      );
      const attributes: JSONObject = storedAttributes(record!["attributes"]);

      expect(record!["severityText"]).toBe("ERROR");
      expect(readOwnValue(attributes, name)).toBe(`own ${name}`);
      expect(readOwnValue(attributes, "team")).toBe("payments");
      expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    },
  );

  test("the issue's case: a field named __proto__ is stored, and an object under it is flattened by its keys", () => {
    const [text, object] = recordsOf(
      '[{"message":"a","status":"warn","__proto__":"x"},{"message":"b","status":"warn","__proto__":{"polluted":"yes","n":1}}]',
    );

    expect(
      readOwnValue(storedAttributes(text!["attributes"]), "__proto__"),
    ).toBe("x");

    const flattened: JSONObject = storedAttributes(object!["attributes"]);

    expect(readOwnValue(flattened, "__proto__.polluted")).toBe("yes");
    // A number is an OTLP intValue, as under any other key.
    expect(readOwnValue(flattened, "__proto__.n")).toBe("1");
    expect((flattened as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("a nested field named __proto__ beside one read as the trace survives the copy that takes that one out", () => {
    const [record] = recordsOf(
      '[{"message":"a","dd":{"trace_id":"1234567890","__proto__":"x","env":"prod"}}]',
    );
    const attributes: JSONObject = storedAttributes(record!["attributes"]);

    expect(readOwnValue(attributes, "dd.__proto__")).toBe("x");
    expect(readOwnValue(attributes, "dd.env")).toBe("prod");
    expect(readOwnValue(attributes, "dd.trace_id")).toBeUndefined();
  });
});

describe("SNMP trap names (SnmpTrapLogWriter)", () => {
  const PROJECT: ObjectID = ObjectID.generate();
  const SERVICE: ObjectID = ObjectID.generate();

  async function write(trapOid: string): Promise<JSONObject> {
    const inserted: Array<JSONObject> = [];

    jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockImplementation((async (data: {
        serviceName: string;
      }): Promise<TelemetryServiceMetadata> => {
        return {
          serviceName: data.serviceName,
          primaryEntityId: SERVICE,
          primaryEntityType: ServiceType.OpenTelemetry,
          dataRententionInDays: 30,
          serviceRetentionConfig: null,
          serviceRetentionInDays: 30,
          projectRetentionConfig: null,
          projectRetentionInDays: 15,
        };
      }) as never);
    jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
      rows: Array<JSONObject>,
    ): Promise<void> => {
      inserted.push(...rows);
    }) as never);
    jest
      .spyOn(NetworkInterfaceService, "findOneBy")
      .mockResolvedValue(null as never);

    const device: NetworkDevice = new NetworkDevice(ObjectID.generate());

    device.projectId = PROJECT;
    device.name = "Core Switch";
    device.hostname = "10.0.0.2";

    await SnmpTrapLogWriter.writeTrapLogRows({
      snmpTrap: {
        sourceIpAddress: "10.0.0.2",
        trapOid: trapOid,
        snmpVersion: "2c",
        receivedAt: new Date("2026-11-15T10:00:00.000Z"),
        varbinds: [],
      },
      probeId: ObjectID.generate(),
      devices: [device],
    });

    expect(inserted).toHaveLength(1);

    return inserted[0]!;
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "a trap whose OID a probe reports as %s has no well-known name",
    async (name: string) => {
      const row: JSONObject = await write(name);
      const attributes: JSONObject = row["attributes"] as JSONObject;

      expect(readOwnValue(attributes, "snmpTrap.name")).toBeUndefined();
      expect(attributes["snmpTrap.oid"]).toBe(name);
      expect(row["body"]).toBe(`SNMP trap ${name} received from 10.0.0.2`);
      expect(String(row["body"])).not.toContain("native code");
    },
  );

  test("a well-known trap still gets its name", async () => {
    const row: JSONObject = await write("1.3.6.1.6.3.1.1.5.1");

    expect((row["attributes"] as JSONObject)["snmpTrap.name"]).toBe(
      "coldStart",
    );
    expect(row["body"]).toBe(
      "SNMP trap 1.3.6.1.6.3.1.1.5.1 (coldStart) received from 10.0.0.2",
    );
  });
});

describe("a scrub rule's saved pattern type (LogScrubRuleService, TraceScrubRuleService)", () => {
  type PatternReader = (
    patternType: string,
    customRegex?: string,
  ) => { source: string } | null;

  const logPattern: PatternReader = (
    LogScrubRuleService as unknown as { getRegexForPattern: PatternReader }
  ).getRegexForPattern.bind(LogScrubRuleService);
  const tracePattern: PatternReader = (
    TraceScrubRuleService as unknown as { getRegexForPattern: PatternReader }
  ).getRegexForPattern.bind(TraceScrubRuleService);

  test.each(INHERITED_PROPERTY_NAMES)(
    "a pattern type named %s is no built-in pattern: the rule scrubs nothing",
    (name: string) => {
      expect(logPattern(name)).toBeNull();
      expect(tracePattern(name)).toBeNull();
    },
  );

  test("the built-in patterns are still found", () => {
    expect(logPattern(LogScrubPatternType.Email)).not.toBeNull();
    expect(logPattern(LogScrubPatternType.IPAddress)).not.toBeNull();
    expect(tracePattern(TraceScrubPatternType.Email)).not.toBeNull();
  });
});
