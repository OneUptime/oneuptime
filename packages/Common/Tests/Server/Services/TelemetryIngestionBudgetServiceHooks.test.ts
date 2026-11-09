import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import BillingService from "../../../Server/Services/BillingService";
import GlobalConfigService, {
  Service as GlobalConfigServiceClass,
} from "../../../Server/Services/GlobalConfigService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TelemetryIngestionBudgetSettings from "../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Where telemetry ingestion budgets (issue #5917) are saved, the services
 * saving them hold them to what may be saved and make the change apply:
 *
 *   - GlobalConfig (the instance default, by the instance admin): a number
 *     of GB per day or MB per second, never 0 (empty is "no limit"), a
 *     warning threshold from 1 to 99 %, a reset time and an IANA zone; the
 *     server that saved them forgets its cached copy at once;
 *   - Project (one project's override, by the instance admin): the same, and
 *     0, which is "no limit for this project"; the server forgets that
 *     project's cached copy at once.
 *
 * Every other server re-reads within TelemetryIngestionBudgetSettings' minute
 * (TelemetryIngestionBudgetSettings.test.ts).
 */

type GlobalConfigHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
  onUpdateSuccess(
    onUpdate: OnUpdate<GlobalConfig>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

type ProjectHooks = {
  onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
  onUpdateSuccess(
    onUpdate: OnUpdate<Project>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Project>>;
};

const globalConfigHooks: GlobalConfigHooks =
  GlobalConfigService as unknown as GlobalConfigHooks;
const projectHooks: ProjectHooks = ProjectService as unknown as ProjectHooks;

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111d1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111d2",
);

const globalConfigUpdate: (
  data: Record<string, unknown>,
) => UpdateBy<GlobalConfig> = (
  data: Record<string, unknown>,
): UpdateBy<GlobalConfig> => {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data: data,
    limit: 1,
    skip: 0,
    props: MASTER_ADMIN_PROPS,
  } as unknown as UpdateBy<GlobalConfig>;
};

const globalConfigCreate: (
  data: Record<string, unknown>,
) => CreateBy<GlobalConfig> = (
  data: Record<string, unknown>,
): CreateBy<GlobalConfig> => {
  const model: GlobalConfig = new GlobalConfig();
  model.id = ObjectID.getZeroObjectID();
  Object.assign(model, data);

  return {
    data: model,
    props: MASTER_ADMIN_PROPS,
  } as unknown as CreateBy<GlobalConfig>;
};

const projectUpdate: (data: Record<string, unknown>) => UpdateBy<Project> = (
  data: Record<string, unknown>,
): UpdateBy<Project> => {
  return {
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: { isMasterAdmin: true },
  } as unknown as UpdateBy<Project>;
};

let clearInstanceCache: ReturnType<typeof jest.spyOn>;
let clearProjectCache: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  clearInstanceCache = jest.spyOn(
    TelemetryIngestionBudgetSettings,
    "clearInstanceCache",
  );
  clearProjectCache = jest.spyOn(
    TelemetryIngestionBudgetSettings,
    "clearProjectCache",
  );

  // Tripwires: a budget update is no business of billing's.
  getJestSpyOn(
    BillingService,
    "updateCustomerBusinessDetails",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(NotificationService, "rechargeIfBalanceIsLow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(null as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GlobalConfigService - the instance's default budgets", () => {
  test("takes valid defaults and settings, normalized as they are shown", () => {
    const data: Record<string, unknown> = {
      logsDailyIngestionBudgetInGB: "12.5",
      metricsIngestionRateLimitInMBPerSecond: 4,
      telemetryIngestionBudgetWarningPercent: "90",
      telemetryIngestionBudgetResetTime: "6:30",
      telemetryIngestionBudgetResetTimezone: "America/New_York",
    };

    GlobalConfigServiceClass.applyTelemetryIngestionBudgetRules(data);

    expect(data).toEqual({
      logsDailyIngestionBudgetInGB: 12.5,
      metricsIngestionRateLimitInMBPerSecond: 4,
      telemetryIngestionBudgetWarningPercent: 90,
      telemetryIngestionBudgetResetTime: "06:30",
      telemetryIngestionBudgetResetTimezone: "America/New_York",
    });
  });

  test.each([
    ["a default of 0 (empty is no limit)", { logsDailyIngestionBudgetInGB: 0 }],
    ["a negative rate", { tracesIngestionRateLimitInMBPerSecond: -1 }],
    [
      "a budget above a million GB",
      { profilesDailyIngestionBudgetInGB: 1_000_001 },
    ],
    ["a warning of 100%", { telemetryIngestionBudgetWarningPercent: 100 }],
    ["a reset time of 24:00", { telemetryIngestionBudgetResetTime: "24:00" }],
    [
      "an unknown zone",
      { telemetryIngestionBudgetResetTimezone: "Mars/Olympus" },
    ],
  ])(
    "refuses %s, on update and on create",
    async (_label: string, data: Record<string, unknown>) => {
      await expect(
        globalConfigHooks.onBeforeUpdate(globalConfigUpdate({ ...data })),
      ).rejects.toThrow(BadDataException);
      await expect(
        globalConfigHooks.onBeforeCreate(globalConfigCreate({ ...data })),
      ).rejects.toThrow(BadDataException);
    },
  );

  test("a saved default applies on this server at once", async () => {
    await globalConfigHooks.onUpdateSuccess(
      {
        updateBy: globalConfigUpdate({ logsDailyIngestionBudgetInGB: 10 }),
        carryForward: null,
      },
      [ObjectID.getZeroObjectID()],
    );
    expect(clearInstanceCache).toHaveBeenCalledTimes(1);

    await globalConfigHooks.onUpdateSuccess(
      {
        updateBy: globalConfigUpdate({
          telemetryIngestionBudgetResetTimezone: "UTC",
        }),
        carryForward: null,
      },
      [ObjectID.getZeroObjectID()],
    );
    expect(clearInstanceCache).toHaveBeenCalledTimes(2);
  });

  test("a write that leaves the budgets alone keeps the cached copy", async () => {
    await globalConfigHooks.onUpdateSuccess(
      {
        updateBy: globalConfigUpdate({
          telemetryIngestionBudgetWarningPercent: undefined,
        }),
        carryForward: null,
      },
      [ObjectID.getZeroObjectID()],
    );

    expect(clearInstanceCache).not.toHaveBeenCalled();
  });
});

describe("ProjectService - one project's budgets", () => {
  test("takes 0 as no limit for this project, and normalizes the rest", async () => {
    const result: OnUpdate<Project> = await projectHooks.onBeforeUpdate(
      projectUpdate({
        logsDailyIngestionBudgetInGB: 0,
        tracesDailyIngestionBudgetInGB: "7",
        metricsIngestionRateLimitInMBPerSecond: "",
      }),
    );
    const data: Record<string, unknown> = result.updateBy
      .data as unknown as Record<string, unknown>;

    expect(data["logsDailyIngestionBudgetInGB"]).toBe(0);
    expect(data["tracesDailyIngestionBudgetInGB"]).toBe(7);
    expect(data["metricsIngestionRateLimitInMBPerSecond"]).toBe(null);
  });

  test("refuses a value that is not a budget", async () => {
    await expect(
      projectHooks.onBeforeUpdate(
        projectUpdate({ securityEventsDailyIngestionBudgetInGB: -5 }),
      ),
    ).rejects.toThrow("Security events daily budget");
  });

  test("a saved budget applies on this server at once, for every project it wrote", async () => {
    await projectHooks.onUpdateSuccess(
      {
        updateBy: projectUpdate({ logsDailyIngestionBudgetInGB: 5 }),
        carryForward: [],
      },
      [PROJECT_ID, OTHER_PROJECT_ID],
    );

    const cleared: Array<string> = clearProjectCache.mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    );
    expect(cleared.sort()).toEqual(
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
    );
  });

  test("an update that leaves the budgets alone keeps the cached copy", async () => {
    await projectHooks.onUpdateSuccess(
      { updateBy: projectUpdate({ name: "Renamed" }), carryForward: [] },
      [PROJECT_ID],
    );

    expect(clearProjectCache).not.toHaveBeenCalled();
  });
});
