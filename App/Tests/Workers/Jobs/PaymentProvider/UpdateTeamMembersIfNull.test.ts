import Project from "Common/Models/DatabaseModels/Project";
import * as EnvironmentConfig from "Common/Server/EnvironmentConfig";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import logger from "Common/Server/Utils/Logger";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { beforeEach, describe, expect, test } from "@jest/globals";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/PaymentProvider/UpdateTeamMembersIfNull";

/*
 * QueryHelper.notNull() hands back a typeorm FindOperator, but typeorm is
 * Common's dependency and not App's - this import was the only reference to
 * the ORM anywhere in App, and it failed to resolve when App was compiled on
 * its own. The assertions below only ever ask the operator to render its
 * SQL, so describe that much and leave the ORM out of this project.
 */
interface RenderableQueryOperator {
  getSql?: (alias: string) => string;
}

/*
 * Run the real cron registration and its registered handler. Only the queue,
 * database service and seat synchronizer are replaced, so this covers the
 * repair path used after an invitation survives a payment-provider outage.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  return { __esModule: true, IsBillingEnabled: true, IsDevelopment: false };
});

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: { Worker: "Worker" },
    default: { addJob: jest.fn().mockResolvedValue(undefined) },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      updateSubscriptionSeatsByUniqueTeamMembersInProject: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    SpanStatusCode: { ERROR: 2 },
    default: {
      startActiveSpan: (data: { fn: (span: unknown) => void }): void => {
        data.fn({
          recordException: jest.fn(),
          setStatus: jest.fn(),
          end: jest.fn(),
        });
      },
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _key: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

jest.mock("Common/Utils/UUID", () => {
  return {
    __esModule: true,
    default: {
      generate: jest.fn(() => {
        return "33333333-3333-4333-8333-333333333333";
      }),
    },
  };
});

const JOB_NAME: string = "PaymentProvider:UpdateTeamMembersIfNull";
const FIRST_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SECOND_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const findProjects: jest.Mock = ProjectService.findAllBy as jest.Mock;
const syncSeats: jest.Mock =
  TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject as jest.Mock;
const billingEnvironment: { IsBillingEnabled: boolean } = EnvironmentConfig;
const runJob: PromiseVoidFunction = JobDictionary.getJobFunction(JOB_NAME);
const registrationCalls: Array<Array<unknown>> = (
  Queue.addJob as jest.Mock
).mock.calls.map((call: Array<unknown>): Array<unknown> => {
  return [...call];
});

function project(id: ObjectID, seats?: number): Project {
  return {
    id: id,
    paymentProviderSubscriptionId: `sub_${id.toString()}`,
    paymentProviderPlanId: "price_growth",
    paymentProviderSubscriptionSeats: seats,
  } as Project;
}

beforeEach(() => {
  billingEnvironment.IsBillingEnabled = true;
  findProjects.mockReset().mockResolvedValue([]);
  syncSeats.mockReset().mockResolvedValue(undefined);
  (logger.error as jest.Mock).mockClear();
});

describe("subscription seat reconciliation registration", () => {
  test("keeps the existing job name and schedules a sweep every fifteen minutes", () => {
    expect(typeof runJob).toBe("function");
    expect(registrationCalls).toEqual([
      ["Worker", JOB_NAME, JOB_NAME, {}, { scheduleAt: EVERY_FIFTEEN_MINUTE }],
    ]);
  });
});

describe("subscription seat reconciliation sweep", () => {
  test("includes stale non-null seat counts and initially missing counts", async () => {
    findProjects.mockResolvedValue([
      project(FIRST_PROJECT_ID, 1),
      project(SECOND_PROJECT_ID),
    ]);

    await runJob();

    const lookup: {
      query: Record<string, RenderableQueryOperator>;
      select: Record<string, boolean>;
      props: { isRoot: boolean };
    } = findProjects.mock.calls[0]![0] as {
      query: Record<string, RenderableQueryOperator>;
      select: Record<string, boolean>;
      props: { isRoot: boolean };
    };

    /*
     * The old IS NULL seat filter permanently missed failed updates to an
     * existing subscription. Only subscription and plan eligibility belong here.
     */
    expect(Object.keys(lookup.query).sort()).toEqual([
      "paymentProviderPlanId",
      "paymentProviderSubscriptionId",
    ]);
    for (const column of Object.keys(lookup.query)) {
      expect(lookup.query[column]!.getSql?.(column)).toContain("IS NOT NULL");
    }
    expect(lookup.select).toEqual({ _id: true });
    expect(lookup.props).toEqual({ isRoot: true });
    expect(syncSeats.mock.calls).toEqual([
      [FIRST_PROJECT_ID],
      [SECOND_PROJECT_ID],
    ]);
  });

  test("does no work when billing is disabled", async () => {
    billingEnvironment.IsBillingEnabled = false;

    await runJob();

    expect(findProjects).not.toHaveBeenCalled();
    expect(syncSeats).not.toHaveBeenCalled();
  });

  test("does not contact the synchronizer when no projects qualify", async () => {
    await runJob();

    expect(findProjects).toHaveBeenCalledTimes(1);
    expect(syncSeats).not.toHaveBeenCalled();
  });

  test("a failed project does not prevent another project from synchronizing", async () => {
    const failure: Error = new Error("Payment provider rate limit");
    findProjects.mockResolvedValue([
      project(FIRST_PROJECT_ID, 1),
      project(SECOND_PROJECT_ID, 3),
    ]);
    syncSeats.mockRejectedValueOnce(failure);

    await expect(runJob()).resolves.toBeUndefined();

    expect(syncSeats.mock.calls).toEqual([
      [FIRST_PROJECT_ID],
      [SECOND_PROJECT_ID],
    ]);
    expect(logger.error).toHaveBeenCalledWith(failure, {
      projectId: FIRST_PROJECT_ID.toString(),
    });
  });

  test("a subsequent sweep retries a project whose earlier synchronization failed", async () => {
    findProjects.mockResolvedValue([project(FIRST_PROJECT_ID, 1)]);
    syncSeats.mockRejectedValueOnce(new Error("Provider unavailable"));

    await runJob();
    await runJob();

    expect(findProjects).toHaveBeenCalledTimes(2);
    expect(syncSeats.mock.calls).toEqual([
      [FIRST_PROJECT_ID],
      [FIRST_PROJECT_ID],
    ]);
  });

  test("processes projects sequentially rather than issuing a provider burst", async () => {
    let finishFirst: (() => void) | undefined;
    let startFirst: (() => void) | undefined;
    const firstSync: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        finishFirst = resolve;
      },
    );
    const firstStarted: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        startFirst = resolve;
      },
    );
    findProjects.mockResolvedValue([
      project(FIRST_PROJECT_ID, 1),
      project(SECOND_PROJECT_ID, 3),
    ]);
    syncSeats.mockImplementationOnce((): Promise<void> => {
      startFirst!();
      return firstSync;
    });

    const sweep: Promise<void> = runJob();
    await firstStarted;

    expect(syncSeats.mock.calls).toEqual([[FIRST_PROJECT_ID]]);
    finishFirst!();
    await sweep;
    expect(syncSeats.mock.calls).toEqual([
      [FIRST_PROJECT_ID],
      [SECOND_PROJECT_ID],
    ]);
  });

  test("reports a failed project lookup as a failed job", async () => {
    const failure: Error = new Error("Database unavailable");
    findProjects.mockRejectedValue(failure);

    await expect(runJob()).rejects.toThrow(failure);
    expect(syncSeats).not.toHaveBeenCalled();
  });
});
