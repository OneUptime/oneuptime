import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. The per-application switch for the browser
 * recorder's same-origin trace propagation (traceparent plus a tracestate
 * member carrying the replay session id on requests to the page's own
 * origin). DEFAULT true turns it on for existing applications as well as new
 * ones; the column is the way to turn it off without a customer redeploy.
 */
export class AddSessionReplaySameOriginTracePropagation1794800000000
  implements MigrationInterface
{
  public name: string =
    "AddSessionReplaySameOriginTracePropagation1794800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplaySameOriginTracePropagation" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplaySameOriginTracePropagation"`,
    );
  }
}
