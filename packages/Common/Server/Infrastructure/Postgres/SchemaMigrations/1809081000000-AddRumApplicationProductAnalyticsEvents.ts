import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Product analytics events (#6444, part two): two RumApplication columns.
 *
 *  - isProductAnalyticsEnabled: whether the browser recorder sends the
 *    application's events (session starts, page views, track() and
 *    metric()) from every session. False for every application that
 *    exists today - turning it on starts a new stream of data, so an
 *    admin decides - and true for a new application, which
 *    RumApplicationService sets when the create leaves it out.
 *  - productAnalyticsUserPropertyKeys: the identify() traits events may
 *    carry for analytics, an allow-list that starts empty.
 *
 * Both NOT NULL with a constant default: Postgres 11 and later add such a
 * column without rewriting a row.
 */
export class AddRumApplicationProductAnalyticsEvents1809081000000
  implements MigrationInterface
{
  public name: string = "AddRumApplicationProductAnalyticsEvents1809081000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "isProductAnalyticsEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "productAnalyticsUserPropertyKeys" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "productAnalyticsUserPropertyKeys"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "isProductAnalyticsEnabled"`,
    );
  }
}
