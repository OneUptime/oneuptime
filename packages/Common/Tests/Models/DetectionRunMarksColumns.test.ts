/**
 * The columns that make a detection rule's scheduled run do what its
 * matches ask exactly once (#10489).
 *
 * DetectionRule.evaluatingUntil marks a stretch that found matches before
 * it does what they ask; the run's record clears it. Only the detection
 * engine writes it, as it writes lastEvaluatedAt, and whoever reads the rule
 * reads it. SecurityDetection.recentFiringKeys keeps the names of the
 * firings a case detection took, read and written by OneUptime alone.
 *
 * Both are empty until a run writes them, and the migration adds exactly
 * them, nullable, with no default to fill: no rewrite of either table.
 */

import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import SecurityDetection from "../../Models/DatabaseModels/SecurityDetection";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const SCHEMA_MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_NAME: string = "AddDetectionRunMarksAndFiringKeys1809187400000";

const MIGRATION_PATH: string = path.join(
  SCHEMA_MIGRATIONS_DIRECTORY,
  "1809187400000-AddDetectionRunMarksAndFiringKeys.ts",
);

function typeOrmColumn(
  target: ColumnMetadataArgs["target"],
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === target && column.propertyName === propertyName;
  });
}

type Access = {
  create?: Array<Permission>;
  read?: Array<Permission>;
  update?: Array<Permission>;
};

describe("DetectionRule.evaluatingUntil", () => {
  const metadata: () => TableColumnMetadata = (): TableColumnMetadata => {
    return new DetectionRule().getTableColumnMetadata("evaluatingUntil");
  };

  test("is a date, empty until a run marks a stretch", () => {
    expect(metadata().type).toBe(TableColumnType.Date);
    expect(metadata().required).toBe(false);
    expect(
      typeOrmColumn(DetectionRule, "evaluatingUntil")?.options.nullable,
    ).toBe(true);
    expect(
      typeOrmColumn(DetectionRule, "evaluatingUntil")?.options.default,
    ).toBeUndefined();
  });

  test("is written by the detection engine alone, and read as lastEvaluatedAt is", () => {
    const access: Access =
      new DetectionRule().getColumnAccessControlFor("evaluatingUntil") || {};

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(access).toEqual(
      new DetectionRule().getColumnAccessControlFor("lastEvaluatedAt"),
    );
  });
});

describe("DetectionRule.lastFailedAt (#10490)", () => {
  test("is a date, empty while the rule's last run worked", () => {
    expect(
      new DetectionRule().getTableColumnMetadata("lastFailedAt").type,
    ).toBe(TableColumnType.Date);
    expect(typeOrmColumn(DetectionRule, "lastFailedAt")?.options.nullable).toBe(
      true,
    );
  });

  test("is written by the detection engine alone, and read as lastEvaluatedAt is", () => {
    expect(
      new DetectionRule().getColumnAccessControlFor("lastFailedAt"),
    ).toEqual(new DetectionRule().getColumnAccessControlFor("lastEvaluatedAt"));
  });

  test("its migration adds it, nullable, and is registered after the marks'", () => {
    const migration: string = fs.readFileSync(
      path.join(
        SCHEMA_MIGRATIONS_DIRECTORY,
        "1809187410000-AddDetectionRuleLastFailedAt.ts",
      ),
      "utf8",
    );
    const index: string = fs.readFileSync(
      path.join(SCHEMA_MIGRATIONS_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(migration).toContain(
      'ALTER TABLE "DetectionRule" ADD "lastFailedAt" TIMESTAMP WITH TIME ZONE`',
    );
    expect(migration).toContain(
      'ALTER TABLE "DetectionRule" DROP COLUMN "lastFailedAt"',
    );
    expect(
      index.indexOf("  AddDetectionRuleLastFailedAt1809187410000,"),
    ).toBeGreaterThan(index.indexOf(`  ${MIGRATION_NAME},`));
  });
});

describe("SecurityDetection.recentFiringKeys", () => {
  test("is JSON, empty until a firing names itself", () => {
    expect(
      new SecurityDetection().getTableColumnMetadata("recentFiringKeys").type,
    ).toBe(TableColumnType.JSON);
    expect(
      typeOrmColumn(SecurityDetection, "recentFiringKeys")?.options.nullable,
    ).toBe(true);
  });

  test("is read and written by nobody through the API", () => {
    const access: Access =
      new SecurityDetection().getColumnAccessControlFor("recentFiringKeys") ||
      {};

    expect(access.create).toEqual([]);
    expect(access.read).toEqual([]);
    expect(access.update).toEqual([]);
  });
});

describe(`${MIGRATION_NAME}`, () => {
  const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");
  const downAt: number = migration.indexOf("public async down(");
  const up: string = migration.slice(0, downAt);
  const down: string = migration.slice(downAt);

  test("adds exactly the two columns, nullable, and takes them away again", () => {
    expect(up).toContain(
      'ALTER TABLE "DetectionRule" ADD "evaluatingUntil" TIMESTAMP WITH TIME ZONE`',
    );
    expect(up).toContain(
      'ALTER TABLE "SecurityDetection" ADD "recentFiringKeys" jsonb`',
    );
    expect(up).not.toContain("NOT NULL");
    expect(up).not.toContain("DEFAULT");
    expect(down).toContain(
      'ALTER TABLE "SecurityDetection" DROP COLUMN "recentFiringKeys"',
    );
    expect(down).toContain(
      'ALTER TABLE "DetectionRule" DROP COLUMN "evaluatingUntil"',
    );
  });

  test("is registered, so it runs", () => {
    const index: string = fs.readFileSync(
      path.join(SCHEMA_MIGRATIONS_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_NAME} } from "./1809187400000-AddDetectionRunMarksAndFiringKeys";`,
    );
    expect(index).toContain(`  ${MIGRATION_NAME},\n`);
  });
});
