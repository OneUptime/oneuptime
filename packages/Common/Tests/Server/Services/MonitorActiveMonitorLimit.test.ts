import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import { ActiveMonitoringMeteredPlan } from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import CreateLimit from "../../../Server/Types/Database/CreateLimit";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ActiveMonitorLimit from "../../../Server/Utils/Billing/ActiveMonitorLimit";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  Object.defineProperty(mocked, "AllowedActiveMonitorCountInFreePlan", {
    enumerable: true,
    value: 10,
  });

  return mocked;
});

/*
 * A MONITOR CREATE, TYPE CHANGE AND DELETE, HELD TO THE PROJECT'S ACTIVE
 * MONITOR LIMIT (MonitorService with ActiveMonitorLimit).
 *
 * The support report: a project with a plan of 500 active monitors - a plan
 * bought from a reseller, Project.activeMonitorsLimit - had 2,881, because
 * nothing compared the two. Here, with the project's plan and its count
 * stubbed: the create is refused at and past the limit and allowed under
 * it, with the limit's own words; Manual monitors are never limited; turning
 * a monitor on or taking it out of the archive is never refused (it was
 * counted all along); a Manual monitor made an active one is; the INSERT is
 * decided under the limit (getCreateLimit); and every project a delete
 * removed monitors from is counted again, whoever deleted them.
 */

type MonitorHooks = {
  onBeforeCreate: (input: CreateBy<Monitor>) => Promise<unknown>;
  onBeforeUpdate: (input: UpdateBy<Monitor>) => Promise<unknown>;
  getCreateLimit: (input: CreateBy<Monitor>) => Promise<CreateLimit | null>;
  onDeleteSuccess: (
    onDelete: OnDelete<Monitor>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<Monitor>>;
};

const hooks: MonitorHooks = MonitorService as unknown as MonitorHooks;

const PROJECT_ID: ObjectID = new ObjectID(
  "4a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "4a000000-0000-4000-8000-000000000002",
);

// The project in the support report.
const RESELLER_PLAN: CurrentPlan = {
  plan: PlanType.Growth,
  isSubscriptionUnpaid: false,
  activeMonitorsLimit: 500,
};

let countActiveMonitors: SpyInstance<
  typeof ActiveMonitorLimit.countActiveMonitors
>;
let currentPlan: SpyInstance<typeof ProjectService.getCurrentPlan>;

function createInput(
  monitorType: MonitorType,
  projectId: ObjectID = PROJECT_ID,
): CreateBy<Monitor> {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = monitorType;
  return { data: monitor, props: { isRoot: true, tenantId: projectId } };
}

function updateInput(data: UpdateBy<Monitor>["data"]): UpdateBy<Monitor> {
  return {
    data,
    query: { _id: ObjectID.generate().toString() },
    props: { isRoot: true },
    limit: 10,
    skip: 0,
  };
}

function storedMonitor(projectId: ObjectID, monitorType: MonitorType): Monitor {
  return Object.assign(new Monitor(), {
    _id: ObjectID.generate().toString(),
    projectId: projectId,
    monitorType: monitorType,
  });
}

function onPlan(plan: CurrentPlan): void {
  currentPlan.mockResolvedValue(plan);
}

function withActiveMonitors(count: number): void {
  countActiveMonitors.mockResolvedValue(count);
}

beforeEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(true);

  // A project with a payment method: the pay-as-you-go gate lets it through.
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(true);
  currentPlan = jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue(RESELLER_PLAN);
  countActiveMonitors = jest
    .spyOn(ActiveMonitorLimit, "countActiveMonitors")
    .mockResolvedValue(0);

  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MonitorService, "validateDependencyConfiguration")
    .mockResolvedValue(undefined);
  const status: MonitorStatus = new MonitorStatus();
  status.id = ObjectID.generate();
  jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(status);
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("creating a monitor in a project whose plan caps active monitors", () => {
  test("under the limit, it is created", async () => {
    withActiveMonitors(499);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).resolves.toBeDefined();
    expect(countActiveMonitors).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
    });
  });

  test("at the limit, it is refused: which limit, and what to do", async () => {
    withActiveMonitors(500);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).rejects.toThrow(
      new BadDataException(
        "This project has reached its plan's limit of 500 active monitors, so no more can be added. Delete monitors you no longer need, or change the plan in Project Settings > Billing. Manual monitors do not count towards the limit; monitors that are turned off or archived do.",
      ),
    );
  });

  /*
   * The support report's project: 2,881 active monitors on a plan of 500.
   * Its monitors keep running; it is told so, and when it may add again.
   */
  test("past the limit, it is refused, and told its monitors keep running", async () => {
    withActiveMonitors(2881);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).rejects.toThrow(
      "This project has 2,881 active monitors and its plan includes 500, so no more can be added until it has fewer than 500. Every monitor it has keeps running.",
    );
  });

  test.each(
    Object.values(MonitorType).filter((type: MonitorType) => {
      return type !== MonitorType.Manual;
    }),
  )(
    "a %s monitor is refused at the limit",
    async (monitorType: MonitorType) => {
      withActiveMonitors(500);

      await expect(
        hooks.onBeforeCreate(createInput(monitorType)),
      ).rejects.toBeInstanceOf(BadDataException);
    },
  );

  test("a Manual monitor is never limited: created past the limit, nothing counted", async () => {
    withActiveMonitors(2881);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Manual)),
    ).resolves.toBeDefined();
    expect(countActiveMonitors).not.toHaveBeenCalled();
  });

  test("a project whose plan sets no limit is never refused, and nothing is counted", async () => {
    onPlan({ plan: PlanType.Scale, isSubscriptionUnpaid: false });
    withActiveMonitors(100000);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).resolves.toBeDefined();
    expect(countActiveMonitors).not.toHaveBeenCalled();
  });

  test("the Free plan holds it at its own allowance, in its own words", async () => {
    onPlan({ plan: PlanType.Free, isSubscriptionUnpaid: false });
    withActiveMonitors(10);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).rejects.toThrow(
      "This project has reached the Free plan's limit of 10 active monitors, so no more can be added. Upgrade the plan in Project Settings > Billing to add more.",
    );
  });

  test("a reseller's plan on the Free plan is held to the lower of the two", async () => {
    onPlan({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 3,
    });
    withActiveMonitors(3);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).rejects.toThrow("its plan's limit of 3 active monitors");
  });

  test("an unpaid subscription is refused as unpaid, before anything is counted", async () => {
    onPlan({ ...RESELLER_PLAN, isSubscriptionUnpaid: true });
    withActiveMonitors(2881);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).rejects.toThrow("subscription is unpaid");
    expect(countActiveMonitors).not.toHaveBeenCalled();
  });

  test("on an install without billing there is no limit, and nothing is read", async () => {
    setTestBillingEnabled(false);
    withActiveMonitors(2881);

    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).resolves.toBeDefined();
    expect(currentPlan).not.toHaveBeenCalled();
    expect(countActiveMonitors).not.toHaveBeenCalled();
  });

  test("it is held to the project it is created in, whatever project the payload names", async () => {
    const input: CreateBy<Monitor> = createInput(MonitorType.Website);
    input.data.projectId = OTHER_PROJECT_ID;
    withActiveMonitors(0);

    await hooks.onBeforeCreate(input);

    expect(currentPlan).toHaveBeenCalledWith(PROJECT_ID);
    expect(countActiveMonitors).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
    });
  });
});

describe("the INSERT of a monitor is decided under the limit", () => {
  test("an active monitor in a limited project hands DatabaseService the limit", async () => {
    const input: CreateBy<Monitor> = createInput(MonitorType.Website);
    input.data.projectId = PROJECT_ID;

    const limit: CreateLimit | null = await hooks.getCreateLimit(input);

    expect(limit?.limitName).toBe(ActiveMonitorLimit.LIMIT_NAME);
    expect(limit?.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  test("a Manual monitor, and a project with no limit, hand none", async () => {
    await expect(
      hooks.getCreateLimit(createInput(MonitorType.Manual)),
    ).resolves.toBeNull();

    onPlan({ plan: PlanType.Growth, isSubscriptionUnpaid: false });
    await expect(
      hooks.getCreateLimit(createInput(MonitorType.Website)),
    ).resolves.toBeNull();
  });

  test("the project is the one the monitor is written in, the tenant's when the row names none", async () => {
    await hooks.getCreateLimit(createInput(MonitorType.Website));
    expect(currentPlan).toHaveBeenLastCalledWith(PROJECT_ID);

    const stamped: CreateBy<Monitor> = createInput(
      MonitorType.Website,
      OTHER_PROJECT_ID,
    );
    stamped.data.projectId = OTHER_PROJECT_ID;
    await hooks.getCreateLimit(stamped);
    expect(currentPlan).toHaveBeenLastCalledWith(OTHER_PROJECT_ID);
  });
});

describe("updating monitors in a project at its limit", () => {
  beforeEach(() => {
    withActiveMonitors(500);
  });

  /*
   * A monitor turned off, or archived, is an active monitor all the same -
   * it is on the bill - so turning it on again, or taking it out of the
   * archive, adds none and is never refused by the limit.
   */
  test.each([{ disableActiveMonitoring: false }, { isArchived: false }])(
    "%j is never refused by the limit, and counts nothing",
    async (data: UpdateBy<Monitor>["data"]) => {
      jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([storedMonitor(PROJECT_ID, MonitorType.Website)]);

      await expect(
        hooks.onBeforeUpdate(updateInput(data)),
      ).resolves.toBeDefined();
      expect(countActiveMonitors).not.toHaveBeenCalled();
    },
  );

  test("a Manual monitor made an active one is refused", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([storedMonitor(PROJECT_ID, MonitorType.Manual)]);

    await expect(
      hooks.onBeforeUpdate(updateInput({ monitorType: MonitorType.API })),
    ).rejects.toThrow("its plan's limit of 500 active monitors");
  });

  test("under the limit, as many as fit are made active, counted together", async () => {
    withActiveMonitors(498);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        storedMonitor(PROJECT_ID, MonitorType.Manual),
        storedMonitor(PROJECT_ID, MonitorType.Manual),
      ]);

    await expect(
      hooks.onBeforeUpdate(updateInput({ monitorType: MonitorType.API })),
    ).resolves.toBeDefined();

    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        storedMonitor(PROJECT_ID, MonitorType.Manual),
        storedMonitor(PROJECT_ID, MonitorType.Manual),
        storedMonitor(PROJECT_ID, MonitorType.Manual),
      ]);

    await expect(
      hooks.onBeforeUpdate(updateInput({ monitorType: MonitorType.API })),
    ).rejects.toThrow("room for 2 more, not 3");
  });

  test("a monitor that was active already adds none", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([storedMonitor(PROJECT_ID, MonitorType.Website)]);

    await expect(
      hooks.onBeforeUpdate(updateInput({ monitorType: MonitorType.API })),
    ).resolves.toBeDefined();
    expect(countActiveMonitors).not.toHaveBeenCalled();
  });

  test("each project's monitors are held to that project's limit", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        storedMonitor(PROJECT_ID, MonitorType.Manual),
        storedMonitor(OTHER_PROJECT_ID, MonitorType.Manual),
      ]);
    currentPlan.mockImplementation(
      async (projectId: ObjectID): Promise<CurrentPlan> => {
        return projectId.toString() === PROJECT_ID.toString()
          ? { plan: PlanType.Growth, isSubscriptionUnpaid: false }
          : RESELLER_PLAN;
      },
    );

    await expect(
      hooks.onBeforeUpdate(updateInput({ monitorType: MonitorType.API })),
    ).rejects.toThrow("its plan's limit of 500 active monitors");
    expect(countActiveMonitors).toHaveBeenCalledTimes(1);
    expect(countActiveMonitors).toHaveBeenCalledWith({
      projectId: OTHER_PROJECT_ID,
    });
  });
});

describe("deleting monitors counts their projects again", () => {
  let report: SpyInstance<
    typeof ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider
  >;

  beforeEach(() => {
    report = jest
      .spyOn(ActiveMonitoringMeteredPlan, "reportQuantityToBillingProvider")
      .mockResolvedValue(undefined);
  });

  function deleted(
    monitors: Array<Monitor>,
    tenantId?: ObjectID,
  ): OnDelete<Monitor> {
    return {
      deleteBy: {
        query: {},
        limit: 10,
        skip: 0,
        props: tenantId ? { isRoot: true, tenantId } : { isRoot: true },
      },
      carryForward: { monitors: monitors, networkDeviceIdsToRefresh: [] },
    };
  }

  test("every project the deleted monitors were in, once each - with no project on the delete", async () => {
    await hooks.onDeleteSuccess(
      deleted([
        storedMonitor(PROJECT_ID, MonitorType.Website),
        storedMonitor(PROJECT_ID, MonitorType.API),
        storedMonitor(OTHER_PROJECT_ID, MonitorType.Ping),
      ]),
      [],
    );

    expect(
      report.mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
  });

  test("the request's project when the delete read no monitors", async () => {
    await hooks.onDeleteSuccess(deleted([], PROJECT_ID), []);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0].toString()).toBe(PROJECT_ID.toString());
  });

  test("a project whose count could not be reported does not stop the others, nor fail the delete", async () => {
    report.mockRejectedValueOnce(new Error("Provider unavailable"));

    await expect(
      hooks.onDeleteSuccess(
        deleted([
          storedMonitor(PROJECT_ID, MonitorType.Website),
          storedMonitor(OTHER_PROJECT_ID, MonitorType.Ping),
        ]),
        [],
      ),
    ).resolves.toBeDefined();
    expect(report).toHaveBeenCalledTimes(2);
  });

  test("nothing is reported on an install without billing", async () => {
    setTestBillingEnabled(false);

    await hooks.onDeleteSuccess(
      deleted([storedMonitor(PROJECT_ID, MonitorType.Website)], PROJECT_ID),
      [],
    );

    expect(report).not.toHaveBeenCalled();
  });
});
