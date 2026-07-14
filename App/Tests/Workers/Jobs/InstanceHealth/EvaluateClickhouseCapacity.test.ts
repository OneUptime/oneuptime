import InstanceHealthLog, {
  InstanceHealthLogStatus,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import User from "Common/Models/DatabaseModels/User";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import {
  buildClickhousePruningPlan,
  ClickhouseDiskSnapshot,
  ClickhousePartitionCandidate,
  ClickhousePruningPlan,
  dropClickhousePartition,
  getClickhousePartitionReclaimState,
  getClickhousePrunablePartitions,
} from "Common/Server/Utils/AnalyticsDatabase/ClickhouseCapacity";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/AnalyticsDatabase/ClickhouseCapacity", () => {
  return {
    __esModule: true,
    buildClickhousePruningPlan: jest.fn(),
    dropClickhousePartition: jest.fn(),
    getClickhouseDiskSnapshots: jest.fn(),
    getClickhousePartitionReclaimState: jest.fn(),
    getClickhousePrunablePartitions: jest.fn(),
    getMaxClickhouseDiskUtilization: jest.fn(),
  };
});

import {
  ClickhouseCapacitySettings,
  evaluateNotification,
  evaluatePruning,
} from "../../../../FeatureSet/Workers/Jobs/InstanceHealth/EvaluateClickhouseCapacity";

const now: Date = new Date("2026-07-13T12:00:00.000Z");
const later: Date = new Date("2026-07-13T12:10:00.000Z");

const disk: ClickhouseDiskSnapshot = {
  shardNum: 1,
  host: "clickhouse-1",
  diskName: "default",
  path: "/var/lib/clickhouse/",
  freeInBytes: 15,
  unreservedInBytes: 15,
  totalInBytes: 100,
  usedInBytes: 85,
  utilizationPercent: 85,
};

const settings: ClickhouseCapacitySettings = {
  notificationEnabled: true,
  notificationThresholdPercent: 80,
  pruningEnabled: true,
  pruningThresholdPercent: 90,
  pruningTargetPercent: 80,
};

function makeLog(data: {
  status: InstanceHealthLogStatus;
  nextCheckAt?: Date | undefined;
  metadata?: InstanceHealthLog["metadata"];
}): InstanceHealthLog {
  const log: InstanceHealthLog = new InstanceHealthLog();
  log.id = new ObjectID("capacity-log");
  log.status = data.status;
  if (data.nextCheckAt) {
    log.nextCheckAt = data.nextCheckAt;
  }
  if (data.metadata) {
    log.metadata = data.metadata;
  }
  return log;
}

const getCandidatesMock: jest.MockedFunction<
  typeof getClickhousePrunablePartitions
> = getClickhousePrunablePartitions as jest.MockedFunction<
  typeof getClickhousePrunablePartitions
>;
const buildPlanMock: jest.MockedFunction<typeof buildClickhousePruningPlan> =
  buildClickhousePruningPlan as jest.MockedFunction<
    typeof buildClickhousePruningPlan
  >;
const dropPartitionMock: jest.MockedFunction<typeof dropClickhousePartition> =
  dropClickhousePartition as jest.MockedFunction<
    typeof dropClickhousePartition
  >;
const reclaimStateMock: jest.MockedFunction<
  typeof getClickhousePartitionReclaimState
> = getClickhousePartitionReclaimState as jest.MockedFunction<
  typeof getClickhousePartitionReclaimState
>;

describe("EvaluateClickhouseCapacity", () => {
  beforeEach(() => {
    getCandidatesMock.mockReset();
    buildPlanMock.mockReset();
    dropPartitionMock.mockReset();
    reclaimStateMock.mockReset();
    reclaimStateMock.mockResolvedValue({
      inactivePartCount: 0,
      inactiveBytes: 0,
    });
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
    jest.spyOn(OneUptimeDate, "getSomeMinutesAfter").mockReturnValue(later);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("persists a crossing before emailing eligible master admins", async () => {
    const admin: User = new User();
    admin.id = new ObjectID("master-admin");
    admin.email = new Email("admin@example.com");

    const createSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<InstanceHealthLog>,
        ): Promise<InstanceHealthLog> => {
          createBy.data.id = new ObjectID("notification-log");
          return createBy.data;
        },
      );
    const userSpy: jest.SpyInstance = jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([admin] as never);
    const mailSpy: jest.SpyInstance = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue({
        isSuccess: (): boolean => {
          return true;
        },
      } as never);
    jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await evaluateNotification({
      settings,
      latestLog: null,
      capacityPercent: 85,
      worstDisk: disk,
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
      InstanceHealthLogStatus.Running,
    );
    expect(userSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          isMasterAdmin: true,
          isDisabled: false,
          isBlocked: false,
        },
        select: {
          _id: true,
          email: true,
        },
      }),
    );
    expect(mailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        templateType: EmailTemplateType.SimpleMessage,
      }),
      expect.objectContaining({
        userId: admin.id,
      }),
    );
    expect(createSpy.mock.invocationCallOrder[0]).toBeLessThan(
      mailSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("does not send a duplicate while a notification is active", async () => {
    const createSpy: jest.SpyInstance = jest.spyOn(
      InstanceHealthLogService,
      "create",
    );
    const userSpy: jest.SpyInstance = jest.spyOn(UserService, "findBy");
    const mailSpy: jest.SpyInstance = jest.spyOn(MailService, "sendMail");

    await evaluateNotification({
      settings,
      latestLog: makeLog({
        status: InstanceHealthLogStatus.NotificationActive,
      }),
      capacityPercent: 85,
      worstDisk: disk,
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(userSpy).not.toHaveBeenCalled();
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("continues pruning from the trigger down to the target", async () => {
    const candidate: ClickhousePartitionCandidate = {
      tableName: "LogLocal",
      partitionId: "20260701",
      partition: "20260701",
      totalSizeInBytes: 10,
      locations: [
        {
          shardNum: 1,
          host: disk.host,
          diskName: disk.diskName,
          sizeInBytes: 10,
        },
      ],
    };
    const plan: ClickhousePruningPlan = {
      partitions: [
        {
          tableName: candidate.tableName,
          partitionId: candidate.partitionId,
          estimatedFreedBytes: 10,
        },
      ],
      estimatedFreedBytes: 10,
      projectedMaxUtilizationPercent: 75,
      targetReachable: true,
    };
    getCandidatesMock.mockResolvedValue([candidate]);
    buildPlanMock.mockReturnValue(plan);
    dropPartitionMock.mockResolvedValue(undefined);

    const updateSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const createSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<InstanceHealthLog>,
        ): Promise<InstanceHealthLog> => {
          createBy.data.id = new ObjectID("running-log");
          return createBy.data;
        },
      );

    await evaluatePruning({
      settings,
      latestLog: makeLog({
        status: InstanceHealthLogStatus.WaitingForReclaim,
        nextCheckAt: new Date("2026-07-13T11:59:00.000Z"),
        metadata: {
          droppedPartitions: [
            {
              tableName: "LogLocal",
              partitionId: "20260630",
              estimatedFreedBytes: 10,
            },
          ],
        },
      }),
      disks: [disk],
      capacityPercent: 85,
      worstDisk: disk,
    });

    expect(updateSpy.mock.calls[0]?.[0].data.status).toBe(
      InstanceHealthLogStatus.Partial,
    );
    expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
      InstanceHealthLogStatus.Running,
    );
    expect(buildPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPercent: 80,
        maxPartitions: 25,
      }),
    );
    expect(dropPartitionMock).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[1]?.[0].data.status).toBe(
      InstanceHealthLogStatus.WaitingForReclaim,
    );
  });

  test("does not advance while prior inactive parts still occupy disk", async () => {
    reclaimStateMock.mockResolvedValue({
      inactivePartCount: 2,
      inactiveBytes: 40,
    });
    const updateSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await evaluatePruning({
      settings,
      latestLog: makeLog({
        status: InstanceHealthLogStatus.WaitingForReclaim,
        nextCheckAt: new Date("2026-07-13T11:59:00.000Z"),
        metadata: {
          droppedPartitions: [
            {
              tableName: "LogLocal",
              partitionId: "20260630",
              estimatedFreedBytes: 40,
            },
          ],
        },
      }),
      disks: [{ ...disk, utilizationPercent: 95, usedInBytes: 95 }],
      capacityPercent: 95,
      worstDisk: { ...disk, utilizationPercent: 95, usedInBytes: 95 },
    });

    expect(reclaimStateMock).toHaveBeenCalledWith([
      {
        tableName: "LogLocal",
        partitionId: "20260630",
        estimatedFreedBytes: 40,
      },
    ]);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: InstanceHealthLogStatus.WaitingForReclaim,
          nextCheckAt: later,
          metadata: expect.objectContaining({
            remainingInactivePartCount: 2,
            remainingInactiveBytes: 40,
          }),
        }),
      }),
    );
    expect(getCandidatesMock).not.toHaveBeenCalled();
    expect(buildPlanMock).not.toHaveBeenCalled();
    expect(dropPartitionMock).not.toHaveBeenCalled();
  });

  test("finalizes a stale partial cycle once capacity reaches the target", async () => {
    const updateSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await evaluatePruning({
      settings,
      latestLog: makeLog({
        status: InstanceHealthLogStatus.Partial,
      }),
      disks: [disk],
      capacityPercent: 75,
      worstDisk: disk,
    });

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: InstanceHealthLogStatus.Succeeded,
          capacityAfterPercent: 75,
        }),
      }),
    );
    expect(getCandidatesMock).not.toHaveBeenCalled();
    expect(dropPartitionMock).not.toHaveBeenCalled();
  });

  test("disabling cancels continuation before re-enable below the trigger", async () => {
    const updateSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const createSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<InstanceHealthLog>,
        ): Promise<InstanceHealthLog> => {
          createBy.data.id = new ObjectID("resolved-log");
          return createBy.data;
        },
      );
    const waitingLog: InstanceHealthLog = makeLog({
      status: InstanceHealthLogStatus.WaitingForReclaim,
      nextCheckAt: new Date("2026-07-13T11:59:00.000Z"),
      metadata: {
        droppedPartitions: [
          {
            tableName: "LogLocal",
            partitionId: "20260630",
            estimatedFreedBytes: 10,
          },
        ],
      },
    });

    await evaluatePruning({
      settings: {
        ...settings,
        pruningEnabled: false,
      },
      latestLog: waitingLog,
      disks: [disk],
      capacityPercent: 85,
      worstDisk: disk,
    });

    const resolvedLog: InstanceHealthLog = (await createSpy.mock.results[0]
      ?.value) as InstanceHealthLog;
    expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
      InstanceHealthLogStatus.Resolved,
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            cancelAfterReclaim: true,
          }),
        }),
      }),
    );
    expect(dropPartitionMock).not.toHaveBeenCalled();

    getCandidatesMock.mockClear();
    buildPlanMock.mockClear();
    dropPartitionMock.mockClear();

    await evaluatePruning({
      settings,
      latestLog: resolvedLog,
      disks: [disk],
      capacityPercent: 85,
      worstDisk: disk,
    });

    expect(getCandidatesMock).not.toHaveBeenCalled();
    expect(buildPlanMock).not.toHaveBeenCalled();
    expect(dropPartitionMock).not.toHaveBeenCalled();
  });

  test("honors the target-unreachable cooldown", async () => {
    const createSpy: jest.SpyInstance = jest.spyOn(
      InstanceHealthLogService,
      "create",
    );
    const updateSpy: jest.SpyInstance = jest.spyOn(
      InstanceHealthLogService,
      "updateOneById",
    );

    await evaluatePruning({
      settings,
      latestLog: makeLog({
        status: InstanceHealthLogStatus.TargetUnreachable,
        nextCheckAt: later,
      }),
      disks: [disk],
      capacityPercent: 95,
      worstDisk: disk,
    });

    expect(getCandidatesMock).not.toHaveBeenCalled();
    expect(buildPlanMock).not.toHaveBeenCalled();
    expect(dropPartitionMock).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("waits for reclaim after a partial DDL failure", async () => {
    const plan: ClickhousePruningPlan = {
      partitions: [
        {
          tableName: "LogLocal",
          partitionId: "20260701",
          estimatedFreedBytes: 10,
        },
        {
          tableName: "MetricLocal",
          partitionId: "20260701",
          estimatedFreedBytes: 20,
        },
      ],
      estimatedFreedBytes: 30,
      projectedMaxUtilizationPercent: 75,
      targetReachable: true,
    };
    getCandidatesMock.mockResolvedValue([]);
    buildPlanMock.mockReturnValue(plan);
    dropPartitionMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("DDL failed"));

    jest
      .spyOn(InstanceHealthLogService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<InstanceHealthLog>,
        ): Promise<InstanceHealthLog> => {
          createBy.data.id = new ObjectID("running-log");
          return createBy.data;
        },
      );
    const updateSpy: jest.SpyInstance = jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await evaluatePruning({
      settings,
      latestLog: null,
      disks: [{ ...disk, utilizationPercent: 95, usedInBytes: 95 }],
      capacityPercent: 95,
      worstDisk: { ...disk, utilizationPercent: 95, usedInBytes: 95 },
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        status: InstanceHealthLogStatus.WaitingForReclaim,
        nextCheckAt: later,
        metadata: expect.objectContaining({
          droppedPartitionCount: 1,
        }),
      }),
    );
  });
});
