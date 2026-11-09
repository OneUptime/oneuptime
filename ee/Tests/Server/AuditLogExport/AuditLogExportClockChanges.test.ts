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
import DatabaseService from "Common/Server/Services/DatabaseService";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
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
 * own zone. A failing export reckons the same moment
 * (getAuditLogExportEntriesLostAt) to send "will start losing entries" a day
 * before it, and to say from when. In a zone that changes its clocks, a
 * calendar day in between can be 23 or 25 hours long - half an hour either
 * way on Lord Howe Island, two hours on Antarctica/Troll - so the email goes
 * a day before the deletion only while the export counts days as the
 * recorder does: by the calendar.
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
 *     sooner.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

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
  // When the entry is recorded, and how many days its project keeps it.
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
    retentionInDays: 1,
    deletedAt: "2026-10-25T12:59:00.000Z",
    hours: 25,
  },
  {
    // 12:00 GMT, then 12:00 BST.
    zone: "Europe/London",
    change: "go forward an hour on 29 March 2026",
    recordedAt: "2026-03-28T12:00:00.000Z",
    retentionInDays: 1,
    deletedAt: "2026-03-29T11:00:00.000Z",
    hours: 23,
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
    zone: "Australia/Lord_Howe",
    change: "go back half an hour on 5 April 2026",
    recordedAt: "2026-04-04T01:00:00.000Z",
    retentionInDays: 1,
    deletedAt: "2026-04-05T01:30:00.000Z",
    hours: 24.5,
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
    // +02:00, then +00:00.
    zone: "Antarctica/Troll",
    change: "go back two hours on 25 October 2026",
    recordedAt: "2026-10-24T11:59:00.000Z",
    retentionInDays: 1,
    deletedAt: "2026-10-25T13:59:00.000Z",
    hours: 26,
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
  // Kept longer than a day: the email is never due before the first one (30 minutes in).
  test.each(
    CLOCK_CHANGES.filter((clockChange: ClockChange): boolean => {
      return clockChange.retentionInDays > 1;
    }),
  )(
    "$zone, whose clocks $change: 24 hours before $deletedAt, and not a millisecond sooner",
    (clockChange: ClockChange) => {
      setMomentDefaultZone(clockChange.zone);

      const recordedAt: Date = new Date(clockChange.recordedAt);
      const due: number =
        Date.parse(clockChange.deletedAt) -
        AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS * HOUR;

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
          oldestUnsentAt: recordedAt,
          retentionInDays: clockChange.retentionInDays,
        });
      };

      expect(AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS).toBe(24);
      expect(
        getAuditLogExportLosingNoticeAt({
          failingSince: recordedAt,
          oldestUnsentAt: recordedAt,
          retentionInDays: clockChange.retentionInDays,
        })!.toISOString(),
      ).toBe(new Date(due).toISOString());
      expect(notice(due - HOUR, due)).toBe(
        AuditLogExportFailureNotice.LosingEntries,
      );
      expect(notice(due - HOUR, due - 1)).toBeNull();
      expect(notice(due, due + HOUR)).toBeNull();
    },
  );

  test("a day's retention over the night London's clocks go back is 25 hours: the first email says 'failing', and 'losing entries' follows when a day is left", () => {
    setMomentDefaultZone("Europe/London");

    // Failing from 12:00 UTC (13:00 BST) on 24 October 2026; the entry is a minute older.
    const failingSince: Date = new Date("2026-10-24T12:00:00.000Z");
    const oldestUnsentAt: Date = new Date("2026-10-24T11:59:00.000Z");
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
        oldestUnsentAt,
        retentionInDays: 1,
      });
    };

    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince,
        oldestUnsentAt,
        retentionInDays: 1,
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

  test("a day's retention over the night London's clocks go forward is 23 hours: the first email already says 'losing entries'", () => {
    setMomentDefaultZone("Europe/London");

    const failingSince: Date = new Date("2026-03-28T12:00:00.000Z");
    const oldestUnsentAt: Date = new Date("2026-03-28T11:59:00.000Z");

    expect(
      getAuditLogExportEntriesLostAt({
        oldestUnsentAt,
        retentionInDays: 1,
      }).toISOString(),
    ).toBe("2026-03-29T10:59:00.000Z");
    // Less than a day left when the first email can go, 30 minutes in.
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince,
        oldestUnsentAt,
        retentionInDays: 1,
      })!.toISOString(),
    ).toBe("2026-03-28T12:30:00.000Z");
    expect(
      getAuditLogExportFailureNotice({
        failingSince,
        previousFailureAt: new Date("2026-03-28T12:15:00.000Z"),
        now: new Date("2026-03-28T12:31:00.000Z"),
        oldestUnsentAt,
        retentionInDays: 1,
      }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
  });
});
