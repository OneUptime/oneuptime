import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Cloud and App Platforms became two products over one table of rows
 * (CloudResource: App Platforms' environments, Cloud's resources), and a
 * cloud owner or label rule now names the kind of row it is for
 * (CloudResourceOwnerRule / CloudResourceLabelRule `cloudResourceKind`):
 * each product's rules page writes its own and lists its own. Generated with
 * npm run generate-postgres-migration. The column is nullable and every
 * existing rule is left empty - a rule for both kinds - so every rule a
 * project has keeps matching exactly the rows it matched before.
 */
export class AddCloudRuleKind1808760000000 implements MigrationInterface {
  public name: string = "AddCloudRuleKind1808760000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" ADD "cloudResourceKind" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" ADD "cloudResourceKind" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" DROP COLUMN "cloudResourceKind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" DROP COLUMN "cloudResourceKind"`,
    );
  }
}
