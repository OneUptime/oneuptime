import { AddResourceAiAgents1796300000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796300000000-AddResourceAiAgents";
import { TurnOnResourceAiInvestigationByDefault1797900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797900000000-TurnOnResourceAiInvestigationByDefault";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import { NEVER_CONFIGURED_RESOURCE_AI_ACCESS } from "../../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { TableMetadataArgs } from "typeorm/metadata-args/TableMetadataArgs";

/*
 * AI investigation on by default for every resource a resource AI agent
 * serves, as it is for a Kubernetes cluster.
 *
 *   - Schema: isAiInvestigationEnabled defaults to true on the eight
 *     resource tables — the tables of every AiResourceType, and no other
 *     (a cluster's own switch already defaults to true);
 *   - Data: a resource nobody ever configured AI access for
 *     (aiAccessConfiguredAt IS NULL) gets investigation on, like a new one.
 *     Exactly the resources a resource AI agent's first connection turns
 *     investigation on for already (ResourceAiAgentService.
 *     getFirstConnectionDefaults), so what AI runs does not change: a
 *     resource without a connected agent runs nothing either way. A
 *     resource someone configured keeps its switch, and fixes are never
 *     touched;
 *   - down() puts back the defaults AddResourceAiAgents created the columns
 *     with. The data update is not reverted: afterwards those rows cannot
 *     be told from choices an operator made.
 *
 * Fake QueryRunner only. TurnOnResourceAiInvestigationByDefaultPostgres
 * runs it on real rows, and the Schema Drift job applies it to a real
 * database.
 */

const MIGRATION_NAME: string =
  "TurnOnResourceAiInvestigationByDefault1797900000000";
const TIMESTAMP: number = 1797900000000;

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

const SET_DEFAULT_TRUE: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true$/;
const SET_DEFAULT_FALSE: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false$/;
const TURN_ON_NEVER_CONFIGURED: RegExp =
  /^UPDATE "([A-Za-z]+)" SET "isAiInvestigationEnabled" = true WHERE "aiAccessConfiguredAt" IS NULL AND "isAiInvestigationEnabled" = false$/;

async function recordQueries(
  migration: {
    up: (queryRunner: QueryRunner) => Promise<void>;
    down: (queryRunner: QueryRunner) => Promise<void>;
  },
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

async function up(): Promise<Array<string>> {
  return recordQueries(
    new TurnOnResourceAiInvestigationByDefault1797900000000(),
    "up",
  );
}

async function down(): Promise<Array<string>> {
  return recordQueries(
    new TurnOnResourceAiInvestigationByDefault1797900000000(),
    "down",
  );
}

function tablesIn(statements: Array<string>, pattern: RegExp): Array<string> {
  return statements
    .map((statement: string): string | null => {
      return statement.match(pattern)?.[1] || null;
    })
    .filter((table: string | null): table is string => {
      return table !== null;
    });
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<{ name: string }>).map(
    (registered: { name: string }): string => {
      return registered.name;
    },
  );
}

function timestampOf(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

function tableNameOf(model: ModelType): string | undefined {
  return getMetadataArgsStorage().tables.find(
    (table: TableMetadataArgs): boolean => {
      return table.target === model;
    },
  )?.name;
}

function declaredDefaultOf(model: ModelType, property: string): unknown {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === model && column.propertyName === property;
    },
  )?.options.default;
}

const RESOURCE_TABLES: Array<string> = ALL_AI_RESOURCE_TYPES.map(
  (type: AiResourceType): string => {
    return tableNameOf(RESOURCE_MODELS[type]) as string;
  },
);

describe("TurnOnResourceAiInvestigationByDefault1797900000000: registration", () => {
  test("is registered once, under the name its class carries", () => {
    expect(new TurnOnResourceAiInvestigationByDefault1797900000000().name).toBe(
      MIGRATION_NAME,
    );
    expect(SchemaMigrations).toContain(
      TurnOnResourceAiInvestigationByDefault1797900000000,
    );
    expect(
      registeredNames().filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after the migration that created the columns", () => {
    const names: Array<string> = registeredNames();

    expect(names.indexOf("AddResourceAiAgents1796300000000")).toBeGreaterThan(
      0,
    );
    expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      names.indexOf("AddResourceAiAgents1796300000000"),
    );
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf(MIGRATION_NAME);

    expect(
      names.slice(0, ownIndex).filter((className: string): boolean => {
        const timestamp: number | null = timestampOf(className);
        return timestamp !== null && timestamp >= TIMESTAMP;
      }),
    ).toEqual([]);
  });

  // Not "it is last": the next migration would falsify that.
  test("nothing registered after it is older than it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf(MIGRATION_NAME);

    expect(
      names.slice(ownIndex + 1).filter((className: string): boolean => {
        const timestamp: number | null = timestampOf(className);
        return timestamp === null || timestamp <= TIMESTAMP;
      }),
    ).toEqual([]);
  });
});

describe("TurnOnResourceAiInvestigationByDefault1797900000000: the schema", () => {
  test("the resource tables are the eight AiResourceType tables", () => {
    expect(RESOURCE_TABLES).toHaveLength(8);
    expect([...RESOURCE_TABLES].sort()).toEqual(
      [...ALL_AI_RESOURCE_TYPES].map(String).sort(),
    );
  });

  test("up() turns the default on for every resource table, once each", async () => {
    const tables: Array<string> = tablesIn(await up(), SET_DEFAULT_TRUE);

    expect([...tables].sort()).toEqual([...RESOURCE_TABLES].sort());
    expect(new Set(tables).size).toBe(tables.length);
  });

  test("and touches no other table — a cluster's switch already defaults to true", async () => {
    const statements: Array<string> = await up();
    const clusterTable: string | undefined = tableNameOf(KubernetesCluster);

    expect(clusterTable).toBe("KubernetesCluster");
    for (const statement of statements) {
      expect(statement).not.toContain(`"${clusterTable}"`);
      const table: string | undefined = statement.match(
        /^(?:ALTER TABLE|UPDATE) "([A-Za-z]+)"/,
      )?.[1];
      expect(RESOURCE_TABLES).toContain(table);
    }
    expect(
      declaredDefaultOf(KubernetesCluster, "isAiInvestigationEnabled"),
    ).toBe(true);
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the default up() sets is the one the model declares",
    async (type: AiResourceType) => {
      const model: ModelType = RESOURCE_MODELS[type];

      expect(declaredDefaultOf(model, "isAiInvestigationEnabled")).toBe(true);
      expect(await up()).toContain(
        `ALTER TABLE "${tableNameOf(model)}" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT ${String(
          declaredDefaultOf(model, "isAiInvestigationEnabled"),
        )}`,
      );
    },
  );

  test("only the default changes: no column is added, dropped, retyped or made nullable", async () => {
    for (const statement of [...(await up()), ...(await down())]) {
      expect(statement).not.toMatch(/\b(ADD|DROP)\s+(COLUMN\s+)?"/i);
      expect(statement).not.toMatch(/\bSET NOT NULL\b|\bDROP NOT NULL\b/i);
      expect(statement).not.toMatch(/\bTYPE\b/i);
      expect(statement).not.toMatch(/\b(INSERT|DELETE|TRUNCATE)\b/i);
    }
  });
});

describe("TurnOnResourceAiInvestigationByDefault1797900000000: the data", () => {
  test("up() turns investigation on for never-configured resources on every resource table, once each", async () => {
    const tables: Array<string> = tablesIn(
      await up(),
      TURN_ON_NEVER_CONFIGURED,
    );

    expect([...tables].sort()).toEqual([...RESOURCE_TABLES].sort());
    expect(new Set(tables).size).toBe(tables.length);
  });

  test("every statement up() runs is one of the two: the default, or the never-configured update", async () => {
    const statements: Array<string> = await up();

    expect(statements).toHaveLength(RESOURCE_TABLES.length * 2);
    for (const statement of statements) {
      expect(
        SET_DEFAULT_TRUE.test(statement) ||
          TURN_ON_NEVER_CONFIGURED.test(statement),
      ).toBe(true);
    }
  });

  test("the defaults change first, so a row created meanwhile starts on too", async () => {
    const statements: Array<string> = await up();
    const lastDefault: number = statements.reduce(
      (last: number, statement: string, index: number): number => {
        return SET_DEFAULT_TRUE.test(statement) ? index : last;
      },
      -1,
    );
    const firstUpdate: number = statements.findIndex(
      (statement: string): boolean => {
        return TURN_ON_NEVER_CONFIGURED.test(statement);
      },
    );

    expect(lastDefault).toBeLessThan(firstUpdate);
  });

  test("the update writes the investigation switch only: never fixes, the allowlist or the configured marker", async () => {
    for (const statement of (await up()).filter((candidate: string) => {
      return candidate.startsWith("UPDATE");
    })) {
      const assignments: string = statement
        .replace(/^UPDATE "[A-Za-z]+" SET /, "")
        .replace(/ WHERE .*$/, "");

      expect(assignments).toBe(`"isAiInvestigationEnabled" = true`);
      expect(statement).not.toMatch(
        /SET[^W]*"(aiRemediationMode|aiCommandAllowlist|aiAccessConfiguredAt)"/,
      );
    }
  });

  /*
   * The rows the update touches are exactly the ones a resource AI agent's
   * first connection would turn investigation on for: nobody configured
   * them, and investigation is off. Configured resources keep their
   * switch, whatever it is.
   */
  test.each<[string, Date | undefined, boolean, boolean]>([
    ["never configured, off", undefined, false, true],
    ["never configured, already on", undefined, true, false],
    ["configured off by an operator", new Date(), false, false],
    ["configured on by an operator", new Date(), true, false],
  ])(
    "%s: the update and the agent's first connection agree",
    (
      _label: string,
      configuredAt: Date | undefined,
      isOn: boolean,
      turnsOn: boolean,
    ) => {
      // The update's WHERE, for this row.
      const matchesUpdate: boolean = configuredAt === undefined && !isOn;

      expect(matchesUpdate).toBe(turnsOn);
      expect(
        ResourceAiAgentService.getFirstConnectionDefaults({
          resource: {
            aiAccessConfiguredAt: configuredAt,
            isAiInvestigationEnabled: isOn,
            aiRemediationMode: ResourceAiRemediationMode.Disabled,
          },
          allowWrites: false,
        }).turnedOnInvestigation,
      ).toBe(turnsOn);
    },
  );

  test("a never-configured resource reads as investigating everywhere the server answers for one", () => {
    expect(NEVER_CONFIGURED_RESOURCE_AI_ACCESS.isAiInvestigationEnabled).toBe(
      true,
    );
    // Fixes stay off until someone allows them.
    expect(NEVER_CONFIGURED_RESOURCE_AI_ACCESS.aiRemediationMode).toBe(
      ResourceAiRemediationMode.Disabled,
    );
  });
});

describe("TurnOnResourceAiInvestigationByDefault1797900000000: down()", () => {
  test("puts back the defaults, in reverse order, and nothing else", async () => {
    const defaultsUp: Array<string> = (await up()).filter(
      (statement: string): boolean => {
        return SET_DEFAULT_TRUE.test(statement);
      },
    );

    expect(await down()).toEqual(
      [...defaultsUp].reverse().map((statement: string): string => {
        return statement.replace("SET DEFAULT true", "SET DEFAULT false");
      }),
    );
  });

  test("never rewrites a row: the switches it turned on cannot be told from an operator's", async () => {
    for (const statement of await down()) {
      expect(statement).not.toMatch(/\bUPDATE\b/i);
    }
  });

  /*
   * down() must land where AddResourceAiAgents left the columns, or a
   * rollback would leave a default no migration ever declared.
   */
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: down() restores the default AddResourceAiAgents created the column with",
    async (type: AiResourceType) => {
      const table: string = tableNameOf(RESOURCE_MODELS[type]) as string;
      const created: string | undefined = (
        await recordQueries(new AddResourceAiAgents1796300000000(), "up")
      ).find((statement: string): boolean => {
        return statement.startsWith(
          `ALTER TABLE "${table}" ADD "isAiInvestigationEnabled"`,
        );
      });

      expect(created).toBe(
        `ALTER TABLE "${table}" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
      );
      expect(tablesIn(await down(), SET_DEFAULT_FALSE)).toContain(table);
    },
  );
});
