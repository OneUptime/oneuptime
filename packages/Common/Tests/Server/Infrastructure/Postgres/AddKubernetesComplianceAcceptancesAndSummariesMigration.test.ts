import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddKubernetesComplianceAcceptancesAndSummaries1809186710000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186710000-AddKubernetesComplianceAcceptancesAndSummaries";
import DataSecurityComplianceSetting from "../../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind a Kubernetes cluster's compliance follow-ups: an
 * accepted finding names its object and may expire (#9874), and each
 * cluster keeps a summary of its last scoring (#9876). Five nullable columns
 * with no default, so adding them rewrites nothing; registered once, after
 * every migration before it, and the columns the models declare.
 */

const SETTING: string = "DataSecurityComplianceSetting";
const CLUSTER: string = "KubernetesCluster";
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: true,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function timestampOf(migration: unknown): number {
  return Number(
    MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
  );
}

function columnArgs(
  target: unknown,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (candidate: ColumnMetadataArgs): boolean => {
      return (
        candidate.target === target && candidate.propertyName === propertyName
      );
    },
  );
}

describe("AddKubernetesComplianceAcceptancesAndSummaries1809186710000", () => {
  const migration: AddKubernetesComplianceAcceptancesAndSummaries1809186710000 =
    new AddKubernetesComplianceAcceptancesAndSummaries1809186710000();

  test("adds the five columns, nullable, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "${CLUSTER}" ADD "complianceSummary" jsonb`,
      `ALTER TABLE "${CLUSTER}" ADD "complianceSummaryRefreshedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "${SETTING}" ADD "objectKind" character varying(100)`,
      `ALTER TABLE "${SETTING}" ADD "objectName" character varying(500)`,
      `ALTER TABLE "${SETTING}" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("adds no key, index, default or backfill: a busy cluster table is not rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return migration.up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops the columns up added, the last first", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "${SETTING}" DROP COLUMN "expiresAt"`,
      `ALTER TABLE "${SETTING}" DROP COLUMN "objectName"`,
      `ALTER TABLE "${SETTING}" DROP COLUMN "objectKind"`,
      `ALTER TABLE "${CLUSTER}" DROP COLUMN "complianceSummaryRefreshedAt"`,
      `ALTER TABLE "${CLUSTER}" DROP COLUMN "complianceSummary"`,
    ]);
  });

  test("is registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const position: number = registered.indexOf(
      AddKubernetesComplianceAcceptancesAndSummaries1809186710000,
    );

    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate ===
          AddKubernetesComplianceAcceptancesAndSummaries1809186710000
        );
      }),
    ).toHaveLength(1);
    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(
      timestampOf(AddKubernetesComplianceAcceptancesAndSummaries1809186710000),
    );
    expect(migration.name).toBe(
      "AddKubernetesComplianceAcceptancesAndSummaries1809186710000",
    );
  });

  test("the setting declares the object and the expiry it adds", () => {
    expect(
      columnArgs(DataSecurityComplianceSetting, "objectKind")?.options,
    ).toMatchObject({ nullable: true, length: ColumnLength.ShortText });
    expect(
      columnArgs(DataSecurityComplianceSetting, "objectName")?.options,
    ).toMatchObject({ nullable: true, length: ColumnLength.LongText });
    expect(
      columnArgs(DataSecurityComplianceSetting, "expiresAt")?.options,
    ).toMatchObject({ nullable: true, type: ColumnType.Date });
    expect(
      new DataSecurityComplianceSetting().getTableColumnMetadata("objectName")
        .type,
    ).toBe(TableColumnType.LongText);
  });

  test("the cluster declares its summary and when it was worked out", () => {
    expect(
      columnArgs(KubernetesCluster, "complianceSummary")?.options,
    ).toMatchObject({ nullable: true, type: ColumnType.JSON });
    expect(
      columnArgs(KubernetesCluster, "complianceSummaryRefreshedAt")?.options,
    ).toMatchObject({ nullable: true, type: ColumnType.Date });
    expect(
      new KubernetesCluster().getTableColumnMetadata("complianceSummary").type,
    ).toBe(TableColumnType.JSON);
  });
});
