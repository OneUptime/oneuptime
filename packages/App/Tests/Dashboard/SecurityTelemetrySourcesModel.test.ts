import { describe, expect, test } from "@jest/globals";
import {
  FIRST_CHECK_WITHIN_A_MINUTE,
  NEEDS_ENTERPRISE_NOTE,
  NO_CLOUD_ACCOUNT_NOTE,
  OWN_PROBE_TRAFFIC_LOOKBACK_IN_HOURS,
  OWN_PROBE_TRAFFIC_SET_ASIDE,
  OwnProbeTrafficWindow,
  SECURITY_TELEMETRY_SOURCE_ROWS,
  SecurityTelemetrySourceRow,
  SecurityTelemetrySourceStatus,
  SecurityTelemetrySourceStatusKind,
  buildOwnProbeTrafficQuery,
  countsOwnProbeTraffic,
  getOwnProbeTrafficWindow,
  getSecurityTelemetrySourceStatus,
  getSecurityTelemetrySourceWaitingLine,
  getSecurityTelemetrySourceWaitingText,
  isSecurityTelemetrySourceAvailable,
  needsCloudAccountNote,
  readFoundBySignal,
  readFoundInLastCheck,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTelemetrySourcesModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_TELEMETRY_SOURCE_KINDS,
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "Common/Types/SecurityEvent/SecurityTelemetrySource";

/*
 * "Your OneUptime data" on the Connections page: one row per kind of
 * telemetry, said in one plain line, and what each source's last check
 * found - pinned without rendering the card.
 */

function rowOf(kind: SecurityTelemetrySourceKind): SecurityTelemetrySourceRow {
  return SECURITY_TELEMETRY_SOURCE_ROWS.find(
    (row: SecurityTelemetrySourceRow): boolean => {
      return row.kind === kind;
    },
  )!;
}

describe("the rows", () => {
  test("one per kind of telemetry, in the order the sources are defined", () => {
    expect(
      SECURITY_TELEMETRY_SOURCE_ROWS.map(
        (row: SecurityTelemetrySourceRow): SecurityTelemetrySourceKind => {
          return row.kind;
        },
      ),
    ).toEqual(SECURITY_TELEMETRY_SOURCE_KINDS);
  });

  test("each says what it watches in one sentence, and names it plainly", () => {
    for (const row of SECURITY_TELEMETRY_SOURCE_ROWS) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.title.length).toBeLessThanOrEqual(20);
      expect(row.description.endsWith(".")).toBe(true);
      // One sentence: no full stop before its end.
      expect(row.description.slice(0, -1)).not.toContain(". ");
    }
  });

  test("only the audit log needs OneUptime Enterprise", () => {
    expect(
      SECURITY_TELEMETRY_SOURCE_ROWS.filter(
        (row: SecurityTelemetrySourceRow): boolean => {
          return row.needsEnterprise;
        },
      ).map((row: SecurityTelemetrySourceRow): SecurityTelemetrySourceKind => {
        return row.kind;
      }),
    ).toEqual([SecurityTelemetrySourceKind.AuditLog]);
    expect(NEEDS_ENTERPRISE_NOTE).toBe(
      "Available in OneUptime Enterprise, which keeps the audit log.",
    );
  });
});

describe("whether a switch can be used", () => {
  const auditLog: SecurityTelemetrySourceRow = rowOf(
    SecurityTelemetrySourceKind.AuditLog,
  );
  const traces: SecurityTelemetrySourceRow = rowOf(
    SecurityTelemetrySourceKind.Traces,
  );

  test("the audit log's is locked where OneUptime is not Enterprise", () => {
    expect(
      isSecurityTelemetrySourceAvailable({
        row: auditLog,
        isEnterpriseEdition: false,
        isOn: false,
      }),
    ).toBe(false);
    expect(
      isSecurityTelemetrySourceAvailable({
        row: auditLog,
        isEnterpriseEdition: true,
        isOn: false,
      }),
    ).toBe(true);
  });

  test("one turned on before can always be turned off", () => {
    expect(
      isSecurityTelemetrySourceAvailable({
        row: auditLog,
        isEnterpriseEdition: false,
        isOn: true,
      }),
    ).toBe(true);
  });

  test("every other switch is always there", () => {
    expect(
      isSecurityTelemetrySourceAvailable({
        row: traces,
        isEnterpriseEdition: false,
        isOn: false,
      }),
    ).toBe(true);
  });
});

describe("what is said under a source", () => {
  test("nothing while it is off, whatever it said before", () => {
    const status: SecurityTelemetrySourceStatus =
      getSecurityTelemetrySourceStatus({
        isOn: false,
        lastScannedAt: new Date("2026-10-27T10:00:00.000Z"),
        lastError: "boom",
      });

    expect(status.kind).toBe(SecurityTelemetrySourceStatusKind.Off);
  });

  test("that the first check is on its way, before there was one", () => {
    expect(getSecurityTelemetrySourceStatus({ isOn: true }).kind).toBe(
      SecurityTelemetrySourceStatusKind.Waiting,
    );
  });

  test("when it was checked, when it last found something, and how much the last check found", () => {
    const status: SecurityTelemetrySourceStatus =
      getSecurityTelemetrySourceStatus({
        isOn: true,
        lastScannedAt: new Date("2026-10-27T10:00:00.000Z"),
        lastEventFoundAt: new Date("2026-10-27T09:00:00.000Z"),
        lastScanResult: { bySignal: { "port-scan": 2, "network-sweep": 1 } },
      });

    expect(status).toEqual({
      kind: SecurityTelemetrySourceStatusKind.Checked,
      checkedAt: new Date("2026-10-27T10:00:00.000Z"),
      lastFoundAt: new Date("2026-10-27T09:00:00.000Z"),
      foundInLastCheck: 3,
      error: "",
    });
  });

  test("why the last check failed, when it did", () => {
    const status: SecurityTelemetrySourceStatus =
      getSecurityTelemetrySourceStatus({
        isOn: true,
        lastScannedAt: new Date("2026-10-27T10:00:00.000Z"),
        lastError: "  ClickHouse timed out  ",
      });

    expect(status.kind).toBe(SecurityTelemetrySourceStatusKind.Failed);
    expect(status.error).toBe("ClickHouse timed out");
  });

  test("a last result read defensively: only positive counts count", () => {
    expect(
      readFoundBySignal({
        bySignal: { a: 2, b: 0, c: -1, d: "3", e: Number.NaN },
      }),
    ).toEqual({ a: 2 });
    expect(readFoundBySignal(undefined)).toEqual({});
    expect(readFoundBySignal({ bySignal: [1, 2] })).toEqual({});
    expect(readFoundInLastCheck({ bySignal: { a: 2, b: 5 } })).toBe(7);
  });
});

/*
 * Cloud audit logs: the audit logs of the cloud accounts connected under
 * Cloud, read with each account's own read rather than by the minute's
 * scan - so they wait for that read, and say so where no cloud account is
 * connected, with the way to connect one.
 */
describe("cloud audit logs", () => {
  const cloud: SecurityTelemetrySourceRow = rowOf(
    SecurityTelemetrySourceKind.CloudAudit,
  );

  test("a row of its own, last, named plainly, saying what it reads", () => {
    expect(
      SECURITY_TELEMETRY_SOURCE_ROWS[SECURITY_TELEMETRY_SOURCE_ROWS.length - 1]
        ?.kind,
    ).toBe(SecurityTelemetrySourceKind.CloudAudit);
    expect(cloud.title).toBe("Cloud audit logs");
    expect(cloud.description).toContain("connected under Cloud");
    expect(cloud.description).toContain("from their own audit logs");
    // One sentence of what it finds, as its neighbours' are: two lines at most at 1280.
    expect(cloud.description.length).toBeLessThanOrEqual(130);
    expect(cloud.needsEnterprise).toBe(false);
  });

  test("only it needs a cloud account, and says so only when none is connected", () => {
    expect(
      SECURITY_TELEMETRY_SOURCE_ROWS.filter(
        (row: SecurityTelemetrySourceRow): boolean => {
          return Boolean(row.needsCloudAccount);
        },
      ).map((row: SecurityTelemetrySourceRow): SecurityTelemetrySourceKind => {
        return row.kind;
      }),
    ).toEqual([SecurityTelemetrySourceKind.CloudAudit]);

    expect(needsCloudAccountNote({ row: cloud, cloudConnectionCount: 0 })).toBe(
      true,
    );
    expect(needsCloudAccountNote({ row: cloud, cloudConnectionCount: 2 })).toBe(
      false,
    );
    // Not known (still reading, or Cloud is not the reader's to see): nothing said.
    expect(
      needsCloudAccountNote({ row: cloud, cloudConnectionCount: null }),
    ).toBe(false);
    expect(
      needsCloudAccountNote({
        row: rowOf(SecurityTelemetrySourceKind.Traces),
        cloudConnectionCount: 0,
      }),
    ).toBe(false);
    // One sentence: the link after it says how to connect one.
    expect(NO_CLOUD_ACCOUNT_NOTE).toBe("No cloud account is connected yet.");
  });

  test("it waits for the next read of the cloud accounts; the rest for the minute's scan", () => {
    expect(getSecurityTelemetrySourceWaitingText(cloud)).toBe(
      "The first check runs with your cloud accounts' next read, within a few minutes.",
    );

    for (const row of SECURITY_TELEMETRY_SOURCE_ROWS) {
      if (row.kind !== SecurityTelemetrySourceKind.CloudAudit) {
        expect(getSecurityTelemetrySourceWaitingText(row)).toBe(
          FIRST_CHECK_WITHIN_A_MINUTE,
        );
      }
    }

    expect(FIRST_CHECK_WITHIN_A_MINUTE).toBe(
      "The first check runs within a minute.",
    );
  });

  test("with no cloud account to read, cloud audit logs promise no first check", () => {
    expect(
      getSecurityTelemetrySourceWaitingLine({
        row: cloud,
        isMissingCloudAccount: true,
      }),
    ).toBeNull();
    expect(
      getSecurityTelemetrySourceWaitingLine({
        row: cloud,
        isMissingCloudAccount: false,
      }),
    ).toBe(getSecurityTelemetrySourceWaitingText(cloud));

    for (const row of SECURITY_TELEMETRY_SOURCE_ROWS) {
      if (row.kind !== SecurityTelemetrySourceKind.CloudAudit) {
        expect(
          getSecurityTelemetrySourceWaitingLine({
            row,
            isMissingCloudAccount: false,
          }),
        ).toBe(FIRST_CHECK_WITHIN_A_MINUTE);
      }
    }
  });

  test("what a read found is counted as any source's: by the kind of record", () => {
    expect(
      getSecurityTelemetrySourceStatus({
        isOn: true,
        lastScannedAt: new Date("2026-10-27T10:00:00.000Z"),
        lastEventFoundAt: new Date("2026-10-27T10:00:00.000Z"),
        lastScanResult: {
          recordsRead: 40,
          eventsFound: 3,
          bySignal: { "aws-cloudtrail": 2, "azure-activity": 1 },
        },
      }).foundInLastCheck,
    ).toBe(3);
  });
});

/*
 * OneUptime's own probes in the project's network flows (#10429): their
 * device polling, discovery and monitor checks are set aside, never
 * reported as scans - and the Network flows row says so, and how many it
 * set aside over the last day, with the way to see them.
 */
describe("OneUptime's own probes on the Network flows row", () => {
  const NOW: Date = new Date("2026-11-21T12:00:00.000Z");

  test("only network flows tells OneUptime's own traffic apart, in a note of its own", () => {
    expect(
      SECURITY_TELEMETRY_SOURCE_ROWS.filter(
        (row: SecurityTelemetrySourceRow): boolean => {
          return Boolean(row.ownTrafficNote);
        },
      ).map((row: SecurityTelemetrySourceRow): SecurityTelemetrySourceKind => {
        return row.kind;
      }),
    ).toEqual([SecurityTelemetrySourceKind.NetworkFlows]);

    const note: string = rowOf(
      SecurityTelemetrySourceKind.NetworkFlows,
    ).ownTrafficNote!;

    expect(note).toContain("OneUptime's own probes");
    expect(note).toContain("not reported as a scan");
    expect(note.endsWith(".")).toBe(true);
  });

  test("it counts what it set aside only while it is on", () => {
    const flows: SecurityTelemetrySourceRow = rowOf(
      SecurityTelemetrySourceKind.NetworkFlows,
    );

    expect(countsOwnProbeTraffic({ row: flows, isOn: true })).toBe(true);
    expect(countsOwnProbeTraffic({ row: flows, isOn: false })).toBe(false);
    expect(
      countsOwnProbeTraffic({
        row: rowOf(SecurityTelemetrySourceKind.Traces),
        isOn: true,
      }),
    ).toBe(false);
  });

  test("over the last day, ending now", () => {
    const window: OwnProbeTrafficWindow = getOwnProbeTrafficWindow(NOW);

    expect(window.end).toEqual(NOW);
    expect(window.end.getTime() - window.start.getTime()).toBe(
      OWN_PROBE_TRAFFIC_LOOKBACK_IN_HOURS * 60 * 60 * 1000,
    );
    expect(OWN_PROBE_TRAFFIC_LOOKBACK_IN_HOURS).toBe(24);
  });

  test("counts the project's events of OneUptime's own probe traffic over that day", () => {
    const projectId: ObjectID = ObjectID.generate();
    const window: OwnProbeTrafficWindow = getOwnProbeTrafficWindow(NOW);
    const query: Record<string, unknown> = buildOwnProbeTrafficQuery({
      projectId,
      window,
    }) as Record<string, unknown>;

    expect(query["projectId"]).toBe(projectId);
    expect(query["time"]).toBeInstanceOf(InBetween);
    expect((query["time"] as InBetween<Date>).startValue).toEqual(window.start);
    expect((query["time"] as InBetween<Date>).endValue).toEqual(window.end);
    expect(query["attributes"]).toEqual({
      "oneuptime.signal": SecurityTelemetrySignal.OneUptimeProbeTraffic,
    });
  });

  test("says the count in a sentence that agrees with it", () => {
    expect(OWN_PROBE_TRAFFIC_SET_ASIDE.one).toContain("{{count}}");
    expect(OWN_PROBE_TRAFFIC_SET_ASIDE.other).toContain("{{count}}");
    expect(OWN_PROBE_TRAFFIC_SET_ASIDE.one).toContain("was set aside");
    expect(OWN_PROBE_TRAFFIC_SET_ASIDE.other).toContain("were set aside");
  });
});
