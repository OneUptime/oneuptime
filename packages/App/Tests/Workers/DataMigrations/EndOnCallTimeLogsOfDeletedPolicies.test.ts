import EndOnCallTimeLogsOfDeletedPolicies, {
  AuditLogRead,
  DeletedPolicy,
  END_LOGS_SQL,
  EndedSummary,
  FIRST_ID,
  PAGE_SIZE,
  PolicyDeletionReader,
  READ_LAST_STINT_STARTS_SQL,
  READ_OPEN_LOGS_OF_DELETED_POLICIES_SQL,
  TimeLogEnd,
  getPolicyKey,
} from "../../../FeatureSet/Workers/DataMigrations/EndOnCallTimeLogsOfDeletedPolicies";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import logger from "Common/Server/Utils/Logger";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EndOnCallTimeLogsOfDeletedPolicies ends, once, the on-call time logs that
 * on-call policies deleted before #10983 left open (#11023): User On-Call
 * Time counted everyone on them as on call around the clock ever since.
 *
 * Pinned here, over a stand-in for the time log table that answers the
 * migration's three statements as Postgres would (the Postgres suite runs
 * them for real):
 *   1. it is registered once in DataMigrations/Index.ts, before the two
 *      slots kept last;
 *   2. which logs: open, not deleted, of a policy that is gone - never one
 *      of a policy that exists, one already ended, or one naming none;
 *   3. where each ends: when the audit log says its policy was deleted,
 *      else the last time an on-call stint started on the policy, else its
 *      own start - never before it started, never after the deletion;
 *   4. pages of PAGE_SIZE, each after the last id of the one before; a
 *      second run ends nothing; a log ended meanwhile keeps its end;
 *   5. the audit log: missing on the install, or failing to answer, the
 *      logs end without it and the log says so; never read for nothing;
 *   6. the worker's log names each policy by its id and project, with how
 *      many logs ended where - and nobody's name;
 *   7. a failing statement stops the chain; rollback changes nothing.
 */

const MIGRATION_NAME: string = "EndOnCallTimeLogsOfDeletedPolicies";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// The migrations as Index.ts registers them, in order.
const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const WHITESPACE: RegExp = /\s+/g;

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

const PROJECT: string = "11023000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT: string = "11023000-0000-4000-8000-0000000000a2";

// Ids in the order Postgres sorts them: by their text, as here.
function idOf(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

const T0: number = Date.UTC(2026, 2, 1);

function at(milliseconds: number): Date {
  return new Date(milliseconds);
}

/*
 * A stretch of time drawn from the stream, in whole minutes from 0 up to,
 * not including, `milliseconds`: a draw takes at most 2^32 values, some 50
 * days of milliseconds.
 */
function drawTime(random: SeededRandom, milliseconds: number): number {
  return random(Math.max(1, Math.floor(milliseconds / MINUTE))) * MINUTE;
}

// A row of the stand-in table.
interface StoredLog {
  id: string;
  projectId: string;
  policyId: string | null;
  userId: string;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  version: number;
}

// The latest start of a policy's stints, as the stand-in reckons it.
interface LastStart {
  projectId: string;
  policyId: string;
  at: number;
}

/*
 * The time log table and the policies that exist, answering the
 * migration's three statements as Postgres would.
 */
class StandInDatabase {
  public logs: Array<StoredLog> = [];
  public existingPolicies: Set<string> = new Set<string>();
  public statements: Array<{ sql: string; parameters: Array<unknown> }> = [];
  // Run before an UPDATE: what another writer does meanwhile.
  public beforeEnd: (() => void) | null = null;

  public add(
    log: Partial<StoredLog> & { id: string; startsAt: Date },
  ): StoredLog {
    const stored: StoredLog = {
      projectId: PROJECT,
      policyId: null,
      userId: "11023000-0000-4000-8000-00000000f001",
      endsAt: null,
      createdAt: log.startsAt,
      deletedAt: null,
      version: 1,
      ...log,
    };

    this.logs.push(stored);

    return stored;
  }

  public byId(id: string): StoredLog {
    return this.logs.find((log: StoredLog): boolean => {
      return log.id === id;
    })!;
  }

  private isOfDeletedPolicy(log: StoredLog): boolean {
    return log.policyId !== null && !this.existingPolicies.has(log.policyId);
  }

  public async query(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<unknown> {
    this.statements.push({ sql, parameters });

    if (sql === READ_OPEN_LOGS_OF_DELETED_POLICIES_SQL) {
      const after: string = String(parameters[0]);
      const limit: number = Number(parameters[1]);

      return this.logs
        .filter((log: StoredLog): boolean => {
          return (
            log.id > after &&
            log.endsAt === null &&
            log.deletedAt === null &&
            this.isOfDeletedPolicy(log)
          );
        })
        .sort((a: StoredLog, b: StoredLog): number => {
          return a.id < b.id ? -1 : 1;
        })
        .slice(0, limit)
        .map((log: StoredLog) => {
          return {
            id: log.id,
            projectId: log.projectId,
            policyId: log.policyId,
            startsAt: log.startsAt,
          };
        });
    }

    if (sql === READ_LAST_STINT_STARTS_SQL) {
      const policyIds: Array<string> = parameters[0] as Array<string>;
      const latest: Map<string, LastStart> = new Map<string, LastStart>();

      for (const log of this.logs) {
        if (!log.policyId || !policyIds.includes(log.policyId)) {
          continue;
        }

        const key: string = `${log.projectId}/${log.policyId}`;
        const started: number = Math.min(
          log.startsAt.getTime(),
          log.createdAt.getTime(),
        );
        const known: { at: number } | undefined = latest.get(key);

        if (!known || started > known.at) {
          latest.set(key, {
            projectId: log.projectId,
            policyId: log.policyId,
            at: started,
          });
        }
      }

      return Array.from(latest.values()).map((row: LastStart) => {
        return {
          projectId: row.projectId,
          policyId: row.policyId,
          lastStartedAt: at(row.at),
        };
      });
    }

    if (sql === END_LOGS_SQL) {
      this.beforeEnd?.();

      const ids: Array<string> = parameters[0] as Array<string>;
      const ends: Array<string> = parameters[1] as Array<string>;
      const ended: Array<{ id: string }> = [];

      ids.forEach((id: string, index: number): void => {
        const log: StoredLog | undefined = this.logs.find(
          (stored: StoredLog): boolean => {
            return stored.id === id;
          },
        );

        if (
          log &&
          log.endsAt === null &&
          log.deletedAt === null &&
          this.isOfDeletedPolicy(log)
        ) {
          log.endsAt = new Date(ends[index]!);
          log.version++;
          ended.push({ id: log.id });
        }
      });

      // As TypeORM answers an UPDATE ... RETURNING on Postgres.
      return [ended, ended.length];
    }

    throw new Error(`An unexpected statement: ${sql}`);
  }

  public snapshot(): Array<StoredLog> {
    return this.logs.map((log: StoredLog): StoredLog => {
      return { ...log };
    });
  }
}

// An audit log that knows the deletions it is given, and is asked about policies.
class StandInAuditLog implements PolicyDeletionReader {
  public asked: Array<Array<DeletedPolicy>> = [];
  public isKept: boolean = true;
  public failure: Error | null = null;
  public existenceFailure: Error | null = null;

  public constructor(public deletions: Map<string, Array<Date>> = new Map()) {}

  public hasAuditLog: () => Promise<boolean> = async (): Promise<boolean> => {
    if (this.existenceFailure) {
      throw this.existenceFailure;
    }

    return this.isKept;
  };

  public readDeletions: (
    policies: ReadonlyArray<DeletedPolicy>,
  ) => Promise<Map<string, Array<Date>>> = async (
    policies: ReadonlyArray<DeletedPolicy>,
  ): Promise<Map<string, Array<Date>>> => {
    this.asked.push([...policies]);

    if (this.failure) {
      throw this.failure;
    }

    const known: Map<string, Array<Date>> = new Map<string, Array<Date>>();

    for (const policy of policies) {
      const times: Array<Date> | undefined = this.deletions.get(
        getPolicyKey(policy),
      );

      if (times) {
        known.set(getPolicyKey(policy), times);
      }
    }

    return known;
  };
}

describe("EndOnCallTimeLogsOfDeletedPolicies", () => {
  let database: StandInDatabase;
  let infoLogs: Array<string>;
  let warnLogs: Array<string>;

  beforeEach(() => {
    database = new StandInDatabase();
    infoLogs = [];
    warnLogs = [];

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((message: unknown): void => {
      warnLogs.push(String(message));
      return undefined;
    });

    jest
      .spyOn(OnCallDutyPolicyTimeLogService as any, "getRepository")
      .mockReturnValue({
        manager: {
          query: (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            return database.query(sql, parameters);
          },
        },
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function migration(
    auditLog: PolicyDeletionReader = new StandInAuditLog(),
  ): EndOnCallTimeLogsOfDeletedPolicies {
    return new EndOnCallTimeLogsOfDeletedPolicies({
      deletionReader: auditLog,
    });
  }

  test("is registered once, before the two slots kept last", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 2,
    );
  });

  test("has the name it is recorded under, and reads the audit log by default", () => {
    expect(new EndOnCallTimeLogsOfDeletedPolicies().name).toBe(MIGRATION_NAME);
    expect(new EndOnCallTimeLogsOfDeletedPolicies().runsInClusterMode()).toBe(
      true,
    );
  });

  test("its statements read only open, undeleted logs of a policy that is gone, and end them only while they still are", () => {
    const read: string = READ_OPEN_LOGS_OF_DELETED_POLICIES_SQL.replace(
      WHITESPACE,
      " ",
    );

    expect(read).toContain(`FROM "OnCallDutyPolicyTimeLog" AS "log"`);
    expect(read).toContain(`"log"."_id" > $1::uuid`);
    expect(read).toContain(`"log"."endsAt" IS NULL`);
    expect(read).toContain(`"log"."deletedAt" IS NULL`);
    expect(read).toContain(`"log"."onCallDutyPolicyId" IS NOT NULL`);
    expect(read).toContain(
      `NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicy" AS "policy" WHERE "policy"."_id" = "log"."onCallDutyPolicyId")`,
    );
    expect(read).toContain(`ORDER BY "log"."_id" ASC LIMIT $2`);
    // Nothing of the person: no name, no address, not even their id.
    expect(read).not.toContain("userId");
    expect(read).not.toContain(`"User"`);

    const end: string = END_LOGS_SQL.replace(WHITESPACE, " ");

    expect(end).toContain(`UPDATE "OnCallDutyPolicyTimeLog" AS "log"`);
    expect(end).toContain(`SET "endsAt" = "ended"."endsAt"`);
    expect(end).toContain(`"log"."endsAt" IS NULL`);
    expect(end).toContain(`"log"."deletedAt" IS NULL`);
    expect(end).toContain(
      `NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicy" AS "policy" WHERE "policy"."_id" = "log"."onCallDutyPolicyId")`,
    );
    expect(end).toContain(`RETURNING "log"."_id"`);

    const last: string = READ_LAST_STINT_STARTS_SQL.replace(WHITESPACE, " ");

    // When a stint started, never later than its log was written; never when one ended.
    expect(last).toContain(`MAX(LEAST("startsAt", "createdAt"))`);
    expect(last).not.toContain("endsAt");
    expect(last).not.toContain("updatedAt");
  });

  describe("where a log ends", () => {
    const start: Date = at(T0);

    test("when the audit log says its policy was deleted", () => {
      expect(
        EndOnCallTimeLogsOfDeletedPolicies.placeEnd({
          startsAt: start,
          deletions: [at(T0 + 9 * DAY)],
          lastStintStartedAt: at(T0 + 3 * DAY),
        }),
      ).toEqual({ end: TimeLogEnd.PolicyDeleted, endsAt: at(T0 + 9 * DAY) });
    });

    test("deleted more than once, at the first deletion from its start; started after every one, at its start", () => {
      const deletions: Array<Date> = [
        at(T0 + 20 * DAY),
        at(T0 - 5 * DAY),
        at(T0 + 2 * DAY),
      ];

      expect(
        EndOnCallTimeLogsOfDeletedPolicies.placeEnd({
          startsAt: start,
          deletions,
        }),
      ).toEqual({ end: TimeLogEnd.PolicyDeleted, endsAt: at(T0 + 2 * DAY) });

      expect(
        EndOnCallTimeLogsOfDeletedPolicies.placeEnd({
          startsAt: at(T0 + 30 * DAY),
          deletions,
        }),
      ).toEqual({ end: TimeLogEnd.PolicyDeleted, endsAt: at(T0 + 30 * DAY) });
    });

    test("else at the last time an on-call stint started on its policy, after its own start", () => {
      expect(
        EndOnCallTimeLogsOfDeletedPolicies.placeEnd({
          startsAt: start,
          deletions: [],
          lastStintStartedAt: at(T0 + 3 * DAY),
        }),
      ).toEqual({
        end: TimeLogEnd.LastStintStarted,
        endsAt: at(T0 + 3 * DAY),
      });
    });

    test("else at its own start: nothing is known of its policy after it started", () => {
      for (const lastStintStartedAt of [
        undefined,
        start,
        at(T0 - DAY),
      ] as Array<Date | undefined>) {
        expect(
          EndOnCallTimeLogsOfDeletedPolicies.placeEnd({
            startsAt: start,
            lastStintStartedAt,
          }),
        ).toEqual({ end: TimeLogEnd.OwnStart, endsAt: start });
      }
    });

    test("drawn at random: never before its start, never after its policy was deleted, and at the deletion whenever the audit log has it", () => {
      const random: SeededRandom = seededRandom(11023);

      for (let round: number = 0; round < 2000; round++) {
        // A policy in force from T0, deleted some days later.
        const deletedAt: number =
          T0 + (1 + random(400)) * DAY + drawTime(random, DAY);
        // This log started while it was in force, and so did the policy's last stint.
        const startsAt: number = T0 + drawTime(random, deletedAt - T0);
        const lastStarted: number =
          startsAt + drawTime(random, deletedAt - startsAt + MINUTE);
        const isInAuditLog: boolean = random(3) === 0;

        const placed: { end: TimeLogEnd; endsAt: Date } =
          EndOnCallTimeLogsOfDeletedPolicies.placeEnd({
            startsAt: at(startsAt),
            deletions: isInAuditLog ? [at(deletedAt)] : undefined,
            lastStintStartedAt: random(4) === 0 ? undefined : at(lastStarted),
          });

        expect(placed.endsAt.getTime()).toBeGreaterThanOrEqual(startsAt);
        expect(placed.endsAt.getTime()).toBeLessThanOrEqual(deletedAt);

        if (isInAuditLog) {
          expect(placed).toEqual({
            end: TimeLogEnd.PolicyDeleted,
            endsAt: at(deletedAt),
          });
        }
      }
    });
  });

  describe("a run", () => {
    const POLICY_DELETED_IN_AUDIT: string = idOf("aaaaaaa1", 1);
    const POLICY_DELETED_ROTATION: string = idOf("aaaaaaa2", 2);
    const POLICY_DELETED_ALONE: string = idOf("aaaaaaa3", 3);
    const POLICY_IN_FORCE: string = idOf("aaaaaaa4", 4);

    // The logs, by what they show.
    function seed(): void {
      database.existingPolicies.add(POLICY_IN_FORCE);

      // A policy the audit log saw deleted on day 40: two open logs, one closed.
      database.add({
        id: idOf("10000000", 1),
        policyId: POLICY_DELETED_IN_AUDIT,
        startsAt: at(T0),
      });
      database.add({
        id: idOf("10000000", 2),
        policyId: POLICY_DELETED_IN_AUDIT,
        startsAt: at(T0 + 10 * DAY),
      });
      database.add({
        id: idOf("10000000", 3),
        policyId: POLICY_DELETED_IN_AUDIT,
        startsAt: at(T0),
        endsAt: at(T0 + 5 * DAY),
      });

      /*
       * A rotation's policy, deleted with nothing in the audit log: a person
       * named on it since day 0, the schedule's turns handed over on days 7
       * and 14 - the one from day 14 still open - and a team's log a team's
       * deletion ended on day 60, after the policy was gone.
       */
      database.add({
        id: idOf("20000000", 1),
        policyId: POLICY_DELETED_ROTATION,
        startsAt: at(T0),
      });
      database.add({
        id: idOf("20000000", 2),
        policyId: POLICY_DELETED_ROTATION,
        startsAt: at(T0 + 7 * DAY),
        endsAt: at(T0 + 14 * DAY),
      });
      database.add({
        id: idOf("20000000", 3),
        policyId: POLICY_DELETED_ROTATION,
        startsAt: at(T0 + 14 * DAY),
      });
      database.add({
        id: idOf("20000000", 4),
        policyId: POLICY_DELETED_ROTATION,
        startsAt: at(T0 + 2 * DAY),
        endsAt: at(T0 + 60 * DAY),
      });

      // A policy with one log, and nothing after it.
      database.add({
        id: idOf("30000000", 1),
        policyId: POLICY_DELETED_ALONE,
        projectId: OTHER_PROJECT,
        startsAt: at(T0 + 3 * DAY),
      });

      // Never touched: a policy in force, a log deleted, a log naming no policy.
      database.add({
        id: idOf("40000000", 1),
        policyId: POLICY_IN_FORCE,
        startsAt: at(T0),
      });
      database.add({
        id: idOf("40000000", 2),
        policyId: POLICY_DELETED_ALONE,
        projectId: OTHER_PROJECT,
        startsAt: at(T0),
        deletedAt: at(T0 + DAY),
      });
      database.add({
        id: idOf("40000000", 3),
        policyId: null,
        startsAt: at(T0),
      });
    }

    function auditLogWithDeletion(): StandInAuditLog {
      return new StandInAuditLog(
        new Map<string, Array<Date>>([
          [
            getPolicyKey({
              projectId: PROJECT,
              policyId: POLICY_DELETED_IN_AUDIT,
            }),
            [at(T0 + 40 * DAY)],
          ],
        ]),
      );
    }

    test("ends each open log of a deleted policy where the data places it, and nothing else", async () => {
      seed();
      const before: Array<StoredLog> = database.snapshot();

      await migration(auditLogWithDeletion()).migrate();

      // The audit log's deletion, for both open logs of that policy.
      expect(database.byId(idOf("10000000", 1)).endsAt).toEqual(
        at(T0 + 40 * DAY),
      );
      expect(database.byId(idOf("10000000", 2)).endsAt).toEqual(
        at(T0 + 40 * DAY),
      );

      /*
       * No deletion on record: the last stint that started, on day 14 - not
       * the team's log ended on day 60, after the policy was gone. The
       * stint that started then ends at its own start.
       */
      expect(database.byId(idOf("20000000", 1)).endsAt).toEqual(
        at(T0 + 14 * DAY),
      );
      expect(database.byId(idOf("20000000", 3)).endsAt).toEqual(
        at(T0 + 14 * DAY),
      );

      // Nothing after it: its own start.
      expect(database.byId(idOf("30000000", 1)).endsAt).toEqual(
        at(T0 + 3 * DAY),
      );

      // Everything else exactly as it was.
      for (const id of [
        idOf("10000000", 3),
        idOf("20000000", 2),
        idOf("20000000", 4),
        idOf("40000000", 1),
        idOf("40000000", 2),
        idOf("40000000", 3),
      ]) {
        expect(database.byId(id)).toEqual(
          before.find((log: StoredLog): boolean => {
            return log.id === id;
          }),
        );
      }
    });

    test("a second run ends nothing more, and says so", async () => {
      seed();

      await migration(auditLogWithDeletion()).migrate();
      const afterFirst: Array<StoredLog> = database.snapshot();

      infoLogs = [];
      database.statements = [];

      const auditLog: StandInAuditLog = auditLogWithDeletion();
      await migration(auditLog).migrate();

      expect(database.snapshot()).toEqual(afterFirst);
      // One read, which finds nothing: no write, and the audit log is not asked.
      expect(
        database.statements.map((statement: { sql: string }): string => {
          return statement.sql;
        }),
      ).toEqual([READ_OPEN_LOGS_OF_DELETED_POLICIES_SQL]);
      expect(auditLog.asked).toEqual([]);
      expect(infoLogs).toEqual([
        `${MIGRATION_NAME}: no on-call time log was left open by a deleted on-call policy.`,
      ]);
    });

    test("says what it ended, per policy by its id and project and in all, and nobody's name", async () => {
      seed();

      await migration(auditLogWithDeletion()).migrate();

      expect(infoLogs).toEqual([
        `${MIGRATION_NAME}: deleted on-call policy ${POLICY_DELETED_IN_AUDIT} of project ${PROJECT}: ended 2 log(s) at ${at(T0 + 40 * DAY).toISOString()}, when the audit log says the policy was deleted.`,
        `${MIGRATION_NAME}: deleted on-call policy ${POLICY_DELETED_ROTATION} of project ${PROJECT}: ended 1 log(s) at ${at(T0 + 14 * DAY).toISOString()}, the last time an on-call stint started on the policy; 1 log(s) at their own start, as nothing is known of the policy after they started.`,
        `${MIGRATION_NAME}: deleted on-call policy ${POLICY_DELETED_ALONE} of project ${OTHER_PROJECT}: ended 1 log(s) at their own start, as nothing is known of the policy after they started.`,
        `${MIGRATION_NAME}: ended 5 on-call time log(s) left open by 3 deleted on-call policies: 2 log(s), when the audit log says their policy was deleted; 1 log(s), the last time an on-call stint started on their policy; 2 log(s) at their own start, as nothing is known of their policy after they started.`,
      ]);
      expect(warnLogs).toEqual([]);

      // Ids, counts and times: never the person a log is about.
      for (const line of infoLogs) {
        expect(line).not.toContain("11023000-0000-4000-8000-00000000f001");
      }
    });

    test("asks the audit log about each page's policies, by project, once a page", async () => {
      seed();
      const auditLog: StandInAuditLog = auditLogWithDeletion();

      await migration(auditLog).migrate();

      expect(auditLog.asked).toEqual([
        [
          { projectId: PROJECT, policyId: POLICY_DELETED_IN_AUDIT },
          { projectId: PROJECT, policyId: POLICY_DELETED_ROTATION },
          { projectId: OTHER_PROJECT, policyId: POLICY_DELETED_ALONE },
        ],
      ]);

      // The last stints are read for the same policies.
      const lastRead: { parameters: Array<unknown> } | undefined =
        database.statements.find((statement: { sql: string }): boolean => {
          return statement.sql === READ_LAST_STINT_STARTS_SQL;
        });

      expect(lastRead?.parameters).toEqual([
        [
          POLICY_DELETED_IN_AUDIT,
          POLICY_DELETED_ROTATION,
          POLICY_DELETED_ALONE,
        ],
      ]);
    });

    test("on an install with no audit log, every log ends without it, and the log says so", async () => {
      seed();
      const auditLog: StandInAuditLog = auditLogWithDeletion();
      auditLog.isKept = false;

      const summary: EndedSummary = await migration(auditLog).endLogs();

      expect(auditLog.asked).toEqual([]);
      expect(summary.auditLog).toBe(AuditLogRead.None);
      // The policy the audit log would have placed ends at the last stint started on it.
      expect(database.byId(idOf("10000000", 1)).endsAt).toEqual(
        at(T0 + 10 * DAY),
      );
      expect(database.byId(idOf("10000000", 2)).endsAt).toEqual(
        at(T0 + 10 * DAY),
      );
      expect(
        EndOnCallTimeLogsOfDeletedPolicies.describe(summary).pop()?.text,
      ).toContain(
        ". This install has no audit log, so none was ended when it says its policy was deleted.",
      );
    });

    test("an audit log that cannot be read is said so, read no more, and the logs end without it", async () => {
      seed();
      const auditLog: StandInAuditLog = auditLogWithDeletion();
      auditLog.failure = new Error("ClickHouse is down");

      await migration(auditLog).migrate();

      expect(auditLog.asked).toHaveLength(1);
      expect(database.byId(idOf("10000000", 1)).endsAt).toEqual(
        at(T0 + 10 * DAY),
      );
      expect(warnLogs).toEqual([
        `${MIGRATION_NAME}: the audit log could not be read (ClickHouse is down), so no log was ended when it says its policy was deleted: each ended at the last time an on-call stint started on its policy, or at its own start.`,
      ]);

      // Its existence unknown: never asked.
      const notThere: StandInAuditLog = auditLogWithDeletion();
      notThere.existenceFailure = new Error("timed out");
      database = new StandInDatabase();
      seed();
      warnLogs = [];

      await migration(notThere).migrate();

      expect(notThere.asked).toEqual([]);
      expect(warnLogs[0]).toContain(
        "the audit log could not be read (timed out)",
      );
    });

    test("a log ended meanwhile - by OneUptime, or another run - keeps its end, and is not counted", async () => {
      seed();
      const elsewhere: Date = at(T0 + 33 * DAY);

      database.beforeEnd = (): void => {
        database.byId(idOf("20000000", 1)).endsAt = elsewhere;
        database.beforeEnd = null;
      };

      const summary: EndedSummary = await migration(
        auditLogWithDeletion(),
      ).endLogs();

      expect(database.byId(idOf("20000000", 1)).endsAt).toEqual(elsewhere);
      expect(summary.read).toBe(5);
      expect(summary.ended).toBe(4);
      expect(
        EndOnCallTimeLogsOfDeletedPolicies.describe(summary).pop()?.text,
      ).toContain(
        ". 1 more had an end, or their policy back, before they were written.",
      );
    });

    test("a policy that came back before the write keeps its logs open", async () => {
      seed();

      database.beforeEnd = (): void => {
        database.existingPolicies.add(POLICY_DELETED_ALONE);
      };

      await migration(auditLogWithDeletion()).migrate();

      expect(database.byId(idOf("30000000", 1)).endsAt).toBeNull();
    });
  });

  test("pages of PAGE_SIZE, each after the last id of the page before, until one is short", async () => {
    const policyId: string = idOf("bbbbbbb1", 1);
    const count: number = PAGE_SIZE * 2 + 7;

    for (let index: number = 0; index < count; index++) {
      database.add({
        id: idOf("50000000", index + 1),
        policyId,
        startsAt: at(T0 + index * MINUTE),
      });
    }

    const summary: EndedSummary = await migration().endLogs();

    const reads: Array<Array<unknown>> = database.statements
      .filter((statement: { sql: string }): boolean => {
        return statement.sql === READ_OPEN_LOGS_OF_DELETED_POLICIES_SQL;
      })
      .map((statement: { parameters: Array<unknown> }): Array<unknown> => {
        return statement.parameters;
      });

    expect(reads).toEqual([
      [FIRST_ID, PAGE_SIZE],
      [idOf("50000000", PAGE_SIZE), PAGE_SIZE],
      [idOf("50000000", PAGE_SIZE * 2), PAGE_SIZE],
    ]);

    // Each write is one page's.
    const writes: Array<Array<unknown>> = database.statements
      .filter((statement: { sql: string }): boolean => {
        return statement.sql === END_LOGS_SQL;
      })
      .map((statement: { parameters: Array<unknown> }): Array<unknown> => {
        return statement.parameters;
      });

    expect(
      writes.map((parameters: Array<unknown>): number => {
        return (parameters[0] as Array<string>).length;
      }),
    ).toEqual([PAGE_SIZE, PAGE_SIZE, 7]);

    // Every log ended at the last stint started on the policy, the newest at its own start.
    expect(summary.ended).toBe(count);
    expect(summary.byEnd).toEqual({
      [TimeLogEnd.PolicyDeleted]: 0,
      [TimeLogEnd.LastStintStarted]: count - 1,
      [TimeLogEnd.OwnStart]: 1,
    });

    for (const log of database.logs) {
      expect(log.endsAt).toEqual(at(T0 + (count - 1) * MINUTE));
    }
  });

  test("drawn at random: run twice, or twice at once, it ends exactly the open logs of deleted policies, within their policy's time, and changes nothing the second time", async () => {
    const random: SeededRandom = seededRandom(1102310983);

    for (let round: number = 0; round < 25; round++) {
      database = new StandInDatabase();

      // Policies in force from T0; some deleted, each at its own time.
      const deletedAt: Map<string, number> = new Map<string, number>();
      const policies: Array<string> = [];

      for (let index: number = 0; index < 1 + random(6); index++) {
        const policyId: string = idOf(
          `c${round.toString(16).padStart(7, "0")}`,
          index + 1,
        );
        policies.push(policyId);

        if (random(3) === 0) {
          database.existingPolicies.add(policyId);
        } else {
          deletedAt.set(policyId, T0 + (10 + random(300)) * DAY);
        }
      }

      const deletions: Map<string, Array<Date>> = new Map<
        string,
        Array<Date>
      >();

      for (const [policyId, time] of deletedAt) {
        if (random(2) === 0) {
          deletions.set(getPolicyKey({ projectId: PROJECT, policyId }), [
            at(time),
          ]);
        }
      }

      // Logs started while their policy was in force; some ended, some deleted.
      for (let index: number = 0; index < random(40); index++) {
        const policyId: string = policies[random(policies.length)]!;
        const end: number = deletedAt.get(policyId) ?? T0 + 400 * DAY;
        const startsAt: number = T0 + drawTime(random, end - T0);
        const isEnded: boolean = random(3) === 0;

        database.add({
          id: idOf(`d${round.toString(16).padStart(7, "0")}`, index + 1),
          policyId,
          startsAt: at(startsAt),
          endsAt: isEnded ? at(startsAt + drawTime(random, DAY)) : null,
          deletedAt: random(10) === 0 ? at(startsAt) : null,
        });
      }

      const before: Array<StoredLog> = database.snapshot();
      const isTwiceAtOnce: boolean = random(2) === 0;

      if (isTwiceAtOnce) {
        await Promise.all([
          migration(new StandInAuditLog(deletions)).migrate(),
          migration(new StandInAuditLog(deletions)).migrate(),
        ]);
      } else {
        await migration(new StandInAuditLog(deletions)).migrate();
      }

      const afterFirst: Array<StoredLog> = database.snapshot();

      afterFirst.forEach((log: StoredLog, index: number): void => {
        const was: StoredLog = before[index]!;
        const isToEnd: boolean =
          was.endsAt === null &&
          was.deletedAt === null &&
          was.policyId !== null &&
          deletedAt.has(was.policyId);

        if (!isToEnd) {
          expect(log).toEqual(was);
          return;
        }

        const policyDeletedAt: number = deletedAt.get(was.policyId!)!;

        expect(log.endsAt).not.toBeNull();
        expect(log.endsAt!.getTime()).toBeGreaterThanOrEqual(
          was.startsAt.getTime(),
        );
        // Never past the deletion: never counted on call after it.
        expect(log.endsAt!.getTime()).toBeLessThanOrEqual(policyDeletedAt);

        if (
          deletions.has(
            getPolicyKey({ projectId: PROJECT, policyId: was.policyId! }),
          )
        ) {
          expect(log.endsAt).toEqual(at(policyDeletedAt));
        }
      });

      await migration(new StandInAuditLog(deletions)).migrate();

      expect(database.snapshot()).toEqual(afterFirst);
    }
  });

  test("a failing statement stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(OnCallDutyPolicyTimeLogService as any, "getRepository")
      .mockReturnValue({
        manager: {
          query: async (): Promise<unknown> => {
            throw new Error("db down");
          },
        },
      });

    await expect(migration().migrate()).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    await migration().rollback();

    expect(database.statements).toEqual([]);
  });

  describe("the audit log's read", () => {
    test("asks for each policy's Delete entries in its project, by every type name its entries are stored under, every value bound", () => {
      const statement: Statement =
        EndOnCallTimeLogsOfDeletedPolicies.toAuditLogDeletionsStatement({
          table: "oneuptime.AuditLogV2",
          policies: [
            { projectId: PROJECT, policyId: idOf("AAAAAAA1", 1) },
            { projectId: PROJECT, policyId: idOf("aaaaaaa2", 2) },
            { projectId: OTHER_PROJECT, policyId: idOf("aaaaaaa3", 3) },
          ],
        });

      const query: string = statement.query.replace(WHITESPACE, " ");

      expect(query).toContain(
        "SELECT projectId AS deletedPolicyProjectId, lower(toString(resourceId)) AS deletedPolicyId, groupArray(toUnixTimestamp(createdAt)) AS deletedAtSeconds FROM oneuptime.AuditLogV2 WHERE projectId IN {p0:Array(String)} AND action = {p1:String} AND resourceType IN {p2:Array(String)} AND lower(toString(resourceId)) IN {p3:Array(String)} GROUP BY deletedPolicyProjectId, deletedPolicyId",
      );
      expect(query).toContain("max_execution_time = 45");
      expect(query).toContain("timeout_overflow_mode = 'throw'");

      expect(statement.query_params["p0"]).toEqual([PROJECT, OTHER_PROJECT]);
      expect(statement.query_params["p1"]).toBe(AuditLogAction.Delete);
      expect(statement.query_params["p2"]).toEqual(["On-Call Policy"]);
      // Ids as Postgres writes them: lower case.
      expect(statement.query_params["p3"]).toEqual([
        idOf("aaaaaaa1", 1),
        idOf("aaaaaaa2", 2),
        idOf("aaaaaaa3", 3),
      ]);
    });

    test("reads each policy's deletions, earliest first, and leaves out what it cannot read", () => {
      const deletions: Map<
        string,
        Array<Date>
      > = EndOnCallTimeLogsOfDeletedPolicies.readDeletionRows([
        {
          deletedPolicyProjectId: PROJECT,
          deletedPolicyId: idOf("aaaaaaa1", 1),
          deletedAtSeconds: [T0 / 1000 + 600, T0 / 1000],
        },
        {
          deletedPolicyProjectId: OTHER_PROJECT,
          deletedPolicyId: idOf("aaaaaaa3", 3),
          // As text, as ClickHouse writes a wider number.
          deletedAtSeconds: [String(T0 / 1000 + 60)],
        },
        {
          deletedPolicyProjectId: PROJECT,
          deletedPolicyId: idOf("aaaaaaa4", 4),
          deletedAtSeconds: [0],
        },
        { deletedPolicyProjectId: PROJECT, deletedAtSeconds: [T0 / 1000] },
        {
          deletedPolicyProjectId: PROJECT,
          deletedPolicyId: idOf("aaaaaaa5", 5),
          deletedAtSeconds: "x",
        },
      ]);

      expect(Array.from(deletions.entries())).toEqual([
        [
          getPolicyKey({ projectId: PROJECT, policyId: idOf("aaaaaaa1", 1) }),
          [at(T0), at(T0 + 600 * 1000)],
        ],
        [
          getPolicyKey({
            projectId: OTHER_PROJECT,
            policyId: idOf("aaaaaaa3", 3),
          }),
          [at(T0 + 60 * 1000)],
        ],
      ]);
    });
  });
});
