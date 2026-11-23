import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * Data Security drafts the compliance paperwork (#10375):
 *
 *   - "DataStore" gains "legalBasis" and "dataSubjects": the rest of a
 *     store's record of processing, as a person wrote or confirmed it;
 *     "recordDrafts": OneUptime AI's drafts of the record, kept beside it
 *     with the facts each rests on until a person confirms one; and
 *     "impactAssessment": the store's data protection impact assessment;
 *   - "DataSecuritySetting" gains "auditEvidence": the paragraph under each
 *     framework requirement an auditor reads.
 *
 * Each column is nullable with no default, so adding it rewrites nothing
 * and takes no lock a reader or a writer waits behind: an existing store
 * has nothing drafted until OneUptime AI drafts it.
 */
export class AddDataSecurityComplianceDrafts1809187510375
  implements MigrationInterface
{
  public name: string = "AddDataSecurityComplianceDrafts1809187510375";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "legalBasis" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "DataStore" ADD "dataSubjects" jsonb`);
    await queryRunner.query(`ALTER TABLE "DataStore" ADD "recordDrafts" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "impactAssessment" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" ADD "auditEvidence" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" DROP COLUMN "auditEvidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "impactAssessment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "recordDrafts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "dataSubjects"`,
    );
    await queryRunner.query(`ALTER TABLE "DataStore" DROP COLUMN "legalBasis"`);
  }
}
