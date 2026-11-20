import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What a team's or a label's ingestion budget may be saved as (issue
 * #6386): a team's or a label's - one of them, the project's own - with at
 * least one daily budget of 0 or more GB, no more than the project's; whose
 * budget it is never changes; and the telemetry worker on this server is
 * told at once.
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
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import TelemetryIngestionTeamLabelBudget from "../../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";

type MockFn = jest.Mock;
type Model = TelemetryIngestionTeamLabelBudget;

interface Hooks {
  onBeforeCreate: (createBy: CreateBy<Model>) => Promise<OnCreate<Model>>;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
  onCreateSuccess: (
    onCreate: OnCreate<Model>,
    created: Model,
  ) => Promise<Model>;
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
