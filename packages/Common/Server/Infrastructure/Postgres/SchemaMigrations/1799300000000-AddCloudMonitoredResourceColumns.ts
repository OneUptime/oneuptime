import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Cloud resources discovered from cloud monitoring (Azure Monitor,
 * CloudWatch, Cloud Monitoring) live in the CloudResource table next to the
 * cloud environments, told apart by cloudResourceKind. Every existing row is
 * an environment, which is the column's default. Adding a column with a
 * constant default rewrites no rows on Postgres 11 and later.
 */
export class AddCloudMonitoredResourceColumns1799300000000
  implements MigrationInterface
{
  public name = "AddCloudMonitoredResourceColumns1799300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudResourceKind" character varying(100) NOT NULL DEFAULT 'environment'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "providerResourceId" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudResourceGroup" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "telemetryAttributes" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "autoArchivedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "autoArchivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "telemetryAttributes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudResourceGroup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "providerResourceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudResourceKind"`,
    );
  }
}
