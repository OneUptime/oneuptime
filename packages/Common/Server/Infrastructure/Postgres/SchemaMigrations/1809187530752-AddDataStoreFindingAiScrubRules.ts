import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * OneUptime AI writes a place's scrub rule once (#10752): "DataStoreFinding"
 * gains
 *
 *   - "aiScrubRuleInputHash": what OneUptime AI was told when it last wrote
 *     a scrub rule for the place - its data type, where it sits, the names
 *     beside it and the shapes of its values - hashed;
 *   - "aiScrubRules": what it wrote then - a pattern, or the attribute to
 *     hide whole - or none.
 *
 * An evaluation of the issue that tells it the same reuses the answer and
 * makes no model call. Both columns are nullable with no default: adding
 * them rewrites nothing, and an existing finding has no answer kept until
 * OneUptime AI is next asked about its place.
 */
export class AddDataStoreFindingAiScrubRules1809187530752
  implements MigrationInterface
{
  public name: string = "AddDataStoreFindingAiScrubRules1809187530752";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "aiScrubRuleInputHash" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "aiScrubRules" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "aiScrubRules"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "aiScrubRuleInputHash"`,
    );
  }
}
