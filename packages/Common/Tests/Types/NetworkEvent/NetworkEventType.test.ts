import NetworkEventAttribute, {
  NETWORK_EVENT_DOMAIN,
} from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType, {
  MAX_NETWORK_EVENT_NAME_LENGTH,
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventCategory,
  NetworkEventDefinition,
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "../../../Types/NetworkEvent/NetworkEventType";
import { describe, expect, it } from "@jest/globals";

/*
 * The one vocabulary of network events. Its values are stored in
 * customers' logs (`event.name`) and in the filters of their monitors, so
 * what is pinned here is what may never drift: the names, what each one
 * means to a reader (a problem, a recovery, or just something that
 * happened), which event ends which problem, and what each is about.
 */

describe("the vocabulary", () => {
  it("is exactly these events - a name here is stored data and never renamed", () => {
    expect(
      NETWORK_EVENT_DEFINITIONS.map(
        (definition: NetworkEventDefinition): string => {
          return definition.type;
        },
      ),
    ).toEqual([
      "interface.down",
      "interface.up",
      "interface.error_disabled",
      "device.reboot",
      "device.config_change",
      "device.offline",
      "device.online",
      "ha.failover",
      "ha.state_change",
      "ha.peer_down",
      "ha.peer_up",
      "vpn.tunnel_down",
      "vpn.tunnel_up",
      "routing.neighbor_down",
      "routing.neighbor_up",
      "gateway.down",
      "gateway.up",
      "wan.failover",
      "sdwan.sla_not_met",
      "sdwan.sla_met",
      "hardware.fan_failed",
      "hardware.fan_ok",
      "hardware.power_supply_failed",
      "hardware.power_supply_ok",
      "hardware.temperature_high",
      "loop.detected",
      "stp.topology_change",
      "poe.fault",
      "auth.login_failed",
      "auth.login_success",
      "wireless.client_connected",
      "wireless.client_disconnected",
    ]);
  });

  it("holds the four events issue #4728 names, as it names them", () => {
    for (const name of [
      "interface.down",
      "ha.failover",
      "device.reboot",
      "vpn.tunnel_down",
    ]) {
      expect({ name, known: NetworkEventTypeUtil.isBuiltIn(name) }).toEqual({
        name,
        known: true,
      });
    }
  });

  it("defines every member of the enum once, and nothing else", () => {
    const defined: Array<string> = NETWORK_EVENT_DEFINITIONS.map(
      (definition: NetworkEventDefinition): string => {
        return definition.type;
      },
    );

    expect(new Set(defined).size).toBe(defined.length);
    expect([...defined].sort()).toEqual(
      (Object.values(NetworkEventType) as Array<string>).sort(),
    );
  });

  it("gives every name the shape people may give their own events", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      expect({
        type: definition.type,
        valid: NetworkEventTypeUtil.isValidName(definition.type),
      }).toEqual({ type: definition.type, valid: true });
    }
  });

  it("files every event under a category, and uses every category", () => {
    const used: Set<string> = new Set(
      NETWORK_EVENT_DEFINITIONS.map(
        (definition: NetworkEventDefinition): string => {
          return definition.category;
        },
      ),
    );

    expect([...used].sort()).toEqual(
      (Object.values(NetworkEventCategory) as Array<string>).sort(),
    );
  });
});

describe("problems and what ends them", () => {
  it("a problem is ended only by a recovery, and a recovery ends exactly one problem", () => {
    const endedBy: Record<string, Array<string>> = {};

    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (!definition.clearedBy) {
        continue;
      }

      // Only a problem is cleared.
      expect({ type: definition.type, kind: definition.kind }).toEqual({
        type: definition.type,
        kind: NetworkEventKind.Problem,
      });

      const recovery: NetworkEventDefinition | null = NetworkEventTypeUtil.get(
        definition.clearedBy,
      );

      expect({ type: definition.type, recovery: recovery?.kind }).toEqual({
        type: definition.type,
        recovery: NetworkEventKind.Recovery,
      });

      endedBy[definition.clearedBy] = [
        ...(endedBy[definition.clearedBy] || []),
        definition.type,
      ];
    }

    for (const recovery of Object.keys(endedBy)) {
      expect({ recovery, problems: endedBy[recovery]?.length }).toEqual({
        recovery,
        problems: 1,
      });
    }

    // And every recovery in the list ends something.
    for (const definition of NetworkEventTypeUtil.getByKind(
      NetworkEventKind.Recovery,
    )) {
      expect({
        recovery: definition.type,
        ends: NetworkEventTypeUtil.getClearedProblem(definition.type),
      }).toEqual({
        recovery: definition.type,
        ends: (endedBy[definition.type] as Array<string>)[0],
      });
    }
  });

  it("pairs each problem with the event that ends it", () => {
    const pairs: Record<string, string> = {};

    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (definition.clearedBy) {
        pairs[definition.type] = definition.clearedBy;
      }
    }

    expect(pairs).toEqual({
      "interface.down": "interface.up",
      "device.offline": "device.online",
      "ha.peer_down": "ha.peer_up",
      "vpn.tunnel_down": "vpn.tunnel_up",
      "routing.neighbor_down": "routing.neighbor_up",
      "gateway.down": "gateway.up",
      "sdwan.sla_not_met": "sdwan.sla_met",
      "hardware.fan_failed": "hardware.fan_ok",
      "hardware.power_supply_failed": "hardware.power_supply_ok",
    });
  });

  it("a problem and the event that ends it are about the same thing", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (!definition.clearedBy) {
        continue;
      }

      expect({
        type: definition.type,
        subject: NetworkEventTypeUtil.get(definition.clearedBy)
          ?.subjectAttribute,
      }).toEqual({
        type: definition.type,
        subject: definition.subjectAttribute,
      });
    }
  });

  it("knows which events read as problems, recoveries and neither", () => {
    const byKind: (kind: NetworkEventKind) => Array<string> = (
      kind: NetworkEventKind,
    ): Array<string> => {
      return NetworkEventTypeUtil.getByKind(kind).map(
        (definition: NetworkEventDefinition): string => {
          return definition.type;
        },
      );
    };

    expect(byKind(NetworkEventKind.Info)).toEqual([
      "device.config_change",
      "ha.state_change",
      "stp.topology_change",
      "auth.login_success",
      "wireless.client_connected",
      "wireless.client_disconnected",
    ]);
    expect(byKind(NetworkEventKind.Recovery)).toHaveLength(9);
    expect(
      byKind(NetworkEventKind.Problem).length +
        byKind(NetworkEventKind.Recovery).length +
        byKind(NetworkEventKind.Info).length,
    ).toBe(NETWORK_EVENT_DEFINITIONS.length);
  });

  it("getClearedProblem answers null for anything that ends nothing", () => {
    expect(NetworkEventTypeUtil.getClearedProblem("interface.up")).toBe(
      "interface.down",
    );
    expect(
      NetworkEventTypeUtil.getClearedProblem("interface.down"),
    ).toBeNull();
    expect(NetworkEventTypeUtil.getClearedProblem("device.reboot")).toBeNull();
    expect(NetworkEventTypeUtil.getClearedProblem("nothing")).toBeNull();
    expect(NetworkEventTypeUtil.getClearedProblem(undefined)).toBeNull();
  });
});

describe("what an event is about", () => {
  it("names the subject of each event that has one", () => {
    const subjects: Record<string, string> = {};

    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (definition.subjectAttribute) {
        subjects[definition.type] = definition.subjectAttribute;
      }
    }

    expect(subjects).toEqual({
      "interface.down": "network.interface.name",
      "interface.up": "network.interface.name",
      "interface.error_disabled": "network.interface.name",
      "device.config_change": "user.name",
      "ha.failover": "ha.role",
      "ha.state_change": "ha.role",
      "ha.peer_down": "ha.peer",
      "ha.peer_up": "ha.peer",
      "vpn.tunnel_down": "vpn.tunnel.name",
      "vpn.tunnel_up": "vpn.tunnel.name",
      "routing.neighbor_down": "network.peer.address",
      "routing.neighbor_up": "network.peer.address",
      "gateway.down": "network.gateway.name",
      "gateway.up": "network.gateway.name",
      "wan.failover": "network.gateway.name",
      "sdwan.sla_not_met": "network.gateway.name",
      "sdwan.sla_met": "network.gateway.name",
      "hardware.fan_failed": "hw.name",
      "hardware.fan_ok": "hw.name",
      "hardware.power_supply_failed": "hw.name",
      "hardware.power_supply_ok": "hw.name",
      "loop.detected": "network.interface.name",
      "poe.fault": "network.interface.name",
      "auth.login_failed": "user.name",
      "auth.login_success": "user.name",
      "wireless.client_connected": "client.mac",
      "wireless.client_disconnected": "client.mac",
    });
  });

  it("never uses the event's own keys as a subject", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      expect([
        NetworkEventAttribute.Domain,
        NetworkEventAttribute.Name,
        NetworkEventAttribute.Message,
      ]).not.toContain(definition.subjectAttribute);
    }
  });
});

describe("the attributes an event is stored with", () => {
  it("are these keys - stored data, never renamed", () => {
    expect(NetworkEventAttribute).toEqual({
      Domain: "event.domain",
      Name: "event.name",
      Message: "event.message",
      InterfaceName: "network.interface.name",
      PeerAddress: "network.peer.address",
      ProtocolName: "network.protocol.name",
      VpnTunnelName: "vpn.tunnel.name",
      GatewayName: "network.gateway.name",
      HardwareName: "hw.name",
      HaRole: "ha.role",
      HaPeer: "ha.peer",
      UserName: "user.name",
      ClientAddress: "client.address",
      ClientMac: "client.mac",
      WifiSsid: "wifi.ssid",
    });
    expect(NETWORK_EVENT_DOMAIN).toBe("network");
  });
});

describe("NetworkEventTypeUtil", () => {
  it("finds a built-in event by its name, and nothing else", () => {
    expect(NetworkEventTypeUtil.get("interface.down")?.type).toBe(
      NetworkEventType.InterfaceDown,
    );
    expect(NetworkEventTypeUtil.get("Interface.Down")).toBeNull();
    expect(NetworkEventTypeUtil.get("ups.on_battery")).toBeNull();
    expect(NetworkEventTypeUtil.get("")).toBeNull();
    expect(NetworkEventTypeUtil.get(null)).toBeNull();
    expect(NetworkEventTypeUtil.get(12)).toBeNull();
    // A name every object has is not an event.
    expect(NetworkEventTypeUtil.get("constructor")).toBeNull();
    expect(NetworkEventTypeUtil.isBuiltIn("toString")).toBe(false);
  });

  it("accepts the names a project may give its own events", () => {
    for (const name of [
      "ups.on_battery",
      "door.opened",
      "a",
      "a1.b2",
      "printer.toner-low",
      "x".repeat(MAX_NETWORK_EVENT_NAME_LENGTH),
    ]) {
      expect({ name, valid: NetworkEventTypeUtil.isValidName(name) }).toEqual({
        name,
        valid: true,
      });
    }
  });

  it("refuses what could not be a name", () => {
    for (const name of [
      "",
      " ",
      "Interface.Down",
      "interface down",
      "interface..down",
      ".down",
      "down.",
      "1up",
      "ups.on battery",
      "ups/on",
      "ups.é",
      "<script>",
      "x".repeat(MAX_NETWORK_EVENT_NAME_LENGTH + 1),
    ]) {
      expect({ name, valid: NetworkEventTypeUtil.isValidName(name) }).toEqual({
        name,
        valid: false,
      });
    }

    for (const value of [null, undefined, 5, {}, [], true]) {
      expect(NetworkEventTypeUtil.isValidName(value)).toBe(false);
    }
  });

  it("reads a project's own event as something that happened, neither problem nor recovery", () => {
    expect(NetworkEventTypeUtil.getKind("interface.down")).toBe(
      NetworkEventKind.Problem,
    );
    expect(NetworkEventTypeUtil.getKind("interface.up")).toBe(
      NetworkEventKind.Recovery,
    );
    expect(NetworkEventTypeUtil.getKind("ups.on_battery")).toBe(
      NetworkEventKind.Info,
    );
    expect(NetworkEventTypeUtil.getKind(undefined)).toBe(NetworkEventKind.Info);
  });

  it("getAll hands the definitions out in the list's order", () => {
    expect(NetworkEventTypeUtil.getAll()).toBe(NETWORK_EVENT_DEFINITIONS);
  });
});
