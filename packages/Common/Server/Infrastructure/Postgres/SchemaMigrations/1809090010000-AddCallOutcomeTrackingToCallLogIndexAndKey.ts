import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCallOutcomeTrackingToCallLog1809090000000, and moved into a migration
 * of its own: "CallLog" already holds every call a project made, and every
 * call that goes out writes to it, so the index on its new
 * "userOnCallLogTimelineId" column is built online, and the foreign key to
 * "UserOnCallLogTimeline" is added NOT VALID and then validated, without
 * blocking those writes meanwhile. Every existing log's column is null, so
 * the validation finds nothing to refuse. Index and key names are
 * TypeORM's own, so the schema drift check finds nothing to change.
 *
 * Safe to run again after a stop part way - and on a database that ran
 * AddCallOutcomeTrackingToCallLog while it still built both itself: an
 * index or key that is already there is left as it is.
 */
export class AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000
  implements MigrationInterface
{
  public name: string =
    "AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_30706ded4048de3ce84e66b536" ON "CallLog" ("userOnCallLogTimelineId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_30706ded4048de3ce84e66b5369" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_30706ded4048de3ce84e66b5369"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_30706ded4048de3ce84e66b536"`,
    );
  }
}
