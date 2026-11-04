import Alert from "../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import DataTableDashboards, { TableDashboard } from "./Bi/DataTableDashboards";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "../../../Types/DataObservability/DataAssetFreshness";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetService from "../../Services/DataAssetService";
import DataProductService from "../../Services/DataProductService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * "IS THIS TABLE FRESH?" - ONE ANSWER, FOR AN AI AGENT, SLACK AND TEAMS.
 *
 * The people and agents who use data ask it in a sentence; the answer is
 * what Data Observability already knows of the table: whether it is fresh
 * by its own rhythm (DataAssetFreshness) - when it last changed, how often
 * it usually does, how late it is - its open alerts, the pipelines that
 * write it with how their latest run went, and the data products it is
 * part of with their status. A table is found by its id, its
 * schema.table key, or its name alone; a name several databases share
 * answers with every match, so nobody is told the wrong table is fresh.
 */

// The most tables a reference answers with, and the most of each list told.
export const MAX_TABLES_ANSWERED: number = 5;
const MAX_LISTED: number = 5;

export interface DataTableAnswer {
  dataAssetId: string;
  table: string;
  database: string;
  freshness: DataAssetFreshness;
  lastChangedAt: Date | null;
  usualIntervalInSeconds: number | null;
  lateBySeconds: number;
  rowCount: number | null;
  isDropped: boolean;
  openAlerts: Array<{
    alertId: string;
    title: string;
    number: string | null;
    state: string | null;
  }>;
  writerPipelines: Array<{
    name: string;
    lastRunState: string | null;
    lastRunStartedAt: Date | null;
    lastErrorMessage: string | null;
  }>;
  dataProducts: Array<{ name: string; status: string | null }>;
  // The BI dashboards built on it, or on a table built from it; unset before BI tools were read.
  dashboards?:
    | Array<{ name: string; tool: string; via: string | null }>
    | undefined;
}

// "every 15 minutes", "every 2 hours", "every day".
export function describeInterval(seconds: number): string {
  const minutes: number = Math.max(1, Math.round(seconds / 60));

  if (minutes < 60) {
    return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
  }

  const hours: number = Math.round(minutes / 60);

  if (hours < 24) {
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }

  const days: number = Math.round(hours / 24);

  return days === 1 ? "every day" : `every ${days} days`;
}

// "12 minutes", "6 hours", "3 days": how long, as a sentence says it.
export function describeDuration(seconds: number): string {
  const minutes: number = Math.max(1, Math.round(seconds / 60));

  if (minutes < 60) {
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  const hours: number = Math.round(minutes / 60);

  if (hours < 48) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  return `${Math.round(hours / 24)} days`;
}

/*
 * The answer in a few plain sentences, for an agent to read or a person in
 * a chat: the verdict first, then why, then what to look at.
 */
export function formatDataTableAnswer(
  answer: DataTableAnswer,
  now: Date,
): string {
  const name: string = `${answer.table}${answer.database ? ` (${answer.database})` : ""}`;
  const lines: Array<string> = [];
  const ago: string | null = answer.lastChangedAt
    ? `${describeDuration((now.getTime() - answer.lastChangedAt.getTime()) / 1000)} ago`
    : null;
  const usually: string = answer.usualIntervalInSeconds
    ? `; it usually changes ${describeInterval(answer.usualIntervalInSeconds)}`
    : "";

  if (answer.isDropped) {
    lines.push(`${name} is gone from its database: it was dropped.`);
  } else if (answer.freshness === DataAssetFreshness.Fresh) {
    lines.push(`${name} is fresh: it last changed ${ago}${usually}.`);
  } else if (answer.freshness === DataAssetFreshness.Late) {
    lines.push(
      `${name} is late by ${describeDuration(answer.lateBySeconds)}: it last changed ${ago}${usually}.`,
    );
  } else if (answer.freshness === DataAssetFreshness.NotApplicable) {
    lines.push(
      `${name} is a view: it holds no rows of its own, so it is as fresh as the tables it reads.`,
    );
  } else {
    lines.push(
      ago
        ? `${name} last changed ${ago}; how often it usually changes is not known yet, so it is not called fresh or late.`
        : `${name} has not been seen changing yet, so whether it is fresh is not known.`,
    );
  }

  if (answer.openAlerts.length > 0) {
    lines.push(
      `Open alerts: ${answer.openAlerts
        .map((alert: DataTableAnswer["openAlerts"][number]) => {
          return `${alert.number ? `${alert.number} ` : ""}${alert.title}${alert.state ? ` (${alert.state})` : ""}`;
        })
        .join("; ")}.`,
    );
  } else {
    lines.push("No open alert on it.");
  }

  for (const pipeline of answer.writerPipelines) {
    const when: string = pipeline.lastRunStartedAt
      ? ` ${describeDuration((now.getTime() - pipeline.lastRunStartedAt.getTime()) / 1000)} ago`
      : "";

    if (pipeline.lastRunState === "FAIL" || pipeline.lastRunState === "ABORT") {
      lines.push(
        `Its writer, the pipeline ${pipeline.name}, failed its last run${when}${pipeline.lastErrorMessage ? `: ${pipeline.lastErrorMessage}` : "."}`,
      );
    } else if (pipeline.lastRunState) {
      lines.push(
        `Its writer, the pipeline ${pipeline.name}, last ran${when} (${pipeline.lastRunState.toLowerCase()}).`,
      );
    }
  }

  if (answer.dataProducts.length > 0) {
    lines.push(
      `Part of: ${answer.dataProducts
        .map((product: DataTableAnswer["dataProducts"][number]) => {
          return `${product.name}${product.status ? ` (${product.status})` : ""}`;
        })
        .join(", ")}.`,
    );
  }

  if (answer.dashboards && answer.dashboards.length > 0) {
    lines.push(
      `Dashboards built on it: ${answer.dashboards
        .slice(0, MAX_LISTED)
        .map(
          (dashboard: { name: string; tool: string; via: string | null }) => {
            return `${dashboard.name} (${dashboard.tool}${dashboard.via ? `, through ${dashboard.via}` : ""})`;
          },
        )
        .join(", ")}.`,
    );
  }

  return lines.join(" ");
}

export default class DataTableAnswerer {
  // The tables a reference means: an id, schema.table, or a table's name alone.
  public static async findTables(
    projectId: ObjectID,
    reference: string,
  ): Promise<Array<DataAsset>> {
    const text: string = reference.trim();
    const select: Record<string, true> = {
      _id: true,
      assetKey: true,
      dataStoreName: true,
    };

    if (!text) {
      return [];
    }

    if (ObjectID.isValidUUID(text)) {
      return await DataAssetService.findBy({
        query: { projectId, _id: new ObjectID(text) },
        select,
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
    }

    // A database's name before the key (orders_db.public.orders) narrows to its tables.
    const byKey: Array<DataAsset> = await DataAssetService.findBy({
      query: { projectId, assetKey: QueryHelper.findWithSameText(text) },
      select,
      sort: { isDropped: SortOrder.Ascending },
      limit: MAX_TABLES_ANSWERED,
      skip: 0,
      props: { isRoot: true },
    });

    if (byKey.length > 0) {
      return byKey;
    }

    return await DataAssetService.findBy({
      query: { projectId, name: QueryHelper.findWithSameText(text) },
      select,
      sort: { isDropped: SortOrder.Ascending },
      limit: MAX_TABLES_ANSWERED,
      skip: 0,
      props: { isRoot: true },
    });
  }

  public static async answer(
    projectId: ObjectID,
    dataAssetId: ObjectID,
    now: Date,
  ): Promise<DataTableAnswer | null> {
    const asset: DataAsset | null = await DataAssetService.findOneBy({
      query: { projectId, _id: dataAssetId },
      select: {
        _id: true,
        assetKey: true,
        dataStoreName: true,
        assetKind: true,
        lastChangedAt: true,
        updateIntervalInSeconds: true,
        rowCount: true,
        isDropped: true,
      },
      props: { isRoot: true },
    });

    if (!asset?.id) {
      return null;
    }

    const freshness: DataAssetFreshnessResult = getDataAssetFreshness({
      kind: asset.assetKind as DataAssetKind,
      lastChangedAt: asset.lastChangedAt ? new Date(asset.lastChangedAt) : null,
      updateIntervalInSeconds: asset.updateIntervalInSeconds,
      now,
    });

    const [alerts, edges, products] = await Promise.all([
      DataAlertService.findBy({
        query: { projectId, dataAssetId: asset.id },
        select: { alertId: true },
        sort: { createdAt: SortOrder.Descending },
        limit: 20,
        skip: 0,
        props: { isRoot: true },
      }),
      DataAssetLineageService.findBy({
        query: {
          projectId,
          downstreamDataAssetId: asset.id,
          dataPipelineId: QueryHelper.notNull(),
        },
        select: {
          dataPipelineId: true,
          dataPipeline: {
            jobName: true,
            jobNamespace: true,
            lastRunState: true,
            lastRunStartedAt: true,
            lastErrorMessage: true,
          },
        },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: 20,
        skip: 0,
        props: { isRoot: true },
      }),
      DataProductService.findBy({
        query: {
          projectId,
          _id: QueryHelper.anyOfEntitiesInManyToMany({
            values: [asset.id],
            joinTableName: "DataProductDataAsset",
            ownerColumnName: "dataProductId",
            relationColumnName: "dataAssetId",
          }),
        },
        select: { name: true, status: true },
        limit: MAX_LISTED,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const alertIds: Array<ObjectID> = (alerts as Array<DataAlert>)
      .map((row: DataAlert): ObjectID | undefined => {
        return row.alertId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });
    /*
     * Its alerts still open: in a state the project's states do not count
     * as resolved (Common/Utils/ResolvedState) - so one moved on to a state
     * placed after Resolved, such as "Closed", is over too, flagged or not.
     */
    const alertRows: Array<Alert> =
      alertIds.length > 0
        ? await AlertService.findBy({
            query: {
              projectId,
              _id: QueryHelper.any(alertIds),
              currentAlertStateId: QueryHelper.any(
                await AlertStateService.getUnresolvedAlertStateIds(projectId),
              ),
            },
            select: {
              _id: true,
              title: true,
              alertNumberWithPrefix: true,
              currentAlertState: { name: true },
            },
            sort: { createdAt: SortOrder.Descending },
            limit: alertIds.length,
            skip: 0,
            props: { isRoot: true },
          })
        : [];
    const seenPipelines: Set<string> = new Set();
    const writerPipelines: DataTableAnswer["writerPipelines"] = [];

    for (const edge of edges as Array<DataAssetLineage>) {
      const id: string = edge.dataPipelineId?.toString() || "";

      if (!edge.dataPipeline || seenPipelines.has(id)) {
        continue;
      }

      seenPipelines.add(id);
      writerPipelines.push({
        name: edge.dataPipeline.jobName || "",
        lastRunState: edge.dataPipeline.lastRunState || null,
        lastRunStartedAt: edge.dataPipeline.lastRunStartedAt
          ? new Date(edge.dataPipeline.lastRunStartedAt)
          : null,
        lastErrorMessage: edge.dataPipeline.lastErrorMessage || null,
      });
    }

    return {
      dataAssetId: asset.id.toString(),
      table: asset.assetKey || "",
      database: asset.dataStoreName || "",
      freshness: freshness.freshness,
      lastChangedAt: asset.lastChangedAt ? new Date(asset.lastChangedAt) : null,
      usualIntervalInSeconds: asset.updateIntervalInSeconds || null,
      lateBySeconds: freshness.overdueBySeconds,
      rowCount:
        asset.rowCount === undefined || asset.rowCount === null
          ? null
          : Number(asset.rowCount),
      isDropped: asset.isDropped === true,
      openAlerts: alertRows
        .filter((alert: Alert) => {
          return Boolean(alert.id);
        })
        .slice(0, MAX_LISTED)
        .map((alert: Alert) => {
          return {
            alertId: alert.id!.toString(),
            title: alert.title || "",
            number: alert.alertNumberWithPrefix || null,
            state: alert.currentAlertState?.name || null,
          };
        }),
      writerPipelines: writerPipelines.slice(0, MAX_LISTED),
      dataProducts: (products as Array<DataProduct>).map(
        (product: DataProduct) => {
          return { name: product.name || "", status: product.status || null };
        },
      ),
      dashboards: (
        await DataTableDashboards.find({ projectId, dataAssetId: asset.id })
      ).map((dashboard: TableDashboard) => {
        return {
          name: dashboard.name,
          tool: dashboard.tool,
          via: dashboard.via?.table || null,
        };
      }),
    };
  }
}
