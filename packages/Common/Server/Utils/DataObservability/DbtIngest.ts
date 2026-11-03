import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import { DataCheckType } from "../../../Types/DataObservability/DataCheckType";
import {
  DataAssetDbtNode,
  DBT_TABLE_RESOURCE_TYPES,
} from "../../../Types/DataObservability/DbtArtifact";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import DataCheckIngest, { buildCheckMetricRow } from "./DataCheckIngest";
import { matchDataset } from "./DatasetMatching";
import {
  DbtInvocationOutcome,
  DbtManifest,
  DbtNodeResult,
  DbtResultStatus,
  DbtRunResults,
  DbtTable,
  DbtTest,
  getDbtDataset,
  getDbtInvocationOutcome,
  getDbtTestCheckName,
  getDbtTestValue,
  MAX_DBT_NODES,
} from "./DbtArtifacts";
import { OpenLineageRunEvent, OpenLineageRunState } from "./OpenLineageEvent";
import OpenLineageIngest, { ProjectCatalog } from "./OpenLineageIngest";
import { UsageAsset, UsageStore } from "./TableUsageMatching";

/*
 * WHAT DBT'S ARTIFACTS SAY, KEPT.
 *
 * A dbt project is a pipeline (namespace "dbt", its project's name), and
 * each invocation whose run results are uploaded is one of its runs - through
 * the same path as an OpenLineage run, so it has run history, a learned
 * duration and schedule, and the recommended pipeline alerts. Of the
 * manifest, each model, seed, snapshot and source that is a watched table
 * (DatasetMatching) records what dbt says of it, and what each is built from
 * becomes lineage through the project's pipeline. Each test of a watched
 * table is a check of type dbt Test, run by dbt and never by OneUptime: its
 * results are written as the check's value - the rows it found failing - so
 * its alert works as every check's does.
 */

export const DBT_PIPELINE_NAMESPACE: string = "dbt";

// How often OneUptime counts a dbt test as running, for its alert's window.
export const DBT_TEST_INTERVAL_IN_MINUTES: number = 1440;

// The most lineage edges one upload writes.
export const MAX_DBT_LINEAGE_EDGES: number = 10_000;

export interface DbtIngestSummary {
  projectName: string;
  tables: number;
  matchedTables: number;
  tests: number;
  matchedTests: number;
  testResults: number;
  // How the uploaded invocation went: COMPLETE or FAIL; null without run results.
  run: string | null;
}

// What a test's result is called on its check.
export function getDbtTestRunStatus(
  status: DbtResultStatus | null,
): string | null {
  switch (status) {
    case DbtResultStatus.Pass:
    case DbtResultStatus.Success:
      return "Passed";
    case DbtResultStatus.Fail:
      return "Failed";
    case DbtResultStatus.Warn:
      return "Warned";
    case DbtResultStatus.Error:
      return "Errored";
    default:
      // Skipped: the test did not run, so its last result stands.
      return null;
  }
}

// What a test's check holds of it: what dbt decides, never what a person set.
export interface DbtTestCheckFields {
  name: string;
  description: string | null;
  columnName: string | null;
  acceptedValues: Array<string> | null;
  customSql: string | null;
}

export function getDbtTestCheckFields(test: DbtTest): DbtTestCheckFields {
  const facts: Array<string> = [
    test.testName ? `dbt test ${test.testName}` : "dbt singular test",
    test.columnName ? `on ${test.columnName}` : "",
    test.severity ? `(severity ${test.severity})` : "",
  ].filter(Boolean);

  return {
    name: getDbtTestCheckName(test),
    description: (test.description || `${facts.join(" ")}.`).slice(0, 500),
    columnName: test.columnName ? test.columnName.slice(0, 100) : null,
    acceptedValues: test.acceptedValues,
    customSql: test.compiledCode,
  };
}

// The node dbt says a table is, and how its last build went.
export function buildDataAssetDbtNode(data: {
  table: DbtTable;
  projectName: string;
  result: DbtNodeResult | undefined;
  readAt: Date;
}): DataAssetDbtNode {
  const { table, result } = data;

  return {
    uniqueId: table.uniqueId,
    resourceType: table.resourceType,
    projectName: data.projectName,
    packageName: table.packageName,
    materialized: table.materialized,
    path: table.path,
    tags: table.tags,
    owner: table.owner,
    readAt: data.readAt.toISOString(),
    lastRun:
      result && result.status
        ? {
            status: result.status,
            completedAt: result.completedAt
              ? result.completedAt.toISOString()
              : null,
            executionTimeInSeconds: result.executionTimeInSeconds,
            message: result.message,
          }
        : null,
  };
}

// The invocation as the run of the project's pipeline: its start, and its end.
export function getDbtInvocationEvents(data: {
  projectName: string;
  runResults: DbtRunResults;
}): Array<OpenLineageRunEvent> {
  if (!data.runResults.invocationId) {
    return [];
  }

  const outcome: DbtInvocationOutcome = getDbtInvocationOutcome(
    data.runResults,
  );
  const run: Omit<
    OpenLineageRunEvent,
    "eventType" | "eventTime" | "errorMessage"
  > = {
    runId: data.runResults.invocationId,
    jobNamespace: DBT_PIPELINE_NAMESPACE,
    jobName: data.projectName,
    scheduledAt: null,
    // Its lineage is the manifest's, edge by edge, not every input to every output.
    inputs: [],
    outputs: [],
  };

  return [
    {
      ...run,
      eventType: OpenLineageRunState.Start,
      eventTime: outcome.startedAt,
      errorMessage: null,
    },
    {
      ...run,
      eventType: outcome.state,
      eventTime: outcome.endedAt,
      errorMessage: outcome.errorMessage,
    },
  ];
}

export default class DbtIngest {
  public static async ingest(data: {
    projectId: ObjectID;
    manifest: DbtManifest | null;
    runResults: DbtRunResults | null;
    projectName: string | null;
    now: Date;
  }): Promise<DbtIngestSummary> {
    const projectName: string | null =
      data.manifest?.projectName || data.projectName;

    if (!projectName) {
      throw new BadDataException(
        "Name the dbt project: send its manifest, or the project's name.",
      );
    }

    const summary: DbtIngestSummary = {
      projectName,
      tables: data.manifest?.tables.size || 0,
      matchedTables: 0,
      tests: data.manifest?.tests.length || 0,
      matchedTests: 0,
      testResults: 0,
      run: null,
    };
    const catalog: ProjectCatalog = await OpenLineageIngest.readCatalog(
      data.projectId,
    );
    const pipeline: DataPipeline = await OpenLineageIngest.upsertPipeline(
      data.projectId,
      {
        eventType: OpenLineageRunState.Other,
        eventTime: data.now,
        runId: null,
        jobNamespace: DBT_PIPELINE_NAMESPACE,
        jobName: projectName,
        errorMessage: null,
        scheduledAt: null,
        inputs: [],
        outputs: [],
      },
    );

    if (data.runResults) {
      const events: Array<OpenLineageRunEvent> = getDbtInvocationEvents({
        projectName,
        runResults: data.runResults,
      });

      if (events.length > 0) {
        await OpenLineageIngest.ingest({
          projectId: data.projectId,
          events,
          now: data.now,
        });
        summary.run = events[events.length - 1]!.eventType;
      }
    }

    const results: Map<string, DbtNodeResult> = new Map();

    for (const result of data.runResults?.results || []) {
      results.set(result.uniqueId, result);
    }

    // Each table dbt names that is a watched one, by its unique id.
    const matched: Map<string, UsageAsset> = new Map();

    if (data.manifest) {
      for (const table of data.manifest.tables.values()) {
        const asset: UsageAsset | null = this.matchTable(
          data.manifest.adapterType,
          table,
          catalog,
        );

        if (asset) {
          matched.set(table.uniqueId, asset);
        }
      }

      summary.matchedTables = matched.size;

      await this.recordTables({
        projectId: data.projectId,
        manifest: data.manifest,
        projectName,
        matched,
        results,
        pipeline,
        now: data.now,
      });
    }

    const tests: { matched: number; results: number } = await this.recordTests({
      projectId: data.projectId,
      manifest: data.manifest,
      runResults: data.runResults,
      matched,
      catalog,
    });

    summary.matchedTests = tests.matched;
    summary.testResults = tests.results;

    return summary;
  }

  private static matchTable(
    adapterType: string | null,
    table: DbtTable,
    catalog: ProjectCatalog,
  ): UsageAsset | null {
    const dataset: ReturnType<typeof getDbtDataset> = getDbtDataset(
      adapterType,
      table,
    );

    return dataset
      ? matchDataset({
          dataset,
          stores: catalog.stores,
          assets: catalog.assets,
        })
      : null;
  }

  private static async recordTables(data: {
    projectId: ObjectID;
    manifest: DbtManifest;
    projectName: string;
    matched: Map<string, UsageAsset>;
    results: Map<string, DbtNodeResult>;
    pipeline: DataPipeline;
    now: Date;
  }): Promise<void> {
    const ids: Array<string> = Array.from(
      new Set(
        Array.from(data.matched.values()).map((asset: UsageAsset): string => {
          return asset.dataAssetId;
        }),
      ),
    );
    const described: Set<string> = new Set();

    // A description a person wrote stands: dbt's fills only an empty one.
    for (let start: number = 0; start < ids.length; start += 500) {
      const assets: Array<DataAsset> = await DataAssetService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(ids.slice(start, start + 500)),
        },
        select: { _id: true, description: true },
        limit: 500,
        skip: 0,
        props: { isRoot: true },
      });

      for (const asset of assets) {
        if (asset.id && asset.description) {
          described.add(asset.id.toString());
        }
      }
    }

    let edges: number = 0;

    for (const [uniqueId, asset] of data.matched) {
      const table: DbtTable = data.manifest.tables.get(uniqueId)!;

      try {
        await DataAssetService.updateColumnsByIdWithoutHooks({
          id: new ObjectID(asset.dataAssetId),
          data: {
            dbtNode: buildDataAssetDbtNode({
              table,
              projectName: data.projectName,
              result: data.results.get(uniqueId),
              readAt: data.now,
            }),
            ...(table.description && !described.has(asset.dataAssetId)
              ? { description: table.description }
              : {}),
          } as never,
        });
        described.add(asset.dataAssetId);

        // A source is read by the project, never written by it.
        if (!DBT_TABLE_RESOURCE_TYPES.includes(table.resourceType)) {
          continue;
        }

        const upstreams: Array<string | null> = [null];

        for (const dependency of table.dependsOn) {
          const upstream: UsageAsset | undefined = data.matched.get(dependency);

          if (upstream && upstream.dataAssetId !== asset.dataAssetId) {
            upstreams.push(upstream.dataAssetId);
          }
        }

        for (const upstreamDataAssetId of upstreams) {
          if (edges >= MAX_DBT_LINEAGE_EDGES) {
            break;
          }

          await OpenLineageIngest.upsertLineage({
            projectId: data.projectId,
            upstreamDataAssetId,
            downstreamDataAssetId: asset.dataAssetId,
            pipelineId: data.pipeline.id!,
            at: data.now,
          });
          edges++;
        }
      } catch (error) {
        logger.error(
          `Data Observability: could not record dbt node ${uniqueId} of project ${data.projectId.toString()}`,
        );
        logger.error(error);
      }
    }
  }

  private static async recordTests(data: {
    projectId: ObjectID;
    manifest: DbtManifest | null;
    runResults: DbtRunResults | null;
    matched: Map<string, UsageAsset>;
    catalog: ProjectCatalog;
  }): Promise<{ matched: number; results: number }> {
    const checks: Array<DataCheck> = await DataCheckService.findBy({
      query: { projectId: data.projectId, checkType: DataCheckType.DbtTest },
      select: {
        _id: true,
        externalId: true,
        dataAssetId: true,
        checkType: true,
        name: true,
        description: true,
        columnName: true,
        acceptedValues: true,
        customSql: true,
        isEnabled: true,
      },
      limit: MAX_DBT_NODES,
      skip: 0,
      props: { isRoot: true },
    });
    const byTest: Map<string, DataCheck> = new Map();
    let matchedTests: number = 0;

    for (const check of checks) {
      if (check.externalId) {
        byTest.set(check.externalId, check);
      }
    }

    for (const test of data.manifest?.tests || []) {
      const asset: UsageAsset | undefined = test.attachedNode
        ? data.matched.get(test.attachedNode)
        : undefined;

      if (!asset) {
        continue;
      }

      matchedTests++;

      try {
        const check: DataCheck | null = await this.upsertTestCheck({
          projectId: data.projectId,
          test,
          asset,
          existing: byTest.get(test.uniqueId),
        });

        if (check) {
          byTest.set(test.uniqueId, check);
        }
      } catch (error) {
        logger.error(
          `Data Observability: could not record dbt test ${test.uniqueId} of project ${data.projectId.toString()}`,
        );
        logger.error(error);
      }
    }

    const results: number = data.runResults
      ? await this.recordTestResults({
          projectId: data.projectId,
          runResults: data.runResults,
          byTest,
          catalog: data.catalog,
        })
      : 0;

    return { matched: matchedTests, results };
  }

  private static async upsertTestCheck(data: {
    projectId: ObjectID;
    test: DbtTest;
    asset: UsageAsset;
    existing: DataCheck | undefined;
  }): Promise<DataCheck | null> {
    const fields: DbtTestCheckFields = getDbtTestCheckFields(data.test);

    if (data.existing?.id) {
      const changed: boolean =
        data.existing.dataAssetId?.toString() !== data.asset.dataAssetId ||
        data.existing.name !== fields.name ||
        (data.existing.description || null) !== fields.description ||
        (data.existing.columnName || null) !== fields.columnName ||
        (data.existing.customSql || null) !== fields.customSql ||
        JSON.stringify(data.existing.acceptedValues || null) !==
          JSON.stringify(fields.acceptedValues);

      if (changed) {
        await DataCheckService.updateColumnsByIdWithoutHooks({
          id: data.existing.id,
          data: {
            ...fields,
            dataAssetId: new ObjectID(data.asset.dataAssetId),
            dataStoreId: new ObjectID(data.asset.dataStoreId),
          } as never,
        });
      }

      return data.existing;
    }

    const check: DataCheck = new DataCheck();
    check.projectId = data.projectId;
    check.dataAssetId = new ObjectID(data.asset.dataAssetId);
    check.checkType = DataCheckType.DbtTest;
    check.externalId = data.test.uniqueId;
    check.name = fields.name;
    check.intervalInMinutes = DBT_TEST_INTERVAL_IN_MINUTES;
    check.isEnabled = true;

    if (fields.description) {
      check.description = fields.description;
    }

    if (fields.columnName) {
      check.columnName = fields.columnName;
    }

    if (fields.acceptedValues) {
      check.acceptedValues = fields.acceptedValues;
    }

    if (fields.customSql) {
      check.customSql = fields.customSql;
    }

    return await DataCheckService.create({
      data: check,
      props: { isRoot: true },
    });
  }

  private static async recordTestResults(data: {
    projectId: ObjectID;
    runResults: DbtRunResults;
    byTest: Map<string, DataCheck>;
    catalog: ProjectCatalog;
  }): Promise<number> {
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    const assets: Map<string, UsageAsset> = new Map();
    const stores: Map<string, UsageStore> = new Map();
    const rows: Array<JSONObject> = [];
    let recorded: number = 0;

    for (const asset of data.catalog.assets) {
      assets.set(asset.dataAssetId, asset);
    }

    for (const store of data.catalog.stores) {
      stores.set(store.dataStoreId, store);
    }

    for (const result of data.runResults.results) {
      const check: DataCheck | undefined = data.byTest.get(result.uniqueId);
      const status: string | null = getDbtTestRunStatus(result.status);

      // A test turned off on its check keeps no result.
      if (!check?.id || !status || check.isEnabled === false) {
        continue;
      }

      const value: number | null = getDbtTestValue(result);
      const ranAt: Date = result.completedAt || data.runResults.generatedAt;

      try {
        await DataCheckService.updateColumnsByIdWithoutHooks({
          id: check.id,
          data: {
            lastRunAt: ranAt,
            lastRunStatus: status,
            lastRunMessage: result.message,
            ...(value !== null ? { lastValue: value } : {}),
          } as never,
        });
        recorded++;
      } catch (error) {
        logger.error(
          `Data Observability: could not record the result of dbt test ${result.uniqueId}`,
        );
        logger.error(error);
        continue;
      }

      const asset: UsageAsset | undefined = check.dataAssetId
        ? assets.get(check.dataAssetId.toString())
        : undefined;
      const store: UsageStore | undefined = asset
        ? stores.get(asset.dataStoreId)
        : undefined;

      if (value === null || !asset || !store) {
        continue;
      }

      const table: DataAsset = new DataAsset();
      table.id = new ObjectID(asset.dataAssetId);
      table.schemaName = asset.schemaName;
      table.name = asset.name;

      rows.push(
        buildCheckMetricRow({
          store: {
            id: new ObjectID(store.dataStoreId),
            projectId: data.projectId,
            name: data.catalog.storeNames.get(store.dataStoreId) || "",
            kind: store.kind,
          },
          asset: table,
          check,
          value: { segment: null, value },
          collectedAt: ranAt,
          retentionDays,
        }),
      );
    }

    await DataCheckIngest.writeCheckMetricRows(data.projectId, rows);

    return recorded;
  }
}
