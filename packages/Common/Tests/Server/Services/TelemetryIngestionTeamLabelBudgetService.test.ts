import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a team's or a label's ingestion budget may be saved as (issue
 * #6386): a team's or a label's - one of them, the project's own - with at
 * least one daily budget of 0 or more GB, no more than the project's; whose
 * budget it is never changes; and the telemetry worker on this server is
 * told at once, of a delete too: the projects of exactly the budgets it
 * removes.
 */

jest.mock("../../../Server/Services/TeamService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("../../../Server/Services/LabelService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock(
  "../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings",
  () => {
    return {
      __esModule: true,
      default: {
        getInstanceSettings: jest.fn(),
        getProjectOverrides: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings",
  () => {
    return { __esModule: true, default: { forgetProject: jest.fn() } };
  },
);

import TelemetryIngestionTeamLabelBudgetService, {
  TEAM_LABEL_BUDGET_LABEL_NOT_IN_PROJECT,
  TEAM_LABEL_BUDGET_NEEDS_A_BUDGET,
  TEAM_LABEL_BUDGET_NEEDS_ONE_TARGET,
  TEAM_LABEL_BUDGET_TEAM_NOT_IN_PROJECT,
} from "../../../Server/Services/TelemetryIngestionTeamLabelBudgetService";
import LabelService from "../../../Server/Services/LabelService";
import TeamService from "../../../Server/Services/TeamService";
import TelemetryIngestAttributionSettings from "../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetSettings from "../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import TelemetryIngestionTeamLabelBudget from "../../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { idsNamedBy } from "../TestingUtils/QueryConditions";
import { stubRowsCallerMayDelete } from "../TestingUtils/RowsCallerMayWrite";

type MockFn = jest.Mock;
type Model = TelemetryIngestionTeamLabelBudget;

interface Hooks {
  onBeforeCreate: (createBy: CreateBy<Model>) => Promise<OnCreate<Model>>;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
  onBeforeDelete: (deleteBy: DeleteBy<Model>) => Promise<OnDelete<Model>>;
  onCreateSuccess: (
    onCreate: OnCreate<Model>,
    created: Model,
  ) => Promise<Model>;
  onDeleteSuccess: (
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<Model>>;
}

const hooks: Hooks =
  TelemetryIngestionTeamLabelBudgetService as unknown as Hooks;

const PROJECT_ID: ObjectID = new ObjectID(
  "d4d4d4d4-0000-4000-8000-000000000001",
);
const TEAM_ID: string = "d4d4d4d4-0000-4000-8000-000000000002";
const LABEL_ID: string = "d4d4d4d4-0000-4000-8000-000000000003";

const logsBudget: (gb: number) => TelemetryIngestionBudgetStoredSettings = (
  gb: number,
): TelemetryIngestionBudgetStoredSettings => {
  const stored: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  stored[ProductType.Logs] = {
    dailyBudgetInGB: gb,
    rateLimitInMBPerSecond: null,
  };
  return stored;
};

const create: (data: Record<string, unknown>) => Promise<OnCreate<Model>> = (
  data: Record<string, unknown>,
): Promise<OnCreate<Model>> => {
  return hooks.onBeforeCreate({
    data: data as unknown as Model,
    props: { isRoot: true, tenantId: PROJECT_ID },
  } as unknown as CreateBy<Model>);
};

const update: (data: Record<string, unknown>) => Promise<OnUpdate<Model>> = (
  data: Record<string, unknown>,
): Promise<OnUpdate<Model>> => {
  return hooks.onBeforeUpdate({
    query: { _id: ObjectID.generate().toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<Model>);
};

beforeEach(() => {
  jest.clearAllMocks();
  (TeamService.findOneBy as unknown as MockFn).mockResolvedValue({
    _id: TEAM_ID,
  } as never);
  (LabelService.findOneBy as unknown as MockFn).mockResolvedValue({
    _id: LABEL_ID,
  } as never);
  (
    TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
  ).mockResolvedValue({
    budgets: logsBudget(10),
    warningPercent: 80,
    resetTime: "00:00",
    timezone: "UTC",
  } as never);
  (
    TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
  ).mockResolvedValue(null as never);
});

describe("creating a team's or a label's budget", () => {
  test("is a team's, of the project, with a daily budget within the project's", async () => {
    await expect(
      create({
        teamId: new ObjectID(TEAM_ID),
        logsDailyIngestionBudgetInGB: 2,
      }),
    ).resolves.toBeTruthy();
    expect(TeamService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: new ObjectID(TEAM_ID), projectId: PROJECT_ID },
      }),
    );
  });

  test("or a label's, named by the relation the form sends", async () => {
    await expect(
      create({
        label: { _id: LABEL_ID },
        tracesDailyIngestionBudgetInGB: 1,
      }),
    ).resolves.toBeTruthy();
    expect(LabelService.findOneBy).toHaveBeenCalledTimes(1);
  });

  test("is one of them, never both or neither", async () => {
    await expect(
      create({
        teamId: new ObjectID(TEAM_ID),
        labelId: new ObjectID(LABEL_ID),
        logsDailyIngestionBudgetInGB: 1,
      }),
    ).rejects.toThrow(TEAM_LABEL_BUDGET_NEEDS_ONE_TARGET);
    await expect(create({ logsDailyIngestionBudgetInGB: 1 })).rejects.toThrow(
      TEAM_LABEL_BUDGET_NEEDS_ONE_TARGET,
    );
  });

  test("refuses another project's team or label", async () => {
    (TeamService.findOneBy as unknown as MockFn).mockResolvedValue(
      null as never,
    );
    (LabelService.findOneBy as unknown as MockFn).mockResolvedValue(
      null as never,
    );

    await expect(
      create({
        teamId: new ObjectID(TEAM_ID),
        logsDailyIngestionBudgetInGB: 1,
      }),
    ).rejects.toThrow(TEAM_LABEL_BUDGET_TEAM_NOT_IN_PROJECT);
    await expect(
      create({
        labelId: new ObjectID(LABEL_ID),
        logsDailyIngestionBudgetInGB: 1,
      }),
    ).rejects.toThrow(TEAM_LABEL_BUDGET_LABEL_NOT_IN_PROJECT);
  });

  test("refuses one with no budget set: it would limit nothing", async () => {
    await expect(create({ teamId: new ObjectID(TEAM_ID) })).rejects.toThrow(
      TEAM_LABEL_BUDGET_NEEDS_A_BUDGET,
    );
  });

  test("refuses a budget above the project's, saying the most it can be", async () => {
    await expect(
      create({
        teamId: new ObjectID(TEAM_ID),
        logsDailyIngestionBudgetInGB: 50,
      }),
    ).rejects.toThrow("10");
  });

  test("refuses a budget that is not a number of GB above 0", async () => {
    await expect(
      create({
        teamId: new ObjectID(TEAM_ID),
        logsDailyIngestionBudgetInGB: -1,
      }),
    ).rejects.toThrow();
  });

  test("tells the telemetry worker on this server at once", async () => {
    const created: Model = new TelemetryIngestionTeamLabelBudget();
    created.projectId = PROJECT_ID;

    await hooks.onCreateSuccess({} as OnCreate<Model>, created);

    expect(
      TelemetryIngestAttributionSettings.forgetProject,
    ).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("updating a team's or a label's budget", () => {
  test("never changes whose budget it is", async () => {
    for (const data of [
      { teamId: new ObjectID(TEAM_ID) },
      { label: { _id: LABEL_ID } },
    ]) {
      await expect(update(data)).rejects.toThrow(
        "A budget's team or label cannot be changed.",
      );
    }
  });

  test("never clears every budget: deleting it does that", async () => {
    await expect(
      update({
        logsDailyIngestionBudgetInGB: null,
        tracesDailyIngestionBudgetInGB: null,
        metricsDailyIngestionBudgetInGB: null,
        profilesDailyIngestionBudgetInGB: null,
      }),
    ).rejects.toThrow(TEAM_LABEL_BUDGET_NEEDS_A_BUDGET);
  });
});

/*
 * A delete's budgets are read with findRowsAndHoldDeleteToThem: the ones
 * the delete removes - a teammate's only those they may delete, OneUptime's
 * in the delete's own window - and the delete held to them, so the projects
 * told once it is done are exactly those whose budgets went.
 */
describe("deleting a team's or a label's budget", () => {
  const OTHER_PROJECT_ID: ObjectID = new ObjectID(
    "d4d4d4d4-0000-4000-8000-000000000009",
  );
  const BUDGET_A: string = "d4d4d4d4-0000-4000-8000-00000000000a";
  const BUDGET_B: string = "d4d4d4d4-0000-4000-8000-00000000000b";
  const BUDGET_C: string = "d4d4d4d4-0000-4000-8000-00000000000c";

  const TEAMMATE: JSONObject = {
    tenantId: PROJECT_ID,
    userId: new ObjectID("d4d4d4d4-0000-4000-8000-000000000004"),
  };

  interface Read {
    query: JSONObject;
    skip: number;
    limit: number;
  }

  const budgetOf: (id: string, projectId: ObjectID) => Model = (
    id: string,
    projectId: ObjectID,
  ): Model => {
    const budget: Model = new TelemetryIngestionTeamLabelBudget();
    budget._id = id;
    budget.projectId = projectId;
    return budget;
  };

  /*
   * The service's own reads: a read by `_id` answers the budgets it names,
   * and any other read - a delete's query as it is - every budget.
   */
  const stubReads: (budgets: Array<Model>) => jest.SpyInstance = (
    budgets: Array<Model>,
  ): jest.SpyInstance => {
    return jest
      .spyOn(TelemetryIngestionTeamLabelBudgetService, "findBy")
      .mockImplementation((async (findBy: Read): Promise<Array<Model>> => {
        const named: unknown = findBy.query?.["_id"];

        if (named === undefined) {
          return budgets;
        }

        const ids: Array<string> = idsNamedBy(named).map(
          (id: string): string => {
            return id.toLowerCase();
          },
        );

        return budgets.filter((budget: Model): boolean => {
          return ids.includes(String(budget._id).toLowerCase());
        });
      }) as never) as unknown as jest.SpyInstance;
  };

  const deleteOf: (
    props: JSONObject,
    window: { skip: number; limit: number },
  ) => DeleteBy<Model> = (
    props: JSONObject,
    window: { skip: number; limit: number },
  ): DeleteBy<Model> => {
    return {
      query: {},
      props: props as unknown as DatabaseCommonInteractionProps,
      skip: window.skip,
      limit: window.limit,
    } as unknown as DeleteBy<Model>;
  };

  const idsDeleted: (deleteBy: DeleteBy<Model>) => Array<string> = (
    deleteBy: DeleteBy<Model>,
  ): Array<string> => {
    return idsNamedBy((deleteBy.query as JSONObject)["_id"])
      .map((id: string): string => {
        return id.toLowerCase();
      })
      .sort();
  };

  const projectsTold: () => Array<string> = (): Array<string> => {
    return (
      TelemetryIngestAttributionSettings.forgetProject as unknown as MockFn
    ).mock.calls.map((call: Array<unknown>): string => {
      return String(call[0]);
    });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a teammate's delete removes, and tells the projects of, only the budgets they may delete", async () => {
    const theirs: Model = budgetOf(BUDGET_A, PROJECT_ID);
    const notTheirs: Model = budgetOf(BUDGET_B, OTHER_PROJECT_ID);

    // The teammate may delete A only; B matches the query but is not theirs.
    stubRowsCallerMayDelete(TelemetryIngestionTeamLabelBudgetService, () => {
      return [theirs];
    });
    stubReads([theirs, notTheirs]);

    const deleteBy: DeleteBy<Model> = deleteOf(TEAMMATE, {
      skip: 0,
      limit: 100,
    });

    const onDelete: OnDelete<Model> = await hooks.onBeforeDelete(deleteBy);
    await hooks.onDeleteSuccess(onDelete, []);

    expect(idsDeleted(deleteBy)).toEqual([BUDGET_A]);
    expect(deleteBy.limit).toBe(1);
    expect(projectsTold()).toEqual([PROJECT_ID.toString()]);
  });

  test("OneUptime's bulk delete reads the budgets in its own window, in the request's project, and removes those", async () => {
    const window: { skip: number; limit: number } = {
      skip: 10000,
      limit: LIMIT_MAX + 50,
    };
    const findBy: jest.SpyInstance = stubReads([
      budgetOf(BUDGET_A, PROJECT_ID),
      budgetOf(BUDGET_C, PROJECT_ID),
    ]);

    const deleteBy: DeleteBy<Model> = deleteOf(
      { isRoot: true, tenantId: PROJECT_ID },
      window,
    );

    const onDelete: OnDelete<Model> = await hooks.onBeforeDelete(deleteBy);
    await hooks.onDeleteSuccess(onDelete, []);

    const reads: Array<Read> = (findBy.mock.calls as Array<[Read]>).map(
      (call: [Read]): Read => {
        return call[0];
      },
    );

    // The delete's own window, whole: not its first page.
    expect(reads).toHaveLength(1);
    expect(reads[0]!.skip).toBe(window.skip);
    expect(reads[0]!.limit).toBe(window.limit);
    expect(String(reads[0]!.query["projectId"])).toBe(PROJECT_ID.toString());

    expect(idsDeleted(deleteBy)).toEqual([BUDGET_A, BUDGET_C].sort());
    expect(deleteBy.skip).toBe(0);
    expect(deleteBy.limit).toBe(2);
    expect(projectsTold()).toEqual([
      PROJECT_ID.toString(),
      PROJECT_ID.toString(),
    ]);
  });

  test("a teammate who may delete none of the budgets removes none, and tells no project", async () => {
    stubRowsCallerMayDelete(TelemetryIngestionTeamLabelBudgetService, () => {
      return [];
    });
    const findBy: jest.SpyInstance = stubReads([
      budgetOf(BUDGET_B, OTHER_PROJECT_ID),
    ]);

    const deleteBy: DeleteBy<Model> = deleteOf(TEAMMATE, {
      skip: 0,
      limit: 100,
    });

    const onDelete: OnDelete<Model> = await hooks.onBeforeDelete(deleteBy);
    await hooks.onDeleteSuccess(onDelete, []);

    expect(findBy).not.toHaveBeenCalled();
    expect(idsDeleted(deleteBy)).toEqual([]);
    expect(projectsTold()).toEqual([]);
  });
});
