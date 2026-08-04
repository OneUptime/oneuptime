import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRemediationVerification1785768089408
  implements MigrationInterface
{
  public name = "AddRemediationVerification1785768089408";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "verificationWindowMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "autoResolveOnVerifiedRecovery" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "verificationStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "verificationDeadlineAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "verificationCompletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "verificationNote" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "verificationWindowMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "autoResolveOnRecovery" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6aa9892fd13093b12e389082c" ON "AutoRemediationSuggestion" ("verificationStatus") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6aa9892fd13093b12e389082c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "autoResolveOnRecovery"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "verificationWindowMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "verificationNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "verificationCompletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "verificationDeadlineAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "verificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "autoResolveOnVerifiedRecovery"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "verificationWindowMinutes"`,
    );
  }
}
