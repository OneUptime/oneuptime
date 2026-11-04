import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import DataObservabilitySetting from "../../../../Models/DatabaseModels/DataObservabilitySetting";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import DataObservabilitySettingService, {
  DataObservabilitySettingValues,
  Service as DataObservabilitySettingServiceClass,
} from "../../../../Server/Services/DataObservabilitySettingService";
import { OnUpdate } from "../../../../Server/Types/Database/Hooks";
import { DataCheckRunResult } from "../../../../Server/Utils/DataObservability/DataCheckResults";
import DataCheckIngest, {
  getFailingRowsToWrite,
} from "../../../../Server/Utils/DataObservability/DataCheckIngest";
import DataCheckPlanner, {
  DataCheckPlan,
} from "../../../../Server/Utils/DataObservability/DataCheckPlanner";
import DataTableSensitivity from "../../../../Server/Utils/DataObservability/DataTableSensitivity";
import { IngestStore } from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import ObjectID from "../../../../Types/ObjectID";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";

/*
 * KEEPING A FEW FAILING ROWS IS A PROJECT'S OWN CHOICE.
 *
 * On OneUptime Cloud those rows are stored on OneUptime's servers, so what is
 * pinned here is the promise made to a customer: nothing is kept until they
 * turn it on, whatever a probe reports; what is kept is masked; and turning it
 * off deletes it. All of it the same on Cloud as on a self-hosted install.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const flag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return flag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const STORE_ID: ObjectID = ObjectID.generate();
const ASSET_ID: ObjectID = ObjectID.generate();
const CHECK_ID: ObjectID = ObjectID.generate();
const SETTING_ID: ObjectID = ObjectID.generate();

const STORE: IngestStore = {
  id: STORE_ID,
  projectId: PROJECT_ID,
  name: "Orders database",
  kind: "PostgreSQL",
};

function aSetting(keepFailingRows: boolean): DataObservabilitySetting {
  const setting: DataObservabilitySetting = new DataObservabilitySetting();

  setting.id = SETTING_ID;
  setting.projectId = PROJECT_ID;
  setting.keepFailingRows = keepFailingRows;

  return setting;
}

function aCheck(): DataCheck {
  const check: DataCheck = new DataCheck();

  check.id = CHECK_ID;
  check.projectId = PROJECT_ID;
  check.dataAssetId = ASSET_ID;
  check.name = "No negative totals";
  check.checkType = DataCheckType.FailingRows;
  check.customSql = "SELECT id, email FROM orders WHERE total < 0";

  return check;
}

function anAsset(): DataAsset {
  const asset: DataAsset = new DataAsset();

  asset.id = ASSET_ID;
  asset.schemaName = "public";
  asset.name = "orders";
  asset.isDropped = false;

  return asset;
}

function stubSetting(keepFailingRows: boolean): void {
  jest
    .spyOn(DataObservabilitySettingService, "getOrCreateForProject")
    .mockResolvedValue(aSetting(keepFailingRows));
}

async function plan(keepFailingRows: boolean): Promise<DataCheckPlan> {
  stubSetting(keepFailingRows);
  jest.spyOn(DataCheckService, "findBy").mockResolvedValue([aCheck()]);
  // First the tables whose freshness has a column of its own, then the checks' tables.
  jest
    .spyOn(DataAssetService, "findBy")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([anAsset()]);
  jest.spyOn(DataTableSensitivity, "read").mockResolvedValue([]);

  return await DataCheckPlanner.planDueChecks({
    dataStoreId: STORE_ID,
    engine: "postgresql",
    now: new Date("2026-11-04T12:00:00.000Z"),
  });
}

// What one run of the check wrote to it, for a report with these rows.
async function ingest(data: {
  keepFailingRows: boolean;
  failingRows?: DataCheckRunResult["failingRows"];
}): Promise<Record<string, unknown>> {
  stubSetting(data.keepFailingRows);
  jest.spyOn(DataCheckService, "findBy").mockResolvedValue([aCheck()]);
  jest.spyOn(DataAssetService, "findBy").mockResolvedValue([anAsset()]);
  jest.spyOn(MonitorMetricUtil, "getRetentionDays").mockResolvedValue(30);

  const written: ReturnType<typeof jest.fn> = jest
    .spyOn(DataCheckService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined) as unknown as ReturnType<typeof jest.fn>;

  await DataCheckIngest.recordResults({
    store: STORE,
    results: [
      {
        checkId: CHECK_ID.toString(),
        values: [],
        error: null,
        ...(data.failingRows ? { failingRows: data.failingRows } : {}),
      },
    ],
    collectedAt: new Date("2026-11-04T12:00:00.000Z"),
  });

  return (written.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
}

interface SettingHooks {
  onUpdateSuccess: (
    onUpdate: OnUpdate<DataObservabilitySetting>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<DataObservabilitySetting>>;
}

// A save of the settings with these values, and whether what checks kept went.
async function save(data: Record<string, unknown>): Promise<{
  cleared: ReturnType<typeof jest.fn>;
}> {
  jest
    .spyOn(DataObservabilitySettingService, "findBy")
    .mockResolvedValue([aSetting(false)]);

  const cleared: ReturnType<typeof jest.fn> = jest
    .spyOn(DataCheckService, "clearFailingRowsOfProject")
    .mockResolvedValue(undefined) as unknown as ReturnType<typeof jest.fn>;

  await (
    DataObservabilitySettingService as unknown as SettingHooks
  ).onUpdateSuccess(
    {
      updateBy: { data },
      carryForward: undefined,
    } as unknown as OnUpdate<DataObservabilitySetting>,
    [SETTING_ID],
  );

  return { cleared };
}

describe.each([
  ["OneUptime Cloud", true],
  ["a self-hosted install", false],
])("Keeping failing rows on %s", (_install: string, isBilled: boolean) => {
  beforeEach(() => {
    setTestBillingEnabled(isBilled);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  test("can be turned on", () => {
    expect(() => {
      DataObservabilitySettingServiceClass.checkValues({
        keepFailingRows: true,
      } as DataObservabilitySettingValues);
    }).not.toThrow();
  });

  test("is off until someone turns it on", () => {
    expect(
      new DataObservabilitySetting().getTableColumnMetadata("keepFailingRows")
        .defaultValue,
    ).toBe(false);
  });

  test("a check is asked for its failing rows while the project keeps them", async () => {
    const result: DataCheckPlan = await plan(true);

    expect(result.planned[0]?.sample?.sql).toContain("LIMIT");
  });

  test("a check is not asked for them otherwise", async () => {
    const result: DataCheckPlan = await plan(false);

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]?.sample).toBeUndefined();
  });

  test("what a report brings is kept masked, while the project keeps it", async () => {
    const data: Record<string, unknown> = await ingest({
      keepFailingRows: true,
      failingRows: [{ id: "7", email: "jane@example.com" }],
    });
    const [row] = data["failingRowsSample"] as Array<Record<string, string>>;

    expect(row?.["id"]).toBe("7");
    expect(row?.["email"]).not.toContain("jane");
  });

  test("what a report brings is not kept otherwise, and nothing earlier stays", async () => {
    const data: Record<string, unknown> = await ingest({
      keepFailingRows: false,
      failingRows: [{ id: "7", email: "jane@example.com" }],
    });

    expect(data["failingRowsSample"]).toBeNull();
    expect(JSON.stringify(data)).not.toContain("jane");
  });

  test("a report that found no failing rows clears the last ones", async () => {
    const data: Record<string, unknown> = await ingest({
      keepFailingRows: true,
      failingRows: [],
    });

    expect(data["failingRowsSample"]).toEqual([]);
  });

  test("a report silent about them leaves the last ones", () => {
    expect(
      getFailingRowsToWrite({ keepsFailingRows: true, failingRows: undefined }),
    ).toEqual({});
  });

  test("turning it off deletes what the project's checks kept", async () => {
    const { cleared } = await save({ keepFailingRows: false });

    expect(cleared).toHaveBeenCalledTimes(1);
    expect(cleared).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("turning it on, or saving anything else, deletes nothing", async () => {
    const turnedOn: { cleared: ReturnType<typeof jest.fn> } = await save({
      keepFailingRows: true,
    });

    expect(turnedOn.cleared).not.toHaveBeenCalled();

    const other: { cleared: ReturnType<typeof jest.fn> } = await save({
      maxGigabytesScannedPerCheck: 20,
    });

    expect(other.cleared).not.toHaveBeenCalled();
  });

  test("if the rows cannot be deleted, the save says so", async () => {
    jest
      .spyOn(DataObservabilitySettingService, "findBy")
      .mockResolvedValue([aSetting(false)]);
    jest
      .spyOn(DataCheckService, "clearFailingRowsOfProject")
      .mockRejectedValue(new Error("The database went away"));

    await expect(
      (
        DataObservabilitySettingService as unknown as SettingHooks
      ).onUpdateSuccess(
        {
          updateBy: { data: { keepFailingRows: false } },
          carryForward: undefined,
        } as unknown as OnUpdate<DataObservabilitySetting>,
        [SETTING_ID],
      ),
    ).rejects.toThrow("The database went away");
  });

  test("deleting them clears only that project's checks that kept any, with no workflow told", async () => {
    const found: ReturnType<typeof jest.fn> = jest
      .spyOn(DataCheckService, "findBy")
      .mockResolvedValue([aCheck()]) as unknown as ReturnType<typeof jest.fn>;
    const written: ReturnType<typeof jest.fn> = jest
      .spyOn(DataCheckService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined) as unknown as ReturnType<typeof jest.fn>;
    const updated: ReturnType<typeof jest.fn> = jest
      .spyOn(DataCheckService, "updateBy")
      .mockResolvedValue(1) as unknown as ReturnType<typeof jest.fn>;

    await DataCheckService.clearFailingRowsOfProject(PROJECT_ID);

    const query: { projectId: ObjectID; failingRowsSample: unknown } = (
      found.mock.calls[0]![0] as {
        query: { projectId: ObjectID; failingRowsSample: unknown };
      }
    ).query;

    expect(query.projectId).toBe(PROJECT_ID);
    expect(query.failingRowsSample).toBeDefined();
    expect(written).toHaveBeenCalledWith({
      id: CHECK_ID,
      data: { failingRowsSample: null },
      skipUpdateDateColumn: true,
    });
    // updateBy would run the check's On Update workflows, for each one.
    expect(updated).not.toHaveBeenCalled();
  });
});
