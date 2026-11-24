import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import {
  INTERACTIVE_READ_TIME_LIMIT,
  getQuerySettings,
} from "Common/Server/Utils/AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import logger from "Common/Server/Utils/Logger";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { JSONObject } from "Common/Types/JSON";
import { getAuditLogResourceTypesOfModel } from "Common/Utils/AuditLog/AuditLogResourceTypes";

/*
 * ENDS THE ON-CALL TIME LOGS THAT DELETED ON-CALL POLICIES LEFT OPEN
 * (#11023).
 *
 * Until #10983, deleting an on-call policy ended none of its people's time
 * logs (OnCallDutyPolicyTimeLog). The policy's escalation rules, and the rows
 * naming their people, teams and schedules, go by the database's cascade, so
 * none of the hooks that end a path's log ran; the time log keeps no key to
 * the policy, on purpose, so the log stayed. User On-Call Time (On-Call →
 * Reports) counts a log with no end up to now, so everyone on call through
 * a policy deleted before #10983 has been counted on call around the clock
 * ever since. #10983 ends a deleted policy's logs from then on; this ends
 * the ones already left open, once, as the server is upgraded.
 *
 * WHICH LOGS. A log with no end, not deleted, naming a policy no row of
 * "OnCallDutyPolicy" has - deleted (rows are deleted outright), soft deleted
 * rows counting as there. Never a log of a policy that exists, and never one
 * that names no policy at all: neither is a deleted policy's.
 *
 * WHEN EACH ENDS. Postgres does not keep when a policy was deleted. What
 * the data does keep, from the best to the least:
 *
 *   1. The audit log's Delete entry for the policy (ClickHouse, OneUptime
 *      Enterprise, a project that records its audit log): when it was
 *      deleted. A log ends there - the time #10983 now ends one at - or at
 *      its own start, should it have started after that.
 *   2. Otherwise, the last time an on-call stint started on the policy: the
 *      latest start of any of its logs, ended or not, each read as never
 *      later than the log was written (LEAST of startsAt and createdAt). A
 *      stint starts on a policy only through its escalation rules, which go
 *      with it, so the policy was still in force then, and the log, which
 *      nothing ended, still ran. So a log ends there, when that is after
 *      its own start: never later than its policy was deleted, so never
 *      more than the deletion itself would have counted. Not when a log of
 *      the policy ENDED: a team's, a schedule's or a person's leaving ends
 *      their logs on every policy, deleted ones too, after the deletion.
 *   3. Otherwise - nothing on the policy started after this log - the log's
 *      own start: nothing is known of the policy after it, so its open
 *      stretch counts as nothing. Its updatedAt is no later: nothing writes
 *      a log that is still open.
 *
 * The rest of the data says nothing of the deletion: the policy's rules,
 * schedules-of-rules, teams-of-rules, executions, feed and notification logs
 * are cascaded with it, and the same people's logs on other policies say
 * when they were on call there, not when this policy went. The time the
 * migration runs would count the time from the deletion to the upgrade as
 * time on call, which it was not.
 *
 * Paged on the log's id, PAGE_SIZE logs a statement, so each write holds its
 * rows for a moment only. Idempotent, and safe to run twice at once: a log
 * is written only while it still has no end and its policy is still gone,
 * so a log ended once - by the other run, by OneUptime - keeps that end.
 * The audit log is read a page of policies at a time; one that cannot be
 * read is said so, and the rest end as if it had no entry for them.
 *
 * The worker's log says what was ended: per deleted policy, by its project
 * and id, how many logs, at what time and why - and no person's name.
 */

// How many open logs a page reads, and one statement ends.
export const PAGE_SIZE: number = 500;

// Below every log's id: where the first page starts.
export const FIRST_ID: string = "00000000-0000-0000-0000-000000000000";

const NAME: string = "EndOnCallTimeLogsOfDeletedPolicies";

/*
 * A page of the logs to end ($1 the id after which it starts, $2 its size):
 * open, not deleted, naming a policy that is gone.
 */
export const READ_OPEN_LOGS_OF_DELETED_POLICIES_SQL: string = `SELECT "log"."_id" AS "id", "log"."projectId" AS "projectId", "log"."onCallDutyPolicyId" AS "policyId", "log"."startsAt" AS "startsAt" FROM "OnCallDutyPolicyTimeLog" AS "log" WHERE "log"."_id" > $1::uuid AND "log"."endsAt" IS NULL AND "log"."deletedAt" IS NULL AND "log"."onCallDutyPolicyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicy" AS "policy" WHERE "policy"."_id" = "log"."onCallDutyPolicyId") ORDER BY "log"."_id" ASC LIMIT $2`;

/*
 * The last time an on-call stint started on each of the policies ($1): the
 * latest start among all their logs, each no later than it was written.
 */
export const READ_LAST_STINT_STARTS_SQL: string = `SELECT "projectId" AS "projectId", "onCallDutyPolicyId" AS "policyId", MAX(LEAST("startsAt", "createdAt")) AS "lastStartedAt" FROM "OnCallDutyPolicyTimeLog" WHERE "onCallDutyPolicyId" = ANY($1::uuid[]) GROUP BY "projectId", "onCallDutyPolicyId"`;

/*
 * Each log ($1) ended at its time ($2), while it still has no end and its
 * policy is still gone: the ids of the logs it ended.
 */
export const END_LOGS_SQL: string = `UPDATE "OnCallDutyPolicyTimeLog" AS "log" SET "endsAt" = "ended"."endsAt", "updatedAt" = now(), "version" = "log"."version" + 1 FROM unnest($1::uuid[], $2::timestamptz[]) AS "ended"("id", "endsAt") WHERE "log"."_id" = "ended"."id" AND "log"."endsAt" IS NULL AND "log"."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicy" AS "policy" WHERE "policy"."_id" = "log"."onCallDutyPolicyId") RETURNING "log"."_id" AS "id"`;

// An open log of a deleted policy, as a page reads it.
export interface OpenLogOfDeletedPolicy {
  id: string;
  projectId: string;
  policyId: string;
  startsAt: Date;
}

// A deleted policy, by its project: what the audit log is asked about.
export interface DeletedPolicy {
  projectId: string;
  policyId: string;
}

// Where a log's end comes from.
export enum TimeLogEnd {
  // When the audit log says its policy was deleted.
  PolicyDeleted = "PolicyDeleted",
  // The last time an on-call stint started on its policy, after its own start.
  LastStintStarted = "LastStintStarted",
  // Its own start: nothing is known of its policy after it started.
  OwnStart = "OwnStart",
}

export interface PlacedEnd {
  end: TimeLogEnd;
  endsAt: Date;
}

/*
 * When the audit log says each policy was deleted. Read from ClickHouse by
 * default (AuditLogPolicyDeletions); a test hands its own.
 */
export interface PolicyDeletionReader {
  // Whether this install has an audit log to read.
  hasAuditLog: () => Promise<boolean>;
  // The times each policy was deleted, by getPolicyKey, earliest first.
  readDeletions: (
    policies: ReadonlyArray<DeletedPolicy>,
  ) => Promise<Map<string, Array<Date>>>;
}

// Whether the audit log was read.
export enum AuditLogRead {
  Read = "Read",
  // This install has no audit log table.
  None = "None",
  // It could not be read: the logs ended without it.
  Unreadable = "Unreadable",
}

// What was ended of one deleted policy.
export interface PolicyEnded {
  projectId: string;
  policyId: string;
  // How many of its logs ended, by where their end came from.
  ended: Record<TimeLogEnd, number>;
  // The times they ended at, by where those came from (not their own starts).
  endedAt: Record<TimeLogEnd, Array<Date>>;
}

// What a run did.
export interface EndedSummary {
  // Open logs of deleted policies read.
  read: number;
  // Of those, ended by this run.
  ended: number;
  byEnd: Record<TimeLogEnd, number>;
  // Each policy with a log ended, in the order they were read.
  policies: Array<PolicyEnded>;
  auditLog: AuditLogRead;
  auditLogError: string | null;
}

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

// A policy's key: its project and its id, as Postgres writes them.
export function getPolicyKey(policy: DeletedPolicy): string {
  return `${policy.projectId.toLowerCase()}/${policy.policyId.toLowerCase()}`;
}

function emptyCounts(): Record<TimeLogEnd, number> {
  return {
    [TimeLogEnd.PolicyDeleted]: 0,
    [TimeLogEnd.LastStintStarted]: 0,
    [TimeLogEnd.OwnStart]: 0,
  };
}

function emptyTimes(): Record<TimeLogEnd, Array<Date>> {
  return {
    [TimeLogEnd.PolicyDeleted]: [],
    [TimeLogEnd.LastStintStarted]: [],
    [TimeLogEnd.OwnStart]: [],
  };
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

function toText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * The audit log in ClickHouse: core's AuditLogService reads it on every
 * edition (the Enterprise Edition writes it).
 */
export const AuditLogPolicyDeletions: PolicyDeletionReader = {
  hasAuditLog: async (): Promise<boolean> => {
    const result: Results = await AuditLogService.executeQuery(
      `EXISTS TABLE ${EndOnCallTimeLogsOfDeletedPolicies.getAuditLogTable()}`,
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    const row: JSONObject | undefined = response.data?.[0];

    return row ? Number(Object.values(row)[0]) === 1 : false;
  },
  readDeletions: async (
    policies: ReadonlyArray<DeletedPolicy>,
  ): Promise<Map<string, Array<Date>>> => {
    if (policies.length === 0) {
      return new Map<string, Array<Date>>();
    }

    const result: Results = await AuditLogService.executeQuery(
      EndOnCallTimeLogsOfDeletedPolicies.toAuditLogDeletionsStatement({
        table: EndOnCallTimeLogsOfDeletedPolicies.getAuditLogTable(),
        policies: policies,
      }),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return EndOnCallTimeLogsOfDeletedPolicies.readDeletionRows(
      response.data || [],
    );
  },
};

export default class EndOnCallTimeLogsOfDeletedPolicies extends DataMigrationBase {
  private deletionReader: PolicyDeletionReader;

  public constructor(data?: { deletionReader?: PolicyDeletionReader }) {
    super(NAME);
    this.deletionReader = data?.deletionReader || AuditLogPolicyDeletions;
  }

  public override async migrate(): Promise<void> {
    const summary: EndedSummary = await this.endLogs();

    for (const line of EndOnCallTimeLogsOfDeletedPolicies.describe(summary)) {
      if (line.isWarning) {
        logger.warn(line.text);
      } else {
        logger.info(line.text);
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Not reversible: opened again, each log would count its person on call
     * from its start until now once more, which is what this ends.
     */
    return;
  }

  // Ends every open log of a deleted policy, a page at a time; what it did.
  public async endLogs(): Promise<EndedSummary> {
    const repository: ModelRepository = (
      OnCallDutyPolicyTimeLogService as unknown as DatabaseService<BaseModel>
    ).getRepository();

    const summary: EndedSummary = {
      read: 0,
      ended: 0,
      byEnd: emptyCounts(),
      policies: [],
      auditLog: AuditLogRead.Read,
      auditLogError: null,
    };
    const policiesEnded: Map<string, PolicyEnded> = new Map<
      string,
      PolicyEnded
    >();

    try {
      if (!(await this.deletionReader.hasAuditLog())) {
        summary.auditLog = AuditLogRead.None;
      }
    } catch (error) {
      summary.auditLog = AuditLogRead.Unreadable;
      summary.auditLogError = describeError(error);
    }

    let lastId: string = FIRST_ID;

    while (true) {
      const logs: Array<OpenLogOfDeletedPolicy> =
        EndOnCallTimeLogsOfDeletedPolicies.readOpenLogRows(
          await repository.manager.query(
            READ_OPEN_LOGS_OF_DELETED_POLICIES_SQL,
            [lastId, PAGE_SIZE],
          ),
        );

      if (logs.length === 0) {
        break;
      }

      summary.read += logs.length;

      const policies: Array<DeletedPolicy> =
        EndOnCallTimeLogsOfDeletedPolicies.getPolicies(logs);

      const lastStintStarts: Map<string, Date> =
        EndOnCallTimeLogsOfDeletedPolicies.readLastStintStartRows(
          await repository.manager.query(READ_LAST_STINT_STARTS_SQL, [
            Array.from(
              new Set(
                policies.map((policy: DeletedPolicy): string => {
                  return policy.policyId;
                }),
              ),
            ),
          ]),
        );

      let deletions: Map<string, Array<Date>> = new Map<string, Array<Date>>();

      if (summary.auditLog === AuditLogRead.Read) {
        try {
          deletions = await this.deletionReader.readDeletions(policies);
        } catch (error) {
          summary.auditLog = AuditLogRead.Unreadable;
          summary.auditLogError = describeError(error);
        }
      }

      const placed: Array<PlacedEnd> = logs.map(
        (log: OpenLogOfDeletedPolicy): PlacedEnd => {
          const key: string = getPolicyKey(log);

          return EndOnCallTimeLogsOfDeletedPolicies.placeEnd({
            startsAt: log.startsAt,
            deletions: deletions.get(key),
            lastStintStartedAt: lastStintStarts.get(key),
          });
        },
      );

      const endedIds: Set<string> =
        EndOnCallTimeLogsOfDeletedPolicies.readEndedIds(
          await repository.manager.query(END_LOGS_SQL, [
            logs.map((log: OpenLogOfDeletedPolicy): string => {
              return log.id;
            }),
            placed.map((end: PlacedEnd): string => {
              return end.endsAt.toISOString();
            }),
          ]),
        );

      logs.forEach((log: OpenLogOfDeletedPolicy, index: number): void => {
        if (!endedIds.has(log.id.toLowerCase())) {
          return;
        }

        const end: PlacedEnd = placed[index]!;
        const key: string = getPolicyKey(log);
        let policy: PolicyEnded | undefined = policiesEnded.get(key);

        if (!policy) {
          policy = {
            projectId: log.projectId,
            policyId: log.policyId,
            ended: emptyCounts(),
            endedAt: emptyTimes(),
          };
          policiesEnded.set(key, policy);
          summary.policies.push(policy);
        }

        summary.ended++;
        summary.byEnd[end.end]++;
        policy.ended[end.end]++;

        if (
          end.end !== TimeLogEnd.OwnStart &&
          !policy.endedAt[end.end].some((time: Date): boolean => {
            return time.getTime() === end.endsAt.getTime();
          })
        ) {
          policy.endedAt[end.end].push(end.endsAt);
        }
      });

      if (logs.length < PAGE_SIZE) {
        break;
      }

      lastId = logs[logs.length - 1]!.id;
    }

    return summary;
  }

  /*
   * Where a log ends (see the header): when the audit log says its policy
   * was deleted - the first deletion at or after its start, or its start
   * should it have started after every one; else the last time a stint
   * started on its policy, when that is after its own start; else its own
   * start.
   */
  public static placeEnd(data: {
    startsAt: Date;
    deletions?: ReadonlyArray<Date> | undefined;
    lastStintStartedAt?: Date | undefined;
  }): PlacedEnd {
    const start: number = data.startsAt.getTime();

    if (data.deletions && data.deletions.length > 0) {
      const deletion: Date | undefined = [...data.deletions]
        .sort((a: Date, b: Date): number => {
          return a.getTime() - b.getTime();
        })
        .find((time: Date): boolean => {
          return time.getTime() >= start;
        });

      return {
        end: TimeLogEnd.PolicyDeleted,
        endsAt: deletion || data.startsAt,
      };
    }

    if (
      data.lastStintStartedAt &&
      data.lastStintStartedAt.getTime() > start
    ) {
      return {
        end: TimeLogEnd.LastStintStarted,
        endsAt: data.lastStintStartedAt,
      };
    }

    return { end: TimeLogEnd.OwnStart, endsAt: data.startsAt };
  }

  // The audit log's table, by its database: the one AuditLogService reads.
  public static getAuditLogTable(): string {
    return `${AuditLogService.database.getDatasourceOptions().database}.${AuditLogService.model.tableName}`;
  }

  /*
   * The audit log's read: for each of the policies, every time a Delete of
   * it was recorded in its project, by the type names the policy's entries
   * are stored under. Every value a bound parameter.
   */
  public static toAuditLogDeletionsStatement(data: {
    table: string;
    policies: ReadonlyArray<DeletedPolicy>;
  }): Statement {
    const projectIds: Array<string> = Array.from(
      new Set(
        data.policies.map((policy: DeletedPolicy): string => {
          return policy.projectId.toLowerCase();
        }),
      ),
    );
    const policyIds: Array<string> = Array.from(
      new Set(
        data.policies.map((policy: DeletedPolicy): string => {
          return policy.policyId.toLowerCase();
        }),
      ),
    );

    /*
     * Aliased apart from every column, so neither analyzer reads an alias
     * where the WHERE names a column: projectId is the table's first key.
     */
    const statement: Statement = SQL`SELECT projectId AS deletedPolicyProjectId, lower(toString(resourceId)) AS deletedPolicyId, groupArray(toUnixTimestamp(createdAt)) AS deletedAtSeconds FROM `;
    statement.append(data.table);
    statement.append(
      SQL` WHERE projectId IN ${{
        type: TableColumnType.ArrayText,
        value: projectIds,
      }} AND action = ${{
        type: TableColumnType.Text,
        value: AuditLogAction.Delete,
      }} AND resourceType IN ${{
        type: TableColumnType.ArrayText,
        value: EndOnCallTimeLogsOfDeletedPolicies.getAuditLogResourceTypes(),
      }} AND lower(toString(resourceId)) IN ${{
        type: TableColumnType.ArrayText,
        value: policyIds,
      }} GROUP BY deletedPolicyProjectId, deletedPolicyId`,
    );
    statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

    return statement;
  }

  // The read's rows as the times each policy was deleted, earliest first.
  public static readDeletionRows(
    rows: ReadonlyArray<JSONObject>,
  ): Map<string, Array<Date>> {
    const deletions: Map<string, Array<Date>> = new Map<
      string,
      Array<Date>
    >();

    for (const row of rows) {
      const projectId: string = toText(row["deletedPolicyProjectId"]);
      const policyId: string = toText(row["deletedPolicyId"]);
      const seconds: unknown = row["deletedAtSeconds"];

      if (!projectId || !policyId || !Array.isArray(seconds)) {
        continue;
      }

      const times: Array<Date> = [];

      for (const second of seconds) {
        const value: number = Number(second);

        if (Number.isFinite(value) && value > 0) {
          times.push(new Date(value * 1000));
        }
      }

      if (times.length === 0) {
        continue;
      }

      const key: string = getPolicyKey({ projectId, policyId });
      const known: Array<Date> = deletions.get(key) || [];

      deletions.set(
        key,
        [...known, ...times].sort((a: Date, b: Date): number => {
          return a.getTime() - b.getTime();
        }),
      );
    }

    return deletions;
  }

  // A page's rows, as the logs to end.
  public static readOpenLogRows(rows: unknown): Array<OpenLogOfDeletedPolicy> {
    const logs: Array<OpenLogOfDeletedPolicy> = [];

    for (const row of Array.isArray(rows) ? (rows as Array<JSONObject>) : []) {
      const startsAt: Date | null = toDate(row["startsAt"]);
      const id: string = toText(row["id"]);
      const projectId: string = toText(row["projectId"]);
      const policyId: string = toText(row["policyId"]);

      if (!id || !projectId || !policyId || !startsAt) {
        continue;
      }

      logs.push({ id, projectId, policyId, startsAt });
    }

    return logs;
  }

  // Each policy of the logs, once, in the order they were read.
  public static getPolicies(
    logs: ReadonlyArray<OpenLogOfDeletedPolicy>,
  ): Array<DeletedPolicy> {
    const policies: Map<string, DeletedPolicy> = new Map<
      string,
      DeletedPolicy
    >();

    for (const log of logs) {
      const key: string = getPolicyKey(log);

      if (!policies.has(key)) {
        policies.set(key, { projectId: log.projectId, policyId: log.policyId });
      }
    }

    return Array.from(policies.values());
  }

  // The last time a stint started on each policy, by getPolicyKey.
  public static readLastStintStartRows(rows: unknown): Map<string, Date> {
    const starts: Map<string, Date> = new Map<string, Date>();

    for (const row of Array.isArray(rows) ? (rows as Array<JSONObject>) : []) {
      const projectId: string = toText(row["projectId"]);
      const policyId: string = toText(row["policyId"]);
      const lastStartedAt: Date | null = toDate(row["lastStartedAt"]);

      if (projectId && policyId && lastStartedAt) {
        starts.set(getPolicyKey({ projectId, policyId }), lastStartedAt);
      }
    }

    return starts;
  }

  /*
   * The ids an UPDATE ... RETURNING ended. TypeORM answers one on Postgres
   * with [rows, count]; a driver that hands back the rows alone is read by
   * them.
   */
  public static readEndedIds(result: unknown): Set<string> {
    let rows: unknown = result;

    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      rows = result[0];
    }

    const ids: Set<string> = new Set<string>();

    for (const row of Array.isArray(rows) ? (rows as Array<JSONObject>) : []) {
      const id: string = toText(row?.["id"]);

      if (id) {
        ids.add(id.toLowerCase());
      }
    }

    return ids;
  }

  // What a run did, as the lines the worker's log says it with.
  public static describe(
    summary: EndedSummary,
  ): Array<{ text: string; isWarning: boolean }> {
    const lines: Array<{ text: string; isWarning: boolean }> = [];

    if (summary.auditLog === AuditLogRead.Unreadable) {
      lines.push({
        text: `${NAME}: the audit log could not be read (${summary.auditLogError || "no error given"}), so no log was ended when it says its policy was deleted: each ended at the last time an on-call stint started on its policy, or at its own start.`,
        isWarning: true,
      });
    }

    if (summary.read === 0) {
      lines.push({
        text: `${NAME}: no on-call time log was left open by a deleted on-call policy.`,
        isWarning: false,
      });

      return lines;
    }

    for (const policy of summary.policies) {
      lines.push({
        text: `${NAME}: deleted on-call policy ${policy.policyId} of project ${policy.projectId}: ended ${EndOnCallTimeLogsOfDeletedPolicies.describeEnds(
          {
            counts: policy.ended,
            times: policy.endedAt,
            policy: "the policy",
          },
        )}.`,
        isWarning: false,
      });
    }

    const policies: number = summary.policies.length;
    const meanwhile: number = summary.read - summary.ended;

    lines.push({
      text: `${NAME}: ended ${summary.ended} on-call time log(s) left open by ${policies} deleted on-call ${
        policies === 1 ? "policy" : "policies"
      }${
        summary.ended > 0
          ? `: ${EndOnCallTimeLogsOfDeletedPolicies.describeEnds({
              counts: summary.byEnd,
              times: emptyTimes(),
              policy: "their policy",
            })}`
          : ""
      }${
        meanwhile > 0
          ? `. ${meanwhile} more had an end, or their policy back, before they were written`
          : ""
      }${
        summary.auditLog === AuditLogRead.None
          ? ". This install has no audit log, so none was ended when it says its policy was deleted"
          : ""
      }.`,
      isWarning: false,
    });

    return lines;
  }

  /*
   * How many logs ended where, and at what time: "2 log(s) at <time>, when
   * the audit log says the policy was deleted; 1 log(s) at their own start,
   * as nothing is known of the policy after they started".
   */
  private static describeEnds(data: {
    counts: Record<TimeLogEnd, number>;
    times: Record<TimeLogEnd, Array<Date>>;
    policy: string;
  }): string {
    const at: (end: TimeLogEnd) => string = (end: TimeLogEnd): string => {
      return data.times[end].length > 0
        ? ` at ${data.times[end]
            .map((time: Date): string => {
              return time.toISOString();
            })
            .join(", ")}`
        : "";
    };

    const parts: Array<string> = [];

    if (data.counts[TimeLogEnd.PolicyDeleted] > 0) {
      parts.push(
        `${data.counts[TimeLogEnd.PolicyDeleted]} log(s)${at(TimeLogEnd.PolicyDeleted)}, when the audit log says ${data.policy} was deleted`,
      );
    }

    if (data.counts[TimeLogEnd.LastStintStarted] > 0) {
      parts.push(
        `${data.counts[TimeLogEnd.LastStintStarted]} log(s)${at(TimeLogEnd.LastStintStarted)}, the last time an on-call stint started on ${data.policy}`,
      );
    }

    if (data.counts[TimeLogEnd.OwnStart] > 0) {
      parts.push(
        `${data.counts[TimeLogEnd.OwnStart]} log(s) at their own start, as nothing is known of ${data.policy} after they started`,
      );
    }

    return parts.join("; ");
  }

  // Every name of the type the policy's audit entries are stored under.
  public static getAuditLogResourceTypes(): Array<string> {
    return getAuditLogResourceTypesOfModel(new OnCallDutyPolicy());
  }
}
