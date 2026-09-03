import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import { AddDropdownOptionsToCustomFields1779619108628 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1779619108628-AddDropdownOptionsToCustomFields";
import { MigrationName1779790539196 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1779790539196-MigrationName";
import { AddInventoryItemArchiveAndCustomFields1786900000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1786900000000-AddInventoryItemArchiveAndCustomFields";
import { WidenCustomFieldDropdownOptions1791200000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1791200000000-WidenCustomFieldDropdownOptions";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
  serializeCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * dropdownOptions was character varying(500) on all nine custom-field tables.
 *
 * The column holds the ENTIRE option list of a Dropdown / MultiSelectDropdown
 * custom field, one option per line, so the 500-character cap bounds the
 * number of options rather than the size of any one value — roughly 43 short
 * options. Reference lists, which is what these fields exist to model, do not
 * fit: a country list of 250 entries needs 2716 characters, and since #2974
 * added per-option colours the list is serialised as JSON whenever any option
 * carries one, pushing the same 250 entries to about 10 KB.
 *
 * Four things have to line up for the fix to hold, and a regression in any one
 * of them silently reintroduces the cap:
 *   1. the entity declares a `text` column with no max length,
 *   2. the @TableColumn metadata says VeryLongText — this is the one that the
 *      server-side length check and the dashboard form both read, so leaving
 *      it as LongText keeps rejecting long lists even after Postgres is wide,
 *   3. the migration widens every one of the nine columns, and its down() can
 *      narrow back without exploding on rows written since, and
 *   4. the migration is registered in SchemaMigrations/Index.ts — an
 *      unregistered migration is dead code that never runs on boot.
 *
 * Pure metadata/mocks — no Postgres connection anywhere.
 */

type CustomFieldModelConstructor = new () => DatabaseBaseModel;

interface CustomFieldModelUnderTest {
  tableName: string;
  modelClass: CustomFieldModelConstructor;
}

const CUSTOM_FIELD_MODELS: Array<CustomFieldModelUnderTest> = [
  { tableName: "AlertCustomField", modelClass: AlertCustomField },
  { tableName: "IncidentCustomField", modelClass: IncidentCustomField },
  {
    tableName: "InventoryItemCustomField",
    modelClass: InventoryItemCustomField,
  },
  { tableName: "MonitorCustomField", modelClass: MonitorCustomField },
  {
    tableName: "OnCallDutyPolicyCustomField",
    modelClass: OnCallDutyPolicyCustomField,
  },
  {
    tableName: "ScheduledMaintenanceCustomField",
    modelClass: ScheduledMaintenanceCustomField,
  },
  { tableName: "StatusPageCustomField", modelClass: StatusPageCustomField },
  { tableName: "TeamCustomField", modelClass: TeamCustomField },
  { tableName: "TeamMemberCustomField", modelClass: TeamMemberCustomField },
];

function dropdownOptionsColumnArgs(
  modelClass: CustomFieldModelConstructor,
): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs) => {
      return column.target === modelClass;
    })
    .find((column: ColumnMetadataArgs) => {
      return column.propertyName === "dropdownOptions";
    });

  if (!args) {
    throw new Error(
      `${modelClass.name}.dropdownOptions has no TypeORM @Column metadata`,
    );
  }

  return args;
}

function makeQueryRunner(): { runner: QueryRunner; query: jest.Mock } {
  const query: jest.Mock = jest.fn().mockResolvedValue(undefined);
  return { runner: { query } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("custom-field dropdownOptions entity declarations", () => {
  test("every model in the registry that has a dropdownOptions column is covered here", () => {
    /*
     * Guards against a tenth custom-field model being added with the old
     * bounded declaration and nobody noticing, which would leave the same
     * feature capped on one resource and unbounded on the rest.
     *
     * `declaring` is derived from the model registry (DatabaseModels/Index),
     * NOT from getMetadataArgsStorage() — that ambient store only holds the
     * modules THIS file imported, which are exactly the nine it also lists, so
     * a metadata-store comparison would be a tautology that a tenth model
     * could never trip. A model must be in the registry to reach TypeORM at
     * all, so a new custom-field model appears here the moment it is added.
     */
    const declaring: Array<string> = (
      DatabaseModels as Array<CustomFieldModelConstructor>
    )
      .filter((modelClass: CustomFieldModelConstructor) => {
        try {
          return new modelClass()
            .getTableColumns()
            .columns.includes("dropdownOptions");
        } catch {
          return false;
        }
      })
      .map((modelClass: CustomFieldModelConstructor) => {
        return modelClass.name;
      })
      .sort();

    const covered: Array<string> = CUSTOM_FIELD_MODELS.map(
      (model: CustomFieldModelUnderTest) => {
        return model.modelClass.name;
      },
    ).sort();

    expect(declaring).toEqual(covered);
  });

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions is a text column, not a bounded varchar",
    ({ modelClass }: CustomFieldModelUnderTest) => {
      expect(dropdownOptionsColumnArgs(modelClass).options.type).toBe(
        ColumnType.VeryLongText,
      );
      expect(ColumnType.VeryLongText).toBe("text");
    },
  );

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions declares no length — a length on a text column is what regenerates drift",
    ({ modelClass }: CustomFieldModelUnderTest) => {
      expect(
        dropdownOptionsColumnArgs(modelClass).options.length,
      ).toBeUndefined();
    },
  );

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions is still nullable, so fields that are not dropdowns are unaffected",
    ({ modelClass }: CustomFieldModelUnderTest) => {
      expect(dropdownOptionsColumnArgs(modelClass).options.nullable).toBe(true);
    },
  );

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions has TableColumn type VeryLongText — the half that gates writes and the form",
    ({ modelClass }: CustomFieldModelUnderTest) => {
      const metadata: TableColumnMetadata =
        new modelClass().getTableColumnMetadata("dropdownOptions");
      expect(metadata.type).toBe(TableColumnType.VeryLongText);
    },
  );

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions has no max length, so neither the server check nor the form can reject a long list",
    ({ modelClass }: CustomFieldModelUnderTest) => {
      const metadata: TableColumnMetadata =
        new modelClass().getTableColumnMetadata("dropdownOptions");
      expect(getMaxLengthFromTableColumnType(metadata.type)).toBeUndefined();
    },
  );

  test("a 250-entry option list, serialised by the real serialiser, exceeds the old 500-char bound", () => {
    /*
     * Guards the premise of the fix against the actual serialiser rather than
     * a hardcoded length: 500 really was the bound, and a reference list of the
     * size this change exists to support really does exceed it — both in the
     * plain newline form and, far more so, in the JSON form used once any
     * option carries a colour. Uses the product serialiser, so the premise
     * cannot silently drift if the encoding changes.
     */
    const oldBound: number | undefined = getMaxLengthFromTableColumnType(
      TableColumnType.LongText,
    );
    expect(oldBound).toBe(500);

    const options: Array<CustomFieldDropdownOption> = Array.from(
      { length: 250 },
      (_unused: unknown, i: number) => {
        return { value: `Country ${i + 1}` };
      },
    );

    const plain: string = serializeCustomFieldDropdownOptions(options);
    expect(plain.length).toBeGreaterThan(oldBound as number);
    expect(parseCustomFieldDropdownOptions(plain)).toHaveLength(250);

    const coloured: string = serializeCustomFieldDropdownOptions(
      options.map((o: CustomFieldDropdownOption, i: number) => {
        return i === 0 ? { ...o, color: "#ff0000" } : o;
      }),
    );
    expect(coloured.length).toBeGreaterThan(plain.length);
    expect(parseCustomFieldDropdownOptions(coloured)).toHaveLength(250);
  });

  test("down()'s LEFT(col, 500) clip leaves a coloured list unparseable — pins the documented downgrade loss", () => {
    /*
     * The migration's down() comment claims that clipping a colour-bearing
     * (single-line JSON) list to 500 chars yields a fragment that
     * parseCustomFieldDropdownOptions cannot JSON.parse, so it falls through to
     * newline splitting and hands back the whole broken fragment as ONE option.
     * That behavioural claim is cheap to pin, so pin it.
     */
    const options: Array<CustomFieldDropdownOption> = Array.from(
      { length: 250 },
      (_unused: unknown, i: number) => {
        return i === 0
          ? { value: `Country ${i + 1}`, color: "#ff0000" }
          : { value: `Country ${i + 1}` };
      },
    );

    const coloured: string = serializeCustomFieldDropdownOptions(options);
    expect(coloured.startsWith("[")).toBe(true);
    expect(coloured.length).toBeGreaterThan(500);

    const clipped: string = coloured.slice(0, 500); // what LEFT(col, 500) does
    expect(parseCustomFieldDropdownOptions(clipped)).toHaveLength(1);
  });
});

describe("WidenCustomFieldDropdownOptions1791200000000 SQL contract", () => {
  const migration: WidenCustomFieldDropdownOptions1791200000000 =
    new WidenCustomFieldDropdownOptions1791200000000();

  test("up() widens exactly the nine custom-field columns to text", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    expect(executedSql(query)).toEqual(
      CUSTOM_FIELD_MODELS.map((model: CustomFieldModelUnderTest) => {
        return `ALTER TABLE "${model.tableName}" ALTER COLUMN "dropdownOptions" TYPE text`;
      }),
    );
  });

  test("up() never drops a column — a DROP + ADD would discard configured option lists", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    for (const sql of executedSql(query)) {
      expect(sql).toContain(`"dropdownOptions"`);
      expect(sql).not.toContain("DROP");
      expect(sql).not.toContain("ADD");
    }
  });

  test("down() clips oversized rows BEFORE narrowing each column, so the revert cannot fail", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.down(runner);

    const statements: Array<string> = executedSql(query);
    expect(statements).toHaveLength(CUSTOM_FIELD_MODELS.length * 2);

    for (let i: number = 0; i < statements.length; i += 2) {
      const clip: string = statements[i] as string;
      const narrow: string = statements[i + 1] as string;

      expect(clip).toContain("UPDATE");
      expect(clip).toContain("LEFT");
      expect(clip).toContain("500");
      expect(narrow).toContain("ALTER COLUMN");
      expect(narrow).toContain("character varying(500)");

      // Both statements in a pair must address the same table.
      const clipTable: string = (clip.match(/"([A-Za-z]+CustomField)"/) ||
        [])[1] as string;
      const narrowTable: string = (narrow.match(/"([A-Za-z]+CustomField)"/) ||
        [])[1] as string;
      expect(clipTable).toBe(narrowTable);
    }
  });

  test("down() covers every table up() widened", async () => {
    const { runner: upRunner, query: upQuery } = makeQueryRunner();
    await migration.up(upRunner);
    const { runner: downRunner, query: downQuery } = makeQueryRunner();
    await migration.down(downRunner);

    const tablesIn: (statements: Array<string>) => Array<string> = (
      statements: Array<string>,
    ) => {
      return Array.from(
        new Set(
          statements
            .map((sql: string) => {
              return (sql.match(/"([A-Za-z]+CustomField)"/) || [])[1];
            })
            .filter(Boolean) as Array<string>,
        ),
      ).sort();
    };

    expect(tablesIn(executedSql(downQuery))).toEqual(
      tablesIn(executedSql(upQuery)),
    );
  });

  test("down() narrows in the exact reverse of the order up() widened", async () => {
    /*
     * Derive the widen order from up()'s OWN emitted SQL, not from the
     * CUSTOM_FIELD_MODELS constant, so this actually pins the mirror property
     * the migration comment commits to: reorder up() and this test must fail.
     */
    const alterTables: (statements: Array<string>) => Array<string> = (
      statements: Array<string>,
    ) => {
      return statements
        .filter((sql: string) => {
          return sql.includes("ALTER COLUMN");
        })
        .map((sql: string) => {
          return (sql.match(/"([A-Za-z]+CustomField)"/) || [])[1] as string;
        });
    };

    const { runner: upRunner, query: upQuery } = makeQueryRunner();
    await migration.up(upRunner);
    const { runner: downRunner, query: downQuery } = makeQueryRunner();
    await migration.down(downRunner);

    const widened: Array<string> = alterTables(executedSql(upQuery));
    const narrowed: Array<string> = alterTables(executedSql(downQuery));

    expect(narrowed).toEqual([...widened].reverse());
  });

  test("the class name carries its own timestamp, matching the file name", () => {
    expect(migration.name).toBe("WidenCustomFieldDropdownOptions1791200000000");
  });
});

describe("WidenCustomFieldDropdownOptions1791200000000 registration", () => {
  test("is registered in SchemaMigrations/Index.ts", () => {
    expect(SchemaMigrations).toContain(
      WidenCustomFieldDropdownOptions1791200000000,
    );
  });

  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return migration === WidenCustomFieldDropdownOptions1791200000000;
      },
    ).length;
    expect(occurrences).toBe(1);
  });

  test("runs after every migration that created one of the columns", () => {
    /*
     * TypeORM runs migrations in ascending order of the 13-digit timestamp it
     * parses off the END of the class name, not in Index.ts array order
     * (MigrationExecutor.getMigrations sorts by parseInt(name.slice(-13))).
     * So this test pins the timestamps, not the positions: widening a column
     * that does not exist yet fails, and all three ADDs carry lower timestamps
     * — seven tables in 1779619108628, TeamCustomField in 1779790539196 and
     * InventoryItemCustomField in 1786900000000.
     */
    const timestampOf: (migration: new () => { name?: string }) => number = (
      migration: new () => { name?: string },
    ) => {
      const name: string = new migration().name || migration.name;
      return Number(name.slice(-13));
    };

    const widenTimestamp: number = timestampOf(
      WidenCustomFieldDropdownOptions1791200000000,
    );

    for (const creator of [
      AddDropdownOptionsToCustomFields1779619108628,
      MigrationName1779790539196,
      AddInventoryItemArchiveAndCustomFields1786900000000,
    ]) {
      // Registered at all — an unregistered creator would never have run.
      expect(SchemaMigrations).toContain(creator);
      expect(widenTimestamp).toBeGreaterThan(timestampOf(creator));
    }
  });
});
