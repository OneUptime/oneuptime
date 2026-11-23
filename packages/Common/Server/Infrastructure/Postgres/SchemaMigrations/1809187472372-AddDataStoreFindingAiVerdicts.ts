import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * OneUptime AI's verdict on a finding that waits for a person (#10372):
 * "DataStoreFinding" gains
 *
 *   - "aiVerdict", "aiVerdictAnalysis", "aiVerdictAt" and
 *     "aiVerdictInputHash": the verdict - Confirm, Not sensitive or Cannot
 *     tell - its reason and the earlier decisions it cites, when it was
 *     written, and what it was written from (hashed);
 *   - "isConfirmedByAi": OneUptime AI confirmed it on its own, as an AI
 *     rule allows - never precedent for its verdicts;
 *   - "decidedAt": when a person, or OneUptime AI under a rule, last
 *     confirmed it or marked it not sensitive.
 *
 * Each column but "isConfirmedByAi" is nullable with no default, and that
 * one's default is a constant, which Postgres keeps in the catalog: adding
 * them rewrites nothing. An existing finding has no verdict until
 * OneUptime AI gives one, and when its decision was made is not known.
 */
export class AddDataStoreFindingAiVerdicts1809187472372
  implements MigrationInterface
{
  public name: string = "AddDataStoreFindingAiVerdicts1809187472372";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdict" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdictAnalysis" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdictAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdictInputHash" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "isConfirmedByAi" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "decidedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "decidedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "isConfirmedByAi"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "aiVerdictInputHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "aiVerdictAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "aiVerdictAnalysis"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "aiVerdict"`,
    );
  }
}
