import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorStepSecurityEventsMonitor is the security-events monitor step
 * config: what the UI stores, what round-trips through MonitorStep JSON,
 * and what toQuery turns into the SecurityEvent table filter the worker
 * runs. These tests pin the default shape, the config -> query mapping
 * (each populated field becomes exactly one filter, empty ones none), and
 * the toJSON/fromJSON round-trip that must preserve ObjectIDs.
 */

const SERVICE_ID_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function buildConfig(
  overrides: Partial<MonitorStepSecurityEventsMonitor> = {},
): MonitorStepSecurityEventsMonitor {
  return {
    ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
    ...overrides,
  };
}

describe("MonitorStepSecurityEventsMonitorUtil.getDefault", () => {
  test("returns the empty config with a 60-second window", () => {
    expect(MonitorStepSecurityEventsMonitorUtil.getDefault()).toEqual({
      attributes: {},
      messageContains: "",
      severityNames: [],
      classNames: [],
      telemetryServiceIds: [],
      lastXSecondsOfEvents: 60,
    });
  });
});

describe("MonitorStepSecurityEventsMonitorUtil.toQuery", () => {
  test("an empty config produces only the time window filter", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(buildConfig());

    expect(Object.keys(query)).toEqual(["time"]);

    const time: InBetween<Date> = query.time as InBetween<Date>;
    expect(time).toBeInstanceOf(InBetween);
    expect(time.endValue.getTime() - time.startValue.getTime()).toBe(60 * 1000);
  });

  test("lastXSecondsOfEvents drives the InBetween window size", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        buildConfig({ lastXSecondsOfEvents: 300 }),
      );

    const time: InBetween<Date> = query.time as InBetween<Date>;
    expect(time.endValue.getTime() - time.startValue.getTime()).toBe(
      300 * 1000,
    );
  });

  test("a zero-second window produces no filters at all", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        buildConfig({ lastXSecondsOfEvents: 0 }),
      );

    expect(query).toEqual({});
  });

  test("severityNames become an Includes filter on severityName", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        buildConfig({
          severityNames: [OcsfSeverity.High, OcsfSeverity.Critical],
        }),
      );

    const filter: Includes = query.severityName as Includes;
    expect(filter).toBeInstanceOf(Includes);
    expect(filter.values).toEqual([OcsfSeverity.High, OcsfSeverity.Critical]);
  });

  test("classNames become an Includes filter on className", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        buildConfig({ classNames: ["Authentication", "Process Activity"] }),
      );

    const filter: Includes = query.className as Includes;
    expect(filter).toBeInstanceOf(Includes);
    expect(filter.values).toEqual(["Authentication", "Process Activity"]);
  });

  test("messageContains becomes a Search filter on message", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        buildConfig({ messageContains: "failed login" }),
      );

    const filter: Search<string> = query.message as Search<string>;
    expect(filter).toBeInstanceOf(Search);
    expect(filter.toString()).toBe("failed login");
  });

  test("telemetryServiceIds become an Includes filter on primaryEntityId", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        buildConfig({ telemetryServiceIds: [SERVICE_ID_A, SERVICE_ID_B] }),
      );

    const filter: Includes = query.primaryEntityId as Includes;
    expect(filter).toBeInstanceOf(Includes);
    expect(filter.values).toEqual([SERVICE_ID_A, SERVICE_ID_B]);
  });

  test("attributes pass through as-is", () => {
    const attributes: MonitorStepSecurityEventsMonitor["attributes"] = {
      env: "prod",
      attempts: 3,
      blocked: true,
    };

    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(buildConfig({ attributes }));

    expect(query.attributes).toEqual(attributes);
  });

  test("empty attributes add no filter", () => {
    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        buildConfig({ lastXSecondsOfEvents: 0, attributes: {} }),
      );

    expect(query.attributes).toBeUndefined();
  });
});

describe("MonitorStepSecurityEventsMonitorUtil toJSON/fromJSON", () => {
  test("round-trips every field and revives ObjectIDs", () => {
    const config: MonitorStepSecurityEventsMonitor = {
      attributes: { env: "prod", attempts: 3, blocked: true },
      messageContains: "failed login",
      severityNames: [OcsfSeverity.High, OcsfSeverity.Critical],
      classNames: ["Authentication"],
      telemetryServiceIds: [SERVICE_ID_A, SERVICE_ID_B],
      lastXSecondsOfEvents: 300,
    };

    const json: JSONObject =
      MonitorStepSecurityEventsMonitorUtil.toJSON(config);
    const roundTripped: MonitorStepSecurityEventsMonitor =
      MonitorStepSecurityEventsMonitorUtil.fromJSON(json);

    expect(roundTripped.attributes).toEqual(config.attributes);
    expect(roundTripped.messageContains).toBe("failed login");
    expect(roundTripped.severityNames).toEqual([
      OcsfSeverity.High,
      OcsfSeverity.Critical,
    ]);
    expect(roundTripped.classNames).toEqual(["Authentication"]);
    expect(roundTripped.lastXSecondsOfEvents).toBe(300);

    expect(roundTripped.telemetryServiceIds).toHaveLength(2);
    for (const serviceId of roundTripped.telemetryServiceIds) {
      expect(serviceId).toBeInstanceOf(ObjectID);
    }
    expect(
      roundTripped.telemetryServiceIds.map((serviceId: ObjectID): string => {
        return serviceId.toString();
      }),
    ).toEqual([SERVICE_ID_A.toString(), SERVICE_ID_B.toString()]);
  });

  test("the default config round-trips to itself", () => {
    const config: MonitorStepSecurityEventsMonitor =
      MonitorStepSecurityEventsMonitorUtil.getDefault();

    const roundTripped: MonitorStepSecurityEventsMonitor =
      MonitorStepSecurityEventsMonitorUtil.fromJSON(
        MonitorStepSecurityEventsMonitorUtil.toJSON(config),
      );

    expect(roundTripped).toEqual(config);
  });
});
