import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * When a customer last asked us to reissue the Let's Encrypt certificate for a
 * custom domain, on both the status page and the dashboard domain tables.
 *
 * This is the state behind the reissue cooldown: certificates are ordered
 * against a Let's Encrypt account shared by every customer on the
 * installation, so the dashboard button that spends that account's allowance
 * is throttled per domain, and this column is what the throttle reads.
 *
 * Nullable with no default and no backfill. Null means "never reissued", which
 * is exactly true of every domain that exists when this ships, and it is the
 * value that lets the first press of the button through rather than making
 * every existing customer wait out a cooldown they never triggered.
 */
export class AddCertificateReissueRequestedAtToDomains1790300000000
  implements MigrationInterface
{
  public name: string =
    "AddCertificateReissueRequestedAtToDomains1790300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD "certificateReissueRequestedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" ADD "certificateReissueRequestedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" DROP COLUMN "certificateReissueRequestedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP COLUMN "certificateReissueRequestedAt"`,
    );
  }
}
