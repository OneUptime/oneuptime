import { ResponseJSON } from "@clickhouse/client";
import SecurityEventService from "../../../Services/SecurityEventService";
import {
  MigrationExecuteOptions,
  Results,
} from "../../../Services/AnalyticsDatabaseService";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import {
  getStorageTableName,
  onClusterClause,
} from "../../AnalyticsDatabase/ClusterConfig";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SCRUB_HASH_TOKEN_PATTERN } from "../../../../Types/Telemetry/ScrubHashTokenFormat";
import {
  ERASED_USER_ATTRIBUTES,
  HASHED_USER_ATTRIBUTES,
  SCRUBBED_USER_ATTRIBUTES,
  SCRUBBED_USER_ROLES,
  ScrubbedUserRole,
  USER_ERASED_ON_REQUEST,
  USER_HIDDEN_BY_SCRUB_RULE,
} from "../../../../Utils/SecurityEvent/ScrubbedUser";

/*
 * THE EVENTS AN ERASURE PUTS THE TOKEN BACK IN (#10908).
 *
 * When a scan named an event's user by the user vault, it kept what the
 * Hash rule left beside the user, in oneuptime.<role>_user_hashed_as
 * (ScrubbedUser.nameHashedEventUser). That is how an erasure finds the
 * events the vault named a person in, by their tokens alone, and puts each
 * back as it would have been stored had the vault never known them:
 *
 *   - the user (principalUser or targetUser) is what the rule left again;
 *   - among the observables, the token takes the user's place;
 *   - the request's user (enduser.id) too, when it was the user;
 *   - the marker says a scrub rule hid the user, with what it left, as it
 *     did before the vault named them; what the rule left is no longer
 *     kept beside a user, since the event names nobody; and
 *     oneuptime.<role>_user_erased says an erasure request did this.
 *
 * Everything else about the event stays: it is still a record of what
 * happened, a Hash token still stands for one account (rules still count
 * it as one), and no playbook ever acts on a token.
 *
 * Every statement names the project, the tokens and attribute keys only,
 * never the person: ClickHouse keeps a mutation's command (system.mutations,
 * and Keeper's copy of the queued DDL) and a query with its parameters
 * filled in (system.query_log) long after they ran.
 *
 * The update is a mutation on the local table, ON CLUSTER, as every write
 * to an analytics table that already holds rows is
 * (AnalyticsDatabaseService.toDeleteStatement); a lightweight UPDATE cannot
 * run ON CLUSTER either. It matches only events that still keep a token
 * beside a user, so running it again changes nothing.
 */

// The most pairs one read of named users returns, for each role.
export const MAX_NAMED_PAIRS_PER_ROLE: number = 1000;

// A user the vault named, and what the Hash rule had left in their place.
export interface SecurityUserErasurePair {
  // As the events name the user: "alice@example.com", or "auth0|alice@example.com".
  named: string;
  // What the rule left: "[HASHED:...]", or "auth0|[HASHED:...]".
  hashed: string;
}

// The column of an event's user of a role.
export function getEventUserColumn(role: ScrubbedUserRole): string {
  return role === ScrubbedUserRole.Principal ? "principalUser" : "targetUser";
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function erasableTokens(tokens: ReadonlyArray<string>): Array<string> {
  return Array.from(
    new Set<string>(
      tokens.filter((token: string): boolean => {
        return SCRUB_HASH_TOKEN_PATTERN.test(token);
      }),
    ),
  );
}

function text(value: string): { type: TableColumnType; value: string } {
  return { type: TableColumnType.Text, value };
}

function databaseName(): string {
  if (!SecurityEventService.database) {
    SecurityEventService.useDefaultDatabase();
  }

  return SecurityEventService.database.getDatasourceOptions().database!;
}

function eventsTable(): string {
  return `${databaseName()}.${SecurityEventService.model.tableName}`;
}

export default class SecurityUserErasureEvents {
  /*
   * Whether an event's what-the-rule-left of a role holds one of the
   * tokens: a token is a distinctive 25 characters, so finding it in the
   * text is finding it.
   */
  private static holdsToken(data: {
    statement: Statement;
    role: ScrubbedUserRole;
    tokens: Array<string>;
  }): Statement {
    return data.statement.append(
      SQL`multiSearchAny(attributes[${text(HASHED_USER_ATTRIBUTES[data.role])}], ${{
        type: TableColumnType.Text,
        value: new Includes(data.tokens),
      }})`,
    );
  }

  // The users the vault named in a project's events of a role, from its tokens.
  public static toNamedPairsStatement(data: {
    projectId: ObjectID;
    role: ScrubbedUserRole;
    tokens: Array<string>;
  }): Statement {
    const statement: Statement = SQL`SELECT `;
    statement.append(getEventUserColumn(data.role));
    statement.append(
      SQL` AS named, attributes[${text(HASHED_USER_ATTRIBUTES[data.role])}] AS hashed FROM `,
    );
    statement.append(eventsTable());
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND `,
    );
    this.holdsToken({ statement, role: data.role, tokens: data.tokens });
    statement.append(
      ` GROUP BY named, hashed ORDER BY named, hashed LIMIT ${MAX_NAMED_PAIRS_PER_ROLE}`,
    );

    return statement;
  }

  /*
   * Who the vault named in a project's events, from its tokens, and what
   * the rule left in each one's place: what an erasure takes the person out
   * of Postgres by, where the events' users were copied.
   */
  public static async findNamedPairs(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
  }): Promise<Array<SecurityUserErasurePair>> {
    const tokens: Array<string> = erasableTokens(data.tokens);
    const pairs: Map<string, SecurityUserErasurePair> = new Map();

    if (tokens.length === 0) {
      return [];
    }

    for (const role of SCRUBBED_USER_ROLES) {
      const result: Results = await SecurityEventService.executeQuery(
        this.toNamedPairsStatement({ projectId: data.projectId, role, tokens }),
        MigrationExecuteOptions,
      );
      const response: ResponseJSON<JSONObject> =
        await result.json<JSONObject>();

      for (const row of (response.data || []) as Array<JSONObject>) {
        const named: string = readText(row["named"]).trim();
        const hashed: string = readText(row["hashed"]).trim();

        if (named && hashed && named !== hashed) {
          pairs.set(`${named}\u0000${hashed}`, { named, hashed });
        }
      }
    }

    return Array.from(pairs.values());
  }

  // How many of a project's events the vault named a user in from its tokens.
  public static toCountEventsStatement(data: {
    projectId: ObjectID;
    tokens: Array<string>;
  }): Statement {
    const statement: Statement = SQL`SELECT count() AS namedEvents FROM `;
    statement.append(eventsTable());
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND (`,
    );

    SCRUBBED_USER_ROLES.forEach(
      (role: ScrubbedUserRole, index: number): void => {
        if (index > 0) {
          statement.append(" OR ");
        }

        this.holdsToken({ statement, role, tokens: data.tokens });
      },
    );

    statement.append(")");

    return statement;
  }

  public static async countNamedEvents(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
  }): Promise<number> {
    const tokens: Array<string> = erasableTokens(data.tokens);

    if (tokens.length === 0) {
      return 0;
    }

    const result: Results = await SecurityEventService.executeQuery(
      this.toCountEventsStatement({ projectId: data.projectId, tokens }),
      MigrationExecuteOptions,
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const row: JSONObject | undefined = (response.data || [])[0] as
      | JSONObject
      | undefined;

    return Number(row?.["namedEvents"] || 0) || 0;
  }

  /*
   * The attributes an event of a role keeps once the token is back: what
   * the rule left is no longer kept beside a user, the marker says a scrub
   * rule hid it, the erased attribute says why, and - for who acted - the
   * request's user is the token again when it was the user. Every
   * reference is to the row as it was: a mutation reads the old values.
   */
  private static appendErasedAttributes(data: {
    statement: Statement;
    role: ScrubbedUserRole;
  }): Statement {
    const statement: Statement = data.statement;
    const hashedAs: string = HASHED_USER_ATTRIBUTES[data.role];
    const marker: { hidden: string; scrubbed: string } =
      SCRUBBED_USER_ATTRIBUTES[data.role];
    const userColumn: string = getEventUserColumn(data.role);

    statement.append("mapUpdate(");

    if (data.role === ScrubbedUserRole.Principal) {
      statement.append(
        SQL`mapApply((attributeKey, attributeValue) -> (attributeKey, if(attributeKey = ${text(SECURITY_REQUEST_ATTRIBUTES.userId)} AND attributeValue = `,
      );
      statement.append(userColumn);
      statement.append(
        SQL`, attributes[${text(hashedAs)}], attributeValue)), mapFilter((attributeKey, attributeValue) -> attributeKey != ${text(hashedAs)}, attributes))`,
      );
    } else {
      statement.append(
        SQL`mapFilter((attributeKey, attributeValue) -> attributeKey != ${text(hashedAs)}, attributes)`,
      );
    }

    statement.append(
      SQL`, map(${text(marker.hidden)}, ${text(USER_HIDDEN_BY_SCRUB_RULE)}, ${text(marker.scrubbed)}, attributes[${text(hashedAs)}], ${text(ERASED_USER_ATTRIBUTES[data.role])}, ${text(USER_ERASED_ON_REQUEST)}))`,
    );

    return statement;
  }

  /*
   * The update that puts the token back in a project's events whose user
   * of a role the vault named from one of the tokens. See the file's
   * comment.
   */
  public static toUnnameEventsStatement(data: {
    projectId: ObjectID;
    role: ScrubbedUserRole;
    tokens: Array<string>;
  }): Statement {
    const hashedAs: string = HASHED_USER_ATTRIBUTES[data.role];
    const userColumn: string = getEventUserColumn(data.role);
    const statement: Statement = SQL`ALTER TABLE `;

    statement.append(
      `${databaseName()}.${getStorageTableName(SecurityEventService.model.tableName)}`,
    );
    statement.append(onClusterClause());
    statement.append(` UPDATE ${userColumn} = `);
    statement.append(SQL`attributes[${text(hashedAs)}]`);
    // The token in the user's place among the observables, once.
    statement.append(
      SQL`, observables = arrayDistinct(arrayConcat(arrayFilter(observable -> lower(observable) != lower(`,
    );
    statement.append(userColumn);
    statement.append(SQL`), observables), [attributes[${text(hashedAs)}]]))`);
    statement.append(", attributes = ");
    this.appendErasedAttributes({ statement, role: data.role });
    statement.append(", attributeKeys = mapKeys(");
    this.appendErasedAttributes({ statement, role: data.role });
    statement.append(
      SQL`) WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND `,
    );
    this.holdsToken({ statement, role: data.role, tokens: data.tokens });

    return statement;
  }

  /*
   * Queues the updates that put the token back in a project's events, one
   * for each role, and returns once ClickHouse holds them: durable from
   * then on, and checked on a later run (countNamedEvents finds none).
   */
  public static async unnameEvents(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
  }): Promise<void> {
    const tokens: Array<string> = erasableTokens(data.tokens);

    if (tokens.length === 0) {
      return;
    }

    for (const role of SCRUBBED_USER_ROLES) {
      await SecurityEventService.execute(
        this.toUnnameEventsStatement({
          projectId: data.projectId,
          role,
          tokens,
        }),
        MigrationExecuteOptions,
      );
    }
  }
}
