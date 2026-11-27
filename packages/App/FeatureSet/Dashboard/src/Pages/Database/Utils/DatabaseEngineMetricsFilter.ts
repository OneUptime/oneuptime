import {
  DatabaseEngineMetricsStatusQueryKind,
  getDatabaseEngineMetricsStatusQueryKind,
} from "./DatabaseServerPresentation";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import FilterGroups, {
  FilterGroup,
  FilterGroupsMatch,
} from "Common/Types/BaseDatabase/FilterGroups";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqualOrNull from "Common/Types/BaseDatabase/NotEqualOrNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import { FilterOperator } from "../../../Components/ResourceOwners/FilterChipDropdownTypes";

/*
 * The Databases list's "Engine metrics" filter. One status takes two
 * columns to express - a database found from traces or containers stores
 * no otelCollectorStatus (NULL) until a collector reports, but rows
 * written before the column's "disconnected" default was dropped still
 * read "disconnected" without ever having had an agent - so the filter
 * cannot write one column. Each status is a group of conditions on the two
 * columns, with exactly the rule getDatabaseEngineMetricsStatus applies to
 * a row (getDatabaseEngineMetricsState):
 *
 *   - Connected: otelCollectorStatus = "connected";
 *   - Disconnected: anything but "connected" (none included), and
 *     collectorLastSeenAt set - a collector reported once and stopped;
 *   - Not connected: anything but "connected", and collectorLastSeenAt
 *     empty - nothing ever reported.
 *
 * The three split every database between them, as the Status column does.
 * The chip's statuses are one FilterGroups the server answers in the
 * list's own query (#11211): it used to read each status's ids first - the
 * first 10,000 - and filter the list by them, so a fleet with more
 * databases of a status than that listed and counted only some of them.
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
        otelCollectorStatus: new NotEqualOrNull("connected"),
        collectorLastSeenAt: new NotNull(),
      } as Query<DatabaseServer>;
    default:
      return {
        otelCollectorStatus: new NotEqualOrNull("connected"),
        collectorLastSeenAt: new IsNull(),
      } as Query<DatabaseServer>;
  }
}

/*
 * The kinds `values` name (DatabaseEngineMetricsStatus values), each once,
 * in the order the chip offers them; any other value is left out.
 */
export function getDatabaseEngineMetricsStatusQueryKinds(
  values: Array<string>,
): Array<DatabaseEngineMetricsStatusQueryKind> {
  const kinds: Array<DatabaseEngineMetricsStatusQueryKind> = [];

  for (const value of values) {
    const kind: DatabaseEngineMetricsStatusQueryKind | null =
      getDatabaseEngineMetricsStatusQueryKind(value);

    if (kind && !kinds.includes(kind)) {
      kinds.push(kind);
    }
  }

  return kinds;
}

/**
 * The chip's filter: the databases whose engine-metrics status is one of
 * `values` ("is"), or none of them ("is not"), as one FilterGroups for the
 * list's own query. Null when no status is picked - or none a status is
 * called by - and the chip filters nothing.
 */
export function buildDatabaseEngineMetricsStatusFilter(
  values: Array<string>,
  operator: FilterOperator,
): FilterGroups | null {
  const kinds: Array<DatabaseEngineMetricsStatusQueryKind> =
    getDatabaseEngineMetricsStatusQueryKinds(values);

  if (kinds.length === 0) {
    return null;
  }

  return new FilterGroups({
    match:
      operator === "is_not"
        ? FilterGroupsMatch.NoneOf
        : FilterGroupsMatch.AnyOf,
    groups: kinds.map(
      (kind: DatabaseEngineMetricsStatusQueryKind): FilterGroup => {
        return buildDatabaseEngineMetricsStatusQuery(
          kind,
        ) as unknown as FilterGroup;
      },
    ),
  });
}
