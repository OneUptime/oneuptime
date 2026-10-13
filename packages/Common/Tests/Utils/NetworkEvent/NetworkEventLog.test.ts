import {
  getNetworkEventName,
  markNetworkEvent,
} from "../../../Utils/NetworkEvent/NetworkEventLog";
import NetworkEventType, {
  NetworkEventTypeUtil,
} from "../../../Types/NetworkEvent/NetworkEventType";
import { describe, expect, test } from "@jest/globals";

/*
 * A network event is a log with two attributes: `event.name` says what
 * happened, `event.domain` = "network" says it is a network event. The
 * built-in parsers write both; a project's own event is named by a log
 * pipeline, which writes only the name, and markNetworkEvent adds the
 * domain - so an event a project defines searches and alerts like a
 * built-in one.
 */

describe("markNetworkEvent", () => {
  test("adds the domain to a log a pipeline gave an event's name", () => {
    const attributes: Record<string, unknown> = {
      "event.name": "ups.on_battery",
      "networkDevice.id": "d1",
    };

    expect(markNetworkEvent(attributes)).toBe(true);
    expect(attributes).toEqual({
      "event.name": "ups.on_battery",
      "event.domain": "network",
      "networkDevice.id": "d1",
    });
  });

  test("takes every built-in event's name", () => {
    for (const type of Object.values(NetworkEventType)) {
      const attributes: Record<string, unknown> = { "event.name": type };

      expect({ type, marked: markNetworkEvent(attributes) }).toEqual({
        type,
        marked: true,
      });
      expect(attributes["event.domain"]).toBe("network");
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

      expect(markNetworkEvent(attributes)).toBe(false);
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

      expect({ name, marked: markNetworkEvent(attributes) }).toEqual({
        name,
        marked: false,
      });
      expect(Object.keys(attributes)).toEqual(["event.name"]);
      // The rule is the vocabulary's: whatever it calls a name, this marks.
      expect(NetworkEventTypeUtil.isValidName(name)).toBe(false);
    }
  });

  test("never replaces a domain that is already there: another product's event stays its own", () => {
    for (const domain of ["k8s", "browser", "device", "Network", "network"]) {
      const attributes: Record<string, unknown> = {
        "event.name": "interface.down",
        "event.domain": domain,
      };

      expect(markNetworkEvent(attributes)).toBe(false);
      expect(attributes["event.domain"]).toBe(domain);
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

    expect(markNetworkEvent(attributes)).toBe(false);
    expect(Object.keys(attributes)).toEqual([]);
  });

  test("what is not a set of attributes changes nothing", () => {
    for (const value of [null, undefined, "text", 5, true]) {
      expect(markNetworkEvent(value as never)).toBe(false);
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
