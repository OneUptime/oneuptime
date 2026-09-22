import { AddKubernetesClusterAiAccess1794400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1794400000000-AddKubernetesClusterAiAccess";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import { KubernetesAiRemediationMode } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The schema half of OneUptime AI access to Kubernetes clusters: the
 * cluster's Runner/credential binding, its investigation switch, remediation
 * mode and allowlist, the outcome bookkeeping and the "AI access was
 * configured" marker; plus the cluster a kubectl job (RunnerJob) and a
 * remediation suggestion ran against, so the cluster's AI page can list
 * every command AI ran on it.
 *
 * It pins that every column is added exactly as the model declares it (a
 * mismatch is a green deploy followed by a red Schema Drift job), that the
 * indexes and foreign keys carry the names TypeORM would choose for the
 * model's own decorators, that the migration sits after every migration
 * already shipped, and that down() is the exact inverse of up().
 *
 * Fake QueryRunner only.
 */

const OWN_CLASS_NAME: string = "AddKubernetesClusterAiAccess1794400000000";

/*
 * The last migration that had shipped (master builds) when this one was
 * renumbered. A fresh install runs migrations by timestamp and an existing
 * one in registration order; this one must come after it in both, or the
 * two kinds of install run it in different places.
 */
const SHIPPED_BEFORE_IT: string = "AddOAuth2WorkflowVariables1794300000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1794400000000-AddKubernetesClusterAiAccess.ts",
);

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

type TimestampOfClassNameFunction = (className: string) => number | null;

const timestampOfClassName: TimestampOfClassNameFunction = (
  className: string,
): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddKubernetesClusterAiAccess1794400000000()[direction](queryRunner);

  return statements;
};

type ModelClass = { new (): BaseModel; name: string };

interface ExpectedColumn {
  model: ModelClass;
  table: string;
  property: string;
  ddl: string;
}

/*
 * What each column's DDL must be, given the model. character varying(n) is
 * varchar with a length; uuid, boolean, jsonb and timestamptz carry none.
 */
const EXPECTED_COLUMNS: Array<ExpectedColumn> = [
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiAccessRunnerId",
    ddl: "uuid",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiAccessCredentialId",
    ddl: "uuid",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "isAiInvestigationEnabled",
    ddl: "boolean NOT NULL DEFAULT false",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiRemediationMode",
    ddl: `character varying(${ColumnLength.ShortText}) NOT NULL DEFAULT '${KubernetesAiRemediationMode.Disabled}'`,
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiKubectlCommandAllowlist",
    ddl: "jsonb",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiAccessLastVerifiedAt",
    ddl: "TIMESTAMP WITH TIME ZONE",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiAccessLastError",
    ddl: "character varying",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiAccessConfiguredAt",
    ddl: "TIMESTAMP WITH TIME ZONE",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    property: "aiAccessRunnerBoundAt",
    ddl: "TIMESTAMP WITH TIME ZONE",
  },
  {
    model: RunnerJob,
    table: "RunnerJob",
    property: "kubernetesClusterId",
    ddl: "uuid",
  },
  {
    model: AutoRemediationSuggestion,
    table: "AutoRemediationSuggestion",
    property: "kubernetesClusterId",
    ddl: "uuid",
  },
];

interface ExpectedRelation {
  model: ModelClass;
  table: string;
  relation: string;
  column: string;
  referencedModel: ModelClass;
  referencedTable: string;
}

const EXPECTED_RELATIONS: Array<ExpectedRelation> = [
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    relation: "aiAccessRunner",
    column: "aiAccessRunnerId",
    referencedModel: Runner,
    referencedTable: "Runner",
  },
  {
    model: KubernetesCluster,
    table: "KubernetesCluster",
    relation: "aiAccessCredential",
    column: "aiAccessCredentialId",
    referencedModel: RunbookCredential,
    referencedTable: "RunbookCredential",
  },
  {
    model: RunnerJob,
    table: "RunnerJob",
    relation: "kubernetesCluster",
    column: "kubernetesClusterId",
    referencedModel: KubernetesCluster,
    referencedTable: "KubernetesCluster",
  },
  {
    model: AutoRemediationSuggestion,
    table: "AutoRemediationSuggestion",
    relation: "kubernetesCluster",
    column: "kubernetesClusterId",
    referencedModel: KubernetesCluster,
    referencedTable: "KubernetesCluster",
  },
];

function declaredColumn(
  model: ModelClass,
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
  model: ModelClass,
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

// Single-column indexes the model declares on one of the new columns.
function declaredSingleColumnIndexes(): Array<{
  table: string;
  column: string;
}> {
  const declared: Array<{ table: string; column: string }> = [];

  for (const expected of EXPECTED_COLUMNS) {
    const hasIndex: boolean = getMetadataArgsStorage().indices.some(
      (index: IndexMetadataArgs): boolean => {
        const columns: Array<string> = (index.columns as Array<string>) || [];
        return (
          index.target === expected.model &&
          columns.length === 1 &&
          columns[0] === expected.property
        );
      },
    );

    if (hasIndex) {
      declared.push({ table: expected.table, column: expected.property });
    }
  }

  return declared;
}

const POSTGRES_SPELLING: Record<string, string> = {
  uuid: "uuid",
  boolean: "boolean",
  varchar: "character varying",
  jsonb: "jsonb",
  timestamptz: "TIMESTAMP WITH TIME ZONE",
};

function addColumnStatement(column: ExpectedColumn): string {
  return `ALTER TABLE "${column.table}" ADD "${column.property}" ${column.ddl}`;
}

describe("AddKubernetesClusterAiAccess migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddKubernetesClusterAiAccess1794400000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered exactly once, so the columns reach every database once", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    expect(ownIndex).toBeGreaterThan(0);

    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    const notBehind: Array<string> = registeredNames
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      });

    expect(notBehind).toEqual([]);
  });

  /*
   * "Registered last" in the sense that survives the next migration: nothing
   * registered after it may sort before it, which is what would make a
   * fresh install and an upgraded one run it in different places.
   */
  test("everything registered after it sorts after it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    const sortsBefore: Array<string> = registeredNames
      .slice(ownIndex + 1)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp === null || timestamp <= ownTimestamp;
      });

    expect(sortsBefore).toEqual([]);
  });

  test("comes after the last migration that had already shipped", () => {
    expect(registeredNames).toContain(SHIPPED_BEFORE_IT);
    expect(registeredNames.indexOf(OWN_CLASS_NAME)).toBeGreaterThan(
      registeredNames.indexOf(SHIPPED_BEFORE_IT),
    );
    expect(timestampOfClassName(OWN_CLASS_NAME)!).toBeGreaterThan(
      timestampOfClassName(SHIPPED_BEFORE_IT)!,
    );
  });
});

// An ALTER TABLE statement's `ADD "<name>" ` clause.
const ADD_STATEMENT_PATTERN: RegExp = / ADD "[^"]+" /;

describe("AddKubernetesClusterAiAccess migration - columns", () => {
  test("adds exactly the new columns, in order, before anything else", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements.slice(0, EXPECTED_COLUMNS.length)).toEqual(
      EXPECTED_COLUMNS.map(addColumnStatement),
    );
    expect(
      statements.filter((statement: string): boolean => {
        return (
          ADD_STATEMENT_PATTERN.test(statement) &&
          !statement.includes("CONSTRAINT")
        );
      }),
    ).toHaveLength(EXPECTED_COLUMNS.length);
  });

  test("adds every AI access column the cluster model declares", () => {
    const added: Array<string> = EXPECTED_COLUMNS.filter(
      (column: ExpectedColumn): boolean => {
        return column.model === KubernetesCluster;
      },
    ).map((column: ExpectedColumn): string => {
      return column.property;
    });

    const modelColumns: Array<string> = getMetadataArgsStorage()
      .columns.filter((column: ColumnMetadataArgs): boolean => {
        return (
          column.target === KubernetesCluster &&
          (column.propertyName.startsWith("ai") ||
            column.propertyName.startsWith("isAi"))
        );
      })
      .map((column: ColumnMetadataArgs): string => {
        return column.propertyName;
      });

    expect([...modelColumns].sort()).toEqual([...added].sort());
  });

  test.each(EXPECTED_COLUMNS)(
    "$table.$property matches the column the model declares",
    (column: ExpectedColumn) => {
      const declared: ColumnMetadataArgs = declaredColumn(
        column.model,
        column.property,
      );
      const type: string = String(declared.options.type);

      expect(declared.options.name).toBeUndefined();
      expect(column.ddl.startsWith(POSTGRES_SPELLING[type] || "unknown")).toBe(
        true,
      );

      if (declared.options.length) {
        expect(column.ddl).toContain(`(${declared.options.length})`);
      } else {
        expect(column.ddl).not.toContain("(");
      }

      if (declared.options.nullable === false) {
        expect(column.ddl).toContain("NOT NULL");
      } else {
        expect(declared.options.nullable).toBe(true);
        expect(column.ddl).not.toContain("NOT NULL");
      }

      if (declared.options.default !== undefined) {
        const literal: string =
          typeof declared.options.default === "string"
            ? `'${declared.options.default}'`
            : String(declared.options.default);
        expect(column.ddl).toContain(`DEFAULT ${literal}`);
      } else {
        expect(column.ddl).not.toContain("DEFAULT");
      }
    },
  );

  /*
   * Existing clusters get investigation off and remediation Disabled in the
   * same statement that adds the column - no backfill, no window in which a
   * row has no mode, and nothing turned on for anyone by the upgrade.
   */
  test("leaves every existing cluster with AI investigation off and remediation Disabled", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toContain(
      `ALTER TABLE "KubernetesCluster" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    expect(statements).toContain(
      `ALTER TABLE "KubernetesCluster" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    expect(
      statements.some((statement: string): boolean => {
        return statement.startsWith("UPDATE");
      }),
    ).toBe(false);
  });

  test("leaves both markers empty on existing clusters, so none reads as configured or once-bound", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toContain(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    expect(statements).toContain(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessRunnerBoundAt" TIMESTAMP WITH TIME ZONE`,
    );
  });
});

describe("AddKubernetesClusterAiAccess migration - indexes and foreign keys", () => {
  test("creates exactly the indexes the models declare on the new columns, under TypeORM's names", async () => {
    const created: Array<string> = (await recordQueries("up")).filter(
      (statement: string): boolean => {
        return statement.startsWith("CREATE INDEX");
      },
    );

    const expected: Array<string> = declaredSingleColumnIndexes().map(
      (index: { table: string; column: string }): string => {
        return `CREATE INDEX "${namingStrategy.indexName(index.table, [
          index.column,
        ])}" ON "${index.table}" ("${index.column}") `;
      },
    );

    expect(expected).toHaveLength(3);
    expect(created).toEqual(expected);
  });

  test.each(EXPECTED_RELATIONS)(
    "$table.$column references $referencedTable and is nulled when the target is deleted",
    async (relation: ExpectedRelation) => {
      const declared: RelationMetadataArgs = declaredRelation(
        relation.model,
        relation.relation,
      );

      expect(declared.relationType).toBe("many-to-one");
      expect(declared.options.onDelete).toBe("SET NULL");
      expect((declared.type as () => ModelClass)()).toBe(
        relation.referencedModel,
      );

      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "${relation.table}" ADD CONSTRAINT "${namingStrategy.foreignKeyName(
          relation.table,
          [relation.column],
        )}" FOREIGN KEY ("${relation.column}") REFERENCES "${relation.referencedTable}"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    },
  );

  test("adds no other foreign key", async () => {
    const foreignKeys: Array<string> = (await recordQueries("up")).filter(
      (statement: string): boolean => {
        return statement.includes("FOREIGN KEY");
      },
    );

    expect(foreignKeys).toHaveLength(EXPECTED_RELATIONS.length);
  });

  /*
   * Deleting the bound Runner (or credential) nulls the cluster's binding.
   * That is intended - a binding to a row that no longer exists is useless -
   * and it is why the cluster keeps aiAccessConfiguredAt: the nulled FK alone
   * would make a configured cluster look like one nobody ever configured.
   */
  test("the binding foreign keys never cascade a Runner or credential delete into the cluster", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toContain("ON DELETE CASCADE");
    }
  });
});

describe("AddKubernetesClusterAiAccess migration - down()", () => {
  /*
   * The inverse of each up() statement, in reverse order: dropping a column
   * before the constraint or index on it fails, and leaving an index behind
   * makes a re-run of up() fail on a name collision.
   */
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
          /^CREATE INDEX "([^"]+)"/,
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

        throw new Error(
          `up() ran a statement with no known inverse: ${statement}`,
        );
      })
      .reverse();

    expect(await recordQueries("down")).toEqual(inverse);
  });
});
