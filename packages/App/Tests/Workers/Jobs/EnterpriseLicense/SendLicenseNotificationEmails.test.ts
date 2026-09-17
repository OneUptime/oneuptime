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

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
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

import "../../../../FeatureSet/Workers/Jobs/EnterpriseLicense/SendLicenseNotificationEmails";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import OneUptimeDate from "Common/Types/Date";
import EnterpriseLicenseUserCountSource from "Common/Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";

const JOB_NAME: string = "EnterpriseLicense:SendLicenseNotificationEmails";
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
