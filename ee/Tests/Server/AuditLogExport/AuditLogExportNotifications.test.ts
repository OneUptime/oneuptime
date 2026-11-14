import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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

const mockSendMail: jest.Mock<Promise<unknown>, Array<unknown>> = jest.fn();
const mockSendToMasterAdmins: jest.Mock<
  Promise<unknown>,
  Array<unknown>
> = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): Promise<unknown> => {
        return mockSendMail(...args);
      },
    },
  };
});

jest.mock(
  "App/FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthNotification",
  () => {
    return {
      __esModule: true,
      getAdminDashboardHealthLink: (route: string): string => {
        return `https://oneuptime.acme.test/admin${route}`;
      },
      sendInstanceHealthNotificationToMasterAdmins: (
        ...args: Array<unknown>
      ): Promise<unknown> => {
        return mockSendToMasterAdmins(...args);
      },
    };
  },
);

import AuditLogExporter from "../../../Server/AuditLogExport/AuditLogExporter";
import {
  AUDIT_LOG_EXPORT_FAILING_NOTICE_AFTER_IN_MINUTES,
  AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS,
  AuditLogExportFailureEmail,
  AuditLogExportFailureNotice,
  AuditLogExportFailureNotification,
  AuditLogExportNotifier,
  auditLogExportEmailNotifier,
  buildAuditLogExportFailureEmail,
  getAuditLogExportEntriesLostAt,
  getAuditLogExportFailureNotice,
  getAuditLogExportLosingNoticeAt,
  getAuditLogExportRetentionInDays,
} from "../../../Server/AuditLogExport/AuditLogExportNotifications";
import AuditLogExportDestinationRegistry from "../../../Server/AuditLogExport/Destinations/DestinationRegistry";
import {
  AuditLogExportDelivery,
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
} from "../../../Server/AuditLogExport/Destinations/Types";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { SemaphoreMutex } from "Common/Server/Infrastructure/Semaphore";
import AuditLogExportService from "Common/Server/Services/AuditLogExportService";
import ProjectService from "Common/Server/Services/ProjectService";
import AuditLogExportSettingsUtil from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import logger from "Common/Server/Utils/Logger";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import URL from "Common/Types/API/URL";
import {
  AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS,
  readAuditLogRetentionInDays,
} from "Common/Types/AuditLog/AuditLogRetention";
import { getAuditLogExportDestinationDefinition } from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { PROJECT_A, PROJECT_B } from "./AuditLogExportTestData";
import {
  createInMemoryAuditLog,
  InMemoryAuditLog,
} from "./Fakes/InMemoryAuditLog";
import {
  InMemoryExports,
  newStoredExport,
  StoredExport,
  useInMemoryExports,
} from "./Fakes/InMemoryExports";
import RecordingDestination from "./Fakes/RecordingDestination";

/*
 * A failing audit log export tells the people who can fix it (#5232's
 * follow-ups). It only said so on its row, and the entries it had not sent
 * waited in the audit log only as long as the audit log keeps them: each
 * entry is deleted once it is older than the retention it was recorded
 * with, sent or not, without anybody knowing.
 *
 *   - after 30 minutes of failures: "is failing", nothing lost yet;
 *   - a day before the first unsent entry is deleted (never sooner than
 *     the first email; never while nothing waits): "will start losing
 *     entries", from when, and that fixing it before then sends them - a
 *     longer retention keeps only entries recorded after the change, so it
 *     is not offered as a way to keep these;
 *   - that moment already passed by the try the email goes on (an entry
 *     the audit log has not dropped yet, past its own stamp): "is losing
 *     entries", since when, and to fix the destination now so the export
 *     sends the ones still kept - never "before then" (#7185);
 *   - each once per run of failures, without anything stored for it: the
 *     email is due when its moment passes between two tries;
 *   - a project's export emails the project's owners; the instance's, every
 *     master admin; sending never stops the export.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
// 24 hours: for placing moments on the clock, never for when an entry is deleted.
const DAY: number = 24 * HOUR;

const START: Date = new Date("2026-10-24T12:00:00.000Z");

const at: (offsetInMs: number) => Date = (offsetInMs: number): Date => {
  return new Date(START.getTime() + offsetInMs);
};

/*
 * When the audit log deletes an entry recorded at `recordedAt`: once its
 * retentionDate passes, which AuditLogRecorder stamps `retentionInDays`
 * calendar days after it records the entry, by the server's own clock
 * (computeRetentionDate). The export reads that stamp back, or reckons the
 * same moment when it cannot (getAuditLogExportEntriesLostAt), and the
 * in-memory audit log stamps its entries the recorder's way. So every
 * moment below that hangs on a deletion is reckoned from this, never as
 * `recordedAt + days * DAY`: these
 * dates cross the night of 25 October 2026, when clocks in Europe go back,
 * and on a server in such a zone that day is 25 hours long (#6361). So the
 * suite holds in whatever zone the machine runs in.
 * AuditLogExportClockChanges.test.ts writes the instants out for zones whose
 * clocks change, which CI, in UTC, would never see otherwise.
 */
const deletedAt: (recordedAt: Date, retentionInDays: number) => Date = (
  recordedAt: Date,
  retentionInDays: number,
): Date => {
  return OneUptimeDate.addRemoveDays(recordedAt, retentionInDays);
};

// When the "losing entries" email is due for that entry: a day (24 hours) before it is deleted.
const losingNoticeAt: (recordedAt: Date, retentionInDays: number) => number = (
  recordedAt: Date,
  retentionInDays: number,
): number => {
  return deletedAt(recordedAt, retentionInDays).getTime() - 24 * HOUR;
};

describe("which email a failure is due", () => {
  // Recorded just before the failures began: the usual oldest unsent entry.
  const OLDEST: Date = at(-MINUTE);

  /*
   * The entry waiting is deleted `retentionInDays` (7 unless said) calendar
   * days after it was recorded, as the recorder stamps it; none waits for a
   * null `oldestUnsentAt`.
   */
  const notice: (data: {
    previousFailureAt: Date | null;
    now: Date;
    oldestUnsentAt?: Date | null | undefined;
    retentionInDays?: number | undefined;
  }) => AuditLogExportFailureNotice | null = (data: {
    previousFailureAt: Date | null;
    now: Date;
    oldestUnsentAt?: Date | null | undefined;
    retentionInDays?: number | undefined;
  }): AuditLogExportFailureNotice | null => {
    const oldest: Date | null =
      data.oldestUnsentAt === undefined ? OLDEST : data.oldestUnsentAt;

    return getAuditLogExportFailureNotice({
      failingSince: START,
      previousFailureAt: data.previousFailureAt,
      now: data.now,
      entriesLostAt: oldest
        ? deletedAt(oldest, data.retentionInDays || 7)
        : null,
    });
  };

  test("the first failure of a run is due none, however the clock reads", () => {
    expect(notice({ previousFailureAt: null, now: START })).toBeNull();
    expect(
      notice({
        previousFailureAt: null,
        now: START,
        oldestUnsentAt: at(-10 * DAY),
      }),
    ).toBeNull();
  });

  test("'failing' once 30 minutes pass between two tries, and never again in the run", () => {
    expect(AUDIT_LOG_EXPORT_FAILING_NOTICE_AFTER_IN_MINUTES).toBe(30);
    expect(
      notice({ previousFailureAt: at(15 * MINUTE), now: at(31 * MINUTE) }),
    ).toBe(AuditLogExportFailureNotice.Failing);
    expect(
      notice({ previousFailureAt: at(29 * MINUTE), now: at(30 * MINUTE) }),
    ).toBe(AuditLogExportFailureNotice.Failing);
    // Already past: the email went with the try that crossed it.
    expect(
      notice({ previousFailureAt: at(31 * MINUTE), now: at(63 * MINUTE) }),
    ).toBeNull();
    expect(
      notice({ previousFailureAt: at(MINUTE), now: at(29 * MINUTE) }),
    ).toBeNull();
  });

  test("'losing entries' a day before the oldest unsent entry is deleted, once", () => {
    const lostAt: Date = getAuditLogExportEntriesLostAt({
      oldestUnsentAt: OLDEST,
      retentionInDays: 7,
    });
    const losingAt: number = losingNoticeAt(OLDEST, 7);

    expect(AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS).toBe(24);
    // Deleted 7 calendar days after it was recorded, as the recorder stamps it.
    expect(lostAt.toISOString()).toBe(deletedAt(OLDEST, 7).toISOString());
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        entriesLostAt: lostAt,
      })!.getTime(),
    ).toBe(losingAt);
    expect(
      notice({
        previousFailureAt: new Date(losingAt - HOUR),
        now: new Date(losingAt),
      }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
    expect(
      notice({
        previousFailureAt: new Date(losingAt - HOUR),
        now: new Date(losingAt - 1),
      }),
    ).toBeNull();
    expect(
      notice({
        previousFailureAt: new Date(losingAt),
        now: new Date(losingAt + HOUR),
      }),
    ).toBeNull();
  });

  test("the moment follows the oldest unsent entry, not when the failures began: an export reading from the past is told sooner", () => {
    // Export From five and a half days back, failing from its first try.
    const oldest: Date = at(-5.5 * DAY);
    const losingAt: number = losingNoticeAt(oldest, 7);

    // Within the first day of the failures, not six days in.
    expect(losingAt).toBeLessThan(at(DAY).getTime());
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        entriesLostAt: deletedAt(oldest, 7),
      })!.toISOString(),
    ).toBe(new Date(losingAt).toISOString());
    expect(
      notice({
        previousFailureAt: at(15 * MINUTE),
        now: at(31 * MINUTE),
        oldestUnsentAt: oldest,
      }),
    ).toBe(AuditLogExportFailureNotice.Failing);
    expect(
      notice({
        previousFailureAt: new Date(losingAt - 30 * MINUTE),
        now: new Date(losingAt + 30 * MINUTE),
        oldestUnsentAt: oldest,
      }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
  });

  test("less than a day left: never sooner than 30 minutes, and then told as 'losing entries'", () => {
    // Deleted under five hours after the failures began.
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        entriesLostAt: deletedAt(at(-6.8 * DAY), 7),
      })!.toISOString(),
    ).toBe(at(30 * MINUTE).toISOString());

    // Or already passed (a stamp the table has not dropped yet): from the first email on, too.
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        entriesLostAt: at(-HOUR),
      })!.toISOString(),
    ).toBe(at(30 * MINUTE).toISOString());

    /*
     * A week's retention, the entry recorded six days and 22 hours before
     * the failures began: less than a day left when the first email can go,
     * however long the days in between are on the server's clock. Where the
     * last of them is Europe's 25-hour day, it can be more than a day, and
     * the first email says "failing" (AuditLogExportClockChanges.test.ts).
     */
    const kept: Date = at(-7 * DAY + 2 * HOUR);

    expect(losingNoticeAt(kept, 7)).toBeLessThan(at(30 * MINUTE).getTime());
    expect(
      notice({
        previousFailureAt: at(15 * MINUTE),
        now: at(31 * MINUTE),
        oldestUnsentAt: kept,
        retentionInDays: 7,
      }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
  });

  test("nothing waiting to be sent is never 'losing entries'", () => {
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        entriesLostAt: null,
      }),
    ).toBeNull();
    expect(
      notice({
        previousFailureAt: at(5 * MINUTE),
        now: at(8 * DAY),
        oldestUnsentAt: null,
      }),
    ).toBe(AuditLogExportFailureNotice.Failing);
    expect(
      notice({
        previousFailureAt: at(6.5 * DAY),
        now: at(8 * DAY),
        oldestUnsentAt: null,
      }),
    ).toBeNull();
  });

  test("both moments passed at once (the worker was down): only the more pressing email", () => {
    expect(
      notice({ previousFailureAt: at(5 * MINUTE), now: at(8 * DAY) }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
  });

  test("a try from before this run of failures does not count as its previous try", () => {
    expect(
      notice({ previousFailureAt: at(-2 * DAY), now: at(31 * MINUTE) }),
    ).toBe(AuditLogExportFailureNotice.Failing);
  });

  /*
   * The recorder's rule (Common/Types/AuditLog/AuditLogRetention). This
   * read -3 as 7 days and 0.5 as 1 while the recorder kept both a day (#6383);
   * now both read them as the week the recorder keeps, and
   * AuditLogExportClockChanges.test.ts holds the two to the same instant.
   */
  test("the retention is the one an entry is recorded with: 7 days for none, and from 7 to 180", () => {
    expect(AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS).toBe(7);

    for (const [value, days] of [
      [null, 7],
      [undefined, 7],
      [Number.NaN, 7],
      [0, 7],
      [-3, 7],
      [0.5, 7],
      [3, 7],
      [7, 7],
      [30, 30],
      [180, 180],
      [500, 180],
    ] as Array<[number, number]>) {
      expect({
        value,
        days: readAuditLogRetentionInDays(value),
        lostAt: getAuditLogExportEntriesLostAt({
          oldestUnsentAt: OLDEST,
          retentionInDays: value,
        }).toISOString(),
      }).toEqual({
        value,
        days,
        lostAt: deletedAt(OLDEST, days).toISOString(),
      });
    }
  });
});

/*
 * #6563: each entry is deleted on the retentionDate the recorder stamped on
 * it, from the retention its project had when it was recorded. The export
 * reckoned the moment from the retention as it is NOW, so a retention
 * lengthened from 7 days to 30 while entries waited - what someone whose
 * export fails may do to buy time - put "will start losing entries" 22
 * days after those entries were gone. The export now reads the soonest
 * stamp on the entries it has not sent, and reckons from today's retention
 * only when it cannot.
 */
describe("when entries are lost: the stamps on the entries waiting, not the retention as it is now", () => {
  // Recorded just before the failures began, with a 7-day retention.
  const OLDEST: Date = at(-MINUTE);
  const STAMPED_7: Date = deletedAt(OLDEST, 7);

  const noticeAt: (
    entriesLostAt: Date,
    previousFailureAt: number,
    now: number,
  ) => AuditLogExportFailureNotice | null = (
    entriesLostAt: Date,
    previousFailureAt: number,
    now: number,
  ): AuditLogExportFailureNotice | null => {
    return getAuditLogExportFailureNotice({
      failingSince: START,
      previousFailureAt: new Date(previousFailureAt),
      now: new Date(now),
      entriesLostAt,
    });
  };

  test("the soonest stamp is the moment, whatever the retention is now", () => {
    for (const retentionInDays of [7, 14, 30, 180, -3, 500, Number.NaN]) {
      expect({
        retentionInDays,
        lostAt: getAuditLogExportEntriesLostAt({
          oldestUnsentAt: OLDEST,
          retentionInDays,
          soonestRetentionDate: STAMPED_7,
        }).toISOString(),
      }).toEqual({ retentionInDays, lostAt: STAMPED_7.toISOString() });
    }
  });

  test("a stamp later than the oldest entry's reckoning is still the moment: a longer retention then, or a newer entry", () => {
    const stamped30: Date = deletedAt(OLDEST, 30);

    expect(
      getAuditLogExportEntriesLostAt({
        oldestUnsentAt: OLDEST,
        retentionInDays: 7,
        soonestRetentionDate: stamped30,
      }).toISOString(),
    ).toBe(stamped30.toISOString());
  });

  test("without a stamp (the audit log could not answer), it is reckoned as before: from the oldest entry waiting and the retention as it is now", () => {
    for (const soonestRetentionDate of [null, undefined]) {
      for (const retentionInDays of [7, 30]) {
        expect(
          getAuditLogExportEntriesLostAt({
            oldestUnsentAt: OLDEST,
            retentionInDays,
            soonestRetentionDate,
          }).toISOString(),
        ).toBe(deletedAt(OLDEST, retentionInDays).toISOString());
      }
    }
  });

  test("lengthened from 7 days to 30 while an entry waited: 'losing entries' 24 hours before its 7-day stamp, not 22 days after it is gone", () => {
    const lostAt: Date = getAuditLogExportEntriesLostAt({
      oldestUnsentAt: OLDEST,
      retentionInDays: 30,
      soonestRetentionDate: STAMPED_7,
    });
    const due: number = STAMPED_7.getTime() - 24 * HOUR;

    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        entriesLostAt: lostAt,
      })!.getTime(),
    ).toBe(due);
    expect(noticeAt(lostAt, due - HOUR, due)).toBe(
      AuditLogExportFailureNotice.LosingEntries,
    );
    expect(noticeAt(lostAt, due - HOUR, due - 1)).toBeNull();

    /*
     * What the retention as it is now would say: lost 23 calendar days after
     * the entry was deleted, and so told 22 days after it was gone. Calendar
     * days, as the recorder counts them: where the clocks go back between the
     * two (in the United States on 1 November 2026), those 23 days are an
     * hour longer, and the suite holds in whatever zone the machine runs in.
     */
    const reckonedLostAt: Date = getAuditLogExportEntriesLostAt({
      oldestUnsentAt: OLDEST,
      retentionInDays: 30,
    });
    const reckonedDue: number = getAuditLogExportLosingNoticeAt({
      failingSince: START,
      entriesLostAt: reckonedLostAt,
    })!.getTime();

    expect(reckonedLostAt.toISOString()).toBe(
      deletedAt(STAMPED_7, 23).toISOString(),
    );
    expect(reckonedDue).toBe(deletedAt(STAMPED_7, 23).getTime() - DAY);
    expect(
      Math.abs(reckonedDue - STAMPED_7.getTime() - 22 * DAY),
    ).toBeLessThanOrEqual(HOUR);
  });

  test("shortened from 30 days to 7 while an entry waited: 'losing entries' 24 hours before its 30-day stamp, not three weeks early", () => {
    const stamped30: Date = deletedAt(OLDEST, 30);
    const lostAt: Date = getAuditLogExportEntriesLostAt({
      oldestUnsentAt: OLDEST,
      retentionInDays: 7,
      soonestRetentionDate: stamped30,
    });
    const due: number = stamped30.getTime() - 24 * HOUR;
    // Where the week of the retention as it is now would have put it.
    const weekDue: number = losingNoticeAt(OLDEST, 7);

    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        entriesLostAt: lostAt,
      })!.getTime(),
    ).toBe(due);
    expect(noticeAt(lostAt, weekDue - HOUR, weekDue + HOUR)).toBeNull();
    expect(noticeAt(lostAt, due - HOUR, due)).toBe(
      AuditLogExportFailureNotice.LosingEntries,
    );
  });
});

describe("the email's words", () => {
  const base: Parameters<typeof buildAuditLogExportFailureEmail>[0] = {
    notice: AuditLogExportFailureNotice.Failing,
    exportName: "SIEM bucket",
    destinationTitle: "Amazon S3",
    isInstanceExport: false,
    failingSince: START,
    oldestUnsentAt: at(-2 * MINUTE),
    // Recorded with a week's retention, as the project keeps entries now.
    entriesLostAt: deletedAt(at(-2 * MINUTE), 7),
    // The try the email goes on: the entries waiting have a week left.
    now: START,
    error: "The bucket refused the key (HTTP 403, AccessDenied).",
    retentionInDays: 7,
  };

  // What the emails write a date as.
  const written: (date: Date) => string = (date: Date): string => {
    return OneUptimeDate.getDateAsUserFriendlyFormattedString(date);
  };

  const titles: (email: AuditLogExportFailureEmail) => Array<string> = (
    email: AuditLogExportFailureEmail,
  ): Array<string> => {
    return email.details.map((detail: { title: string }): string => {
      return detail.title;
    });
  };

  test("'failing': which export, where, since when, the oldest entry waiting, why - and that nothing is lost yet", () => {
    const email: AuditLogExportFailureEmail =
      buildAuditLogExportFailureEmail(base);

    expect(email.subject).toBe('The audit log export "SIEM bucket" is failing');
    expect(email.badgeType).toBe("warning");
    expect(email.badgeText).toBe("Export failing");
    expect(titles(email)).toEqual([
      "Export: ",
      "Destination: ",
      "Failing since: ",
      "Oldest entry not sent: ",
      "Why: ",
    ]);
    expect(email.details[0]!.text).toBe("SIEM bucket");
    expect(email.details[1]!.text).toBe("Amazon S3");
    expect(email.details[4]!.text).toBe(base.error);
    // What to do first, then why nothing is lost yet: until when.
    expect(email.remediation).toBe(
      `Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: the audit log starts deleting them from about ${written(base.entriesLostAt!)}.`,
    );
    expect(email.buttonText).toBe("Open Audit Log Export");
  });

  test("'failing' with nothing waiting: how long the audit log keeps an entry recorded from now on", () => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      oldestUnsentAt: null,
      entriesLostAt: null,
    });

    expect(titles(email)).toEqual([
      "Export: ",
      "Destination: ",
      "Failing since: ",
      "Why: ",
    ]);
    expect(email.remediation).toBe(
      "Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: the audit log keeps each entry for 7 days.",
    );
  });

  test("'losing entries': critical, from about when, and that fixing it before then sends them", () => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      notice: AuditLogExportFailureNotice.LosingEntries,
    });

    expect(email.subject).toBe(
      'The audit log export "SIEM bucket" will start losing entries',
    );
    expect(email.badgeType).toBe("critical");
    expect(email.badgeText).toBe("Entries about to be lost");
    expect(titles(email)).toEqual([
      "Export: ",
      "Destination: ",
      "Failing since: ",
      "Oldest entry not sent: ",
      "Entries lost from: ",
      "Why: ",
    ]);
    expect(email.details[4]!.text).toBe(
      `about ${written(base.entriesLostAt!)}`,
    );
    // From when first, then what to do before then.
    expect(
      email.remediation.startsWith(
        `From ${email.details[4]!.text}, the entries this export has not sent are deleted as they pass the audit log retention they were recorded with, and are never sent.`,
      ),
    ).toBe(true);
    expect(email.remediation).toContain(
      "Fix the destination before then, and the export sends them, oldest first.",
    );
    expect(email.remediation).not.toContain("Nothing is lost yet");
  });

  test("a longer retention is never offered as a way to keep the entries already waiting", () => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      notice: AuditLogExportFailureNotice.LosingEntries,
    });

    expect(email.remediation).toContain(
      "A longer retention (Project Settings > Audit Logs > Settings) only keeps the entries recorded after the change.",
    );
    expect(email.remediation).not.toMatch(/or keep entries longer/i);
  });

  test("'losing entries' with nothing waiting cannot say from when: it reads as 'failing'", () => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      notice: AuditLogExportFailureNotice.LosingEntries,
      oldestUnsentAt: null,
      entriesLostAt: null,
    });

    expect(email.subject).toBe('The audit log export "SIEM bucket" is failing');
    expect(titles(email)).toEqual([
      "Export: ",
      "Destination: ",
      "Failing since: ",
      "Why: ",
    ]);
  });

  test("the instance's export names the instance, when its entries waiting start to be deleted, and each project's retention", () => {
    const product: string = ProductBrandingText.getProductName();
    const failing: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail(
      { ...base, isInstanceExport: true },
    );
    const nothingWaiting: AuditLogExportFailureEmail =
      buildAuditLogExportFailureEmail({
        ...base,
        isInstanceExport: true,
        oldestUnsentAt: null,
        entriesLostAt: null,
      });
    const losing: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      isInstanceExport: true,
      notice: AuditLogExportFailureNotice.LosingEntries,
    });

    // An instance can have several exports: the subject names this one.
    expect(failing.subject).toBe(
      `The audit log export "SIEM bucket" of your ${product} instance is failing`,
    );
    expect(losing.subject).toBe(
      `The audit log export "SIEM bucket" of your ${product} instance will start losing entries`,
    );
    expect(failing.remediation).toContain(
      `Nothing is lost yet: the audit log starts deleting them from about ${written(base.entriesLostAt!)}.`,
    );
    expect(nothingWaiting.remediation).toContain(
      "Nothing is lost yet: entries stay in each project's audit log for as long as that project's retention.",
    );
    expect(losing.remediation).toContain(
      "are deleted as they pass the audit log retention they were recorded with, and are never sent.",
    );
    expect(losing.remediation).toContain(
      "A longer retention in a project's Settings > Audit Logs > Settings only keeps that project's entries recorded after the change.",
    );
  });

  test("with nothing waiting it says the days the audit log keeps an entry, as the recorder keeps it, and an export with no name still reads", () => {
    const nothingWaiting: Parameters<
      typeof buildAuditLogExportFailureEmail
    >[0] = { ...base, oldestUnsentAt: null, entriesLostAt: null };
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...nothingWaiting,
      exportName: "  ",
      retentionInDays: -3,
    });

    // Never "The audit log export audit log export is failing".
    expect(email.subject).toBe("An audit log export is failing");
    expect(email.details[0]).toEqual({
      title: "Export: ",
      text: "audit log export",
    });
    // A stored -3 keeps entries a week: never "1 day", never "-3 days".
    expect(email.remediation).toContain(
      "the audit log keeps each entry for 7 days.",
    );

    for (const [retentionInDays, days] of [
      [1, "7 days"],
      [0.5, "7 days"],
      [30, "30 days"],
      [500, "180 days"],
    ] as Array<[number, string]>) {
      expect(
        buildAuditLogExportFailureEmail({ ...nothingWaiting, retentionInDays })
          .remediation,
      ).toContain(`the audit log keeps each entry for ${days}.`);
    }

    const instance: AuditLogExportFailureEmail =
      buildAuditLogExportFailureEmail({
        ...base,
        exportName: "",
        isInstanceExport: true,
        notice: AuditLogExportFailureNotice.LosingEntries,
      });

    expect(instance.subject).toBe(
      `An audit log export of your ${ProductBrandingText.getProductName()} instance will start losing entries`,
    );
  });

  /*
   * #6563: the entries waiting keep the retention they were recorded with.
   * An email that said "the audit log's retention of 30 days" for entries
   * stamped with a week told someone who had just lengthened the retention
   * that they had a month.
   */
  test("the date is the entries' own stamp, never reckoned from the retention as it is now: a week's stamp in a project that keeps 30 days now", () => {
    const stamped: Date = deletedAt(base.oldestUnsentAt!, 7);
    const lengthened: Parameters<typeof buildAuditLogExportFailureEmail>[0] = {
      ...base,
      entriesLostAt: stamped,
      retentionInDays: 30,
    };

    const losing: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...lengthened,
      notice: AuditLogExportFailureNotice.LosingEntries,
    });
    const failing: AuditLogExportFailureEmail =
      buildAuditLogExportFailureEmail(lengthened);

    expect(losing.details).toContainEqual({
      title: "Entries lost from: ",
      text: `about ${written(stamped)}`,
    });
    expect(
      losing.remediation.startsWith(`From about ${written(stamped)},`),
    ).toBe(true);
    expect(failing.remediation).toContain(
      `the audit log starts deleting them from about ${written(stamped)}.`,
    );

    for (const email of [losing, failing]) {
      expect(email.remediation).not.toContain("30 days");
      expect(email.remediation).not.toContain(
        written(deletedAt(base.oldestUnsentAt!, 30)),
      );
    }
  });

  test("entries waiting are never said to be kept 'N days', in either email, for either export", () => {
    // Any number of days ends in a digit followed by " day" (linear to match).
    const DAYS_PATTERN: RegExp = /\d days?/;

    for (const notice of [
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]) {
      for (const isInstanceExport of [false, true]) {
        for (const retentionInDays of [7, 30, 180, -3]) {
          const email: AuditLogExportFailureEmail =
            buildAuditLogExportFailureEmail({
              ...base,
              notice,
              isInstanceExport,
              retentionInDays,
            });

          expect({
            notice,
            isInstanceExport,
            retentionInDays,
            says: DAYS_PATTERN.test(email.remediation),
            hasDate: email.remediation.includes(written(base.entriesLostAt!)),
          }).toEqual({
            notice,
            isInstanceExport,
            retentionInDays,
            says: false,
            hasDate: true,
          });
        }
      }
    }
  });

  test("never more rows than the template shows (six)", () => {
    for (const notice of [
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]) {
      expect(
        buildAuditLogExportFailureEmail({ ...base, notice }).details.length,
      ).toBeLessThanOrEqual(6);
    }
  });

  /*
   * #7185: the moment the first of the entries waiting is deleted can have
   * passed by the try the email goes on - the audit log drops a whole part
   * only once every entry in it is past its stamp, so the export can wait
   * to send an entry older than its retention (an Export From further back
   * than the retention, an export turned off for longer, a backlog). The
   * email said "will start losing entries" and "fix the destination before
   * then" for a date in the past. It now says entries are being lost, since
   * when, and to fix the destination now; a date still ahead keeps every
   * word it had.
   */
  describe("once the first entry's date has passed by the try", () => {
    const PROJECT_RETENTION: string =
      "A longer retention (Project Settings > Audit Logs > Settings) only keeps the entries recorded after the change.";
    const INSTANCE_RETENTION: string =
      "A longer retention in a project's Settings > Audit Logs > Settings only keeps that project's entries recorded after the change.";

    // The "losing entries" email for a first entry deleted `offsetInMs` from the try (START).
    const losing: (
      offsetInMs: number,
      overrides?: Partial<
        Parameters<typeof buildAuditLogExportFailureEmail>[0]
      >,
    ) => AuditLogExportFailureEmail = (
      offsetInMs: number,
      overrides: Partial<
        Parameters<typeof buildAuditLogExportFailureEmail>[0]
      > = {},
    ): AuditLogExportFailureEmail => {
      return buildAuditLogExportFailureEmail({
        ...base,
        notice: AuditLogExportFailureNotice.LosingEntries,
        // Recorded nine days back with a week's retention: the audit log has not dropped it yet.
        oldestUnsentAt: at(-9 * DAY),
        entriesLostAt: at(offsetInMs),
        now: START,
        ...overrides,
      });
    };

    // What the email for entries already being lost says, for a first entry deleted at `lostAt`.
    const beingLost: (data: {
      lostAt: Date;
      subject: string;
      retention: string;
    }) => AuditLogExportFailureEmail = (data: {
      lostAt: Date;
      subject: string;
      retention: string;
    }): AuditLogExportFailureEmail => {
      return {
        subject: data.subject,
        badgeType: "critical",
        badgeText: "Entries being lost",
        details: [
          { title: "Export: ", text: "SIEM bucket" },
          { title: "Destination: ", text: "Amazon S3" },
          { title: "Failing since: ", text: written(START) },
          { title: "Oldest entry not sent: ", text: written(at(-9 * DAY)) },
          {
            title: "Entries lost since: ",
            text: `about ${written(data.lostAt)}`,
          },
          { title: "Why: ", text: base.error },
        ],
        remediation: `Fix the destination now, and the export sends the entries the audit log still keeps, oldest first. Since about ${written(data.lostAt)}, the entries this export has not sent are being deleted as they pass the audit log retention they were recorded with, and are never sent. ${data.retention}`,
        buttonText: "Open Audit Log Export",
      };
    };

    test("a date still ahead keeps the 'will start losing entries' email word for word, even a second before the moment", () => {
      for (const offsetInMs of [1000, HOUR, 20 * HOUR, 3 * DAY]) {
        const lostAt: Date = at(offsetInMs);

        expect(losing(offsetInMs)).toEqual({
          subject:
            'The audit log export "SIEM bucket" will start losing entries',
          badgeType: "critical",
          badgeText: "Entries about to be lost",
          details: [
            { title: "Export: ", text: "SIEM bucket" },
            { title: "Destination: ", text: "Amazon S3" },
            { title: "Failing since: ", text: written(START) },
            {
              title: "Oldest entry not sent: ",
              text: written(at(-9 * DAY)),
            },
            { title: "Entries lost from: ", text: `about ${written(lostAt)}` },
            { title: "Why: ", text: base.error },
          ],
          remediation: `From about ${written(lostAt)}, the entries this export has not sent are deleted as they pass the audit log retention they were recorded with, and are never sent. Fix the destination before then, and the export sends them, oldest first. ${PROJECT_RETENTION}`,
          buttonText: "Open Audit Log Export",
        });
      }
    });

    test("passed: 'is losing entries', since about when, and to fix the destination now so the export sends the entries still kept", () => {
      for (const offsetInMs of [-1000, -HOUR, -2 * DAY, -23 * DAY]) {
        expect(losing(offsetInMs)).toEqual(
          beingLost({
            lostAt: at(offsetInMs),
            subject: 'The audit log export "SIEM bucket" is losing entries',
            retention: PROJECT_RETENTION,
          }),
        );
      }
    });

    test("at the moment itself, to the millisecond, the entries are being lost; a millisecond before, they are about to be", () => {
      const atTheMoment: AuditLogExportFailureEmail = losing(0);
      const justBefore: AuditLogExportFailureEmail = losing(1);

      expect(atTheMoment).toEqual(
        beingLost({
          lostAt: START,
          subject: 'The audit log export "SIEM bucket" is losing entries',
          retention: PROJECT_RETENTION,
        }),
      );
      expect(justBefore.subject).toBe(
        'The audit log export "SIEM bucket" will start losing entries',
      );
      expect(justBefore.badgeText).toBe("Entries about to be lost");
      expect(justBefore.details[4]!.title).toBe("Entries lost from: ");
      expect(
        justBefore.remediation.startsWith(`From about ${written(at(1))},`),
      ).toBe(true);
    });

    test("the instance's export: of your instance, is losing entries, and each project's longer retention", () => {
      const product: string = ProductBrandingText.getProductName();

      expect(losing(-2 * DAY, { isInstanceExport: true })).toEqual(
        beingLost({
          lostAt: at(-2 * DAY),
          subject: `The audit log export "SIEM bucket" of your ${product} instance is losing entries`,
          retention: INSTANCE_RETENTION,
        }),
      );
      expect(
        losing(-2 * DAY, { isInstanceExport: true, exportName: " " }).subject,
      ).toBe(
        `An audit log export of your ${product} instance is losing entries`,
      );
      expect(losing(-2 * DAY, { exportName: "" }).subject).toBe(
        "An audit log export is losing entries",
      );
      // Ahead, the instance's email keeps its words.
      expect(losing(2 * DAY, { isInstanceExport: true }).subject).toBe(
        `The audit log export "SIEM bucket" of your ${product} instance will start losing entries`,
      );
    });

    test("a 'failing' email for a date already passed never says nothing is lost yet: it is the 'losing entries' one", () => {
      for (const isInstanceExport of [false, true]) {
        for (const offsetInMs of [0, -MINUTE, -5 * DAY]) {
          expect(
            losing(offsetInMs, {
              notice: AuditLogExportFailureNotice.Failing,
              isInstanceExport,
            }),
          ).toEqual(losing(offsetInMs, { isInstanceExport }));
        }
      }

      // A date still ahead: the "failing" email, nothing lost yet.
      const ahead: AuditLogExportFailureEmail = losing(2 * DAY, {
        notice: AuditLogExportFailureNotice.Failing,
      });

      expect(ahead.subject).toBe(
        'The audit log export "SIEM bucket" is failing',
      );
      expect(ahead.badgeType).toBe("warning");
      expect(ahead.remediation).toContain(
        `Nothing is lost yet: the audit log starts deleting them from about ${written(at(2 * DAY))}.`,
      );
    });

    test("nothing waiting is never 'losing entries', however the clock reads", () => {
      const email: AuditLogExportFailureEmail = losing(0, {
        oldestUnsentAt: null,
        entriesLostAt: null,
        now: at(400 * DAY),
      });

      expect(email.subject).toBe(
        'The audit log export "SIEM bucket" is failing',
      );
      expect(email.badgeText).toBe("Export failing");
      expect(email.remediation).toBe(
        "Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: the audit log keeps each entry for 7 days.",
      );
    });

    test("the date is read against the try, not the clock the email is built on", () => {
      // A try far from today, either way: only `now` says whether the date has passed.
      const lostAt: Date = new Date("2099-03-01T08:00:00.000Z");

      expect(
        losing(0, {
          entriesLostAt: lostAt,
          now: new Date("2099-03-02T08:00:00.000Z"),
        }).subject,
      ).toBe('The audit log export "SIEM bucket" is losing entries');
      expect(
        losing(0, {
          entriesLostAt: new Date("2001-03-01T08:00:00.000Z"),
          now: new Date("2001-02-28T08:00:00.000Z"),
        }).subject,
      ).toBe('The audit log export "SIEM bucket" will start losing entries');
    });

    test("for a passed date, no email asks for anything before it, or says entries will start or are about to be lost", () => {
      const AHEAD_WORDS: Array<string> = [
        "before then",
        "will start",
        "about to be lost",
        "From about",
        "Nothing is lost yet",
        "Entries lost from",
      ];

      for (const notice of [
        AuditLogExportFailureNotice.Failing,
        AuditLogExportFailureNotice.LosingEntries,
      ]) {
        for (const isInstanceExport of [false, true]) {
          for (const offsetInMs of [0, -1, -DAY, -40 * DAY]) {
            const email: AuditLogExportFailureEmail = losing(offsetInMs, {
              notice,
              isInstanceExport,
            });
            const words: string = [
              email.subject,
              email.badgeText,
              ...email.details.map(
                (detail: { title: string; text: string }): string => {
                  return `${detail.title}${detail.text}`;
                },
              ),
              email.remediation,
            ].join("\n");

            expect({
              notice,
              isInstanceExport,
              offsetInMs,
              found: AHEAD_WORDS.filter((ahead: string): boolean => {
                return words.includes(ahead);
              }),
              asksNow: email.remediation.startsWith(
                "Fix the destination now, and the export sends the entries the audit log still keeps, oldest first.",
              ),
              rows: email.details.length,
            }).toEqual({
              notice,
              isInstanceExport,
              offsetInMs,
              found: [],
              asksNow: true,
              rows: 6,
            });
          }
        }
      }
    });
  });
});

/*
 * The retention as it is now: what the "failing" email says an entry
 * recorded from now on is kept for, and what the moment entries are lost is
 * reckoned from when the stamps on the entries waiting cannot be read.
 */
describe("the retention as it is now", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const exportOf: (projectId: string | null) => AuditLogExport = (
    projectId: string | null,
  ): AuditLogExport => {
    const item: AuditLogExport = new AuditLogExport();
    item.id = ObjectID.generate();
    if (projectId) {
      item.projectId = new ObjectID(projectId);
    }
    return item;
  };

  test("a project's export: its project's retention, else the default", async () => {
    const findOneById: jest.SpiedFunction<typeof ProjectService.findOneById> =
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValueOnce(
          Object.assign(new Project(), { auditLogsRetentionInDays: 30 }),
        )
        .mockResolvedValueOnce(new Project())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          Object.assign(new Project(), { auditLogsRetentionInDays: -3 }),
        )
        .mockResolvedValueOnce(
          Object.assign(new Project(), { auditLogsRetentionInDays: 500 }),
        );

    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(30);
    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(7);
    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(7);
    // Stored before the server checked: read as the recorder keeps them.
    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(7);
    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(180);
    expect(findOneById.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        select: { auditLogsRetentionInDays: true },
        props: { isRoot: true },
      }),
    );
    expect(String(findOneById.mock.calls[0]![0].id)).toBe(PROJECT_A);
  });

  test("the instance's export: the shortest of the projects that record an audit log", async () => {
    const findOneBy: jest.SpiedFunction<typeof ProjectService.findOneBy> = jest
      .spyOn(ProjectService, "findOneBy")
      .mockResolvedValueOnce(
        Object.assign(new Project(), { auditLogsRetentionInDays: 14 }),
      )
      .mockResolvedValueOnce(
        Object.assign(new Project(), { auditLogsRetentionInDays: -3 }),
      );

    await expect(
      getAuditLogExportRetentionInDays(exportOf(null)),
    ).resolves.toBe(14);
    /*
     * A stored -3 sorts first, and is the week the recorder keeps that
     * project's entries for: never a day, never -3.
     */
    await expect(
      getAuditLogExportRetentionInDays(exportOf(null)),
    ).resolves.toBe(7);
    expect(findOneBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { enableAuditLogs: true },
        sort: { auditLogsRetentionInDays: SortOrder.Ascending },
        props: { isRoot: true },
      }),
    );
  });

  test("a read that fails is reckoned with the default, never thrown", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database down"));
    jest
      .spyOn(ProjectService, "findOneBy")
      .mockRejectedValue(new Error("database down"));

    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(7);
    await expect(
      getAuditLogExportRetentionInDays(exportOf(null)),
    ).resolves.toBe(7);
  });
});

describe("who is emailed", () => {
  const notification: (
    projectId: string | null,
  ) => AuditLogExportFailureNotification = (
    projectId: string | null,
  ): AuditLogExportFailureNotification => {
    const item: AuditLogExport = new AuditLogExport();
    item.id = ObjectID.generate();
    item.name = "SIEM <bucket>";
    item.destinationType = AuditLogExportDestinationType.AmazonS3;
    if (projectId) {
      item.projectId = new ObjectID(projectId);
    }

    return {
      item,
      notice: AuditLogExportFailureNotice.Failing,
      failingSince: START,
      oldestUnsentAt: at(-MINUTE),
      entriesLostAt: deletedAt(at(-MINUTE), 7),
      now: START,
      error: "refused (HTTP 403)",
      retentionInDays: 7,
    };
  };

  const owner: (email: string | null) => User = (
    email: string | null,
  ): User => {
    const user: User = new User();
    user.id = ObjectID.generate();
    if (email) {
      user.email = new Email(email);
    }
    return user;
  };

  beforeEach(() => {
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({});
    mockSendToMasterAdmins.mockReset();
    mockSendToMasterAdmins.mockResolvedValue({});
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.acme.test/dashboard"),
      );
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(Object.assign(new Project(), { name: "Payments" }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a project's export: each owner with an address, from the project, with the export's page", async () => {
    const ada: User = owner("ada@example.com");
    const grace: User = owner("grace@example.com");
    jest
      .spyOn(ProjectService, "getOwners")
      .mockResolvedValue([ada, owner(null), grace]);

    await auditLogExportEmailNotifier.notifyFailure(notification(PROJECT_A));

    expect(mockSendToMasterAdmins).not.toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledTimes(2);

    const [message, options] = mockSendMail.mock.calls[0] as [
      {
        toEmail: Email;
        templateType: EmailTemplateType;
        subject: string;
        isSubjectLiteral: boolean;
        vars: Record<string, string>;
      },
      { projectId: ObjectID; userId: ObjectID },
    ];

    expect(message.toEmail.toString()).toBe("ada@example.com");
    expect(message.templateType).toBe(EmailTemplateType.AuditLogExportFailed);
    expect(message.subject).toBe(
      'The audit log export "SIEM <bucket>" is failing',
    );
    expect(message.isSubjectLiteral).toBe(true);
    expect(new globalThis.URL(message.vars["healthPageLink"]!).pathname).toBe(
      `/dashboard/${PROJECT_A}/settings/audit-logs/export`,
    );
    expect(message.vars["reasonText"]).toBe(
      "You are receiving this email because you are an owner of the project Payments, which exports its audit log.",
    );
    expect(message.vars["detail1Text"]).toBe("SIEM <bucket>");
    expect(message.vars["detail2Text"]).toBe("Amazon S3");
    expect(message.vars["detail5Title"]).toBe("Why: ");
    expect(message.vars["detail5Text"]).toBe("refused (HTTP 403)");
    expect(message.vars["badgeType"]).toBe("warning");
    // When the entries waiting start to be deleted: the date the notification carries.
    expect(message.vars["remediation"]).toBe(
      `Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: the audit log starts deleting them from about ${OneUptimeDate.getDateAsUserFriendlyFormattedString(
        deletedAt(at(-MINUTE), 7),
      )}.`,
    );
    expect(options.projectId.toString()).toBe(PROJECT_A);
    expect(options.userId.toString()).toBe(ada.id!.toString());

    const second: { toEmail: Email } = mockSendMail.mock.calls[1]![0] as {
      toEmail: Email;
    };

    expect(second.toEmail.toString()).toBe("grace@example.com");
  });

  test("the instance's export: every master admin, through the instance health sender, to Admin Dashboard > Settings", async () => {
    const getOwners: jest.SpiedFunction<typeof ProjectService.getOwners> =
      jest.spyOn(ProjectService, "getOwners");

    await auditLogExportEmailNotifier.notifyFailure({
      ...notification(null),
      notice: AuditLogExportFailureNotice.LosingEntries,
    });

    expect(getOwners).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockSendToMasterAdmins).toHaveBeenCalledTimes(1);

    const [sent] = mockSendToMasterAdmins.mock.calls[0] as [
      {
        templateType: EmailTemplateType;
        check: { subject: string; isCritical: boolean; badgeText: string };
        healthPageLink: string;
        healthPageButtonText: string;
      },
    ];

    expect(sent.templateType).toBe(EmailTemplateType.AuditLogExportFailed);
    expect(sent.check.subject).toBe(
      `The audit log export "SIEM <bucket>" of your ${ProductBrandingText.getProductName()} instance will start losing entries`,
    );
    expect(sent.check.isCritical).toBe(true);
    expect(sent.check.badgeText).toBe("Entries about to be lost");
    expect(sent.healthPageLink).toBe(
      "https://oneuptime.acme.test/admin/settings/audit-log-export",
    );
    expect(sent.healthPageButtonText).toBe("Open Audit Log Export");
  });

  test("an email that fails is logged, and the next owner is still told", async () => {
    jest
      .spyOn(ProjectService, "getOwners")
      .mockResolvedValue([
        owner("ada@example.com"),
        owner("grace@example.com"),
      ]);
    mockSendMail
      .mockRejectedValueOnce(new Error("SMTP down"))
      .mockResolvedValueOnce({});

    await expect(
      auditLogExportEmailNotifier.notifyFailure(notification(PROJECT_A)),
    ).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  test("owners that cannot be read never throw", async () => {
    jest
      .spyOn(ProjectService, "getOwners")
      .mockRejectedValue(new Error("database down"));

    await expect(
      auditLogExportEmailNotifier.notifyFailure(notification(PROJECT_A)),
    ).resolves.toBeUndefined();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test("master admins that cannot be emailed never throw", async () => {
    mockSendToMasterAdmins.mockRejectedValue(new Error("SMTP down"));

    await expect(
      auditLogExportEmailNotifier.notifyFailure(notification(null)),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  /*
   * #7185: the notification carries the try it is due on, and the email
   * reads whether the first entry's date has passed against it.
   */
  describe("a date that has passed by the try", () => {
    // Deleted two days before the try: the audit log has not dropped it yet.
    const LOST_AT: Date = at(-2 * DAY);

    const passed: (
      projectId: string | null,
    ) => AuditLogExportFailureNotification = (
      projectId: string | null,
    ): AuditLogExportFailureNotification => {
      return {
        ...notification(projectId),
        notice: AuditLogExportFailureNotice.LosingEntries,
        oldestUnsentAt: at(-9 * DAY),
        entriesLostAt: LOST_AT,
        now: at(31 * MINUTE),
      };
    };

    test("each owner is told the export is losing entries, since when, and to fix the destination now", async () => {
      jest
        .spyOn(ProjectService, "getOwners")
        .mockResolvedValue([owner("ada@example.com")]);

      await auditLogExportEmailNotifier.notifyFailure(passed(PROJECT_A));

      expect(mockSendMail).toHaveBeenCalledTimes(1);

      const [message] = mockSendMail.mock.calls[0] as [
        { subject: string; vars: Record<string, string> },
      ];

      expect(message.subject).toBe(
        'The audit log export "SIEM <bucket>" is losing entries',
      );
      expect(message.vars["subject"]).toBe(message.subject);
      expect(message.vars["badgeType"]).toBe("critical");
      expect(message.vars["badgeText"]).toBe("Entries being lost");
      expect(message.vars["detail5Title"]).toBe("Entries lost since: ");
      expect(message.vars["detail5Text"]).toBe(
        `about ${OneUptimeDate.getDateAsUserFriendlyFormattedString(LOST_AT)}`,
      );
      expect(message.vars["detail6Title"]).toBe("Why: ");
      expect(message.vars["remediation"]).toBe(
        `Fix the destination now, and the export sends the entries the audit log still keeps, oldest first. Since about ${OneUptimeDate.getDateAsUserFriendlyFormattedString(
          LOST_AT,
        )}, the entries this export has not sent are being deleted as they pass the audit log retention they were recorded with, and are never sent. A longer retention (Project Settings > Audit Logs > Settings) only keeps the entries recorded after the change.`,
      );
    });

    test("the instance's master admins are told the same, as a critical email", async () => {
      await auditLogExportEmailNotifier.notifyFailure(passed(null));

      const [sent] = mockSendToMasterAdmins.mock.calls[0] as [
        {
          check: {
            subject: string;
            isCritical: boolean;
            badgeText: string;
            details: Array<{ title: string; text: string }>;
            remediation: string;
          };
        },
      ];

      expect(sent.check.subject).toBe(
        `The audit log export "SIEM <bucket>" of your ${ProductBrandingText.getProductName()} instance is losing entries`,
      );
      expect(sent.check.isCritical).toBe(true);
      expect(sent.check.badgeText).toBe("Entries being lost");
      expect(sent.check.details).toContainEqual({
        title: "Entries lost since: ",
        text: `about ${OneUptimeDate.getDateAsUserFriendlyFormattedString(LOST_AT)}`,
      });
      expect(
        sent.check.remediation.startsWith("Fix the destination now,"),
      ).toBe(true);
      expect(sent.check.remediation).toContain(
        "A longer retention in a project's Settings > Audit Logs > Settings only keeps that project's entries recorded after the change.",
      );
    });

    test("the date is read against the notification's try, never the clock it is sent on", async () => {
      // Tries far from today, either way: only the notification's own time decides.
      await auditLogExportEmailNotifier.notifyFailure({
        ...passed(null),
        entriesLostAt: new Date("2099-03-01T08:00:00.000Z"),
        now: new Date("2099-03-02T08:00:00.000Z"),
      });
      await auditLogExportEmailNotifier.notifyFailure({
        ...passed(null),
        entriesLostAt: new Date("2001-03-01T08:00:00.000Z"),
        now: new Date("2001-02-28T08:00:00.000Z"),
      });

      const subjects: Array<string> = mockSendToMasterAdmins.mock.calls.map(
        (call: Array<unknown>): string => {
          return (call[0] as { check: { subject: string } }).check.subject;
        },
      );
      const product: string = ProductBrandingText.getProductName();

      expect(subjects).toEqual([
        `The audit log export "SIEM <bucket>" of your ${product} instance is losing entries`,
        `The audit log export "SIEM <bucket>" of your ${product} instance will start losing entries`,
      ]);
    });
  });
});

describe("the exporter tells people as its failures go on", () => {
  let auditLog: InMemoryAuditLog;
  let webhook: RecordingDestination;
  let clock: Date;
  let sent: Array<AuditLogExportFailureNotification & { at: Date }>;
  let retentionReads: number;
  let retentionInDays: number;
  let notifierFails: boolean;
  // Also hands each notification to the real email notifier, as production does.
  let emailForReal: boolean;

  const notifier: AuditLogExportNotifier = {
    getRetentionInDays: async (): Promise<number> => {
      retentionReads++;
      return retentionInDays;
    },
    notifyFailure: async (
      data: AuditLogExportFailureNotification,
    ): Promise<void> => {
      if (notifierFails) {
        throw new Error("could not send");
      }
      sent.push({ ...data, at: clock });

      if (emailForReal) {
        await auditLogExportEmailNotifier.notifyFailure(data);
      }
    },
  };

  const exporter: () => AuditLogExporter = (): AuditLogExporter => {
    return new AuditLogExporter({
      reader: auditLog.reader,
      lock: {
        acquire: async (): Promise<SemaphoreMutex | null> => {
          return {} as SemaphoreMutex;
        },
        keep: async (): Promise<boolean> => {
          return true;
        },
        release: async (): Promise<void> => {
          return undefined;
        },
      },
      now: (): Date => {
        return clock;
      },
      sleep: async (): Promise<void> => {
        return undefined;
      },
      notifier,
    });
  };

  const notices: () => Array<AuditLogExportFailureNotice> =
    (): Array<AuditLogExportFailureNotice> => {
      return sent.map(
        (
          data: AuditLogExportFailureNotification,
        ): AuditLogExportFailureNotice => {
          return data.notice;
        },
      );
    };

  /*
   * An entry recorded at `when` (whole seconds, as the audit log keeps
   * them), stamped as the recorder stamps it with the retention its project
   * had then (7 days unless said); its id.
   */
  const record: (
    when: Date,
    retention?: number | undefined,
    projectId?: string | undefined,
  ) => string = (
    when: Date,
    retention?: number | undefined,
    projectId?: string | undefined,
  ): string => {
    return String(
      auditLog.add({
        createdAt: when.toISOString(),
        retentionInDays: retention,
        projectId,
      })["_id"],
    );
  };

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);
    auditLog = createInMemoryAuditLog();
    webhook = new RecordingDestination();
    AuditLogExportDestinationRegistry.setDestination(
      AuditLogExportDestinationType.Webhook,
      webhook,
    );
    clock = START;
    sent = [];
    retentionReads = 0;
    retentionInDays = 7;
    notifierFails = false;
    emailForReal = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    AuditLogExportDestinationRegistry.reset();
    uninstallEnterpriseModule();
  });

  const webhookRow: (overrides?: Partial<StoredExport>) => StoredExport = (
    overrides: Partial<StoredExport> = {},
  ): StoredExport => {
    return newStoredExport({
      destinationType: AuditLogExportDestinationType.Webhook,
      config: { url: "https://93.184.216.34/audit" },
      projectId: PROJECT_A,
      name: "SIEM webhook",
      ...overrides,
    });
  };

  // An export that fails from START on, with one entry waiting: recorded at `oldest`.
  const failingExport: (oldest?: Date) => {
    row: StoredExport;
    exports: InMemoryExports;
  } = (
    oldest: Date = at(-5 * MINUTE),
  ): { row: StoredExport; exports: InMemoryExports } => {
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    record(oldest);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused the key (HTTP 401)", {
        retryable: false,
        status: 401,
      }),
    );
    return { row, exports };
  };

  // Runs the export at each try it asks for, while the next one is due by `until`.
  const runUntil: (
    exports: InMemoryExports,
    row: StoredExport,
    until: Date,
  ) => Promise<number> = async (
    exports: InMemoryExports,
    row: StoredExport,
    until: Date,
  ): Promise<number> => {
    let tries: number = 0;

    for (;;) {
      await exporter().exportAll();
      tries++;
      const next: Date | null = exports.get(row._id).nextAttemptAt;

      if (!next || next.getTime() > until.getTime()) {
        return tries;
      }

      clock = next;
    }
  };

  test("a failure that lasts: 'failing' once after 30 minutes, 'losing entries' once a day before the oldest unsent entry is deleted", async () => {
    const { row, exports } = failingExport();
    const oldest: Date = at(-5 * MINUTE);
    const losingAt: number = losingNoticeAt(oldest, 7);

    await runUntil(exports, row, at(29 * MINUTE));
    expect(sent).toEqual([]);
    // Nothing to ask about the retention before 30 minutes.
    expect(retentionReads).toBe(0);

    await runUntil(exports, row, new Date(losingAt - 2 * HOUR));
    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
    // The tries come at 0, 1, 3, 7, 15 and 31 minutes: the one at 31 crossed 30.
    expect(sent[0]!.at.toISOString()).toBe(at(31 * MINUTE).toISOString());
    expect(sent[0]!.failingSince.toISOString()).toBe(START.toISOString());
    expect(sent[0]!.error).toBe("refused the key (HTTP 401)");
    expect(sent[0]!.retentionInDays).toBe(7);
    expect(sent[0]!.oldestUnsentAt!.toISOString()).toBe(oldest.toISOString());
    expect(sent[0]!.item.id!.toString()).toBe(row._id);

    await runUntil(exports, row, at(7 * DAY + 6 * HOUR));
    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);

    // Told by the first try at or after the moment: tries are an hour apart by then.
    const toldAt: number = sent[1]!.at.getTime();

    expect(toldAt).toBeGreaterThanOrEqual(losingAt);
    expect(toldAt - losingAt).toBeLessThanOrEqual(HOUR);
  });

  test("a destination that fails once and works on the next try emails nobody", async () => {
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    record(at(-5 * MINUTE));
    webhook.failNext(
      1,
      new AuditLogExportDeliveryError("busy", { retryable: false }),
    );

    await exporter().exportAll();
    clock = exports.get(row._id).nextAttemptAt!;
    await exporter().exportAll();

    expect(webhook.batches).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(retentionReads).toBe(0);
  });

  test("after a success the next run of failures is told again", async () => {
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    record(at(-5 * MINUTE));
    webhook.failNext(
      7,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );

    // Seven failures (0 to 63 minutes), then the next try (at 123) delivers.
    await runUntil(exports, row, at(3 * HOUR));
    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
    expect(exports.get(row._id).failingSince).toBeNull();
    expect(webhook.batches).toHaveLength(1);

    // It breaks again later.
    const brokeAt: Date = at(5 * HOUR);
    clock = brokeAt;
    record(new Date(brokeAt.getTime() - 2 * MINUTE));
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused again", { retryable: false }),
    );
    await runUntil(exports, row, new Date(brokeAt.getTime() + 2 * HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.Failing,
    ]);
    expect(sent[1]!.failingSince.toISOString()).toBe(brokeAt.toISOString());
    expect(sent[1]!.error).toBe("refused again");
  });

  test("an entry with less than a day left is told as 'losing entries' from the first email on", async () => {
    /*
     * Exporting from a week back, its oldest entry recorded six days and
     * 22 hours before the failures: a week's retention leaves it less than
     * a day by the first email, however long the days in between are.
     */
    const row: StoredExport = webhookRow({
      startsAt: at(-7 * DAY),
      createdAt: START,
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    record(at(-7 * DAY + 2 * HOUR));
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused the key (HTTP 401)", {
        retryable: false,
        status: 401,
      }),
    );

    await runUntil(exports, row, at(3 * HOUR));

    expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
    // With the first email, at the try 31 minutes in.
    expect(sent[0]!.at.toISOString()).toBe(at(31 * MINUTE).toISOString());
  });

  /*
   * #6383: for a project storing -3 the recorder deleted entries after a
   * day while the export reckoned a week; the export's "losing entries" email
   * was due six days after they were gone. Both now keep and reckon the week.
   */
  test("a negative retention is reckoned as the week the recorder keeps: 'losing entries' a day before the oldest entry goes", async () => {
    retentionInDays = -3;
    const { row, exports } = failingExport();
    const oldest: Date = at(-5 * MINUTE);
    const losingAt: number = losingNoticeAt(oldest, 7);

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    // Well before the entry is deleted: a week after it was recorded.
    expect(sent[1]!.at.getTime()).toBeLessThan(deletedAt(oldest, 7).getTime());
  });

  test("an export reading from the past is told 'losing entries' a day before its oldest entry goes, not a week after it broke", async () => {
    const row: StoredExport = webhookRow({
      startsAt: at(-5.5 * DAY),
      createdAt: START,
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    const oldest: Date = at(-5.5 * DAY + HOUR);
    const losingAt: number = losingNoticeAt(oldest, 7);
    record(oldest);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );

    // Tries are an hour apart by then: the first one at or after the moment tells.
    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.oldestUnsentAt!.toISOString()).toBe(oldest.toISOString());
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    // Within the first day of the failures, not a week after it broke.
    expect(sent[1]!.at.getTime()).toBeLessThan(at(DAY).getTime());
  });

  test("a failure before any batch is read looks up the oldest unsent entry, only once an email can be due", async () => {
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    const oldest: Date = at(-5 * MINUTE);
    record(oldest);
    jest
      .spyOn(AuditLogExportService, "getSettings")
      .mockRejectedValue(
        new BadDataException("The destination's key could not be read."),
      );

    await runUntil(exports, row, at(29 * MINUTE));
    expect(auditLog.reads).toEqual([]);
    expect(auditLog.soonestReads).toEqual([]);

    await runUntil(exports, row, at(7 * DAY));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[0]!.oldestUnsentAt!.toISOString()).toBe(oldest.toISOString());
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(
      deletedAt(oldest, 7).toISOString(),
    );
    expect(
      auditLog.reads.every((read: { limit: number }): boolean => {
        return read.limit === 1;
      }),
    ).toBe(true);
    expect(webhook.attempts).toBe(0);
  });

  test("nothing waiting to be sent: told it fails, never that it loses entries", async () => {
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    jest
      .spyOn(AuditLogExportService, "getSettings")
      .mockRejectedValue(
        new BadDataException("The destination's key could not be read."),
      );

    await runUntil(exports, row, at(9 * DAY));

    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
    expect(sent[0]!.oldestUnsentAt).toBeNull();
    expect(sent[0]!.entriesLostAt).toBeNull();
    // No entry to lose, so no stamp to read.
    expect(auditLog.reads.length).toBeGreaterThan(0);
    expect(auditLog.soonestReads).toEqual([]);
  });

  test("an audit log that cannot be read either reckons from when the failures began", async () => {
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    jest
      .spyOn(AuditLogExportService, "getSettings")
      .mockRejectedValue(new BadDataException("unreadable"));
    jest
      .spyOn(auditLog.reader, "findEntriesForExport")
      .mockRejectedValue(new Error("ClickHouse is down"));

    await runUntil(exports, row, at(2 * HOUR));

    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
    expect(sent[0]!.oldestUnsentAt!.toISOString()).toBe(START.toISOString());
    // No stamp either (none it could read): reckoned from then, with the retention as it is now.
    expect(sent[0]!.entriesLostAt!.toISOString()).toBe(
      deletedAt(START, 7).toISOString(),
    );
  });

  /*
   * #6563, as the issue's acceptance reads: entries recorded with a 7-day
   * retention, then the retention changed to 30. Each entry keeps the
   * 7-day retentionDate it was stamped with, and the "losing entries" email
   * is due 24 hours before the first of them is deleted - not 22 days
   * after, as reckoning from the 30 days the project keeps entries now did.
   */
  test("a retention lengthened from 7 days to 30 while entries wait: 'losing entries' 24 hours before the first of them is deleted, by its own stamp", async () => {
    retentionInDays = 30;
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    const oldest: Date = at(-5 * MINUTE);
    const first: string = record(oldest, 7);
    record(at(-4 * MINUTE), 7);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused the key (HTTP 401)", {
        retryable: false,
        status: 401,
      }),
    );
    const stamped: Date = auditLog.stampOf(first);
    const losingAt: number = stamped.getTime() - 24 * HOUR;

    // The recorder's 7 calendar days, not the 30 the project keeps now.
    expect(stamped.toISOString()).toBe(deletedAt(oldest, 7).toISOString());

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    // Before the entry is deleted, and both emails say when it is.
    expect(sent[1]!.at.getTime()).toBeLessThan(stamped.getTime());
    expect(sent[0]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
    // The retention as it is now still travels with them, for the email's other words.
    expect(sent[1]!.retentionInDays).toBe(30);
    // Read from the export's own entries waiting, with each try.
    expect(auditLog.soonestReads.length).toBeGreaterThan(1);
    expect(
      auditLog.soonestReads.every(
        (read: { projectId: string | null }): boolean => {
          return read.projectId === PROJECT_A;
        },
      ),
    ).toBe(true);
  });

  test("a retention shortened from 30 days to 7 while entries wait: no 'losing entries' a week in, and one 24 hours before their 30-day stamp", async () => {
    retentionInDays = 7;
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    const oldest: Date = at(-5 * MINUTE);
    const first: string = record(oldest, 30);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );
    const stamped: Date = auditLog.stampOf(first);
    const losingAt: number = stamped.getTime() - 24 * HOUR;

    expect(stamped.toISOString()).toBe(deletedAt(oldest, 30).toISOString());

    // Where the 7 days the project keeps now would have put it: nothing yet.
    await runUntil(exports, row, new Date(losingNoticeAt(oldest, 7) + DAY));
    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
  });

  /*
   * The soonest stamp, not the oldest entry's: here the retention went from
   * 30 days to 7 and back to 30 while the export failed, so the newer entry
   * is deleted three weeks before the older one - and reckoning from the
   * oldest entry with the retention as it is now would have warned after
   * both were gone.
   */
  test("a newer entry stamped sooner than the oldest one: 'losing entries' 24 hours before the newer one is deleted", async () => {
    retentionInDays = 30;
    const row: StoredExport = webhookRow({
      startsAt: at(-3 * DAY),
      createdAt: START,
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    const older: Date = at(-2 * DAY);
    record(older, 30);
    const newer: string = record(at(-DAY), 7);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );
    const stamped: Date = auditLog.stampOf(newer);
    const losingAt: number = stamped.getTime() - 24 * HOUR;

    expect(stamped.getTime()).toBeLessThan(deletedAt(older, 30).getTime());

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    // The oldest entry waiting is still the older one; the first deleted is the newer.
    expect(sent[1]!.oldestUnsentAt!.toISOString()).toBe(older.toISOString());
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
  });

  /*
   * The instance's export waits for every project's entries: the first one
   * deleted can be another project's, newer, stamped with a shorter
   * retention than the shortest any project keeps now.
   */
  test("the instance's export: 'losing entries' 24 hours before the soonest stamp among every project's entries waiting", async () => {
    // The shortest retention of any project now: B was lengthened since its entry.
    retentionInDays = 30;
    const row: StoredExport = webhookRow({
      projectId: null,
      name: "Instance archive",
      startsAt: at(-3 * DAY),
      createdAt: START,
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    const older: Date = at(-2 * DAY);
    record(older, 30, PROJECT_A);
    const soonest: string = record(at(-DAY), 7, PROJECT_B);
    record(at(-12 * HOUR), 14, PROJECT_A);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );
    const stamped: Date = auditLog.stampOf(soonest);
    const losingAt: number = stamped.getTime() - 24 * HOUR;

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    expect(sent[1]!.oldestUnsentAt!.toISOString()).toBe(older.toISOString());
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
    // Every project's entries, not one project's.
    expect(auditLog.soonestReads.length).toBeGreaterThan(0);
    expect(
      auditLog.soonestReads.every(
        (read: { projectId: string | null }): boolean => {
          return read.projectId === null;
        },
      ),
    ).toBe(true);
  });

  test("stamps that cannot be read: reckoned as before, from the oldest entry waiting and the retention as it is now, and said in the log", async () => {
    retentionInDays = 7;
    const { row, exports } = failingExport();
    const oldest: Date = at(-5 * MINUTE);
    const losingAt: number = losingNoticeAt(oldest, 7);
    jest
      .spyOn(auditLog.reader, "findSoonestRetentionDateForExport")
      .mockRejectedValue(new Error("ClickHouse is down"));

    await runUntil(exports, row, new Date(losingAt + HOUR));

    // The retention has not changed: the same moment the stamps give.
    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(
      deletedAt(oldest, 7).toISOString(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "has not sent are deleted; reckoning from the retention as it is now.",
      ),
    );
  });

  test("stamps that cannot be read after the retention was lengthened: reckoned from the retention as it is now, as before", async () => {
    retentionInDays = 30;
    const { row, exports } = failingExport();
    const oldest: Date = at(-5 * MINUTE);
    jest
      .spyOn(auditLog.reader, "findSoonestRetentionDateForExport")
      .mockRejectedValue(new Error("ClickHouse is down"));

    await runUntil(exports, row, at(2 * HOUR));

    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
    expect(sent[0]!.entriesLostAt!.toISOString()).toBe(
      deletedAt(oldest, 30).toISOString(),
    );
  });

  test("a read that finds no stamp while a batch has just been read (the entry went meanwhile): reckoned as before, never left untold", async () => {
    retentionInDays = 7;
    const { row, exports } = failingExport();
    const oldest: Date = at(-5 * MINUTE);
    const losingAt: number = losingNoticeAt(oldest, 7);
    jest
      .spyOn(auditLog.reader, "findSoonestRetentionDateForExport")
      .mockResolvedValue(null);

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(
      deletedAt(oldest, 7).toISOString(),
    );
  });

  test("the stamps are read for the entries the export has not sent: from Export From, after its cursor, up to the try, and only once an email can be due", async () => {
    const delivered: Date = at(-30 * MINUTE);
    const deliveredId: string = record(delivered, 7);
    const waiting: string = record(at(-20 * MINUTE), 30);
    const row: StoredExport = webhookRow({
      startsAt: at(-DAY),
      cursorCreatedAt: delivered,
      cursorEntryId: deliveredId,
      exportedEntryCount: 1,
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );

    await runUntil(exports, row, at(29 * MINUTE));
    expect(auditLog.soonestReads).toEqual([]);

    await runUntil(exports, row, at(2 * HOUR));

    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
    // The delivered entry's sooner stamp is not the export's to lose.
    expect(sent[0]!.entriesLostAt!.toISOString()).toBe(
      auditLog.stampOf(waiting).toISOString(),
    );
    expect(auditLog.soonestReads[0]).toEqual({
      projectId: PROJECT_A,
      startsAt: at(-DAY),
      until: sent[0]!.at,
      after: { createdAt: delivered, id: deliveredId },
    });
  });

  /*
   * The issue's case as it unfolds: a week's retention, the export fails,
   * and a day in someone lengthens the retention to 30 days to buy time,
   * while recording goes on. The entries recorded before the change keep
   * their week; the ones recorded since are kept 30 days and wait behind
   * them. The first to be deleted is still the oldest, by its week.
   */
  test("a retention lengthened from 7 days to 30 a day into the failures, while recording goes on: 'losing entries' 24 hours before the first week-stamped entry is deleted", async () => {
    retentionInDays = 7;
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    const oldest: Date = at(-5 * MINUTE);
    const first: string = record(oldest, 7);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused the key (HTTP 401)", {
        retryable: false,
        status: 401,
      }),
    );

    await runUntil(exports, row, at(DAY));
    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);

    // From now on the project keeps 30 days, and an entry is recorded every hour.
    retentionInDays = 30;
    const lengthenedAt: Date = clock;
    const recordedSince: Array<string> = [];

    for (let hour: number = 0; hour < 48; hour++) {
      recordedSince.push(
        record(new Date(lengthenedAt.getTime() + hour * HOUR), 30),
      );
    }

    const stamped: Date = auditLog.stampOf(first);
    const losingAt: number = stamped.getTime() - 24 * HOUR;

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
    // The retention as it is now still travels with it, for the email's other words.
    expect(sent[1]!.retentionInDays).toBe(30);
    // The entries recorded since were waiting too, and every one of them goes later.
    expect(
      recordedSince.every((id: string): boolean => {
        return auditLog.stampOf(id).getTime() > stamped.getTime();
      }),
    ).toBe(true);
    // Reckoned from the 30 days the project keeps now, it was due three weeks after the entry was gone.
    expect(losingNoticeAt(oldest, 30) - stamped.getTime()).toBeGreaterThan(
      21 * DAY,
    );
  });

  /*
   * The stamps are read again with every try, the entries recorded since
   * the failures began among them. A retention shortened while the export
   * fails stamps the entries recorded from then on sooner than the ones
   * waiting from before, so the first entry to be deleted can be one
   * recorded after the first email: read only then, the stamps would have
   * put "losing entries" three weeks after it was gone.
   */
  test("a retention shortened from 30 days to 7 while the export fails: an entry recorded since is deleted first, and 'losing entries' comes 24 hours before its own stamp", async () => {
    retentionInDays = 30;
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    const oldest: Date = at(-5 * MINUTE);
    const first: string = record(oldest, 30);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );

    // The first email gives when the entry waiting then is deleted: 30 days on.
    await runUntil(exports, row, at(2 * DAY));
    expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
    expect(sent[0]!.entriesLostAt!.toISOString()).toBe(
      auditLog.stampOf(first).toISOString(),
    );

    // Two days in, the project keeps a week from now on, and recording goes on.
    retentionInDays = 7;
    const shortened: string = record(clock, 7);
    const stamped: Date = auditLog.stampOf(shortened);
    const losingAt: number = stamped.getTime() - 24 * HOUR;

    // The newer entry goes three weeks before the older one.
    expect(
      auditLog.stampOf(first).getTime() - stamped.getTime(),
    ).toBeGreaterThan(20 * DAY);

    await runUntil(exports, row, new Date(losingAt + HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
    expect(sent[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
    // The oldest entry waiting is still the first one; the first to be deleted is the newer.
    expect(sent[1]!.oldestUnsentAt!.toISOString()).toBe(oldest.toISOString());
    expect(sent[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
  });

  /*
   * ClickHouse drops a whole part of the audit log only once every entry in
   * it has passed its stamp (the table's ttl_only_drop_parts), so an entry
   * can outlive its retentionDate, and an export reading from far back
   * finds it waiting. It can go at any moment: "losing entries" goes with
   * the first email, 30 minutes in, from its own stamp, never one reckoned
   * later.
   */
  test("an entry waiting past its own stamp (the audit log has not dropped it yet): 'losing entries' with the first email, from that stamp", async () => {
    retentionInDays = 30;
    const row: StoredExport = webhookRow({
      startsAt: at(-10 * DAY),
      createdAt: START,
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    const expired: string = record(at(-9 * DAY), 7);
    record(at(-HOUR), 30);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );

    await runUntil(exports, row, at(3 * HOUR));

    expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
    expect(sent[0]!.at.toISOString()).toBe(at(31 * MINUTE).toISOString());
    expect(sent[0]!.entriesLostAt!.toISOString()).toBe(
      auditLog.stampOf(expired).toISOString(),
    );
    expect(sent[0]!.entriesLostAt!.getTime()).toBeLessThan(START.getTime());
    // The try's own time goes with it, so the email can say the date has passed (#7185).
    expect(sent[0]!.now.toISOString()).toBe(at(31 * MINUTE).toISOString());
  });

  /*
   * #7185, end to end: the exporter hands the email notifier the time of
   * the try the email is due on, and the email the people who can fix the
   * export get reads the first entry's date against it. Past it, "is losing
   * entries" and "fix the destination now"; ahead of it, "will start losing
   * entries" and "fix the destination before then", word for word as
   * before.
   */
  describe("the email the exporter sends, read against the try", () => {
    const written: (date: Date) => string = (date: Date): string => {
      return OneUptimeDate.getDateAsUserFriendlyFormattedString(date);
    };

    // What the owners were sent, in order.
    const mailed: () => Array<{
      subject: string;
      vars: Record<string, string>;
    }> = (): Array<{ subject: string; vars: Record<string, string> }> => {
      return mockSendMail.mock.calls.map(
        (
          call: Array<unknown>,
        ): {
          subject: string;
          vars: Record<string, string>;
        } => {
          return call[0] as { subject: string; vars: Record<string, string> };
        },
      );
    };

    const losingNow: (lostAt: Date) => string = (lostAt: Date): string => {
      return `Fix the destination now, and the export sends the entries the audit log still keeps, oldest first. Since about ${written(lostAt)}, the entries this export has not sent are being deleted as they pass the audit log retention they were recorded with, and are never sent. A longer retention (Project Settings > Audit Logs > Settings) only keeps the entries recorded after the change.`;
    };

    beforeEach(() => {
      emailForReal = true;
      mockSendMail.mockReset();
      mockSendMail.mockResolvedValue({});
      mockSendToMasterAdmins.mockReset();
      mockSendToMasterAdmins.mockResolvedValue({});
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.acme.test/dashboard"),
        );
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(Object.assign(new Project(), { name: "Payments" }));
      jest.spyOn(ProjectService, "getOwners").mockResolvedValue([
        Object.assign(new User(), {
          id: ObjectID.generate(),
          email: new Email("ada@example.com"),
        }),
      ]);
    });

    test("Export From further back than the retention: one email, 30 minutes in, that the export is losing entries since the first one's stamp", async () => {
      // Kept 30 days now; the entry waiting was recorded nine days ago with a week's.
      retentionInDays = 30;
      const row: StoredExport = webhookRow({
        startsAt: at(-30 * DAY),
        createdAt: START,
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      const expired: string = record(at(-9 * DAY), 7);
      record(at(-HOUR), 30);
      webhook.failNext(
        10_000,
        new AuditLogExportDeliveryError("refused the key (HTTP 401)", {
          retryable: false,
        }),
      );
      const stamp: Date = auditLog.stampOf(expired);

      await runUntil(exports, row, at(3 * DAY));

      expect(stamp.getTime()).toBeLessThan(START.getTime());
      expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
      expect(sent[0]!.now.toISOString()).toBe(at(31 * MINUTE).toISOString());
      expect(mailed()).toHaveLength(1);

      const email: { subject: string; vars: Record<string, string> } =
        mailed()[0]!;

      expect(email.subject).toBe(
        'The audit log export "SIEM webhook" is losing entries',
      );
      expect(email.vars["badgeType"]).toBe("critical");
      expect(email.vars["badgeText"]).toBe("Entries being lost");
      expect(email.vars["detail3Text"]).toBe(written(START));
      expect(email.vars["detail4Title"]).toBe("Oldest entry not sent: ");
      expect(email.vars["detail4Text"]).toBe(written(at(-9 * DAY)));
      expect(email.vars["detail5Title"]).toBe("Entries lost since: ");
      expect(email.vars["detail5Text"]).toBe(`about ${written(stamp)}`);
      expect(email.vars["detail6Text"]).toBe("refused the key (HTTP 401)");
      expect(email.vars["remediation"]).toBe(losingNow(stamp));
    });

    test("a backlog that fails again after a partial success: once it has failed 30 minutes, 'is losing entries' since the next entry's stamp", async () => {
      retentionInDays = 7;
      const row: StoredExport = webhookRow({
        startsAt: at(-20 * DAY),
        createdAt: START,
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      // A backlog of entries past their week, ClickHouse not having dropped them yet.
      record(at(-15 * DAY), 7);
      const next: string = record(at(-12 * DAY), 7);
      record(at(-10 * DAY), 7);

      // One entry a batch: the first delivery works, every one after it fails.
      const definition: ReturnType<
        typeof getAuditLogExportDestinationDefinition
      > = getAuditLogExportDestinationDefinition(
        AuditLogExportDestinationType.Webhook,
      )!;
      jest
        .spyOn(AuditLogExportSettingsUtil, "getDefinitionOrThrow")
        .mockReturnValue({ ...definition, maxEntriesPerBatch: 1 });
      let deliveries: number = 0;
      AuditLogExportDestinationRegistry.setDestination(
        AuditLogExportDestinationType.Webhook,
        {
          deliver: async (
            delivery: AuditLogExportDelivery,
          ): Promise<AuditLogExportDeliveryReceipt> => {
            deliveries++;
            if (deliveries > 1) {
              throw new AuditLogExportDeliveryError("rate limited", {
                retryable: false,
              });
            }
            return { location: `recorded://${delivery.batch.id}` };
          },
        },
      );
      const stamp: Date = auditLog.stampOf(next);

      await runUntil(exports, row, at(3 * HOUR));

      expect(exports.get(row._id).exportedEntryCount).toBe(1);
      expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
      expect(sent[0]!.entriesLostAt!.toISOString()).toBe(stamp.toISOString());
      expect(sent[0]!.now.toISOString()).toBe(sent[0]!.at.toISOString());
      expect(
        mailed().map((email: { subject: string }): string => {
          return email.subject;
        }),
      ).toEqual(['The audit log export "SIEM webhook" is losing entries']);
      expect(mailed()[0]!.vars["detail5Title"]).toBe("Entries lost since: ");
      expect(mailed()[0]!.vars["remediation"]).toBe(losingNow(stamp));
    });

    test("the instance's export: its master admins are told it is losing entries, since the soonest stamp among every project's entries", async () => {
      retentionInDays = 30;
      const row: StoredExport = webhookRow({
        projectId: null,
        name: "Instance archive",
        startsAt: at(-30 * DAY),
        createdAt: START,
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      record(at(-12 * DAY), 30, PROJECT_A);
      const soonest: string = record(at(-8 * DAY), 7, PROJECT_B);
      webhook.failNext(
        10_000,
        new AuditLogExportDeliveryError("refused", { retryable: false }),
      );
      const stamp: Date = auditLog.stampOf(soonest);

      await runUntil(exports, row, at(3 * HOUR));

      expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockSendToMasterAdmins).toHaveBeenCalledTimes(1);

      const [message] = mockSendToMasterAdmins.mock.calls[0] as [
        {
          check: {
            subject: string;
            isCritical: boolean;
            badgeText: string;
            details: Array<{ title: string; text: string }>;
            remediation: string;
          };
        },
      ];

      expect(message.check.subject).toBe(
        `The audit log export "Instance archive" of your ${ProductBrandingText.getProductName()} instance is losing entries`,
      );
      expect(message.check.isCritical).toBe(true);
      expect(message.check.badgeText).toBe("Entries being lost");
      expect(message.check.details).toContainEqual({
        title: "Entries lost since: ",
        text: `about ${written(stamp)}`,
      });
      expect(message.check.remediation).toBe(
        `Fix the destination now, and the export sends the entries the audit log still keeps, oldest first. Since about ${written(stamp)}, the entries this export has not sent are being deleted as they pass the audit log retention they were recorded with, and are never sent. A longer retention in a project's Settings > Audit Logs > Settings only keeps that project's entries recorded after the change.`,
      );
    });

    test("a date still ahead: 'is failing' after 30 minutes, then 'will start losing entries' a day before, word for word as before", async () => {
      const oldest: Date = at(-5 * MINUTE);
      const { row, exports } = failingExport(oldest);
      const lostAt: Date = deletedAt(oldest, 7);

      await runUntil(exports, row, new Date(losingNoticeAt(oldest, 7) + HOUR));

      expect(notices()).toEqual([
        AuditLogExportFailureNotice.Failing,
        AuditLogExportFailureNotice.LosingEntries,
      ]);

      for (const notification of sent) {
        expect(notification.now.toISOString()).toBe(
          notification.at.toISOString(),
        );
        expect(notification.entriesLostAt!.getTime()).toBeGreaterThan(
          notification.now.getTime(),
        );
      }

      const [failing, losing] = mailed();

      expect(failing!.subject).toBe(
        'The audit log export "SIEM webhook" is failing',
      );
      expect(failing!.vars["remediation"]).toBe(
        `Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: the audit log starts deleting them from about ${written(lostAt)}.`,
      );
      expect(losing!.subject).toBe(
        'The audit log export "SIEM webhook" will start losing entries',
      );
      expect(losing!.vars["badgeText"]).toBe("Entries about to be lost");
      expect(losing!.vars["detail5Title"]).toBe("Entries lost from: ");
      expect(losing!.vars["detail5Text"]).toBe(`about ${written(lostAt)}`);
      expect(losing!.vars["remediation"]).toBe(
        `From about ${written(lostAt)}, the entries this export has not sent are deleted as they pass the audit log retention they were recorded with, and are never sent. Fix the destination before then, and the export sends them, oldest first. A longer retention (Project Settings > Audit Logs > Settings) only keeps the entries recorded after the change.`,
      );
    });

    test("turned off for longer than the retention, then on while its destination fails: one email, 30 minutes in, that it is losing entries since the first unsent one's stamp", async () => {
      // It sent up to an entry 12 days old, then sat turned off; the project keeps a week.
      const sentEntry: string = record(at(-12 * DAY), 7);
      const firstUnsent: string = record(at(-11 * DAY), 7);
      record(at(-HOUR), 7);
      const row: StoredExport = webhookRow({
        startsAt: at(-20 * DAY),
        createdAt: at(-20 * DAY),
        cursorCreatedAt: at(-12 * DAY),
        cursorEntryId: sentEntry,
        exportedEntryCount: 40,
        lastExportedAt: at(-12 * DAY),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      webhook.failNext(
        10_000,
        new AuditLogExportDeliveryError("refused the key (HTTP 401)", {
          retryable: false,
        }),
      );
      const stamp: Date = auditLog.stampOf(firstUnsent);

      await runUntil(exports, row, at(2 * DAY));

      expect(stamp.getTime()).toBeLessThan(START.getTime());
      expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
      expect(sent[0]!.at.toISOString()).toBe(at(31 * MINUTE).toISOString());
      expect(sent[0]!.now.toISOString()).toBe(sent[0]!.at.toISOString());
      expect(mailed()).toHaveLength(1);

      const email: { subject: string; vars: Record<string, string> } =
        mailed()[0]!;

      expect(email.subject).toBe(
        'The audit log export "SIEM webhook" is losing entries',
      );
      expect(email.vars["badgeText"]).toBe("Entries being lost");
      // The first entry it has not sent, not the one it sent before it was turned off.
      expect(email.vars["detail4Text"]).toBe(written(at(-11 * DAY)));
      expect(email.vars["detail5Title"]).toBe("Entries lost since: ");
      expect(email.vars["detail5Text"]).toBe(`about ${written(stamp)}`);
      expect(email.vars["remediation"]).toBe(losingNow(stamp));
    });

    test("the worker was down past the date: 'is failing' with the date ahead, then, at the first try after it, 'is losing entries' since that same date", async () => {
      const oldest: Date = at(-5 * MINUTE);
      const { row, exports } = failingExport(oldest);
      const lostAt: Date = deletedAt(oldest, 7);

      // The first email, while the date is a week ahead.
      await runUntil(exports, row, at(DAY));
      expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);

      // Nothing runs again until two days after the date; the entry is still kept.
      clock = new Date(lostAt.getTime() + 2 * DAY);
      await exporter().exportAll();

      expect(notices()).toEqual([
        AuditLogExportFailureNotice.Failing,
        AuditLogExportFailureNotice.LosingEntries,
      ]);
      expect(sent[1]!.now.toISOString()).toBe(clock.toISOString());
      expect(sent[1]!.entriesLostAt!.toISOString()).toBe(lostAt.toISOString());

      const [failing, lost] = mailed();

      expect(failing!.vars["remediation"]).toBe(
        `Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: the audit log starts deleting them from about ${written(lostAt)}.`,
      );
      // The second email names the same date, now as passed: never "before then".
      expect(lost!.subject).toBe(
        'The audit log export "SIEM webhook" is losing entries',
      );
      expect(lost!.vars["badgeText"]).toBe("Entries being lost");
      expect(lost!.vars["detail5Title"]).toBe("Entries lost since: ");
      expect(lost!.vars["detail5Text"]).toBe(`about ${written(lostAt)}`);
      expect(lost!.vars["remediation"]).toBe(losingNow(lostAt));
    });
  });

  test("a failure after a delivery in the same run starts a new run of failures", async () => {
    const row: StoredExport = webhookRow({
      failingSince: at(-2 * DAY),
      consecutiveFailureCount: 5,
      lastAttemptAt: at(-30 * MINUTE),
      lastError: "refused",
      nextAttemptAt: at(-MINUTE),
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    record(at(-10 * MINUTE));
    const second: Date = at(-9 * MINUTE);
    record(second);

    // One entry a batch: the first delivery works, the second fails.
    const definition: ReturnType<
      typeof getAuditLogExportDestinationDefinition
    > = getAuditLogExportDestinationDefinition(
      AuditLogExportDestinationType.Webhook,
    )!;
    jest
      .spyOn(AuditLogExportSettingsUtil, "getDefinitionOrThrow")
      .mockReturnValue({ ...definition, maxEntriesPerBatch: 1 });

    let deliveries: number = 0;
    const flaky: AuditLogExportDestination = {
      deliver: async (
        delivery: AuditLogExportDelivery,
      ): Promise<AuditLogExportDeliveryReceipt> => {
        deliveries++;
        if (deliveries === 2) {
          throw new AuditLogExportDeliveryError("rate limited", {
            retryable: false,
          });
        }
        return { location: `recorded://${delivery.batch.id}` };
      },
    };
    AuditLogExportDestinationRegistry.setDestination(
      AuditLogExportDestinationType.Webhook,
      flaky,
    );

    await exporter().exportAll();

    const stored: StoredExport = exports.get(row._id);

    expect(deliveries).toBe(2);
    expect(stored.exportedEntryCount).toBe(1);
    expect(stored.failingSince!.toISOString()).toBe(START.toISOString());
    expect(stored.consecutiveFailureCount).toBe(1);
    expect(stored.nextAttemptAt!.toISOString()).toBe(at(MINUTE).toISOString());
    expect(stored.lastError).toBe("rate limited");
    expect(sent).toEqual([]);
  });

  test("an email that cannot be sent never stops the export or its bookkeeping", async () => {
    notifierFails = true;
    const { row, exports } = failingExport();

    await expect(runUntil(exports, row, at(2 * HOUR))).resolves.toBeGreaterThan(
      3,
    );

    const stored: StoredExport = exports.get(row._id);

    expect(stored.lastError).toBe("refused the key (HTTP 401)");
    expect(stored.consecutiveFailureCount).toBeGreaterThan(3);
    expect(stored.failingSince!.toISOString()).toBe(START.toISOString());
    expect(logger.error).toHaveBeenCalled();
  });
});
