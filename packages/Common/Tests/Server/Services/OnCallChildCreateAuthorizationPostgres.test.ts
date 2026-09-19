import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Project from "../../../Models/DatabaseModels/Project";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { Service as RuleService } from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import { Service as ScheduleService } from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import { Service as TeamService } from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import { Service as UserService } from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { DataSource } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_ON_CALL_AUTHORIZATION_TESTS=true and config.env.
 * All rows and writes belong to a unique schema containing structure-only
 * clones of the migrated tables. Real service hooks, permissions, relation
 * serialization and repository saves run; only post-create notifications and
 * realtime delivery are stubbed so the fixture never contacts actual users.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_ON_CALL_AUTHORIZATION_TESTS"] === "true"
    ? describe
    : describe.skip;

type ChildKind = "rule" | "user" | "team" | "schedule";
type ReferenceShape = "scalar" | "relation";

const childKinds: Array<ChildKind> = ["rule", "user", "team", "schedule"];
const createPermissions: Record<ChildKind, Permission> = {
  rule: Permission.CreateProjectOnCallDutyPolicyEscalationRule,
  user: Permission.CreateProjectOnCallDutyPolicyEscalationRuleUser,
  team: Permission.CreateProjectOnCallDutyPolicyEscalationRuleTeam,
  schedule: Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
};
const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const callerId: ObjectID = ObjectID.generate();
const targetUserId: ObjectID = ObjectID.generate();
const targetTeamId: ObjectID = ObjectID.generate();
const targetScheduleId: ObjectID = ObjectID.generate();
const developmentLabelId: ObjectID = ObjectID.generate();
const productionLabelId: ObjectID = ObjectID.generate();
const developmentPolicyId: ObjectID = ObjectID.generate();
const productionPolicyId: ObjectID = ObjectID.generate();
const otherProjectPolicyId: ObjectID = ObjectID.generate();
const deletedPolicyId: ObjectID = ObjectID.generate();
const unlabelledPolicyId: ObjectID = ObjectID.generate();
const developmentRuleId: ObjectID = ObjectID.generate();
const productionRuleId: ObjectID = ObjectID.generate();
const otherProjectRuleId: ObjectID = ObjectID.generate();
const deletedParentRuleId: ObjectID = ObjectID.generate();
const deletedRuleId: ObjectID = ObjectID.generate();
const unlabelledRuleId: ObjectID = ObjectID.generate();

function permissionRow(
  permission: Permission,
  overrides: Partial<UserPermission> = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    scope: PermissionScope.All,
    isBlockPermission: false,
    ...overrides,
  };
}

function permissionProps(
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  const permission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions,
  };
  return {
    tenantId: projectId,
    userId: callerId,
    userTenantAccessPermission: { [projectId.toString()]: permission },
  };
}

function memberProps(
  unrestricted: boolean = false,
): DatabaseCommonInteractionProps {
  return permissionProps([
    {
      _type: "UserPermission",
      permission: Permission.OnCallMember,
      labelIds: unrestricted ? [] : [developmentLabelId],
      isBlockPermission: false,
    },
  ]);
}

function policyReference(id: ObjectID): OnCallDutyPolicy {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = id;
  return policy;
}

function ruleReference(id: ObjectID): OnCallDutyPolicyEscalationRule {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = id;
  return rule;
}

describePostgres(
  "on-call child creation authorization against Postgres",
  () => {
    const schema: string = `on_call_create_auth_${ObjectID.generate().toString().replace(/-/g, "")}`;
    const services: Record<ChildKind, DatabaseService<BaseModel>> = {
      rule: new RuleService() as unknown as DatabaseService<BaseModel>,
      user: new UserService() as unknown as DatabaseService<BaseModel>,
      team: new TeamService() as unknown as DatabaseService<BaseModel>,
      schedule: new ScheduleService() as unknown as DatabaseService<BaseModel>,
    };
    const tables: Array<string> = [
      "Project",
      "User",
      "Team",
      "Label",
      "OnCallDutyPolicy",
      "OnCallDutyPolicyLabel",
      "OnCallDutyPolicySchedule",
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
          process.env["ON_CALL_AUTHORIZATION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["ON_CALL_AUTHORIZATION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database: process.env["DATABASE_NAME"] || "oneuptimedb",
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
      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      for (const service of Object.values(services)) {
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
              return item;
            },
          );
        jest.spyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
      }
    });

    beforeEach(async () => {
      /*
       * The fixtures contain only a handful of rows. DELETE avoids forcing a
       * filesystem synchronization for every cloned table before every case.
       */
      await database.query(
        tables
          .map((table: string): string => {
            return `DELETE FROM "${schema}"."${table}"`;
          })
          .join("; "),
      );
      for (const id of [projectId, otherProjectId]) {
        await database.query(
          `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Synthetic project', $2)`,
          [id.toString(), id.toString()],
        );
      }
      for (const id of [callerId, targetUserId]) {
        await database.query(
          `INSERT INTO "${schema}"."User" ("_id", "version", "email", "slug") VALUES ($1, 1, $2, $3)`,
          [id.toString(), `${id.toString()}@example.invalid`, id.toString()],
        );
      }
      for (const [table, id] of [
        ["Team", targetTeamId],
        ["OnCallDutyPolicySchedule", targetScheduleId],
      ] as const) {
        await database.query(
          `INSERT INTO "${schema}"."${table}" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, 'Synthetic target', $3)`,
          [id.toString(), projectId.toString(), id.toString()],
        );
      }
      for (const [id, name] of [
        [developmentLabelId, "Development"],
        [productionLabelId, "Production"],
      ] as const) {
        await database.query(
          `INSERT INTO "${schema}"."Label" ("_id", "version", "projectId", "name", "slug", "color") VALUES ($1, 1, $2, $3, $4, '#000000')`,
          [id.toString(), projectId.toString(), name, name],
        );
      }
      for (const [id, tenant, label, deleted] of [
        [developmentPolicyId, projectId, developmentLabelId, false],
        [productionPolicyId, projectId, productionLabelId, false],
        [otherProjectPolicyId, otherProjectId, developmentLabelId, false],
        [deletedPolicyId, projectId, developmentLabelId, true],
        [unlabelledPolicyId, projectId, null, false],
      ] as const) {
        await database.query(
          `INSERT INTO "${schema}"."OnCallDutyPolicy" ("_id", "version", "projectId", "name", "slug", "deletedAt") VALUES ($1, 1, $2, 'Synthetic policy', $4, $3)`,
          [
            id.toString(),
            tenant.toString(),
            deleted ? new Date() : null,
            id.toString(),
          ],
        );
        if (label) {
          await database.query(
            `INSERT INTO "${schema}"."OnCallDutyPolicyLabel" ("onCallDutyPolicyId", "labelId") VALUES ($1, $2)`,
            [id.toString(), label.toString()],
          );
        }
      }
      for (const [id, policy, tenant, deleted] of [
        [developmentRuleId, developmentPolicyId, projectId, false],
        [productionRuleId, productionPolicyId, projectId, false],
        [otherProjectRuleId, otherProjectPolicyId, otherProjectId, false],
        [deletedParentRuleId, deletedPolicyId, projectId, false],
        [deletedRuleId, developmentPolicyId, projectId, true],
        [unlabelledRuleId, unlabelledPolicyId, projectId, false],
      ] as const) {
        await database.query(
          `INSERT INTO "${schema}"."OnCallDutyPolicyEscalationRule" ("_id", "version", "projectId", "onCallDutyPolicyId", "name", "order", "deletedAt") VALUES ($1, 1, $2, $3, 'Existing rule', 1, $4)`,
          [
            id.toString(),
            tenant.toString(),
            policy.toString(),
            deleted ? new Date() : null,
          ],
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

    function child(
      kind: ChildKind,
      policy: ObjectID,
      rule: ObjectID,
      shape: ReferenceShape = "scalar",
    ): BaseModel {
      const data: BaseModel =
        kind === "rule"
          ? new OnCallDutyPolicyEscalationRule()
          : kind === "user"
            ? new OnCallDutyPolicyEscalationRuleUser()
            : kind === "team"
              ? new OnCallDutyPolicyEscalationRuleTeam()
              : new OnCallDutyPolicyEscalationRuleSchedule();
      if (shape === "relation") {
        const project: Project = new Project();
        project.id = projectId;
        data.setColumnValue("project", project);
        data.setColumnValue("onCallDutyPolicy", policyReference(policy));
        if (kind !== "rule") {
          data.setColumnValue(
            "onCallDutyPolicyEscalationRule",
            ruleReference(rule),
          );
        }
      } else {
        data.setColumnValue("projectId", projectId);
        data.setColumnValue("onCallDutyPolicyId", policy);
        if (kind !== "rule") {
          data.setColumnValue("onCallDutyPolicyEscalationRuleId", rule);
        }
      }
      if (kind === "rule") {
        data.setColumnValue("name", "Synthetic created rule");
        data.setColumnValue("order", 1);
      } else {
        const [column, id]: [string, ObjectID] =
          kind === "user"
            ? ["userId", targetUserId]
            : kind === "team"
              ? ["teamId", targetTeamId]
              : ["onCallDutyPolicyScheduleId", targetScheduleId];
        data.setColumnValue(column, id);
      }
      return data;
    }

    async function storedRows(kind: ChildKind): Promise<
      Array<{
        _id: string;
        onCallDutyPolicyId: string;
        projectId: string;
        order?: number;
      }>
    > {
      return await database.query(
        `SELECT * FROM "${schema}"."${services[kind].getModel().tableName}" ORDER BY "_id"`,
      );
    }

    async function expectDenied(
      kind: ChildKind,
      data: BaseModel,
      props: DatabaseCommonInteractionProps = memberProps(),
    ): Promise<void> {
      const before: unknown = await storedRows(kind);
      const rulesBefore: unknown = await storedRows("rule");
      await expect(services[kind].create({ data, props })).rejects.toThrow();
      expect(await storedRows(kind)).toEqual(before);
      // A denied create must not reorder existing rules in onBeforeCreate.
      expect(await storedRows("rule")).toEqual(rulesBefore);
    }

    describe.each(childKinds)("%s create", (kind: ChildKind) => {
      test.each(["scalar", "relation"] as const)(
        "rejects the reported hidden Production policy through %s references",
        async (shape: ReferenceShape) => {
          await expect(
            OnCallDutyPolicyService.findOneById({
              id: productionPolicyId,
              select: { _id: true },
              props: memberProps(),
            }),
          ).resolves.toBeNull();
          await expectDenied(
            kind,
            child(kind, productionPolicyId, productionRuleId, shape),
          );
        },
      );

      test.each(["scalar", "relation"] as const)(
        "persists a matching label through %s references",
        async (shape: ReferenceShape) => {
          await expect(
            OnCallDutyPolicyService.findOneById({
              id: developmentPolicyId,
              select: { _id: true },
              props: memberProps(),
            }),
          ).resolves.not.toBeNull();
          const result: BaseModel = await services[kind].create({
            data: child(kind, developmentPolicyId, developmentRuleId, shape),
            props: memberProps(),
          });
          const rows: Array<{ onCallDutyPolicyId: string; projectId: string }> =
            await database.query(
              `SELECT "onCallDutyPolicyId", "projectId" FROM "${schema}"."${services[kind].getModel().tableName}" WHERE "_id" = $1`,
              [result.id!.toString()],
            );
          expect(rows).toEqual([
            {
              onCallDutyPolicyId: developmentPolicyId.toString(),
              projectId: projectId.toString(),
            },
          ]);
        },
      );

      test("allows an unrestricted OnCallMember to create under Production", async () => {
        const result: BaseModel = await services[kind].create({
          data: child(kind, productionPolicyId, productionRuleId),
          props: memberProps(true),
        });
        expect(result.id).toBeDefined();
        expect(
          (await storedRows(kind)).some((row: { _id: string }): boolean => {
            return row._id === result.id!.toString();
          }),
        ).toBe(true);
      });

      test("a broad viewer grant does not widen a label-scoped create grant", async () => {
        const props: DatabaseCommonInteractionProps = permissionProps([
          permissionRow(Permission.OnCallViewer),
          permissionRow(Permission.OnCallMember, {
            scope: PermissionScope.Labels,
            labelIds: [developmentLabelId],
          }),
        ]);
        await expect(
          OnCallDutyPolicyService.findOneById({
            id: productionPolicyId,
            select: { _id: true },
            props,
          }),
        ).resolves.not.toBeNull();

        await expectDenied(
          kind,
          child(kind, productionPolicyId, productionRuleId),
          props,
        );

        const created: BaseModel = await services[kind].create({
          data: child(kind, developmentPolicyId, developmentRuleId),
          props,
        });
        expect(
          (await storedRows(kind)).find((row: { _id: string }): boolean => {
            return row._id === created.id!.toString();
          }),
        ).toMatchObject({
          projectId: projectId.toString(),
          onCallDutyPolicyId: developmentPolicyId.toString(),
        });
      });

      test("a viewer cannot create or reorder rules even under a readable policy", async () => {
        const props: DatabaseCommonInteractionProps = permissionProps([
          permissionRow(Permission.OnCallViewer),
        ]);
        await expect(
          OnCallDutyPolicyService.findOneById({
            id: developmentPolicyId,
            select: { _id: true },
            props,
          }),
        ).resolves.not.toBeNull();

        await expectDenied(
          kind,
          child(kind, developmentPolicyId, developmentRuleId),
          props,
        );
      });

      test("a supplied existing ID cannot replace a hidden child using an allowed policy", async () => {
        // Seed directly into the isolated schema, without service notifications.
        const hidden: BaseModel = await database
          .getRepository(services[kind].modelType)
          .save(child(kind, productionPolicyId, productionRuleId));
        const replacement: BaseModel = child(
          kind,
          developmentPolicyId,
          developmentRuleId,
        );
        replacement._id = hidden._id!;

        await expectDenied(kind, replacement);
        expect(
          (await storedRows(kind)).find((row: { _id: string }): boolean => {
            return row._id === hidden._id;
          }),
        ).toMatchObject({
          projectId: projectId.toString(),
          onCallDutyPolicyId: productionPolicyId.toString(),
        });
      });

      test("a label block on the granular create permission overrides an unrestricted create grant", async () => {
        const props: DatabaseCommonInteractionProps = permissionProps([
          permissionRow(Permission.OnCallViewer),
          permissionRow(createPermissions[kind]),
          permissionRow(createPermissions[kind], {
            scope: PermissionScope.Labels,
            labelIds: [productionLabelId],
            isBlockPermission: true,
          }),
        ]);
        await expect(
          OnCallDutyPolicyService.findOneById({
            id: productionPolicyId,
            select: { _id: true },
            props,
          }),
        ).resolves.not.toBeNull();

        await expectDenied(
          kind,
          child(kind, productionPolicyId, productionRuleId),
          props,
        );

        const created: BaseModel = await services[kind].create({
          data: child(kind, developmentPolicyId, developmentRuleId),
          props,
        });
        expect(
          (await storedRows(kind)).some((row: { _id: string }): boolean => {
            return row._id === created.id!.toString();
          }),
        ).toBe(true);
      });

      test.each(["user", "team"] as const)(
        "a broad viewer grant preserves creation restricted by %s ownership",
        async (ownerKind: "user" | "team") => {
          const table: string =
            ownerKind === "user"
              ? "OnCallDutyPolicyOwnerUser"
              : "OnCallDutyPolicyOwnerTeam";
          const ownerColumn: string =
            ownerKind === "user" ? "userId" : "teamId";
          const ownerId: ObjectID =
            ownerKind === "user" ? callerId : targetTeamId;
          await database.query(
            `INSERT INTO "${schema}"."${table}" ("_id", "version", "projectId", "onCallDutyPolicyId", "${ownerColumn}", "isOwnerNotified") VALUES ($1, 1, $2, $3, $4, false)`,
            [
              ObjectID.generate().toString(),
              projectId.toString(),
              developmentPolicyId.toString(),
              ownerId.toString(),
            ],
          );
          const props: DatabaseCommonInteractionProps = permissionProps([
            permissionRow(Permission.OnCallViewer),
            permissionRow(createPermissions[kind], {
              scope: PermissionScope.Owned,
            }),
          ]);
          if (ownerKind === "team") {
            props.userTeamIds = [targetTeamId];
          }
          await expect(
            OnCallDutyPolicyService.findOneById({
              id: productionPolicyId,
              select: { _id: true },
              props,
            }),
          ).resolves.not.toBeNull();

          await expectDenied(
            kind,
            child(kind, productionPolicyId, productionRuleId),
            props,
          );

          const created: BaseModel = await services[kind].create({
            data: child(kind, developmentPolicyId, developmentRuleId),
            props,
          });
          expect(
            (await storedRows(kind)).find((row: { _id: string }): boolean => {
              return row._id === created.id!.toString();
            }),
          ).toMatchObject({
            projectId: projectId.toString(),
            onCallDutyPolicyId: developmentPolicyId.toString(),
          });
        },
      );

      test("rejects a policy in another tenant even when its label matches", async () => {
        await expectDenied(
          kind,
          child(kind, otherProjectPolicyId, otherProjectRuleId),
        );
      });

      test("rejects a missing policy before any database mutation", async () => {
        await expectDenied(
          kind,
          child(kind, ObjectID.generate(), developmentRuleId),
        );
      });

      test("rejects a soft-deleted policy", async () => {
        await expectDenied(
          kind,
          child(kind, deletedPolicyId, deletedParentRuleId),
        );
      });

      test("rejects an unlabelled policy for a label-scoped member", async () => {
        await expectDenied(
          kind,
          child(kind, unlabelledPolicyId, unlabelledRuleId),
        );
      });

      test("rejects conflicting policy scalar and relation IDs", async () => {
        const data: BaseModel = child(
          kind,
          developmentPolicyId,
          developmentRuleId,
        );
        data.setColumnValue(
          "onCallDutyPolicy",
          policyReference(productionPolicyId),
        );
        await expectDenied(kind, data);
      });

      test("rejects a conflicting project relation instead of silently saving into it", async () => {
        const data: BaseModel = child(
          kind,
          developmentPolicyId,
          developmentRuleId,
        );
        const project: Project = new Project();
        project.id = otherProjectId;
        data.setColumnValue("project", project);
        await expectDenied(kind, data);
      });

      test("does not let ignoreHooks bypass parent authorization", async () => {
        await expectDenied(
          kind,
          child(kind, productionPolicyId, productionRuleId),
          { ...memberProps(), ignoreHooks: true },
        );
      });
    });

    describe.each(["user", "team", "schedule"] as const)(
      "%s assignment rule validation",
      (kind: ChildKind) => {
        test("rejects a rule belonging to a different policy in the same project", async () => {
          await expectDenied(
            kind,
            child(kind, developmentPolicyId, productionRuleId),
          );
        });

        test("rejects a rule in another tenant", async () => {
          await expectDenied(
            kind,
            child(kind, developmentPolicyId, otherProjectRuleId),
          );
        });

        test("rejects a missing rule", async () => {
          await expectDenied(
            kind,
            child(kind, developmentPolicyId, ObjectID.generate()),
          );
        });

        test("rejects a soft-deleted rule", async () => {
          await expectDenied(
            kind,
            child(kind, developmentPolicyId, deletedRuleId),
          );
        });

        test("rejects conflicting rule scalar and relation IDs", async () => {
          const data: BaseModel = child(
            kind,
            developmentPolicyId,
            developmentRuleId,
          );
          data.setColumnValue(
            "onCallDutyPolicyEscalationRule",
            ruleReference(productionRuleId),
          );
          await expectDenied(kind, data);
        });
      },
    );
  },
);
