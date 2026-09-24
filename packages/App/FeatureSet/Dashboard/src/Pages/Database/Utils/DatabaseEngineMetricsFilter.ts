import {
  DatabaseEngineMetricsStatusQueryKind,
  getDatabaseEngineMetricsStatusQueryKind,
} from "./DatabaseServerPresentation";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Databases list's "Engine metrics" filter. One status takes two
 * columns to express — a database found from traces or containers stores
 * otelCollectorStatus "disconnected" (the column default) without ever
 * having had an agent — so the filter cannot write one column. It resolves
 * the chosen statuses to row ids instead (ResourceFacet
 * computeMatchingResourceIds), with exactly the rules
 * getDatabaseEngineMetricsStatus applies to a row:
 *
 *   - Connected: otelCollectorStatus = "connected";
 *   - Disconnected: not "connected", and collectorLastSeenAt set — a
 *     collector reported once and stopped;
 *   - Not connected: never reported — collectorLastSeenAt empty, status
 *     empty or the "disconnected" default.
 */

/** The DatabaseServer query that selects one engine-metrics status. */
export function buildDatabaseEngineMetricsStatusQuery(
  kind: DatabaseEngineMetricsStatusQueryKind,
): Query<DatabaseServer> {
  switch (kind) {
    case "connected":
      return { otelCollectorStatus: "connected" } as Query<DatabaseServer>;
    case "reported-and-stopped":
      return {
        otelCollectorStatus: new NotEqual("connected"),
        collectorLastSeenAt: new NotNull(),
      } as Query<DatabaseServer>;
    default:
      return {
        otelCollectorStatus: new EqualToOrNull("disconnected"),
        collectorLastSeenAt: new IsNull(),
      } as Query<DatabaseServer>;
  }
}

/**
 * The ids of the project's databases whose engine-metrics status is one of
 * `values` (DatabaseEngineMetricsStatus values; unknown ones are ignored).
 * Several statuses are unioned. Resolves to [] when nothing matches.
 */
export async function computeDatabaseServerIdsForEngineMetricsStatuses(
  projectId: ObjectID,
  values: Array<string>,
): Promise<Array<string>> {
  const kinds: Array<DatabaseEngineMetricsStatusQueryKind> = [];
  for (const value of values) {
    const kind: DatabaseEngineMetricsStatusQueryKind | null =
      getDatabaseEngineMetricsStatusQueryKind(value);
    if (kind && !kinds.includes(kind)) {
      kinds.push(kind);
    }
  }

  const results: Array<ListResult<DatabaseServer>> = await Promise.all(
    kinds.map(
      (
        kind: DatabaseEngineMetricsStatusQueryKind,
      ): Promise<ListResult<DatabaseServer>> => {
        return ModelAPI.getList<DatabaseServer>({
          modelType: DatabaseServer,
          query: {
            projectId: projectId,
            ...buildDatabaseEngineMetricsStatusQuery(kind),
          } as Query<DatabaseServer>,
          select: { _id: true },
          sort: {},
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });
      },
    ),
  );

  const ids: Set<string> = new Set<string>();
  for (const result of results) {
    for (const row of result.data || []) {
      const id: string = row._id ? row._id.toString() : "";
      if (id) {
        ids.add(id);
      }
    }
  }
  return Array.from(ids);
}
