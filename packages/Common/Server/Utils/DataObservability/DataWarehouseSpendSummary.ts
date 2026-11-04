import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataWarehouseJob from "../../../Models/DatabaseModels/DataWarehouseJob";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { UNUSED_AFTER_DAYS } from "../../../Types/DataObservability/DataAssetReads";
import {
  DataObservabilitySpendSummary,
  DataObservabilitySpendTable,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataWarehouseJobService from "../../Services/DataWarehouseJobService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * WHAT A PROJECT'S WAREHOUSES SPENT OVER THE LAST DAY, AT A GLANCE.
 *
 * The totals of credits (Snowflake) and bytes billed (BigQuery), by team -
 * the team a job's tag or label names, else whoever runs it - the tables
 * whose writes cost the most, and what is spent on jobs that fail or that
 * write only tables nobody has read for 90 days.
 */

const MAX_JOBS_READ: number = 10_000;
const MAX_TABLES_LISTED: number = 20;
const MAX_TEAMS_LISTED: number = 10;

type SpendTableRow = Pick<
  DataAsset,
  | "_id"
  | "assetKey"
  | "name"
  | "dataStoreName"
  | "writeCredits"
  | "writeBytesBilled"
  | "unreadSince"
>;

export function summarizeWarehouseSpend(data: {
  jobs: Array<
    Pick<
      DataWarehouseJob,
      | "team"
      | "userName"
      | "credits"
      | "bytesBilled"
      | "failedRunCount"
      | "writesOnlyUnusedTables"
    >
  >;
  tables: Array<
    Pick<
      DataAsset,
      | "_id"
      | "assetKey"
      | "name"
      | "dataStoreName"
      | "writeCredits"
      | "writeBytesBilled"
      | "unreadSince"
    >
  >;
  now: Date;
}): DataObservabilitySpendSummary {
  const byTeam: Map<
    string,
    { credits: number; bytesBilled: number; jobCount: number }
  > = new Map();
  const summary: DataObservabilitySpendSummary = {
    credits: 0,
    bytesBilled: 0,
    jobCount: data.jobs.length,
    failingJobCount: 0,
    unusedJobCount: 0,
    unusedCredits: 0,
    unusedBytesBilled: 0,
    byTeam: [],
    topTables: [],
  };

  for (const job of data.jobs) {
    const credits: number = Number(job.credits) || 0;
    const bytesBilled: number = Number(job.bytesBilled) || 0;
    const team: string = job.team || job.userName || "Unassigned";
    const entry: { credits: number; bytesBilled: number; jobCount: number } =
      byTeam.get(team) || { credits: 0, bytesBilled: 0, jobCount: 0 };

    summary.credits += credits;
    summary.bytesBilled += bytesBilled;

    if ((job.failedRunCount || 0) > 0) {
      summary.failingJobCount++;
    }

    if (job.writesOnlyUnusedTables) {
      summary.unusedJobCount++;
      summary.unusedCredits += credits;
      summary.unusedBytesBilled += bytesBilled;
    }

    entry.credits += credits;
    entry.bytesBilled += bytesBilled;
    entry.jobCount++;
    byTeam.set(team, entry);
  }

  const cutoff: number =
    data.now.getTime() - UNUSED_AFTER_DAYS * 24 * 60 * 60 * 1000;

  type TeamSpend = DataObservabilitySpendSummary["byTeam"][number];

  summary.byTeam = Array.from(byTeam.entries())
    .map(
      ([team, entry]: [
        string,
        { credits: number; bytesBilled: number; jobCount: number },
      ]): TeamSpend => {
        return { team, ...entry };
      },
    )
    .sort((a: TeamSpend, b: TeamSpend) => {
      return b.credits - a.credits || b.bytesBilled - a.bytesBilled;
    })
    .slice(0, MAX_TEAMS_LISTED);

  summary.topTables = data.tables
    .map((table: SpendTableRow): DataObservabilitySpendTable => {
      return {
        dataAssetId: table._id?.toString() || "",
        table: table.assetKey || table.name || "",
        database: table.dataStoreName || "",
        credits: table.writeCredits ?? null,
        bytesBilled: table.writeBytesBilled ?? null,
        isUnused: Boolean(
          table.unreadSince && new Date(table.unreadSince).getTime() <= cutoff,
        ),
      };
    })
    .filter((table: DataObservabilitySpendTable): boolean => {
      return Boolean(table.dataAssetId);
    })
    .sort((a: DataObservabilitySpendTable, b: DataObservabilitySpendTable) => {
      return (
        (b.credits || 0) - (a.credits || 0) ||
        (b.bytesBilled || 0) - (a.bytesBilled || 0)
      );
    })
    .slice(0, MAX_TABLES_LISTED);

  return summary;
}

export default class DataWarehouseSpendSummary {
  public static async read(
    projectId: ObjectID,
    now: Date,
  ): Promise<DataObservabilitySpendSummary> {
    const tableSelect: {
      _id: true;
      assetKey: true;
      name: true;
      dataStoreName: true;
      writeCredits: true;
      writeBytesBilled: true;
      unreadSince: true;
    } = {
      _id: true,
      assetKey: true,
      name: true,
      dataStoreName: true,
      writeCredits: true,
      writeBytesBilled: true,
      unreadSince: true,
    };
    const [jobs, byCredits, byBytes] = await Promise.all([
      DataWarehouseJobService.findBy({
        query: { projectId },
        select: {
          team: true,
          userName: true,
          credits: true,
          bytesBilled: true,
          failedRunCount: true,
          writesOnlyUnusedTables: true,
        },
        limit: MAX_JOBS_READ,
        skip: 0,
        props: { isRoot: true },
      }),
      DataAssetService.findBy({
        query: { projectId, writeCredits: QueryHelper.notNull() },
        select: tableSelect,
        sort: { writeCredits: SortOrder.Descending },
        limit: MAX_TABLES_LISTED,
        skip: 0,
        props: { isRoot: true },
      }),
      DataAssetService.findBy({
        query: { projectId, writeBytesBilled: QueryHelper.notNull() },
        select: tableSelect,
        sort: { writeBytesBilled: SortOrder.Descending },
        limit: MAX_TABLES_LISTED,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);
    const tables: Map<string, DataAsset> = new Map();

    for (const table of [...byCredits, ...byBytes]) {
      tables.set(table._id?.toString() || "", table);
    }

    return summarizeWarehouseSpend({
      jobs,
      tables: Array.from(tables.values()),
      now,
    });
  }
}
