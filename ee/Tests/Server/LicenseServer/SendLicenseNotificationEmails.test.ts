import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type CronHandler = () => Promise<void>;

interface CapturedJob {
  handler: CronHandler;
}

type AsyncMockFunction = (...args: Array<unknown>) => Promise<unknown>;

const mockCapturedJobs: Record<string, CapturedJob> = {};
const mockEnterpriseLicenseService: {
  findBy: ReturnType<typeof jest.fn<AsyncMockFunction>>;
} = {
  findBy: jest.fn<AsyncMockFunction>(),
};
const mockEnterpriseLicenseInstanceService: {
  findBy: ReturnType<typeof jest.fn<AsyncMockFunction>>;
} = {
  findBy: jest.fn<AsyncMockFunction>(),
};
const mockGlobalConfigService: {
  findOneById: ReturnType<typeof jest.fn<AsyncMockFunction>>;
} = {
  findOneById: jest.fn<AsyncMockFunction>(),
};
const mockMailService: {
  sendMail: ReturnType<typeof jest.fn<AsyncMockFunction>>;
} = {
  sendMail: jest.fn<AsyncMockFunction>(),
};

jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        _options: Record<string, unknown>,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { handler: runFunction };
      },
    ),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    IsBillingEnabled: true,
    IsDevelopment: false,
  };
});

jest.mock("Common/Server/Services/EnterpriseLicenseService", () => {
  return {
    __esModule: true,
    default: mockEnterpriseLicenseService,
  };
});

jest.mock("Common/Server/Services/EnterpriseLicenseInstanceService", () => {
  return {
    __esModule: true,
    default: mockEnterpriseLicenseInstanceService,
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: mockGlobalConfigService,
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: mockMailService,
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import "../../../Server/LicenseServer/Jobs/SendLicenseNotificationEmails";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import OneUptimeDate from "Common/Types/Date";
import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import EnterpriseLicenseUserCountSource from "Common/Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import EnterpriseLicenseUsageUtil from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import fs from "fs";
import path from "path";

const JOB_NAME: string = "EnterpriseLicense:SendLicenseNotificationEmails";
const EXPIRY_REMINDER_TEMPLATE: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
  "FeatureSet",
  "Notification",
  "Templates",
  "EnterpriseLicenseExpiryReminder.hbs",
);
const NOW: Date = new Date("2026-09-02T12:00:00.000Z");

const runTick: CronHandler = async (): Promise<void> => {
  const job: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

  if (!job) {
    throw new Error(`${JOB_NAME} did not register a cron handler.`);
  }

  await job.handler();
};

interface MakeLicenseData {
  currentUserCount: number;
  userLimit: number;
  userCountUpdatedAt?: Date | undefined;
  userCountSource?: EnterpriseLicenseUserCountSource | undefined;
  legacyUserCount?: number | undefined;
  legacyUserCountUpdatedAt?: Date | undefined;
  expiresAt?: Date | undefined;
}

const makeLicense: (data: MakeLicenseData) => EnterpriseLicense = (
  data: MakeLicenseData,
): EnterpriseLicense => {
  return {
    id: {
      toString: (): string => {
        return "license-id";
      },
    },
    companyName: "Acme Inc",
    licenseKey: "abcd-license-wxyz",
    currentUserCount: data.currentUserCount,
    userLimit: data.userLimit,
    userCountUpdatedAt: data.userCountUpdatedAt,
    userCountSource: data.userCountSource,
    legacyUserCount: data.legacyUserCount,
    legacyUserCountUpdatedAt: data.legacyUserCountUpdatedAt,
    expiresAt: data.expiresAt,
  } as unknown as EnterpriseLicense;
};

interface MakeInstanceData {
  createdAt?: Date | undefined;
  lastReportedAt?: Date | undefined;
  userCount?: number | undefined;
}

const makeInstance: (data: MakeInstanceData) => EnterpriseLicenseInstance = (
  data: MakeInstanceData,
): EnterpriseLicenseInstance => {
  return {
    createdAt: data.createdAt || OneUptimeDate.addRemoveDays(NOW, -1),
    lastReportedAt: data.lastReportedAt,
    userCount: data.userCount,
    masterAdminEmails: ["admin@acme.com"],
  } as unknown as EnterpriseLicenseInstance;
};

describe("EnterpriseLicense:SendLicenseNotificationEmails usage source", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    mockGlobalConfigService.findOneById.mockResolvedValue({});
    mockMailService.sendMail.mockResolvedValue({
      isSuccess: (): boolean => {
        return true;
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("preserves an over-limit legacy count when the only row is a registration without usage", async () => {
    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({ currentUserCount: 12, userLimit: 10 }),
    ]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({}),
    ]);

    await runTick();

    expect(mockMailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mockMailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateType: EmailTemplateType.EnterpriseLicenseUserLimitBreach,
        vars: expect.objectContaining({
          currentUserCount: "12",
          userLimit: "10",
          usersOverLimit: "2",
        }),
      }),
    );
  });

  test("uses instance aggregation after an instance has submitted usage", async () => {
    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({ currentUserCount: 50, userLimit: 10 }),
    ]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({
        lastReportedAt: OneUptimeDate.addRemoveDays(NOW, -1),
        userCount: 12,
      }),
    ]);

    await runTick();

    expect(mockMailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mockMailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateType: EmailTemplateType.EnterpriseLicenseUserLimitBreach,
        vars: expect.objectContaining({
          currentUserCount: "12",
          userLimit: "10",
          usersOverLimit: "2",
        }),
      }),
    );
  });

  test("uses a fresh legacy heartbeat after every modern instance becomes stale", async () => {
    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({
        currentUserCount: 12,
        userLimit: 10,
        userCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -7),
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
        legacyUserCount: 12,
        legacyUserCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -1),
      }),
    ]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({
        lastReportedAt: OneUptimeDate.addRemoveDays(NOW, -7),
        userCount: 50,
      }),
    ]);

    await runTick();

    expect(mockMailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateType: EmailTemplateType.EnterpriseLicenseUserLimitBreach,
        vars: expect.objectContaining({
          currentUserCount: "12",
          usersOverLimit: "2",
        }),
      }),
    );
  });

  test("does not bill an inactive modern aggregate because a different instance just registered", async () => {
    const inactiveAt: Date = OneUptimeDate.addRemoveDays(NOW, -7);

    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({
        currentUserCount: 12,
        userLimit: 10,
        userCountUpdatedAt: inactiveAt,
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      }),
    ]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({ lastReportedAt: inactiveAt, userCount: 12 }),
      makeInstance({ createdAt: OneUptimeDate.addRemoveDays(NOW, -1) }),
    ]);

    await runTick();

    expect(mockMailService.sendMail).not.toHaveBeenCalled();
  });

  test("drops stale legacy usage at the exact one-week boundary", async () => {
    const inactiveAt: Date = OneUptimeDate.addRemoveDays(NOW, -7);

    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({
        currentUserCount: 12,
        userLimit: 10,
        userCountUpdatedAt: inactiveAt,
      }),
    ]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({ createdAt: inactiveAt }),
    ]);

    await runTick();

    expect(mockMailService.sendMail).not.toHaveBeenCalled();
    expect(mockEnterpriseLicenseService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ userCountUpdatedAt: true }),
      }),
    );
  });

  test("evaluates each license after earlier notification sends have completed", async () => {
    const beforeBoundary: Date = new Date("2026-09-02T11:59:59.000Z");
    const afterBoundary: Date = new Date("2026-09-02T12:00:01.000Z");
    let currentTime: Date = beforeBoundary;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return currentTime;
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({ currentUserCount: 12, userLimit: 10 }),
      makeLicense({
        currentUserCount: 12,
        userLimit: 10,
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      }),
    ]);
    mockEnterpriseLicenseInstanceService.findBy
      .mockResolvedValueOnce([
        makeInstance({
          lastReportedAt: OneUptimeDate.addRemoveDays(beforeBoundary, -1),
          userCount: 12,
        }),
      ])
      .mockResolvedValueOnce([
        makeInstance({
          lastReportedAt: new Date("2026-08-26T12:00:00.000Z"),
          userCount: 12,
        }),
      ]);
    mockMailService.sendMail.mockImplementation(
      async (): Promise<{ isSuccess: () => boolean }> => {
        /* The first license's serial email send crosses the next boundary. */
        currentTime = afterBoundary;
        return {
          isSuccess: (): boolean => {
            return true;
          },
        };
      },
    );

    await runTick();

    expect(mockMailService.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("EnterpriseLicense:SendLicenseNotificationEmails expiry reminder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    mockGlobalConfigService.findOneById.mockResolvedValue({});
    mockMailService.sendMail.mockResolvedValue({
      isSuccess: (): boolean => {
        return true;
      },
    });
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({}),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const sendExpiryReminderFor: (
    expiresAt: Date,
  ) => Promise<Record<string, unknown>> = async (
    expiresAt: Date,
  ): Promise<Record<string, unknown>> => {
    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({ currentUserCount: 1, userLimit: 10, expiresAt }),
    ]);

    await runTick();

    const call: Array<unknown> | undefined =
      mockMailService.sendMail.mock.calls.find((args: Array<unknown>) => {
        return (
          (args[0] as { templateType: EmailTemplateType }).templateType ===
          EmailTemplateType.EnterpriseLicenseExpiryReminder
        );
      });

    expect(call).toBeDefined();

    return call![0] as Record<string, unknown>;
  };

  test("an expiring license: the instances keep running; SCIM and audit logging stop after the 30-day grace period, and single sign-on too on 14.0.10 and earlier", async () => {
    const sent: Record<string, unknown> = await sendExpiryReminderFor(
      OneUptimeDate.addRemoveDays(NOW, 10),
    );
    const message: string = (sent["vars"] as Record<string, string>)[
      "expiryStatusMessage"
    ]!;

    expect(sent["subject"]).toBe(
      "[Reminder] OneUptime Enterprise license for Acme Inc expires in 10 days",
    );
    expect(message).not.toContain("to keep your self-hosted OneUptime");
    expect(message).toContain(
      "Your self-hosted OneUptime instances keep running either way",
    );
    expect(message).toContain(
      "SCIM provisioning and audit logging stop and enterprise configuration becomes read-only when the 30-day grace period after the expiry ends",
    );
    expect(message).toContain(
      "On OneUptime 14.0.10 and earlier, single sign-on (SSO) stops then too.",
    );
    expect(message).not.toContain(
      "single sign-on, SCIM provisioning and audit logging",
    );
  });

  test("an expired license inside its grace period: says when the features stop", async () => {
    const sent: Record<string, unknown> = await sendExpiryReminderFor(
      OneUptimeDate.addRemoveDays(NOW, -5),
    );
    const vars: Record<string, string> = sent["vars"] as Record<string, string>;

    expect(sent["subject"]).toBe(
      "[Action Required] OneUptime Enterprise license for Acme Inc has expired",
    );
    expect(vars["expiryStatus"]).toBe("Expired 5 days ago");
    expect(vars["expiryStatusMessage"]).not.toContain(
      "to keep your self-hosted OneUptime",
    );
    expect(vars["expiryStatusMessage"]).toContain(
      "every enterprise feature stays on until its 30-day grace period ends on",
    );
    expect(vars["expiryStatusMessage"]).toContain(
      "when the grace period ends, SCIM provisioning and audit logging stop",
    );
    expect(vars["expiryStatusMessage"]).toContain(
      "On OneUptime 14.0.10 and earlier, single sign-on (SSO) stops then too.",
    );
  });

  test("an expired license past its grace period: says the features have stopped", async () => {
    const sent: Record<string, unknown> = await sendExpiryReminderFor(
      new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000),
    );
    const message: string = (sent["vars"] as Record<string, string>)[
      "expiryStatusMessage"
    ]!;

    expect(message).toContain(
      "SCIM provisioning and audit logging have stopped and enterprise configuration is read-only",
    );
    expect(message).toContain(
      "On OneUptime 14.0.10 and earlier, single sign-on (SSO) has stopped too.",
    );
    expect(message).not.toContain(
      "single sign-on, SCIM provisioning and audit logging",
    );
  });

  /*
   * The template reads these variables by name. A rename on either side
   * sends an email with a blank title or status line, and nothing else would
   * notice.
   */
  test("the reminder sets every variable the email template reads", async () => {
    const sent: Record<string, unknown> = await sendExpiryReminderFor(
      OneUptimeDate.addRemoveDays(NOW, 10),
    );
    const vars: Record<string, string> = sent["vars"] as Record<string, string>;
    const template: string = fs.readFileSync(EXPIRY_REMINDER_TEMPLATE, "utf8");

    // `text=companyName` (a partial's parameter) and `{{companyName}}`.
    const referenced: Array<string> = [
      ...Array.from(
        template.matchAll(/\b[a-zA-Z]+=([a-zA-Z]+)\b/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
      ...Array.from(
        template.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ].sort();

    expect(referenced).toEqual([
      "companyName",
      "emailTitle",
      "expiresAt",
      "expiryStatus",
      "expiryStatusMessage",
      "licenseKey",
    ]);

    for (const name of referenced) {
      expect({ name, set: (vars[name] || "").length > 0 }).toEqual({
        name,
        set: true,
      });
    }
  });

  /*
   * The "the features have stopped" message is only true once the grace
   * period has ended, so the expired-email window has to outlast the grace
   * period: a cutoff equal to it would send that message for an hour or two
   * and then go quiet.
   */
  test("the expired-email window outlasts the grace period, so the email that says the features stopped is actually sent", async () => {
    expect(
      EnterpriseLicenseUsageUtil.expiredNotificationCutoffDays,
    ).toBeGreaterThan(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS);

    const sent: Record<string, unknown> = await sendExpiryReminderFor(
      OneUptimeDate.addRemoveDays(
        NOW,
        -(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS + 7),
      ),
    );

    expect(
      (sent["vars"] as Record<string, string>)["expiryStatusMessage"],
    ).toContain(
      "SCIM provisioning and audit logging have stopped and enterprise configuration is read-only",
    );
  });

  test("an abandoned license stops being emailed once the window is over", async () => {
    mockEnterpriseLicenseService.findBy.mockResolvedValue([
      makeLicense({
        currentUserCount: 1,
        userLimit: 10,
        expiresAt: OneUptimeDate.addRemoveDays(
          NOW,
          -(EnterpriseLicenseUsageUtil.expiredNotificationCutoffDays + 1),
        ),
      }),
    ]);

    await runTick();

    expect(
      mockMailService.sendMail.mock.calls.find((args: Array<unknown>) => {
        return (
          (args[0] as { templateType: EmailTemplateType }).templateType ===
          EmailTemplateType.EnterpriseLicenseExpiryReminder
        );
      }),
    ).toBeUndefined();
  });
});
