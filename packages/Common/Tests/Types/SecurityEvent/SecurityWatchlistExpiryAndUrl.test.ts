import { describe, expect, test } from "@jest/globals";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE,
  SECURITY_WATCHLIST_ENTITY_TYPES,
  SECURITY_WATCHLIST_EXPORT_HEADER,
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SECURITY_WATCHLIST_IMPORT_RETRY_IN_MINUTES,
  SECURITY_WATCHLIST_IMPORT_SCHEDULES,
  SECURITY_WATCHLIST_IMPORT_URL_MAX_LENGTH,
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistExportValue,
  SecurityWatchlistImportResult,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistSource,
  getNextSecurityWatchlistImportAt,
  getSecurityWatchlistExpiryProblem,
  getSecurityWatchlistImportIntervalInMinutes,
  getSecurityWatchlistImportRetryAt,
  getSecurityWatchlistImportUrlProblem,
  getSecurityWatchlistProblems,
  getSecurityWatchlistSearchSnippet,
  guardSecurityWatchlistCsvCell,
  hasSecurityWatchlistValueExpired,
  isSecurityWatchlistImportSchedule,
  isSecurityWatchlistKeptByHand,
  isSecurityWatchlistReadFromUrl,
  normalizeSecurityWatchlistImportUrl,
  parseSecurityWatchlistImport,
  readSecurityWatchlistDate,
  readSecurityWatchlistImportExpiry,
  readSecurityWatchlistImportFields,
  unguardSecurityWatchlistCsvCell,
  writeSecurityWatchlistCsv,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * WATCHLISTS, NEXT (#5391): A VALUE THAT LEAVES ITS LIST ON A DATE, A
 * LIST'S VALUES EXPORTED TO A FILE AN IMPORT READS BACK, AND A LIST READ
 * FROM A FILE AT AN ADDRESS ON A SCHEDULE.
 *
 * The rules the form, the import dialog, the export, the API and the
 * scheduled read share - each problem in the words the Dashboard
 * translates.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

function imported(text: string): SecurityWatchlistImportResult {
  return parseSecurityWatchlistImport({
    text,
    entityType: SecurityEntityType.User,
    now: NOW,
  });
}

describe("a value that leaves its list", () => {
  test("a moment is a date, or an ISO string of one; anything else is none", () => {
    const moment: Date = new Date("2026-12-31T18:00:00.000Z");

    expect(readSecurityWatchlistDate(moment)).toBe(moment);
    expect(readSecurityWatchlistDate(" 2026-12-31T18:00:00.000Z ")).toEqual(
      moment,
    );
    expect(readSecurityWatchlistDate(new Date("not a date"))).toBeNull();
    expect(readSecurityWatchlistDate("not a date")).toBeNull();
    expect(readSecurityWatchlistDate("")).toBeNull();
    expect(readSecurityWatchlistDate("   ")).toBeNull();
    expect(readSecurityWatchlistDate(null)).toBeNull();
    expect(readSecurityWatchlistDate(undefined)).toBeNull();
    expect(readSecurityWatchlistDate(1767204000000)).toBeNull();
  });

  test("none is no problem: the value stays until someone removes it", () => {
    expect(getSecurityWatchlistExpiryProblem(undefined, NOW)).toBeNull();
    expect(getSecurityWatchlistExpiryProblem(null, NOW)).toBeNull();
    expect(getSecurityWatchlistExpiryProblem("", NOW)).toBeNull();
  });

  test("a moment still to come is taken; one that is not a date, or has come, is refused in its own words", () => {
    expect(
      getSecurityWatchlistExpiryProblem(
        new Date("2026-11-03T12:00:01.000Z"),
        NOW,
      ),
    ).toBeNull();
    expect(
      getSecurityWatchlistExpiryProblem("2027-01-01T00:00:00.000Z", NOW),
    ).toBeNull();
    expect(getSecurityWatchlistExpiryProblem("next week", NOW)).toBe(
      SECURITY_WATCHLIST_MESSAGES.expiryNotADate.message,
    );
    expect(getSecurityWatchlistExpiryProblem(NOW, NOW)).toBe(
      SECURITY_WATCHLIST_MESSAGES.expiryPassed.message,
    );
    expect(
      getSecurityWatchlistExpiryProblem(
        new Date("2026-01-01T00:00:00.000Z"),
        NOW,
      ),
    ).toBe(SECURITY_WATCHLIST_MESSAGES.expiryPassed.message);
  });

  test("a value has left its list from its moment on, never before, and never without one", () => {
    expect(hasSecurityWatchlistValueExpired(NOW, NOW)).toBe(true);
    expect(
      hasSecurityWatchlistValueExpired("2026-11-03T11:59:59.999Z", NOW),
    ).toBe(true);
    expect(
      hasSecurityWatchlistValueExpired(
        new Date("2026-11-03T12:00:00.001Z"),
        NOW,
      ),
    ).toBe(false);
    expect(hasSecurityWatchlistValueExpired(null, NOW)).toBe(false);
    expect(hasSecurityWatchlistValueExpired(undefined, NOW)).toBe(false);
    expect(hasSecurityWatchlistValueExpired("someday", NOW)).toBe(false);
  });
});

describe("when an imported value leaves the list, as a file writes it", () => {
  test("a date alone is that day, from its start in UTC", () => {
    expect(readSecurityWatchlistImportExpiry("2026-12-31")).toEqual(
      new Date("2026-12-31T00:00:00.000Z"),
    );
    expect(readSecurityWatchlistImportExpiry(" 2026-12-31 ")).toEqual(
      new Date("2026-12-31T00:00:00.000Z"),
    );
  });

  test("a date that is not a day of the calendar is not read as the next one", () => {
    expect(readSecurityWatchlistImportExpiry("2026-02-30")).toBeNull();
    expect(readSecurityWatchlistImportExpiry("2026-13-01")).toBeNull();
    expect(readSecurityWatchlistImportExpiry("2028-02-29")).toEqual(
      new Date("2028-02-29T00:00:00.000Z"),
    );
  });

  test("a date and time is read with its zone, as an export writes it", () => {
    expect(
      readSecurityWatchlistImportExpiry("2026-12-31T18:00:00.000Z"),
    ).toEqual(new Date("2026-12-31T18:00:00.000Z"));
    expect(readSecurityWatchlistImportExpiry("2026-12-31T18:00Z")).toEqual(
      new Date("2026-12-31T18:00:00.000Z"),
    );
    expect(
      readSecurityWatchlistImportExpiry("2026-12-31T18:00:00+02:00"),
    ).toEqual(new Date("2026-12-31T16:00:00.000Z"));
    expect(readSecurityWatchlistImportExpiry("2026-12-31 18:00:00Z")).toEqual(
      new Date("2026-12-31T18:00:00.000Z"),
    );
  });

  test("a time without its zone, or a date written as one country writes it, is not read", () => {
    // 18:00 where? A file read on a server in another zone would move it.
    expect(readSecurityWatchlistImportExpiry("2026-12-31T18:00:00")).toBeNull();
    // The 12th of November, or the 11th of December?
    expect(readSecurityWatchlistImportExpiry("12/11/2026")).toBeNull();
    expect(readSecurityWatchlistImportExpiry("31.12.2026")).toBeNull();
    expect(readSecurityWatchlistImportExpiry("tomorrow")).toBeNull();
    expect(readSecurityWatchlistImportExpiry("")).toBeNull();
  });

  test("a long line that only looks like a date is read in time in line with its length", () => {
    const timed: FastestRun<Date | null> = fastestRun({
      run: (): Date | null => {
        return readSecurityWatchlistImportExpiry(
          `2026-12-31T18:00:00.${"1".repeat(400000)}`,
        );
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBeNull();
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("importing a file whose header names its columns", () => {
  test("an export's columns: each value with its note and when it leaves the list", () => {
    const result: SecurityWatchlistImportResult = imported(
      [
        "value,note,expires",
        "alice@example.com,CFO,2026-12-31",
        "bob@example.com,,",
        "carol@example.com,Contractor,2027-03-01T09:30:00.000Z",
      ].join("\n"),
    );

    expect(result).toEqual({
      values: [
        {
          value: "alice@example.com",
          note: "CFO",
          expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        },
        { value: "bob@example.com", note: "" },
        {
          value: "carol@example.com",
          note: "Contractor",
          expiresAt: new Date("2027-03-01T09:30:00.000Z"),
        },
      ],
      problems: [],
      duplicates: 0,
    });
    // A value that stays has no moment at all, not an empty one.
    expect(Object.keys(result.values[1]!)).toEqual(["value", "note"]);
  });

  test("the columns may come in any order after the value, under any of their usual names", () => {
    for (const header of [
      "value,expires,note",
      "Value,Expires At,Notes",
      "values,expires_at,note",
      "VALUE,Expiry,NOTE",
    ]) {
      expect({
        header,
        values: imported(`${header}\nalice@example.com,2026-12-31,CFO`).values,
      }).toEqual({
        header,
        values: [
          {
            value: "alice@example.com",
            note: "CFO",
            expiresAt: new Date("2026-12-31T00:00:00.000Z"),
          },
        ],
      });
    }
  });

  test("a column the import does not know is skipped, and a missing note is none", () => {
    expect(
      imported("value,source,owner,note\nalice@example.com,HR,Dana,CFO").values,
    ).toEqual([{ value: "alice@example.com", note: "CFO" }]);
    expect(
      imported("value,expires\nalice@example.com,2026-12-31").values,
    ).toEqual([
      {
        value: "alice@example.com",
        note: "",
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    ]);
  });

  test("value and note alone read as before: the rest of the line is the note", () => {
    expect(
      imported("value,note\nalice@example.com,CFO, finance").values,
    ).toEqual([{ value: "alice@example.com", note: "CFO, finance" }]);
  });

  test("a line whose moment is not a date, or has passed, is left out with its line and why", () => {
    const result: SecurityWatchlistImportResult = imported(
      [
        "value,note,expires",
        "alice@example.com,CFO,12/31/2026",
        "bob@example.com,,2026-01-01",
        "carol@example.com,,2027-01-01",
      ].join("\n"),
    );

    expect(result.values).toEqual([
      {
        value: "carol@example.com",
        note: "",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    ]);
    expect(result.problems).toEqual([
      {
        line: 2,
        value: "alice@example.com",
        message: SECURITY_WATCHLIST_MESSAGES.importExpiryNotADate.message,
      },
      {
        line: 3,
        value: "bob@example.com",
        message: SECURITY_WATCHLIST_MESSAGES.importExpiryPassed.message,
      },
    ]);
  });

  test("a file Excel saved, with its byte order mark and Windows line ends, reads the same", () => {
    expect(
      imported(
        `${String.fromCharCode(0xfeff)}value,note,expires\r\nalice@example.com,CFO,2026-12-31\r\n`,
      ).values,
    ).toEqual([
      {
        value: "alice@example.com",
        note: "CFO",
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    ]);
  });

  test("a line's fields are split at commas and tabs outside quotes, a doubled quote one", () => {
    expect(
      readSecurityWatchlistImportFields('"a, b",  "say ""hi""" \tc'),
    ).toEqual(["a, b", 'say "hi"', "c"]);
    // A comma and a tab are two separators: an empty field between them.
    expect(readSecurityWatchlistImportFields("a,\tc")).toEqual(["a", "", "c"]);
    expect(readSecurityWatchlistImportFields("")).toEqual([""]);
    expect(readSecurityWatchlistImportFields("a,,b")).toEqual(["a", "", "b"]);
  });
});

describe("exporting a list: a CSV an import reads back", () => {
  test("the header names the value, its note and when it leaves the list", () => {
    expect(SECURITY_WATCHLIST_EXPORT_HEADER).toEqual([
      "value",
      "note",
      "expires",
    ]);
    expect(writeSecurityWatchlistCsv([])).toBe("value,note,expires\r\n");
  });

  test("a line a value, ending in a Windows line end a spreadsheet opens, the moment in UTC", () => {
    expect(
      writeSecurityWatchlistCsv([
        {
          value: "alice@example.com",
          note: "CFO",
          expiresAt: new Date("2026-12-31T18:00:00.000Z"),
        },
        { value: "bob@example.com" },
        {
          value: "carol@example.com",
          note: null,
          expiresAt: "2027-01-01T00:00:00Z",
        },
        { value: "dan@example.com", note: "x", expiresAt: "not a date" },
      ]),
    ).toBe(
      [
        "value,note,expires",
        "alice@example.com,CFO,2026-12-31T18:00:00.000Z",
        "bob@example.com,,",
        "carol@example.com,,2027-01-01T00:00:00.000Z",
        "dan@example.com,x,",
        "",
      ].join("\r\n"),
    );
  });

  test("a cell with a comma, a quote or a tab is quoted, and a note's line breaks become spaces", () => {
    expect(
      writeSecurityWatchlistCsv([
        { value: "svc-*", note: 'Ops, "on call"' },
        { value: "web-01", note: "first line\r\nsecond line\n\nthird" },
        { value: "db-01", note: "a\tb" },
      ]).split("\r\n"),
    ).toEqual([
      "value,note,expires",
      'svc-*,"Ops, ""on call""",',
      "web-01,first line second line third,",
      'db-01,"a\tb",',
      "",
    ]);
  });

  test("a cell a spreadsheet would run as a formula is written as text", () => {
    for (const formula of ["=HYPERLINK(1)", "+1", "-2+3", "@SUM(A1)"]) {
      expect(guardSecurityWatchlistCsvCell(formula)).toBe(`'${formula}`);
      expect(
        unguardSecurityWatchlistCsvCell(guardSecurityWatchlistCsvCell(formula)),
      ).toBe(formula);
    }

    expect(
      writeSecurityWatchlistCsv([{ value: "=cmd", note: "@admin" }]).split(
        "\r\n",
      )[1],
    ).toBe("'=cmd,'@admin,");
  });

  test("a cell that starts with an apostrophe before a formula's character, or another apostrophe, reads back as written", () => {
    for (const text of ["'=x", "'+1", "'-", "'@a", "''", "''quoted"]) {
      expect(guardSecurityWatchlistCsvCell(text)).toBe(`'${text}`);
      expect(
        unguardSecurityWatchlistCsvCell(guardSecurityWatchlistCsvCell(text)),
      ).toBe(text);
    }

    const read: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: writeSecurityWatchlistCsv([
        { value: "'=not-a-formula", note: "''twice" },
        { value: "'plain", note: "'" },
      ]),
      entityType: SecurityEntityType.Other,
      now: NOW,
    });

    expect(read.problems).toEqual([]);
    expect(read.values).toEqual([
      { value: "'=not-a-formula", note: "''twice" },
      { value: "'plain", note: "'" },
    ]);
  });

  test("anything else is written, and read, as it is", () => {
    for (const text of ["", "alice", "'quoted'", "'", "a=b", "x-1"]) {
      expect(guardSecurityWatchlistCsvCell(text)).toBe(text);
      expect(unguardSecurityWatchlistCsvCell(text)).toBe(text);
    }
  });

  test("an import reads an export back to the same values, notes and moments", () => {
    const values: Array<SecurityWatchlistExportValue> = [
      {
        value: "alice@example.com",
        note: "CFO, finance",
        expiresAt: new Date("2026-12-31T18:00:00.000Z"),
      },
      { value: "svc-*", note: 'The "service" accounts' },
      { value: "=not-a-formula", note: "-starts with a minus" },
      { value: "ünïcödé", note: "名前" },
      {
        value: "+44 user",
        note: "",
        expiresAt: new Date("2027-06-01T00:00:00.000Z"),
      },
    ];

    const read: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: writeSecurityWatchlistCsv(values),
      entityType: SecurityEntityType.Other,
      now: NOW,
    });

    expect(read.problems).toEqual([]);
    expect(read.values).toEqual([
      {
        value: "alice@example.com",
        note: "CFO, finance",
        expiresAt: new Date("2026-12-31T18:00:00.000Z"),
      },
      { value: "svc-*", note: 'The "service" accounts' },
      { value: "=not-a-formula", note: "-starts with a minus" },
      { value: "ünïcödé", note: "名前" },
      {
        value: "+44 user",
        note: "",
        expiresAt: new Date("2027-06-01T00:00:00.000Z"),
      },
    ]);
  });

  test("a whole list is written in time in line with its length", () => {
    const values: Array<SecurityWatchlistExportValue> = [];

    for (let index: number = 0; index < 5000; index++) {
      values.push({
        value: `user-${index}@example.com`,
        note: `"${"n".repeat(200)}", ${"\n".repeat(50)}`,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      });
    }

    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return writeSecurityWatchlistCsv(values);
      },
      limitInMs: 2000,
    });

    expect(timed.result.split("\r\n")).toHaveLength(5002);
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("a list read from a file at an address", () => {
  test("where a list's values come from: kept by hand, or read from an address", () => {
    expect(isSecurityWatchlistKeptByHand(undefined)).toBe(true);
    expect(isSecurityWatchlistKeptByHand(SecurityWatchlistSource.Values)).toBe(
      true,
    );
    expect(isSecurityWatchlistKeptByHand(SecurityWatchlistSource.Url)).toBe(
      false,
    );
    expect(
      isSecurityWatchlistKeptByHand(SecurityWatchlistSource.ThreatIntelFeed),
    ).toBe(false);
    expect(isSecurityWatchlistReadFromUrl(SecurityWatchlistSource.Url)).toBe(
      true,
    );
    expect(isSecurityWatchlistReadFromUrl(SecurityWatchlistSource.Values)).toBe(
      false,
    );
    expect(isSecurityWatchlistReadFromUrl(undefined)).toBe(false);
  });

  test("read every hour, every 6 hours or every day; every hour unless it says otherwise", () => {
    expect([...SECURITY_WATCHLIST_IMPORT_SCHEDULES]).toEqual([
      "Every Hour",
      "Every 6 Hours",
      "Every Day",
    ]);
    expect(DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE).toBe(
      SecurityWatchlistImportSchedule.EveryHour,
    );

    for (const schedule of SECURITY_WATCHLIST_IMPORT_SCHEDULES) {
      expect(isSecurityWatchlistImportSchedule(schedule)).toBe(true);
    }

    expect(isSecurityWatchlistImportSchedule("Every Minute")).toBe(false);
    expect(isSecurityWatchlistImportSchedule(undefined)).toBe(false);

    expect(
      SECURITY_WATCHLIST_IMPORT_SCHEDULES.map(
        (schedule: SecurityWatchlistImportSchedule): number => {
          return getSecurityWatchlistImportIntervalInMinutes(schedule);
        },
      ),
    ).toEqual([60, 360, 1440]);
    expect(getSecurityWatchlistImportIntervalInMinutes("Every Minute")).toBe(
      60,
    );
    expect(getSecurityWatchlistImportIntervalInMinutes(null)).toBe(60);
  });

  test("a list that was read is read again one interval on", () => {
    expect(
      getNextSecurityWatchlistImportAt({
        schedule: SecurityWatchlistImportSchedule.EverySixHours,
        now: NOW,
      }),
    ).toEqual(new Date("2026-11-03T18:00:00.000Z"));
    expect(
      getNextSecurityWatchlistImportAt({
        schedule: SecurityWatchlistImportSchedule.EveryDay,
        now: NOW,
      }),
    ).toEqual(new Date("2026-11-04T12:00:00.000Z"));
  });

  test("a read that failed is tried again within the hour, whatever the schedule", () => {
    expect(SECURITY_WATCHLIST_IMPORT_RETRY_IN_MINUTES).toBe(60);

    for (const schedule of SECURITY_WATCHLIST_IMPORT_SCHEDULES) {
      expect(getSecurityWatchlistImportRetryAt({ schedule, now: NOW })).toEqual(
        new Date("2026-11-03T13:00:00.000Z"),
      );
    }
  });

  test("an address is stored trimmed", () => {
    expect(
      normalizeSecurityWatchlistImportUrl("  https://example.com/vip.csv \n"),
    ).toBe("https://example.com/vip.csv");
    expect(normalizeSecurityWatchlistImportUrl(42)).toBe("");
    expect(normalizeSecurityWatchlistImportUrl(undefined)).toBe("");
  });

  test("a whole https address, with no sign-in in it, of at most 500 characters", () => {
    expect(
      getSecurityWatchlistImportUrlProblem("https://example.com/vip-users.csv"),
    ).toBeNull();
    expect(
      getSecurityWatchlistImportUrlProblem(
        " https://raw.example.com/lists/admins.txt?ref=main ",
      ),
    ).toBeNull();

    const cases: Array<[unknown, string]> = [
      ["", SECURITY_WATCHLIST_MESSAGES.enterUrl.message],
      [undefined, SECURITY_WATCHLIST_MESSAGES.enterUrl.message],
      [
        "example.com/vip.csv",
        SECURITY_WATCHLIST_MESSAGES.urlNotAnAddress.message,
      ],
      ["https://", SECURITY_WATCHLIST_MESSAGES.urlNotAnAddress.message],
      [
        "http://example.com/vip.csv",
        SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message,
      ],
      [
        "ftp://example.com/vip.csv",
        SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message,
      ],
      [
        "https://reader:secret@example.com/vip.csv",
        SECURITY_WATCHLIST_MESSAGES.urlHasCredentials.message,
      ],
      [
        "https://token@example.com/vip.csv",
        SECURITY_WATCHLIST_MESSAGES.urlHasCredentials.message,
      ],
      [
        `https://example.com/${"a".repeat(SECURITY_WATCHLIST_IMPORT_URL_MAX_LENGTH)}`,
        SECURITY_WATCHLIST_MESSAGES.urlTooLong.message,
      ],
    ];

    for (const [url, message] of cases) {
      expect({
        url,
        problem: getSecurityWatchlistImportUrlProblem(url),
      }).toEqual({ url, problem: message });
    }
  });

  test("the messages hold the numbers they say", () => {
    expect(SECURITY_WATCHLIST_IMPORT_URL_MAX_LENGTH).toBe(500);
    expect(SECURITY_WATCHLIST_MESSAGES.urlTooLong.message).toContain(
      `${SECURITY_WATCHLIST_IMPORT_URL_MAX_LENGTH} characters`,
    );
    expect(SECURITY_WATCHLIST_MESSAGES.urlFileTooLarge.message).toContain(
      `${SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS / 1024 / 1024} MB`,
    );
  });

  test("a list read from an address names the address, and a schedule it has", () => {
    const list: {
      name: string;
      entityType: SecurityEntityType;
      source: SecurityWatchlistSource;
    } = {
      name: "vip_users",
      entityType: SecurityEntityType.User,
      source: SecurityWatchlistSource.Url,
    };

    expect(
      getSecurityWatchlistProblems({
        ...list,
        importUrl: "https://example.com/vip.csv",
        importSchedule: SecurityWatchlistImportSchedule.EveryDay,
      }),
    ).toEqual([]);
    // No schedule said: every hour.
    expect(
      getSecurityWatchlistProblems({
        ...list,
        importUrl: "https://example.com/vip.csv",
      }),
    ).toEqual([]);
    expect(getSecurityWatchlistProblems(list)).toEqual([
      {
        field: "importUrl",
        message: SECURITY_WATCHLIST_MESSAGES.enterUrl.message,
      },
    ]);
    expect(
      getSecurityWatchlistProblems({
        ...list,
        importUrl: "http://example.com/vip.csv",
        importSchedule: "Every Minute",
      }),
    ).toEqual([
      {
        field: "importUrl",
        message: SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message,
      },
      {
        field: "importSchedule",
        message: SECURITY_WATCHLIST_MESSAGES.chooseSchedule.message,
      },
    ]);
  });

  test("any kind of list can be read from an address, a feed's kinds or not", () => {
    for (const entityType of SECURITY_WATCHLIST_ENTITY_TYPES) {
      expect(
        getSecurityWatchlistProblems({
          name: "a_list",
          entityType,
          source: SecurityWatchlistSource.Url,
          importUrl: "https://example.com/list.txt",
        }),
      ).toEqual([]);
    }
  });

  test("a list kept by hand or following a feed is never asked for an address", () => {
    expect(
      getSecurityWatchlistProblems({
        name: "vip_users",
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.Values,
        importUrl: "not an address",
        importSchedule: "Every Minute",
      }),
    ).toEqual([]);
  });
});

describe("the search a list's page offers to copy", () => {
  test("the list's usual field, and its name between % signs", () => {
    expect(
      SECURITY_WATCHLIST_ENTITY_TYPES.map(
        (entityType: SecurityEntityType): string => {
          return getSecurityWatchlistSearchSnippet({
            name: "my_list",
            entityType,
          });
        },
      ),
    ).toEqual([
      "principalUser:%my_list%",
      "principalHost:%my_list%",
      "principalIp:%my_list%",
      "observables:%my_list%",
      "observables:%my_list%",
      "observables:%my_list%",
      "processName:%my_list%",
      "observables:%my_list%",
    ]);
  });
});
