import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  getHostLookupValues,
  getMonitorCheckedHost,
  isSameHost,
} from "../../../Utils/NetworkDevice/MonitorCheckedHost";
import { describe, expect, it } from "@jest/globals";

/*
 * THE ONE HOST A MONITOR CHECKS (OneUptime issue #9545).
 *
 * A monitor a person creates on the address exactly one network device has
 * is tied to that device. This is what reads the address: one host for the
 * whole monitor, or none - a monitor checking two hosts checks no single
 * device, and a host written as a variable is not known until the check
 * runs.
 */

const STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function steps(
  monitorType: MonitorType,
  destinations: Array<URL | IP | Hostname | undefined>,
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: destinations.map(
      (destination: URL | IP | Hostname | undefined): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: "Printer",
          monitorType: monitorType,
          onlineMonitorStatusId: STATUS_ID,
          offlineMonitorStatusId: STATUS_ID,
          defaultIncidentSeverityId: STATUS_ID,
          defaultAlertSeverityId: STATUS_ID,
        });

        if (destination) {
          step.setMonitorDestination(destination);
        }

        return step;
      },
    ),
    defaultMonitorStatusId: STATUS_ID,
  };
  return monitorSteps;
}

describe("getMonitorCheckedHost", () => {
  it("is the address a Ping, IP, Port or NTP monitor checks", () => {
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Ping,
        monitorSteps: steps(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
      }),
    ).toBe("10.0.0.5");
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Port,
        monitorSteps: steps(MonitorType.Port, [
          new Hostname("core-sw-01.example.net"),
        ]).toJSON(),
      }),
    ).toBe("core-sw-01.example.net");
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.NTP,
        monitorSteps: steps(MonitorType.NTP, [IP.fromString("2001:db8::1")]),
      }),
    ).toBe("2001:db8::1");
  });

  it("is the host a Website, API or SSL Certificate monitor's URL is on", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.SSLCertificate,
    ]) {
      expect(
        getMonitorCheckedHost({
          monitorType: monitorType,
          monitorSteps: steps(monitorType, [
            URL.fromString("https://10.0.0.5:8443/status"),
          ]),
        }),
      ).toBe("10.0.0.5");
    }

    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Website,
        monitorSteps: steps(MonitorType.Website, [
          URL.fromString("https://[2001:db8::1]/"),
        ]),
      }),
    ).toBe("2001:db8::1");
  });

  it("is one host for several steps that check it, however its name is cased", () => {
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Website,
        monitorSteps: steps(MonitorType.Website, [
          URL.fromString("https://Printer-01.example.net/"),
          URL.fromString("http://printer-01.example.net:8080/status"),
        ]),
      }),
    ).toBe("Printer-01.example.net");
  });

  it("is none for a monitor that checks two hosts, or a step that checks none", () => {
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Ping,
        monitorSteps: steps(MonitorType.Ping, [
          IP.fromString("10.0.0.5"),
          IP.fromString("10.0.0.6"),
        ]),
      }),
    ).toBe("");
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Ping,
        monitorSteps: steps(MonitorType.Ping, [
          IP.fromString("10.0.0.5"),
          undefined,
        ]),
      }),
    ).toBe("");
  });

  it("is none for a host written as a variable: it is only known when the check runs", () => {
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Website,
        monitorSteps: steps(MonitorType.Website, [
          URL.fromStringLenient("https://{{monitorSecrets.host}}/"),
        ]),
      }),
    ).toBe("");
  });

  it("is none for a kind that checks no host, and for steps it cannot read", () => {
    for (const monitorType of [
      MonitorType.NetworkDevice,
      MonitorType.Manual,
      MonitorType.IncomingRequest,
      MonitorType.DNS,
    ]) {
      expect(
        getMonitorCheckedHost({
          monitorType: monitorType,
          monitorSteps: steps(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        }),
      ).toBe("");
    }

    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Ping,
        monitorSteps: { not: "steps" } as unknown as JSONObject,
      }),
    ).toBe("");
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Ping,
        monitorSteps: undefined,
      }),
    ).toBe("");
    expect(
      getMonitorCheckedHost({
        monitorType: undefined,
        monitorSteps: steps(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
      }),
    ).toBe("");
  });

  it("a Website monitor's step on an address, not a URL, checks no host of a URL's", () => {
    expect(
      getMonitorCheckedHost({
        monitorType: MonitorType.Website,
        monitorSteps: steps(MonitorType.Website, [IP.fromString("10.0.0.5")]),
      }),
    ).toBe("");
  });
});

describe("isSameHost", () => {
  it("is a name in any case, and an IPv6 address in brackets or not", () => {
    expect(isSameHost("Core-SW-01", "core-sw-01")).toBe(true);
    expect(isSameHost("[2001:db8::1]", "2001:db8::1")).toBe(true);
    expect(isSameHost("10.0.0.5", "10.0.0.5:8080")).toBe(true);
  });

  it("is not another host, nor nothing", () => {
    expect(isSameHost("10.0.0.5", "10.0.0.6")).toBe(false);
    expect(isSameHost("", "")).toBe(false);
    expect(isSameHost("10.0.0.5", "")).toBe(false);
  });
});

describe("getHostLookupValues", () => {
  it("is the host as written and lower-cased, each once", () => {
    expect(getHostLookupValues("Printer-01")).toEqual([
      "Printer-01",
      "printer-01",
    ]);
    expect(getHostLookupValues("10.0.0.5")).toEqual(["10.0.0.5"]);
    expect(getHostLookupValues("[2001:db8::1]")).toEqual(["2001:db8::1"]);
    expect(getHostLookupValues(" ")).toEqual([]);
  });
});
