import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import NetworkEventType, {
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventKind,
} from "Common/Types/NetworkEvent/NetworkEventType";
import SyslogEventNormalizer from "Common/Utils/Syslog/SyslogEventNormalizer";
import { getSnmpTrapEventAttributes } from "Common/Utils/NetworkEvent/SnmpTrapEvent";
import { markNetworkEvent } from "Common/Utils/NetworkEvent/NetworkEventLog";
import {
  ALL_SYSLOG_VENDOR_SAMPLES,
  SyslogVendorSample,
} from "Common/Tests/Helpers/SyslogVendorSamples";
import {
  NETWORK_EVENT_DETAIL_LABELS,
  NETWORK_EVENT_FACET_KEYS,
  NETWORK_EVENT_SUBJECT_LABELS,
  NetworkEventCounts,
  NetworkEventRow,
  NetworkEventSource,
  buildNetworkEventAttributes,
  buildNetworkEventFacetsRequest,
  buildNetworkEventSourcesAttributes,
  getNetworkEventDetailAttributes,
  getNetworkEventSubjects,
  parseNetworkEventCounts,
  toNetworkEventRow,
  toNetworkEventRows,
  toNetworkEventSources,
} from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsModel";
import {
  NETWORK_EVENT_COPY,
  getNetworkEventCopy,
  getNetworkEventTitle,
} from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventCopy";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Events pages show, as data: a log turned into a row, the counts
 * read from the logs facets, and the addresses that send syslog without
 * being a device yet.
 *
 * The rows are built from what ClickHouse hands back - attributes as
 * strings, a switch as "true" - so the fixtures are written that way. And
 * the rows are held to what ingest really stores: every vendor's sample
 * line is read by the real parsers and must come out as a row a person can
 * read.
 */

const DEVICE_ID: string = "84858d6c-0000-4000-8000-000000000001";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";

function log(
  attributes: Record<string, unknown>,
  overrides: JSONObject = {},
): { _id: string; time: string; body: string; attributes: JSONObject } {
  return {
    _id: "log-1",
    time: "2026-10-13T10:11:12.345Z",
    body: "the body of the log",
    attributes: attributes as JSONObject,
    ...overrides,
  } as { _id: string; time: string; body: string; attributes: JSONObject };
}

const LINK_DOWN: Record<string, unknown> = {
  "event.domain": "network",
  "event.name": "interface.down",
  "event.kind": "problem",
  "event.category": "interface",
  "event.device": "Core Switch",
  "event.message": "Interface GigabitEthernet0/1, changed state to down",
  "network.interface.name": "GigabitEthernet0/1",
  "networkDevice.id": DEVICE_ID,
  "networkDevice.name": "Core Switch",
  "syslog.vendor": "Cisco",
  "syslog.parser": "cisco",
  "syslog.sourceIp": "10.0.0.2",
  "syslog.hostname": "core-sw1",
  "syslog.severity.code": "3",
  "probe.id": PROBE_ID,
  "cisco.facility": "LINK",
  "cisco.mnemonic": "UPDOWN",
  "oneuptime.service.id": "svc-1",
  "oneuptime.service.name": "Core Switch",
};

describe("a log as a row of an Events page", () => {
  test("says what happened, to what, on which device, in the device's own words", () => {
    const row: NetworkEventRow | null = toNetworkEventRow(log(LINK_DOWN), 0);

    expect(row).toMatchObject({
      id: "log-1-0",
      name: "interface.down",
      kind: NetworkEventKind.Problem,
      device: "Core Switch",
      networkDeviceId: DEVICE_ID,
      subject: {
        attribute: "network.interface.name",
        label: "Interface",
        value: "GigabitEthernet0/1",
      },
      details: [],
      message: "Interface GigabitEthernet0/1, changed state to down",
      vendor: "Cisco",
      sourceIp: "10.0.0.2",
      probeId: PROBE_ID,
      isFromUnknownSource: false,
      isSnmpTrap: false,
    });
    expect(row?.time?.toISOString()).toBe("2026-10-13T10:11:12.345Z");
  });

  test("a log that is not a network event is no row", () => {
    for (const attributes of [
      {},
      { "event.name": "interface.down" },
      { "event.name": "interface.down", "event.domain": "k8s" },
      { "event.domain": "network" },
      { "event.domain": "network", "event.name": "" },
    ]) {
      expect(toNetworkEventRow(log(attributes), 0)).toBeNull();
    }

    for (const attributes of [null, undefined, "text", ["a"], 5]) {
      expect(
        toNetworkEventRow(
          { attributes: attributes as unknown, time: "2026-10-13T10:11:12Z" },
          0,
        ),
      ).toBeNull();
    }
  });

  test("an event from an address that is not a device yet is known by what it calls itself", () => {
    const row: NetworkEventRow | null = toNetworkEventRow(
      log({
        "event.domain": "network",
        "event.name": "interface.down",
        "event.kind": "problem",
        "event.device": "unknown-sw",
        "syslog.unmatched": "true",
        "syslog.sourceIp": "203.0.113.77",
        "probe.id": PROBE_ID,
      }),
      0,
    );

    expect(row).toMatchObject({
      device: "unknown-sw",
      isFromUnknownSource: true,
      sourceIp: "203.0.113.77",
      probeId: PROBE_ID,
    });
    expect(row?.networkDeviceId).toBeUndefined();
  });

  test("reads a switch however ClickHouse hands it back", () => {
    for (const value of [true, "true", "1", 1]) {
      expect(
        toNetworkEventRow(
          log({
            "event.domain": "network",
            "event.name": "device.reboot",
            "syslog.unmatched": value,
          }),
          0,
        )?.isFromUnknownSource,
      ).toBe(true);
    }

    for (const value of [false, "false", "0", "", undefined]) {
      expect(
        toNetworkEventRow(
          log({
            "event.domain": "network",
            "event.name": "device.reboot",
            "syslog.unmatched": value,
          }),
          0,
        )?.isFromUnknownSource,
      ).toBe(false);
    }
  });

  test("the device falls back through what the log knows: the name, the name it gives itself, its address", () => {
    const base: Record<string, unknown> = {
      "event.domain": "network",
      "event.name": "device.reboot",
    };

    expect(
      toNetworkEventRow(
        log({
          ...base,
          "networkDevice.name": "Core Switch",
          "syslog.hostname": "core-sw1",
          "syslog.sourceIp": "10.0.0.2",
        }),
        0,
      )?.device,
    ).toBe("Core Switch");
    expect(
      toNetworkEventRow(
        log({
          ...base,
          "syslog.hostname": "core-sw1",
          "syslog.sourceIp": "10.0.0.2",
        }),
        0,
      )?.device,
    ).toBe("core-sw1");
    expect(
      toNetworkEventRow(log({ ...base, "syslog.sourceIp": "10.0.0.2" }), 0)
        ?.device,
    ).toBe("10.0.0.2");
    expect(
      toNetworkEventRow(log({ ...base, "snmpTrap.sourceIp": "10.0.0.9" }), 0)
        ?.device,
    ).toBe("10.0.0.9");
    expect(toNetworkEventRow(log(base), 0)?.device).toBe("");
  });

  test("an event with no words of its own shows the log's body", () => {
    expect(
      toNetworkEventRow(
        log({ "event.domain": "network", "event.name": "device.reboot" }),
        0,
      )?.message,
    ).toBe("the body of the log");
  });

  test("a trap is told from syslog, and has the same shape", () => {
    const row: NetworkEventRow | null = toNetworkEventRow(
      log(
        {
          ...getSnmpTrapEventAttributes({
            trapOid: "1.3.6.1.6.3.1.1.5.3",
            varbinds: [{ oid: "1.3.6.1.2.1.31.1.1.1.1.7", value: "ether7" }],
          }),
          "event.device": "Branch Router",
          "snmpTrap.oid": "1.3.6.1.6.3.1.1.5.3",
          "snmpTrap.sourceIp": "10.9.0.1",
          "snmpTrap.name": "linkDown",
          "networkDevice.id": DEVICE_ID,
        },
        {
          body: "SNMP trap 1.3.6.1.6.3.1.1.5.3 (linkDown) received from 10.9.0.1",
        },
      ),
      0,
    );

    expect(row).toMatchObject({
      name: "interface.down",
      kind: NetworkEventKind.Problem,
      device: "Branch Router",
      isSnmpTrap: true,
      sourceIp: "10.9.0.1",
      subject: { label: "Interface", value: "ether7" },
    });
    expect(row?.vendor).toBeUndefined();
  });

  test("an event a project named itself is information, called by its name, with whatever it names as its subject", () => {
    const attributes: Record<string, unknown> = {
      "event.name": "ups.on_battery",
      "hw.name": "rack-1",
    };

    markNetworkEvent(attributes, { device: "Rack UPS" });

    const row: NetworkEventRow | null = toNetworkEventRow(log(attributes), 0);

    expect(row).toMatchObject({
      name: "ups.on_battery",
      kind: NetworkEventKind.Info,
      device: "Rack UPS",
      subject: { label: "Component", value: "rack-1" },
    });
    expect(getNetworkEventCopy("ups.on_battery")).toBeNull();
  });

  test("the kind on the log wins; a log without one takes its event's", () => {
    // A pipeline renamed a problem: the parser's reading of it stands.
    expect(
      toNetworkEventRow(
        log({
          "event.domain": "network",
          "event.name": "uplink.down",
          "event.kind": "problem",
        }),
        0,
      )?.kind,
    ).toBe(NetworkEventKind.Problem);

    // Stored before events carried a kind.
    expect(
      toNetworkEventRow(
        log({ "event.domain": "network", "event.name": "interface.up" }),
        0,
      )?.kind,
    ).toBe(NetworkEventKind.Recovery);

    // Nonsense in the attribute is not a kind.
    expect(
      toNetworkEventRow(
        log({
          "event.domain": "network",
          "event.name": "interface.down",
          "event.kind": "catastrophe",
        }),
        0,
      )?.kind,
    ).toBe(NetworkEventKind.Problem);
  });

  test("a time that cannot be read is no time, never an invalid date", () => {
    for (const time of ["not a date", "", null, undefined, 5]) {
      expect(
        toNetworkEventRow(
          {
            attributes: {
              "event.domain": "network",
              "event.name": "device.reboot",
            },
            time: time as unknown,
          },
          0,
        )?.time,
      ).toBeNull();
    }

    const date: Date = new Date("2026-10-13T10:11:12.000Z");

    expect(
      toNetworkEventRow(
        {
          attributes: {
            "event.domain": "network",
            "event.name": "device.reboot",
          },
          time: date,
        },
        0,
      )?.time,
    ).toEqual(date);
  });

  test("rows keep the order of the logs, each with an id of its own - even two logs with one id", () => {
    const rows: Array<NetworkEventRow> = toNetworkEventRows([
      log(LINK_DOWN),
      log({ "not.an": "event" }),
      log({
        ...LINK_DOWN,
        "event.name": "interface.up",
        "event.kind": "recovery",
      }),
    ]);

    expect(
      rows.map((row: NetworkEventRow): string => {
        return row.name;
      }),
    ).toEqual(["interface.down", "interface.up"]);
    expect(
      new Set(
        rows.map((row: NetworkEventRow): string => {
          return row.id;
        }),
      ).size,
    ).toBe(2);
  });

  test("a hostile attribute key is never walked into the prototype", () => {
    const attributes: JSONObject = JSON.parse(
      '{"event.domain": "network", "event.name": "device.reboot", "__proto__": {"polluted": "yes"}}',
    ) as JSONObject;

    const row: NetworkEventRow | null = toNetworkEventRow(
      { attributes: attributes, time: "2026-10-13T10:11:12Z" },
      0,
    );

    expect(row?.name).toBe("device.reboot");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.keys(row?.attributes || {})).not.toContain("__proto__");
  });
});

describe("what an event is about", () => {
  test("is the attribute its type names as its subject, first", () => {
    // A failed sign-in names the user first, then where from.
    expect(
      getNetworkEventSubjects("auth.login_failed", {
        "client.address": "192.0.2.10",
        "user.name": "root",
        "network.interface.name": "ssh",
      }).map((subject: { attribute: string }): string => {
        return subject.attribute;
      }),
    ).toEqual(["user.name", "network.interface.name", "client.address"]);
  });

  test("every subject attribute the vocabulary uses has a label a person can read", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (!definition.subjectAttribute) {
        continue;
      }

      expect({
        type: definition.type,
        label: NETWORK_EVENT_SUBJECT_LABELS[definition.subjectAttribute],
      }).not.toEqual({ type: definition.type, label: undefined });
    }
  });

  test("an attribute with no value, and one that is not a subject, are left out", () => {
    expect(
      getNetworkEventSubjects("interface.down", {
        "network.interface.name": "",
        "syslog.vendor": "Cisco",
        "event.device": "Core Switch",
      }),
    ).toEqual([]);
  });
});

describe("what the rest of an event's attributes are called", () => {
  /*
   * A routing event is about its neighbor. The same attribute on a
   * tunnel's event is the tunnel's far end, which nobody calls a neighbor.
   */
  test("a routing event's peer is its Neighbor: what the event is about", () => {
    expect(
      getNetworkEventSubjects("routing.neighbor_down", {
        "network.peer.address": "10.0.0.9",
      }),
    ).toEqual([
      {
        attribute: "network.peer.address",
        label: "Neighbor",
        value: "10.0.0.9",
      },
    ]);
  });

  test("a tunnel's peer is its Peer address, listed after the tunnel", () => {
    expect(
      getNetworkEventSubjects("vpn.tunnel_down", {
        "network.peer.address": "198.51.100.9",
        "vpn.tunnel.name": "HQ-to-Branch",
      }),
    ).toEqual([
      {
        attribute: "vpn.tunnel.name",
        label: "Tunnel",
        value: "HQ-to-Branch",
      },
      {
        attribute: "network.peer.address",
        label: "Peer address",
        value: "198.51.100.9",
      },
    ]);
  });

  test("only what an event is not about is renamed: every subject keeps its own label", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (!definition.subjectAttribute) {
        continue;
      }

      const subjects: Array<{ attribute: string; label: string }> =
        getNetworkEventSubjects(definition.type, {
          [definition.subjectAttribute]: "x",
        });

      expect({ type: definition.type, label: subjects[0]?.label }).toEqual({
        type: definition.type,
        label: NETWORK_EVENT_SUBJECT_LABELS[definition.subjectAttribute],
      });
    }
  });

  test("an event the project named has no subject of its own, so a peer it names is a Peer address", () => {
    expect(
      getNetworkEventSubjects("ups.on_battery", {
        "network.peer.address": "10.0.0.9",
      }).map((subject: { label: string }): string => {
        return subject.label;
      }),
    ).toEqual(["Peer address"]);
  });

  test("the other name is only given to attributes that have a label to begin with", () => {
    for (const attribute of Object.keys(NETWORK_EVENT_DETAIL_LABELS)) {
      expect({
        attribute,
        hasSubjectLabel: Boolean(NETWORK_EVENT_SUBJECT_LABELS[attribute]),
      }).toEqual({ attribute, hasSubjectLabel: true });
      expect(NETWORK_EVENT_DETAIL_LABELS[attribute]).not.toBe(
        NETWORK_EVENT_SUBJECT_LABELS[attribute],
      );
    }
  });

  test("a Sophos tunnel line, read by the real parser: the tunnel is the subject, the far end its peer address", () => {
    const sample: SyslogVendorSample = ALL_SYSLOG_VENDOR_SAMPLES.find(
      (candidate: SyslogVendorSample): boolean => {
        return (
          candidate.name === "sophos ipsec tunnel terminated, central reporting"
        );
      },
    )!;
    const attributes: Record<string, unknown> = {
      ...(SyslogEventNormalizer.readLine(sample.line)?.normalized.attributes ||
        {}),
    };

    markNetworkEvent(attributes, { device: "fw-hq-01" });

    const row: NetworkEventRow | null = toNetworkEventRow(log(attributes), 0);

    expect(row?.subject).toEqual({
      attribute: "vpn.tunnel.name",
      label: "Tunnel",
      value: "HQ-Branch1",
    });
    expect(row?.details).toEqual([
      {
        attribute: "network.peer.address",
        label: "Peer address",
        value: "10.171.4.118",
      },
    ]);
  });
});

describe("what a list calls an event", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("a built-in event by the vocabulary's words", () => {
    expect(getNetworkEventTitle("interface.down", english)).toBe(
      "Interface down",
    );
    expect(getNetworkEventTitle("vpn.tunnel_up", english)).toBe(
      "VPN tunnel up",
    );
  });

  test("in the reader's language when it has the words", () => {
    const german: Translator = createTranslator((text: string): string => {
      return text === "Interface down" ? "Schnittstelle ausgefallen" : text;
    }, "de");

    expect(getNetworkEventTitle("interface.down", german)).toBe(
      "Schnittstelle ausgefallen",
    );
    // No German for it yet: the English, never an empty title.
    expect(getNetworkEventTitle("interface.up", german)).toBe("Interface up");
  });

  test("an event the project named by its own name, as written", () => {
    expect(getNetworkEventTitle("ups.on_battery", english)).toBe(
      "ups.on_battery",
    );
    expect(getNetworkEventTitle("", english)).toBe("");
  });

  test("every built-in event has a title that is not its machine name", () => {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      const title: string = getNetworkEventTitle(definition.type, english);

      expect({ type: definition.type, title }).not.toEqual({
        type: definition.type,
        title: definition.type,
      });
      expect(title).toBe(NETWORK_EVENT_COPY[definition.type].title);
    }
  });
});

describe("every vendor's sample line, as a row", () => {
  /*
   * The line is read by the real parsers, completed the way ingest
   * completes it, and turned into a row: what a person would see for it.
   */
  const eventSamples: Array<SyslogVendorSample> =
    ALL_SYSLOG_VENDOR_SAMPLES.filter((sample: SyslogVendorSample): boolean => {
      return sample.expect.eventName !== null;
    });

  test("there are event samples for every parser that has rules", () => {
    expect(eventSamples.length).toBeGreaterThan(100);
  });

  test.each(
    eventSamples.map(
      (sample: SyslogVendorSample): [string, SyslogVendorSample] => {
        return [sample.name, sample];
      },
    ),
  )("%s", (_name: string, sample: SyslogVendorSample) => {
    const attributes: Record<string, unknown> = {
      ...(SyslogEventNormalizer.readLine(
        sample.line,
        sample.deviceVendor ? { deviceVendor: sample.deviceVendor } : undefined,
      )?.normalized.attributes || {}),
    };

    markNetworkEvent(attributes, { device: "Sender" });

    const row: NetworkEventRow | null = toNetworkEventRow(log(attributes), 0);

    expect(row).not.toBeNull();
    expect(row?.name).toBe(sample.expect.eventName);
    expect(row?.device).toBe("Sender");
    // A built-in event: it has a title, and the row's kind is its own.
    expect(NETWORK_EVENT_COPY[row?.name as NetworkEventType]).toBeDefined();
    expect(row?.kind).toBe(
      NETWORK_EVENT_DEFINITIONS.find(
        (definition: { type: string }): boolean => {
          return definition.type === row?.name;
        },
      )?.kind,
    );
    // The device's own words are there to read.
    expect((row?.message || "").length).toBeGreaterThan(0);
  });
});

describe("the logs a page asks for", () => {
  test("the network's page: every network event", () => {
    expect(
      buildNetworkEventAttributes({ scope: { kind: "network" }, filters: {} }),
    ).toEqual({ "event.domain": "network" });
  });

  test("a device's page: that device's, by the id a rename does not change", () => {
    expect(
      buildNetworkEventAttributes({
        scope: { kind: "device", networkDeviceId: DEVICE_ID },
        filters: {},
      }),
    ).toEqual({ "event.domain": "network", "networkDevice.id": DEVICE_ID });
  });

  test("narrowed by kind, event and device", () => {
    expect(
      buildNetworkEventAttributes({
        scope: { kind: "network" },
        filters: {
          kind: NetworkEventKind.Problem,
          event: "interface.down",
          device: "Core Switch",
        },
      }),
    ).toEqual({
      "event.domain": "network",
      "event.kind": "problem",
      "event.name": "interface.down",
      "event.device": "Core Switch",
    });
  });

  test("the counts leave the kind out: the button of a kind that is not picked still says how many", () => {
    expect(
      buildNetworkEventAttributes({
        scope: { kind: "network" },
        filters: { kind: NetworkEventKind.Problem, event: "interface.down" },
        withoutKind: true,
      }),
    ).toEqual({ "event.domain": "network", "event.name": "interface.down" });
  });

  test("a device filter means nothing on one device's page", () => {
    expect(
      buildNetworkEventAttributes({
        scope: { kind: "device", networkDeviceId: DEVICE_ID },
        filters: { device: "Somebody Else" },
      }),
    ).toEqual({ "event.domain": "network", "networkDevice.id": DEVICE_ID });
  });

  test("the facets request asks for kinds, events and devices over the window", () => {
    const window: InBetween<Date> = new InBetween<Date>(
      new Date("2026-10-12T10:00:00.000Z"),
      new Date("2026-10-13T10:00:00.000Z"),
    );

    expect(
      buildNetworkEventFacetsRequest({
        window: window,
        attributes: { "event.domain": "network" },
      }),
    ).toEqual({
      startTime: "2026-10-12T10:00:00.000Z",
      endTime: "2026-10-13T10:00:00.000Z",
      facetKeys: ["event.kind", "event.name", "event.device"],
      attributes: { "event.domain": "network" },
      limit: 200,
    });
    expect([...NETWORK_EVENT_FACET_KEYS]).toEqual([
      "event.kind",
      "event.name",
      "event.device",
    ]);
  });

  test("the logs of addresses that are no device are asked for by the mark ingest leaves on them", () => {
    // Stored as a switch; ClickHouse keeps it, and compares it, as the string.
    expect(buildNetworkEventSourcesAttributes()).toEqual({
      "syslog.unmatched": "true",
    });
  });
});

describe("the counts over a window", () => {
  function facets(data: Record<string, Array<JSONObject>>): JSONObject {
    return { facets: data as unknown as JSONObject };
  }

  test("by kind, by event and by device, the most frequent first", () => {
    const counts: NetworkEventCounts = parseNetworkEventCounts(
      facets({
        "event.kind": [
          { value: "info", count: 86 },
          { value: "problem", count: 23 },
          { value: "recovery", count: 19 },
        ],
        "event.name": [
          { value: "interface.up", count: 19 },
          { value: "wireless.client_connected", count: 86 },
          { value: "interface.down", count: 23 },
        ],
        "event.device": [
          { value: "Core Switch", count: 42 },
          { value: "Lobby AP", count: 86 },
        ],
      }),
    );

    expect(counts.total).toBe(128);
    expect(counts.byKind).toEqual({ problem: 23, recovery: 19, info: 86 });
    expect(counts.events).toEqual([
      { value: "wireless.client_connected", count: 86 },
      { value: "interface.down", count: 23 },
      { value: "interface.up", count: 19 },
    ]);
    expect(counts.devices).toEqual([
      { value: "Lobby AP", count: 86 },
      { value: "Core Switch", count: 42 },
    ]);
  });

  test("an event a project named carries no kind: it is counted as information, which is what the page shows it as", () => {
    const counts: NetworkEventCounts = parseNetworkEventCounts(
      facets({
        "event.kind": [{ value: "problem", count: 3 }],
        "event.name": [
          { value: "interface.down", count: 3 },
          { value: "ups.on_battery", count: 4 },
        ],
      }),
    );

    expect(counts.total).toBe(7);
    expect(counts.byKind).toEqual({ problem: 3, recovery: 0, info: 4 });
    // The three kinds add up to the total: no event is on no button.
    expect(
      counts.byKind.problem + counts.byKind.recovery + counts.byKind.info,
    ).toBe(counts.total);
  });

  test("counts ClickHouse sends as strings are read; what is not a count is dropped", () => {
    const counts: NetworkEventCounts = parseNetworkEventCounts(
      facets({
        "event.name": [
          { value: "interface.down", count: "12" },
          { value: "interface.up", count: "many" },
          { value: "", count: 5 },
          { value: "device.reboot", count: 0 },
          { value: "ha.failover", count: -3 },
          null as unknown as JSONObject,
        ],
      }),
    );

    expect(counts.events).toEqual([{ value: "interface.down", count: 12 }]);
    expect(counts.total).toBe(12);
  });

  test("an answer with nothing in it is no events", () => {
    for (const response of [
      undefined,
      null,
      {},
      { facets: {} },
      { facets: null },
    ]) {
      expect(
        parseNetworkEventCounts(response as JSONObject | undefined),
      ).toEqual({
        total: 0,
        byKind: { problem: 0, recovery: 0, info: 0 },
        events: [],
        devices: [],
      });
    }
  });

  test("a kind the vocabulary does not have is not given a button of its own", () => {
    const counts: NetworkEventCounts = parseNetworkEventCounts(
      facets({
        "event.kind": [
          { value: "problem", count: 2 },
          { value: "catastrophe", count: 9 },
        ],
        "event.name": [{ value: "interface.down", count: 11 }],
      }),
    );

    expect(Object.keys(counts.byKind).sort()).toEqual([
      "info",
      "problem",
      "recovery",
    ]);
    expect(counts.byKind.problem).toBe(2);
    expect(counts.byKind.info).toBe(9);
  });
});

describe("who sends syslog without being a device", () => {
  function unmatched(
    address: string,
    time: string,
    extra: Record<string, unknown> = {},
  ): { time: string; attributes: JSONObject } {
    return {
      time: time,
      attributes: {
        "syslog.unmatched": "true",
        "syslog.sourceIp": address,
        "probe.id": PROBE_ID,
        ...extra,
      } as JSONObject,
    };
  }

  test("one row per address, the one heard from last first, with what its messages say of it", () => {
    const sources: Array<NetworkEventSource> = toNetworkEventSources([
      unmatched("203.0.113.7", "2026-10-13T10:11:12Z", {
        "syslog.hostname": "edge-sw9",
        "syslog.vendor": "Cisco",
      }),
      unmatched("203.0.113.8", "2026-10-13T10:11:10Z"),
      unmatched("203.0.113.7", "2026-10-13T10:11:05Z"),
      unmatched("203.0.113.8", "2026-10-13T10:10:00Z", {
        "syslog.vendor": "MikroTik",
      }),
    ]);

    expect(sources).toEqual([
      {
        address: "203.0.113.7",
        hostname: "edge-sw9",
        vendor: "Cisco",
        probeId: PROBE_ID,
        lastSeenAt: new Date("2026-10-13T10:11:12Z"),
        messageCount: 2,
      },
      {
        address: "203.0.113.8",
        hostname: undefined,
        // Its newest message did not say; an older one did.
        vendor: "MikroTik",
        probeId: PROBE_ID,
        lastSeenAt: new Date("2026-10-13T10:11:10Z"),
        messageCount: 2,
      },
    ]);
  });

  test("a log of a device, and a log with no address, are nobody to add", () => {
    expect(
      toNetworkEventSources([
        {
          time: "2026-10-13T10:11:12Z",
          attributes: { "syslog.sourceIp": "10.0.0.2" },
        },
        {
          time: "2026-10-13T10:11:12Z",
          attributes: {
            "syslog.sourceIp": "10.0.0.2",
            "syslog.unmatched": "false",
          },
        },
        {
          time: "2026-10-13T10:11:12Z",
          attributes: { "syslog.unmatched": "true" },
        },
        { time: "2026-10-13T10:11:12Z", attributes: null },
      ]),
    ).toEqual([]);
  });

  test("lists at most as many as asked for, the newest", () => {
    const logs: Array<{ time: string; attributes: JSONObject }> = [];

    for (let index: number = 0; index < 60; index++) {
      logs.push(
        unmatched(
          `198.51.100.${index}`,
          new Date(Date.UTC(2026, 9, 13, 10, 0, index)).toISOString(),
        ),
      );
    }

    const sources: Array<NetworkEventSource> = toNetworkEventSources(logs, 5);

    expect(
      sources.map((source: NetworkEventSource): string => {
        return source.address;
      }),
    ).toEqual([
      "198.51.100.59",
      "198.51.100.58",
      "198.51.100.57",
      "198.51.100.56",
      "198.51.100.55",
    ]);
    expect(toNetworkEventSources(logs)).toHaveLength(25);
  });

  test("two addresses heard at the same moment are listed in a stable order", () => {
    const logs: Array<{ time: string; attributes: JSONObject }> = [
      unmatched("203.0.113.9", "2026-10-13T10:11:12Z"),
      unmatched("203.0.113.10", "2026-10-13T10:11:12Z"),
    ];

    expect(
      toNetworkEventSources(logs).map((source: NetworkEventSource): string => {
        return source.address;
      }),
    ).toEqual(
      toNetworkEventSources([...logs].reverse()).map(
        (source: NetworkEventSource): string => {
          return source.address;
        },
      ),
    );
  });
});

describe("an event's details", () => {
  test("list what the event says first, then the vendor's own fields, then where it came from", () => {
    const row: NetworkEventRow = toNetworkEventRow(log(LINK_DOWN), 0)!;

    expect(
      getNetworkEventDetailAttributes(row).map(
        (attribute: { key: string }): string => {
          return attribute.key;
        },
      ),
    ).toEqual([
      "event.category",
      "event.device",
      "event.kind",
      "event.message",
      "event.name",
      "network.interface.name",
      "cisco.facility",
      "cisco.mnemonic",
      "syslog.hostname",
      "syslog.parser",
      "syslog.severity.code",
      "syslog.sourceIp",
      "syslog.vendor",
      "networkDevice.name",
    ]);
  });

  test("leave out what only OneUptime's own plumbing reads", () => {
    const row: NetworkEventRow = toNetworkEventRow(
      log({
        ...LINK_DOWN,
        "syslog.relay.id": "relay-1",
        "syslog.relay.name": "Office UDM Pro",
        "snmpTrap.varbinds": "[...]",
      }),
      0,
    )!;
    const keys: Array<string> = getNetworkEventDetailAttributes(row).map(
      (attribute: { key: string }): string => {
        return attribute.key;
      },
    );

    for (const hidden of [
      "event.domain",
      "oneuptime.service.id",
      "oneuptime.service.name",
      "networkDevice.id",
      "probe.id",
      "syslog.relay.id",
      "snmpTrap.varbinds",
    ]) {
      expect(keys).not.toContain(hidden);
    }

    // The relay's name is worth reading: which controller passed it on.
    expect(keys).toContain("syslog.relay.name");
  });

  test("every value is the one stored", () => {
    const row: NetworkEventRow = toNetworkEventRow(log(LINK_DOWN), 0)!;

    for (const attribute of getNetworkEventDetailAttributes(row)) {
      expect(attribute.value).toBe(String(LINK_DOWN[attribute.key]));
    }
  });
});
