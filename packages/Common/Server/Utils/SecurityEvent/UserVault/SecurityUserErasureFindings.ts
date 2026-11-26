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
import JobDeadline from "../../JobDeadline";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/DetectionFindingConstants";
import { THREAT_INDICATOR_VALUE_ATTRIBUTE } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import { USER_ERASED_ON_REQUEST } from "../../../../Utils/SecurityEvent/ScrubbedUser";
import { ErasedName } from "../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";

/*
 * THE DETECTION FINDINGS AN ERASURE TAKES THE PERSON OUT OF (#11044).
 *
 * A detection rule or a threat intel feed that matched events writes a
 * Detection Finding back into the events (DetectionRuleEvaluator,
 * ThreatIntelMatcher). What it is about is in it, copied from the events:
 *
 *   - its observables: the value it grouped on first (each value a
 *     correlation grouped on), then the matched events' sample
 *     observables;
 *   - its message, "Detection: <rule> — <group value> (<n> events)", with
 *     a correlation's sentence after the count ("; First principalUser in
 *     7 days: <value>, <value> and 2 more"), or "Threat intel: <feed> —
 *     <indicator> (<n> events)";
 *   - the attributes that repeat them: oneuptime.detection.group_value,
 *     oneuptime.detection.summary, oneuptime.threat.indicator_value.
 *
 * When the user vault named a person in the events, a finding about them
 * names them in all of these, and carries no oneuptime.<role>_user_hashed_as
 * to find it by (SecurityUserErasureEvents finds the events by it). So an
 * erasure reads the project's findings - OneUptime's own, never a finding a
 * connector brought in, which named whoever its source named - and takes
 * out every value that is one of the names the request found (an exact
 * observable), as the events get the token back: each becomes what the
 * Hash rule left in its place, everywhere the finding repeats it. The
 * finding stays, a record of what was detected, and says an erasure
 * request changed it (oneuptime.finding_user_erased).
 *
 * NEVER THE PERSON IN A STATEMENT. ClickHouse keeps a mutation's command
 * (system.mutations, and Keeper's copy of an ON CLUSTER one) and a query's
 * text (system.query_log) long after they ran. So:
 *
 *   - the read names the project and the finding class only, and the
 *     names are matched here, in the worker;
 *   - the update names the findings by their _id (random, nothing of the
 *     person), and what goes in a name's place is built in ClickHouse from
 *     the finding's own observable and the token: the bytes the rule left
 *     whole before and after the token ("auth0|" in "auth0|[HASHED:...]")
 *     are the observable's own, so only their lengths and the token are
 *     sent. Where the observable stands in the message and the attributes,
 *     ClickHouse finds it by its own value too (regexpQuoteMeta of the
 *     observable), set apart as OneUptime writes values there - never a
 *     name inside other text, such as another user who contains it.
 *
 * BATCHED AND IDEMPOTENT. Findings that need the same change (the same
 * observables replaced by the same tokens - most findings about a person
 * need exactly one) share one mutation, up to MAX_FINDINGS_PER_MUTATION, so
 * a part is rewritten once for many of them. A finding a run already
 * changed holds no name any more, so the next run's read leaves it out;
 * and a mutation applied twice changes nothing more, as everything it puts
 * in is built from what is there (a token in place of a token).
 */

// How many findings one read returns.
export const ERASURE_FINDINGS_PAGE_SIZE: number = 5000;

// The most findings one mutation changes: the ids are in its command.
export const MAX_FINDINGS_PER_MUTATION: number = 1000;

/*
 * The most findings one run changes: past it, a later run changes the rest
 * (the request reads Erased only once none is left).
 */
export const MAX_FINDINGS_UNNAMED_PER_RUN: number = 50000;

/*
 * How long one read of a project's findings may take, all its pages: past
 * it the run fails and is tried again, and after its last attempt the
 * project's owners are told.
 */
export const ERASURE_FINDINGS_SCAN_TIME_LIMIT_MS: number = 5 * 60 * 1000;

// Who writes the findings an erasure changes: OneUptime's detection rules and threat intel.
export const ERASURE_FINDINGS_VENDOR: string = "OneUptime";

// The attributes that repeat what a finding is about.
export const FINDING_NAMING_ATTRIBUTES: ReadonlyArray<string> = [
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
];

// Says an erasure request took a user out of the finding: never who.
export const FINDING_USER_ERASED_ATTRIBUTE: string =
  "oneuptime.finding_user_erased";

/*
 * How OneUptime sets a value apart in a finding's message and attributes:
 * after the start, " — ", " / ", ": " or ", "; before " (", " / ", ", ",
 * " and ", ")" or the end. As RE2 reads them, the observable between them.
 */
export const FINDING_VALUE_BEFORE: string = "(^| — | / |: |, )";
export const FINDING_VALUE_AFTER: string = "( \\(| / |, | and |\\)|$)";

// A replacement's references to those two groups, and a backslash as RE2 writes one there.
const REGEXP_GROUP_BEFORE: string = "\\1";
const REGEXP_GROUP_AFTER: string = "\\2";
const BACKSLASH: string = "\\";
const ESCAPED_BACKSLASH: string = "\\\\";

// A Hash rule's token of today's form, anywhere in a text.
const TOKEN_IN_TEXT: RegExp = /\[HASHED:[0-9a-f]{16}\]/g;

/*
 * What goes in place of one observable that is a name: what the Hash rule
 * left, made of the observable's first `prefixBytes` bytes, the token, and
 * its last `suffixBytes` bytes. With no token alone in what the rule left
 * to line up with the name, the tokens alone, nothing of the observable.
 */
export interface FindingReplacement {
  // Where the observable is, counted from 1 (as ClickHouse counts).
  position: number;
  prefixBytes: number;
  token: string;
  suffixBytes: number;
}

// A finding that names one of the names, and what its change is.
export interface FindingRewrite {
  id: string;
  // When it happened, in nanoseconds since the epoch, as text.
  time: string;
  replacements: Array<FindingReplacement>;
}

// A finding as the read returns it.
export interface ErasureFindingRow {
  id: string;
  time: string;
  observables: Array<string>;
}

function utf8Length(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function databaseName(): string {
  if (!SecurityEventService.database) {
    SecurityEventService.useDefaultDatabase();
  }

  return SecurityEventService.database.getDatasourceOptions().database!;
}

function text(value: string): { type: TableColumnType; value: string } {
  return { type: TableColumnType.Text, value };
}

function number(value: number): { type: TableColumnType; value: number } {
  return { type: TableColumnType.Number, value };
}

function nanoseconds(value: string): { type: TableColumnType; value: string } {
  return { type: TableColumnType.BigNumber, value };
}

/*
 * What goes in place of `name.named` when an observable is exactly it, or
 * null for a name whose hashed form holds no token of today's form (none
 * of a request's names: they are each made of a token).
 */
export function getFindingReplacement(
  name: ErasedName,
  position: number,
): FindingReplacement | null {
  const tokens: Array<string> = name.hashed.match(TOKEN_IN_TEXT) || [];

  if (tokens.length === 0) {
    return null;
  }

  if (tokens.length === 1) {
    const token: string = tokens[0]!;
    const at: number = name.hashed.indexOf(token);
    const prefix: string = name.hashed.slice(0, at);
    const suffix: string = name.hashed.slice(at + token.length);

    if (
      name.named.length > prefix.length + suffix.length &&
      name.named.startsWith(prefix) &&
      name.named.endsWith(suffix)
    ) {
      return {
        position,
        prefixBytes: utf8Length(prefix),
        token,
        suffixBytes: utf8Length(suffix),
      };
    }
  }

  // Two tokens or more, or a name that does not line up: the tokens alone.
  return {
    position,
    prefixBytes: 0,
    token: Array.from(new Set<string>(tokens)).join(" "),
    suffixBytes: 0,
  };
}

/*
 * The change a finding needs: each observable that is exactly one of the
 * names, with what goes in its place. Null when it names none of them.
 */
export function planFindingRewrite(
  row: ErasureFindingRow,
  names: ReadonlyArray<ErasedName>,
): FindingRewrite | null {
  const byName: Map<string, ErasedName> = new Map<string, ErasedName>();

  for (const name of names) {
    if (name.named && name.hashed && name.named !== name.hashed) {
      byName.set(name.named, name);
    }
  }

  const replacements: Array<FindingReplacement> = [];

  row.observables.forEach((observable: string, index: number): void => {
    const name: ErasedName | undefined = byName.get(observable);
    const replacement: FindingReplacement | null = name
      ? getFindingReplacement(name, index + 1)
      : null;

    if (replacement) {
      replacements.push(replacement);
    }
  });

  return replacements.length > 0
    ? { id: row.id, time: row.time, replacements }
    : null;
}

// The change, as text: findings that need the same change share a mutation.
function changeKeyOf(replacements: ReadonlyArray<FindingReplacement>): string {
  return JSON.stringify(
    replacements.map((replacement: FindingReplacement): Array<unknown> => {
      return [
        replacement.position,
        replacement.prefixBytes,
        replacement.token,
        replacement.suffixBytes,
      ];
    }),
  );
}

function compareTimes(a: string, b: string): number {
  const left: bigint = BigInt(a || "0");
  const right: bigint = BigInt(b || "0");

  return left < right ? -1 : left > right ? 1 : 0;
}

export interface FindingsMutation {
  replacements: Array<FindingReplacement>;
  ids: Array<string>;
  // The earliest and the latest of the findings' times, in nanoseconds.
  fromTime: string;
  toTime: string;
}

/*
 * The mutations that make the rewrites: one for each change, of at most
 * MAX_FINDINGS_PER_MUTATION findings close in time, so each one rewrites
 * only the parts that hold its findings.
 */
export function batchFindingRewrites(
  rewrites: ReadonlyArray<FindingRewrite>,
  maxPerMutation: number = MAX_FINDINGS_PER_MUTATION,
): Array<FindingsMutation> {
  const groups: Map<string, Array<FindingRewrite>> = new Map();

  for (const rewrite of rewrites) {
    const key: string = changeKeyOf(rewrite.replacements);
    const group: Array<FindingRewrite> = groups.get(key) || [];

    group.push(rewrite);
    groups.set(key, group);
  }

  const mutations: Array<FindingsMutation> = [];

  for (const group of groups.values()) {
    const ordered: Array<FindingRewrite> = [...group].sort(
      (a: FindingRewrite, b: FindingRewrite): number => {
        return compareTimes(a.time, b.time) || a.id.localeCompare(b.id);
      },
    );

    for (
      let start: number = 0;
      start < ordered.length;
      start += Math.max(1, maxPerMutation)
    ) {
      const chunk: Array<FindingRewrite> = ordered.slice(
        start,
        start + Math.max(1, maxPerMutation),
      );

      mutations.push({
        replacements: chunk[0]!.replacements,
        ids: chunk.map((rewrite: FindingRewrite): string => {
          return rewrite.id;
        }),
        fromTime: chunk[0]!.time,
        toTime: chunk[chunk.length - 1]!.time,
      });
    }
  }

  return mutations;
}

export interface FindingsScanResult {
  // The findings that name one of the names, at most `maxRewrites` of them.
  rewrites: Array<FindingRewrite>;
  // Whether there may be more than were kept: the read stopped at the cap.
  isCapped: boolean;
}

export default class SecurityUserErasureFindings {
  /*
   * A page of the project's own Detection Findings, in the order they were
   * written, after `after`: their _id, when, and their observables. Names
   * the project, the class and the vendor - never anybody.
   */
  public static toFindingsPageStatement(data: {
    projectId: ObjectID;
    after?: { time: string; id: string } | undefined;
    limit: number;
  }): Statement {
    const statement: Statement = SQL`SELECT _id AS findingId, toString(toUnixTimestamp64Nano(time)) AS findingTime, observables FROM `;

    statement.append(
      `${databaseName()}.${SecurityEventService.model.tableName}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND className = ${text(DETECTION_FINDING_CLASS_NAME)} AND vendorName = ${text(ERASURE_FINDINGS_VENDOR)}`,
    );

    if (data.after) {
      statement.append(
        SQL` AND time >= fromUnixTimestamp64Nano(${nanoseconds(data.after.time)}) AND (toUnixTimestamp64Nano(time), _id) > (${nanoseconds(data.after.time)}, ${text(data.after.id)})`,
      );
    }

    statement.append(
      SQL` ORDER BY time, _id LIMIT ${number(Math.max(1, Math.trunc(data.limit)))}`,
    );

    return statement;
  }

  /*
   * The project's own findings that name one of the names, oldest first:
   * every page of them read, and matched here. Stops at the first when
   * `stopAtFirst` (the check needs no more), and keeps at most
   * `maxRewrites`. Throws when it takes longer than its time limit, or when
   * the run's deadline passes.
   */
  public static async findNamingFindings(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
    stopAtFirst?: boolean | undefined;
    maxRewrites?: number | undefined;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    timeLimitMs?: number | undefined;
  }): Promise<FindingsScanResult> {
    const names: Array<ErasedName> = data.names.filter(
      (name: ErasedName): boolean => {
        return (
          Boolean(name.named) &&
          Boolean(name.hashed) &&
          name.named !== name.hashed
        );
      },
    );
    const rewrites: Array<FindingRewrite> = [];
    const maxRewrites: number = Math.max(
      1,
      data.maxRewrites ?? MAX_FINDINGS_UNNAMED_PER_RUN,
    );
    const pageSize: number = Math.max(
      1,
      data.pageSize ?? ERASURE_FINDINGS_PAGE_SIZE,
    );
    const timeLimitMs: number =
      data.timeLimitMs ?? ERASURE_FINDINGS_SCAN_TIME_LIMIT_MS;
    const startedAt: number = Date.now();

    if (names.length === 0) {
      return { rewrites, isCapped: false };
    }

    let after: { time: string; id: string } | undefined = undefined;

    for (;;) {
      data.deadline?.throwIfPassed();

      if (Date.now() - startedAt > timeLimitMs) {
        throw new Error(
          "Security Events could not read all of the project's Detection Findings in the time an erasure run has. It is tried again.",
        );
      }

      const result: Results = await SecurityEventService.executeQuery(
        this.toFindingsPageStatement({
          projectId: data.projectId,
          after,
          limit: pageSize,
        }),
        MigrationExecuteOptions,
      );
      const response: ResponseJSON<JSONObject> =
        await result.json<JSONObject>();
      const rows: Array<JSONObject> = (response.data ||
        []) as Array<JSONObject>;

      for (const row of rows) {
        const finding: ErasureFindingRow = {
          id: readText(row["findingId"]),
          time: readText(row["findingTime"]),
          observables: Array.isArray(row["observables"])
            ? (row["observables"] as Array<JSONValue>).map(readText)
            : [],
        };
        const rewrite: FindingRewrite | null = finding.id
          ? planFindingRewrite(finding, names)
          : null;

        if (!rewrite) {
          continue;
        }

        rewrites.push(rewrite);

        if (data.stopAtFirst) {
          return { rewrites, isCapped: false };
        }

        if (rewrites.length >= maxRewrites) {
          return { rewrites, isCapped: true };
        }
      }

      const last: JSONObject | undefined = rows[rows.length - 1];

      if (rows.length < pageSize || !last) {
        return { rewrites, isCapped: false };
      }

      after = {
        time: readText(last["findingTime"]),
        id: readText(last["findingId"]),
      };
    }
  }

  // Whether any of the project's own findings still names one of the names.
  public static async isAnyFindingNaming(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
    deadline?: JobDeadline | undefined;
  }): Promise<boolean> {
    const found: FindingsScanResult = await this.findNamingFindings({
      projectId: data.projectId,
      names: data.names,
      stopAtFirst: true,
      deadline: data.deadline,
    });

    return found.rewrites.length > 0;
  }

  // What the rule left of the observable at a replacement's place, built from `observable`.
  private static appendHashed(data: {
    statement: Statement;
    observable: string;
    replacement: FindingReplacement;
  }): void {
    data.statement.append("concat(left(");
    data.statement.append(data.observable);
    data.statement.append(
      SQL`, ${number(data.replacement.prefixBytes)}), ${text(data.replacement.token)}, right(`,
    );
    data.statement.append(data.observable);
    data.statement.append(SQL`, ${number(data.replacement.suffixBytes)}))`);
  }

  // `value` with each name the replacements stand for set apart in it, in their place.
  private static appendUnnamedText(data: {
    statement: Statement;
    value: string;
    replacements: ReadonlyArray<FindingReplacement>;
  }): void {
    const passes: Array<FindingReplacement> = [];

    /*
     * Each twice: two of a value side by side share the text between them
     * (", "), so one pass takes every other one, and the second the rest.
     */
    for (const replacement of data.replacements) {
      passes.push(replacement, replacement);
    }

    for (let index: number = 0; index < passes.length; index++) {
      data.statement.append("replaceRegexpAll(");
    }

    data.statement.append(data.value);

    for (const replacement of passes) {
      const observable: string = `observables[${replacement.position}]`;

      data.statement.append(
        SQL`, concat(${text(FINDING_VALUE_BEFORE)}, regexpQuoteMeta(`,
      );
      data.statement.append(observable);
      /*
       * What was before and after the value, and between them what the
       * rule left, its backslashes doubled: RE2 reads one as an escape in
       * a replacement. Each a parameter, so no SQL escaping is in the way.
       */
      data.statement.append(
        SQL`), ${text(FINDING_VALUE_AFTER)}), concat(${text(REGEXP_GROUP_BEFORE)}, replaceAll(`,
      );
      this.appendHashed({
        statement: data.statement,
        observable,
        replacement,
      });
      data.statement.append(
        SQL`, ${text(BACKSLASH)}, ${text(ESCAPED_BACKSLASH)}), ${text(REGEXP_GROUP_AFTER)}))`,
      );
    }
  }

  // The finding's attributes once the names are out, and the erasure said.
  private static appendUnnamedAttributes(data: {
    statement: Statement;
    replacements: ReadonlyArray<FindingReplacement>;
  }): void {
    data.statement.append(
      SQL`mapUpdate(mapApply((attributeKey, attributeValue) -> (attributeKey, if(has(${{
        type: TableColumnType.ArrayText,
        value: [...FINDING_NAMING_ATTRIBUTES],
      }}, attributeKey), `,
    );
    this.appendUnnamedText({
      statement: data.statement,
      value: "attributeValue",
      replacements: data.replacements,
    });
    data.statement.append(
      SQL`, attributeValue)), attributes), map(${text(FINDING_USER_ERASED_ATTRIBUTE)}, ${text(USER_ERASED_ON_REQUEST)}))`,
    );
  }

  /*
   * The mutation that takes the names out of a batch of findings that need
   * the same change: on the local table, ON CLUSTER, as every write to an
   * analytics table that already holds rows is. Matches the findings by
   * their _id, in the stretch of time they were written in. See the file's
   * comment.
   */
  public static toUnnameFindingsStatement(data: {
    projectId: ObjectID;
    mutation: FindingsMutation;
  }): Statement {
    const replacements: Array<FindingReplacement> = data.mutation.replacements;
    const statement: Statement = SQL`ALTER TABLE `;

    statement.append(
      `${databaseName()}.${getStorageTableName(SecurityEventService.model.tableName)}`,
    );
    statement.append(onClusterClause());

    // Each observable that was a name is what the rule left in its place.
    statement.append(
      " UPDATE observables = arrayMap((observable, observablePosition) -> multiIf(",
    );

    for (const replacement of replacements) {
      statement.append(
        SQL`observablePosition = ${number(replacement.position)}, `,
      );
      this.appendHashed({ statement, observable: "observable", replacement });
      statement.append(", ");
    }

    statement.append("observable), observables, arrayEnumerate(observables))");

    statement.append(", message = ");
    this.appendUnnamedText({ statement, value: "message", replacements });

    statement.append(", attributes = ");
    this.appendUnnamedAttributes({ statement, replacements });
    statement.append(", attributeKeys = mapKeys(");
    this.appendUnnamedAttributes({ statement, replacements });
    statement.append(")");

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND className = ${text(DETECTION_FINDING_CLASS_NAME)} AND vendorName = ${text(ERASURE_FINDINGS_VENDOR)} AND time >= fromUnixTimestamp64Nano(${nanoseconds(data.mutation.fromTime)}) AND time <= fromUnixTimestamp64Nano(${nanoseconds(data.mutation.toTime)}) AND _id IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.mutation.ids),
      }})`,
    );

    return statement;
  }

  /*
   * Queues the mutations that take the names out of the findings, and
   * returns once ClickHouse holds them: durable from then on, and checked
   * on a later run (isAnyFindingNaming finds none). Returns how many
   * findings they change.
   */
  public static async unnameFindings(data: {
    projectId: ObjectID;
    rewrites: ReadonlyArray<FindingRewrite>;
  }): Promise<number> {
    let changed: number = 0;

    for (const mutation of batchFindingRewrites(data.rewrites)) {
      await SecurityEventService.execute(
        this.toUnnameFindingsStatement({
          projectId: data.projectId,
          mutation,
        }),
        MigrationExecuteOptions,
      );
      changed += mutation.ids.length;
    }

    return changed;
  }
}
