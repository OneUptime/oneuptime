import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written by hand in the shape npm run generate-postgres-migration gives (no
 * database was running to generate it from), and numbered after the last
 * registered migration.
 *
 * Open source deployments become one record per instance, kept current by a
 * daily check-in from every self-hosted install
 * (OpenSourceDeployment.lastSeenAt). A check-in carries no contact details,
 * so an instance known only from its check-ins has no email or name. Adding
 * a nullable column and dropping NOT NULL rewrite no row.
 */
export class AddOpenSourceDeploymentLastSeenAt1807910000000
  implements MigrationInterface
{
  public name: string = "AddOpenSourceDeploymentLastSeenAt1807910000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenSourceDeployment" ADD "lastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenSourceDeployment" ALTER COLUMN "email" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenSourceDeployment" ALTER COLUMN "name" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenSourceDeployment" ALTER COLUMN "name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenSourceDeployment" ALTER COLUMN "email" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenSourceDeployment" DROP COLUMN "lastSeenAt"`,
    );
  }
}
