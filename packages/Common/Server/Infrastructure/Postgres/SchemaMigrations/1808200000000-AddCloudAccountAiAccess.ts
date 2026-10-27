import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written in the format npm run generate-postgres-migration writes (no
 * database was at hand); the schema drift check holds it to the model.
 *
 *   - "CloudAccount": what OneUptime AI may do in the account through its
 *     Cloud AI agent, the columns every resource an AI agent serves has -
 *     isAiInvestigationEnabled (on), aiRemediationMode (Disabled),
 *     aiCommandAllowlist and the server-written aiAccessLastVerifiedAt,
 *     aiAccessLastError and aiAccessConfiguredAt - and isAiLogReadEnabled,
 *     whether an investigation may read the account's logs (off).
 *
 * Every column has a constant default or none, which Postgres adds without
 * rewriting the table.
 */
export class AddCloudAccountAiAccess1808200000000
  implements MigrationInterface
{
  public name: string = "AddCloudAccountAiAccess1808200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "isAiLogReadEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "isAiLogReadEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "isAiInvestigationEnabled"`,
    );
  }
}
