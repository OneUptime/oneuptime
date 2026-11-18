import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import DataAssetFeedService from "../../../../Server/Services/DataAssetFeedService";
import DataAssetOwnerTeamService from "../../../../Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../../../Server/Services/DataAssetOwnerUserService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataPipelineOwnerTeamService from "../../../../Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "../../../../Server/Services/DataPipelineOwnerUserService";
import DataPipelineRunService from "../../../../Server/Services/DataPipelineRunService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataStoreOwnerTeamService from "../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DataAlertCause, {
  DataAlertSubject,
} from "../../../../Server/Utils/DataObservability/DataAlertCause";
import DataAlertFeedbackRecorder from "../../../../Server/Utils/DataObservability/DataAlertFeedbackRecorder";
import OpenLineageIngest from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import {
  OpenLineageRunEvent,
  OpenLineageRunState,
} from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import { CollectedTable } from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import TableHealthIngest from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import logger from "../../../../Server/Utils/Logger";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import { DataAlertFeedback } from "../../../../Types/DataObservability/DataAlertFeedback";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { getDataAssetLateAt } from "../../../../Types/DataObservability/DataAssetFreshness";
import { DataObservabilityMetricName } from "../../../../Types/DataObservability/DataObservabilityMetric";
import { getDataPipelineLateAt } from "../../../../Types/DataObservability/DataPipelineSchedule";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHEN A TABLE OR PIPELINE GOES LATE, AND WHO A PIPELINE'S ALERT GOES TO,
 * WRITTEN AS DATA ARRIVES (#6550, #6552, #6551).
 *
 * Tables' Late filter and the menu's count ask the database for the tables
 * and pipelines whose lateAt has passed, so lateAt is written beside what it
 * is worked out from, every time either moves: a table's last change and
 * usual interval as it is collected or as feedback retunes it, a pipeline's
 * last start and expected interval as it runs. A failed or late pipeline's
 * alert goes to the pipeline's owners first, then its table's, then its
 * database's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ASSET_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PIPELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const COLLECTED_AT: Date = new Date("2026-11-03T12:00:00.000Z");

beforeEach(() => {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      return undefined;
    }) as never);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a table, as it is collected", () => {
  let updates: Array<Record<string, unknown>>;
  let created: Array<DataAsset>;

  function collected(overrides: Partial<CollectedTable> = {}): CollectedTable {
    return {
      schema: "public",
      name: "orders",
      kind: DataAssetKind.Table,
      estimatedRows: 1100,
      sizeInBytes: 65536,
      writeCount: null,
      secondsSinceChange: null,
      columns: [
        { name: "id", dataType: "bigint", isNullable: false, position: 1 },
      ],
      ...overrides,
    };
  }

  function known(fields: Partial<DataAsset> = {}): DataAsset {
    const asset: DataAsset = new DataAsset(ASSET_ID);
    asset.assetKey = "public.orders";
    asset.rowCount = 1000;
    asset.sizeInBytes = 65536;
    asset.lastChangedAt = new Date("2026-11-03T11:00:00.000Z");
    asset.updateIntervalInSeconds = 3600;
    asset.isDropped = false;
    Object.assign(asset, fields);
    return asset;
  }

  async function collect(data: {
    existing: Array<DataAsset>;
    tables: Array<CollectedTable>;
  }): Promise<void> {
    jest
      .spyOn(DataAssetService, "findAllBy")
      .mockResolvedValue(data.existing as never);
    jest.spyOn(MonitorMetricUtil, "getRetentionDays").mockResolvedValue(30);
    jest
      .spyOn(TableHealthIngest as never, "writeMetricRows")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(TableHealthIngest as never, "writeNewPersonalDataColumns")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DataAssetFeedService, "createDataAssetFeedItem")
      .mockResolvedValue(undefined as never);
    // The store's own collection summary, written last.
    jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DataAssetService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (updateBy: {
        data: Record<string, unknown>;
      }) => {
        updates.push(updateBy.data);
      }) as never);
    jest
      .spyOn(DataAssetService, "create")
      .mockImplementation((async (createBy: { data: DataAsset }) => {
        created.push(createBy.data);
        const row: DataAsset = new DataAsset(ObjectID.generate());
        return row;
      }) as never);

    await TableHealthIngest.recordSnapshot({
      store: {
        id: STORE_ID,
        projectId: PROJECT_ID,
        name: "orders-db",
        kind: "PostgreSQL",
      },
      snapshot: {
        engine: "postgres",
        collectedAt: COLLECTED_AT.toISOString(),
        isComplete: false,
        warnings: [],
        tables: data.tables,
      } as never,
    });
  }

  beforeEach(() => {
    updates = [];
    created = [];
  });

  test("a change writes when it goes late next, from the change and the interval written beside it", async () => {
    await collect({ existing: [known()], tables: [collected()] });

    expect(updates).toHaveLength(1);

    const update: Record<string, unknown> = updates[0]!;

    // Changed since the last collection: its rows moved.
    expect(update["lastChangedAt"]).toEqual(COLLECTED_AT);
    expect(update["updateIntervalInSeconds"]).toBe(3600);
    // Twice its hour after the change.
    expect(update["lateAt"]).toEqual(new Date("2026-11-03T14:00:00.000Z"));
    expect(update["lateAt"]).toEqual(
      getDataAssetLateAt({
        kind: DataAssetKind.Table,
        lastChangedAt: update["lastChangedAt"] as Date,
        updateIntervalInSeconds: update["updateIntervalInSeconds"] as number,
      }),
    );
  });

  test("a table whose rhythm is not learned yet is never late: its lateAt is cleared", async () => {
    await collect({
      existing: [
        known({
          lastChangedAt: undefined,
          updateIntervalInSeconds: undefined,
        }),
      ],
      tables: [collected()],
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]!["lateAt"]).toBeNull();
    expect(Object.keys(updates[0]!)).toContain("lateAt");
  });

  test("a table whose numbers did not move is not written: its lateAt stands, as what it is worked out from does", async () => {
    await collect({
      existing: [
        known({
          // What the last collection kept: the same columns, read in full.
          columns: collected().columns!,
          collectionState: {
            columnsKnown: true,
            writeCount: null,
            readCount: null,
          },
        }),
      ],
      tables: [collected({ estimatedRows: 1000 })],
    });

    expect(updates).toEqual([]);
  });

  test("a new table has no lateAt until its rhythm is learned", async () => {
    await collect({
      existing: [],
      tables: [collected({ secondsSinceChange: 60 })],
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.lastChangedAt).toEqual(
      new Date(COLLECTED_AT.getTime() - 60 * 1000),
    );
    expect(created[0]!.lateAt).toBeUndefined();
  });
});

describe("a table's interval, retuned by feedback", () => {
  let updates: Array<Record<string, unknown>>;

  async function retune(data: {
    metricName: string;
    asset: Partial<DataAsset>;
  }): Promise<void> {
    const asset: DataAsset = new DataAsset(ASSET_ID);
    Object.assign(asset, data.asset);

    jest.spyOn(DataAssetService, "findOneById").mockResolvedValue(asset);
    jest
      .spyOn(DataAssetService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (updateBy: {
        data: Record<string, unknown>;
      }) => {
        updates.push(updateBy.data);
      }) as never);

    await (
      DataAlertFeedbackRecorder as unknown as {
        retune: (input: {
          dataAssetId: ObjectID;
          feedback: DataAlertFeedback;
          metricName: string | null;
        }) => Promise<void>;
      }
    ).retune({
      dataAssetId: ASSET_ID,
      feedback: DataAlertFeedback.NotAnIssue,
      metricName: data.metricName,
    });
  }

  beforeEach(() => {
    updates = [];
  });

  test("a longer usual interval moves when the table goes late, written with it", async () => {
    const lastChangedAt: Date = new Date("2026-11-03T11:00:00.000Z");

    await retune({
      metricName: DataObservabilityMetricName.OverdueSeconds,
      asset: {
        assetKind: DataAssetKind.Table,
        lastChangedAt,
        updateIntervalInSeconds: 3600,
      },
    });

    expect(updates).toHaveLength(1);

    const interval: number = updates[0]!["updateIntervalInSeconds"] as number;

    expect(interval).toBeGreaterThan(3600);
    expect(updates[0]!["lateAt"]).toEqual(
      getDataAssetLateAt({
        kind: DataAssetKind.Table,
        lastChangedAt,
        updateIntervalInSeconds: interval,
      }),
    );
    expect((updates[0]!["lateAt"] as Date).getTime()).toBeGreaterThan(
      lastChangedAt.getTime() + 2 * 3600 * 1000,
    );
  });

  test("a wider row-count tolerance does not move it, and leaves lateAt alone", async () => {
    await retune({
      metricName: DataObservabilityMetricName.RowCountChangePercent,
      asset: {
        assetKind: DataAssetKind.Table,
        lastChangedAt: new Date("2026-11-03T11:00:00.000Z"),
        updateIntervalInSeconds: 3600,
        rowCountChangeTolerancePercent: 5,
      },
    });

    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]!)).not.toContain("lateAt");
  });
});

describe("a pipeline, as it runs", () => {
  const RUN_ID: string = "66666666-6666-4666-8666-666666666666";
  const LAST_START: Date = new Date("2026-11-03T11:00:00.000Z");
  let pipelineUpdates: Array<Record<string, unknown>>;

  function pipeline(fields: Partial<DataPipeline> = {}): DataPipeline {
    const row: DataPipeline = new DataPipeline(PIPELINE_ID);
    row.lastRunStartedAt = LAST_START;
    row.lastRunId = "77777777-7777-4777-8777-777777777777";
    row.expectedRunIntervalInSeconds = 3600;
    row.runCount = 5;
    Object.assign(row, fields);
    return row;
  }

  function event(
    fields: Partial<OpenLineageRunEvent> = {},
  ): OpenLineageRunEvent {
    return {
      eventType: OpenLineageRunState.Start,
      eventTime: new Date("2026-11-03T12:00:00.000Z"),
      runId: RUN_ID,
      jobNamespace: "airflow",
      jobName: "load_orders",
      errorMessage: null,
      scheduledAt: null,
      inputs: [],
      outputs: [],
      ...fields,
    };
  }

  async function record(data: {
    pipeline: DataPipeline;
    event: OpenLineageRunEvent;
    runKnown?: boolean;
    learnedInterval?: number | null;
  }): Promise<void> {
    jest.spyOn(DataPipelineRunService, "findOneBy").mockResolvedValue(
      (data.runKnown
        ? {
            id: new ObjectID(RUN_ID),
            state: OpenLineageRunState.Start,
            startedAt: data.event.eventTime,
          }
        : null) as never,
    );
    jest
      .spyOn(DataPipelineRunService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest.spyOn(DataPipelineRunService, "create").mockResolvedValue({} as never);
    jest
      .spyOn(OpenLineageIngest as never, "learnExpectedInterval")
      .mockResolvedValue((data.learnedInterval ?? null) as never);
    jest
      .spyOn(OpenLineageIngest as never, "learnTypicalDuration")
      .mockResolvedValue(null as never);
    jest
      .spyOn(DataPipelineService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (updateBy: {
        data: Record<string, unknown>;
      }) => {
        pipelineUpdates.push(updateBy.data);
      }) as never);

    await (
      OpenLineageIngest as unknown as {
        recordRun: (input: {
          projectId: ObjectID;
          pipeline: DataPipeline;
          event: OpenLineageRunEvent;
          outputAssets: Array<unknown>;
          metricRows: Array<unknown>;
          retentionDays: number;
        }) => Promise<void>;
      }
    ).recordRun({
      projectId: PROJECT_ID,
      pipeline: data.pipeline,
      event: data.event,
      outputAssets: [],
      metricRows: [],
      retentionDays: 30,
    });
  }

  beforeEach(() => {
    pipelineUpdates = [];
  });

  test("a new run is the latest start: it goes late an interval and its slack after it", async () => {
    await record({
      pipeline: pipeline(),
      event: event(),
      learnedInterval: 3600,
    });

    expect(pipelineUpdates).toHaveLength(1);
    expect(pipelineUpdates[0]!["lastRunStartedAt"]).toEqual(
      new Date("2026-11-03T12:00:00.000Z"),
    );
    // An hour, and a quarter of it, after it started.
    expect(pipelineUpdates[0]!["lateAt"]).toEqual(
      new Date("2026-11-03T13:15:00.000Z"),
    );
    expect(pipelineUpdates[0]!["lateAt"]).toEqual(
      getDataPipelineLateAt({
        lastRunStartedAt: pipelineUpdates[0]!["lastRunStartedAt"] as Date,
        expectedRunIntervalInSeconds: 3600,
      }),
    );
  });

  test("a later event of a run that is not the latest moves nothing it is worked out from: lateAt is left alone", async () => {
    await record({
      pipeline: pipeline({
        lastRunStartedAt: new Date("2026-11-03T13:00:00.000Z"),
      }),
      event: event({ eventType: OpenLineageRunState.Complete }),
      runKnown: true,
    });

    expect(pipelineUpdates).toHaveLength(1);
    expect(Object.keys(pipelineUpdates[0]!)).not.toContain("lateAt");
    expect(Object.keys(pipelineUpdates[0]!)).not.toContain("lastRunStartedAt");
  });

  test("an older run heard of late teaches a new interval: lateAt moves with it, from the latest start", async () => {
    const latest: Date = new Date("2026-11-03T13:00:00.000Z");

    await record({
      pipeline: pipeline({ lastRunStartedAt: latest }),
      event: event(),
      learnedInterval: 7200,
    });

    expect(pipelineUpdates[0]!["expectedRunIntervalInSeconds"]).toBe(7200);
    expect(pipelineUpdates[0]!["lateAt"]).toEqual(
      getDataPipelineLateAt({
        lastRunStartedAt: latest,
        expectedRunIntervalInSeconds: 7200,
      }),
    );
  });

  test("a pipeline with no schedule learned is never late: lateAt is written empty", async () => {
    await record({
      pipeline: pipeline({ expectedRunIntervalInSeconds: undefined }),
      event: event(),
      learnedInterval: null,
    });

    expect(Object.keys(pipelineUpdates[0]!)).toContain("lateAt");
    expect(pipelineUpdates[0]!["lateAt"]).toBeNull();
  });
});

describe("who a data alert goes to", () => {
  const PIPELINE_OWNER: ObjectID = new ObjectID(
    "88888888-8888-4888-8888-000000000001",
  );
  const PIPELINE_TEAM: ObjectID = new ObjectID(
    "88888888-8888-4888-8888-000000000002",
  );
  const TABLE_OWNER: ObjectID = new ObjectID(
    "88888888-8888-4888-8888-000000000003",
  );
  const STORE_OWNER: ObjectID = new ObjectID(
    "88888888-8888-4888-8888-000000000004",
  );

  let userOwners: Array<string>;
  let teamOwners: Array<string>;

  function owners(
    service: Record<string, unknown> | { findBy: unknown },
    field: "userId" | "teamId",
    ids: Array<ObjectID>,
  ): ReturnType<typeof jest.spyOn> {
    return jest.spyOn(service as never, "findBy" as never).mockResolvedValue(
      ids.map((id: ObjectID) => {
        return { [field]: id };
      }) as never,
    );
  }

  async function alertAbout(subject: DataAlertSubject): Promise<void> {
    const alert: Alert = new Alert(ALERT_ID);
    alert.projectId = PROJECT_ID;

    await (
      DataAlertCause as unknown as {
        addOwners: (input: {
          alert: Alert;
          subject: DataAlertSubject;
        }) => Promise<void>;
      }
    ).addOwners({ alert, subject });
  }

  beforeEach(() => {
    userOwners = [];
    teamOwners = [];

    jest
      .spyOn(AlertOwnerUserService, "create")
      .mockImplementation((async (createBy: { data: AlertOwnerUser }) => {
        userOwners.push(createBy.data.userId!.toString());
        return createBy.data;
      }) as never);
    jest
      .spyOn(AlertOwnerTeamService, "create")
      .mockImplementation((async (createBy: { data: AlertOwnerTeam }) => {
        teamOwners.push(createBy.data.teamId!.toString());
        return createBy.data;
      }) as never);
  });

  test("a failed or late pipeline's alert goes to the pipeline's owners, its people and its teams", async () => {
    owners(DataPipelineOwnerUserService, "userId", [PIPELINE_OWNER]);
    owners(DataPipelineOwnerTeamService, "teamId", [PIPELINE_TEAM]);
    const tableOwners: ReturnType<typeof jest.spyOn> = owners(
      DataAssetOwnerUserService,
      "userId",
      [TABLE_OWNER],
    );
    owners(DataAssetOwnerTeamService, "teamId", []);

    await alertAbout({
      dataPipelineId: PIPELINE_ID,
      dataAssetId: ASSET_ID,
      dataStoreId: STORE_ID,
    });

    expect(userOwners).toEqual([PIPELINE_OWNER.toString()]);
    expect(teamOwners).toEqual([PIPELINE_TEAM.toString()]);
    // The table's owners are not asked: the pipeline has its own.
    expect(tableOwners).not.toHaveBeenCalled();
  });

  test("the pipeline's owners are read in the alert's project only", async () => {
    const pipelineOwners: ReturnType<typeof jest.spyOn> = owners(
      DataPipelineOwnerUserService,
      "userId",
      [PIPELINE_OWNER],
    );
    owners(DataPipelineOwnerTeamService, "teamId", []);

    await alertAbout({
      dataPipelineId: PIPELINE_ID,
      dataAssetId: null,
      dataStoreId: null,
    });

    expect(
      (pipelineOwners.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query,
    ).toEqual({ dataPipelineId: PIPELINE_ID, projectId: PROJECT_ID });
  });

  test("a pipeline nobody owns hands its alert to its table's owners", async () => {
    owners(DataPipelineOwnerUserService, "userId", []);
    owners(DataPipelineOwnerTeamService, "teamId", []);
    owners(DataAssetOwnerUserService, "userId", [TABLE_OWNER]);
    owners(DataAssetOwnerTeamService, "teamId", []);

    await alertAbout({
      dataPipelineId: PIPELINE_ID,
      dataAssetId: ASSET_ID,
      dataStoreId: STORE_ID,
    });

    expect(userOwners).toEqual([TABLE_OWNER.toString()]);
  });

  test("and with no table owner either, to its database's", async () => {
    owners(DataPipelineOwnerUserService, "userId", []);
    owners(DataPipelineOwnerTeamService, "teamId", []);
    owners(DataAssetOwnerUserService, "userId", []);
    owners(DataAssetOwnerTeamService, "teamId", []);
    owners(DataStoreOwnerUserService, "userId", [STORE_OWNER]);
    owners(DataStoreOwnerTeamService, "teamId", []);

    await alertAbout({
      dataPipelineId: PIPELINE_ID,
      dataAssetId: ASSET_ID,
      dataStoreId: STORE_ID,
    });

    expect(userOwners).toEqual([STORE_OWNER.toString()]);
  });

  test("an owner who cannot be read never stops the alert", async () => {
    jest
      .spyOn(DataPipelineOwnerUserService, "findBy")
      .mockRejectedValue(new Error("connection lost") as never);

    await expect(
      alertAbout({
        dataPipelineId: PIPELINE_ID,
        dataAssetId: null,
        dataStoreId: null,
      }),
    ).resolves.toBeUndefined();
    expect(userOwners).toEqual([]);
  });
});
