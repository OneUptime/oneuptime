import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * dropdownOptions on all nine custom-field tables becomes unbounded text.
 *
 * Hand-written ALTER COLUMN ... TYPE rather than the DROP + ADD pair TypeORM
 * generates for this change: varchar -> text is binary-coercible in Postgres,
 * so the ALTER rewrites nothing and, unlike DROP + ADD, keeps every option
 * list customers have already configured.
 */
export class WidenCustomFieldDropdownOptions1791200000000
  implements MigrationInterface
{
  public name: string = "WidenCustomFieldDropdownOptions1791200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Change dropdownOptions from varchar(500) to text on every custom-field
     * table.
     *
     * The column holds the whole option list of a Dropdown / MultiSelectDropdown
     * custom field, one option per line, so 500 characters is a cap on the
     * number of options rather than on any single value — roughly 43 short
     * options. That is too small for the reference lists these fields exist to
     * model: a country list of 250 entries needs 2716 characters. Since #2974
     * added per-option colours the list is serialised as JSON whenever any
     * option carries one, at which point the same 250 entries need about 10 KB.
     *
     * There are no indexes, constraints or views on these columns, and nothing
     * sorts, groups or filters by them, so widening is free.
     */
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ALTER COLUMN "dropdownOptions" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Revert to varchar(500). Truncate first — option lists written since `up`
     * ran may exceed 500 characters, and Postgres refuses the narrowing cast
     * with "value too long for type character varying(500)" rather than
     * truncating for us.
     *
     * This direction is lossy by nature, and worse than it first looks. A
     * plain newline-separated list loses its overflow and its final option is
     * left half-written. A list where any option carries a colour is stored as
     * a single-line JSON array, so clipping it yields a truncated fragment:
     * parseCustomFieldDropdownOptions sees the leading "[", JSON.parse throws,
     * and the fallback splits on newline and hands back the whole broken
     * fragment as ONE option. Such a list has to be re-entered by hand after a
     * downgrade. That is unavoidable for a narrowing cast, and it is the reason
     * the forward migration is the one worth having.
     *
     * Reverse order of `up`, so the two read as inverses of each other — the
     * shape 1789800000000-WidenSecurityEventLastErrorColumns.ts established.
     * Atomicity does not come from the ordering: migrationsTransactionMode is
     * "each" (DataSourceOptions.ts), so all nine tables commit or roll back
     * together whichever order they are written in.
     */
    await queryRunner.query(
      `UPDATE "TeamMemberCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "TeamCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "StatusPageCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "ScheduledMaintenanceCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "OnCallDutyPolicyCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "MonitorCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "InventoryItemCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "IncidentCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "AlertCustomField" SET "dropdownOptions" = LEFT("dropdownOptions", 500) WHERE LENGTH("dropdownOptions") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ALTER COLUMN "dropdownOptions" TYPE character varying(500)`,
    );
  }
}
