import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { Service as ScheduleService } from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import { Service as TeamService } from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import { Service as UserService } from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  ESCALATION_RULE_SCHEDULE_INDEX,
  ESCALATION_RULE_TEAM_INDEX,
  ESCALATION_RULE_USER_INDEX,
} from "../../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";
import Permission, { UserTenantAccessPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A RESPONDER IS ON AN ESCALATION RULE ONCE (#10411), on a real Postgres.
 *
 * The people, teams and schedules an escalation rule pages are rows of their
 * own, and nothing stopped a second row of the same one: each told the
 * person again that they were added. The real services, permission checks,
 * hooks and repository saves run here, on copies of the migrated tables -
 * with the partial unique index each now has - and show:
 *
 *   - a second create of the same responder is refused, as the person and as
 *     an API key, in words naming the responder, the rule and its policy;
 *     one row stays, and its success hook - what tells the person they were
 *     added - ran once;
 *   - two creates at the same moment, both past the check before either
 *     writes, leave one row: the index refuses the other, in the same words;
 *   - a schedule is a responder once for each way the rule pages it, and a
 *     row deleted holds no place.
 *
 * Opt in with RUN_POSTGRES_ESCALATION_RULE_RESPONDER_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. Every row is synthetic,
 * in a schema of its own with structure-only copies of the tables, dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from ESCALATION_RULE_RESPONDER_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from ESCALATION_RULE_RESPONDER_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400). Only the success hooks' notifications and
 * realtime delivery are stubbed, so nobody is told anything.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_ESCALATION_RULE_RESPONDER_TESTS"] === "true"
    ? describe
    : describe.skip;

const projectId: ObjectID = ObjectID.generate();
const callerId: ObjectID = ObjectID.generate();
const anaId: ObjectID = ObjectID.generate();
const teamId: ObjectID = ObjectID.generate();
const scheduleId: ObjectID = ObjectID.generate();
const policyId: ObjectID = ObjectID.generate();
const ruleId: ObjectID = ObjectID.generate();
const otherRuleId: ObjectID = ObjectID.generate();

type Kind = "user" | "team" | "schedule";

interface KindFixture {
  kind: Kind;
  table: string;
  index: string;
  column: string;
  responderId: ObjectID;
  refusal: string;
}

const RULE_WORDS: string =
  'The escalation rule "Level 1" of the on-call policy "Payments on-call"';

const KINDS: Array<KindFixture> = [
  {
    kind: "user",
    table: "OnCallDutyPolicyEscalationRuleUser",
    index: ESCALATION_RULE_USER_INDEX,
    column: "userId",
    responderId: anaId,
    refusal: `${RULE_WORDS} pages Ana Lopez already, so they were not added again.`,
  },
  {
    kind: "team",
    table: "OnCallDutyPolicyEscalationRuleTeam",
    index: ESCALATION_RULE_TEAM_INDEX,
    column: "teamId",
    responderId: teamId,
    refusal: `${RULE_WORDS} pages the team "Platform" already, so it was not added again.`,
  },
  {
    kind: "schedule",
    table: "OnCallDutyPolicyEscalationRuleSchedule",
    index: ESCALATION_RULE_SCHEDULE_INDEX,
    column: "onCallDutyPolicyScheduleId",
    responderId: scheduleId,
    refusal: `${RULE_WORDS} pages whoever is on call in the on-call schedule "Primary" already, so the schedule was not added again.`,
  },
];

function tenantPermission(): UserTenantAccessPermission {
  return {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.OnCallMember,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
}

// A member of the project who may add people to its on-call policies.
function asPerson(): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: callerId,
    userType: UserType.User,
    userTenantAccessPermission: { [projectId.toString()]: tenantPermission() },
  };
}

// The project's API key, with the same permission: no person on the request.
function asApiKey(): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userType: UserType.API,
    userTenantAccessPermission: { [projectId.toString()]: tenantPermission() },
  };
}

describePostgres(
  "a responder is on an escalation rule once, against Postgres",
  () => {
    const schema: string = `rule_responder_once_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const services: Record<Kind, DatabaseService<BaseModel>> = {
      user: new UserService() as unknown as DatabaseService<BaseModel>,
      team: new TeamService() as unknown as DatabaseService<BaseModel>,
      schedule: new ScheduleService() as unknown as DatabaseService<BaseModel>,
    };
    // How many rows of each kind its success hook was handed: who is told.
    const told: Record<Kind, number> = { user: 0, team: 0, schedule: 0 };
    const tables: Array<string> = [
      // Which products the server has switched off: none.
      "GlobalConfig",
      "Project",
      "User",
      "Team",
      "TeamMember",
      "Label",
      "OnCallDutyPolicy",
      "OnCallDutyPolicyLabel",
      "OnCallDutyPolicySchedule",
      "OnCallDutyPolicyScheduleLabel",
      "OnCallDutyPolicyOwnerUser",
      "OnCallDutyPolicyOwnerTeam",
      "OnCallDutyPolicyEscalationRule",
      "OnCallDutyPolicyEscalationRuleUser",
      "OnCallDutyPolicyEscalationRuleTeam",
      "OnCallDutyPolicyEscalationRuleSchedule",
    ];
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["ESCALATION_RULE_RESPONDER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["ESCALATION_RULE_RESPONDER_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["ESCALATION_RULE_RESPONDER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      /*
       * The migrated tables carry their unique index, and so do the copies -
       * under a name Postgres makes up for a copy, so each is given the
       * index's own name back: the services tell its refusal by that name.
       */
      for (const fixture of KINDS) {
        const migrated: Array<{ indexdef: string }> = await database.query(
          `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
          [fixture.index],
        );
        expect(migrated).toHaveLength(1);
        expect(migrated[0]!.indexdef).toContain("CREATE UNIQUE INDEX");
        expect(migrated[0]!.indexdef).toContain(`WHERE ("deletedAt" IS NULL)`);

        const copied: Array<{ indexname: string }> = await database.query(
          `SELECT indexname FROM pg_indexes
            WHERE schemaname = $1 AND tablename = $2
              AND indexdef LIKE 'CREATE UNIQUE INDEX%'
              AND indexdef LIKE '%WHERE ("deletedAt" IS NULL)'`,
          [schema, fixture.table],
        );
        expect(copied).toHaveLength(1);
        await database.query(
          `ALTER INDEX "${schema}"."${copied[0]!.indexname}" RENAME TO "${fixture.index}"`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const kind of Object.keys(services) as Array<Kind>) {
        const service: DatabaseService<BaseModel> = services[kind];
        const postCreate: {
          onCreateSuccess: (
            onCreate: OnCreate<BaseModel>,
            item: BaseModel,
          ) => Promise<BaseModel>;
        } = service as unknown as {
          onCreateSuccess: (
            onCreate: OnCreate<BaseModel>,
            item: BaseModel,
          ) => Promise<BaseModel>;
        };
        jest
          .spyOn(postCreate, "onCreateSuccess")
          .mockImplementation(
            async (
              _onCreate: OnCreate<BaseModel>,
              item: BaseModel,
            ): Promise<BaseModel> => {
              told[kind]++;
              return item;
            },
          );
        jest.spyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
      }
    });

    beforeEach(async () => {
      told.user = 0;
      told.team = 0;
      told.schedule = 0;

      await database.query(
        tables
          .map((table: string): string => {
            return `DELETE FROM "${schema}"."${table}"`;
          })
          .join("; "),
      );
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Synthetic project', $2)`,
        [projectId.toString(), projectId.toString()],
      );
      await database.query(
        `INSERT INTO "${schema}"."User" ("_id", "version", "email", "name", "slug") VALUES ($1, 1, $2, $3, $4)`,
        [
          anaId.toString(),
          `${anaId.toString()}@example.invalid`,
          "Ana Lopez",
          anaId.toString(),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."User" ("_id", "version", "email", "slug") VALUES ($1, 1, $2, $3)`,
        [
          callerId.toString(),
          `${callerId.toString()}@example.invalid`,
          callerId.toString(),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Team" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, 'Platform', $3)`,
        [teamId.toString(), projectId.toString(), teamId.toString()],
      );
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicySchedule" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, 'Primary', $3)`,
        [scheduleId.toString(), projectId.toString(), scheduleId.toString()],
      );
      // Ana and the caller are members of the project, in its team.
      for (const userId of [anaId, callerId]) {
        await database.query(
          `INSERT INTO "${schema}"."TeamMember" ("version", "projectId", "teamId", "userId", "hasAcceptedInvitation") VALUES (1, $1, $2, $3, true)`,
          [projectId.toString(), teamId.toString(), userId.toString()],
        );
      }
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicy" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, 'Payments on-call', $3)`,
        [policyId.toString(), projectId.toString(), policyId.toString()],
      );
      for (const [id, name, order] of [
        [ruleId, "Level 1", 1],
        [otherRuleId, "Level 2", 2],
      ] as const) {
        await database.query(
          `INSERT INTO "${schema}"."OnCallDutyPolicyEscalationRule" ("_id", "version", "projectId", "onCallDutyPolicyId", "name", "order") VALUES ($1, 1, $2, $3, $4, $5)`,
          [id.toString(), projectId.toString(), policyId.toString(), name, order],
        );
      }
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    // A row naming the responder on a rule of the policy.
    function responderRow(
      fixture: KindFixture,
      onRuleId: ObjectID = ruleId,
      fields: Record<string, unknown> = {},
    ): BaseModel {
      const data: BaseModel =
        fixture.kind === "user"
          ? new OnCallDutyPolicyEscalationRuleUser()
          : fixture.kind === "team"
            ? new OnCallDutyPolicyEscalationRuleTeam()
            : new OnCallDutyPolicyEscalationRuleSchedule();

      data.setColumnValue("projectId", projectId);
      data.setColumnValue("onCallDutyPolicyId", policyId);
      data.setColumnValue("onCallDutyPolicyEscalationRuleId", onRuleId);
      data.setColumnValue(fixture.column, fixture.responderId);

      for (const [column, value] of Object.entries(fields)) {
        data.setColumnValue(column, value as never);
      }

      return data;
    }

    // The rows of the rule, of the responder, deleted or not.
    async function rowsOf(
      fixture: KindFixture,
      onRuleId: ObjectID = ruleId,
    ): Promise<Array<{ _id: string; deleted: boolean }>> {
      return await database.query(
        `SELECT "_id", "deletedAt" IS NOT NULL AS "deleted" FROM "${schema}"."${fixture.table}"
          WHERE "onCallDutyPolicyEscalationRuleId" = $1 AND "${fixture.column}" = $2
          ORDER BY "createdAt"`,
        [onRuleId.toString(), fixture.responderId.toString()],
      );
    }

    async function refusalOf(
      promise: Promise<unknown>,
    ): Promise<Error | undefined> {
      try {
        await promise;
        return undefined;
      } catch (error) {
        return error as Error;
      }
    }

    describe.each(KINDS)("$kind", (fixture: KindFixture) => {
      test.each([
        ["the person", asPerson],
        ["an API key", asApiKey],
      ])(
        "a second create of the same responder, as %s, is refused in words naming it and the rule; one row stays, told once",
        async (_caller: string, props: () => DatabaseCommonInteractionProps) => {
          const first: BaseModel = await services[fixture.kind].create({
            data: responderRow(fixture),
            props: props(),
          });
          expect(first.id).toBeDefined();

          const refused: Error | undefined = await refusalOf(
            services[fixture.kind].create({
              data: responderRow(fixture),
              props: props(),
            }),
          );

          expect(refused).toBeInstanceOf(BadDataException);
          expect(refused?.message).toBe(fixture.refusal);
          expect(
            PostgresErrorTranslator.isUniqueViolationOf(refused, fixture.index),
          ).toBe(true);

          expect(await rowsOf(fixture)).toEqual([
            { _id: first.id!.toString(), deleted: false },
          ]);
          // The success hook - who is told they were added - ran for the first alone.
          expect(told[fixture.kind]).toBe(1);
        },
      );

      test("named by its relations, the second is refused the same way", async () => {
        await services[fixture.kind].create({
          data: responderRow(fixture),
          props: asPerson(),
        });

        const byRelations: BaseModel = responderRow(fixture);
        byRelations.setColumnValue("onCallDutyPolicyEscalationRuleId", undefined as never);
        byRelations.setColumnValue(fixture.column, undefined as never);
        byRelations.setColumnValue("onCallDutyPolicyEscalationRule", {
          _id: ruleId.toString(),
        } as never);
        byRelations.setColumnValue(
          fixture.column.replace(/Id$/, ""),
          { _id: fixture.responderId.toString() } as never,
        );

        await expect(
          services[fixture.kind].create({
            data: byRelations,
            props: asPerson(),
          }),
        ).rejects.toThrow(fixture.refusal);
        expect(await rowsOf(fixture)).toHaveLength(1);
      });

      test("two creates at the same moment, both past the check before either writes, leave one row", async () => {
        const service: DatabaseService<BaseModel> = services[fixture.kind];
        const check: (createBy: CreateBy<BaseModel>) => Promise<void> = (
          service as unknown as {
            onBeforeCreateUniqueCheck: (
              createBy: CreateBy<BaseModel>,
            ) => Promise<void>;
          }
        ).onBeforeCreateUniqueCheck.bind(service);

        // Each waits, once its own check found nothing, for the other's.
        let checked: number = 0;
        let release: () => void = (): void => {};
        const bothChecked: Promise<void> = new Promise<void>(
          (resolve: () => void) => {
            release = resolve;
          },
        );
        const barrier: jest.SpiedFunction<
          (createBy: CreateBy<BaseModel>) => Promise<void>
        > = jest
          .spyOn(
            service as unknown as {
              onBeforeCreateUniqueCheck: (
                createBy: CreateBy<BaseModel>,
              ) => Promise<void>;
            },
            "onBeforeCreateUniqueCheck",
          )
          .mockImplementation(
            async (createBy: CreateBy<BaseModel>): Promise<void> => {
              await check(createBy);
              checked++;
              if (checked === 2) {
                release();
              }
              await bothChecked;
            },
          );

        try {
          const results: Array<PromiseSettledResult<BaseModel>> =
            await Promise.allSettled([
              service.create({
                data: responderRow(fixture),
                props: asPerson(),
              }),
              service.create({
                data: responderRow(fixture),
                props: asApiKey(),
              }),
            ]);

          expect(checked).toBe(2);

          const kept: Array<PromiseFulfilledResult<BaseModel>> =
            results.filter(
              (
                result: PromiseSettledResult<BaseModel>,
              ): result is PromiseFulfilledResult<BaseModel> => {
                return result.status === "fulfilled";
              },
            );
          const refused: Array<PromiseRejectedResult> = results.filter(
            (
              result: PromiseSettledResult<BaseModel>,
            ): result is PromiseRejectedResult => {
              return result.status === "rejected";
            },
          );

          expect(kept).toHaveLength(1);
          expect(refused).toHaveLength(1);
          // The index refused the second, worded as the check words it.
          expect((refused[0]!.reason as Error).message).toBe(fixture.refusal);
          expect(
            PostgresErrorTranslator.isUniqueViolationOf(
              refused[0]!.reason,
              fixture.index,
            ),
          ).toBe(true);

          expect(await rowsOf(fixture)).toEqual([
            { _id: kept[0]!.value.id!.toString(), deleted: false },
          ]);
          expect(told[fixture.kind]).toBe(1);
        } finally {
          barrier.mockRestore();
        }
      });

      test("the same responder on another rule is another responder", async () => {
        await services[fixture.kind].create({
          data: responderRow(fixture),
          props: asPerson(),
        });
        await services[fixture.kind].create({
          data: responderRow(fixture, otherRuleId),
          props: asPerson(),
        });

        expect(await rowsOf(fixture)).toHaveLength(1);
        expect(await rowsOf(fixture, otherRuleId)).toHaveLength(1);
        expect(told[fixture.kind]).toBe(2);
      });

      test("a row deleted holds no place: the responder is added again", async () => {
        // A copy the migration soft-deleted, made a day before.
        await database.query(
          `INSERT INTO "${schema}"."${fixture.table}" ("_id", "version", "projectId", "onCallDutyPolicyId", "onCallDutyPolicyEscalationRuleId", "${fixture.column}", "createdAt", "deletedAt")
           VALUES ($1, 1, $2, $3, $4, $5, now() - interval '1 day', now())`,
          [
            ObjectID.generate().toString(),
            projectId.toString(),
            policyId.toString(),
            ruleId.toString(),
            fixture.responderId.toString(),
          ],
        );

        await services[fixture.kind].create({
          data: responderRow(fixture),
          props: asPerson(),
        });

        expect(
          (await rowsOf(fixture)).map((row: { deleted: boolean }) => {
            return row.deleted;
          }),
        ).toEqual([true, false]);
      });

      test("the rule reads the responder once, as a level reads it before it pages", async () => {
        await services[fixture.kind].create({
          data: responderRow(fixture),
          props: asPerson(),
        });
        await refusalOf(
          services[fixture.kind].create({
            data: responderRow(fixture),
            props: asApiKey(),
          }),
        );

        const read: Array<BaseModel> = await services[fixture.kind].findBy({
          query: { onCallDutyPolicyEscalationRuleId: ruleId },
          select: { [fixture.column]: true } as never,
          props: { isRoot: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

        expect(read).toHaveLength(1);
      });
    });

    describe("a schedule, once for each way the rule pages it", () => {
      const schedule: KindFixture = KINDS[2]!;

      test("whoever is on call and the next in its rotation are two rows of one rule; a second of either is refused", async () => {
        await services.schedule.create({
          data: responderRow(schedule),
          props: asPerson(),
        });
        await services.schedule.create({
          data: responderRow(schedule, ruleId, { pageNextInRotation: true }),
          props: asPerson(),
        });

        await expect(
          services.schedule.create({
            data: responderRow(schedule, ruleId, { pageNextInRotation: true }),
            props: asApiKey(),
          }),
        ).rejects.toThrow(
          `${RULE_WORDS} pages the next person in the rotation of the on-call schedule "Primary" already, so the schedule was not added again.`,
        );

        const rows: Array<{ pageNextInRotation: boolean }> =
          await database.query(
            `SELECT "pageNextInRotation" FROM "${schema}"."${schedule.table}"
              WHERE "onCallDutyPolicyEscalationRuleId" = $1 ORDER BY "createdAt"`,
            [ruleId.toString()],
          );
        expect(
          rows.map((row: { pageNextInRotation: boolean }) => {
            return row.pageNextInRotation;
          }),
        ).toEqual([false, true]);
        expect(told.schedule).toBe(2);
      });
    });

    describe("the index holds without the service", () => {
      test.each(KINDS)(
        "$kind: a second row written past every hook is refused by Postgres",
        async (fixture: KindFixture) => {
          const repository: ReturnType<DataSource["getRepository"]> =
            database.getRepository(services[fixture.kind].modelType);

          await repository.save(responderRow(fixture));

          const refused: Error | undefined = await refusalOf(
            repository.save(responderRow(fixture)),
          );

          expect(
            PostgresErrorTranslator.isUniqueViolationOf(refused, fixture.index),
          ).toBe(true);
          expect(await rowsOf(fixture)).toHaveLength(1);
        },
      );

      test("a create with its hooks skipped is refused by the index, in the service's words", async () => {
        await services.user.create({
          data: responderRow(KINDS[0]!),
          props: asPerson(),
        });

        await expect(
          services.user.create({
            data: responderRow(KINDS[0]!),
            props: { isRoot: true, ignoreHooks: true },
          }),
        ).rejects.toThrow(KINDS[0]!.refusal);
        expect(await rowsOf(KINDS[0]!)).toHaveLength(1);
      });
    });
  },
);
