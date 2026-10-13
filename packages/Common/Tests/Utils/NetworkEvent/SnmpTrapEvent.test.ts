import {
  getSnmpTrapEventAttributes,
  getSnmpTrapInterfaceIndex,
} from "../../../Utils/NetworkEvent/SnmpTrapEvent";
import SnmpTrap, {
  SnmpTrapVarbind,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import NetworkEventType, {
  NetworkEventTypeUtil,
} from "../../../Types/NetworkEvent/NetworkEventType";
import { describe, expect, test } from "@jest/globals";

/*
 * The standard SNMP traps as network events: the same name a device's
 * syslog line for the same thing is stored under, so what is built on
 * `event.name` = interface.down finds a link going down however the device
 * reported it.
 *
 * The trap OIDs are the snmpTraps of RFC 3418 (coldStart, warmStart,
 * authenticationFailure) and RFC 2863 (linkDown, linkUp); the varbind
 * columns are IF-MIB's ifIndex, ifDescr, ifAdminStatus, ifOperStatus and
 * ifName.
 */

const COLD_START: string = "1.3.6.1.6.3.1.1.5.1";
const WARM_START: string = "1.3.6.1.6.3.1.1.5.2";
const LINK_DOWN: string = "1.3.6.1.6.3.1.1.5.3";
const LINK_UP: string = "1.3.6.1.6.3.1.1.5.4";
const AUTHENTICATION_FAILURE: string = "1.3.6.1.6.3.1.1.5.5";

const IF_INDEX: string = "1.3.6.1.2.1.2.2.1.1";
const IF_DESCR: string = "1.3.6.1.2.1.2.2.1.2";
const IF_ADMIN_STATUS: string = "1.3.6.1.2.1.2.2.1.7";
const IF_OPER_STATUS: string = "1.3.6.1.2.1.2.2.1.8";
const IF_NAME: string = "1.3.6.1.2.1.31.1.1.1.1";

function trap(
  trapOid: string,
  varbinds: Array<SnmpTrapVarbind> = [],
): Pick<SnmpTrap, "trapOid" | "varbinds"> {
  return { trapOid: trapOid, varbinds: varbinds };
}

// What RFC 2863 requires of a link trap: the index and the two statuses.
function linkVarbinds(index: number): Array<SnmpTrapVarbind> {
  return [
    { oid: `${IF_INDEX}.${index}`, value: String(index) },
    { oid: `${IF_ADMIN_STATUS}.${index}`, value: "1" },
    { oid: `${IF_OPER_STATUS}.${index}`, value: "2" },
  ];
}

describe("the standard traps", () => {
  test("linkDown is interface.down and linkUp is interface.up", () => {
    expect(getSnmpTrapEventAttributes(trap(LINK_DOWN))).toEqual({
      "event.domain": "network",
      "event.name": "interface.down",
    });
    expect(getSnmpTrapEventAttributes(trap(LINK_UP))).toEqual({
      "event.domain": "network",
      "event.name": "interface.up",
    });
  });

  test("coldStart and warmStart are both device.reboot: the device came back up either way", () => {
    for (const oid of [COLD_START, WARM_START]) {
      expect(getSnmpTrapEventAttributes(trap(oid))).toEqual({
        "event.domain": "network",
        "event.name": "device.reboot",
      });
    }
  });

  test("the events are ones the vocabulary has, with linkUp clearing linkDown", () => {
    for (const oid of [COLD_START, WARM_START, LINK_DOWN, LINK_UP]) {
      expect(
        NetworkEventTypeUtil.isBuiltIn(
          getSnmpTrapEventAttributes(trap(oid))["event.name"],
        ),
      ).toBe(true);
    }

    expect(
      NetworkEventTypeUtil.getClearedProblem(
        getSnmpTrapEventAttributes(trap(LINK_UP))["event.name"],
      ),
    ).toBe(NetworkEventType.InterfaceDown);
  });

  test("an OID written with a leading dot, or with spaces around it, is the same trap", () => {
    for (const oid of [`.${LINK_DOWN}`, ` ${LINK_DOWN} `, ` .${LINK_DOWN}`]) {
      expect(getSnmpTrapEventAttributes(trap(oid))["event.name"]).toBe(
        "interface.down",
      );
    }
  });

  test("any other trap is no event: a vendor's own, authenticationFailure, a longer or shorter OID", () => {
    for (const oid of [
      AUTHENTICATION_FAILURE,
      "1.3.6.1.6.3.1.1.5.6",
      "1.3.6.1.4.1.9.9.43.2.0.1",
      `${LINK_DOWN}.0`,
      "1.3.6.1.6.3.1.1.5",
      "1.3.6.1.6.3.1.1.5.30",
      "",
      "linkDown",
    ]) {
      expect({
        oid,
        attributes: getSnmpTrapEventAttributes(trap(oid)),
      }).toEqual({ oid, attributes: {} });
    }
  });

  test("what is not a trap is no event", () => {
    for (const value of [
      null,
      undefined,
      {},
      { trapOid: 5 },
      { trapOid: null },
      { varbinds: [] },
    ]) {
      expect(getSnmpTrapEventAttributes(value as never)).toEqual({});
      expect(getSnmpTrapInterfaceIndex(value as never)).toBeNull();
    }
  });
});

describe("the interface a link trap is about", () => {
  test("is its name when the trap carries ifName", () => {
    expect(
      getSnmpTrapEventAttributes(
        trap(LINK_DOWN, [
          ...linkVarbinds(10101),
          { oid: `${IF_DESCR}.10101`, value: "GigabitEthernet1/0/1" },
          { oid: `${IF_NAME}.10101`, value: "Gi1/0/1" },
        ]),
      ),
    ).toEqual({
      "event.domain": "network",
      "event.name": "interface.down",
      "network.interface.name": "Gi1/0/1",
    });
  });

  test("else its description (ifDescr), which Cisco adds to its link traps", () => {
    expect(
      getSnmpTrapEventAttributes(
        trap(LINK_UP, [
          ...linkVarbinds(10101),
          { oid: `${IF_DESCR}.10101`, value: "GigabitEthernet1/0/1" },
        ]),
      )["network.interface.name"],
    ).toBe("GigabitEthernet1/0/1");
  });

  test("else the name the caller found for its index", () => {
    expect(
      getSnmpTrapEventAttributes(trap(LINK_DOWN, linkVarbinds(7)), {
        interfaceName: "  ether7  ",
      })["network.interface.name"],
    ).toBe("ether7");
  });

  test("else 'ifIndex N': what the trap must carry", () => {
    expect(
      getSnmpTrapEventAttributes(trap(LINK_DOWN, linkVarbinds(7)))[
        "network.interface.name"
      ],
    ).toBe("ifIndex 7");

    for (const interfaceName of [undefined, null, "", "   "]) {
      expect(
        getSnmpTrapEventAttributes(trap(LINK_DOWN, linkVarbinds(7)), {
          interfaceName,
        })["network.interface.name"],
      ).toBe("ifIndex 7");
    }
  });

  test("the name the trap itself carries wins over the one the caller found", () => {
    expect(
      getSnmpTrapEventAttributes(
        trap(LINK_DOWN, [
          ...linkVarbinds(7),
          { oid: `${IF_NAME}.7`, value: "ether7" },
        ]),
        { interfaceName: "an older name" },
      )["network.interface.name"],
    ).toBe("ether7");
  });

  test("is absent when the trap says nothing of it", () => {
    expect(
      Object.keys(
        getSnmpTrapEventAttributes(
          trap(LINK_DOWN, [{ oid: "1.3.6.1.2.1.1.3.0", value: "12345" }]),
        ),
      ),
    ).toEqual(["event.domain", "event.name"]);
  });

  test("a reboot has no interface, whatever its varbinds or the caller say", () => {
    expect(
      getSnmpTrapEventAttributes(
        trap(COLD_START, [{ oid: `${IF_NAME}.7`, value: "ether7" }]),
        { interfaceName: "ether7" },
      ),
    ).toEqual({ "event.domain": "network", "event.name": "device.reboot" });
  });

  test("varbind OIDs with a leading dot and padded values are read the same", () => {
    expect(
      getSnmpTrapEventAttributes(
        trap(LINK_DOWN, [{ oid: ` .${IF_NAME}.7 `, value: "  ether7 " }]),
      )["network.interface.name"],
    ).toBe("ether7");
  });

  test("another column that only starts like one of these is not it", () => {
    // ifType is 1.3.6.1.2.1.2.2.1.3; ifAlias is 1.3.6.1.2.1.31.1.1.1.18.
    expect(
      Object.keys(
        getSnmpTrapEventAttributes(
          trap(LINK_DOWN, [
            { oid: "1.3.6.1.2.1.2.2.1.3.7", value: "6" },
            { oid: "1.3.6.1.2.1.31.1.1.1.18.7", value: "Uplink to core" },
            { oid: "1.3.6.1.2.1.2.2.1.10.7", value: "999" },
            { oid: "1.3.6.1.2.1.2.2.1.22.7", value: "0.0" },
          ]),
        ),
      ),
    ).not.toContain("network.interface.name");
  });

  test("an empty name falls through to the next thing known", () => {
    expect(
      getSnmpTrapEventAttributes(
        trap(LINK_DOWN, [
          { oid: `${IF_NAME}.7`, value: "   " },
          { oid: `${IF_DESCR}.7`, value: "" },
          { oid: `${IF_INDEX}.7`, value: "7" },
        ]),
      )["network.interface.name"],
    ).toBe("ifIndex 7");
  });

  test("a name is cut to the length a subject may have", () => {
    const name: string | undefined = getSnmpTrapEventAttributes(
      trap(LINK_DOWN, [{ oid: `${IF_NAME}.7`, value: "x".repeat(5000) }]),
    )["network.interface.name"];

    expect(name).toHaveLength(256);

    expect(
      getSnmpTrapEventAttributes(trap(LINK_DOWN, linkVarbinds(7)), {
        interfaceName: "y".repeat(5000),
      })["network.interface.name"],
    ).toHaveLength(256);
  });

  test("varbinds that are not varbinds are skipped", () => {
    expect(
      getSnmpTrapEventAttributes({
        trapOid: LINK_DOWN,
        varbinds: [
          null,
          undefined,
          "text",
          { oid: 5, value: "x" },
          { value: "no oid" },
          { oid: `${IF_NAME}.7`, value: null },
          { oid: `${IF_NAME}.7`, value: 12 },
        ] as never,
      })["network.interface.name"],
    ).toBe("12");

    expect(
      getSnmpTrapEventAttributes({
        trapOid: LINK_DOWN,
        varbinds: "not a list" as never,
      }),
    ).toEqual({ "event.domain": "network", "event.name": "interface.down" });
  });
});

describe("the index a caller should look a name up for", () => {
  test("is the trap's ifIndex, when the index is all it says of the interface", () => {
    expect(
      getSnmpTrapInterfaceIndex(trap(LINK_DOWN, linkVarbinds(10101))),
    ).toBe(10101);
    expect(getSnmpTrapInterfaceIndex(trap(LINK_UP, linkVarbinds(1)))).toBe(1);
  });

  test("is null when the trap names its interface: there is nothing to look up", () => {
    expect(
      getSnmpTrapInterfaceIndex(
        trap(LINK_DOWN, [
          ...linkVarbinds(7),
          { oid: `${IF_DESCR}.7`, value: "ether7" },
        ]),
      ),
    ).toBeNull();
  });

  test("is null for a trap that is not about a link", () => {
    for (const oid of [COLD_START, WARM_START, AUTHENTICATION_FAILURE, ""]) {
      expect(getSnmpTrapInterfaceIndex(trap(oid, linkVarbinds(7)))).toBeNull();
    }
  });

  test("is null for a value that is no interface index", () => {
    for (const value of [
      "0",
      "-1",
      "1.5",
      "seven",
      "",
      "07",
      "1e3",
      "2147483648",
      "99999999999",
      " ",
    ]) {
      expect({
        value,
        index: getSnmpTrapInterfaceIndex(
          trap(LINK_DOWN, [{ oid: `${IF_INDEX}.7`, value: value }]),
        ),
      }).toEqual({ value, index: null });
    }
  });

  test("takes the largest index there can be", () => {
    expect(
      getSnmpTrapInterfaceIndex(
        trap(LINK_DOWN, [{ oid: `${IF_INDEX}.1`, value: "2147483647" }]),
      ),
    ).toBe(2147483647);
  });
});
