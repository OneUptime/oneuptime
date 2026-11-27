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
import DetectionFingerprint from "../DetectionFingerprint";
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
import {
  DETECTION_FINGERPRINT_TEXT_SEPARATOR,
  DetectionFingerprintKind,
  DetectionFingerprintPlaces,
  getFindingUidPlaces,
} from "../../../../Utils/SecurityEvent/DetectionFingerprintPlaces";
import { USER_ERASED_ON_REQUEST } from "../../../../Utils/SecurityEvent/ScrubbedUser";
import {
  ErasedName,
  GROUP_VALUE_PART_SEPARATOR,
  unnameGroupValue,
} from "../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";

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
 *     oneuptime.detection.summary, oneuptime.threat.indicator_value;
 *   - its eventUid, which carries the fingerprint of the group value
 *     (#11130, Utils/SecurityEvent/DetectionFingerprintPlaces).
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
 * ITS ID TOO (#11130). The fingerprint in a finding's eventUid was an
 * unkeyed hash of the group value, and is now keyed in the project
 * (DetectionFingerprint) - but even a keyed one of the name would let
 * OneUptime confirm a guess, since a rule fingerprints whatever an event
 * names. So the same change puts in its place the fingerprint of the group
 * value the finding holds once the names are out (unnameGroupValue): what
 * the rule fingerprints when it fires on the token, so a stretch judged
 * again finds the finding, and its case detection keeps pointing at it
 * (SecurityUserErasureRecords rewrites that the same way). A finding an
 * earlier erasure un-named with its id left as it was - marked erased,
 * holding one of the request's tokens, with another fingerprint than its
 * group value's - gets its id rewritten alone.
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
 *     name inside other text, such as another user who contains it;
 *   - the id is rewritten by position: the places of the id that hold the
 *     fingerprint get the new one, the rest of the id is its own. The new
 *     fingerprint is of what the finding holds once the names are out, so
 *     it says nothing a reader of the finding cannot read in it; the old
 *     one, of the name, is never sent.
 *
 * BATCHED AND IDEMPOTENT. Findings that need the same change (the same
 * observables replaced by the same tokens, the same new fingerprint - most
 * findings about a person need exactly one) share one mutation, up to
 * MAX_FINDINGS_PER_MUTATION, so a part is rewritten once for many of them.
 * A finding a run already changed holds no name any more, and its id holds
 * its own fingerprint, so the next run's read leaves it out; and a mutation
 * applied twice changes nothing more, as everything it puts in is built
 * from what is there (a token in place of a token).
 *
 * RESUMABLE (#11160). A project's findings are read in the order they were
 * written, (time, _id), a page at a time, and a read goes on from where the
 * last one stopped (scanFindings's `after`): the erasure keeps that place
 * on the request between runs, so a project too large to read in one run
 * is read over several. A read stops when its time is up, when it has
 * found as many as one run changes, or at the run's deadline, and only
 * ever past findings whose changes ClickHouse already holds: a run that
 * stops in between reads them again, and finds them changed or changes
 * them again, which changes nothing more.
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
 * How many changes a read finds before it queues them: findings spread over
 * many pages share their mutations, and a run that stops loses at most these
 * to read again.
 */
export const FINDINGS_CHANGES_PER_FLUSH: number =
  10 * MAX_FINDINGS_PER_MUTATION;

/*
 * How long one run reads a project's findings: past it, the read stops where
 * it is and a later run goes on from there (#11160). It used to be a limit
 * the whole read had to fit in, failing the run past it.
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

// The attribute that holds the value a finding's fingerprint is of, for each source.
export const FINDING_FINGERPRINTED_ATTRIBUTE: Record<
  DetectionFingerprintKind,
  string
> = {
  [DetectionFingerprintKind.DetectionRule]: DETECTION_GROUP_VALUE_ATTRIBUTE,
  [DetectionFingerprintKind.ThreatIntel]: THREAT_INDICATOR_VALUE_ATTRIBUTE,
};

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

/*
 * The new fingerprint a finding's id takes, and where the id holds it
 * (counted from 1, its parts between ":", as ClickHouse's arrays count).
 */
export interface FindingUidChange {
  positions: Array<number>;
  fingerprint: string;
}

// A finding to change: the names to take out of it, and its id's new fingerprint.
export interface FindingRewrite {
  id: string;
  // When it happened, in nanoseconds since the epoch, as text.
  time: string;
  // Each observable that is a name; none when only its id changes.
  replacements: Array<FindingReplacement>;
  // Its id's fingerprint, when that changes.
  uid?: FindingUidChange | undefined;
  /*
   * The value its fingerprint is of, as it was and once the names are out:
   * what else carries the same fingerprint (an alert, a case detection, a
   * firing) is rewritten by it.
   */
  groupValue?: ErasedName | undefined;
}

// A finding as the read returns it.
export interface ErasureFindingRow {
  id: string;
  time: string;
  observables: Array<string>;
  // Its eventUid, which holds its fingerprint (#11130).
  eventUid?: string | undefined;
  // The value it is about, for a rule's (group value) and a feed's (indicator value).
  groupValue?: string | undefined;
  indicatorValue?: string | undefined;
  // Whether an erasure request un-named it already.
  isMarkedErased?: boolean | undefined;
}

// Where a read of a project's findings is: after this finding, in (time, _id) order.
export interface FindingsCursor {
  // When the finding happened, in nanoseconds since the epoch, as text.
  time: string;
  id: string;
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

// The names that are not what the rule left, by their name.
function namesByName(
  names: ReadonlyArray<ErasedName>,
): Map<string, ErasedName> {
  const byName: Map<string, ErasedName> = new Map<string, ErasedName>();

  for (const name of names) {
    if (name.named && name.hashed && name.named !== name.hashed) {
      byName.set(name.named, name);
    }
  }

  return byName;
}

// Whether the finding holds one of the tokens: in an observable, or in what it is about.
function holdsAnyToken(
  row: ErasureFindingRow,
  value: string,
  tokens: ReadonlyArray<string>,
): boolean {
  return tokens.some((token: string): boolean => {
    return (
      Boolean(token) &&
      (value.includes(token) ||
        row.observables.some((observable: string): boolean => {
          return observable.includes(token);
        }))
    );
  });
}

/*
 * The change a finding needs, or null when it needs none:
 *
 *   - each observable that is exactly one of the names, with what goes in
 *     its place, and the id's fingerprint made of the group value once the
 *     names are out (#11130);
 *   - for a finding an earlier erasure un-named (marked erased, holding one
 *     of the request's tokens) whose id still holds another fingerprint
 *     than its group value's, the id alone.
 *
 * `projectId` keys the fingerprint; `tokens` are the request's.
 */
export function planFindingRewrite(
  row: ErasureFindingRow,
  names: ReadonlyArray<ErasedName>,
  context: {
    projectId: ObjectID;
    tokens?: ReadonlyArray<string> | undefined;
  },
): FindingRewrite | null {
  const byName: Map<string, ErasedName> = namesByName(names);
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

  const places: DetectionFingerprintPlaces | null = getFindingUidPlaces(
    row.eventUid,
  );
  const value: string =
    (places?.source === DetectionFingerprintKind.ThreatIntel
      ? row.indicatorValue
      : row.groupValue) || "";
  const unnamedValue: string =
    (unnameGroupValue(value, Array.from(byName.values())) as string) || "";

  const isNaming: boolean = replacements.length > 0;
  const isStale: boolean =
    !isNaming &&
    row.isMarkedErased === true &&
    holdsAnyToken(row, value, context.tokens || []);

  let uid: FindingUidChange | undefined = undefined;

  if (places && unnamedValue && (isNaming || isStale)) {
    const fingerprint: string = DetectionFingerprint.of({
      projectId: context.projectId,
      kind: places.source,
      value: unnamedValue,
    });

    if (fingerprint !== places.fingerprint) {
      uid = { positions: places.positions, fingerprint };
    }
  }

  if (!isNaming && !uid) {
    return null;
  }

  return {
    id: row.id,
    time: row.time,
    replacements,
    ...(uid ? { uid } : {}),
    ...(isNaming && value && unnamedValue !== value
      ? { groupValue: { named: value, hashed: unnamedValue } }
      : {}),
  };
}

// The change, as text: findings that need the same change share a mutation.
function changeKeyOf(rewrite: FindingRewrite): string {
  return JSON.stringify([
    rewrite.replacements.map(
      (replacement: FindingReplacement): Array<unknown> => {
        return [
          replacement.position,
          replacement.prefixBytes,
          replacement.token,
          replacement.suffixBytes,
        ];
      },
    ),
    rewrite.uid ? [rewrite.uid.positions, rewrite.uid.fingerprint] : null,
  ]);
}

function compareTimes(a: string, b: string): number {
  const left: bigint = BigInt(a || "0");
  const right: bigint = BigInt(b || "0");

  return left < right ? -1 : left > right ? 1 : 0;
}

export interface FindingsMutation {
  replacements: Array<FindingReplacement>;
  uid?: FindingUidChange | undefined;
  ids: Array<string>;
  // The earliest and the latest of the findings' times, in nanoseconds.
  fromTime: string;
  toTime: string;
}

/*
 * The mutations that make the rewrites: one for each change, of at most
 * MAX_FINDINGS_PER_MUTATION findings close in time, so each one rewrites
 * only the parts that hold its findings. A finding planned twice (read
 * twice) is changed once.
 */
export function batchFindingRewrites(
  rewrites: ReadonlyArray<FindingRewrite>,
  maxPerMutation: number = MAX_FINDINGS_PER_MUTATION,
): Array<FindingsMutation> {
  const groups: Map<string, Map<string, FindingRewrite>> = new Map();

  for (const rewrite of rewrites) {
    const key: string = changeKeyOf(rewrite);
    const group: Map<string, FindingRewrite> = groups.get(key) || new Map();

    group.set(rewrite.id, rewrite);
    groups.set(key, group);
  }

  const mutations: Array<FindingsMutation> = [];

  for (const group of groups.values()) {
    const ordered: Array<FindingRewrite> = Array.from(group.values()).sort(
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
        ...(chunk[0]!.uid ? { uid: chunk[0]!.uid } : {}),
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

// The multi-valued group values the rewrites change, each once: what else carries their fingerprint.
function correlationValuesOf(
  rewrites: ReadonlyArray<FindingRewrite>,
): Array<ErasedName> {
  const values: Map<string, ErasedName> = new Map<string, ErasedName>();

  for (const rewrite of rewrites) {
    if (
      rewrite.groupValue &&
      rewrite.groupValue.named.includes(GROUP_VALUE_PART_SEPARATOR)
    ) {
      values.set(
        `${rewrite.groupValue.named}\u0000${rewrite.groupValue.hashed}`,
        rewrite.groupValue,
      );
    }
  }

  return Array.from(values.values());
}

// What a read of the findings did, up to where it stopped.
export interface FindingsScanStep {
  // Where it got to: every finding up to here was read, and its change queued.
  after: FindingsCursor | null;
  // Whether it read the project's last finding.
  isAtEnd: boolean;
  // How many findings it queued a change for, and how many of them named somebody.
  changed: number;
  unnamed: number;
  // Why it stopped short of the end, if it did.
  stoppedBy?: "time" | "cap" | "deadline" | undefined;
}

/*
 * What a read hands its caller each time ClickHouse holds a batch of its
 * changes: where the read now is, and the correlations' group values the
 * batch changed. The caller keeps the place (and rewrites what else carries
 * those values' fingerprints) before the read goes on.
 */
export interface FindingsScanProgress {
  after: FindingsCursor | null;
  changed: number;
  unnamed: number;
  correlationValues: Array<ErasedName>;
}

export default class SecurityUserErasureFindings {
  /*
   * A page of the project's own Detection Findings, in the order they were
   * written, after `after`: their _id, when, their observables, their id
   * and what they are about, and whether an erasure changed them. Names the
   * project, the class, the vendor and attribute keys - never anybody.
   */
  public static toFindingsPageStatement(data: {
    projectId: ObjectID;
    after?: FindingsCursor | null | undefined;
    limit: number;
  }): Statement {
    const statement: Statement = SQL`SELECT _id AS findingId, toString(toUnixTimestamp64Nano(time)) AS findingTime, observables, eventUid AS findingUid, attributes[${text(DETECTION_GROUP_VALUE_ATTRIBUTE)}] AS findingGroupValue, attributes[${text(THREAT_INDICATOR_VALUE_ATTRIBUTE)}] AS findingIndicatorValue, attributes[${text(FINDING_USER_ERASED_ATTRIBUTE)}] AS findingErased FROM `;

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

  // A page of the project's own findings after `after`, as the read returns them.
  public static async readFindingsPage(data: {
    projectId: ObjectID;
    after?: FindingsCursor | null | undefined;
    limit: number;
  }): Promise<Array<ErasureFindingRow>> {
    const result: Results = await SecurityEventService.executeQuery(
      this.toFindingsPageStatement(data),
      MigrationExecuteOptions,
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return ((response.data || []) as Array<JSONObject>).map(
      (row: JSONObject): ErasureFindingRow => {
        return {
          id: readText(row["findingId"]),
          time: readText(row["findingTime"]),
          observables: Array.isArray(row["observables"])
            ? (row["observables"] as Array<JSONValue>).map(readText)
            : [],
          eventUid: readText(row["findingUid"]),
          groupValue: readText(row["findingGroupValue"]),
          indicatorValue: readText(row["findingIndicatorValue"]),
          isMarkedErased: Boolean(readText(row["findingErased"])),
        };
      },
    );
  }

  /*
   * Reads the project's own findings from `after` on, in the order they
   * were written, and queues the change each one that names one of the
   * names - or keeps an id an erasure left (planFindingRewrite) - needs.
   * Stops at the end, when `timeLimitMs` is up, when `maxRewrites` changes
   * are queued, or at the deadline; never throws for its time. Each time
   * ClickHouse holds a batch of changes, `onProgress` is told where the read
   * is, so a read that stops after it goes on from there (#11160).
   */
  public static async scanFindings(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
    tokens: ReadonlyArray<string>;
    after: FindingsCursor | null;
    onProgress: (progress: FindingsScanProgress) => Promise<void>;
    /*
     * Told the correlations' group values a batch changes before ClickHouse
     * is told to change them: once a finding is un-named, nothing else says
     * what its value was, so the caller keeps them first.
     */
    onChangesFound?:
      | ((correlationValues: Array<ErasedName>) => Promise<void>)
      | undefined;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    timeLimitMs?: number | undefined;
    maxRewrites?: number | undefined;
    changesPerFlush?: number | undefined;
  }): Promise<FindingsScanStep> {
    const names: Array<ErasedName> = Array.from(
      namesByName(data.names).values(),
    );
    const pageSize: number = Math.max(
      1,
      data.pageSize ?? ERASURE_FINDINGS_PAGE_SIZE,
    );
    const timeLimitMs: number =
      data.timeLimitMs ?? ERASURE_FINDINGS_SCAN_TIME_LIMIT_MS;
    const maxRewrites: number = Math.max(
      1,
      data.maxRewrites ?? MAX_FINDINGS_UNNAMED_PER_RUN,
    );
    const changesPerFlush: number = Math.max(
      1,
      data.changesPerFlush ?? FINDINGS_CHANGES_PER_FLUSH,
    );
    const startedAt: number = Date.now();

    // Where every change before is queued, and where the read is.
    let committed: FindingsCursor | null = data.after;
    let read: FindingsCursor | null = data.after;
    let pending: Array<FindingRewrite> = [];
    let changed: number = 0;
    let unnamed: number = 0;

    const flush: () => Promise<void> = async (): Promise<void> => {
      const batch: Array<FindingRewrite> = pending;
      const correlationValues: Array<ErasedName> = correlationValuesOf(batch);

      if (correlationValues.length > 0 && data.onChangesFound) {
        await data.onChangesFound(correlationValues);
      }

      if (batch.length > 0) {
        await this.unnameFindings({
          projectId: data.projectId,
          rewrites: batch,
        });
      }

      pending = [];
      committed = read;

      await data.onProgress({
        after: committed,
        changed,
        unnamed,
        correlationValues,
      });
    };

    const stop: (
      step: Omit<FindingsScanStep, "after" | "changed" | "unnamed">,
    ) => Promise<FindingsScanStep> = async (
      step: Omit<FindingsScanStep, "after" | "changed" | "unnamed">,
    ): Promise<FindingsScanStep> => {
      await flush();

      return { ...step, after: committed, changed, unnamed };
    };

    if (names.length === 0) {
      return { after: data.after, isAtEnd: true, changed: 0, unnamed: 0 };
    }

    for (;;) {
      if (data.deadline?.hasPassed()) {
        return stop({ isAtEnd: false, stoppedBy: "deadline" });
      }

      if (Date.now() - startedAt > timeLimitMs) {
        return stop({ isAtEnd: false, stoppedBy: "time" });
      }

      const rows: Array<ErasureFindingRow> = await this.readFindingsPage({
        projectId: data.projectId,
        after: read,
        limit: pageSize,
      });

      for (const row of rows) {
        const rewrite: FindingRewrite | null = row.id
          ? planFindingRewrite(row, names, {
              projectId: data.projectId,
              tokens: data.tokens,
            })
          : null;

        read = { time: row.time, id: row.id };

        if (rewrite) {
          pending.push(rewrite);
          changed++;

          if (rewrite.replacements.length > 0) {
            unnamed++;
          }

          if (changed >= maxRewrites) {
            return stop({ isAtEnd: false, stoppedBy: "cap" });
          }
        }
      }

      if (rows.length < pageSize) {
        return stop({ isAtEnd: true });
      }

      if (pending.length >= changesPerFlush) {
        await flush();
      } else if (pending.length === 0) {
        // Nothing outstanding: the read's place is where every change is.
        committed = read;
      }
    }
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
   * The finding's id with the new fingerprint in its places, the rest of
   * it its own: what Utils/SecurityEvent/DetectionFingerprintPlaces's
   * putFingerprintAt makes of it.
   */
  private static appendRewrittenUid(data: {
    statement: Statement;
    uid: FindingUidChange;
  }): void {
    data.statement.append(
      "arrayStringConcat(arrayMap((uidPart, uidPosition) -> if(uidPosition IN (",
    );

    data.uid.positions.forEach((position: number, index: number): void => {
      if (index > 0) {
        data.statement.append(", ");
      }

      data.statement.append(SQL`${number(position)}`);
    });

    data.statement.append(
      SQL`), ${text(data.uid.fingerprint)}, uidPart), splitByChar(${text(DETECTION_FINGERPRINT_TEXT_SEPARATOR)}, eventUid), arrayEnumerate(splitByChar(${text(DETECTION_FINGERPRINT_TEXT_SEPARATOR)}, eventUid))), ${text(DETECTION_FINGERPRINT_TEXT_SEPARATOR)})`,
    );
  }

  /*
   * The mutation that takes the names out of a batch of findings that need
   * the same change, and puts their id's new fingerprint in: on the local
   * table, ON CLUSTER, as every write to an analytics table that already
   * holds rows is. Matches the findings by their _id, in the stretch of
   * time they were written in. See the file's comment.
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
    statement.append(" UPDATE ");

    const updates: Array<() => void> = [];

    if (replacements.length > 0) {
      updates.push((): void => {
        // Each observable that was a name is what the rule left in its place.
        statement.append(
          "observables = arrayMap((observable, observablePosition) -> multiIf(",
        );

        for (const replacement of replacements) {
          statement.append(
            SQL`observablePosition = ${number(replacement.position)}, `,
          );
          this.appendHashed({
            statement,
            observable: "observable",
            replacement,
          });
          statement.append(", ");
        }

        statement.append(
          "observable), observables, arrayEnumerate(observables))",
        );

        statement.append(", message = ");
        this.appendUnnamedText({ statement, value: "message", replacements });

        statement.append(", attributes = ");
        this.appendUnnamedAttributes({ statement, replacements });
        statement.append(", attributeKeys = mapKeys(");
        this.appendUnnamedAttributes({ statement, replacements });
        statement.append(")");
      });
    }

    if (data.mutation.uid) {
      const uid: FindingUidChange = data.mutation.uid;

      updates.push((): void => {
        statement.append("eventUid = ");
        this.appendRewrittenUid({ statement, uid });
      });
    }

    updates.forEach((update: () => void, index: number): void => {
      if (index > 0) {
        statement.append(", ");
      }

      update();
    });

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
   * Queues the mutations that take the names out of the findings and give
   * their ids their new fingerprints, and returns once ClickHouse holds
   * them: durable from then on, and checked by a later read (it finds
   * nothing left to change). Returns how many findings they change.
   */
  public static async unnameFindings(data: {
    projectId: ObjectID;
    rewrites: ReadonlyArray<FindingRewrite>;
  }): Promise<number> {
    let changed: number = 0;

    for (const mutation of batchFindingRewrites(data.rewrites)) {
      if (mutation.replacements.length === 0 && !mutation.uid) {
        continue;
      }

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
