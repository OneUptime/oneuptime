import NetworkEventAlertTemplates, {
  FAILED_LOGINS_ALERT_THRESHOLD,
  NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS,
  NetworkEventAlertTemplate,
  NetworkEventAlertTemplateId,
} from "../../../Types/NetworkEvent/NetworkEventAlertTemplates";
import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType, {
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventDefinition,
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "../../../Types/NetworkEvent/NetworkEventType";
import {
  MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES,
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import SyslogEventNormalizer from "../../../Utils/Syslog/SyslogEventNormalizer";
import { getSnmpTrapEventAttributes } from "../../../Utils/NetworkEvent/SnmpTrapEvent";
import {
  ALL_SYSLOG_VENDOR_SAMPLES,
  SyslogVendorSample,
} from "../../Helpers/SyslogVendorSamples";
import { describe, expect, test } from "@jest/globals";

/*
 * The network event alerts: each a Logs monitor ready to create. What they
 * are is data, and data can be wrong in ways no type catches - an alert
 * that counts an attribute nothing writes, one grouped by a key its events
 * never carry, a "down" resolved by an "up" that is grouped differently.
 * So every template is held to the vocabulary, and to what the parsers
 * actually store for the vendors' own sample lines.
 */

const FEATURED: ReadonlyArray<NetworkEventAlertTemplate> =
  NetworkEventAlertTemplates.getFeatured();

// What ingest stores for a sample line, before it knows the device.
function storedFor(sample: SyslogVendorSample): Record<string, string> {
  const read: ReturnType<typeof SyslogEventNormalizer.readLine> =
    SyslogEventNormalizer.readLine(
      sample.line,
      sample.deviceVendor ? { deviceVendor: sample.deviceVendor } : undefined,
    );

  return read?.normalized.attributes || {};
}

const STORED: Array<Record<string, string>> = ALL_SYSLOG_VENDOR_SAMPLES.map(
  (sample: SyslogVendorSample): Record<string, string> => {
    return storedFor(sample);
  },
);

function matches(
  stored: Record<string, string>,
  filter: Record<string, string>,
): boolean {
  return Object.keys(filter).every((key: string): boolean => {
    return stored[key] === filter[key];
  });
}

describe("the featured alerts", () => {
  test("are these eight, in this order: what takes a site down first, the noisy last", () => {
    expect(
      FEATURED.map((template: NetworkEventAlertTemplate): string => {
        return template.id;
      }),
    ).toEqual([
      "vpn-tunnel-down",
      "ha-failover",
      "wan-gateway-down",
      "routing-neighbor-down",
      "device-reboot",
      "hardware-failure",
      "interface-down",
      "failed-logins",
    ]);
    expect(Object.values(NetworkEventAlertTemplateId).sort()).toEqual(
      FEATURED.map((template: NetworkEventAlertTemplate): string => {
        return template.id;
      }).sort(),
    );
  });

  test("no id can be mistaken for an event's name: an id never has a dot, a name always does", () => {
    for (const template of FEATURED) {
      expect(template.id).toMatch(/^[a-z]+(?:-[a-z]+)+$/);
      expect(NetworkEventTypeUtil.isBuiltIn(template.id)).toBe(false);
    }

    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      expect(definition.type).toContain(".");
      expect(NetworkEventAlertTemplates.isFeatured(definition.type)).toBe(
        false,
      );
    }
  });

  test("every one counts network events only", () => {
    for (const template of FEATURED) {
      expect(template.attributes[NetworkEventAttribute.Domain]).toBe("network");

      if (Object.keys(template.resolvedByAttributes).length > 0) {
        expect(
          template.resolvedByAttributes[NetworkEventAttribute.Domain],
        ).toBe("network");
      }
    }
  });

  test("every one raises one alert per device, on the attribute every event carries", () => {
    for (const template of FEATURED) {
      expect(template.groupByAttributes[0]).toBe("event.device");
      expect(template.groupByAttributes.length).toBeLessThanOrEqual(
        MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES,
      );
      expect(new Set(template.groupByAttributes).size).toBe(
        template.groupByAttributes.length,
      );
    }
  });

  test("every one looks back five minutes, a window the monitor form offers", () => {
    expect(NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS).toBe(300);

    for (const template of FEATURED) {
      expect(template.windowInSeconds).toBe(300);
    }
  });

  test("all but one alert on the first event; repeated failed sign-ins waits for more than ten", () => {
    expect(FAILED_LOGINS_ALERT_THRESHOLD).toBe(10);

    for (const template of FEATURED) {
      expect({ id: template.id, moreThan: template.moreThan }).toEqual({
        id: template.id,
        moreThan:
          template.id === NetworkEventAlertTemplateId.FailedLogins ? 10 : 0,
      });
    }
  });

  test("what takes a path or a site down is critical; the rest is a warning", () => {
    expect(
      FEATURED.filter((template: NetworkEventAlertTemplate): boolean => {
        return template.severity === "Critical";
      }).map((template: NetworkEventAlertTemplate): string => {
        return template.id;
      }),
    ).toEqual([
      "vpn-tunnel-down",
      "ha-failover",
      "wan-gateway-down",
      "routing-neighbor-down",
      "hardware-failure",
    ]);
  });

  test("a problem with a recovery event is resolved by it, in the same grouping", () => {
    const expected: Record<string, string | null> = {
      "vpn-tunnel-down": "vpn.tunnel_up",
      "ha-failover": null,
      "wan-gateway-down": "gateway.up",
      "routing-neighbor-down": "routing.neighbor_up",
      "device-reboot": null,
      "interface-down": "interface.up",
      "failed-logins": null,
    };

    for (const template of FEATURED) {
      if (template.id === NetworkEventAlertTemplateId.HardwareFailure) {
        continue;
      }

      expect({
        id: template.id,
        resolvedBy:
          template.resolvedByAttributes[NetworkEventAttribute.Name] || null,
      }).toEqual({ id: template.id, resolvedBy: expected[template.id] });
    }
  });

  test("the hardware alert is by category: any failed component, resolved by the same component working again", () => {
    const hardware: NetworkEventAlertTemplate | null =
      NetworkEventAlertTemplates.get("hardware-failure");

    expect(hardware?.attributes).toEqual({
      "event.domain": "network",
      "event.category": "hardware",
      "event.kind": "problem",
    });
    expect(hardware?.resolvedByAttributes).toEqual({
      "event.domain": "network",
      "event.category": "hardware",
      "event.kind": "recovery",
    });
    expect(hardware?.groupByAttributes).toEqual(["event.device", "hw.name"]);
    expect(hardware?.event).toBeUndefined();

    // Every hardware problem and recovery the vocabulary has is covered.
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (definition.category !== "hardware") {
        continue;
      }

      const stored: Record<string, string> = {
        "event.domain": "network",
        "event.category": definition.category,
        "event.kind": definition.kind,
      };

      expect(
        matches(stored, hardware!.attributes) ||
          matches(stored, hardware!.resolvedByAttributes),
      ).toBe(true);
    }
  });
});

describe("a monitor's settings must be ones the Logs monitor reads", () => {
  test("Resolved By applies: every template that names a resolving log is grouped", () => {
    for (const template of FEATURED) {
      const step: Parameters<
        typeof MonitorStepLogMonitorUtil.isResolvedByLog
      >[0] = {
        groupByAttributes: template.groupByAttributes,
        resolvedByAttributes: template.resolvedByAttributes,
      };

      expect({
        id: template.id,
        resolvedByLog: MonitorStepLogMonitorUtil.isResolvedByLog(step),
      }).toEqual({
        id: template.id,
        resolvedByLog: Object.keys(template.resolvedByAttributes).length > 0,
      });

      // And nothing is lost on the way to the worker.
      expect(MonitorStepLogMonitorUtil.getResolvedByAttributes(step)).toEqual(
        template.resolvedByAttributes,
      );
      expect(MonitorStepLogMonitorUtil.getGroupByAttributes(step)).toEqual(
        template.groupByAttributes,
      );
    }
  });
});

describe("what the alerts count is what ingest stores", () => {
  /*
   * For every template: at least one vendor's own sample line is stored
   * with the attributes the template counts, and carries what the template
   * groups by. An alert on an attribute no parser writes would be created
   * without complaint and never fire.
   */
  test.each(
    FEATURED.map((template: NetworkEventAlertTemplate) => {
      return [template.id, template] as [string, NetworkEventAlertTemplate];
    }),
  )(
    "%s counts lines the parsers read",
    (_id: string, template: NetworkEventAlertTemplate) => {
      const filter: Record<string, string> = { ...template.attributes };
      const counted: Array<Record<string, string>> = STORED.filter(
        (stored: Record<string, string>): boolean => {
          return matches(stored, filter);
        },
      );

      expect(counted.length).toBeGreaterThan(0);

      // What it groups by beside the device (which ingest adds) is on them.
      for (const key of template.groupByAttributes) {
        if (key === NetworkEventAttribute.Device) {
          continue;
        }

        expect({
          id: template.id,
          key,
          carried: counted.some((stored: Record<string, string>): boolean => {
            return Boolean(stored[key]);
          }),
        }).toEqual({ id: template.id, key, carried: true });
      }
    },
  );

  test.each(
    FEATURED.filter((template: NetworkEventAlertTemplate): boolean => {
      return Object.keys(template.resolvedByAttributes).length > 0;
    }).map((template: NetworkEventAlertTemplate) => {
      return [template.id, template] as [string, NetworkEventAlertTemplate];
    }),
  )(
    "%s is resolved by lines the parsers read, carrying the same grouping",
    (_id: string, template: NetworkEventAlertTemplate) => {
      const resolving: Array<Record<string, string>> = STORED.filter(
        (stored: Record<string, string>): boolean => {
          return matches(stored, template.resolvedByAttributes);
        },
      );

      expect(resolving.length).toBeGreaterThan(0);

      for (const key of template.groupByAttributes) {
        if (key === NetworkEventAttribute.Device) {
          continue;
        }

        expect({
          id: template.id,
          key,
          carried: resolving.some((stored: Record<string, string>): boolean => {
            return Boolean(stored[key]);
          }),
        }).toEqual({ id: template.id, key, carried: true });
      }
    },
  );

  test("one vendor's down and up for the same thing land in the same group", () => {
    // Per parser: the subject of a "down" line and of its "up" line agree.
    const pairs: Array<[string, string, string]> = [
      ["interface.down", "interface.up", "network.interface.name"],
      ["vpn.tunnel_down", "vpn.tunnel_up", "vpn.tunnel.name"],
      ["gateway.down", "gateway.up", "network.gateway.name"],
      ["routing.neighbor_down", "routing.neighbor_up", "network.peer.address"],
    ];

    for (const [down, up, subject] of pairs) {
      const subjectsByParser: Record<
        string,
        { down: Set<string>; up: Set<string> }
      > = {};

      for (const stored of STORED) {
        const parser: string = stored["syslog.parser"] || "";
        const name: string = stored["event.name"] || "";

        if ((name !== down && name !== up) || !stored[subject]) {
          continue;
        }

        subjectsByParser[parser] = subjectsByParser[parser] || {
          down: new Set<string>(),
          up: new Set<string>(),
        };
        subjectsByParser[parser]![name === down ? "down" : "up"].add(
          stored[subject]!,
        );
      }

      const parsersWithBoth: Array<string> = Object.keys(
        subjectsByParser,
      ).filter((parser: string): boolean => {
        return (
          subjectsByParser[parser]!.down.size > 0 &&
          subjectsByParser[parser]!.up.size > 0
        );
      });

      // At least one vendor's samples show both sides of the pair.
      expect({ down, parsers: parsersWithBoth.length > 0 }).toEqual({
        down,
        parsers: true,
      });

      /*
       * The corpus holds, for every parser that reads both sides, a "down"
       * and an "up" line about the same interface, tunnel, gateway or
       * neighbour. If the two sides read its name differently ("Gi0/1" and
       * "GigabitEthernet0/1"), the up never resolves the down.
       */
      const parsersThatDisagree: Array<string> = parsersWithBoth.filter(
        (parser: string): boolean => {
          return !Array.from(subjectsByParser[parser]!.down).some(
            (value: string): boolean => {
              return subjectsByParser[parser]!.up.has(value);
            },
          );
        },
      );

      expect({ down, parsersThatDisagree }).toEqual({
        down,
        parsersThatDisagree: [],
      });
    }
  });

  test("a standard trap is counted and resolved like the syslog line for the same thing", () => {
    const interfaceDown: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.get("interface-down")!;
    const varbinds: Array<{ oid: string; value: string }> = [
      { oid: "1.3.6.1.2.1.31.1.1.1.1.7", value: "ether7" },
    ];

    const down: Record<string, string> = getSnmpTrapEventAttributes({
      trapOid: "1.3.6.1.6.3.1.1.5.3",
      varbinds: varbinds,
    });
    const up: Record<string, string> = getSnmpTrapEventAttributes({
      trapOid: "1.3.6.1.6.3.1.1.5.4",
      varbinds: varbinds,
    });

    expect(matches(down, interfaceDown.attributes)).toBe(true);
    expect(matches(up, interfaceDown.resolvedByAttributes)).toBe(true);
    expect(down["network.interface.name"]).toBe(up["network.interface.name"]);

    expect(
      matches(
        getSnmpTrapEventAttributes({
          trapOid: "1.3.6.1.6.3.1.1.5.1",
          varbinds: [],
        }),
        NetworkEventAlertTemplates.get("device-reboot")!.attributes,
      ),
    ).toBe(true);
  });
});

describe("an alert for any event", () => {
  test("every built-in event gets a monitor from what the vocabulary knows of it", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      const template: NetworkEventAlertTemplate | null =
        NetworkEventAlertTemplates.get(definition.type);

      expect(template).not.toBeNull();
      expect(template!.id).toBe(definition.type);
      expect(template!.event).toBe(definition.type);
      expect(template!.attributes).toEqual({
        "event.domain": "network",
        "event.name": definition.type,
      });
      expect(template!.windowInSeconds).toBe(300);
      expect(template!.moreThan).toBe(0);
      expect(template!.severity).toBe("Warning");
      expect(template!.groupByAttributes[0]).toBe("event.device");
    }
  });

  test("a problem is alerted on per thing it names; something that merely happened, per device", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      const template: NetworkEventAlertTemplate =
        NetworkEventAlertTemplates.get(definition.type)!;

      const expected: Array<string> =
        definition.kind === NetworkEventKind.Problem &&
        definition.subjectAttribute
          ? ["event.device", definition.subjectAttribute]
          : ["event.device"];

      expect({
        type: definition.type,
        groupBy: template.groupByAttributes,
      }).toEqual({ type: definition.type, groupBy: expected });
    }

    // A Wi-Fi client joining is not one alert per client.
    expect(
      NetworkEventAlertTemplates.get("wireless.client_connected")
        ?.groupByAttributes,
    ).toEqual(["event.device"]);
  });

  test("is resolved by the event that clears it, when it has one - whose own grouping is the same", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      const template: NetworkEventAlertTemplate =
        NetworkEventAlertTemplates.get(definition.type)!;

      if (!definition.clearedBy) {
        expect(template.resolvedByAttributes).toEqual({});
        continue;
      }

      expect(template.resolvedByAttributes).toEqual({
        "event.domain": "network",
        "event.name": definition.clearedBy,
      });

      const recovery: NetworkEventDefinition | null = NetworkEventTypeUtil.get(
        definition.clearedBy,
      );

      // The recovery names the same kind of thing, so it lands in the same group.
      expect({
        type: definition.type,
        subject: recovery?.subjectAttribute,
      }).toEqual({
        type: definition.type,
        subject: definition.subjectAttribute,
      });
    }
  });

  test("a project's own event gets one too, per device, resolved when it goes quiet", () => {
    expect(NetworkEventAlertTemplates.get("ups.on_battery")).toEqual({
      id: "ups.on_battery",
      event: "ups.on_battery",
      attributes: {
        "event.domain": "network",
        "event.name": "ups.on_battery",
      },
      resolvedByAttributes: {},
      groupByAttributes: ["event.device"],
      windowInSeconds: 300,
      moreThan: 0,
      severity: "Warning",
    });
  });

  test("any name an event can have gets one: nothing here knows which names a project's pipelines write", () => {
    for (const name of ["door.opened", "reboot", "ups-battery", "a.b.c"]) {
      expect(NetworkEventAlertTemplates.get(name)?.attributes).toEqual({
        "event.domain": "network",
        "event.name": name,
      });
    }
  });

  test("what is neither a template nor an event's name gets none", () => {
    for (const id of [
      "",
      "Interface Down",
      "Not-A-Template",
      "interface.down; DROP TABLE",
      "x".repeat(65),
      null,
      undefined,
      5,
      {},
      ["interface.down"],
    ]) {
      expect({ id, template: NetworkEventAlertTemplates.get(id) }).toEqual({
        id,
        template: null,
      });
    }
  });

  test("the featured template for an event and the event's own monitor differ only in what the template chose", () => {
    const featured: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.get("vpn-tunnel-down")!;
    const plain: NetworkEventAlertTemplate = NetworkEventAlertTemplates.get(
      NetworkEventType.VpnTunnelDown,
    )!;

    expect({ ...featured, id: "", severity: "" }).toEqual({
      ...plain,
      id: "",
      severity: "",
    });
    expect(featured.severity).toBe("Critical");
    expect(plain.severity).toBe("Warning");
  });
});

describe("an alert for one device", () => {
  test("counts and resolves that device's events only, by the id a rename does not change", () => {
    const template: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.forDevice(
        NetworkEventAlertTemplates.get("interface-down")!,
        "84858d6c-0000-4000-8000-000000000001",
      );

    expect(template.attributes).toEqual({
      "event.domain": "network",
      "event.name": "interface.down",
      "networkDevice.id": "84858d6c-0000-4000-8000-000000000001",
    });
    expect(template.resolvedByAttributes).toEqual({
      "event.domain": "network",
      "event.name": "interface.up",
      "networkDevice.id": "84858d6c-0000-4000-8000-000000000001",
    });
    // Still one alert per interface.
    expect(template.groupByAttributes).toEqual([
      "event.device",
      "network.interface.name",
    ]);
  });

  test("an event with no recovery stays resolved by silence: nothing is added to an empty Resolved By", () => {
    expect(
      NetworkEventAlertTemplates.forDevice(
        NetworkEventAlertTemplates.get("device-reboot")!,
        "84858d6c-0000-4000-8000-000000000001",
      ).resolvedByAttributes,
    ).toEqual({});
  });

  test("never changes the template every other page is given", () => {
    const before: string = JSON.stringify(FEATURED);

    const scoped: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.forDevice(
        NetworkEventAlertTemplates.get("interface-down")!,
        "device-1",
      );

    scoped.groupByAttributes.push("changed");
    scoped.attributes["changed"] = "yes";

    const fetched: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.get("interface-down")!;

    fetched.attributes["changed"] = "yes";
    fetched.groupByAttributes.push("changed");

    expect(JSON.stringify(NetworkEventAlertTemplates.getFeatured())).toBe(
      before,
    );
    expect(
      NetworkEventAlertTemplates.get("interface-down")!.attributes,
    ).toEqual({ "event.domain": "network", "event.name": "interface.down" });
  });
});
