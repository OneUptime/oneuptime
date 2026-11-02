import { describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  HOST_FIRST_DATA_GRACE_MS,
  HOST_READINGS_STALE_MS,
} from "Common/Types/Host/HostHealth";
import {
  HOST_ATTENTION_CURRENT,
  HOST_FLEET_ATTENTION_TRUNCATED_DESCRIPTION,
  HostAttentionRow,
  getHostDisplayName,
  getHostFleetAttentionItems,
  getHostOwnAttentionItems,
} from "../../FeatureSet/Dashboard/src/Pages/Host/Utils/HostAttention";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * What needs attention on a fleet of hosts and on one host, as the rows
 * the shared Needs attention card draws (Pages/Host/Utils/HostAttention):
 * HostHealth decides what needs attention and how bad it is; these pin how
 * that becomes rows - which hosts, in which order, with which words, which
 * name and which route.
 */

const NOW: Date = new Date("2026-11-02T10:00:00.000Z");
const MINUTE: number = 60_000;

// A reporting host with fresh readings that need nothing.
function host(fields: Partial<HostAttentionRow> = {}): HostAttentionRow {
  return {
    _id: "h-ok",
    name: "web-01",
    hostIdentifier: "web-01",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW.getTime() - MINUTE),
    createdAt: new Date(NOW.getTime() - 90 * 24 * 60 * MINUTE),
    cpuCores: 8,
    latestCpuPercent: 30,
    latestMemoryPercent: 50,
    latestSwapPercent: 1,
    latestDiskPercent: 40,
    latestDiskMountpoint: "/",
    latestInodesPercent: 10,
    latestInodesMountpoint: "/",
    latestLoadAverage15m: 1,
    failedSystemdUnitCount: 0,
    failedSystemdUnits: [],
    readingsUpdatedAt: new Date(NOW.getTime() - MINUTE),
    collectorInstanceUid: "uid-1",
    collectorConfigStatus: "applied",
    isCollectorHealthy: true,
    ...fields,
  };
}

function route(path: string): Route {
  return new Route(path);
}

function fleet(hosts: Array<HostAttentionRow>): Array<ResourceAttentionItem> {
  return getHostFleetAttentionItems({
    hosts: hosts,
    now: NOW,
    getHostRoute: (hostId: string): Route => {
      return route(`/host/${hostId}`);
    },
  });
}

function own(row: HostAttentionRow): Array<ResourceAttentionItem> {
  return getHostOwnAttentionItems({
    host: row,
    now: NOW,
    collectorName: "Databases",
    collectorRoute: route("/host/collector"),
    getUnitRoute: (unitName: string): Route => {
      return route(`/host/units/${unitName}`);
    },
  });
}

describe("the Hosts list's Needs attention rows", () => {
  const rows: Array<ResourceAttentionItem> = fleet([
    host(),
    host({
      _id: "h-db",
      name: "Payments database",
      hostIdentifier: "db-01.prod.internal",
      latestDiskPercent: 96.4,
      latestDiskMountpoint: "/var/lib/postgresql",
      latestMemoryPercent: 92.3,
    }),
    host({
      _id: "h-quiet",
      name: "web-03",
      hostIdentifier: "web-03",
      otelCollectorStatus: "disconnected",
      lastSeenAt: new Date(NOW.getTime() - 3 * 60 * MINUTE),
      // What it said last is no longer the truth.
      latestDiskPercent: 99,
    }),
    host({ _id: "h-swap", name: "edge-01", latestSwapPercent: 86 }),
    host({
      _id: "h-busy",
      name: "batch-01",
      latestSwapPercent: 86,
      latestLoadAverage15m: 20,
    }),
    host({
      _id: "h-new",
      name: "new-01",
      otelCollectorStatus: null,
      lastSeenAt: null,
      readingsUpdatedAt: null,
      collectorRegisteredAt: new Date(NOW.getTime() - 2 * MINUTE),
    }),
  ]);

  test("lists only the hosts that need attention, the critical first", () => {
    expect(
      rows.map((row: ResourceAttentionItem): [string, string] => {
        return [row.key, row.severity];
      }),
    ).toEqual([
      ["h-db", ResourceAttentionSeverity.Critical],
      ["h-quiet", ResourceAttentionSeverity.Critical],
      // The one with the most to look at first, then by name.
      ["h-busy", ResourceAttentionSeverity.Warning],
      ["h-swap", ResourceAttentionSeverity.Warning],
    ]);
  });

  test("each row says why in the list's words, with its values", () => {
    expect(rows[0]!.reasons).toEqual([
      {
        text: "{{mount}} {{percent}} full",
        values: { mount: "/var/lib/postgresql", percent: "96%" },
      },
      { text: "Memory {{percent}} used", values: { percent: "92%" } },
    ]);
    expect(rows[2]!.reasons.length).toBe(2);
  });

  test("a host is named as people know it, its host name under it when another", () => {
    expect(rows[0]!.name).toBe("Payments database");
    expect(rows[0]!.detail).toBe("db-01.prod.internal");
    expect(rows[1]!.name).toBe("web-03");
    expect(rows[1]!.detail).toBeUndefined();
    expect(rows[0]!.kind).toBe("Host");
    expect(rows[0]!.icon).toBe(IconProp.Server);
  });

  test("a host gone quiet says since when, and nothing it said last", () => {
    expect(rows[1]!.reasons).toEqual([{ text: "Not reporting" }]);
    expect(rows[1]!.lastReportAt).toEqual(
      new Date(NOW.getTime() - 3 * 60 * MINUTE),
    );
    // Only a host that stopped reporting says when it last did.
    expect(rows[0]!.lastReportAt).toBeUndefined();
  });

  test("each row opens its host's page", () => {
    expect(rows[0]!.route?.toString()).toBe("/host/h-db");
  });

  test("a host past its first ten minutes that never sent anything needs a look", () => {
    const late: Array<ResourceAttentionItem> = fleet([
      host({
        _id: "h-late",
        name: "late-01",
        otelCollectorStatus: null,
        lastSeenAt: null,
        readingsUpdatedAt: null,
        collectorRegisteredAt: new Date(
          NOW.getTime() - HOST_FIRST_DATA_GRACE_MS - MINUTE,
        ),
      }),
    ]);

    expect(late).toHaveLength(1);
    expect(late[0]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(late[0]!.reasons).toEqual([{ text: "No data yet" }]);
  });

  test("readings too old to judge say nothing of the host's numbers", () => {
    expect(
      fleet([
        host({
          latestMemoryPercent: 99,
          readingsUpdatedAt: new Date(
            NOW.getTime() - HOST_READINGS_STALE_MS - MINUTE,
          ),
        }),
      ]),
    ).toEqual([]);
  });

  test("a calm fleet has no rows", () => {
    expect(fleet([host(), host({ _id: "h-2", name: "web-02" })])).toEqual([]);
  });

  test("a read cut short says these are the most urgent", () => {
    expect(HOST_FLEET_ATTENTION_TRUNCATED_DESCRIPTION).toContain(
      "these are the most urgent",
    );
  });
});

describe("a host's own Needs attention rows", () => {
  test("the host itself, then each filesystem, each named for itself", () => {
    const rows: Array<ResourceAttentionItem> = own(
      host({
        latestMemoryPercent: 93,
        latestDiskPercent: 97,
        latestDiskMountpoint: "/var",
        latestInodesPercent: 90,
        latestInodesMountpoint: "/var",
      }),
    );

    expect(
      rows.map((row: ResourceAttentionItem): [string, string, string] => {
        return [row.key, row.severity, row.name];
      }),
    ).toEqual([
      ["filesystem:/var", ResourceAttentionSeverity.Critical, "/var"],
      [HOST_ATTENTION_CURRENT.key, ResourceAttentionSeverity.Warning, "web-01"],
    ]);
    // The filesystem's own words: no mount, its row is named for it.
    expect(rows[0]!.reasons).toEqual([
      { text: "{{percent}} full", values: { percent: "97%" } },
      { text: "{{percent}} of inodes used", values: { percent: "90%" } },
    ]);
    expect(rows[0]!.kind).toBe("Filesystem");
    expect(rows[1]!.kind).toBe("Host");
  });

  test("each failed systemd unit opens its own page", () => {
    const rows: Array<ResourceAttentionItem> = own(
      host({
        failedSystemdUnitCount: 2,
        failedSystemdUnits: ["backup.service", "nginx.service"],
      }),
    );

    expect(
      rows.map((row: ResourceAttentionItem): [string, string, string] => {
        return [row.key, row.name, row.route?.toString() || ""];
      }),
    ).toEqual([
      [
        "systemd-unit:backup.service",
        "backup.service",
        "/host/units/backup.service",
      ],
      [
        "systemd-unit:nginx.service",
        "nginx.service",
        "/host/units/nginx.service",
      ],
    ]);
    expect(rows[0]!.reasons).toEqual([{ text: "Failed" }]);
    expect(rows[0]!.kind).toBe("Systemd unit");
  });

  test("a count of failed units with no names reads as the host's own, with no page", () => {
    const rows: Array<ResourceAttentionItem> = own(
      host({ failedSystemdUnitCount: 3, failedSystemdUnits: [] }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("web-01");
    expect(rows[0]!.route).toBeUndefined();
  });

  test("a collector config that did not start opens the Collector page, named for the config", () => {
    const rows: Array<ResourceAttentionItem> = own(
      host({ collectorConfigStatus: "failed" }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe("collector");
    expect(rows[0]!.name).toBe("Databases");
    expect(rows[0]!.kind).toBe("Collector");
    expect(rows[0]!.reasons).toEqual([{ text: "Config failed" }]);
    expect(rows[0]!.route?.toString()).toBe("/host/collector");
  });

  test("a host that stopped reporting says since when", () => {
    const rows: Array<ResourceAttentionItem> = own(
      host({
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date(NOW.getTime() - 20 * MINUTE),
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe(HOST_ATTENTION_CURRENT.key);
    expect(rows[0]!.lastReportAt).toEqual(
      new Date(NOW.getTime() - 20 * MINUTE),
    );
  });

  test("a healthy host has no rows", () => {
    expect(own(host())).toEqual([]);
  });
});

describe("a host's name", () => {
  test("its display name, else its host name, trimmed", () => {
    expect(getHostDisplayName({ name: " db ", hostIdentifier: "x" })).toBe(
      "db",
    );
    expect(getHostDisplayName({ name: "", hostIdentifier: "db-01" })).toBe(
      "db-01",
    );
    expect(getHostDisplayName({})).toBe("");
  });
});
