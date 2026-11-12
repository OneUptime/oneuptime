import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();

// The recorder's reads, stubbed as its own suites do (AuditLogRecorderDownload).
jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findProjectMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findUserMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS,
  AuditLogExportFailureNotice,
  getAuditLogExportEntriesLostAt,
  getAuditLogExportFailureNotice,
  getAuditLogExportLosingNoticeAt,
} from "../../../Server/AuditLogExport/AuditLogExportNotifications";
import { AuditLogService } from "Common/Server/Services/AuditLogService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import {
  AUDIT_LOG_MAX_RETENTION_IN_DAYS,
  AUDIT_LOG_MIN_RETENTION_IN_DAYS,
  readAuditLogRetentionInDays,
} from "Common/Types/AuditLog/AuditLogRetention";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import {
  resetMomentDefaultZone,
  setMomentDefaultZone,
} from "Common/Tests/Helpers/MomentDefaultZone";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * WHERE THE CLOCKS CHANGE, A FAILING EXPORT STILL SAYS "LOSING ENTRIES" A
 * DAY BEFORE THE ENTRY IS DELETED.
 *
 * An audit log entry is deleted once ClickHouse passes its retentionDate
 * (the AuditLog table's TTL), which AuditLogRecorder stamps the project's
 * retention in calendar days after it records the entry, in the server's
 * own zone. A failing export reads that stamp back - the soonest among the
 * entries it has not sent, as whole seconds since 1970 (#6563) - to send
 * "will start losing entries" a day before it, and to say from when; only
 * when it cannot read the stamps does it reckon the same moment itself
 * (getAuditLogExportEntriesLostAt). In a zone that changes its clocks, a
 * calendar day in between can be 23 or 25 hours long - half an hour either
 * way on Lord Howe Island, two hours on Antarctica/Troll - so a week across
 * the change is 167 or 169 hours, and the email goes a day before the
 * deletion only while the export counts days as the recorder does: by the
 * calendar.
 *
 * CI runs in UTC, where every day is 24 hours, so there neither the
 * recorder's suites nor AuditLogExportNotifications.test.ts can tell
 * calendar days from 24-hour ones. This suite reckons in zones that change
 * their clocks, through moment's default zone
 * (Common/Tests/Helpers/MomentDefaultZone: ee's server tests run in Node's
 * own environment, which ignores a zone docblock), and pins, for entries
 * recorded on either side of a change:
 *
 *   - the instant the export reckons is the retentionDate the recorder
 *     stamps on the entry, to the millisecond;
 *   - both are calendar days: the same time by that zone's clock, written
 *     out below with the hours they make, which only that zone gives - if
 *     either stops reckoning through moment, or starts counting 24-hour
 *     days, this fails in UTC too;
 *   - the email is due 24 hours before that instant, and not a millisecond
 *     sooner, whether the export read the stamp or reckoned it;
 *   - read back, the stamp is the instant in every zone, whatever the
 *     project's retention is now: lengthened or shortened after an entry
 *     was recorded, the email is still due 24 hours before its own stamp;
 *   - both read the project's retention by one rule
 *     (Common/Types/AuditLog/AuditLogRetention, #6383): for every value a
 *     project can store - none, -3, 0.5, 500, text - and in every zone, the
 *     export reckons the instant the recorder stamps. They once disagreed
 *     for a negative retention: the recorder kept entries a day, the export
 *     reckoned a week, and warned six days after they were gone.
 *
 * A retention is 7 to 180 days, so every entry here is kept a week or more.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
// 24 hours: for placing moments on the clock, never for when an entry is deleted.
const DAY: number = 24 * HOUR;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CAPTURE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

interface ClockChange {
  // The zone the server's clock is set to.
  zone: string;
  // What its clocks do while the entry is kept.
  change: string;
  // When the entry is recorded, and how many days its project keeps it (7 to 180).
  recordedAt: string;
  retentionInDays: number;
  // The same time by that zone's clock, retentionInDays later: the deletion.
  deletedAt: string;
  // How long that is.
  hours: number;
}

const CLOCK_CHANGES: Array<ClockChange> = [
  {
    // 12:59 BST, then 12:59 GMT: the issue's own (#6361).
    zone: "Europe/London",
    change: "go back an hour on 25 October 2026",
    recordedAt: "2026-10-24T11:59:00.000Z",
    retentionInDays: 7,
    deletedAt: "2026-10-31T12:59:00.000Z",
    hours: 169,
  },
  {
    zone: "Europe/London",
    change: "go back an hour on 25 October 2026",
    recordedAt: "2026-10-24T11:59:00.000Z",
    retentionInDays: 14,
    deletedAt: "2026-11-07T12:59:00.000Z",
    hours: 337,
  },
  {
    // 12:00 GMT, then 12:00 BST.
    zone: "Europe/London",
    change: "go forward an hour on 29 March 2026",
    recordedAt: "2026-03-28T12:00:00.000Z",
    retentionInDays: 7,
    deletedAt: "2026-04-04T11:00:00.000Z",
    hours: 167,
  },
  {
    // 12:00 EDT, then 12:00 EST.
    zone: "America/New_York",
    change: "go back an hour on 1 November 2026",
    recordedAt: "2026-10-31T16:00:00.000Z",
    retentionInDays: 7,
    deletedAt: "2026-11-07T17:00:00.000Z",
    hours: 169,
  },
  {
    zone: "America/New_York",
    change: "go forward an hour on 8 March 2026",
    recordedAt: "2026-03-07T17:00:00.000Z",
    retentionInDays: 30,
    deletedAt: "2026-04-06T16:00:00.000Z",
    hours: 719,
  },
  {
    // 12:00 at +10:30, then 12:00 at +11:00.
    zone: "Australia/Lord_Howe",
    change: "go forward half an hour on 4 October 2026",
    recordedAt: "2026-10-02T01:30:00.000Z",
    retentionInDays: 7,
    deletedAt: "2026-10-09T01:00:00.000Z",
    hours: 167.5,
  },
  {
    // 12:00 at +11:00, then 12:00 at +10:30.
    zone: "Australia/Lord_Howe",
    change: "go back half an hour on 5 April 2026",
    recordedAt: "2026-04-04T01:00:00.000Z",
    retentionInDays: 7,
    deletedAt: "2026-04-11T01:30:00.000Z",
    hours: 168.5,
  },
  {
    // 12:00 at +12:45, then 12:00 at +13:45: the longest retention there is.
    zone: "Pacific/Chatham",
    change: "go forward an hour on 27 September 2026",
    recordedAt: "2026-09-25T23:15:00.000Z",
    retentionInDays: 180,
    deletedAt: "2027-03-24T22:15:00.000Z",
    hours: 4319,
  },
  {
    // 13:59 at +02:00, then 13:59 at +00:00.
    zone: "Antarctica/Troll",
    change: "go back two hours on 25 October 2026",
    recordedAt: "2026-10-24T11:59:00.000Z",
    retentionInDays: 7,
    deletedAt: "2026-10-31T13:59:00.000Z",
    hours: 170,
  },
  {
    zone: "UTC",
    change: "never change",
    recordedAt: "2026-10-24T11:59:00.000Z",
    retentionInDays: 7,
    deletedAt: "2026-10-31T11:59:00.000Z",
    hours: 168,
  },
];

let project: Project;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

beforeEach(() => {
  setTestBillingEnabled(false);

  project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = true;
  project.auditLogsRetentionInDays = 7;

  inserted = [];
  recorder = new AuditLogRecorder({
    store: {
      create: jest.fn(((createBy: { data: AuditLog }) => {
        inserted.push(createBy.data);
        return Promise.resolve(createBy.data);
      }) as never),
    } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  findUserMock.mockReset();
  findUserMock.mockImplementation(() => {
    const user: User = new User();
    user._id = USER_ID.toString();
    user.name = new Name("Ada Lovelace");
    user.email = new Email("ada@example.com");
    return Promise.resolve(user);
  });

  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockResolvedValue([] as Array<BaseModel> as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  resetMomentDefaultZone();
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

/*
 * The retentionDate the recorder stamps on an entry it records at
 * `recordedAt` for a project that keeps its audit log `retentionInDays`
 * days. Every entry is stamped the same way, whatever it records: this one
 * is a packet capture's download.
 */
const stampedRetentionDate: (
  recordedAt: string,
  retentionInDays: number,
) => Promise<Date> = async (
  recordedAt: string,
  retentionInDays: number,
): Promise<Date> => {
  project.auditLogsRetentionInDays = retentionInDays;
  jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(new Date(recordedAt));

  const capture: PacketCapture = new PacketCapture(CAPTURE_ID);
  capture.projectId = PROJECT_ID;
  capture.name = "eth0: host 10.0.0.5";

  await recorder.recordDownload({
    model: new PacketCapture(),
    downloadedItem: capture,
    itemId: CAPTURE_ID,
    props: USER_PROPS,
  });

  expect(inserted).toHaveLength(1);
  expect(inserted[0]!.retentionDate).toBeInstanceOf(Date);

  return inserted[0]!.retentionDate as Date;
};

/*
 * The stamp as a failing export reads it back from the audit log: the
 * soonest retentionDate among the entries it has not sent, answered as whole
 * seconds since 1970 (AuditLogService.toSoonestRetentionDateStatement) and
 * read by AuditLogService.readSoonestRetentionDate - a number, so no zone
 * moves it.
 */
const readBack: (stamped: Date) => Date | null = (
  stamped: Date,
): Date | null => {
  return AuditLogService.readSoonestRetentionDate([
    { waiting: "1", soonest: Math.floor(stamped.getTime() / 1000) },
  ]);
};

describe("the instant an entry is deleted, where the clocks change", () => {
  test.each(CLOCK_CHANGES)(
    "$zone, whose clocks $change: a $retentionInDays-day retention is $hours hours, and the export reckons the instant the recorder stamps",
    async (clockChange: ClockChange) => {
      setMomentDefaultZone(clockChange.zone);

      const stamped: Date = await stampedRetentionDate(
        clockChange.recordedAt,
        clockChange.retentionInDays,
      );
      const lostAt: Date = getAuditLogExportEntriesLostAt({
        oldestUnsentAt: new Date(clockChange.recordedAt),
        retentionInDays: clockChange.retentionInDays,
      });

      expect(stamped.toISOString()).toBe(clockChange.deletedAt);
      expect(lostAt.toISOString()).toBe(clockChange.deletedAt);
      expect(
        (lostAt.getTime() - Date.parse(clockChange.recordedAt)) / HOUR,
      ).toBe(clockChange.hours);
    },
  );

  test.each(CLOCK_CHANGES)(
    "in the machine's own zone, whatever it is, the export reckons the instant the recorder stamps ($recordedAt, a $retentionInDays-day retention)",
    async (clockChange: ClockChange) => {
      const stamped: Date = await stampedRetentionDate(
        clockChange.recordedAt,
        clockChange.retentionInDays,
      );

      expect(
        getAuditLogExportEntriesLostAt({
          oldestUnsentAt: new Date(clockChange.recordedAt),
          retentionInDays: clockChange.retentionInDays,
        }).toISOString(),
      ).toBe(stamped.toISOString());
    },
  );
});

describe("the 'losing entries' email is due a day before that instant", () => {
  // Kept a week or more: the email is never due before the first one (30 minutes in).
  test.each(CLOCK_CHANGES)(
    "$zone, whose clocks $change: 24 hours before $deletedAt, and not a millisecond sooner, from the stamp read back or as reckoned",
    async (clockChange: ClockChange) => {
      setMomentDefaultZone(clockChange.zone);

      const recordedAt: Date = new Date(clockChange.recordedAt);
      const due: number =
        Date.parse(clockChange.deletedAt) -
        AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS * HOUR;
      const stamped: Date = await stampedRetentionDate(
        clockChange.recordedAt,
        clockChange.retentionInDays,
      );

      expect(AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS).toBe(24);

      for (const [how, soonestRetentionDate] of [
        ["read back", readBack(stamped)],
        ["reckoned", null],
      ] as Array<[string, Date | null]>) {
        const entriesLostAt: Date = getAuditLogExportEntriesLostAt({
          oldestUnsentAt: recordedAt,
          retentionInDays: clockChange.retentionInDays,
          soonestRetentionDate,
        });

        // Failing since the entry was recorded: it is the oldest one unsent.
        const notice: (
          previousFailureAt: number,
          now: number,
        ) => AuditLogExportFailureNotice | null = (
          previousFailureAt: number,
          now: number,
        ): AuditLogExportFailureNotice | null => {
          return getAuditLogExportFailureNotice({
            failingSince: recordedAt,
            previousFailureAt: new Date(previousFailureAt),
            now: new Date(now),
            entriesLostAt,
          });
        };

        expect({ how, lostAt: entriesLostAt.toISOString() }).toEqual({
          how,
          lostAt: clockChange.deletedAt,
        });
        expect({
          how,
          dueAt: getAuditLogExportLosingNoticeAt({
            failingSince: recordedAt,
            entriesLostAt,
          })!.toISOString(),
        }).toEqual({ how, dueAt: new Date(due).toISOString() });
        expect({
          how,
          atDue: notice(due - HOUR, due),
          justBefore: notice(due - HOUR, due - 1),
          after: notice(due, due + HOUR),
        }).toEqual({
          how,
          atDue: AuditLogExportFailureNotice.LosingEntries,
          justBefore: null,
          after: null,
        });
      }
    },
  );

  test("a week's retention ending the day after London's clocks go back: 24 hours 59 minutes are left when the failures begin, so the first email says 'failing', and 'losing entries' follows when a day is left", async () => {
    setMomentDefaultZone("Europe/London");

    /*
     * Failing from 12:00 UTC (13:00 BST) on 24 October 2026; the entry was
     * recorded six days and a minute before, at 12:59 BST on 18 October, and
     * is deleted at 12:59 GMT on 25 October, 169 hours later.
     */
    const failingSince: Date = new Date("2026-10-24T12:00:00.000Z");
    const oldestUnsentAt: Date = new Date("2026-10-18T11:59:00.000Z");
    const entriesLostAt: Date = getAuditLogExportEntriesLostAt({
      oldestUnsentAt,
      retentionInDays: 7,
    });
    const notice: (
      previousFailureAt: string,
      now: string,
    ) => AuditLogExportFailureNotice | null = (
      previousFailureAt: string,
      now: string,
    ): AuditLogExportFailureNotice | null => {
      return getAuditLogExportFailureNotice({
        failingSince,
        previousFailureAt: new Date(previousFailureAt),
        now: new Date(now),
        entriesLostAt,
      });
    };

    expect(entriesLostAt.toISOString()).toBe("2026-10-25T12:59:00.000Z");
    // The recorder stamps the entry so, and the export reads that stamp back.
    expect(
      readBack(
        await stampedRetentionDate(oldestUnsentAt.toISOString(), 7),
      )!.toISOString(),
    ).toBe("2026-10-25T12:59:00.000Z");
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince,
        entriesLostAt,
      })!.toISOString(),
    ).toBe("2026-10-24T12:59:00.000Z");
    // The tries come 15, 31 and 63 minutes in.
    expect(notice("2026-10-24T12:15:00.000Z", "2026-10-24T12:31:00.000Z")).toBe(
      AuditLogExportFailureNotice.Failing,
    );
    expect(notice("2026-10-24T12:31:00.000Z", "2026-10-24T13:03:00.000Z")).toBe(
      AuditLogExportFailureNotice.LosingEntries,
    );
  });

  test("a week's retention ending the day after London's clocks go forward: 22 hours 59 minutes are left when the failures begin, so the first email already says 'losing entries'", async () => {
    setMomentDefaultZone("Europe/London");

    /*
     * Failing from 12:00 GMT on 28 March 2026; the entry was recorded at
     * 11:59 GMT on 22 March, and is deleted at 11:59 BST on 29 March, 167
     * hours later.
     */
    const failingSince: Date = new Date("2026-03-28T12:00:00.000Z");
    const oldestUnsentAt: Date = new Date("2026-03-22T11:59:00.000Z");
    const entriesLostAt: Date = getAuditLogExportEntriesLostAt({
      oldestUnsentAt,
      retentionInDays: 7,
    });

    expect(entriesLostAt.toISOString()).toBe("2026-03-29T10:59:00.000Z");
    expect(
      readBack(
        await stampedRetentionDate(oldestUnsentAt.toISOString(), 7),
      )!.toISOString(),
    ).toBe("2026-03-29T10:59:00.000Z");
    // Less than a day left when the first email can go, 30 minutes in.
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince,
        entriesLostAt,
      })!.toISOString(),
    ).toBe("2026-03-28T12:30:00.000Z");
    expect(
      getAuditLogExportFailureNotice({
        failingSince,
        previousFailureAt: new Date("2026-03-28T12:15:00.000Z"),
        now: new Date("2026-03-28T12:31:00.000Z"),
        entriesLostAt,
      }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
  });
});

/*
 * A RETENTION CHANGED WHILE ENTRIES WAIT (#6563).
 *
 * The recorder stamps each entry from the retention its project has when it
 * records it, and the table deletes the entry on that stamp: a retention
 * changed later moves no stamp. A failing export reads the stamps back, so
 * in every zone above, lengthened or shortened after the entry was
 * recorded, the email is due 24 hours before the entry's own stamp and says
 * that date. Reckoned from the retention as it is now - what the export did
 * before - it is off by the days the retention changed by, give or take the
 * clocks' change: lengthened from a week to 180 days, the email came
 * months after the entry was gone.
 */
interface ChangedRetentionCase extends ClockChange {
  // The project's retention once the entry is recorded.
  changedTo: number;
}

const CHANGED_RETENTION_CASES: Array<ChangedRetentionCase> =
  CLOCK_CHANGES.flatMap(
    (clockChange: ClockChange): Array<ChangedRetentionCase> => {
      return [7, 30, 180]
        .filter((changedTo: number): boolean => {
          return changedTo !== clockChange.retentionInDays;
        })
        .map((changedTo: number): ChangedRetentionCase => {
          return { ...clockChange, changedTo };
        });
    },
  );

describe("a retention changed while an entry waits: the email follows the entry's own stamp, in every zone", () => {
  test("every clock change above, each retention changed to the others of 7, 30 and 180 days, lengthened and shortened", () => {
    for (const clockChange of CLOCK_CHANGES) {
      expect(
        CHANGED_RETENTION_CASES.filter(
          (changed: ChangedRetentionCase): boolean => {
            return (
              changed.zone === clockChange.zone &&
              changed.recordedAt === clockChange.recordedAt &&
              changed.retentionInDays === clockChange.retentionInDays
            );
          },
        ).length,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(
      CHANGED_RETENTION_CASES.some((changed: ChangedRetentionCase): boolean => {
        return changed.changedTo > changed.retentionInDays;
      }),
    ).toBe(true);
    expect(
      CHANGED_RETENTION_CASES.some((changed: ChangedRetentionCase): boolean => {
        return changed.changedTo < changed.retentionInDays;
      }),
    ).toBe(true);
  });

  test.each(CHANGED_RETENTION_CASES)(
    "$zone, whose clocks $change: recorded with $retentionInDays days, then $changedTo - deleted at $deletedAt, told 24 hours before",
    async (changed: ChangedRetentionCase) => {
      setMomentDefaultZone(changed.zone);

      const recordedAt: Date = new Date(changed.recordedAt);
      const stamped: Date = await stampedRetentionDate(
        changed.recordedAt,
        changed.retentionInDays,
      );

      // The project's retention changes after the entry is recorded.
      project.auditLogsRetentionInDays = changed.changedTo;

      const entriesLostAt: Date = getAuditLogExportEntriesLostAt({
        oldestUnsentAt: recordedAt,
        retentionInDays: changed.changedTo,
        soonestRetentionDate: readBack(stamped),
      });
      const due: number =
        Date.parse(changed.deletedAt) -
        AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS * HOUR;
      const notice: (
        previousFailureAt: number,
        now: number,
      ) => AuditLogExportFailureNotice | null = (
        previousFailureAt: number,
        now: number,
      ): AuditLogExportFailureNotice | null => {
        return getAuditLogExportFailureNotice({
          failingSince: recordedAt,
          previousFailureAt: new Date(previousFailureAt),
          now: new Date(now),
          entriesLostAt,
        });
      };

      expect(stamped.toISOString()).toBe(changed.deletedAt);
      expect(entriesLostAt.toISOString()).toBe(changed.deletedAt);
      expect(
        getAuditLogExportLosingNoticeAt({
          failingSince: recordedAt,
          entriesLostAt,
        })!.toISOString(),
      ).toBe(new Date(due).toISOString());
      expect(notice(due - HOUR, due)).toBe(
        AuditLogExportFailureNotice.LosingEntries,
      );
      expect(notice(due - HOUR, due - 1)).toBeNull();

      // Reckoned from the retention as it is now: off by the days it changed by.
      const reckoned: Date = getAuditLogExportEntriesLostAt({
        oldestUnsentAt: recordedAt,
        retentionInDays: changed.changedTo,
      });
      const offBy: number =
        reckoned.getTime() -
        Date.parse(changed.deletedAt) -
        (changed.changedTo - changed.retentionInDays) * DAY;

      expect(reckoned.toISOString()).not.toBe(changed.deletedAt);
      expect(Math.abs(offBy)).toBeLessThanOrEqual(2 * HOUR);
    },
  );
});

describe("the stamp read back is the instant the recorder stamped, in every zone", () => {
  test.each(CLOCK_CHANGES)(
    "$zone, whose clocks $change: $deletedAt, read as whole seconds since 1970",
    async (clockChange: ClockChange) => {
      setMomentDefaultZone(clockChange.zone);

      const stamped: Date = await stampedRetentionDate(
        clockChange.recordedAt,
        clockChange.retentionInDays,
      );

      expect(readBack(stamped)!.toISOString()).toBe(clockChange.deletedAt);
      expect(readBack(stamped)!.toISOString()).toBe(stamped.toISOString());
    },
  );
});

/*
 * ONE RULE FOR THE RETENTION (#6383).
 *
 * The recorder stamped Math.max(1, Math.min(days || 7, 180)) days, and the
 * export reckoned any value <= 0 as 7: for -3, which the API took, the
 * recorder deleted an entry after a day while a failing export reckoned a
 * week, and its "will start losing entries" email was due six days after
 * the entry was gone. Both now read the stored value by one rule
 * (readAuditLogRetentionInDays: 7 to 180 whole days, 7 for none), and the
 * server refuses a value outside that range, but a value stored before is
 * still read. So, for every value a project can hold, in every zone above
 * that keeps an entry a week: the instant the export reckons is the one the
 * recorder stamps, and a value read as a week is deleted at that zone's
 * week, written out above.
 */
const STORED_VALUES: Array<{ name: string; value: unknown; days: number }> = [
  { name: "none", value: null, days: 7 },
  { name: "0", value: 0, days: 7 },
  { name: "-3", value: -3, days: 7 },
  { name: "0.5", value: 0.5, days: 7 },
  { name: "3", value: 3, days: 7 },
  { name: "7", value: 7, days: 7 },
  { name: "180", value: 180, days: 180 },
  { name: "500", value: 500, days: 180 },
  { name: "NaN", value: Number.NaN, days: 7 },
  { name: '"30", a number written as text', value: "30", days: 30 },
  { name: '"a week", text', value: "a week", days: 7 },
];

interface StoredValueCase {
  zone: string;
  change: string;
  recordedAt: string;
  // When the zone's week from recordedAt ends, written out above.
  weekEndsAt: string;
  name: string;
  value: unknown;
  days: number;
}

const STORED_VALUE_CASES: Array<StoredValueCase> = CLOCK_CHANGES.filter(
  (clockChange: ClockChange): boolean => {
    return clockChange.retentionInDays === 7;
  },
).flatMap((week: ClockChange): Array<StoredValueCase> => {
  return STORED_VALUES.map(
    (stored: {
      name: string;
      value: unknown;
      days: number;
    }): StoredValueCase => {
      return {
        zone: week.zone,
        change: week.change,
        recordedAt: week.recordedAt,
        weekEndsAt: week.deletedAt,
        ...stored,
      };
    },
  );
});

describe("one rule: for every value a project can store, the export reckons the instant the recorder stamps", () => {
  test("every zone that changes its clocks is here, with the values the issue named", () => {
    expect(
      [
        ...new Set(
          STORED_VALUE_CASES.map((stored: StoredValueCase): string => {
            return stored.zone;
          }),
        ),
      ].sort(),
    ).toEqual(
      [
        "America/New_York",
        "Antarctica/Troll",
        "Australia/Lord_Howe",
        "Europe/London",
        "UTC",
      ].sort(),
    );
    expect(STORED_VALUE_CASES).toHaveLength(7 * STORED_VALUES.length);
  });

  test.each(STORED_VALUE_CASES)(
    "$zone, whose clocks $change: a stored retention of $name keeps an entry $days days, as the export reckons",
    async (stored: StoredValueCase) => {
      setMomentDefaultZone(stored.zone);

      const stamped: Date = await stampedRetentionDate(
        stored.recordedAt,
        stored.value as number,
      );
      const lostAt: Date = getAuditLogExportEntriesLostAt({
        oldestUnsentAt: new Date(stored.recordedAt),
        retentionInDays: stored.value as number,
      });

      expect(lostAt.toISOString()).toBe(stamped.toISOString());
      expect(readAuditLogRetentionInDays(stored.value)).toBe(stored.days);
      expect(stamped.toISOString()).toBe(
        stored.days === 7
          ? stored.weekEndsAt
          : OneUptimeDate.addRemoveDays(
              new Date(stored.recordedAt),
              stored.days,
            ).toISOString(),
      );
    },
  );

  test("a negative retention: 'losing entries' a day before the entry is deleted, and not six days after", async () => {
    setMomentDefaultZone("Europe/London");

    const recordedAt: string = "2026-10-24T11:59:00.000Z";
    const stamped: Date = await stampedRetentionDate(recordedAt, -3);

    // Kept the week the export reckons: 12:59 BST to 12:59 GMT.
    expect(stamped.toISOString()).toBe("2026-10-31T12:59:00.000Z");

    // Read back from the stamp, or reckoned when it cannot be: the same day.
    for (const soonestRetentionDate of [readBack(stamped), null]) {
      const losingAt: Date = getAuditLogExportLosingNoticeAt({
        failingSince: new Date(recordedAt),
        entriesLostAt: getAuditLogExportEntriesLostAt({
          oldestUnsentAt: new Date(recordedAt),
          retentionInDays: -3,
          soonestRetentionDate,
        }),
      })!;

      expect(losingAt.getTime()).toBe(stamped.getTime() - 24 * HOUR);
    }
  });
});

/*
 * Values of every kind a project could hold, drawn from a seeded stream:
 * whole numbers either side of the range, fractions, huge numbers, numbers
 * written as text, and what is not a number at all.
 */
const drawStoredValue: (random: SeededRandom) => unknown = (
  random: SeededRandom,
): unknown => {
  const kind: number = random(6);

  if (kind === 0) {
    return random(1000) - 400;
  }

  if (kind === 1) {
    return random() * 400 - 100;
  }

  if (kind === 2) {
    return random() * 1e9 * (random(2) === 0 ? 1 : -1);
  }

  if (kind === 3) {
    return String(random(400) - 100);
  }

  if (kind === 4) {
    return (
      AUDIT_LOG_MIN_RETENTION_IN_DAYS + random(AUDIT_LOG_MAX_RETENTION_IN_DAYS)
    );
  }

  return [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "", "a week"][
    random(6)
  ];
};

const RANDOM_ZONES: Array<string> = [
  "UTC",
  "Europe/London",
  "America/New_York",
  "America/Santiago",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Antarctica/Troll",
  "Asia/Kolkata",
];

// 400 entries recorded, one at a time: far more than Jest's 5 seconds on a busy runner.
const RANDOM_DRAWS_TIMEOUT_IN_MS: number = 120000;

describe("one rule, drawn at random: values, zones and moments", () => {
  test(
    "the export reckons the instant the recorder stamps, a week to 180 days later by the zone's clock",
    async () => {
      const random: SeededRandom = seededRandom(6383);
      // The retention as it is now, from a stream of its own so the draws above stay as they were.
      const retentionNow: SeededRandom = seededRandom(6563);
      const FROM: number = Date.parse("2026-01-01T00:00:00.000Z");

      for (let draw: number = 0; draw < 400; draw++) {
        const zone: string = RANDOM_ZONES[
          random(RANDOM_ZONES.length)
        ] as string;
        const value: unknown = drawStoredValue(random);
        // Any minute of two years, so draws fall on every side of each change.
        const recordedAt: Date = new Date(
          FROM + random(730) * DAY + random(24 * 60) * MINUTE,
        );

        setMomentDefaultZone(zone);
        inserted = [];
        recorder.invalidateProjectSettings(PROJECT_ID);

        const stamped: Date = await stampedRetentionDate(
          recordedAt.toISOString(),
          value as number,
        );
        const lostAt: Date = getAuditLogExportEntriesLostAt({
          oldestUnsentAt: recordedAt,
          retentionInDays: value as number,
        });
        const days: number = readAuditLogRetentionInDays(value);

        expect({ draw, zone, value, lostAt: lostAt.toISOString() }).toEqual({
          draw,
          zone,
          value,
          lostAt: stamped.toISOString(),
        });
        expect(days).toBeGreaterThanOrEqual(AUDIT_LOG_MIN_RETENTION_IN_DAYS);
        expect(days).toBeLessThanOrEqual(AUDIT_LOG_MAX_RETENTION_IN_DAYS);
        // Never a day off: the clocks change by two hours at most.
        expect({
          draw,
          zone,
          value,
          withinTwoHoursOfTheDays:
            Math.abs(stamped.getTime() - recordedAt.getTime() - days * DAY) <=
            2 * HOUR,
        }).toEqual({ draw, zone, value, withinTwoHoursOfTheDays: true });
        // The email that entries are lost goes a day before they are.
        expect(
          getAuditLogExportLosingNoticeAt({
            failingSince: recordedAt,
            entriesLostAt: lostAt,
          })!.getTime(),
        ).toBe(stamped.getTime() - 24 * HOUR);
        // And from the stamp read back, whatever the retention is now.
        expect({
          draw,
          zone,
          value,
          lostAt: getAuditLogExportEntriesLostAt({
            oldestUnsentAt: recordedAt,
            retentionInDays: drawStoredValue(retentionNow) as number,
            soonestRetentionDate: readBack(stamped),
          }).toISOString(),
        }).toEqual({ draw, zone, value, lostAt: stamped.toISOString() });
      }
    },
    RANDOM_DRAWS_TIMEOUT_IN_MS,
  );
});
