import { describe, expect, test } from "@jest/globals";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import NtpMonitorResponse from "../../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";

/*
 * The NTP branch of buildTemplateStorageMap is what an incident title can
 * place: "{{monitorName}} is at stratum {{stratum}}", "... is
 * {{clockOffsetInMs}} ms off". The template-variables list in the dashboard
 * (TemplateVariablesCatalog) has to offer exactly these keys, or people are
 * shown variables that render empty, or miss ones that work.
 */

function response(
  ntpResponse: NtpMonitorResponse | undefined,
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: ntpResponse?.failureCause || "",
    monitoredAt: new Date("2026-07-16T12:00:00.000Z"),
    isOnline: ntpResponse?.isOnline,
    responseTimeInMs: ntpResponse?.responseTimeInMs,
    ntpResponse: ntpResponse,
    ...overrides,
  };
}

function buildMap(dataToProcess: ProbeMonitorResponse): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.NTP,
    dataToProcess: dataToProcess,
  });
}

const HEALTHY: NtpMonitorResponse = {
  isOnline: true,
  isSynchronized: true,
  responseTimeInMs: 18,
  failureCause: "",
  isTimeout: false,
  serverAddress: "192.0.2.10",
  port: 123,
  version: 4,
  leapIndicator: 0,
  stratum: 1,
  referenceId: "GPS",
  rootDelayInMs: 0.5,
  rootDispersionInMs: 1.25,
  referenceTime: "2026-07-16T11:59:30.000Z",
  serverTime: "2026-07-16T12:00:00.004Z",
  clockOffsetInMs: -12.4,
  roundTripDelayInMs: 17.6,
};

describe("MonitorTemplateUtil.buildTemplateStorageMap - NTP", () => {
  test("places what the server said", () => {
    const map: JSONObject = buildMap(response(HEALTHY));

    expect(map).toEqual(
      expect.objectContaining({
        isOnline: true,
        isSynchronized: true,
        responseTimeInMs: 18,
        failureCause: "",
        isTimeout: false,
        serverAddress: "192.0.2.10",
        port: 123,
        stratum: 1,
        leapIndicator: 0,
        referenceId: "GPS",
        rootDelayInMs: 0.5,
        rootDispersionInMs: 1.25,
        referenceTime: "2026-07-16T11:59:30.000Z",
        serverTime: "2026-07-16T12:00:00.004Z",
        roundTripDelayInMs: 17.6,
      }),
    );
  });

  test("keeps the offset's sign, so a title can say ahead or behind", () => {
    expect(buildMap(response(HEALTHY))["clockOffsetInMs"]).toBe(-12.4);
  });

  test("a kiss-o'-death places its code and stratum 0", () => {
    const map: JSONObject = buildMap(
      response({
        ...HEALTHY,
        isSynchronized: false,
        stratum: 0,
        kissCode: "RATE",
        referenceId: "RATE",
        clockOffsetInMs: undefined,
        failureCause:
          "The server answered with a kiss-o'-death (RATE): the server is rate-limiting this probe and asks it to poll less often.",
      }),
    );

    expect(map["kissCode"]).toBe("RATE");
    expect(map["stratum"]).toBe(0);
    expect(map["isSynchronized"]).toBe(false);
    expect(map["failureCause"]).toContain("kiss-o'-death (RATE)");
    expect(map["clockOffsetInMs"]).toBeUndefined();
  });

  test("a silent server places why, and no time facts", () => {
    const map: JSONObject = buildMap(
      response({
        isOnline: false,
        isSynchronized: false,
        responseTimeInMs: 0,
        failureCause: "No NTP reply from 192.0.2.10:123 within 5 seconds.",
        isTimeout: true,
        serverAddress: "192.0.2.10",
        port: 123,
      }),
    );

    expect(map["isOnline"]).toBe(false);
    expect(map["isTimeout"]).toBe(true);
    expect(map["failureCause"]).toBe(
      "No NTP reply from 192.0.2.10:123 within 5 seconds.",
    );
    expect(map["stratum"]).toBeUndefined();
    expect(map["clockOffsetInMs"]).toBeUndefined();
  });

  test("a check that never reached the probe's NTP code still places why", () => {
    const map: JSONObject = buildMap(
      response(undefined, {
        isOnline: false,
        failureCause: "NTP server is not specified.",
        responseTimeInMs: 0,
      }),
    );

    expect(map["isOnline"]).toBe(false);
    expect(map["failureCause"]).toBe("NTP server is not specified.");
    expect(map["responseTimeInMs"]).toBe(0);
  });

  test("renders a title with the server's own facts", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value:
          "Time server at stratum {{stratum}} ({{referenceId}}), {{clockOffsetInMs}} ms off",
        storageMap: buildMap(response(HEALTHY)),
      }),
    ).toBe("Time server at stratum 1 (GPS), -12.4 ms off");
  });

  test("the dashboard's variable list offers exactly the keys the server places", () => {
    const placed: Array<string> = Object.keys(buildMap(response(HEALTHY)));

    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.NTP,
      });

    const keysOf: (group: TemplateVariableGroup) => Array<string> = (
      group: TemplateVariableGroup,
    ): Array<string> => {
      return group.variables.map((variable: TemplateVariable) => {
        return variable.key;
      });
    };

    const offered: Array<string> = keysOf(
      groups.find((group: TemplateVariableGroup) => {
        return group.title === "NTP";
      })!,
    );

    // Every monitor's map also places the Monitor and series context keys.
    const shared: Array<string> = groups
      .filter((group: TemplateVariableGroup) => {
        return group.title !== "NTP";
      })
      .flatMap(keysOf);

    expect([...offered].sort()).toEqual(
      placed
        .filter((key: string) => {
          return !shared.includes(key);
        })
        .sort(),
    );
  });
});
