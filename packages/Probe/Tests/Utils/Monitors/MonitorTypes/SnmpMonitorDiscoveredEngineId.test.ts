import "../../../TestingUtils/DiscoveryEnvironment";

import { describe, expect, test } from "@jest/globals";
import snmp from "net-snmp";
import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * THE ENGINE ID AN SNMPv3 AGENT ANSWERED A POLL WITH (OneUptime issue
 * #11172).
 *
 * net-snmp learns it from the agent's Report to the session's first request
 * and keeps it on the session for the rest; the walk reads it when it is
 * done, so the device is told apart by it from devices whose SNMPv3 traps
 * come from the same address. BrocadeFabricOsEndToEnd reads it from a real
 * net-snmp agent over a real socket; this holds the reading itself to what
 * the session can hold.
 */

function sessionWith(securityParameters: unknown): snmp.Session {
  return {
    msgSecurityParameters: securityParameters,
  } as unknown as snmp.Session;
}

describe("readDiscoveredEngineId", () => {
  test("an agent's engine ID, as hex in capitals", () => {
    expect(
      SnmpMonitor.readDiscoveredEngineId(
        sessionWith({
          msgAuthoritativeEngineID: Buffer.from(
            "800006340300c4f57c4a1b20",
            "hex",
          ),
          msgAuthoritativeEngineBoots: 3,
          msgAuthoritativeEngineTime: 120,
        }),
      ),
    ).toBe("800006340300C4F57C4A1B20");
  });

  test("a v1 or v2c session discovers nothing", () => {
    expect(
      SnmpMonitor.readDiscoveredEngineId(sessionWith(undefined)),
    ).toBeUndefined();
    expect(
      SnmpMonitor.readDiscoveredEngineId({} as unknown as snmp.Session),
    ).toBeUndefined();
  });

  test("a session that was never answered has an empty engine ID: none", () => {
    expect(
      SnmpMonitor.readDiscoveredEngineId(
        sessionWith({ msgAuthoritativeEngineID: Buffer.alloc(0) }),
      ),
    ).toBeUndefined();
  });

  test("what is not an engine ID is none: too short, too long, not octets", () => {
    for (const value of [
      Buffer.from("8000", "hex"),
      Buffer.alloc(33, 0xab),
      "800006340300C4F57C4A1B20",
      null,
    ]) {
      expect(
        SnmpMonitor.readDiscoveredEngineId(
          sessionWith({ msgAuthoritativeEngineID: value }),
        ),
      ).toBeUndefined();
    }
  });
});
