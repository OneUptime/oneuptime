import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAssetUsage from "../../../../Models/DatabaseModels/DataAssetUsage";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "../../../../Models/DatabaseModels/DataPipelineRun";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import AlertService from "../../../../Server/Services/AlertService";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetFeedService from "../../../../Server/Services/DataAssetFeedService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetOwnerTeamService from "../../../../Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../../../Server/Services/DataAssetOwnerUserService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataAssetUsageService from "../../../../Server/Services/DataAssetUsageService";
import DataPipelineRunService from "../../../../Server/Services/DataPipelineRunService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import DataTableDashboards from "../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataAlertExplanationReader, {
  getFeedLineAsPlainText,
} from "../../../../Server/Utils/DataObservability/DataAlertExplanation";
import DataTableErrors from "../../../../Server/Utils/DataObservability/DataTableErrors";
import { TableHealthStatus } from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import {
  DATA_ALERT_CAUSE_TITLES,
  DataAlertCauseTitleCode,
} from "../../../../Types/DataObservability/DataAlertCauseTitles";
import {
  DataAlertCauseKind,
  DataAlertExplanation,
  DataAlertLikelyCause,
} from "../../../../Types/DataObservability/DataAlertFeedback";
import { DataAssetAccessKind } from "../../../../Types/DataObservability/DataAssetUsage";
import ObjectID from "../../../../Types/ObjectID";
import { fillTemplate } from "../../../../Types/Translator";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * What a data alert's card says about its cause, read from the facts
 * around it. A run's state decides: a failed one is the cause, with its
 * error, and one that finished is not.
 *
 * Each title the server words itself carries its sentence's code and the
 * names and counts in it (DataAlertCauseTitles), so the Dashboard says it
 * in the reader's language; its English title reads as it always did
 * (#8343). A record's own words - an alert's title, a change's - carry
 * none.
 */

const FAILED_AT: Date = new Date("2026-11-04T08:00:00.000Z");
const ALERTED_AT: Date = new Date("2026-11-04T09:00:00.000Z");

function runOf(state: string, errorMessage?: string): DataPipelineRun {
  const run: DataPipelineRun = new DataPipelineRun();
  run.state = state;
  run.startedAt = FAILED_AT;

  if (errorMessage) {
    run.errorMessage = errorMessage;
  }

  return run;
}

function alertAt(): Alert {
  const alert: Alert = new Alert();
  alert.createdAt = ALERTED_AT;
  return alert;
}

function stubAlertOfPipeline(
  runs: Array<DataPipelineRun>,
  jobName: string = "nightly_orders",
): void {
  const row: DataAlert = new DataAlert();
  row.dataPipelineId = ObjectID.generate();

  const pipeline: DataPipeline = new DataPipeline();

  if (jobName) {
    pipeline.jobName = jobName;
  }

  jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(row);
  jest.spyOn(AlertService, "findOneBy").mockResolvedValue(alertAt());
  jest.spyOn(DataPipelineRunService, "findBy").mockResolvedValue(runs);
  jest.spyOn(DataPipelineService, "findOneById").mockResolvedValue(pipeline);
}

async function read(): Promise<DataAlertExplanation | null> {
  return DataAlertExplanationReader.read({
    projectId: ObjectID.generate(),
    alertId: ObjectID.generate(),
  });
}

// Each worded cause's English is its sentence, filled with its values.
function expectEnglishIsItsSentence(causes: Array<DataAlertLikelyCause>): void {
  for (const cause of causes) {
    if (cause.titleWords) {
      expect(
        fillTemplate(
          DATA_ALERT_CAUSE_TITLES[cause.titleWords.code],
          cause.titleWords.values,
        ),
      ).toBe(cause.title);
    }
  }
}

describe("the likely cause of a data alert", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a failed run of the pipeline is the cause, with its error", async () => {
    stubAlertOfPipeline([
      runOf("COMPLETE"),
      runOf("FAIL", "relation \n orders does not exist"),
    ]);

    const explanation: DataAlertExplanation | null = await read();

    expect(explanation?.causes).toEqual([
      {
        kind: DataAlertCauseKind.FailedRun,
        title: "nightly_orders failed",
        titleWords: {
          code: DataAlertCauseTitleCode.PipelineFailed,
          values: { pipeline: "nightly_orders" },
        },
        detail: "relation orders does not exist",
        at: FAILED_AT.toISOString(),
      },
    ]);
  });

  test("a failed run of a pipeline with no name says a pipeline failed", async () => {
    stubAlertOfPipeline([runOf("FAIL")], "");

    const explanation: DataAlertExplanation | null = await read();

    expect(explanation?.causes).toEqual([
      {
        kind: DataAlertCauseKind.FailedRun,
        title: "A pipeline failed",
        titleWords: {
          code: DataAlertCauseTitleCode.UnnamedPipelineFailed,
          values: {},
        },
        at: FAILED_AT.toISOString(),
      },
    ]);
  });

  test("a run that finished is no cause", async () => {
    stubAlertOfPipeline([runOf("COMPLETE")]);

    const explanation: DataAlertExplanation | null = await read();

    expect(explanation?.causes).toEqual([]);
  });

  test("an alert that is not a data alert has no explanation", async () => {
    jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(null);

    await expect(read()).resolves.toBeNull();
  });
});

describe("an alert upstream", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubUpstream(upstream: Partial<Alert>): void {
    const row: DataAlert = new DataAlert();
    row.causeAlertId = ObjectID.generate();

    const cause: Alert = new Alert();
    Object.assign(cause, { createdAt: FAILED_AT, ...upstream });

    jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(row);
    jest
      .spyOn(AlertService, "findOneBy")
      .mockImplementation(async (options: unknown): Promise<Alert> => {
        const query: { _id?: unknown } = (
          options as { query: { _id?: unknown } }
        ).query;

        return query._id ? cause : alertAt();
      });
  }

  test("is titled with its number and title, as written: a record's own words", async () => {
    stubUpstream({ alertNumberWithPrefix: "#42", title: "raw.orders is late" });

    const explanation: DataAlertExplanation | null = await read();

    expect(explanation?.causes).toEqual([
      {
        kind: DataAlertCauseKind.UpstreamAlert,
        title: "#42 raw.orders is late",
        at: FAILED_AT.toISOString(),
      },
    ]);
    expect(explanation?.causes[0]?.titleWords).toBeUndefined();
  });

  test("a private one names nothing of itself, in a sentence the reader's language says", async () => {
    stubUpstream({
      alertNumberWithPrefix: "#43",
      title: "Payroll export is late",
      isPrivate: true,
    });

    const explanation: DataAlertExplanation | null = await read();

    expect(explanation?.causes).toEqual([
      {
        kind: DataAlertCauseKind.UpstreamAlert,
        title: "A private alert upstream",
        titleWords: {
          code: DataAlertCauseTitleCode.PrivateUpstreamAlert,
          values: {},
        },
        at: FAILED_AT.toISOString(),
      },
    ]);
    expect(JSON.stringify(explanation?.causes)).not.toContain("Payroll");
  });
});

describe("the database and the table's writers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubTable(data: {
    store?: Partial<DataStore> | undefined;
    server?: Partial<DatabaseServer> | undefined;
    writers?: Array<Partial<DataAssetUsage>> | undefined;
    exceptions?:
      | Array<{ serviceName: string; type: string; message: string }>
      | undefined;
    feedLines?: Array<string> | undefined;
  }): void {
    const row: DataAlert = new DataAlert();
    row.dataAssetId = ObjectID.generate();
    row.dataStoreId = ObjectID.generate();

    jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(row);
    jest.spyOn(AlertService, "findOneBy").mockResolvedValue(alertAt());
    jest.spyOn(DataAssetLineageService, "findBy").mockResolvedValue([]);
    jest.spyOn(DataAssetService, "findOneById").mockResolvedValue(null);
    jest.spyOn(DataAssetService, "findBy").mockResolvedValue([]);
    jest.spyOn(ChangeEventService, "findBy").mockResolvedValue([]);
    jest.spyOn(DataAssetOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(DataAssetOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(DataTableDashboards, "find").mockResolvedValue([]);
    jest.spyOn(DataTableErrors, "read").mockResolvedValue({
      services: [],
      exceptions: (data.exceptions || []).map(
        (exception: { serviceName: string; type: string; message: string }) => {
          return {
            id: "e1",
            count: 12,
            lastSeenAt: FAILED_AT.toISOString(),
            ...exception,
          };
        },
      ),
      logs: [],
    });
    jest
      .spyOn(DataAssetUsageService, "findBy")
      .mockImplementation(async (options: unknown): Promise<Array<never>> => {
        const query: { accessKind?: unknown } = (
          options as { query: { accessKind?: unknown } }
        ).query;

        if (query.accessKind !== DataAssetAccessKind.Write) {
          return [];
        }

        return (data.writers || []).map(
          (writer: Partial<DataAssetUsage>): DataAssetUsage => {
            const usage: DataAssetUsage = new DataAssetUsage();
            Object.assign(usage, { lastSeenAt: FAILED_AT, ...writer });
            return usage;
          },
        ) as Array<never>;
      });
    jest.spyOn(DataAssetFeedService, "findBy").mockResolvedValue(
      (data.feedLines || []).map((line: string) => {
        return { feedInfoInMarkdown: line, postedAt: FAILED_AT } as never;
      }),
    );
    jest.spyOn(DataStoreService, "findOneBy").mockResolvedValue(
      data.store
        ? (Object.assign(new DataStore(), {
            tableHealthCollectedAt: FAILED_AT,
            ...data.store,
          }) as DataStore)
        : null,
    );
    jest.spyOn(DatabaseServerService, "findOneBy").mockResolvedValue(
      data.server
        ? (Object.assign(new DatabaseServer(), {
            engineReadingsAt: FAILED_AT,
            ...data.server,
          }) as DatabaseServer)
        : null,
    );
  }

  test("a database that could not be read, and the server under it unwell", async () => {
    stubTable({
      store: {
        name: "orders-db",
        tableHealthStatus: TableHealthStatus.Failed,
        tableHealthMessage: "password authentication failed",
        databaseServerId: ObjectID.generate(),
      },
      server: { name: "pg-main", engineHealth: "degraded" },
    });

    const causes: Array<DataAlertLikelyCause> = (await read())!.causes;

    expect(causes).toEqual([
      {
        kind: DataAlertCauseKind.Database,
        title: "orders-db could not be read",
        titleWords: {
          code: DataAlertCauseTitleCode.DatabaseUnreadable,
          values: { database: "orders-db" },
        },
        detail: "password authentication failed",
        at: FAILED_AT.toISOString(),
      },
      {
        kind: DataAlertCauseKind.Database,
        title: "pg-main is degraded",
        titleWords: {
          code: DataAlertCauseTitleCode.ServerDegraded,
          values: { server: "pg-main" },
        },
        at: FAILED_AT.toISOString(),
      },
    ]);
    expectEnglishIsItsSentence(causes);
  });

  test("an unhealthy server, with a healthy one no cause", async () => {
    stubTable({
      store: { name: "orders-db", databaseServerId: ObjectID.generate() },
      server: { name: "pg-main", engineHealth: "unhealthy" },
    });

    expect((await read())!.causes).toEqual([
      {
        kind: DataAlertCauseKind.Database,
        title: "pg-main is unhealthy",
        titleWords: {
          code: DataAlertCauseTitleCode.ServerUnhealthy,
          values: { server: "pg-main" },
        },
        at: FAILED_AT.toISOString(),
      },
    ]);

    jest.restoreAllMocks();
    stubTable({
      store: { name: "orders-db", databaseServerId: ObjectID.generate() },
      server: { name: "pg-main", engineHealth: "healthy" },
    });

    expect((await read())!.causes).toEqual([]);
  });

  test("a writer's failed writes and its errors that name the table, worded with their names and counts", async () => {
    stubTable({
      writers: [
        { serviceName: "orders-api", errorCount: 3, callCount: 120 },
        { serviceName: "billing-worker", errorCount: 0, callCount: 50 },
      ],
      exceptions: [
        {
          serviceName: "orders-api",
          type: "PSQLException",
          message: "duplicate key value violates unique constraint",
        },
      ],
    });

    const causes: Array<DataAlertLikelyCause> = (await read())!.causes;

    expect(causes).toEqual([
      {
        kind: DataAlertCauseKind.FailingWrites,
        title: "orders-api keeps raising PSQLException naming this table",
        titleWords: {
          code: DataAlertCauseTitleCode.ServiceRaisesError,
          values: { service: "orders-api", error: "PSQLException" },
        },
        detail: "duplicate key value violates unique constraint",
        at: FAILED_AT.toISOString(),
      },
      {
        kind: DataAlertCauseKind.FailingWrites,
        title: "orders-api: 3 of 120 writes failed",
        titleWords: {
          code: DataAlertCauseTitleCode.WritesFailed,
          values: { service: "orders-api", failed: 3, total: 120 },
        },
        at: FAILED_AT.toISOString(),
      },
    ]);
    expectEnglishIsItsSentence(causes);
  });

  test("a schema change: the feed's line as written, or that a column changed", async () => {
    stubTable({
      feedLines: [
        mdText`Column **${"customer_id"}** (${FeedMarkdown.code("int_4")}) was removed.`.toString(),
        "",
      ],
    });

    const causes: Array<DataAlertLikelyCause> = (await read())!.causes;

    expect(causes).toEqual([
      {
        kind: DataAlertCauseKind.SchemaChange,
        // Every letter of the column's and its type's names (#8343).
        title: "Column customer_id (int_4) was removed.",
        at: FAILED_AT.toISOString(),
      },
      {
        kind: DataAlertCauseKind.SchemaChange,
        title: "A column changed",
        titleWords: {
          code: DataAlertCauseTitleCode.ColumnChanged,
          values: {},
        },
        at: FAILED_AT.toISOString(),
      },
    ]);
  });

  test("every cause the server words is answered over the API as plain JSON", async () => {
    stubTable({
      store: {
        name: "orders-db",
        tableHealthStatus: TableHealthStatus.Failed,
      },
      writers: [{ serviceName: "orders-api", errorCount: 1, callCount: 1 }],
    });

    const causes: Array<DataAlertLikelyCause> = (await read())!.causes;

    expect(JSON.parse(JSON.stringify(causes))).toEqual(causes);
    expect(causes.length).toBe(2);
  });
});

/*
 * A schema change's cause is its table's feed line, as plain words. The
 * reader stripped every "_" and "*" from it, so a removed customer_id
 * column read "customerid", its int_4 type "int4".
 */
describe("a feed line as plain text", () => {
  test("keeps every letter of a name: underscores, and a mark a value escaped", () => {
    expect(
      getFeedLineAsPlainText(
        mdText`Column **${"customer_id"}** (${FeedMarkdown.code("int_4")}) was removed.`.toString(),
      ),
    ).toBe("Column customer_id (int_4) was removed.");
    expect(
      getFeedLineAsPlainText(
        mdText`Column **${"a*b"}** was renamed to **${"order__total"}**.`.toString(),
      ),
    ).toBe("Column a*b was renamed to order__total.");
  });

  test("drops bold and code marks, and reads a link as its words", () => {
    expect(
      getFeedLineAsPlainText(
        "Column **status** changed type from `text` to `varchar`.",
      ),
    ).toBe("Column status changed type from text to varchar.");
    expect(
      getFeedLineAsPlainText("See [the orders table](/tables/1) for more."),
    ).toBe("See the orders table for more.");
  });

  test("an escaped bracket is no link, and a backslash a value escaped stays one", () => {
    const line: string = mdText`Column **${"a[b](c)"}** was added.`.toString();

    expect(getFeedLineAsPlainText(line)).toBe("Column a[b](c) was added.");
    expect(
      getFeedLineAsPlainText(mdText`Path **${"C:\\data"}** moved.`.toString()),
    ).toBe("Path C:\\data moved.");
  });

  test("leaves plain words as they are", () => {
    expect(getFeedLineAsPlainText("A column changed")).toBe("A column changed");
    expect(getFeedLineAsPlainText("")).toBe("");
  });
});
