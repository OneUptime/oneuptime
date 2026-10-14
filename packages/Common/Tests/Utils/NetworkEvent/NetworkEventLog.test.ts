import {
  getNetworkEventClassAttributes,
  getNetworkEventName,
  markNetworkEvent,
} from "../../../Utils/NetworkEvent/NetworkEventLog";
import NetworkEventType, {
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventCategory,
  NetworkEventDefinition,
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "../../../Types/NetworkEvent/NetworkEventType";
import { describe, expect, test } from "@jest/globals";

/*
 * A network event is a log with two attributes: `event.name` says what
 * happened, `event.domain` = "network" says it is a network event. Three
 * more are what searches, monitors and lists ask of it: `event.kind`,
 * `event.category`, and `event.device` - which device, in words.
 *
 * The built-in parsers write the name, the kind and the category. A
 * project's own event is named by a log pipeline, which writes only the
 * name; markNetworkEvent adds the rest, so an event a project defines
 * searches and alerts like a built-in one.
 */

describe("getNetworkEventClassAttributes", () => {
  test("every built-in event has a kind and a category, as its definition says", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      expect({
        type: definition.type,
        attributes: getNetworkEventClassAttributes(definition.type),
      }).toEqual({
        type: definition.type,
        attributes: {
          "event.kind": definition.kind,
          "event.category": definition.category,
        },
      });
    }
  });

  test("the values are the words stored on logs: never renamed", () => {
    expect(getNetworkEventClassAttributes("interface.down")).toEqual({
      "event.kind": "problem",
      "event.category": "interface",
    });
    expect(getNetworkEventClassAttributes("vpn.tunnel_up")).toEqual({
      "event.kind": "recovery",
      "event.category": "vpn",
    });
    expect(getNetworkEventClassAttributes("device.reboot")).toEqual({
      "event.kind": "problem",
      "event.category": "device",
    });
    expect(Object.values(NetworkEventKind).sort()).toEqual([
      "info",
      "problem",
      "recovery",
    ]);
  });

  test("a project's own event, and anything that is not a name, has neither", () => {
    for (const name of ["ups.on_battery", "", null, undefined, 5, "toString"]) {
      expect(getNetworkEventClassAttributes(name)).toEqual({});
    }
  });

  test("every category is one the vocabulary lists", () => {
    const categories: Array<string> = Object.values(NetworkEventCategory);

    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      expect(categories).toContain(
        getNetworkEventClassAttributes(definition.type)["event.category"],
      );
    }
  });
});

describe("markNetworkEvent", () => {
  test("makes a network event of a log a pipeline gave an event's name", () => {
    const attributes: Record<string, unknown> = {
      "event.name": "ups.on_battery",
      "networkDevice.id": "d1",
    };

    expect(markNetworkEvent(attributes, { device: "Rack UPS" })).toBe(true);
    expect(attributes).toEqual({
      "event.name": "ups.on_battery",
      "event.domain": "network",
      // Something happened; nothing here knows whether it is a problem.
      "event.kind": "info",
      "event.device": "Rack UPS",
      "networkDevice.id": "d1",
    });
  });

  test("every event has a kind, one of the three: a list narrowed to a kind misses none", () => {
    // A pipeline may say what its own event is.
    for (const kind of Object.values(NetworkEventKind)) {
      const attributes: Record<string, unknown> = {
        "event.name": "ups.on_battery",
        "event.kind": kind,
      };

      markNetworkEvent(attributes);

      expect(attributes["event.kind"]).toBe(kind);
    }

    // Anything else it wrote there is not a kind.
    for (const kind of [
      "catastrophe",
      "Problem",
      "PROBLEM",
      " problem",
      "",
      null,
      undefined,
      0,
      1,
      true,
      ["problem"],
      { kind: "problem" },
    ]) {
      const attributes: Record<string, unknown> = {
        "event.name": "ups.on_battery",
        "event.kind": kind,
      };

      expect({ kind: kind, marked: markNetworkEvent(attributes) }).toEqual({
        kind: kind,
        marked: true,
      });
      expect({ kind: kind, stored: attributes["event.kind"] }).toEqual({
        kind: kind,
        stored: "info",
      });
    }

    // A kind the object only inherits is not the log's.
    const inherited: Record<string, unknown> = Object.create({
      "event.kind": "problem",
    }) as Record<string, unknown>;
    inherited["event.name"] = "ups.on_battery";

    markNetworkEvent(inherited);

    expect(Object.prototype.hasOwnProperty.call(inherited, "event.kind")).toBe(
      true,
    );
    expect(inherited["event.kind"]).toBe("info");
  });

  test("a project's own event marked twice is marked once", () => {
    const attributes: Record<string, unknown> = {
      "event.name": "ups.on_battery",
    };

    expect(markNetworkEvent(attributes, { device: "Rack UPS" })).toBe(true);

    const before: string = JSON.stringify(attributes);

    expect(markNetworkEvent(attributes, { device: "Rack UPS" })).toBe(false);
    expect(JSON.stringify(attributes)).toBe(before);
  });

  test("a pipeline that gives a line a built-in name gets the built-in event whole", () => {
    // A vendor no parser knows, read by a project's own Grok pattern.
    const attributes: Record<string, unknown> = {
      "event.name": "interface.down",
      "network.interface.name": "xe-0/0/1",
    };

    expect(markNetworkEvent(attributes, { device: "edge-1" })).toBe(true);
    expect(attributes).toEqual({
      "event.name": "interface.down",
      "event.domain": "network",
      "event.kind": "problem",
      "event.category": "interface",
      "event.device": "edge-1",
      "network.interface.name": "xe-0/0/1",
    });
  });

  test("takes every built-in event's name", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      const attributes: Record<string, unknown> = {
        "event.name": definition.type,
      };

      expect({
        type: definition.type,
        marked: markNetworkEvent(attributes),
      }).toEqual({ type: definition.type, marked: true });
      expect(attributes["event.domain"]).toBe("network");
      expect(attributes["event.kind"]).toBe(definition.kind);
      expect(attributes["event.category"]).toBe(definition.category);
    }
  });

  test("a parser's event only needs its device: called again, nothing changes", () => {
    const attributes: Record<string, unknown> = {
      "event.domain": "network",
      "event.name": "interface.down",
      "event.kind": "problem",
      "event.category": "interface",
    };

    expect(markNetworkEvent(attributes, { device: "Core Switch" })).toBe(true);
    expect(attributes["event.device"]).toBe("Core Switch");

    const before: string = JSON.stringify(attributes);

    // Ingest calls it before a project's pipelines and again after them.
    expect(markNetworkEvent(attributes, { device: "Core Switch" })).toBe(false);
    expect(markNetworkEvent(attributes, { device: "Another Name" })).toBe(
      false,
    );
    expect(markNetworkEvent(attributes)).toBe(false);
    expect(JSON.stringify(attributes)).toBe(before);
  });

  test("a pipeline that renames a built-in event keeps what the parser said of it", () => {
    const attributes: Record<string, unknown> = {
      "event.domain": "network",
      "event.name": "uplink.down",
      "event.kind": "problem",
      "event.category": "interface",
      "event.device": "Core Switch",
    };

    expect(markNetworkEvent(attributes, { device: "Core Switch" })).toBe(false);
    expect(attributes["event.kind"]).toBe("problem");
    expect(attributes["event.category"]).toBe("interface");
  });

  test("a pipeline that turns one built-in event into another gets the other's kind and category", () => {
    const attributes: Record<string, unknown> = {
      "event.domain": "network",
      "event.name": "interface.up",
      "event.kind": "problem",
      "event.category": "vpn",
    };

    expect(markNetworkEvent(attributes)).toBe(true);
    expect(attributes).toMatchObject({
      "event.kind": "recovery",
      "event.category": "interface",
    });
  });

  test("the device is trimmed, cut to the length a subject may have, and never set to nothing", () => {
    const long: Record<string, unknown> = { "event.name": "device.reboot" };

    markNetworkEvent(long, { device: `  ${"x".repeat(1000)}  ` });

    expect(String(long["event.device"])).toHaveLength(256);

    for (const device of ["", "   ", null, undefined]) {
      const attributes: Record<string, unknown> = {
        "event.name": "device.reboot",
      };

      markNetworkEvent(attributes, { device });

      expect(Object.keys(attributes)).not.toContain("event.device");
    }
  });

  test("an empty device already on the log is filled in", () => {
    for (const existing of ["", null, undefined]) {
      const attributes: Record<string, unknown> = {
        "event.name": "device.reboot",
        "event.device": existing,
      };

      expect(markNetworkEvent(attributes, { device: "fw-1" })).toBe(true);
      expect(attributes["event.device"]).toBe("fw-1");
    }
  });

  test("leaves a log with no event's name alone", () => {
    for (const attributes of [
      {},
      { "event.message": "text" },
      { "event.name": "" },
      { "event.name": null },
      { "event.name": undefined },
      { "event.name": 5 },
      { "event.name": ["interface.down"] },
    ] as Array<Record<string, unknown>>) {
      const before: string = JSON.stringify(attributes);

      expect(markNetworkEvent(attributes, { device: "sw1" })).toBe(false);
      expect(JSON.stringify(attributes)).toBe(before);
    }
  });

  test("leaves a category that is not an event's name alone: a pipeline may file anything under the key", () => {
    for (const name of [
      "Payment Error",
      "Interface.Down",
      "interface down",
      "INTERFACE_DOWN",
      ".down",
      "down.",
      "a..b",
      "9lives",
      "x".repeat(65),
      "interface.down\n",
      " interface.down",
    ]) {
      const attributes: Record<string, unknown> = { "event.name": name };

      expect({
        name,
        marked: markNetworkEvent(attributes, { device: "sw1" }),
      }).toEqual({ name, marked: false });
      expect(Object.keys(attributes)).toEqual(["event.name"]);
      // The rule is the vocabulary's: whatever it calls a name, this marks.
      expect(NetworkEventTypeUtil.isValidName(name)).toBe(false);
    }
  });

  test("never touches a log of another domain: another product's event stays its own", () => {
    for (const domain of ["k8s", "browser", "device", "Network"]) {
      const attributes: Record<string, unknown> = {
        "event.name": "interface.down",
        "event.domain": domain,
      };

      expect(markNetworkEvent(attributes, { device: "sw1" })).toBe(false);
      expect(attributes).toEqual({
        "event.name": "interface.down",
        "event.domain": domain,
      });
    }
  });

  test("treats an empty domain as none", () => {
    for (const domain of ["", null, undefined]) {
      const attributes: Record<string, unknown> = {
        "event.name": "interface.down",
        "event.domain": domain,
      };

      expect(markNetworkEvent(attributes)).toBe(true);
      expect(attributes["event.domain"]).toBe("network");
    }
  });

  test("a name the object only inherits is not the log's", () => {
    const attributes: Record<string, unknown> = Object.create({
      "event.name": "interface.down",
    }) as Record<string, unknown>;

    expect(markNetworkEvent(attributes, { device: "sw1" })).toBe(false);
    expect(Object.keys(attributes)).toEqual([]);
  });

  test("what is not a set of attributes changes nothing", () => {
    for (const value of [null, undefined, "text", 5, true]) {
      expect(markNetworkEvent(value as never, { device: "sw1" })).toBe(false);
    }
  });
});

describe("getNetworkEventName", () => {
  test("is the name of a log that is a network event", () => {
    expect(
      getNetworkEventName({
        "event.name": "interface.down",
        "event.domain": "network",
      }),
    ).toBe("interface.down");

    // A project's own event, once marked.
    const attributes: Record<string, unknown> = {
      "event.name": "ups.on_battery",
    };

    expect(getNetworkEventName(attributes)).toBeNull();

    markNetworkEvent(attributes);

    expect(getNetworkEventName(attributes)).toBe("ups.on_battery");
  });

  test("is null for an event of another domain, or of none", () => {
    for (const attributes of [
      { "event.name": "interface.down" },
      { "event.name": "interface.down", "event.domain": "k8s" },
      { "event.name": "interface.down", "event.domain": "Network" },
      { "event.name": "interface.down", "event.domain": "" },
      { "event.domain": "network" },
      { "event.name": 5, "event.domain": "network" },
      { "event.name": null, "event.domain": "network" },
      {},
    ] as Array<Record<string, unknown>>) {
      expect({ attributes, name: getNetworkEventName(attributes) }).toEqual({
        attributes,
        name: null,
      });
    }
  });

  test("is null for what is not a set of attributes, or only inherits a name", () => {
    for (const value of [null, undefined, "text", 5]) {
      expect(getNetworkEventName(value as never)).toBeNull();
    }

    expect(
      getNetworkEventName(
        Object.create({
          "event.name": "interface.down",
          "event.domain": "network",
        }) as Record<string, unknown>,
      ),
    ).toBeNull();
  });
});

describe("a recovery and the problem it ends are of one category", () => {
  test("so a monitor on a category's problems is resolved by the same category's recoveries", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (!definition.clearedBy) {
        continue;
      }

      const recovery: NetworkEventDefinition | null = NetworkEventTypeUtil.get(
        definition.clearedBy,
      );

      expect(recovery).not.toBeNull();
      expect({
        problem: definition.type,
        category: recovery?.category,
        kind: recovery?.kind,
      }).toEqual({
        problem: definition.type,
        category: definition.category,
        kind: NetworkEventKind.Recovery,
      });
      expect(definition.kind).toBe(NetworkEventKind.Problem);
    }

    // And there are such pairs.
    expect(
      NetworkEventTypeUtil.get(NetworkEventType.InterfaceDown)?.clearedBy,
    ).toBe(NetworkEventType.InterfaceUp);
  });
});
