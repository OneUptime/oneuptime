import { AddKubernetesAiAgentAndAiDefaults1796000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796000000000-AddKubernetesAiAgentAndAiDefaults";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import KubernetesAiAgent from "../../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Project from "../../../../Models/DatabaseModels/Project";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The Kubernetes AI agent's schema, and the migration that turns AI on by
 * default without turning anything on that an operator switched off.
 *
 * Pinned here, each a silent regression if it moves on its own:
 *
 *  1. REGISTRATION. The migration is registered once, last, with a
 *     timestamp above everything before it, and its class name matches its
 *     file.
 *  2. THE SCHEMA IS THE ENTITIES'. The new table, RunnerJob's new target
 *     column and Project's new postmortem flag are created exactly as the
 *     models declare them, with TypeORM's own index and foreign key names
 *     (a mismatch is a green deploy and a red Schema Drift job).
 *  3. THE DEFAULT AND THE ENTITY AGREE. KubernetesCluster
 *     .isAiInvestigationEnabled defaults to true in the model and in this
 *     migration's SET DEFAULT; the drift job does not reliably catch a
 *     DEFAULT that disagrees.
 *  4. EVERY BACKFILL IS SCOPED, word for word. Widening one would switch AI
 *     on for a cluster whose operator switched it off, or start unattended
 *     kubectl writes in a project that never opted in.
 *  5. down() REVERSES THE SCHEMA AND THE DEFAULT, NOT THE DATA. Rows the
 *     backfills moved are indistinguishable from later operator choices.
 *
 * Fake QueryRunner only.
 */

const OWN_CLASS_NAME: string = "AddKubernetesAiAgentAndAiDefaults1796000000000";

// The last migration registered before this one.
const REGISTERED_BEFORE_IT: string =
  "AddSubscriberNotificationClaimedAt1795900000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796000000000-AddKubernetesAiAgentAndAiDefaults.ts",
);

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddKubernetesAiAgentAndAiDefaults1796000000000()[direction](
    queryRunner,
  );

  return statements;
}

function isUpdate(statement: string): boolean {
  return statement.startsWith("UPDATE ");
}

function declaredColumn(
  model: { new (): unknown; name: string },
  property: string,
): ColumnMetadataArgs {
  const declared: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return column.target === model && column.propertyName === property;
      },
    );

  if (!declared) {
    throw new Error(`${model.name} declares no column ${property}`);
  }

  return declared;
}

function declaredRelation(
  model: { new (): unknown; name: string },
  property: string,
): RelationMetadataArgs {
  const declared: RelationMetadataArgs | undefined =
    getMetadataArgsStorage().relations.find(
      (relation: RelationMetadataArgs): boolean => {
        return relation.target === model && relation.propertyName === property;
      },
    );

  if (!declared) {
    throw new Error(`${model.name} declares no relation ${property}`);
  }

  return declared;
}

// The hand-added data statements, exactly, in the order they must run.
const POSTMORTEM_BACKFILL: string = `UPDATE "Project" SET "enableAutomaticPostmortemDraft" = true WHERE "enableAutomaticIncidentInvestigation" = true`;

const NEVER_CONFIGURED_CLUSTERS_INVESTIGATE: string = `UPDATE "KubernetesCluster" SET "isAiInvestigationEnabled" = true WHERE "aiAccessConfiguredAt" IS NULL`;

const REVOCATIONS_CARRY_OVER: string = `UPDATE "KubernetesCluster" SET "isAiInvestigationEnabled" = false, "aiRemediationMode" = 'Disabled' WHERE "aiAccessRunnerId" IS NULL AND ("aiAccessRunnerBoundAt" IS NOT NULL OR "aiAccessLastVerifiedAt" IS NOT NULL OR "aiAccessLastError" IS NOT NULL)`;

const NO_UNATTENDED_SURPRISE: string = `UPDATE "KubernetesCluster" c SET "aiRemediationMode" = 'RequireApproval' FROM "Project" p WHERE c."projectId" = p."_id" AND p."enableAiCommandExecution" IS NOT TRUE AND c."aiRemediationMode" IN ('Automatic','BypassApproval')`;

describe("AddKubernetesAiAgentAndAiDefaults migration - identity and registration", () => {
  test("its class name and name carry its stamp, matching its file", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddKubernetesAiAgentAndAiDefaults1796000000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered exactly once", () => {
    expect(SchemaMigrations).toContain(
      AddKubernetesAiAgentAndAiDefaults1796000000000,
    );
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);
  });

  test("sorts after every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    expect(ownIndex).toBeGreaterThan(
      registeredNames.indexOf(REGISTERED_BEFORE_IT),
    );
    expect(
      registeredNames.slice(0, ownIndex).filter((className: string) => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);
  });
});

describe("AddKubernetesAiAgentAndAiDefaults migration - the KubernetesAiAgent table", () => {
  const ownColumns: Array<ColumnMetadataArgs> =
    getMetadataArgsStorage().columns.filter(
      (column: ColumnMetadataArgs): boolean => {
        return column.target === KubernetesAiAgent;
      },
    );

  test("the model declares the columns the design names", () => {
    expect(
      ownColumns
        .map((column: ColumnMetadataArgs): string => {
          return column.propertyName;
        })
        .sort(),
    ).toEqual(
      [
        "projectId",
        "kubernetesClusterId",
        "keyHash",
        "agentVersion",
        "posture",
        "lastAliveAt",
        "connectionStatus",
        "lastRegisteredAt",
        "registeredWithIngestionKeyId",
        "lastRefusedRegistrationAt",
        "lastRefusedRegistrationReason",
      ].sort(),
    );
  });

  test.each([
    ["projectId", `"projectId" uuid NOT NULL`],
    ["kubernetesClusterId", `"kubernetesClusterId" uuid NOT NULL`],
    ["keyHash", `"keyHash" character varying(100),`],
    ["agentVersion", `"agentVersion" character varying(100),`],
    ["posture", `"posture" jsonb,`],
    ["lastAliveAt", `"lastAliveAt" TIMESTAMP WITH TIME ZONE,`],
    [
      "connectionStatus",
      `"connectionStatus" character varying(100) NOT NULL DEFAULT 'disconnected'`,
    ],
    ["lastRegisteredAt", `"lastRegisteredAt" TIMESTAMP WITH TIME ZONE,`],
    ["registeredWithIngestionKeyId", `"registeredWithIngestionKeyId" uuid,`],
    [
      "lastRefusedRegistrationAt",
      `"lastRefusedRegistrationAt" TIMESTAMP WITH TIME ZONE,`,
    ],
    [
      "lastRefusedRegistrationReason",
      `"lastRefusedRegistrationReason" character varying(100),`,
    ],
  ])(
    "creates %s as the model declares it",
    async (property: string, ddl: string) => {
      const declared: ColumnMetadataArgs = declaredColumn(
        KubernetesAiAgent,
        property,
      );
      const createTable: string | undefined = (await recordQueries("up")).find(
        (statement: string): boolean => {
          return statement.startsWith(`CREATE TABLE "KubernetesAiAgent"`);
        },
      );

      expect(createTable).toBeDefined();
      expect(createTable).toContain(ddl);

      if (declared.options.nullable === false) {
        expect(ddl).toContain("NOT NULL");
      } else {
        expect(ddl).not.toContain("NOT NULL");
      }

      if (declared.options.default !== undefined) {
        expect(ddl).toContain(`DEFAULT '${String(declared.options.default)}'`);
      } else {
        expect(ddl).not.toContain("DEFAULT");
      }
    },
  );

  test("enforces one agent per cluster with the unique index the model names", async () => {
    expect(await recordQueries("up")).toContain(
      `CREATE UNIQUE INDEX "IDX_KubernetesAiAgent_kubernetesClusterId" ON "KubernetesAiAgent" ("kubernetesClusterId") WHERE "deletedAt" IS NULL`,
    );
  });

  test("indexes projectId under TypeORM's name", async () => {
    expect(await recordQueries("up")).toContain(
      `CREATE INDEX "${namingStrategy.indexName("KubernetesAiAgent", [
        "projectId",
      ])}" ON "KubernetesAiAgent" ("projectId") `,
    );
  });

  test.each([
    ["project", "projectId", "Project", Project],
    [
      "kubernetesCluster",
      "kubernetesClusterId",
      "KubernetesCluster",
      KubernetesCluster,
    ],
  ])(
    "KubernetesAiAgent.%s goes when its %s row goes (ON DELETE CASCADE)",
    async (
      relation: string,
      column: string,
      referencedTable: string,
      referencedModel: unknown,
    ) => {
      const declared: RelationMetadataArgs = declaredRelation(
        KubernetesAiAgent,
        relation,
      );

      expect(declared.relationType).toBe("many-to-one");
      expect(declared.options.onDelete).toBe("CASCADE");
      expect((declared.type as () => unknown)()).toBe(referencedModel);

      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "KubernetesAiAgent" ADD CONSTRAINT "${namingStrategy.foreignKeyName(
          "KubernetesAiAgent",
          [column],
        )}" FOREIGN KEY ("${column}") REFERENCES "${referencedTable}"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    },
  );
});

describe("AddKubernetesAiAgentAndAiDefaults migration - RunnerJob.targetKubernetesAiAgentId", () => {
  test("adds the nullable uuid column the model declares", async () => {
    const declared: ColumnMetadataArgs = declaredColumn(
      RunnerJob,
      "targetKubernetesAiAgentId",
    );

    expect(declared.options.nullable).toBe(true);
    expect(await recordQueries("up")).toContain(
      `ALTER TABLE "RunnerJob" ADD "targetKubernetesAiAgentId" uuid`,
    );
  });

  test("indexes it under TypeORM's name, for the agent's claim query", async () => {
    expect(await recordQueries("up")).toContain(
      `CREATE INDEX "${namingStrategy.indexName("RunnerJob", [
        "targetKubernetesAiAgentId",
      ])}" ON "RunnerJob" ("targetKubernetesAiAgentId") `,
    );
  });

  test("references KubernetesAiAgent and is nulled, never cascaded, when the agent row goes", async () => {
    const declared: RelationMetadataArgs = declaredRelation(
      RunnerJob,
      "targetKubernetesAiAgent",
    );

    expect(declared.relationType).toBe("many-to-one");
    expect(declared.options.onDelete).toBe("SET NULL");
    expect((declared.type as () => unknown)()).toBe(KubernetesAiAgent);

    expect(await recordQueries("up")).toContain(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "${namingStrategy.foreignKeyName(
        "RunnerJob",
        ["targetKubernetesAiAgentId"],
      )}" FOREIGN KEY ("targetKubernetesAiAgentId") REFERENCES "KubernetesAiAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  });
});

describe("AddKubernetesAiAgentAndAiDefaults migration - defaults", () => {
  test("isAiInvestigationEnabled defaults to true, in the entity and in the database", async () => {
    const declared: ColumnMetadataArgs = declaredColumn(
      KubernetesCluster,
      "isAiInvestigationEnabled",
    );

    expect(declared.options.default).toBe(true);
    expect(
      new KubernetesCluster().getTableColumnMetadata("isAiInvestigationEnabled")
        .defaultValue,
    ).toBe(true);
    expect(await recordQueries("up")).toContain(
      `ALTER TABLE "KubernetesCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT ${String(
        declared.options.default,
      )}`,
    );
  });

  test("adds Project.enableAutomaticPostmortemDraft as the model declares it: NOT NULL, default off", async () => {
    const declared: ColumnMetadataArgs = declaredColumn(
      Project,
      "enableAutomaticPostmortemDraft",
    );

    expect(declared.options.nullable).toBe(false);
    expect(declared.options.default).toBe(false);
    expect(
      new Project().getTableColumnMetadata("enableAutomaticPostmortemDraft")
        .defaultValue,
    ).toBe(false);
    expect(await recordQueries("up")).toContain(
      `ALTER TABLE "Project" ADD "enableAutomaticPostmortemDraft" boolean NOT NULL DEFAULT false`,
    );
  });

  test("the postmortem flag carries the same access rules as the investigation flag it was split from", () => {
    const project: Project = new Project();
    const postmortem: ColumnAccessControl | null =
      project.getColumnAccessControlFor("enableAutomaticPostmortemDraft");
    const investigation: ColumnAccessControl | null =
      project.getColumnAccessControlFor("enableAutomaticIncidentInvestigation");

    expect(postmortem).not.toBeNull();
    expect(postmortem).toEqual(investigation);
  });

  /*
   * The project opt-ins are switched on for NEW projects by ProjectService,
   * never by a column default: a default would be emitted as the generated
   * Terraform provider's static default and flip existing Terraform-managed
   * projects on their next apply, and a backfill would start spending
   * existing projects' AI budget.
   */
  test.each([
    "enableAutomaticIncidentInvestigation",
    "enableAutomaticAlertInvestigation",
  ])(
    "leaves Project.%s's default off and every existing project as it was",
    async (property: string) => {
      const declared: ColumnMetadataArgs = declaredColumn(Project, property);

      expect(declared.options.default).toBe(false);
      expect(new Project().getTableColumnMetadata(property).defaultValue).toBe(
        false,
      );

      for (const statement of await recordQueries("up")) {
        expect(statement).not.toMatch(
          new RegExp(`SET "${property}"|"${property}" SET DEFAULT`),
        );
      }
    },
  );
});

describe("AddKubernetesAiAgentAndAiDefaults migration - the backfills", () => {
  test("runs exactly four hand-added UPDATEs, in order, after every schema change", async () => {
    const up: Array<string> = await recordQueries("up");
    const updates: Array<string> = up.filter(isUpdate);

    expect(updates).toEqual([
      POSTMORTEM_BACKFILL,
      NEVER_CONFIGURED_CLUSTERS_INVESTIGATE,
      REVOCATIONS_CARRY_OVER,
      NO_UNATTENDED_SURPRISE,
    ]);

    const firstUpdate: number = up.findIndex(isUpdate);

    expect(up.slice(firstUpdate).every(isUpdate)).toBe(true);
  });

  /*
   * Postmortem drafting used to ride on the investigation flag. The new
   * column was just added as NOT NULL DEFAULT false, so setting it to true
   * where investigation is on is the complete copy — and it rewrites only
   * the projects that had the behaviour.
   */
  test("postmortem drafts stay on exactly where investigations were on", async () => {
    const where: string = POSTMORTEM_BACKFILL.slice(
      POSTMORTEM_BACKFILL.indexOf(" WHERE "),
    );

    expect(POSTMORTEM_BACKFILL).toContain(
      `SET "enableAutomaticPostmortemDraft" = true`,
    );
    expect(where).toBe(` WHERE "enableAutomaticIncidentInvestigation" = true`);
  });

  test("investigation is turned on only for clusters nobody ever configured", () => {
    expect(NEVER_CONFIGURED_CLUSTERS_INVESTIGATE).toContain(
      `SET "isAiInvestigationEnabled" = true`,
    );
    expect(
      NEVER_CONFIGURED_CLUSTERS_INVESTIGATE.slice(
        NEVER_CONFIGURED_CLUSTERS_INVESTIGATE.indexOf(" WHERE "),
      ),
    ).toBe(` WHERE "aiAccessConfiguredAt" IS NULL`);
    expect(NEVER_CONFIGURED_CLUSTERS_INVESTIGATE).not.toContain(
      "aiRemediationMode",
    );
  });

  /*
   * Before the AI agent, unbinding or deleting the cluster's Runner WAS the
   * off switch. Such a cluster has no Runner now but had one bound, or AI
   * already ran (or tried to run) kubectl on it. It must stay off — and it
   * runs AFTER the never-configured backfill, so the revocation wins even
   * for a cluster that also has no configured marker.
   */
  test("a cluster whose Runner was unbound or deleted is switched fully off, after the default backfill", async () => {
    expect(REVOCATIONS_CARRY_OVER).toContain(
      `SET "isAiInvestigationEnabled" = false, "aiRemediationMode" = 'Disabled'`,
    );

    const where: string = REVOCATIONS_CARRY_OVER.slice(
      REVOCATIONS_CARRY_OVER.indexOf(" WHERE "),
    );

    expect(where).toBe(
      ` WHERE "aiAccessRunnerId" IS NULL AND ("aiAccessRunnerBoundAt" IS NOT NULL OR "aiAccessLastVerifiedAt" IS NOT NULL OR "aiAccessLastError" IS NOT NULL)`,
    );

    const up: Array<string> = await recordQueries("up");

    expect(up.indexOf(REVOCATIONS_CARRY_OVER)).toBeGreaterThan(
      up.indexOf(NEVER_CONFIGURED_CLUSTERS_INVESTIGATE),
    );
  });

  /*
   * Cluster rounds through the in-cluster agent no longer need the
   * project's "Enable AI command execution" opt-in. Without this, a cluster
   * left in an unattended mode in a project that never opted in would start
   * changing the cluster on its own the moment the server upgraded.
   */
  test("unattended modes drop to RequireApproval only in projects that never opted in to AI command execution", () => {
    expect(NO_UNATTENDED_SURPRISE).toContain(
      `SET "aiRemediationMode" = 'RequireApproval'`,
    );

    const where: string = NO_UNATTENDED_SURPRISE.slice(
      NO_UNATTENDED_SURPRISE.indexOf(" WHERE "),
    );

    expect(where).toBe(
      ` WHERE c."projectId" = p."_id" AND p."enableAiCommandExecution" IS NOT TRUE AND c."aiRemediationMode" IN ('Automatic','BypassApproval')`,
    );

    // IS NOT TRUE, not = false: a NULL opt-in is not an opt-in.
    expect(where).not.toContain(`"enableAiCommandExecution" = false`);
    // Disabled and RequireApproval clusters are never touched.
    expect(where).not.toContain("'Disabled'");
    expect(where).not.toContain("'RequireApproval'");
  });

  test("no backfill touches the new table or RunnerJob", () => {
    for (const statement of [
      POSTMORTEM_BACKFILL,
      NEVER_CONFIGURED_CLUSTERS_INVESTIGATE,
      REVOCATIONS_CARRY_OVER,
      NO_UNATTENDED_SURPRISE,
    ]) {
      expect(statement).not.toContain(`"KubernetesAiAgent"`);
      expect(statement).not.toContain(`"RunnerJob"`);
    }
  });
});

describe("AddKubernetesAiAgentAndAiDefaults migration - down()", () => {
  /*
   * The inverse of every schema statement of up(), in reverse order, and
   * nothing for the backfills.
   */
  test("undoes exactly the schema and default changes of up(), in reverse order", async () => {
    const up: Array<string> = await recordQueries("up");

    const inverse: Array<string> = up
      .filter((statement: string): boolean => {
        return !isUpdate(statement);
      })
      .map((statement: string): string => {
        const constraint: RegExpMatchArray | null = statement.match(
          /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/,
        );
        if (constraint) {
          return `ALTER TABLE "${constraint[1]}" DROP CONSTRAINT "${constraint[2]}"`;
        }

        const index: RegExpMatchArray | null = statement.match(
          /^CREATE (?:UNIQUE )?INDEX "([^"]+)"/,
        );
        if (index) {
          return `DROP INDEX "public"."${index[1]}"`;
        }

        const column: RegExpMatchArray | null = statement.match(
          /^ALTER TABLE "([^"]+)" ADD "([^"]+)"/,
        );
        if (column) {
          return `ALTER TABLE "${column[1]}" DROP COLUMN "${column[2]}"`;
        }

        const setDefault: RegExpMatchArray | null = statement.match(
          /^ALTER TABLE "KubernetesCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true$/,
        );
        if (setDefault) {
          return `ALTER TABLE "KubernetesCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`;
        }

        const table: RegExpMatchArray | null = statement.match(
          /^CREATE TABLE "([^"]+)"/,
        );
        if (table) {
          return `DROP TABLE "${table[1]}"`;
        }

        throw new Error(
          `up() ran a statement with no known inverse: ${statement}`,
        );
      })
      .reverse();

    expect(await recordQueries("down")).toEqual(inverse);
  });

  test("restores the previous investigation default", async () => {
    expect(await recordQueries("down")).toContain(
      `ALTER TABLE "KubernetesCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
  });

  test("leaves every backfilled row alone", async () => {
    expect((await recordQueries("down")).some(isUpdate)).toBe(false);
  });

  test("drops the table last, after everything that references it", async () => {
    const down: Array<string> = await recordQueries("down");

    expect(down[down.length - 1]).toBe(`DROP TABLE "KubernetesAiAgent"`);
    expect(
      down.indexOf(
        `ALTER TABLE "RunnerJob" DROP CONSTRAINT "${namingStrategy.foreignKeyName(
          "RunnerJob",
          ["targetKubernetesAiAgentId"],
        )}"`,
      ),
    ).toBe(0);
  });
});
