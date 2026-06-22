import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnforceAudienceValidationToSso1782600000000
  implements MigrationInterface
{
  public name = "AddEnforceAudienceValidationToSso1782600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD "enforceAudienceValidation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" ADD "enforceAudienceValidation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" ADD "enforceAudienceValidation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" DROP COLUMN "enforceAudienceValidation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" DROP COLUMN "enforceAudienceValidation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP COLUMN "enforceAudienceValidation"`,
    );
  }
}
