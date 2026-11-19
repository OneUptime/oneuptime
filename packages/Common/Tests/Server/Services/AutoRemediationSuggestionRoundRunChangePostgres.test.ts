import Entities from "../../../Models/DatabaseModels/Index";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AutoRemediationSuggestionService, {
  RoundRunChangeSet,
} from "../../../Server/Services/AutoRemediationSuggestionService";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * TRY AGAIN ON AN AI FIX THAT STOPPED, ON A REAL ROW (issue #6524).
 *
 * Try again hands a fix whose round stopped to a new run with one
 * conditional UPDATE (AutoRemediationSuggestionService
 * .attemptRoundRunChange, called by RemediationRound.tryAgain): its WHERE
 * carries the fix as it was read - its id, its status, its run ("aiRunId"
 * = the run read, or IS NULL for a fix with none) and "deletedAt" IS NULL
 * - and it answers the rows it changed. That one statement is what makes
 * two presses start the fix once, and what keeps a fix that moved on from
 * being written: its mocked suite checks the query it builds, this one
 * what Postgres does with it.
 *
 * Opt in with RUN_POSTGRES_AI_REMEDIATION_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_AI_REMEDIATION_TESTS=true \
 *   AI_REMEDIATION_TEST_DATABASE_HOST=127.0.0.1 \
 *   AI_REMEDIATION_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/AutoRemediationSuggestionRoundRunChangePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, beside the
 * suite of Try again on the record (AiRemediationTryAgainPostgres).
 *
 * The production service writes a structure-only clone of the migrated
 * AutoRemediationSuggestion table, in a schema of its own. Pinned:
 *
 *   - of two presses at once on the same fix - its status and its run as
 *     both read them - exactly one changes it, and the row names that
 *     press's run: the second waits for the first's row lock, and Postgres
 *     reads its WHERE again on the row the first wrote;
 *   - a press whose run no longer matches (the fix was tried again since)
 *     changes nothing, and neither does one whose status no longer does
 *     (dismissed, settled by its sweep, waiting for approval);
 *   - a fix with no run yet (IS NULL) is handed over once, and the two
 *     branches never cross: IS NULL never matches a fix with a run, and a
 *     run never matches a fix with none;
 *   - a soft-deleted fix is never written;
 *   - the put-back after a run that was named but never created (the queue
 *     did not take it) restores the fix exactly as it was read - its
 *     status, its run, its plans and its reasoning - and a put-back from a
 *     run the fix no longer names changes nothing.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_AI_REMEDIATION_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "AutoRemediationSuggestion";

// What a round started again changes: RemediationRound.tryAgain's hand-over.
function handOverTo(runId: ObjectID): RoundRunChangeSet {
  return {
    status: AutoRemediationSuggestionStatus.Planning,
    aiRunId: runId.toString(),
    commandPlan: null,
    mcpToolCallPlan: null,
    rationaleMarkdown: null,
  };
}

const COMMAND_PLAN: JSONObject = {
  commands: [
    {
      sequence: 1,
      stepType: "Kubectl",
      command: "kubectl rollout restart deployment/checkout -n shop",
      rationale: "Restart the pods stuck on the old config.",
      policyVerdict: "RequiresApproval",
    },
  ],
};

const MCP_TOOL_CALL_PLAN: JSONObject = {
  calls: [
    {
      sequence: 1,
      serverId: "aws",
      serverNameSnapshot: "AWS",
      toolName: "ecs_update_service",
      arguments: { service: "checkout", desiredCount: 4 },
      status: "Proposed",
    },
  ],
};

const RATIONALE: string =
  "The AI fix did not finish — the planning run failed. Nothing was run or proposed.";

interface StoredRound {
  status: string;
  aiRunId: string | null;
  commandPlan: unknown;
  mcpToolCallPlan: unknown;
  rationaleMarkdown: string | null;
  deletedAt: Date | null;
}

describePostgres(
  "Try again's conditional update of an AI fix, on migrated Postgres",
  () => {
    const schema: string = `ai_round_run_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["AI_REMEDIATION_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["AI_REMEDIATION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["AI_REMEDIATION_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        /*
         * The service's UPDATE names the clone, schema and all, so the
         * races below find their own statements waiting in
         * pg_stat_activity.
         */
        schema,
        synchronize: false,
        // Three connections at least: a lock holder and two presses.
        extra: { options: `-c search_path=${schema},public`, max: 6 },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
      );

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest.spyOn(logger, "debug").mockImplementation((): void => {});
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
    });

    // A fix as a round leaves it: its status, its run, and what it wrote.
    async function seedFix(data: {
      status: AutoRemediationSuggestionStatus;
      aiRunId: ObjectID | null;
      commandPlan?: JSONObject | null;
      mcpToolCallPlan?: JSONObject | null;
      rationaleMarkdown?: string | null;
      isDeleted?: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."${TABLE}"
          ("_id", "projectId", "incidentId", "status", "executionMode", "suggestionType",
           "aiRunId", "commandPlan", "mcpToolCallPlan", "rationaleMarkdown", "ruleNameSnapshot",
           "deletedAt", "version")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1)`,
        [
          id.toString(),
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          data.status,
          AutoRemediationExecutionMode.Suggest,
          AutoRemediationSuggestionType.CommandPlan,
          data.aiRunId ? data.aiRunId.toString() : null,
          data.commandPlan ? JSON.stringify(data.commandPlan) : null,
          data.mcpToolCallPlan ? JSON.stringify(data.mcpToolCallPlan) : null,
          data.rationaleMarkdown ?? null,
          'AI kubectl fix for cluster "prod-eu"',
          data.isDeleted ? new Date() : null,
        ],
      );

      return id;
    }

    async function storedRound(id: ObjectID): Promise<StoredRound> {
      const rows: Array<StoredRound> = await database.query(
        `SELECT "status", "aiRunId", "commandPlan", "mcpToolCallPlan", "rationaleMarkdown", "deletedAt"
           FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
        [id.toString()],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    async function press(data: {
      id: ObjectID;
      fromStatus: AutoRemediationSuggestionStatus;
      fromAiRunId: ObjectID | null;
      set: RoundRunChangeSet;
    }): Promise<number> {
      return await AutoRemediationSuggestionService.attemptRoundRunChange({
        suggestionId: data.id,
        fromStatus: data.fromStatus,
        fromAiRunId: data.fromAiRunId,
        set: data.set,
      });
    }

    /*
     * Fires the presses while another transaction holds the fix's row - as
     * a press that got there first holds it, having locked it (`holding`)
     * or already written it - and lets go once every press waits for its
     * lock. The holder always lets go, so a press that never waits fails
     * its test instead of leaving the row locked.
     */
    async function pressWhileHeld(data: {
      id: ObjectID;
      holding: (holder: QueryRunner) => Promise<void>;
      presses: Array<() => Promise<number>>;
    }): Promise<Array<number>> {
      const holder: QueryRunner = database.createQueryRunner();

      await holder.connect();
      await holder.startTransaction();

      let answers: Promise<Array<number>> = Promise.resolve([]);
      let waitError: unknown = null;

      try {
        await data.holding(holder);

        answers = Promise.all(
          data.presses.map((pressNow: () => Promise<number>) => {
            return pressNow();
          }),
        );

        await waitForWaitingUpdates(data.presses.length);
      } catch (error) {
        waitError = error;
      } finally {
        await holder.commitTransaction();
        await holder.release();
      }

      const results: Array<number> = await answers;

      if (waitError) {
        throw waitError;
      }

      return results;
    }

    // Locks the fix's row, as a press that read it first does.
    async function lockRow(holder: QueryRunner, id: ObjectID): Promise<void> {
      await holder.query(
        `SELECT "_id" FROM "${schema}"."${TABLE}" WHERE "_id" = $1 FOR UPDATE`,
        [id.toString()],
      );
    }

    // Waits until this many of the suite's UPDATEs wait for a row lock.
    async function waitForWaitingUpdates(count: number): Promise<void> {
      let waiting: number = 0;

      for (
        let attempt: number = 0;
        attempt < 400 && waiting < count;
        attempt++
      ) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 25);
        });

        const rows: Array<{ waiting: string }> = await database.query(
          `SELECT count(*) AS "waiting" FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE %'
              AND query LIKE '%"${schema}"."${TABLE}"%'`,
        );

        waiting = Number(rows[0]!.waiting);
      }

      expect(waiting).toBe(count);
    }

    describe("two presses at once start the fix once", () => {
      test("of two presses on the same status and run, exactly one changes the fix, and the row names that press's run", async () => {
        const oldRunId: ObjectID = ObjectID.generate();
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: oldRunId,
          commandPlan: COMMAND_PLAN,
          rationaleMarkdown: RATIONALE,
        });
        const firstRunId: ObjectID = ObjectID.generate();
        const secondRunId: ObjectID = ObjectID.generate();

        // Both read the fix before either wrote: both wait for one lock.
        const [first, second] = await pressWhileHeld({
          id,
          holding: async (holder: QueryRunner): Promise<void> => {
            await lockRow(holder, id);
          },
          presses: [firstRunId, secondRunId].map((runId: ObjectID) => {
            return (): Promise<number> => {
              return press({
                id,
                fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
                fromAiRunId: oldRunId,
                set: handOverTo(runId),
              });
            };
          }),
        });

        expect([first, second].sort()).toEqual([0, 1]);

        const winner: ObjectID = first === 1 ? firstRunId : secondRunId;

        expect(await storedRound(id)).toEqual({
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: winner.toString(),
          commandPlan: null,
          mcpToolCallPlan: null,
          rationaleMarkdown: null,
          deletedAt: null,
        });
      });

      test("a press that waits for one that got there first reads the fix again once it may: it no longer names the run it read, and nothing is written", async () => {
        const oldRunId: ObjectID = ObjectID.generate();
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: oldRunId,
        });
        const firstRunId: ObjectID = ObjectID.generate();
        const lateRunId: ObjectID = ObjectID.generate();

        /*
         * The first press has written, and not yet committed: the second
         * waits, then finds the fix named the first press's run.
         */
        const [late] = await pressWhileHeld({
          id,
          holding: async (holder: QueryRunner): Promise<void> => {
            await holder.query(
              `UPDATE "${schema}"."${TABLE}" SET "status" = $2, "aiRunId" = $3 WHERE "_id" = $1`,
              [
                id.toString(),
                AutoRemediationSuggestionStatus.Planning,
                firstRunId.toString(),
              ],
            );
          },
          presses: [
            (): Promise<number> => {
              return press({
                id,
                fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
                fromAiRunId: oldRunId,
                set: handOverTo(lateRunId),
              });
            },
          ],
        });

        expect(late).toBe(0);
        expect((await storedRound(id)).aiRunId).toBe(firstRunId.toString());
      });

      test("a fix whose round has no run yet is handed over once, and then never again by a press that read it with none", async () => {
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: null,
        });
        const firstRunId: ObjectID = ObjectID.generate();
        const secondRunId: ObjectID = ObjectID.generate();

        const [first, second] = await pressWhileHeld({
          id,
          holding: async (holder: QueryRunner): Promise<void> => {
            await lockRow(holder, id);
          },
          presses: [firstRunId, secondRunId].map((runId: ObjectID) => {
            return (): Promise<number> => {
              return press({
                id,
                fromStatus: AutoRemediationSuggestionStatus.Planning,
                fromAiRunId: null,
                set: handOverTo(runId),
              });
            };
          }),
        });

        expect([first, second].sort()).toEqual([0, 1]);

        const winner: ObjectID = first === 1 ? firstRunId : secondRunId;

        expect((await storedRound(id)).aiRunId).toBe(winner.toString());

        // A third press read it before either: it has a run now.
        await expect(
          press({
            id,
            fromStatus: AutoRemediationSuggestionStatus.Planning,
            fromAiRunId: null,
            set: handOverTo(ObjectID.generate()),
          }),
        ).resolves.toBe(0);
        expect((await storedRound(id)).aiRunId).toBe(winner.toString());
      });
    });

    describe("a fix that moved on is left alone", () => {
      test("a press whose run no longer matches - the fix was tried again since - changes nothing", async () => {
        const readRunId: ObjectID = ObjectID.generate();
        const newerRunId: ObjectID = ObjectID.generate();
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: newerRunId,
          mcpToolCallPlan: MCP_TOOL_CALL_PLAN,
          rationaleMarkdown: RATIONALE,
        });
        const before: StoredRound = await storedRound(id);

        await expect(
          press({
            id,
            fromStatus: AutoRemediationSuggestionStatus.Planning,
            fromAiRunId: readRunId,
            set: handOverTo(ObjectID.generate()),
          }),
        ).resolves.toBe(0);

        expect(await storedRound(id)).toEqual(before);
        expect(before.aiRunId).toBe(newerRunId.toString());
        expect(before.mcpToolCallPlan).toEqual(MCP_TOOL_CALL_PLAN);
      });

      test("the two branches never cross: a press that read no run never takes a fix that has one, and one that read a run never takes a fix with none", async () => {
        const runId: ObjectID = ObjectID.generate();
        const withRun: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: runId,
        });
        const withoutRun: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: null,
        });

        await expect(
          press({
            id: withRun,
            fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
            fromAiRunId: null,
            set: handOverTo(ObjectID.generate()),
          }),
        ).resolves.toBe(0);
        await expect(
          press({
            id: withoutRun,
            fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
            fromAiRunId: runId,
            set: handOverTo(ObjectID.generate()),
          }),
        ).resolves.toBe(0);

        expect((await storedRound(withRun)).aiRunId).toBe(runId.toString());
        expect((await storedRound(withoutRun)).aiRunId).toBeNull();
      });

      test.each([
        [AutoRemediationSuggestionStatus.Dismissed, "a person dismissed it"],
        [
          AutoRemediationSuggestionStatus.AutoExecuted,
          "its sweep settled what it had already run",
        ],
        [
          AutoRemediationSuggestionStatus.Suggested,
          "it proposed a fix and waits for approval",
        ],
        [
          AutoRemediationSuggestionStatus.Planning,
          "it is being worked out again",
        ],
      ])(
        "a press that read it as having found no fix changes nothing once it is %s (%s)",
        async (now: AutoRemediationSuggestionStatus) => {
          const runId: ObjectID = ObjectID.generate();
          const id: ObjectID = await seedFix({
            status: now,
            aiRunId: runId,
            commandPlan: COMMAND_PLAN,
            rationaleMarkdown: RATIONALE,
          });
          const before: StoredRound = await storedRound(id);

          await expect(
            press({
              id,
              fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
              fromAiRunId: runId,
              set: handOverTo(ObjectID.generate()),
            }),
          ).resolves.toBe(0);

          expect(await storedRound(id)).toEqual(before);
          expect(before.status).toBe(now);
        },
      );

      test("a soft-deleted fix is never written, whatever the press read", async () => {
        const runId: ObjectID = ObjectID.generate();
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: runId,
          commandPlan: COMMAND_PLAN,
          rationaleMarkdown: RATIONALE,
          isDeleted: true,
        });
        const before: StoredRound = await storedRound(id);

        await expect(
          press({
            id,
            fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
            fromAiRunId: runId,
            set: handOverTo(ObjectID.generate()),
          }),
        ).resolves.toBe(0);

        expect(await storedRound(id)).toEqual(before);
        expect(before.deletedAt).not.toBeNull();
      });

      test("another fix is never written: the press names its own row", async () => {
        const runId: ObjectID = ObjectID.generate();
        const pressed: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: runId,
        });
        // Read the same way, with the same run: only its id differs.
        const other: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: runId,
        });
        const newRunId: ObjectID = ObjectID.generate();

        await expect(
          press({
            id: pressed,
            fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
            fromAiRunId: runId,
            set: handOverTo(newRunId),
          }),
        ).resolves.toBe(1);

        expect((await storedRound(pressed)).aiRunId).toBe(newRunId.toString());
        expect(await storedRound(other)).toMatchObject({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: runId.toString(),
        });
      });
    });

    describe("a run named but never created puts the fix back as it was", () => {
      // The fix as RemediationRound.tryAgain reads it, before it hands it over.
      async function readAsTryAgainDoes(
        id: ObjectID,
      ): Promise<AutoRemediationSuggestion> {
        const suggestion: AutoRemediationSuggestion | null =
          await AutoRemediationSuggestionService.findOneById({
            id,
            select: {
              _id: true,
              status: true,
              aiRunId: true,
              commandPlan: true,
              mcpToolCallPlan: true,
              rationaleMarkdown: true,
            },
            props: { isRoot: true },
          });

        expect(suggestion).not.toBeNull();

        return suggestion!;
      }

      // RemediationRound.tryAgain's put-back, from the run its press named.
      function putBack(read: AutoRemediationSuggestion): RoundRunChangeSet {
        return {
          status: read.status!,
          aiRunId: read.aiRunId ? read.aiRunId.toString() : null,
          commandPlan: read.commandPlan || null,
          mcpToolCallPlan: read.mcpToolCallPlan || null,
          rationaleMarkdown: read.rationaleMarkdown || null,
        };
      }

      test("its status, its run, its plans and its reasoning come back exactly as they were read", async () => {
        const oldRunId: ObjectID = ObjectID.generate();
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: oldRunId,
          commandPlan: COMMAND_PLAN,
          mcpToolCallPlan: MCP_TOOL_CALL_PLAN,
          rationaleMarkdown: RATIONALE,
        });
        const before: StoredRound = await storedRound(id);
        const read: AutoRemediationSuggestion = await readAsTryAgainDoes(id);
        const newRunId: ObjectID = ObjectID.generate();

        await expect(
          press({
            id,
            fromStatus: read.status!,
            fromAiRunId: read.aiRunId || null,
            set: handOverTo(newRunId),
          }),
        ).resolves.toBe(1);
        expect(await storedRound(id)).toMatchObject({
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: newRunId.toString(),
          commandPlan: null,
          mcpToolCallPlan: null,
          rationaleMarkdown: null,
        });

        // The queue did not create the run: the fix is put back.
        await expect(
          press({
            id,
            fromStatus: AutoRemediationSuggestionStatus.Planning,
            fromAiRunId: newRunId,
            set: putBack(read),
          }),
        ).resolves.toBe(1);

        expect(await storedRound(id)).toEqual(before);
        expect(before).toEqual({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: oldRunId.toString(),
          commandPlan: COMMAND_PLAN,
          mcpToolCallPlan: MCP_TOOL_CALL_PLAN,
          rationaleMarkdown: RATIONALE,
          deletedAt: null,
        });
      });

      test("a fix that had no run and no plan is put back with none", async () => {
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: null,
        });
        const before: StoredRound = await storedRound(id);
        const read: AutoRemediationSuggestion = await readAsTryAgainDoes(id);
        const newRunId: ObjectID = ObjectID.generate();

        await expect(
          press({
            id,
            fromStatus: read.status!,
            fromAiRunId: null,
            set: handOverTo(newRunId),
          }),
        ).resolves.toBe(1);
        await expect(
          press({
            id,
            fromStatus: AutoRemediationSuggestionStatus.Planning,
            fromAiRunId: newRunId,
            set: putBack(read),
          }),
        ).resolves.toBe(1);

        expect(await storedRound(id)).toEqual(before);
        expect(before.aiRunId).toBeNull();
      });

      test("a put-back from a run the fix no longer names changes nothing: the press that named it since keeps it", async () => {
        const oldRunId: ObjectID = ObjectID.generate();
        const id: ObjectID = await seedFix({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: oldRunId,
          commandPlan: COMMAND_PLAN,
          rationaleMarkdown: RATIONALE,
        });
        const read: AutoRemediationSuggestion = await readAsTryAgainDoes(id);
        const namedRunId: ObjectID = ObjectID.generate();
        const laterRunId: ObjectID = ObjectID.generate();

        await expect(
          press({
            id,
            fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
            fromAiRunId: oldRunId,
            set: handOverTo(namedRunId),
          }),
        ).resolves.toBe(1);

        // Meanwhile the fix was handed on again: a later press names its run.
        await database.query(
          `UPDATE "${schema}"."${TABLE}" SET "aiRunId" = $2 WHERE "_id" = $1`,
          [id.toString(), laterRunId.toString()],
        );

        await expect(
          press({
            id,
            fromStatus: AutoRemediationSuggestionStatus.Planning,
            fromAiRunId: namedRunId,
            set: putBack(read),
          }),
        ).resolves.toBe(0);

        expect(await storedRound(id)).toMatchObject({
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: laterRunId.toString(),
          commandPlan: null,
          rationaleMarkdown: null,
        });
      });
    });
  },
);
