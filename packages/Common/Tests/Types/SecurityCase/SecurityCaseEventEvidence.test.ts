import {
  SECURITY_CASE_EVENTS_ADD_REASONS,
  SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD,
  SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTES_MAX,
  SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTE_VALUE_MAX_LENGTH,
  SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS,
  SECURITY_CASE_EVENT_SNAPSHOT_LIST_MAX,
  SECURITY_CASE_EVENT_SNAPSHOT_TEXT_MAX_LENGTH,
  SecurityCaseEventReference,
  SecurityCaseEventSnapshot,
  buildSecurityCaseEventSnapshot,
  getSecurityCaseEventEvidenceName,
  readSecurityCaseEventReferences,
  readSecurityCaseEventSnapshot,
  readSecurityCaseEventsAddResult,
} from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import SecurityCaseEvidenceKind, {
  SECURITY_CASE_EVIDENCE_KINDS,
} from "../../../Types/SecurityCase/SecurityCaseEvidenceKind";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A SECURITY EVENT KEPT ON A CASE: what OneUptime keeps of the event it
 * read (a snapshot, each part held to its limit), how a page reads it back
 * without trusting a stored value's type, what the evidence is called, and
 * the events a request names to keep - each once, with a time it can read.
 */

const EVENT_ROW: { [column: string]: unknown } = {
  time: "2026-10-28 22:42:00.123",
  eventUid: "evt-0002",
  primaryEntityId: new ObjectID("3d000000-0000-4000-8000-000000000001"),
  severityName: "High",
  className: "Process Activity",
  categoryName: "System Activity",
  activityName: "Launch",
  statusName: "Success",
  message: "Encoded PowerShell downloaded a script on web-03",
  vendorName: "Microsoft",
  productName: "Defender for Endpoint",
  ruleName: "",
  principalUser: "svc-web@acme-commerce.example",
  principalHost: "web-03",
  principalIp: "10.20.4.13",
  targetUser: "",
  targetHost: "",
  targetIp: "",
  targetPort: 443,
  processName: "powershell.exe",
  processCommandLine: "powershell.exe -w hidden -enc SQBFAFg",
  observables: ["10.20.4.13", "update-check.example", "10.20.4.13", 7],
  mitreTactics: ["TA0002"],
  mitreTechniques: ["T1059.001"],
  attributes: {
    "threat.matched": true,
    "device.os": "windows",
    "process.pid": 4242,
    nested: { a: 1 },
    list: ["x"],
  },
};

describe("the event evidence kind", () => {
  test("is a kind of evidence of its own, after files and links", () => {
    expect(SecurityCaseEvidenceKind.Event).toBe("Event");
    expect(SECURITY_CASE_EVIDENCE_KINDS).toContain(
      SecurityCaseEvidenceKind.Event,
    );
    expect(
      SECURITY_CASE_EVIDENCE_KINDS.indexOf(SecurityCaseEvidenceKind.Event),
    ).toBe(SECURITY_CASE_EVIDENCE_KINDS.length - 1);
  });

  test("keeps at most a page of ticked events per request", () => {
    expect(SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD).toBe(100);
  });

  test("reads only columns a security event has", () => {
    const columns: Array<string> = new SecurityEvent().tableColumns.map(
      (column: { key: string }): string => {
        return column.key;
      },
    );

    for (const column of SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS) {
      expect([column, columns.includes(column)]).toEqual([column, true]);
    }
  });
});

describe("a kept event's snapshot", () => {
  test("is the event as read: its time as ISO, its source, who and what", () => {
    const snapshot: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
      event: EVENT_ROW,
      hunt: {
        id: "3b000000-0000-4000-8000-000000000001",
        name: "Encoded PowerShell",
      },
    });

    expect(snapshot.time).toBe("2026-10-28T22:42:00.123Z");
    expect(snapshot.eventUid).toBe("evt-0002");
    expect(snapshot.sourceId).toBe("3d000000-0000-4000-8000-000000000001");
    expect(snapshot.severityName).toBe("High");
    expect(snapshot.message).toBe(
      "Encoded PowerShell downloaded a script on web-03",
    );
    expect(snapshot.principalHost).toBe("web-03");
    expect(snapshot.targetPort).toBe(443);
    expect(snapshot.hunt).toEqual({
      id: "3b000000-0000-4000-8000-000000000001",
      name: "Encoded PowerShell",
    });
  });

  test("keeps a list's text values once each, and an attribute's text, number or yes/no", () => {
    const snapshot: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
      event: EVENT_ROW,
    });

    expect(snapshot.observables).toEqual([
      "10.20.4.13",
      "update-check.example",
      "7",
    ]);
    expect(snapshot.attributes).toEqual({
      "device.os": "windows",
      "process.pid": "4242",
      "threat.matched": "true",
    });
    expect(snapshot.hunt).toBeNull();
  });

  test("holds each part to its limit", () => {
    const snapshot: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
      event: {
        ...EVENT_ROW,
        message: "m".repeat(SECURITY_CASE_EVENT_SNAPSHOT_TEXT_MAX_LENGTH + 50),
        observables: Array.from(
          { length: SECURITY_CASE_EVENT_SNAPSHOT_LIST_MAX + 20 },
          (_: unknown, index: number): string => {
            return `o-${index}`;
          },
        ),
        attributes: Object.fromEntries(
          Array.from(
            { length: SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTES_MAX + 20 },
            (_: unknown, index: number): [string, string] => {
              return [
                `k-${String(index).padStart(3, "0")}`,
                "v".repeat(
                  SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTE_VALUE_MAX_LENGTH + 5,
                ),
              ];
            },
          ),
        ),
      },
    });

    expect(snapshot.message).toHaveLength(
      SECURITY_CASE_EVENT_SNAPSHOT_TEXT_MAX_LENGTH,
    );
    expect(snapshot.observables).toHaveLength(
      SECURITY_CASE_EVENT_SNAPSHOT_LIST_MAX,
    );
    expect(Object.keys(snapshot.attributes)).toHaveLength(
      SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTES_MAX,
    );
    // The first keys, in order: the same snapshot every time.
    expect(Object.keys(snapshot.attributes)[0]).toBe("k-000");
    expect(snapshot.attributes["k-000"]).toHaveLength(
      SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTE_VALUE_MAX_LENGTH,
    );
  });

  test("reads a port only as one: a whole number from 1 to 65535", () => {
    for (const [value, port] of [
      [443, 443],
      ["8080", 8080],
      [0, null],
      [70000, null],
      [12.5, null],
      ["http", null],
      [null, null],
    ] as Array<[unknown, number | null]>) {
      expect([
        value,
        buildSecurityCaseEventSnapshot({
          event: { ...EVENT_ROW, targetPort: value },
        }).targetPort,
      ]).toEqual([value, port]);
    }
  });

  test("reads a time ClickHouse wrote, an ISO string or a date, and nothing for anything else", () => {
    for (const [value, time] of [
      ["2026-10-28 22:42:00", "2026-10-28T22:42:00.000Z"],
      ["2026-10-28T22:42:00.000Z", "2026-10-28T22:42:00.000Z"],
      [new Date("2026-10-28T22:42:00.000Z"), "2026-10-28T22:42:00.000Z"],
      ["yesterday", ""],
      [new Date("not a date"), ""],
      [1761691320000, ""],
    ] as Array<[unknown, string]>) {
      expect([
        String(value),
        buildSecurityCaseEventSnapshot({ event: { ...EVENT_ROW, time: value } })
          .time,
      ]).toEqual([String(value), time]);
    }
  });

  test("reads back as built, and a stored value of the wrong shape as none", () => {
    const built: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
      event: EVENT_ROW,
      hunt: { id: "h1", name: "Encoded PowerShell" },
    });

    expect(
      readSecurityCaseEventSnapshot(JSON.parse(JSON.stringify(built))),
    ).toEqual(built);

    for (const value of [undefined, null, "", "evt-0002", [], {}, { a: 1 }]) {
      expect([value, readSecurityCaseEventSnapshot(value)]).toEqual([
        value,
        null,
      ]);
    }
  });

  test("never trusts a stored value's type: a list of objects, a hunt without a name", () => {
    const snapshot: SecurityCaseEventSnapshot | null =
      readSecurityCaseEventSnapshot({
        eventUid: "evt-9",
        time: "2026-10-28T22:42:00.000Z",
        observables: [{ a: 1 }, "1.2.3.4"],
        attributes: ["not", "a", "map"],
        hunt: { id: "h1" },
        targetPort: "x",
      });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.observables).toEqual(["1.2.3.4"]);
    expect(snapshot!.attributes).toEqual({});
    expect(snapshot!.hunt).toBeNull();
    expect(snapshot!.targetPort).toBeNull();
    expect(snapshot!.message).toBe("");
  });
});

describe("what a kept event is called on the case", () => {
  test("its message, else its class and activity, else what it is", () => {
    expect(
      getSecurityCaseEventEvidenceName({
        message: "  Encoded PowerShell started  ",
        className: "Process Activity",
        activityName: "Launch",
      }),
    ).toBe("Encoded PowerShell started");
    expect(
      getSecurityCaseEventEvidenceName({
        message: " ",
        className: "Process Activity",
        activityName: "Launch",
      }),
    ).toBe("Process Activity: Launch");
    expect(
      getSecurityCaseEventEvidenceName({
        message: "",
        className: "",
        activityName: "Logon",
      }),
    ).toBe("Logon");
    expect(
      getSecurityCaseEventEvidenceName({
        message: "",
        className: "",
        activityName: "",
      }),
    ).toBe("Security event");
  });

  test("a long message cut to 500 characters, an ellipsis last", () => {
    const name: string = getSecurityCaseEventEvidenceName({
      message: "m".repeat(800),
      className: "",
      activityName: "",
    });

    expect(name).toHaveLength(500);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("the events a request names", () => {
  test("each once, by id, in the order named, with the time it happened", () => {
    expect(
      readSecurityCaseEventReferences([
        { eventUid: " evt-1 ", time: "2026-10-28 22:42:00" },
        { eventUid: "evt-2", time: "2026-10-28T23:00:00.000Z" },
        { eventUid: "evt-1", time: "2026-10-29T00:00:00.000Z" },
      ]),
    ).toEqual([
      {
        eventUid: "evt-1",
        time: new Date("2026-10-28T22:42:00.000Z"),
      },
      {
        eventUid: "evt-2",
        time: new Date("2026-10-28T23:00:00.000Z"),
      },
    ] as Array<SecurityCaseEventReference>);
  });

  test("leaves out an entry without an id or a time it can read", () => {
    expect(
      readSecurityCaseEventReferences([
        null,
        "evt-1",
        { eventUid: "", time: "2026-10-28T22:42:00.000Z" },
        { eventUid: "evt-2" },
        { eventUid: "evt-3", time: "soon" },
        { eventUid: { id: "evt-4" }, time: "2026-10-28T22:42:00.000Z" },
        [],
      ]),
    ).toEqual([]);
    expect(readSecurityCaseEventReferences({ eventUid: "evt-1" })).toEqual([]);
    expect(readSecurityCaseEventReferences(undefined)).toEqual([]);
  });
});

describe("the answer to a request", () => {
  test("reads each list of event ids, and none for anything else", () => {
    expect(
      readSecurityCaseEventsAddResult({
        added: ["evt-1", 7, ""],
        alreadyOnCase: ["evt-2"],
        notFound: "evt-3",
      }),
    ).toEqual({ added: ["evt-1"], alreadyOnCase: ["evt-2"], notFound: [] });
    expect(readSecurityCaseEventsAddResult(null)).toEqual({
      added: [],
      alreadyOnCase: [],
      notFound: [],
    });
  });

  test("says why an event was not kept the same way whether it is gone or not one the person can read", () => {
    expect(SECURITY_CASE_EVENTS_ADD_REASONS.notFound.message).toBe(
      "This event was not found. It may be past its retention, or one you cannot read.",
    );
    expect(SECURITY_CASE_EVENTS_ADD_REASONS.alreadyOnCase.message).toBe(
      "Already kept on this case.",
    );
  });
});
