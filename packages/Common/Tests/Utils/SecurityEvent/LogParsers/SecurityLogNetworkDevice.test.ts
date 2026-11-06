import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import {
  NETWORK_DEVICE_ID_ATTRIBUTE,
  NETWORK_DEVICE_NAME_ATTRIBUTE,
} from "../../../../Types/NetworkDevice/NetworkDeviceTelemetryAttribute";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../../Types/SecurityCase/SecurityConnection";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { readLogNetworkDevice } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import { ASA_LINES, FORTIGATE_LINES, PAN_LINES } from "./FirewallFixtures";
import { SSH_LINES, logLine } from "./LogParserFixtures";
import { DEVICE_LINES } from "./SecurityDeviceFixtures";

/*
 * A NETWORK DEVICE'S OWN SECURITY EVENTS (issue #5769).
 *
 * Ingest writes `networkDevice.id` and `networkDevice.name` on every
 * syslog line it matched to one of the project's devices, over whatever
 * the line said under those names. Every security event the log scan reads
 * from such a line carries both, which is what puts it on that device's
 * Security Events page - a firewall's denied connection names the hosts on
 * either side of it and never the firewall, and is still the firewall's.
 */

const DEVICE_ID: string = "0192f1a0-0000-7000-8000-0000000000dd";
const DEVICE_NAME: string = "HQ Firewall";

// A line as ingest writes one it matched to the device: its id and its name on it.
function parseFromDevice(
  body: string,
  attributes: JSONObject = {},
): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(
    logLine(body, {
      [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID,
      [NETWORK_DEVICE_NAME_ATTRIBUTE]: DEVICE_NAME,
      "syslog.source_ip": "192.0.2.1",
      ...attributes,
    }),
  );
}

describe("readLogNetworkDevice", () => {
  test("reads the device a line came from: its id and its name", () => {
    expect(
      readLogNetworkDevice({
        [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID,
        [NETWORK_DEVICE_NAME_ATTRIBUTE]: DEVICE_NAME,
      }),
    ).toEqual({
      [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID,
      [NETWORK_DEVICE_NAME_ATTRIBUTE]: DEVICE_NAME,
    });
  });

  test("trims both", () => {
    expect(
      readLogNetworkDevice({
        [NETWORK_DEVICE_ID_ATTRIBUTE]: `  ${DEVICE_ID} `,
        [NETWORK_DEVICE_NAME_ATTRIBUTE]: `  ${DEVICE_NAME}  `,
      }),
    ).toEqual({
      [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID,
      [NETWORK_DEVICE_NAME_ATTRIBUTE]: DEVICE_NAME,
    });
  });

  test("an id without a name is the device all the same", () => {
    expect(
      readLogNetworkDevice({ [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID }),
    ).toEqual({ [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID });
    expect(
      readLogNetworkDevice({
        [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID,
        [NETWORK_DEVICE_NAME_ATTRIBUTE]: "   ",
      }),
    ).toEqual({ [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID });
  });

  test.each([
    ["no attributes", undefined],
    ["null", null],
    ["no device", { "host.name": "web-03" }],
    ["an id that is not one", { [NETWORK_DEVICE_ID_ATTRIBUTE]: "router-1" }],
    ["an empty id", { [NETWORK_DEVICE_ID_ATTRIBUTE]: "" }],
    ["a number for an id", { [NETWORK_DEVICE_ID_ATTRIBUTE]: 42 }],
    [
      "a name alone",
      { [NETWORK_DEVICE_NAME_ATTRIBUTE]: DEVICE_NAME } as JSONObject,
    ],
  ])(
    "%s names no device",
    (_case: string, attributes: JSONObject | null | undefined) => {
      expect(readLogNetworkDevice(attributes)).toEqual({});
    },
  );

  test("a name longer than any device's is cut, never dropped", () => {
    const device: JSONObject = readLogNetworkDevice({
      [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID,
      [NETWORK_DEVICE_NAME_ATTRIBUTE]: "f".repeat(5000),
    });

    expect(device[NETWORK_DEVICE_ID_ATTRIBUTE]).toBe(DEVICE_ID);
    expect(
      String(device[NETWORK_DEVICE_NAME_ATTRIBUTE]).length,
    ).toBeLessThanOrEqual(255);
    expect(String(device[NETWORK_DEVICE_NAME_ATTRIBUTE]).startsWith("fff")).toBe(
      true,
    );
  });
});

describe("an event read from a device's syslog carries the device", () => {
  test.each([
    [
      "a FortiGate's denied connection",
      FORTIGATE_LINES.trafficDeny,
      SecurityLogFormat.FortiGate,
    ],
    [
      "a FortiGate's intrusion",
      FORTIGATE_LINES.ips,
      SecurityLogFormat.FortiGate,
    ],
    [
      "a FortiGate's failed administrator sign-in",
      FORTIGATE_LINES.adminLoginFailed,
      SecurityLogFormat.FortiGate,
    ],
    [
      "a Cisco ASA's denied connection",
      ASA_LINES.aclDeny,
      SecurityLogFormat.CiscoAsa,
    ],
    [
      "a security product's CEF record",
      DEVICE_LINES.paloAltoThreat,
      SecurityLogFormat.Cef,
    ],
    [
      "an SSH sign-in on the device",
      SSH_LINES.failedPasswordInvalidUser,
      SecurityLogFormat.SshSignIn,
    ],
  ])(
    "%s",
    (_case: string, body: string, format: SecurityLogFormat): void => {
      const events: Array<NormalizedSecurityEvent> = parseFromDevice(body);

      expect(events.length).toBeGreaterThan(0);

      for (const event of events) {
        expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(format);
        expect(event.attributes[NETWORK_DEVICE_ID_ATTRIBUTE]).toBe(DEVICE_ID);
        expect(event.attributes[NETWORK_DEVICE_NAME_ATTRIBUTE]).toBe(
          DEVICE_NAME,
        );
      }
    },
  );

  test("every PAN-OS record of a device carries it", () => {
    const bodies: Array<string> = Object.values(PAN_LINES);
    let found: number = 0;

    for (const body of bodies) {
      for (const event of parseFromDevice(body)) {
        found++;
        expect(event.attributes[NETWORK_DEVICE_ID_ATTRIBUTE]).toBe(DEVICE_ID);
      }
    }

    // The fixtures hold kept records as well as ones that stay logs.
    expect(found).toBeGreaterThan(0);
  });

  test("a denied connection names the hosts on either side, never the firewall: the device is in its attributes, not its observables", () => {
    const events: Array<NormalizedSecurityEvent> = parseFromDevice(
      FORTIGATE_LINES.trafficDeny,
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.principalIp).toBe("203.0.113.99");
    expect(events[0]!.targetIp).toBe("192.0.2.5");
    expect(events[0]!.observables).not.toContain(DEVICE_NAME);
    expect(events[0]!.observables).not.toContain(DEVICE_ID);
    expect(events[0]!.attributes[NETWORK_DEVICE_ID_ATTRIBUTE]).toBe(DEVICE_ID);
  });

  test("a device's line keeps the record it was sent under too", () => {
    const serviceId: string = "0192f1a0-0000-7000-8000-0000000000ee";
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
      ...logLine(FORTIGATE_LINES.ips, {
        [NETWORK_DEVICE_ID_ATTRIBUTE]: DEVICE_ID,
      }),
      resourceId: serviceId,
      resourceType: ServiceType.OpenTelemetry,
    });

    expect(events[0]!.attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBe(
      serviceId,
    );
    expect(events[0]!.attributes[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]).toBe(
      ServiceType.OpenTelemetry,
    );
    expect(events[0]!.attributes[NETWORK_DEVICE_ID_ATTRIBUTE]).toBe(DEVICE_ID);
  });

  test("what a parser reads out of the line never stands for the device: a record naming another device's id keeps the one ingest matched", () => {
    const events: Array<NormalizedSecurityEvent> = parseFromDevice(
      `${FORTIGATE_LINES.trafficDeny} networkDevice.id="0192f1a0-0000-7000-8000-0000000000ff"`,
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[NETWORK_DEVICE_ID_ATTRIBUTE]).toBe(DEVICE_ID);
  });

  test("a line from no device carries none", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(FORTIGATE_LINES.trafficDeny, { "host.name": "fw-1" }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[NETWORK_DEVICE_ID_ATTRIBUTE]).toBeUndefined();
    expect(
      events[0]!.attributes[NETWORK_DEVICE_NAME_ATTRIBUTE],
    ).toBeUndefined();
  });

  test("a line whose device id is not one carries none", () => {
    const events: Array<NormalizedSecurityEvent> = parseFromDevice(
      FORTIGATE_LINES.trafficDeny,
      { [NETWORK_DEVICE_ID_ATTRIBUTE]: "not-an-id" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[NETWORK_DEVICE_ID_ATTRIBUTE]).toBeUndefined();
    expect(
      events[0]!.attributes[NETWORK_DEVICE_NAME_ATTRIBUTE],
    ).toBeUndefined();
  });

  test("a device's line that is no security record stays a log", () => {
    expect(parseFromDevice(FORTIGATE_LINES.trafficAccept)).toEqual([]);
    expect(parseFromDevice(FORTIGATE_LINES.systemPerformance)).toEqual([]);
  });
});
