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
import DetectionFingerprint from "../DetectionFingerprint";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ENRICHMENT_CONFIDENCE_ATTRIBUTE,
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import { SCRUB_HASH_TOKEN_PATTERN } from "../../../../Types/Telemetry/ScrubHashTokenFormat";
import {
  ERASED_USER_ATTRIBUTES,
  HASHED_USER_ATTRIBUTES,
  SCRUBBED_USER_ATTRIBUTES,
  SCRUBBED_USER_ROLES,
  ScrubbedUserRole,
  USER_ERASED_ON_REQUEST,
} from "../../../../Utils/SecurityEvent/ScrubbedUser";
import { ErasedName } from "../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import { getEventUserColumn } from "./SecurityUserErasureEvents";

/*
 * THE THREAT INTEL STAMP ON THE PERSON'S EVENTS (#11230).
 *
 * The ingest-time enricher (ThreatIntel/ThreatIntelEnricher) stamps an
 * event whose observables a feed's indicator matches: threat.indicator_value,
 * the value it matched in lower case, and threat.indicator_id, the feed's id
 * for the indicator, beside the feed, the type and the confidence. The scans
 * name an event's user by the user vault before the enricher runs
 * (SecurityLogScanner, and the trace scan's SecurityTelemetryScanner), so
 * when a feed lists the person's email address, the events the vault named
 * them in were stamped with the address and the feed's indicator. An
 * erasure put the token back in the user, the observables and the markers
 * (SecurityUserErasureEvents), and left the stamp: the address in clear,
 * and the indicator's id, beside which the feed keeps the address.
 *
 * So an erasure finds the person's stamped events by their tokens - those
 * the vault named them in (oneuptime.<role>_user_hashed_as), and those an
 * erasure already un-named (oneuptime.<role>_user_scrubbed with
 * oneuptime.<role>_user_erased: a request filed again once this was fixed)
 * - and tells in the worker whether a stamp is the person's: it is the
 * event's own user, lower-cased as the enricher matched it, or, on an event
 * an erasure un-named, one of the names that left the same token. Each of
 * the person's stamps gets what the Hash rule left in the value's place,
 * and the erased indicator id in the indicator's: the fingerprint the feed's
 * finding, alert and case detection carry for the same match
 * (DetectionFingerprint.erasedIndicatorIdOf). The feed and the
 * indicator's type stay; the indicator's confidence, threat.confidence,
 * goes (#11447): the feed keeps the score beside the address, and in a
 * small feed whose addresses each have their own, it could point back at
 * one. A stamp an earlier erasure left with its score - it holds a token
 * already - loses it the same way. A stamp about anything else the event
 * names - an address, a domain, another person - stays as it is.
 *
 * NEVER THE PERSON IN A STATEMENT. The read names the project, attribute
 * keys and the tokens; the rewrite names the events by their _id, in the
 * stretch of time they happened in, with what goes in: a token and a keyed
 * id. An event a run rewrote holds a token in its stamp, which the read
 * leaves out, so a run again finds nothing; and the rewrite puts in what it
 * puts in however often it is applied.
 */

// How many stamped events one read returns.
export const STAMPED_EVENTS_PAGE_SIZE: number = 5000;

// The most events one mutation rewrites: their ids are in its command.
export const MAX_STAMPS_PER_MUTATION: number = 1000;

/*
 * The most stamps one run rewrites: past it, a later run rewrites the rest
 * (the request stays Erasing while any is left).
 */
export const MAX_STAMPS_PER_RUN: number = 50000;

// The roles' attributes the read takes: what tells whose a stamp is.
interface RoleOfStampedEvent {
  // The event's user of the role, as stored.
  user: string;
  // What the rule left, while the vault names the user.
  hashedAs: string;
  // What the rule left, once an erasure took the user out.
  scrubbed: string;
  // Whether an erasure request took the user out.
  isErased: boolean;
}

// An event the enricher stamped, as the read returns it.
export interface StampedEventRow {
  id: string;
  // When it happened, in nanoseconds since the epoch, as text.
  time: string;
  // The value the indicator matched, as the enricher stamped it.
  indicatorValue: string;
  // The indicator's score the stamp holds, "" for none (#11447).
  confidence?: string | undefined;
  roles: Record<ScrubbedUserRole, RoleOfStampedEvent>;
}

// What goes in an event's stamp once the person is out of it.
export interface StampRewrite {
  id: string;
  time: string;
  // What the Hash rule left, in the value's place.
  value: string;
  // The erased indicator id, in the indicator's.
  indicatorId: string;
}

// One mutation: events that take the same stamp, close in time.
export interface StampsMutation {
  value: string;
  indicatorId: string;
  ids: Array<string>;
  fromTime: string;
  toTime: string;
}

// Where a read of the stamped events is: after this event, in (time, _id) order.
export interface StampedEventsCursor {
  time: string;
  id: string;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function text(value: string): { type: TableColumnType; value: string } {
  return { type: TableColumnType.Text, value };
}

function nanoseconds(value: string): { type: TableColumnType; value: string } {
  return { type: TableColumnType.BigNumber, value };
}

function databaseName(): string {
  if (!SecurityEventService.database) {
    SecurityEventService.useDefaultDatabase();
  }

  return SecurityEventService.database.getDatasourceOptions().database!;
}

// The tokens a request erases, of today's form, each once.
function erasableTokens(tokens: ReadonlyArray<string>): Array<string> {
  return Array.from(
    new Set<string>(
      tokens.filter((token: string): boolean => {
        return SCRUB_HASH_TOKEN_PATTERN.test(token);
      }),
    ),
  );
}

// Whether a text holds one of the tokens.
function holdsAnyToken(value: string, tokens: ReadonlyArray<string>): boolean {
  return (
    Boolean(value) &&
    tokens.some((token: string): boolean => {
      return Boolean(token) && value.includes(token);
    })
  );
}

// A value as the enricher matched it: trimmed, in lower case.
function canonical(value: string): string {
  return (value || "").trim().toLowerCase();
}

// The tokens of today's form a text holds.
function tokensIn(value: string): Array<string> {
  return value.match(/\[HASHED:[0-9a-f]{16}\]/g) || [];
}

// Whether two texts a Hash rule left hold a token in common.
function shareAToken(left: string, right: string): boolean {
  const tokens: Array<string> = tokensIn(right);

  return tokensIn(left).some((token: string): boolean => {
    return tokens.includes(token);
  });
}

function compareTimes(a: string, b: string): number {
  const left: bigint = BigInt(a || "0");
  const right: bigint = BigInt(b || "0");

  return left < right ? -1 : left > right ? 1 : 0;
}

/*
 * The rewrite an event's stamp needs, or null when the stamp is not the
 * person's (see the file's comment). `tokens` are the request's, `names`
 * who the worker found the person named as.
 */
export function planStampRewrite(
  row: StampedEventRow,
  context: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
    names: ReadonlyArray<ErasedName>;
  },
): StampRewrite | null {
  const stamp: string = canonical(row.indicatorValue);

  if (!row.id || !stamp) {
    return null;
  }

  /*
   * A stamp an earlier erasure took the person out of holds their token,
   * and may still hold the indicator's score (#11447): it loses that, and
   * keeps what it says - the token, the erased indicator id it is made of.
   */
  if (holdsAnyToken(row.indicatorValue, context.tokens)) {
    return row.confidence
      ? {
          id: row.id,
          time: row.time,
          value: row.indicatorValue,
          indicatorId: DetectionFingerprint.erasedIndicatorIdOf({
            projectId: context.projectId,
            value: row.indicatorValue,
          }),
        }
      : null;
  }

  for (const role of SCRUBBED_USER_ROLES) {
    const user: RoleOfStampedEvent = row.roles[role];
    let left: string | null = null;

    if (holdsAnyToken(user.hashedAs, context.tokens)) {
      // The vault names the user still: the stamp is theirs when it is the user.
      left = canonical(user.user) === stamp ? user.hashedAs : null;
    } else if (user.isErased && holdsAnyToken(user.scrubbed, context.tokens)) {
      // Un-named already: the stamp is theirs when it is a name that left this token.
      left = context.names.some((name: ErasedName): boolean => {
        return (
          canonical(name.named) === stamp &&
          (name.hashed === user.scrubbed ||
            shareAToken(name.hashed, user.scrubbed))
        );
      })
        ? user.scrubbed
        : null;
    }

    if (left) {
      return {
        id: row.id,
        time: row.time,
        value: left,
        indicatorId: DetectionFingerprint.erasedIndicatorIdOf({
          projectId: context.projectId,
          value: left,
        }),
      };
    }
  }

  return null;
}

/*
 * The mutations that make the rewrites: one for each stamp that goes in,
 * of at most MAX_STAMPS_PER_MUTATION events close in time. An event planned
 * twice is rewritten once.
 */
export function batchStampRewrites(
  rewrites: ReadonlyArray<StampRewrite>,
  maxPerMutation: number = MAX_STAMPS_PER_MUTATION,
): Array<StampsMutation> {
  const groups: Map<string, Map<string, StampRewrite>> = new Map();

  for (const rewrite of rewrites) {
    const key: string = `${rewrite.value}\u0000${rewrite.indicatorId}`;
    const group: Map<string, StampRewrite> = groups.get(key) || new Map();

    group.set(rewrite.id, rewrite);
    groups.set(key, group);
  }

  const mutations: Array<StampsMutation> = [];
  const size: number = Math.max(1, maxPerMutation);

  for (const group of groups.values()) {
    const ordered: Array<StampRewrite> = Array.from(group.values()).sort(
      (a: StampRewrite, b: StampRewrite): number => {
        return compareTimes(a.time, b.time) || a.id.localeCompare(b.id);
      },
    );

    for (let start: number = 0; start < ordered.length; start += size) {
      const chunk: Array<StampRewrite> = ordered.slice(start, start + size);

      mutations.push({
        value: chunk[0]!.value,
        indicatorId: chunk[0]!.indicatorId,
        ids: chunk.map((rewrite: StampRewrite): string => {
          return rewrite.id;
        }),
        fromTime: chunk[0]!.time,
        toTime: chunk[chunk.length - 1]!.time,
      });
    }
  }

  return mutations;
}

export default class SecurityUserErasureThreatStamps {
  // `attributes[...]` holding one of the tokens: a token is a distinctive 25 characters.
  private static appendHoldsToken(data: {
    statement: Statement;
    attribute: string;
    tokens: Array<string>;
  }): void {
    data.statement.append(
      SQL`multiSearchAny(attributes[${text(data.attribute)}], ${{
        type: TableColumnType.Text,
        value: new Includes(data.tokens),
      }})`,
    );
  }

  /*
   * A page of the project's events that carry a threat intel stamp holding
   * no token yet, and one of the tokens as a user's: named by the vault, or
   * un-named by an erasure with a stamp that is none of the event's
   * observables any more (the person's name was one) - or a stamp holding
   * one of the tokens already that still holds the indicator's score
   * (#11447). In the order they happened, after `after`. Names the project,
   * attribute keys and the tokens, never anybody.
   */
  public static toStampedEventsStatement(data: {
    projectId: ObjectID;
    tokens: Array<string>;
    after?: StampedEventsCursor | null | undefined;
    limit: number;
  }): Statement {
    const statement: Statement = SQL`SELECT _id AS stampedEventId, toString(toUnixTimestamp64Nano(time)) AS stampedEventTime, attributes[${text(ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE)}] AS stampedValue, attributes[${text(ENRICHMENT_CONFIDENCE_ATTRIBUTE)}] AS stampedConfidence`;

    for (const role of SCRUBBED_USER_ROLES) {
      statement.append(`, ${getEventUserColumn(role)} AS ${role}StampedUser, `);
      statement.append(SQL`attributes[${text(HASHED_USER_ATTRIBUTES[role])}]`);
      statement.append(` AS ${role}StampedHashedAs, `);
      statement.append(
        SQL`attributes[${text(SCRUBBED_USER_ATTRIBUTES[role].scrubbed)}]`,
      );
      statement.append(` AS ${role}StampedScrubbed, `);
      statement.append(SQL`attributes[${text(ERASED_USER_ATTRIBUTES[role])}]`);
      statement.append(` AS ${role}StampedErased`);
    }

    statement.append(" FROM ");
    statement.append(
      `${databaseName()}.${SecurityEventService.model.tableName}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND attributes[${text(ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE)}] != '' AND ((`,
    );

    // Left by an earlier erasure with the indicator's score (#11447).
    this.appendHoldsToken({
      statement,
      attribute: ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
      tokens: data.tokens,
    });
    statement.append(
      SQL` AND attributes[${text(ENRICHMENT_CONFIDENCE_ATTRIBUTE)}] != '') OR (NOT `,
    );
    this.appendHoldsToken({
      statement,
      attribute: ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
      tokens: data.tokens,
    });
    statement.append(" AND (");

    // Named by the vault: the stamp may be the user.
    for (const role of SCRUBBED_USER_ROLES) {
      this.appendHoldsToken({
        statement,
        attribute: HASHED_USER_ATTRIBUTES[role],
        tokens: data.tokens,
      });
      statement.append(" OR ");
    }

    // Un-named by an erasure: the stamp may be the name it took out of the observables.
    statement.append("((");

    SCRUBBED_USER_ROLES.forEach(
      (role: ScrubbedUserRole, index: number): void => {
        if (index > 0) {
          statement.append(" OR ");
        }

        statement.append(
          SQL`(attributes[${text(ERASED_USER_ATTRIBUTES[role])}] = ${text(USER_ERASED_ON_REQUEST)} AND `,
        );
        this.appendHoldsToken({
          statement,
          attribute: SCRUBBED_USER_ATTRIBUTES[role].scrubbed,
          tokens: data.tokens,
        });
        statement.append(")");
      },
    );

    statement.append(
      SQL`) AND NOT has(arrayMap(observable -> lowerUTF8(observable), observables), lowerUTF8(attributes[${text(ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE)}]))))))`,
    );

    if (data.after) {
      statement.append(
        SQL` AND time >= fromUnixTimestamp64Nano(${nanoseconds(data.after.time)}) AND (toUnixTimestamp64Nano(time), _id) > (${nanoseconds(data.after.time)}, ${text(data.after.id)})`,
      );
    }

    statement.append(
      SQL` ORDER BY time, _id LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }}`,
    );

    return statement;
  }

  // A page of the project's stamped events after `after`, as the read returns them.
  public static async readStampedEvents(data: {
    projectId: ObjectID;
    tokens: Array<string>;
    after?: StampedEventsCursor | null | undefined;
    limit: number;
  }): Promise<Array<StampedEventRow>> {
    const result: Results = await SecurityEventService.executeQuery(
      this.toStampedEventsStatement(data),
      MigrationExecuteOptions,
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return ((response.data || []) as Array<JSONObject>).map(
      (row: JSONObject): StampedEventRow => {
        const roleOf: (role: ScrubbedUserRole) => RoleOfStampedEvent = (
          role: ScrubbedUserRole,
        ): RoleOfStampedEvent => {
          return {
            user: readText(row[`${role}StampedUser`]),
            hashedAs: readText(row[`${role}StampedHashedAs`]),
            scrubbed: readText(row[`${role}StampedScrubbed`]),
            isErased:
              readText(row[`${role}StampedErased`]) === USER_ERASED_ON_REQUEST,
          };
        };

        return {
          id: readText(row["stampedEventId"]),
          time: readText(row["stampedEventTime"]),
          indicatorValue: readText(row["stampedValue"]),
          confidence: readText(row["stampedConfidence"]),
          roles: {
            [ScrubbedUserRole.Principal]: roleOf(ScrubbedUserRole.Principal),
            [ScrubbedUserRole.Target]: roleOf(ScrubbedUserRole.Target),
          },
        };
      },
    );
  }

  /*
   * The rewrites the project's stamps about the person need, at most
   * `maxRewrites` of them: every page of stamped events read through, each
   * stamp matched to the person here, in the worker.
   */
  public static async findStampRewrites(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
    names: ReadonlyArray<ErasedName>;
    maxRewrites?: number | undefined;
    pageSize?: number | undefined;
  }): Promise<Array<StampRewrite>> {
    const tokens: Array<string> = erasableTokens(data.tokens);

    if (tokens.length === 0) {
      return [];
    }

    const maxRewrites: number = Math.max(
      1,
      data.maxRewrites ?? MAX_STAMPS_PER_RUN,
    );
    const pageSize: number = Math.max(
      1,
      data.pageSize ?? STAMPED_EVENTS_PAGE_SIZE,
    );
    const rewrites: Array<StampRewrite> = [];
    let after: StampedEventsCursor | null = null;

    for (;;) {
      const rows: Array<StampedEventRow> = await this.readStampedEvents({
        projectId: data.projectId,
        tokens,
        after,
        limit: pageSize,
      });

      for (const row of rows) {
        const rewrite: StampRewrite | null = planStampRewrite(row, {
          projectId: data.projectId,
          tokens,
          names: data.names,
        });

        if (rewrite) {
          rewrites.push(rewrite);

          if (rewrites.length >= maxRewrites) {
            return rewrites;
          }
        }

        after = { time: row.time, id: row.id };
      }

      if (rows.length < pageSize) {
        return rewrites;
      }
    }
  }

  /*
   * The mutation that gives a batch of events their stamp once the person is
   * out: what the Hash rule left in the value's place, the erased indicator
   * id in the indicator's, and no indicator's score (#11447). On the local
   * table, ON CLUSTER, as every write to an analytics table that already
   * holds rows is; matches the events by their _id, in the stretch of time
   * they happened in.
   */
  public static toRewriteStampsStatement(data: {
    projectId: ObjectID;
    mutation: StampsMutation;
  }): Statement {
    const stamp: () => Statement = (): Statement => {
      return SQL`mapFilter((stampKey, stampValue) -> stampKey != ${text(ENRICHMENT_CONFIDENCE_ATTRIBUTE)}, mapUpdate(attributes, map(${text(ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE)}, ${text(data.mutation.value)}, ${text(ENRICHMENT_INDICATOR_ID_ATTRIBUTE)}, ${text(data.mutation.indicatorId)})))`;
    };
    const statement: Statement = SQL`ALTER TABLE `;

    statement.append(
      `${databaseName()}.${getStorageTableName(SecurityEventService.model.tableName)}`,
    );
    statement.append(onClusterClause());
    statement.append(" UPDATE attributes = ");
    statement.append(stamp());
    statement.append(", attributeKeys = mapKeys(");
    statement.append(stamp());
    statement.append(
      SQL`) WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= fromUnixTimestamp64Nano(${nanoseconds(data.mutation.fromTime)}) AND time <= fromUnixTimestamp64Nano(${nanoseconds(data.mutation.toTime)}) AND _id IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.mutation.ids),
      }})`,
    );

    return statement;
  }

  /*
   * Finds the person's stamps and queues the mutations that rewrite them;
   * returns how many events they change, once ClickHouse holds them.
   */
  public static async rewriteStamps(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
    names: ReadonlyArray<ErasedName>;
  }): Promise<number> {
    const rewrites: Array<StampRewrite> = await this.findStampRewrites(data);
    let changed: number = 0;

    for (const mutation of batchStampRewrites(rewrites)) {
      await SecurityEventService.execute(
        this.toRewriteStampsStatement({
          projectId: data.projectId,
          mutation,
        }),
        MigrationExecuteOptions,
      );
      changed += mutation.ids.length;
    }

    return changed;
  }

  // Whether a stamp about the person is left: what an erasure checks before it is done.
  public static async hasStampsLeft(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
    names: ReadonlyArray<ErasedName>;
  }): Promise<boolean> {
    return (
      (await this.findStampRewrites({ ...data, maxRewrites: 1 })).length > 0
    );
  }
}
