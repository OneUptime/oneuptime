import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/*
 * WHOSE TELEMETRY A CALLER MAY READ.
 *
 * Every telemetry row (a log, a span, a metric point, an exception, a
 * profile, a session) belongs to one resource - a service, a host, a
 * cluster, a monitor, a RUM application ... - named by the row's
 * primaryEntityId. Which of those resources' rows a caller may read follows
 * from their permission rows, by the rule every permission check shares
 * (Types/HeldPermissions):
 *
 *   - a grant that reaches the whole project reads every resource;
 *   - a grant limited to some labels reads the resources carrying them, and
 *     an Owned grant the resources the caller or one of their teams owns;
 *   - a block with labels takes away the resources carrying those labels,
 *     whatever else the caller holds (a block with no labels refuses the
 *     read outright, before any scope is worked out).
 *
 * The analytics permission layer works the scope out once per request
 * (AnalyticsDatabase/ModelPermission.getReadScope) and every telemetry read
 * applies it: the model reads (findBy, countBy, aggregateBy) through
 * applyToQuery, and the routes and AI tools that build their own SQL
 * (/telemetry/*, the aggregation services) through toServiceFilter and
 * appendServiceFilter. This file holds the parts that decide nothing - they
 * only apply a scope somebody already worked out - so the two cannot drift
 * apart.
 */
export interface TelemetryReadScope {
  /*
   * The resources whose telemetry the caller may read: null for every
   * resource of the project, otherwise exactly these (an empty list reads
   * nothing at all - never "no filter").
   */
  readableIds: ReadonlyArray<string> | null;
  /*
   * The resources a block with labels takes away. Applied on top of
   * readableIds, whatever it says: ModelPermission never puts a blocked id
   * in readableIds, and every reader of a scope goes through getReadableIds
   * / isReadable, which leave blocked ids out again, so a scope built
   * anywhere else cannot reach one either.
   *
   * Ids are compared without regard to case (Postgres matches UUIDs that
   * way), and every list the helpers below return is lower case.
   */
  blockedIds: ReadonlyArray<string>;
}

/*
 * The shape an aggregation request takes a scope in: `serviceIds` keeps rows
 * whose primaryEntityId is one of them (the aggregation services read a
 * missing or empty list as "every resource"), `excludedServiceIds` drops
 * rows whose primaryEntityId is one of them.
 */
export interface TelemetryServiceFilter {
  serviceIds?: Array<ObjectID> | undefined;
  excludedServiceIds?: Array<ObjectID> | undefined;
}

/*
 * A scope's ids as lower-case sets, built once per scope object: a reader
 * that checks many resources against one scope (a facet's list) does not
 * rebuild them for each. Rebuilt if the scope's lists are replaced.
 */
interface ScopeIdSets {
  readableIds: ReadonlyArray<string> | null;
  blockedIds: ReadonlyArray<string>;
  readable: Set<string> | null;
  blocked: Set<string>;
}

const scopeIdSets: WeakMap<TelemetryReadScope, ScopeIdSets> = new WeakMap<
  TelemetryReadScope,
  ScopeIdSets
>();

export default class TelemetryReadScopeUtil {
  /*
   * A resource id no row carries, for "reads nothing": an empty IN list
   * reads as "no filter" to every aggregation service.
   */
  public static readonly NO_RESOURCE_ID: string =
    ObjectID.getZeroObjectID().toString();

  // Every resource, nothing taken away: root, master admins, project-wide grants.
  public static getUnrestrictedScope(): TelemetryReadScope {
    return { readableIds: null, blockedIds: [] };
  }

  // Whether the scope reaches every resource with nothing taken away.
  public static isProjectWide(scope: TelemetryReadScope): boolean {
    return scope.readableIds === null && scope.blockedIds.length === 0;
  }

  // A resource id as every comparison here reads it: lower case.
  public static normalizeId(resourceId: ObjectID | string): string {
    return resourceId.toString().trim().toLowerCase();
  }

  /*
   * The resources the caller may read, less every blocked one, lower case
   * and each once: null for every resource of the project (blocked ones
   * aside), an empty list for none. The one way a reader turns a scope into
   * an id list.
   */
  public static getReadableIds(
    scope: TelemetryReadScope,
  ): Array<string> | null {
    if (scope.readableIds === null) {
      return null;
    }

    const blocked: Set<string> = TelemetryReadScopeUtil.getBlockedIdSet(scope);
    const readable: Set<string> = new Set<string>();

    for (const id of scope.readableIds) {
      const normalized: string = TelemetryReadScopeUtil.normalizeId(id);

      if (!blocked.has(normalized)) {
        readable.add(normalized);
      }
    }

    return Array.from(readable);
  }

  // The blocked resources, lower case and each once.
  public static getBlockedIds(scope: TelemetryReadScope): Array<string> {
    return Array.from(TelemetryReadScopeUtil.getBlockedIdSet(scope));
  }

  // Whether the caller may read telemetry of this one resource.
  public static isReadable(
    scope: TelemetryReadScope,
    resourceId: ObjectID | string,
  ): boolean {
    const id: string = TelemetryReadScopeUtil.normalizeId(resourceId);
    const sets: ScopeIdSets = TelemetryReadScopeUtil.getIdSets(scope);

    if (sets.blocked.has(id)) {
      return false;
    }

    return sets.readable === null || sets.readable.has(id);
  }

  // The ids of `ids` the caller may read, lower case, each once, in their order.
  public static filterReadableIds(
    scope: TelemetryReadScope,
    ids: ReadonlyArray<ObjectID | string>,
  ): Array<string> {
    const sets: ScopeIdSets = TelemetryReadScopeUtil.getIdSets(scope);
    const blocked: Set<string> = sets.blocked;
    const readable: Set<string> | null = sets.readable;
    const kept: Set<string> = new Set<string>();

    for (const id of ids) {
      const normalized: string = TelemetryReadScopeUtil.normalizeId(id);

      if (
        !blocked.has(normalized) &&
        (readable === null || readable.has(normalized))
      ) {
        kept.add(normalized);
      }
    }

    return Array.from(kept);
  }

  private static getBlockedIdSet(scope: TelemetryReadScope): Set<string> {
    return TelemetryReadScopeUtil.getIdSets(scope).blocked;
  }

  // The scope's ids as lower-case sets (see ScopeIdSets).
  private static getIdSets(scope: TelemetryReadScope): ScopeIdSets {
    const cached: ScopeIdSets | undefined = scopeIdSets.get(scope);

    if (
      cached &&
      cached.readableIds === scope.readableIds &&
      cached.blockedIds === scope.blockedIds
    ) {
      return cached;
    }

    const sets: ScopeIdSets = {
      readableIds: scope.readableIds,
      blockedIds: scope.blockedIds,
      readable:
        scope.readableIds === null
          ? null
          : new Set<string>(
              scope.readableIds.map((id: string): string => {
                return TelemetryReadScopeUtil.normalizeId(id);
              }),
            ),
      blocked: new Set<string>(
        scope.blockedIds.map((id: string): string => {
          return TelemetryReadScopeUtil.normalizeId(id);
        }),
      ),
    };

    scopeIdSets.set(scope, sets);

    return sets;
  }

  /*
   * The filter to hand an aggregation request, given the services the caller
   * asked for (none: every service they may read).
   *
   *   - Asked for some: those the caller may read. When that leaves none, a
   *     list that matches nothing - never an empty list, which the services
   *     read as "every resource".
   *   - Asked for none and limited to some resources: exactly those.
   *   - Asked for none and reaching the whole project: no list.
   *
   * Blocked resources go in excludedServiceIds as well, so a request whose
   * serviceIds are rebuilt somewhere downstream still leaves them out.
   */
  public static toServiceFilter(
    scope: TelemetryReadScope,
    requested?: ReadonlyArray<ObjectID | string> | null | undefined,
  ): TelemetryServiceFilter {
    const blockedIds: Array<string> =
      TelemetryReadScopeUtil.getBlockedIds(scope);

    const excludedServiceIds: Array<ObjectID> | undefined =
      blockedIds.length > 0
        ? blockedIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          })
        : undefined;

    let serviceIds: Array<string> | undefined;

    if (requested && requested.length > 0) {
      serviceIds = TelemetryReadScopeUtil.filterReadableIds(scope, requested);
    } else {
      serviceIds = TelemetryReadScopeUtil.getReadableIds(scope) || undefined;
    }

    if (serviceIds && serviceIds.length === 0) {
      serviceIds = [TelemetryReadScopeUtil.NO_RESOURCE_ID];
    }

    return {
      serviceIds: serviceIds
        ? serviceIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          })
        : undefined,
      excludedServiceIds: excludedServiceIds,
    };
  }

  /*
   * ` AND <column> IN (...)` and ` AND <column> NOT IN (...)` for a filter -
   * the one place an aggregation service turns serviceIds and
   * excludedServiceIds into SQL. An empty or missing list adds nothing.
   */
  public static appendServiceFilter(
    statement: Statement,
    filter: TelemetryServiceFilter,
    column: string = "primaryEntityId",
  ): void {
    // The column is the code's own, never a caller's: a plain identifier.
    if (!TelemetryReadScopeUtil.COLUMN_PATTERN.test(column)) {
      throw new BadDataException(`Invalid resource column: ${column}`);
    }

    if (filter.serviceIds && filter.serviceIds.length > 0) {
      statement.append(` AND ${column} IN (`);
      statement.append(
        SQL`${{
          type: TableColumnType.ObjectID,
          value: new Includes(
            filter.serviceIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        }})`,
      );
    }

    if (filter.excludedServiceIds && filter.excludedServiceIds.length > 0) {
      statement.append(` AND ${column} NOT IN (`);
      statement.append(
        SQL`${{
          type: TableColumnType.ObjectID,
          value: new IncludesNone(
            filter.excludedServiceIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        }})`,
      );
    }
  }

  private static readonly COLUMN_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

  /*
   * Narrows an analytics model query to the scope, on the column that names
   * the row's resource (the model's @OwnedThrough column). Never widens what
   * the caller asked for:
   *
   *   - a caller who asked for some resources (one id, a list of ids, or an
   *     Includes) keeps those they may read, or matches nothing;
   *   - any other operator the caller put on the column stays, and the scope
   *     is added next to it (the analytics query ANDs a list of operators
   *     on one column);
   *   - a caller who asked for nothing gets the scope alone;
   *   - a filter of any other shape is refused rather than dropped.
   */
  public static applyToQuery<TQuery>(
    query: TQuery,
    column: string,
    scope: TelemetryReadScope,
  ): TQuery {
    if (TelemetryReadScopeUtil.isProjectWide(scope)) {
      return query;
    }

    const record: Record<string, unknown> = query as unknown as Record<
      string,
      unknown
    >;
    const existing: unknown = record[column];
    const requestedIds: Array<string> | null =
      TelemetryReadScopeUtil.getRequestedIds(existing);

    if (requestedIds) {
      const ids: Array<string> = TelemetryReadScopeUtil.filterReadableIds(
        scope,
        requestedIds,
      );

      record[column] = new Includes(
        ids.length > 0 ? ids : [TelemetryReadScopeUtil.NO_RESOURCE_ID],
      );

      return query;
    }

    const readableIds: Array<string> | null =
      TelemetryReadScopeUtil.getReadableIds(scope);

    const scopeOperator: Includes | IncludesNone =
      readableIds !== null
        ? new Includes(
            readableIds.length > 0
              ? readableIds
              : [TelemetryReadScopeUtil.NO_RESOURCE_ID],
          )
        : new IncludesNone(TelemetryReadScopeUtil.getBlockedIds(scope));

    if (existing === undefined || existing === null) {
      record[column] = scopeOperator;
    } else if (existing instanceof QueryOperator) {
      record[column] = [existing, scopeOperator];
    } else if (
      Array.isArray(existing) &&
      existing.length > 0 &&
      existing.every((element: unknown): boolean => {
        return element instanceof QueryOperator;
      })
    ) {
      record[column] = [...existing, scopeOperator];
    } else {
      /*
       * A filter the column can neither narrow nor hold next to the scope.
       * Refused: dropping it would answer a different question than the one
       * asked.
       */
      throw new BadDataException(
        `Unsupported filter on ${column}: use one id, a list of ids, or a query operator.`,
      );
    }

    return query;
  }

  /*
   * The resources a caller's own filter names outright - one id, a list of
   * ids, or an Includes of ids - or null for any other filter (or none).
   */
  private static getRequestedIds(existing: unknown): Array<string> | null {
    if (typeof existing === "string" || existing instanceof ObjectID) {
      return [existing.toString()];
    }

    if (existing instanceof Includes) {
      return existing.values.map((value: string | ObjectID | number) => {
        return value.toString();
      });
    }

    if (
      Array.isArray(existing) &&
      existing.length > 0 &&
      existing.every((element: unknown): boolean => {
        return typeof element === "string" || element instanceof ObjectID;
      })
    ) {
      return existing.map((element: string | ObjectID): string => {
        return element.toString();
      });
    }

    return null;
  }
}
