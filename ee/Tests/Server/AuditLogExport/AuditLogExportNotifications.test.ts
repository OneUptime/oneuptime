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
  AUDIT_LOG_EXPORT_DEFAULT_RETENTION_IN_DAYS,
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
  toAuditLogExportRetentionInDays,
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
import { getAuditLogExportDestinationDefinition } from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { PROJECT_A } from "./AuditLogExportTestData";
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
 *   - a day before the oldest unsent entry is deleted (never sooner than
 *     the first email; never while nothing waits): "will start losing
 *     entries", from when, and that fixing it before then sends them - a
 *     longer retention keeps only entries recorded after the change, so it
 *     is not offered as a way to keep these;
 *   - each once per run of failures, without anything stored for it: the
 *     email is due when its moment passes between two tries;
 *   - a project's export emails the project's owners; the instance's, every
 *     master admin; sending never stops the export.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const START: Date = new Date("2026-10-24T12:00:00.000Z");

const at: (offsetInMs: number) => Date = (offsetInMs: number): Date => {
  return new Date(START.getTime() + offsetInMs);
};

describe("which email a failure is due", () => {
  // Recorded just before the failures began: the usual oldest unsent entry.
  const OLDEST: Date = at(-MINUTE);

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
    return getAuditLogExportFailureNotice({
      failingSince: START,
      previousFailureAt: data.previousFailureAt,
      now: data.now,
      oldestUnsentAt:
        data.oldestUnsentAt === undefined ? OLDEST : data.oldestUnsentAt,
      retentionInDays: data.retentionInDays || 7,
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
    const losingAt: number =
      lostAt.getTime() - AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS * HOUR;

    expect(AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS).toBe(24);
    expect(lostAt.toISOString()).toBe(
      new Date(OLDEST.getTime() + 7 * DAY).toISOString(),
    );
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        oldestUnsentAt: OLDEST,
        retentionInDays: 7,
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

    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        oldestUnsentAt: oldest,
        retentionInDays: 7,
      })!.toISOString(),
    ).toBe(at(12 * HOUR).toISOString());
    expect(
      notice({
        previousFailureAt: at(15 * MINUTE),
        now: at(31 * MINUTE),
        oldestUnsentAt: oldest,
      }),
    ).toBe(AuditLogExportFailureNotice.Failing);
    expect(
      notice({
        previousFailureAt: at(11.5 * HOUR),
        now: at(12.5 * HOUR),
        oldestUnsentAt: oldest,
      }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
  });

  test("less than a day left: never sooner than 30 minutes, and then told as 'losing entries'", () => {
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        oldestUnsentAt: at(-6.8 * DAY),
        retentionInDays: 7,
      })!.toISOString(),
    ).toBe(at(30 * MINUTE).toISOString());
    expect(
      notice({
        previousFailureAt: at(15 * MINUTE),
        now: at(31 * MINUTE),
        retentionInDays: 1,
      }),
    ).toBe(AuditLogExportFailureNotice.LosingEntries);
  });

  test("nothing waiting to be sent is never 'losing entries'", () => {
    expect(
      getAuditLogExportLosingNoticeAt({
        failingSince: START,
        oldestUnsentAt: null,
        retentionInDays: 7,
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

  test("the retention is the one an entry is recorded with: 7 days for none, 1 to 180", () => {
    expect(AUDIT_LOG_EXPORT_DEFAULT_RETENTION_IN_DAYS).toBe(7);
    for (const unreadable of [0, -3, Number.NaN, null, undefined]) {
      expect(toAuditLogExportRetentionInDays(unreadable)).toBe(7);
    }
    expect(toAuditLogExportRetentionInDays(30)).toBe(30);
    expect(toAuditLogExportRetentionInDays(500)).toBe(180);
    expect(toAuditLogExportRetentionInDays(0.5)).toBe(1);
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
    error: "The bucket refused the key (HTTP 403, AccessDenied).",
    retentionInDays: 7,
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

    expect(email.subject).toBe("The audit log export SIEM bucket is failing");
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
    expect(email.remediation).toContain("Nothing is lost yet");
    expect(email.remediation).toContain(
      "(the audit log's retention of 7 days)",
    );
    expect(email.buttonText).toBe("Open Audit Log Export");
  });

  test("'losing entries': critical, from about when, and that fixing it before then sends them", () => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      notice: AuditLogExportFailureNotice.LosingEntries,
    });

    expect(email.subject).toBe(
      "The audit log export SIEM bucket will start losing entries",
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
    expect(email.details[4]!.text.startsWith("about ")).toBe(true);
    expect(email.remediation).toContain("are then never sent");
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
      "A longer retention under Project Settings > Audit Logs > Settings keeps the entries recorded from then on for longer; it does not change when the ones already recorded are deleted.",
    );
    expect(email.remediation).not.toMatch(/or keep entries longer/i);
  });

  test("'losing entries' with nothing waiting cannot say from when: it reads as 'failing'", () => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      notice: AuditLogExportFailureNotice.LosingEntries,
      oldestUnsentAt: null,
    });

    expect(email.subject).toBe("The audit log export SIEM bucket is failing");
    expect(titles(email)).toEqual([
      "Export: ",
      "Destination: ",
      "Failing since: ",
      "Why: ",
    ]);
  });

  test("the instance's export names the instance and each project's retention", () => {
    const product: string = ProductBrandingText.getProductName();
    const failing: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail(
      { ...base, isInstanceExport: true },
    );
    const losing: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      isInstanceExport: true,
      notice: AuditLogExportFailureNotice.LosingEntries,
    });

    expect(failing.subject).toBe(
      `The audit log export of your ${product} instance is failing`,
    );
    expect(losing.subject).toBe(
      `The audit log export of your ${product} instance will start losing entries`,
    );
    expect(failing.remediation).toContain(
      "(each project's audit log retention)",
    );
    expect(losing.remediation).toContain(
      "A longer retention in a project's Settings > Audit Logs > Settings keeps that project's entries recorded from then on for longer",
    );
  });

  test("one day reads as one day, and an export with no name still reads", () => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      ...base,
      exportName: "  ",
      retentionInDays: 1,
    });

    expect(email.subject).toBe(
      "The audit log export audit log export is failing",
    );
    expect(email.remediation).toContain("the audit log's retention of 1 day)");
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
});

describe("the retention that decides when entries are lost", () => {
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
        .mockResolvedValueOnce(null);

    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(30);
    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(7);
    await expect(
      getAuditLogExportRetentionInDays(exportOf(PROJECT_A)),
    ).resolves.toBe(7);
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
      .mockResolvedValue(
        Object.assign(new Project(), { auditLogsRetentionInDays: 3 }),
      );

    await expect(
      getAuditLogExportRetentionInDays(exportOf(null)),
    ).resolves.toBe(3);
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
      "The audit log export SIEM <bucket> is failing",
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
      `The audit log export of your ${ProductBrandingText.getProductName()} instance will start losing entries`,
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
});

describe("the exporter tells people as its failures go on", () => {
  let auditLog: InMemoryAuditLog;
  let webhook: RecordingDestination;
  let clock: Date;
  let sent: Array<AuditLogExportFailureNotification & { at: Date }>;
  let retentionReads: number;
  let retentionInDays: number;
  let notifierFails: boolean;

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

  // An entry recorded at `when` (whole seconds, as the audit log keeps them); its id.
  const record: (when: Date) => string = (when: Date): string => {
    return String(auditLog.add({ createdAt: when.toISOString() })["_id"]);
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

  const failingExport: () => {
    row: StoredExport;
    exports: InMemoryExports;
  } = (): { row: StoredExport; exports: InMemoryExports } => {
    const row: StoredExport = webhookRow();
    const exports: InMemoryExports = useInMemoryExports([row]);
    record(at(-5 * MINUTE));
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
    const losingAt: number = oldest.getTime() + 6 * DAY;

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

  test("a short retention is told as 'losing entries' from the first email on", async () => {
    retentionInDays = 1;
    const { row, exports } = failingExport();

    await runUntil(exports, row, at(3 * HOUR));

    expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
  });

  test("an export reading from the past is told 'losing entries' a day before its oldest entry goes, not a week after it broke", async () => {
    const row: StoredExport = webhookRow({
      startsAt: at(-5.5 * DAY),
      createdAt: START,
    });
    const exports: InMemoryExports = useInMemoryExports([row]);
    const oldest: Date = at(-5.5 * DAY + HOUR);
    record(oldest);
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError("refused", { retryable: false }),
    );

    await runUntil(exports, row, at(14 * HOUR));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[1]!.oldestUnsentAt!.toISOString()).toBe(oldest.toISOString());
    expect(sent[1]!.at.getTime()).toBeGreaterThanOrEqual(
      oldest.getTime() + 6 * DAY,
    );
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

    await runUntil(exports, row, at(7 * DAY));

    expect(notices()).toEqual([
      AuditLogExportFailureNotice.Failing,
      AuditLogExportFailureNotice.LosingEntries,
    ]);
    expect(sent[0]!.oldestUnsentAt!.toISOString()).toBe(oldest.toISOString());
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
