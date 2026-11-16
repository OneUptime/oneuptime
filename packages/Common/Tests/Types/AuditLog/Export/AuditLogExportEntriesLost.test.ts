import { describe, expect, test } from "@jest/globals";
import {
  AUDIT_LOG_EXPORT_ENTRIES_LOST_AT_KEY,
  AUDIT_LOG_EXPORT_ENTRIES_LOST_READ_AT_KEY,
  AuditLogExportEntriesLost,
  isAuditLogExportLosingEntries,
  readAuditLogExportEntriesLost,
} from "../../../../Types/AuditLog/Export/AuditLogExportEntriesLost";

/*
 * When a failing export's waiting entries are deleted (#7186), as the View
 * Error dialog reads the server's answer and says it: a date still ahead,
 * or one that has passed - at or before the moment it was read, to the
 * millisecond, as the failing export's email reads its date (#7185).
 */

const READ_AT: Date = new Date("2026-11-16T09:30:00.000Z");

describe("whether the export is losing entries", () => {
  test("a date still ahead, even by a millisecond, is not", () => {
    expect(
      isAuditLogExportLosingEntries({
        entriesLostAt: new Date(READ_AT.getTime() + 1),
        now: READ_AT,
      }),
    ).toBe(false);
    expect(
      isAuditLogExportLosingEntries({
        entriesLostAt: new Date("2026-11-30T00:00:00.000Z"),
        now: READ_AT,
      }),
    ).toBe(false);
  });

  test("the moment itself, or any before it, is", () => {
    expect(
      isAuditLogExportLosingEntries({ entriesLostAt: READ_AT, now: READ_AT }),
    ).toBe(true);
    expect(
      isAuditLogExportLosingEntries({
        entriesLostAt: new Date(READ_AT.getTime() - 1),
        now: READ_AT,
      }),
    ).toBe(true);
    // Export from further back than the retention: long passed.
    expect(
      isAuditLogExportLosingEntries({
        entriesLostAt: new Date("2026-01-01T00:00:00.000Z"),
        now: READ_AT,
      }),
    ).toBe(true);
  });

  test("reads dates as JSON carries them, too", () => {
    expect(
      isAuditLogExportLosingEntries({
        entriesLostAt: "2026-11-16T09:29:59.999Z" as unknown as Date,
        now: READ_AT.toISOString() as unknown as Date,
      }),
    ).toBe(true);
  });
});

describe("what the dialog reads of the server's answer", () => {
  test("a date and the moment it was read", () => {
    const answer: AuditLogExportEntriesLost | null =
      readAuditLogExportEntriesLost({
        [AUDIT_LOG_EXPORT_ENTRIES_LOST_AT_KEY]: "2026-11-18T14:00:00.000Z",
        [AUDIT_LOG_EXPORT_ENTRIES_LOST_READ_AT_KEY]: READ_AT.toISOString(),
      });

    expect(answer).toEqual({
      entriesLostAt: new Date("2026-11-18T14:00:00.000Z"),
      readAt: READ_AT,
    });
  });

  test("the keys are the route's", () => {
    expect(AUDIT_LOG_EXPORT_ENTRIES_LOST_AT_KEY).toBe("entriesLostAt");
    expect(AUDIT_LOG_EXPORT_ENTRIES_LOST_READ_AT_KEY).toBe("readAt");
  });

  // Nothing waiting, a healthy or turned-off export: no date, and no line.
  test("an answer with no date says nothing", () => {
    expect(
      readAuditLogExportEntriesLost({
        entriesLostAt: null,
        readAt: READ_AT.toISOString(),
      }),
    ).toBeNull();
  });

  test("anything that is not such an answer says nothing rather than a wrong date", () => {
    for (const answer of [
      undefined,
      null,
      "2026-11-18T14:00:00.000Z",
      [],
      {},
      { entriesLostAt: "2026-11-18T14:00:00.000Z" },
      { entriesLostAt: "2026-11-18T14:00:00.000Z", readAt: "" },
      { entriesLostAt: "soon", readAt: READ_AT.toISOString() },
      { entriesLostAt: 1763474400000, readAt: READ_AT.toISOString() },
      { entriesLostAt: "   ", readAt: READ_AT.toISOString() },
    ]) {
      expect(readAuditLogExportEntriesLost(answer)).toBeNull();
    }
  });
});
