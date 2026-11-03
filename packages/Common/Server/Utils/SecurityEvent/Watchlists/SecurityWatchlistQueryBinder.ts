import SecurityWatchlist from "../../../../Models/DatabaseModels/SecurityWatchlist";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotOnWatchlist from "../../../../Types/BaseDatabase/NotOnWatchlist";
import QueryOperator from "../../../../Types/BaseDatabase/QueryOperator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import GenericObject from "../../../../Types/GenericObject";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SigmaWatchlist,
  getSecurityWatchlistNameKey,
} from "../../../../Types/SecurityEvent/SecurityWatchlist";
import {
  getWatchlistNamesInQuery,
  isWatchlistOperator,
} from "../../../../Types/SecurityEvent/SecurityWatchlistFilter";
import BoundQueryCondition from "../../../Types/AnalyticsDatabase/BoundQueryCondition";
import { Statement } from "../../AnalyticsDatabase/Statement";
import CallerPermission from "../../Permission/CallerPermission";
import SecurityWatchlists, {
  SecurityWatchlistMissingException,
} from "./SecurityWatchlists";
import {
  MAX_DETECTION_READ_PARAMETER_BYTES,
  buildWatchlistArrayExpressionMatch,
  buildWatchlistTextMatch,
  getWatchlistsParameterUrlBytes,
} from "./SecurityWatchlistMatch";

/*
 * A SEARCH, A MONITOR OR A HUNT THAT READS A WATCHLIST, as a read of the
 * SecurityEvent table.
 *
 * Their queries name a list on a field (OnWatchlist, NotOnWatchlist:
 * Types/SecurityEvent/SecurityWatchlistFilter). Just before the read is
 * compiled, the service reads every list the query names - one read of the
 * lists, one of their values (SecurityWatchlists.load, which leaves out the
 * values whose moment to leave has come) - and puts in each name's place a
 * condition that matches the list exactly as a rule's read does
 * (SecurityWatchlistMatch): whatever the case, * for any run of characters,
 * an IP address list's ranges as ranges, a list that follows a feed as the
 * feed's active indicators. The statement generator places it on the field.
 *
 * Who may: a person or an API key that may read watchlists in the project -
 * every Security role may - so a search never tells somebody what is on a
 * list they may not read. OneUptime's own reads (a monitor's run) read as
 * the project. A name the project has no list of is refused with the words
 * a rule's save uses, and so is a read whose lists would not fit one
 * request to the database.
 */

/*
 * The most a search's watchlists may send in one read: what a detection
 * read may send (ClickHouse's 1 MiB URL, less room), less room for the rest
 * of a search - its other filters, its time window, a facet's grouping.
 */
export const MAX_WATCHLIST_SEARCH_PARAMETER_BYTES: number =
  MAX_DETECTION_READ_PARAMETER_BYTES - 64 * 1024;

function formatKilobytes(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString("en-US")} KB`;
}

// A list read for one read of events, on the field it was named on.
export class SecurityWatchlistCondition extends BoundQueryCondition {
  public constructor(
    public readonly watchlist: SigmaWatchlist,
    public readonly isNegated: boolean,
  ) {
    super();
  }

  public toStatement(data: {
    expression: Statement;
    isArray: boolean;
  }): Statement {
    const statement: Statement = new Statement(
      [this.isNegated ? "NOT (" : "("],
      [],
    );

    statement.append(
      data.isArray
        ? buildWatchlistArrayExpressionMatch(data.expression, this.watchlist)
        : buildWatchlistTextMatch(data.expression, this.watchlist),
    );
    statement.append(")");

    return statement;
  }

  // What the query said before it was bound: the list's name.
  public override toJSON(): JSONObject {
    return {
      _type: this.isNegated
        ? ObjectType.NotOnWatchlist
        : ObjectType.OnWatchlist,
      value: this.watchlist.name,
    };
  }
}

export default class SecurityWatchlistQueryBinder {
  // Whether a query names a watchlist anywhere.
  public static readsWatchlists(query: unknown): boolean {
    return getWatchlistNamesInQuery(query).length > 0;
  }

  /*
   * The project a read's lists are read in: the caller's own project, or -
   * for OneUptime's own reads - the one the query names.
   */
  public static getProjectId(
    query: unknown,
    props: DatabaseCommonInteractionProps,
  ): ObjectID {
    if (!props.isRoot) {
      if (!props.tenantId) {
        throw new BadDataException(
          "A watchlist is read in one project. Open the project first, then search.",
        );
      }

      return props.tenantId;
    }

    const projectId: unknown =
      query && typeof query === "object"
        ? (query as Record<string, unknown>)["projectId"]
        : undefined;

    if (projectId instanceof ObjectID) {
      return projectId;
    }

    if (typeof projectId === "string" && ObjectID.isValidUUID(projectId)) {
      return new ObjectID(projectId);
    }

    throw new BadDataException(
      "A read that matches a watchlist names the project the list is in.",
    );
  }

  // Whether the caller may read the project's watchlists: every Security role may.
  public static assertCallerReadsWatchlists(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): void {
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    if (
      !CallerPermission.holdsModelPermission(
        props,
        { model: new SecurityWatchlist(), operation: "read" },
        { projectId },
      )
    ) {
      throw new NotAuthorizedException(
        "Matching events against a watchlist takes a role that can read watchlists, such as Security Viewer.",
      );
    }
  }

  /*
   * The query with every list it names read and in place: a new query, the
   * one given left as it was. A query that names none is handed back as it
   * is.
   */
  public static async bind<TQuery extends GenericObject>(data: {
    query: TQuery;
    props: DatabaseCommonInteractionProps;
  }): Promise<TQuery> {
    const names: Array<string> = getWatchlistNamesInQuery(data.query);

    if (names.length === 0) {
      return data.query;
    }

    const projectId: ObjectID = this.getProjectId(data.query, data.props);

    this.assertCallerReadsWatchlists(data.props, projectId);

    const watchlists: Map<string, SigmaWatchlist> =
      await SecurityWatchlists.load({
        projectId,
        names,
      });

    const missing: Array<string> = names.filter((name: string): boolean => {
      return !watchlists.has(getSecurityWatchlistNameKey(name));
    });

    if (missing.length > 0) {
      throw new SecurityWatchlistMissingException(missing);
    }

    const bytes: number = getWatchlistsParameterUrlBytes(
      Array.from(watchlists.values()),
    );

    if (bytes > MAX_WATCHLIST_SEARCH_PARAMETER_BYTES) {
      throw new BadDataException(
        `This search reads more watchlist values than one read can send to the database: about ${formatKilobytes(
          bytes,
        )}, where ${formatKilobytes(
          MAX_WATCHLIST_SEARCH_PARAMETER_BYTES,
        )} fit. Read fewer or shorter watchlists, or follow a threat intel feed for a long list.`,
      );
    }

    return this.replace(data.query, watchlists);
  }

  // The query with each name in its list's place.
  public static replace<TQuery extends GenericObject>(
    query: TQuery,
    watchlists: ReadonlyMap<string, SigmaWatchlist>,
  ): TQuery {
    const bindValue: (value: unknown) => unknown = (
      value: unknown,
    ): unknown => {
      if (isWatchlistOperator(value)) {
        const watchlist: SigmaWatchlist | undefined = watchlists.get(
          getSecurityWatchlistNameKey(value.value),
        );

        if (!watchlist) {
          throw new SecurityWatchlistMissingException([value.value]);
        }

        return new SecurityWatchlistCondition(
          watchlist,
          value instanceof NotOnWatchlist,
        );
      }

      if (Array.isArray(value)) {
        return value.map(bindValue);
      }

      return value;
    };

    const bound: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(
      query as Record<string, unknown>,
    )) {
      if (
        key === "attributes" &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof QueryOperator)
      ) {
        const attributes: Record<string, unknown> = {};

        for (const [attributeKey, attributeValue] of Object.entries(
          value as Record<string, unknown>,
        )) {
          attributes[attributeKey] = bindValue(attributeValue);
        }

        bound[key] = attributes;
        continue;
      }

      bound[key] = bindValue(value);
    }

    return bound as TQuery;
  }
}
