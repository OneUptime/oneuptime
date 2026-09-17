import {
  buildSecurityEventDbRow,
  MAX_SECURITY_EVENT_AGE_IN_DAYS,
  MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventRow";
import { TelemetryServiceMetadata } from "../../../../Server/Services/OpenTelemetryIngestService";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * buildSecurityEventDbRow is the single NormalizedSecurityEvent ->
 * ClickHouse row mapping shared by the ingest pipeline and the detection
 * engine. These tests pin the column mapping itself and, with equal
 * weight, the timestamp clamp: the SecurityEvent table partitions by
 * toYYYYMMDD(time), so a forged or garbage source timestamp must be
 * stamped with the ingestion time (original preserved in attributes)
 * instead of creating arbitrary partitions.
 */

const FIXED_NOW: Date = new Date("2026-08-21T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "auth-service",
  primaryEntityId: SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

const RETENTION_DAYS: number = 30;

function buildNormalized(
  overrides: Partial<NormalizedSecurityEvent> = {},
): NormalizedSecurityEvent {
  const base: NormalizedSecurityEvent = {
    time: new Date("2026-08-21T11:55:00.500Z"),
    eventUid: "event-uid-1",
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 4,
    severityName: OcsfSeverity.High,
    statusName: "Failure",
    message: "Failed login for alice",
    vendorName: "TestVendor",
    productName: "TestProduct",
    ruleId: "rule-1",
    ruleName: "Failed Logins",
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110"],
    principalUser: "alice",
    principalHost: "workstation-1",
    principalIp: "10.0.0.1",
    principalProcess: "sshd",
    targetUser: "root",
    targetHost: "server-1",
    targetIp: "10.0.0.2",
    targetPort: 22,
    targetResource: "ssh",
    observables: ["alice", "10.0.0.1"],
    attributes: {
      "user.name": "alice",
      "source.ip": "10.0.0.1",
    },
  };

  return { ...base, ...overrides };
}

function buildRow(
  overrides: Partial<NormalizedSecurityEvent> = {},
): JSONObject {
  return buildSecurityEventDbRow({
    normalized: buildNormalized(overrides),
    projectId: PROJECT_ID,
    serviceMetadata: SERVICE_METADATA,
    retentionDays: RETENTION_DAYS,
  });
}

describe("buildSecurityEventDbRow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("column mapping", () => {
    test("every normalized field lands on the row under its column key", () => {
      const row: JSONObject = buildRow();

      expect(row["eventUid"]).toBe("event-uid-1");
      expect(row["categoryUid"]).toBe(3);
      expect(row["categoryName"]).toBe("Identity & Access Management");
      expect(row["classUid"]).toBe(3002);
      expect(row["className"]).toBe("Authentication");
      expect(row["activityName"]).toBe("Logon");
      expect(row["severityId"]).toBe(4);
      expect(row["severityName"]).toBe(OcsfSeverity.High);
      expect(row["statusName"]).toBe("Failure");
      expect(row["message"]).toBe("Failed login for alice");
      expect(row["vendorName"]).toBe("TestVendor");
      expect(row["productName"]).toBe("TestProduct");
      expect(row["ruleId"]).toBe("rule-1");
      expect(row["ruleName"]).toBe("Failed Logins");
      expect(row["mitreTactics"]).toEqual(["TA0006"]);
      expect(row["mitreTechniques"]).toEqual(["T1110"]);
      expect(row["principalUser"]).toBe("alice");
      expect(row["principalHost"]).toBe("workstation-1");
      expect(row["principalIp"]).toBe("10.0.0.1");
      expect(row["principalProcess"]).toBe("sshd");
      expect(row["targetUser"]).toBe("root");
      expect(row["targetHost"]).toBe("server-1");
      expect(row["targetIp"]).toBe("10.0.0.2");
      expect(row["targetPort"]).toBe(22);
      expect(row["targetResource"]).toBe("ssh");
      expect(row["observables"]).toEqual(["alice", "10.0.0.1"]);
      expect(row["attributes"]).toEqual({
        "user.name": "alice",
        "source.ip": "10.0.0.1",
      });
      expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
    });

    test("projectId and primaryEntityId are stringified", () => {
      const row: JSONObject = buildRow();

      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(typeof row["projectId"]).toBe("string");
      expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
      expect(typeof row["primaryEntityId"]).toBe("string");
    });

    test("_id and createdAt are stamped by the builder", () => {
      const row: JSONObject = buildRow();

      expect(typeof row["_id"]).toBe("string");
      expect((row["_id"] as string).length).toBeGreaterThan(0);
      expect(row["createdAt"]).toBe(
        OneUptimeDate.toClickhouseDateTime(FIXED_NOW),
      );
    });

    test("attributeKeys covers every attributes key, sorted", () => {
      const row: JSONObject = buildRow();

      expect(row["attributeKeys"]).toEqual(["source.ip", "user.name"]);
    });

    test("retentionDate is ingestion time plus retentionDays", () => {
      const row: JSONObject = buildRow();

      const expectedRetentionDate: Date = OneUptimeDate.addRemoveDays(
        FIXED_NOW,
        RETENTION_DAYS,
      );

      expect(row["retentionDate"]).toBe(
        OneUptimeDate.toClickhouseDateTime(expectedRetentionDate),
      );
    });
  });

  describe("timestamp clamp", () => {
    test("a time within the window keeps the source time as a ClickHouse DateTime64 string", () => {
      const eventTime: Date = new Date("2026-08-21T11:55:00.500Z");
      const row: JSONObject = buildRow({ time: eventTime });

      expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(eventTime));
      // DateTime64: seconds plus a 9-digit fractional part.
      expect(row["time"]).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{9}$/,
      );

      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes["oneuptime.original_time"]).toBeUndefined();
    });

    test("a future time within the skew allowance is kept", () => {
      const eventTime: Date = OneUptimeDate.addRemoveMinutes(
        FIXED_NOW,
        MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES,
      );
      const row: JSONObject = buildRow({ time: eventTime });

      expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(eventTime));
    });

    test("a time older than the max age clamps to ingestion time and preserves the original", () => {
      const eventTime: Date = OneUptimeDate.addRemoveDays(
        FIXED_NOW,
        -(MAX_SECURITY_EVENT_AGE_IN_DAYS + 1),
      );
      const row: JSONObject = buildRow({ time: eventTime });

      expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(FIXED_NOW));

      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes["oneuptime.original_time"]).toBe(String(eventTime));
      // The pre-existing attributes survive the clamp.
      expect(attributes["user.name"]).toBe("alice");
      // And the injected key is covered by attributeKeys.
      expect(row["attributeKeys"]).toEqual([
        "oneuptime.original_time",
        "source.ip",
        "user.name",
      ]);
    });

    test("a time exactly at the max age is kept (clamp is strictly greater-than)", () => {
      const eventTime: Date = OneUptimeDate.addRemoveDays(
        FIXED_NOW,
        -MAX_SECURITY_EVENT_AGE_IN_DAYS,
      );
      const row: JSONObject = buildRow({ time: eventTime });

      expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(eventTime));
    });

    test("a time further in the future than the skew allowance clamps to ingestion time", () => {
      const eventTime: Date = OneUptimeDate.addRemoveMinutes(
        FIXED_NOW,
        MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES + 1,
      );
      const row: JSONObject = buildRow({ time: eventTime });

      expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(FIXED_NOW));

      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes["oneuptime.original_time"]).toBe(String(eventTime));
    });

    test("an invalid time clamps to ingestion time", () => {
      const eventTime: Date = new Date(NaN);
      const row: JSONObject = buildRow({ time: eventTime });

      expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(FIXED_NOW));

      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes["oneuptime.original_time"]).toBe(String(eventTime));
    });
  });
});
