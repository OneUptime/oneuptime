// Set required env vars before importing SnmpTrapReceiver (which imports Config.ts)
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SnmpTrapReceiver from "../../Services/SnmpTrapReceiver";
import { JSONObject } from "Common/Types/JSON";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import { describe, expect, it } from "@jest/globals";

/*
 * Turning a net-snmp notification into the trap row the ingest endpoint
 * stores.
 *
 * Every branch in here decides what an operator sees at 3am when a switch
 * goes down, and each one fails quietly rather than loudly:
 *
 *  - An SNMPv2c trap names itself in the snmpTrapOID.0 varbind
 *    (1.3.6.1.6.3.1.1.4.1.0). An SNMPv1 trap has no such varbind at all; its
 *    identity is the (enterprise, generic, specific) triple, and RFC 3584 §3.1
 *    says how that maps onto a v2 notification OID. Get the mapping wrong and
 *    a linkDown from an older device is filed under some other event, or
 *    dropped - either way the alert rule that matches on the OID never fires.
 *  - Varbind values arrive as whatever the net-snmp decoder produced: a
 *    Buffer for an OCTET STRING, a bigint for a Counter64, a number, a null.
 *    They go into a string column, so each has to be rendered rather than
 *    stringified by accident ("[object Object]" is not a value anyone can
 *    alert on).
 *  - A malformed notification must return null, because the alternative is a
 *    row with an empty source address that matches nothing.
 *
 * parseNotification is pure, which is the whole reason it is separate from
 * the receiver's socket handling, so all of this is testable without a socket.
 */

const SNMP_TRAP_OID_VARBIND: string = "1.3.6.1.6.3.1.1.4.1.0";
const SOURCE_IP: string = "10.0.0.99";

function v2Notification(
  varbinds: Array<JSONObject>,
  overrides?: { pdu?: JSONObject; rinfo?: JSONObject },
): JSONObject {
  return {
    pdu: {
      community: "public",
      varbinds: varbinds,
      ...(overrides?.pdu || {}),
    },
    rinfo: {
      address: SOURCE_IP,
      port: 162,
      ...(overrides?.rinfo || {}),
    },
  };
}

function v1Notification(pdu: JSONObject): JSONObject {
  return {
    pdu: {
      community: "public",
      enterprise: "1.3.6.1.4.1.9",
      varbinds: [],
      ...pdu,
    },
    rinfo: { address: SOURCE_IP, port: 162 },
  };
}

describe("SnmpTrapReceiver.parseNotification", () => {
  describe("SNMPv2c", () => {
    it("takes the trap OID from the snmpTrapOID.0 varbind", () => {
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v2Notification([
          { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.3" },
        ]),
      );

      expect(trap).not.toBeNull();
      expect(trap!.trapOid).toBe("1.3.6.1.6.3.1.1.5.3");
      expect(trap!.snmpVersion).toBe("2c");
    });

    it("finds the trap OID wherever it sits among the varbinds", () => {
      // sysUpTime.0 is conventionally first, and devices add their own after.
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v2Notification([
          { oid: "1.3.6.1.2.1.1.3.0", value: 123456 },
          { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.4" },
          { oid: "1.3.6.1.2.1.2.2.1.1", value: 7 },
        ]),
      );

      expect(trap!.trapOid).toBe("1.3.6.1.6.3.1.1.5.4");
    });

    it("keeps every varbind, including the ones it used for identity", () => {
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v2Notification([
          { oid: "1.3.6.1.2.1.1.3.0", value: 123456 },
          { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.4" },
        ]),
      );

      expect(trap!.varbinds).toEqual([
        { oid: "1.3.6.1.2.1.1.3.0", value: "123456" },
        { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.4" },
      ]);
    });

    it("carries the source address and the community string", () => {
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v2Notification(
          [{ oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.1" }],
          { pdu: { community: "not-public" } },
        ),
      );

      expect(trap!.sourceIpAddress).toBe(SOURCE_IP);
      expect(trap!.community).toBe("not-public");
      expect(trap!.receivedAt).toBeInstanceOf(Date);
    });

    it("leaves the community undefined when the PDU carries none", () => {
      // v3 traps are authenticated rather than community-scoped.
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification({
        pdu: {
          varbinds: [
            { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.1" },
          ],
        },
        rinfo: { address: SOURCE_IP },
      });

      expect(trap!.community).toBeUndefined();
    });
  });

  describe("SNMPv1 generic traps (RFC 3584 section 3.1)", () => {
    const GENERIC_TRAP_OIDS: Array<[number, string, string]> = [
      [0, "coldStart", "1.3.6.1.6.3.1.1.5.1"],
      [1, "warmStart", "1.3.6.1.6.3.1.1.5.2"],
      [2, "linkDown", "1.3.6.1.6.3.1.1.5.3"],
      [3, "linkUp", "1.3.6.1.6.3.1.1.5.4"],
      [4, "authenticationFailure", "1.3.6.1.6.3.1.1.5.5"],
      [5, "egpNeighborLoss", "1.3.6.1.6.3.1.1.5.6"],
    ];

    for (const [generic, name, expectedOid] of GENERIC_TRAP_OIDS) {
      it(`maps generic ${generic} (${name}) to ${expectedOid}`, () => {
        const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
          v1Notification({ generic: generic, specific: 0 }),
        );

        expect(trap).not.toBeNull();
        expect(trap!.trapOid).toBe(expectedOid);
        expect(trap!.snmpVersion).toBe("1");
      });
    }

    it("builds an enterprise-specific OID for generic 6", () => {
      /*
       * generic 6 is "enterpriseSpecific": the identity is the enterprise OID
       * plus a zero plus the specific number, which is what the vendor MIB
       * documents.
       */
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v1Notification({ generic: 6, specific: 42 }),
      );

      expect(trap!.trapOid).toBe("1.3.6.1.4.1.9.0.42");
      expect(trap!.snmpVersion).toBe("1");
    });

    it("treats a missing specific number as 0 rather than dropping the trap", () => {
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v1Notification({ generic: 6 }),
      );

      expect(trap!.trapOid).toBe("1.3.6.1.4.1.9.0.0");
    });

    it("a v1 PDU that also carries the v2 OID varbind is read as v2", () => {
      /*
       * The varbind is the more specific signal, and v2c PDUs have no
       * enterprise field to begin with.
       */
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v1Notification({
          generic: 2,
          varbinds: [
            { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.4.1.9.9.999.0.1" },
          ],
        }),
      );

      expect(trap!.trapOid).toBe("1.3.6.1.4.1.9.9.999.0.1");
      expect(trap!.snmpVersion).toBe("2c");
    });
  });

  describe("varbind values", () => {
    function valueOf(raw: unknown): string {
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v2Notification([
          { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.3" },
          { oid: "1.3.6.1.2.1.2.2.1.2", value: raw as never },
        ]),
      );

      return trap!.varbinds[1]!.value;
    }

    it("decodes an OCTET STRING Buffer as UTF-8 text", () => {
      // Otherwise an interface description reads as a list of byte numbers.
      expect(valueOf(Buffer.from("GigabitEthernet0/1", "utf8"))).toBe(
        "GigabitEthernet0/1",
      );
    });

    it("renders a Counter64 bigint in full", () => {
      // Number() would lose precision above 2^53.
      expect(valueOf(BigInt("18446744073709551615"))).toBe(
        "18446744073709551615",
      );
    });

    it("renders integers and zero", () => {
      expect(valueOf(7)).toBe("7");
      expect(valueOf(0)).toBe("0");
    });

    it("renders a null or absent value as the empty string, not 'null'", () => {
      expect(valueOf(null)).toBe("");
      expect(valueOf(undefined)).toBe("");
    });

    it("keeps an already-string value untouched", () => {
      expect(valueOf("down")).toBe("down");
    });

    it("defaults a varbind with no oid to the empty string rather than 'undefined'", () => {
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v2Notification([
          { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.3" },
          { value: "orphan" },
        ]),
      );

      expect(trap!.varbinds[1]).toEqual({ oid: "", value: "orphan" });
    });

    it("a PDU with no varbinds array at all is not a crash", () => {
      const trap: SnmpTrap | null = SnmpTrapReceiver.parseNotification(
        v1Notification({ generic: 0, varbinds: undefined }),
      );

      expect(trap!.varbinds).toEqual([]);
    });
  });

  describe("notifications it refuses", () => {
    it("returns null without a PDU", () => {
      expect(
        SnmpTrapReceiver.parseNotification({
          rinfo: { address: SOURCE_IP },
        }),
      ).toBeNull();
    });

    it("returns null without rinfo", () => {
      expect(
        SnmpTrapReceiver.parseNotification({
          pdu: {
            varbinds: [
              { oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.1" },
            ],
          },
        }),
      ).toBeNull();
    });

    it("returns null without a source address", () => {
      /*
       * The source address is how a trap is matched to a monitor, so a row
       * without one would sit in the table matching nothing.
       */
      expect(
        SnmpTrapReceiver.parseNotification(
          v2Notification(
            [{ oid: SNMP_TRAP_OID_VARBIND, value: "1.3.6.1.6.3.1.1.5.1" }],
            { rinfo: { address: "" } },
          ),
        ),
      ).toBeNull();
    });

    it("returns null when nothing identifies the trap", () => {
      // No snmpTrapOID.0 varbind and no enterprise field: unidentifiable.
      expect(
        SnmpTrapReceiver.parseNotification(
          v2Notification([{ oid: "1.3.6.1.2.1.1.3.0", value: 1 }]),
        ),
      ).toBeNull();
    });

    it("returns null for an empty notification", () => {
      expect(SnmpTrapReceiver.parseNotification({})).toBeNull();
    });
  });
});
