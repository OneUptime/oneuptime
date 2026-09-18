import MonitorCriteriaDataExtractor from "../../../../Server/Utils/Monitor/MonitorCriteriaDataExtractor";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import SecurityEventsMonitorResponse from "../../../../Types/Monitor/SecurityEventsMonitor/SecurityEventsMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorCriteriaDataExtractor dispatches DataToProcess payloads by marker
 * field: securityEventCount for security-events monitors, logCount for log
 * monitors, and so on. The markers must stay mutually exclusive — a
 * security-events payload matched by the log extractor (or vice versa)
 * would evaluate one monitor type's criteria against another's data. That
 * marker uniqueness is the regression these tests exist to catch.
 */

function buildSecurityEventsPayload(securityEventCount: number): DataToProcess {
  const response: SecurityEventsMonitorResponse = {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    securityEventCount,
    securityEventQuery: {},
  };
  return response;
}

function buildLogPayload(logCount: number): DataToProcess {
  const response: Partial<LogMonitorResponse> = {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    logCount,
    logQuery: {},
  };
  return response as DataToProcess;
}

describe("MonitorCriteriaDataExtractor.getSecurityEventsMonitorResponse", () => {
  test("returns the payload when securityEventCount is present", () => {
    const payload: DataToProcess = buildSecurityEventsPayload(5);

    expect(
      MonitorCriteriaDataExtractor.getSecurityEventsMonitorResponse(payload),
    ).toBe(payload);
  });

  test("a zero count still matches (the marker check is on presence, not truthiness)", () => {
    const payload: DataToProcess = buildSecurityEventsPayload(0);

    expect(
      MonitorCriteriaDataExtractor.getSecurityEventsMonitorResponse(payload),
    ).toBe(payload);
  });

  test("returns null for a log monitor payload", () => {
    expect(
      MonitorCriteriaDataExtractor.getSecurityEventsMonitorResponse(
        buildLogPayload(5),
      ),
    ).toBeNull();
  });
});

describe("marker uniqueness across extractors", () => {
  test("getLogMonitorResponse does NOT match a security-events payload", () => {
    expect(
      MonitorCriteriaDataExtractor.getLogMonitorResponse(
        buildSecurityEventsPayload(5),
      ),
    ).toBeNull();
  });

  test("getLogMonitorResponse still matches a log payload", () => {
    const payload: DataToProcess = buildLogPayload(5);

    expect(MonitorCriteriaDataExtractor.getLogMonitorResponse(payload)).toBe(
      payload,
    );
  });

  test("other extractors do not match a security-events payload either", () => {
    const payload: DataToProcess = buildSecurityEventsPayload(5);

    expect(
      MonitorCriteriaDataExtractor.getTraceMonitorResponse(payload),
    ).toBeNull();
    expect(
      MonitorCriteriaDataExtractor.getMetricMonitorResponse(payload),
    ).toBeNull();
    expect(
      MonitorCriteriaDataExtractor.getExceptionMonitorResponse(payload),
    ).toBeNull();
  });
});
