import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import { getDataTableKey } from "../../../Types/DataObservability/DataObservabilityMetric";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";
import { matchDataset } from "./DatasetMatching";
import OpenLineageIngest, { ProjectCatalog } from "./OpenLineageIngest";
import { CollectedLineageEdge } from "./TableHealthCollector";
import { UsageAsset } from "./TableUsageMatching";

/*
 * THE LINEAGE A DATABASE SAYS, KEPT AS EDGES.
 *
 * A collection reports which of the store's tables feed which: views over
 * their tables, and queries in the database's own history that read one
 * table and wrote another (TableHealthCollector). Each becomes a lineage
 * row with no pipeline, beside the pipelines' own, once its tables are
 * resolved to watched tables: the downstream table is the store's; the
 * upstream one is too, or, for a BigQuery query that read another dataset,
 * whichever of the project's stores holds it. A row is kept once per pair
 * and source and written only when it changes - created once, its last
 * sighting moved at most hourly for a query and daily for a view - so a
 * collection that sees the same lineage again writes nothing. When every
 * view was read, a view edge no longer reported is deleted: the view was
 * redefined or dropped. A query edge stays, with when it was last seen.
 */

// How precisely an edge's last sighting is kept.
export const QUERY_EDGE_SEEN_PRECISION_IN_SECONDS: number = 60 * 60;
export const VIEW_EDGE_SEEN_PRECISION_IN_SECONDS: number = 24 * 60 * 60;

type CollectedSource =
  | DataAssetLineageSource.QueryHistory
  | DataAssetLineageSource.ViewDefinition;

// An edge whose tables are both watched tables.
export interface ResolvedLineageEdge {
  source: CollectedSource;
  upstreamDataAssetId: string;
  downstreamDataAssetId: string;
  lastSeenAt: Date;
  seenBy: string | null;
}

// An edge already kept, of a source a collection reports.
export interface KeptLineageEdge {
  id: string;
  edgeKey: string;
  source: DataAssetLineageSource;
  lastSeenAt: Date;
  seenBy: string | null;
}

export interface CollectedLineagePlan {
  creates: Array<ResolvedLineageEdge & { edgeKey: string }>;
  updates: Array<{ id: string; lastSeenAt: Date; seenBy: string | null }>;
  deletes: Array<string>;
}

// A pipeline's edge ends in its id, so these never meet one.
export function getCollectedEdgeKey(data: {
  source: CollectedSource;
  upstreamDataAssetId: string;
  downstreamDataAssetId: string;
}): string {
  return `${data.upstreamDataAssetId}:${data.downstreamDataAssetId}:${
    data.source === DataAssetLineageSource.QueryHistory ? "query" : "view"
  }`;
}

export function planCollectedLineage(data: {
  edges: Array<ResolvedLineageEdge>;
  kept: Array<KeptLineageEdge>;
  // True when every view was read: a view edge not among the edges is gone.
  isViewLineageComplete: boolean;
}): CollectedLineagePlan {
  const byKey: Map<string, ResolvedLineageEdge> = new Map();

  // Two rows of one pair (a table read under two names) keep the later sighting.
  for (const edge of data.edges) {
    const key: string = getCollectedEdgeKey(edge);
    const known: ResolvedLineageEdge | undefined = byKey.get(key);

    if (!known || edge.lastSeenAt > known.lastSeenAt) {
      byKey.set(key, edge);
    }
  }

  const keptByKey: Map<string, KeptLineageEdge> = new Map();

  for (const kept of data.kept) {
    keptByKey.set(kept.edgeKey, kept);
  }

  const plan: CollectedLineagePlan = { creates: [], updates: [], deletes: [] };

  for (const [edgeKey, edge] of byKey) {
    const kept: KeptLineageEdge | undefined = keptByKey.get(edgeKey);

    if (!kept) {
      plan.creates.push({ ...edge, edgeKey });
      continue;
    }

    const precisionInMs: number =
      (edge.source === DataAssetLineageSource.QueryHistory
        ? QUERY_EDGE_SEEN_PRECISION_IN_SECONDS
        : VIEW_EDGE_SEEN_PRECISION_IN_SECONDS) * 1000;

    if (
      edge.lastSeenAt.getTime() - kept.lastSeenAt.getTime() >=
      precisionInMs
    ) {
      plan.updates.push({
        id: kept.id,
        lastSeenAt: edge.lastSeenAt,
        seenBy: edge.seenBy ?? kept.seenBy,
      });
    }
  }

  if (data.isViewLineageComplete) {
    for (const kept of data.kept) {
      if (
        kept.source === DataAssetLineageSource.ViewDefinition &&
        !byKey.has(kept.edgeKey)
      ) {
        plan.deletes.push(kept.id);
      }
    }
  }

  return plan;
}

export default class CollectedLineage {
  public static async record(data: {
    projectId: ObjectID;
    engine: DatabaseEngine;
    // The store's database, as its target names it: a BigQuery dataset's project.
    databaseName: string | null;
    lineage: Array<CollectedLineageEdge>;
    isViewLineageComplete: boolean;
    // The store's watched tables by key (schema.table), as this collection left them.
    assetIdByKey: Map<string, ObjectID>;
    collectedAt: Date;
  }): Promise<CollectedLineagePlan> {
    const edges: Array<ResolvedLineageEdge> = await this.resolve(data);
    const downstreamIds: Set<string> = new Set();

    if (data.isViewLineageComplete) {
      // Every table's view edges are read, so one no longer reported can go.
      for (const id of data.assetIdByKey.values()) {
        downstreamIds.add(id.toString());
      }
    } else {
      for (const edge of edges) {
        downstreamIds.add(edge.downstreamDataAssetId);
      }
    }

    if (downstreamIds.size === 0) {
      return { creates: [], updates: [], deletes: [] };
    }

    const kept: Array<DataAssetLineage> =
      await DataAssetLineageService.findAllBy({
        query: {
          projectId: data.projectId,
          downstreamDataAssetId: QueryHelper.any(Array.from(downstreamIds)),
          source: QueryHelper.any([
            DataAssetLineageSource.QueryHistory,
            DataAssetLineageSource.ViewDefinition,
          ]),
        },
        select: {
          _id: true,
          edgeKey: true,
          source: true,
          lastSeenAt: true,
          seenBy: true,
        },
        props: { isRoot: true },
      });

    const plan: CollectedLineagePlan = planCollectedLineage({
      edges,
      kept: kept
        .filter((edge: DataAssetLineage) => {
          return Boolean(edge.id && edge.edgeKey && edge.lastSeenAt);
        })
        .map((edge: DataAssetLineage): KeptLineageEdge => {
          return {
            id: edge.id!.toString(),
            edgeKey: edge.edgeKey!,
            source: edge.source || DataAssetLineageSource.Pipeline,
            lastSeenAt: new Date(edge.lastSeenAt!),
            seenBy: edge.seenBy || null,
          };
        }),
      isViewLineageComplete: data.isViewLineageComplete,
    });

    for (const create of plan.creates) {
      const edge: DataAssetLineage = new DataAssetLineage();
      edge.projectId = data.projectId;
      edge.upstreamDataAssetId = new ObjectID(create.upstreamDataAssetId);
      edge.downstreamDataAssetId = new ObjectID(create.downstreamDataAssetId);
      edge.edgeKey = create.edgeKey;
      edge.source = create.source;
      edge.firstSeenAt = create.lastSeenAt;
      edge.lastSeenAt = create.lastSeenAt;

      if (create.seenBy) {
        edge.seenBy = create.seenBy;
      }

      try {
        await DataAssetLineageService.create({
          data: edge,
          props: { isRoot: true },
        });
      } catch (error) {
        // Another collection of the project kept it first (the key is unique).
        logger.debug(
          `Data Observability: lineage edge ${create.edgeKey} was not created: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    for (const update of plan.updates) {
      await DataAssetLineageService.updateColumnsByIdWithoutHooks({
        id: new ObjectID(update.id),
        data: {
          lastSeenAt: update.lastSeenAt,
          seenBy: update.seenBy,
        } as never,
      });
    }

    if (plan.deletes.length > 0) {
      await DataAssetLineageService.deleteBy({
        query: { _id: QueryHelper.any(plan.deletes) },
        limit: plan.deletes.length,
        skip: 0,
        props: { isRoot: true },
      });
    }

    return plan;
  }

  /*
   * Each reported edge's tables, as watched tables: the downstream one the
   * store's own, the upstream one the store's too unless the edge names
   * another database - then, for BigQuery, the project's store that holds
   * it, the project's catalog read only when some edge needs it. An edge
   * with a table OneUptime does not watch is left out.
   */
  private static async resolve(data: {
    projectId: ObjectID;
    engine: DatabaseEngine;
    databaseName: string | null;
    lineage: Array<CollectedLineageEdge>;
    assetIdByKey: Map<string, ObjectID>;
    collectedAt: Date;
  }): Promise<Array<ResolvedLineageEdge>> {
    const ownDatabase: string = (data.databaseName || "").toLowerCase();
    const edges: Array<ResolvedLineageEdge> = [];
    let catalog: ProjectCatalog | null = null;

    for (const edge of data.lineage) {
      const downstream: ObjectID | undefined = data.assetIdByKey.get(
        getDataTableKey(edge.downstreamSchema, edge.downstreamTable),
      );

      if (!downstream) {
        continue;
      }

      let upstream: string | null = null;

      if (
        !edge.upstreamDatabase ||
        edge.upstreamDatabase.toLowerCase() === ownDatabase
      ) {
        upstream =
          data.assetIdByKey
            .get(getDataTableKey(edge.upstreamSchema, edge.upstreamTable))
            ?.toString() || null;
      }

      if (!upstream && edge.upstreamDatabase && data.engine === "bigquery") {
        catalog =
          catalog || (await OpenLineageIngest.readCatalog(data.projectId));

        const asset: UsageAsset | null = matchDataset({
          dataset: {
            namespace: "bigquery",
            name: `${edge.upstreamDatabase}.${edge.upstreamSchema}.${edge.upstreamTable}`,
          },
          stores: catalog.stores,
          assets: catalog.assets,
        });

        upstream = asset?.dataAssetId || null;
      }

      if (!upstream || upstream === downstream.toString()) {
        continue;
      }

      edges.push({
        source: edge.source,
        upstreamDataAssetId: upstream,
        downstreamDataAssetId: downstream.toString(),
        lastSeenAt:
          edge.secondsSinceSeen !== null
            ? new Date(
                data.collectedAt.getTime() - edge.secondsSinceSeen * 1000,
              )
            : data.collectedAt,
        seenBy: edge.seenBy,
      });
    }

    return edges;
  }
}
