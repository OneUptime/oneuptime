import { MigrationInterface, QueryRunner } from "typeorm";

export class IncreaseClientSecretLength1768216593272
  implements MigrationInterface
{
  name = "IncreaseClientSecretLength1768216593272";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Change clientSecret from varchar(500) to text to support longer OAuth secrets
     * (e.g., Google service account private keys which are ~1700+ characters)
     */
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "clientSecret" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert back to varchar(500)
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "clientSecret" TYPE character varying(500)`,
    );
  }
}
