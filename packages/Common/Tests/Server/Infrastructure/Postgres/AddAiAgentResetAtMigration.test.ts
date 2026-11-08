import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddAiAgentResetAt1808996200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808996200000-AddAiAgentResetAt";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind recording a reset of a resource's AI agent
 * (issue #6302): when it was last reset, on every resource an AI agent
 * works for.
 *
 * The statements are executed against a fake QueryRunner, so up() and down()
 * are told apart. Every column is nullable with no default, so Postgres
 * adds it without rewriting the table; nothing is backfilled and nothing
 * scans it. The migration has to be registered, named for its class and
 * ordered after every migration before it, or it never runs; the schema
 * drift check holds its statements to the models.
 */

const MIGRATION_TIMESTAMP: string = "1808996200000";
const MIGRATION_BASE_NAME: string = "AddAiAgentResetAt";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// Every resource an AI agent works for.
const MODELS: Array<BaseModel> = [
  new KubernetesCluster(),
  new DockerHost(),
  new CephCluster(),
  new ProxmoxCluster(),
  new OpenStackCloud(),
  new Host(),
  new PodmanHost(),
  new VMwareVCenter(),
  new DockerSwarmCluster(),
  new DatabaseServer(),
  new CloudAccount(),
];

const TABLES: Array<string> = MODELS.map((model: BaseModel): string => {
  return model.tableName!;
});

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddAiAgentResetAt1808996200000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddAiAgentResetAt1808996200000", () => {
  test("adds aiAgentResetAt to every resource an AI agent works for, nullable, with no default", async () => {
    expect(await statementsOf("up")).toEqual(
      TABLES.map((table: string): string => {
        return `ALTER TABLE "${table}" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`;
      }),
    );
  });

  test("builds no index, adds no key, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(
        /^ALTER TABLE "[A-Za-z]+" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE$/,
      );
    }
  });

  test("down drops every column up added, in reverse, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual(
      [...TABLES].reverse().map((table: string): string => {
        return `ALTER TABLE "${table}" DROP COLUMN "aiAgentResetAt"`;
      }),
    );
  });

  test.each(
    MODELS.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName!, model];
    }),
  )("the %s model declares the column it adds, as a date", (_name, model) => {
    expect(model.getTableColumns().columns).toContain("aiAgentResetAt");
    expect(model.getTableColumnMetadata("aiAgentResetAt").type).toBe(
      TableColumnType.Date,
    );
    expect(model.getTableColumnMetadata("aiAgentResetAt").required).toBe(
      false,
    );
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddAiAgentResetAt1808996200000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Math.max(...timestamps)).toBeGreaterThanOrEqual(
      Number(MIGRATION_TIMESTAMP),
    );

    // After every migration whose file was there before it.
    const earlier: Array<number> = timestamps.filter((value: number) => {
      return value !== Number(MIGRATION_TIMESTAMP);
    });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...earlier.filter((value: number): boolean => {
          return value <= 1808996130000;
        }),
      ),
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
