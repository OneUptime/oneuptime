import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A detection rule's name holds 100 characters, not 50: a rule is named
 * after its Sigma title (by the Rule Library, the rule form and the server),
 * and the Rule Library's own "Failed sign-ins, then a success from the same
 * address" - 53 characters - made Turn on recommended fail with "name length
 * cannot be more than 50 characters". 100 is what every other name in
 * OneUptime holds (ShortText), and what Microsoft Sentinel allows a rule's
 * name; a quarter of SigmaHQ's titles are longer than 50.
 *
 * Generated with npm run generate-postgres-migration, which wrote the change
 * as DROP COLUMN "name" + ADD "name" character varying(100) NOT NULL: that
 * drops every rule's name, and the ADD fails outright on a table that holds
 * a rule (a NOT NULL column with no default). ALTER COLUMN ... TYPE reaches
 * the same schema and keeps the names: widening a varchar is
 * binary-coercible, so Postgres rewrites no row, and "name" is in no index,
 * so nothing is rebuilt - the table is locked only for the catalog change.
 * Same shape as WidenSecurityEventLastErrorColumns1789800000000 and
 * WidenInventoryResourceNameColumns1785930000000.
 */
export class WidenDetectionRuleName1806300000000 implements MigrationInterface {
  public name: string = "WidenDetectionRuleName1806300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ALTER COLUMN "name" TYPE character varying(100)`,
    );
  }

  /*
   * Narrowing back fails on any name written longer than 50 since, so those
   * are cut to fit first: a rule keeps running under the first 50
   * characters of its name.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "DetectionRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );
  }
}
