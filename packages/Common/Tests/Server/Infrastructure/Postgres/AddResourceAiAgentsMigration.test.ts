import { AddResourceAiAgents1796300000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796300000000-AddResourceAiAgents";
import { TurnOnResourceAiInvestigationByDefault1797800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797800000000-TurnOnResourceAiInvestigationByDefault";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesAiAgent from "../../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import Project from "../../../../Models/DatabaseModels/Project";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The resource AI agents' schema: the ResourceAiAgent table, the RunnerJob
 * and AutoRemediationSuggestion resource columns, and the AI access columns
 * of the eight resource models — the resource twin of
 * AddKubernetesAiAgentAndAiDefaultsMigration.test.ts.
 *
 * Pinned here, each a silent regression if it moves on its own:
 *
 *  1. REGISTRATION. The migration is registered once, last, with a
 *     timestamp above everything before it, and its class name matches its
 *     file.
 *  2. THE SCHEMA IS THE ENTITIES'. Every table, column, index and foreign
 *     key is created exactly as the models declare it, with TypeORM's own
 *     index and foreign key names (a mismatch is a green deploy and a red
 *     Schema Drift job). resourceId has NO foreign key anywhere: it points
 *     into a different table for every resourceType.
 *  3. THE DEFAULTS AND THE ENTITIES AGREE. This migration shipped every
 *     resource with AI investigation off and remediation Disabled; the drift
 *     job does not reliably catch a DEFAULT that disagrees. A column whose
 *     default a LATER migration moved (investigation, now on by default:
 *     TurnOnResourceAiInvestigationByDefault) is compared with that
 *     migration instead, as AddKubernetesClusterAiAccessMigration.test.ts
 *     does for the cluster's.
 *  4. NOTHING BUT SCHEMA. No data is rewritten: no resource is switched on
 *     for anybody, and no Kubernetes table or column is touched (the
 *     Kubernetes AI agent's stack is unchanged).
 *  5. down() REVERSES up() EXACTLY, in reverse order.
 *
 * Fake QueryRunner only.
 */

const OWN_CLASS_NAME: string = "AddResourceAiAgents1796300000000";

// The last migration registered before this one.
const REGISTERED_BEFORE_IT: string =
  "AddKubernetesAiAgentAndAiDefaults1796100000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796300000000-AddResourceAiAgents.ts",
);

type ModelType = { new (): unknown; name: string };

const RESOURCE_MODELS: Record<AiResourceType, ModelType> = {
  [AiResourceType.DockerHost]: DockerHost,
  [AiResourceType.PodmanHost]: PodmanHost,
  [AiResourceType.DockerSwarmCluster]: DockerSwarmCluster,
  [AiResourceType.ProxmoxCluster]: ProxmoxCluster,
  [AiResourceType.VMwareVCenter]: VMwareVCenter,
  [AiResourceType.CephCluster]: CephCluster,
  [AiResourceType.DatabaseServer]: DatabaseServer,
  [AiResourceType.Host]: Host,
};

// The DDL TypeORM emits for each AI access column of a resource model.
const RESOURCE_AI_COLUMN_DDL: Array<[string, string]> = [
  ["isAiInvestigationEnabled", `boolean NOT NULL DEFAULT false`],
  [
    "aiRemediationMode",
    `character varying(100) NOT NULL DEFAULT '${ResourceAiRemediationMode.Disabled}'`,
  ],
  ["aiCommandAllowlist", `jsonb`],
  ["aiAccessLastVerifiedAt", `TIMESTAMP WITH TIME ZONE`],
  ["aiAccessLastError", `character varying`],
  ["aiAccessConfiguredAt", `TIMESTAMP WITH TIME ZONE`],
];

/*
 * Column defaults a LATER migration moved. This migration has shipped, so
 * its DDL stays exactly as it was (existing installs ran it long ago); for
 * these columns the model's current default is compared with the later
 * migration's SET DEFAULT instead, and this migration's historical default
 * with what the later migration's down() restores.
 */
interface MovedDefault {
  property: string;
  migration: MigrationInterface;
}

const DEFAULTS_MOVED_LATER: Array<MovedDefault> = [
  {
    property: "isAiInvestigationEnabled",
    migration: new TurnOnResourceAiInvestigationByDefault1797800000000(),
  },
];

function movedDefaultFor(property: string): MovedDefault | undefined {
  return DEFAULTS_MOVED_LATER.find((moved: MovedDefault): boolean => {
    return moved.property === property;
  });
}

async function recordQueriesOf(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

  return statements;
}

const UNIQUE_INDEX: string = `CREATE UNIQUE INDEX "IDX_ResourceAiAgent_projectId_resourceType_resourceId" ON "ResourceAiAgent" ("projectId", "resourceType", "resourceId") WHERE "deletedAt" IS NULL`;

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

  await new AddResourceAiAgents1796300000000()[direction](queryRunner);

  return statements;
}

function declaredColumn(
  model: ModelType,
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
  model: ModelType,
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

function createIndex(table: string, column: string): string {
  return `CREATE INDEX "${namingStrategy.indexName(table, [
    column,
  ])}" ON "${table}" ("${column}") `;
}

async function createTable(): Promise<string> {
  const statement: string | undefined = (await recordQueries("up")).find(
    (candidate: string): boolean => {
      return candidate.startsWith(`CREATE TABLE "ResourceAiAgent"`);
    },
  );

  expect(statement).toBeDefined();

  return statement!;
}

describe("AddResourceAiAgents migration - identity and registration", () => {
  test("its class name and name carry its stamp, matching its file", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddResourceAiAgents1796300000000().name).toBe(OWN_CLASS_NAME);
  });

  test("its stamp is at least 1796300000000", () => {
    expect(timestampOfClassName(OWN_CLASS_NAME)).toBeGreaterThanOrEqual(
      1796300000000,
    );
  });

  test("is registered exactly once", () => {
    expect(SchemaMigrations).toContain(AddResourceAiAgents1796300000000);
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
    expect(registeredNames.indexOf(REGISTERED_BEFORE_IT)).toBeGreaterThan(0);
    expect(
      registeredNames.slice(0, ownIndex).filter((className: string) => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);
  });
});

describe("AddResourceAiAgents migration - the ResourceAiAgent table", () => {
  const ownColumns: Array<ColumnMetadataArgs> =
    getMetadataArgsStorage().columns.filter(
      (column: ColumnMetadataArgs): boolean => {
        return column.target === ResourceAiAgent;
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
        "resourceType",
        "resourceId",
        "resourceIdentifier",
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
    ["resourceType", `"resourceType" character varying(100) NOT NULL`],
    ["resourceId", `"resourceId" uuid NOT NULL`],
    ["resourceIdentifier", `"resourceIdentifier" character varying(500),`],
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
        ResourceAiAgent,
        property,
      );

      expect(await createTable()).toContain(ddl);

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

  /*
   * Column for column the Kubernetes AI agent's table: every column the two
   * share has the same DDL in both migrations' CREATE TABLE.
   */
  test("shares the Kubernetes AI agent's DDL for every column the two tables have in common", async () => {
    const kubernetesMigrationPath: string = path.join(
      __dirname,
      "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796100000000-AddKubernetesAiAgentAndAiDefaults.ts",
    );
    const kubernetesSource: string = fs.readFileSync(
      kubernetesMigrationPath,
      "utf8",
    );
    const ours: string = await createTable();
    const kubernetesTableAt: number = kubernetesSource.indexOf(
      `CREATE TABLE "KubernetesAiAgent"`,
    );
    expect(kubernetesTableAt).toBeGreaterThan(0);
    const theirs: string = kubernetesSource.slice(
      kubernetesTableAt,
      kubernetesSource.indexOf("\n", kubernetesTableAt),
    );

    const shared: Array<string> = getMetadataArgsStorage()
      .columns.filter((column: ColumnMetadataArgs): boolean => {
        return column.target === KubernetesAiAgent;
      })
      .map((column: ColumnMetadataArgs): string => {
        return column.propertyName;
      })
      .filter((property: string): boolean => {
        return property !== "kubernetesClusterId";
      });

    expect(shared.length).toBeGreaterThan(8);

    const ddlOf: (statement: string, column: string) => string = (
      statement: string,
      column: string,
    ): string => {
      const match: RegExpMatchArray | null = statement.match(
        new RegExp(`"${column}" [^,]*,`),
      );
      expect(match).not.toBeNull();
      return match![0];
    };

    for (const column of [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
      ...shared,
    ]) {
      expect({ column, ddl: ddlOf(ours, column) }).toEqual({
        column,
        ddl: ddlOf(theirs, column),
      });
    }
  });

  test("enforces one agent per live resource with the unique index the model names", async () => {
    expect(await recordQueries("up")).toContain(UNIQUE_INDEX);
  });

  test.each(["projectId", "resourceType", "resourceId"])(
    "indexes %s under TypeORM's name",
    async (column: string) => {
      expect(await recordQueries("up")).toContain(
        createIndex("ResourceAiAgent", column),
      );
    },
  );

  test("ResourceAiAgent.project goes when its Project row goes (ON DELETE CASCADE)", async () => {
    const declared: RelationMetadataArgs = declaredRelation(
      ResourceAiAgent,
      "project",
    );

    expect(declared.relationType).toBe("many-to-one");
    expect(declared.options.onDelete).toBe("CASCADE");
    expect((declared.type as () => unknown)()).toBe(Project);

    expect(await recordQueries("up")).toContain(
      `ALTER TABLE "ResourceAiAgent" ADD CONSTRAINT "${namingStrategy.foreignKeyName(
        "ResourceAiAgent",
        ["projectId"],
      )}" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  });

  test("gives resourceId no foreign key: it points into a different table per resource type", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(/FOREIGN KEY \("resourceId"\)/);
    }
  });

  test("the only foreign key on the new table is its project's", async () => {
    const constraints: Array<string> = (await recordQueries("up")).filter(
      (statement: string): boolean => {
        return statement.startsWith(
          `ALTER TABLE "ResourceAiAgent" ADD CONSTRAINT`,
        );
      },
    );

    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toContain(`FOREIGN KEY ("projectId")`);
  });
});

describe("AddResourceAiAgents migration - RunnerJob", () => {
  test.each([
    ["targetResourceAiAgentId", "uuid"],
    ["resourceType", "character varying(100)"],
    ["resourceId", "uuid"],
  ])(
    "adds the nullable column %s the model declares",
    async (column: string, ddl: string) => {
      expect(declaredColumn(RunnerJob, column).options.nullable).toBe(true);
      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "RunnerJob" ADD "${column}" ${ddl}`,
      );
    },
  );

  test.each(["targetResourceAiAgentId", "resourceType", "resourceId"])(
    "indexes %s under TypeORM's name",
    async (column: string) => {
      expect(await recordQueries("up")).toContain(
        createIndex("RunnerJob", column),
      );
    },
  );

  test("targetResourceAiAgentId references ResourceAiAgent and is nulled, never cascaded, when the agent row goes", async () => {
    const declared: RelationMetadataArgs = declaredRelation(
      RunnerJob,
      "targetResourceAiAgent",
    );

    expect(declared.relationType).toBe("many-to-one");
    expect(declared.options.onDelete).toBe("SET NULL");
    expect((declared.type as () => unknown)()).toBe(ResourceAiAgent);

    expect(await recordQueries("up")).toContain(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "${namingStrategy.foreignKeyName(
        "RunnerJob",
        ["targetResourceAiAgentId"],
      )}" FOREIGN KEY ("targetResourceAiAgentId") REFERENCES "ResourceAiAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  });
});

describe("AddResourceAiAgents migration - AutoRemediationSuggestion", () => {
  test.each([
    ["resourceType", "character varying(100)"],
    ["resourceId", "uuid"],
  ])(
    "adds the nullable column %s the model declares, indexed",
    async (column: string, ddl: string) => {
      const up: Array<string> = await recordQueries("up");

      expect(
        declaredColumn(AutoRemediationSuggestion, column).options.nullable,
      ).toBe(true);
      expect(up).toContain(
        `ALTER TABLE "AutoRemediationSuggestion" ADD "${column}" ${ddl}`,
      );
      expect(up).toContain(createIndex("AutoRemediationSuggestion", column));
    },
  );
});

describe("AddResourceAiAgents migration - the resource models' AI access columns", () => {
  const cases: Array<[string, ModelType, string, string]> =
    ALL_AI_RESOURCE_TYPES.flatMap(
      (type: AiResourceType): Array<[string, ModelType, string, string]> => {
        return RESOURCE_AI_COLUMN_DDL.map(
          ([column, ddl]: [string, string]): [
            string,
            ModelType,
            string,
            string,
          ] => {
            return [type, RESOURCE_MODELS[type], column, ddl];
          },
        );
      },
    );

  test.each(cases)(
    "%s gains %p as the model declares it",
    async (
      type: string,
      model: ModelType,
      column: string,
      ddl: string,
    ): Promise<void> => {
      const declared: ColumnMetadataArgs = declaredColumn(model, column);

      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "${type}" ADD "${column}" ${ddl}`,
      );

      if (declared.options.nullable === false) {
        expect(ddl).toContain("NOT NULL");
      } else {
        expect(ddl).not.toContain("NOT NULL");
      }

      if (movedDefaultFor(column)) {
        // Compared with the later migration below.
        expect(ddl).toContain("DEFAULT");
      } else if (typeof declared.options.default === "string") {
        expect(ddl).toContain(`DEFAULT '${declared.options.default}'`);
      } else if (declared.options.default !== undefined) {
        expect(ddl).toContain(`DEFAULT ${String(declared.options.default)}`);
      } else {
        expect(ddl).not.toContain("DEFAULT");
      }
    },
  );

  const movedCases: Array<[string, ModelType, MovedDefault]> =
    ALL_AI_RESOURCE_TYPES.flatMap(
      (type: AiResourceType): Array<[string, ModelType, MovedDefault]> => {
        return DEFAULTS_MOVED_LATER.map(
          (moved: MovedDefault): [string, ModelType, MovedDefault] => {
            return [type, RESOURCE_MODELS[type], moved];
          },
        );
      },
    );

  test.each(movedCases)(
    "%s: the model's moved default is the one the later migration sets, and its down() restores this migration's",
    async (type: string, model: ModelType, moved: MovedDefault) => {
      const declared: ColumnMetadataArgs = declaredColumn(
        model,
        moved.property,
      );
      const historical: string | undefined = RESOURCE_AI_COLUMN_DDL.find(
        ([column]: [string, string]): boolean => {
          return column === moved.property;
        },
      )?.[1].match(/DEFAULT (.+)$/)?.[1];

      expect(declared.options.default).toBeDefined();
      expect(historical).toBeDefined();
      // This migration's own DDL is unchanged: it shipped with the old default.
      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "${type}" ADD "${moved.property}" boolean NOT NULL DEFAULT ${historical}`,
      );
      expect(await recordQueriesOf(moved.migration, "up")).toContain(
        `ALTER TABLE "${type}" ALTER COLUMN "${moved.property}" SET DEFAULT ${String(
          declared.options.default,
        )}`,
      );
      expect(await recordQueriesOf(moved.migration, "down")).toContain(
        `ALTER TABLE "${type}" ALTER COLUMN "${moved.property}" SET DEFAULT ${historical}`,
      );
    },
  );

  test("every resource starts with investigation off and remediation Disabled", async () => {
    const up: Array<string> = await recordQueries("up");

    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(up).toContain(
        `ALTER TABLE "${type}" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
      );
      expect(up).toContain(
        `ALTER TABLE "${type}" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
      );
    }
  });

  test("adds nothing else to the resource tables", async () => {
    const up: Array<string> = await recordQueries("up");

    for (const type of ALL_AI_RESOURCE_TYPES) {
      const touching: Array<string> = up.filter(
        (statement: string): boolean => {
          return statement.includes(`"${type}"`);
        },
      );

      expect(touching).toHaveLength(RESOURCE_AI_COLUMN_DDL.length);
    }
  });
});

describe("AddResourceAiAgents migration - scope", () => {
  test("only changes the schema: no data is rewritten", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(/^(UPDATE|INSERT|DELETE) /);
    }
  });

  test("leaves the Kubernetes AI agent's tables and columns alone", async () => {
    const kubernetesTables: Array<string> = [
      new KubernetesAiAgent() as unknown as { tableName: string },
      new KubernetesCluster() as unknown as { tableName: string },
    ].map((model: { tableName: string }): string => {
      return model.tableName;
    });

    for (const statement of [
      ...(await recordQueries("up")),
      ...(await recordQueries("down")),
    ]) {
      for (const table of kubernetesTables) {
        expect(statement).not.toContain(`"${table}"`);
      }
      expect(statement).not.toMatch(
        /"(targetKubernetesAiAgentId|kubernetesClusterId)"/,
      );
    }
  });

  test("touches exactly the tables the design names", async () => {
    const tables: Set<string> = new Set<string>();

    for (const statement of await recordQueries("up")) {
      const match: RegExpMatchArray | null = statement.match(
        /^(?:CREATE TABLE|ALTER TABLE|CREATE (?:UNIQUE )?INDEX "[^"]+" ON) "([^"]+)"/,
      );
      expect(match).not.toBeNull();
      tables.add(match![1]!);
    }

    expect([...tables].sort()).toEqual(
      [
        "ResourceAiAgent",
        "RunnerJob",
        "AutoRemediationSuggestion",
        ...ALL_AI_RESOURCE_TYPES,
      ].sort(),
    );
  });
});

describe("AddResourceAiAgents migration - down()", () => {
  // The inverse of every statement of up(), in reverse order.
  test("undoes exactly what up() did, in reverse order", async () => {
    const up: Array<string> = await recordQueries("up");

    const inverse: Array<string> = up
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

  test("drops the table last, after everything that references it", async () => {
    const down: Array<string> = await recordQueries("down");

    expect(down[down.length - 1]).toBe(`DROP TABLE "ResourceAiAgent"`);
    expect(
      down.indexOf(
        `ALTER TABLE "RunnerJob" DROP CONSTRAINT "${namingStrategy.foreignKeyName(
          "RunnerJob",
          ["targetResourceAiAgentId"],
        )}"`,
      ),
    ).toBe(0);
  });
});
