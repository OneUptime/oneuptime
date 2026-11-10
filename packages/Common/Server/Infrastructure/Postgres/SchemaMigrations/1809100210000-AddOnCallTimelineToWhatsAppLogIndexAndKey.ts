import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddOnCallTimelineToWhatsAppLog1809100200000, and moved into a migration of
 * its own: "WhatsAppLog" already holds every WhatsApp message a project
 * sent, and every message that goes out writes to it, so the index on its
 * new "userOnCallLogTimelineId" column is built online, and the foreign key
 * to "UserOnCallLogTimeline" is added NOT VALID and then validated, without
 * blocking those writes meanwhile. Every existing log's column is null, so
 * the validation finds nothing to refuse. Index and key names are TypeORM's
 * own, so the schema drift check finds nothing to change.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddOnCallTimelineToWhatsAppLogIndexAndKey1809100210000
  implements MigrationInterface
{
  public name: string =
    "AddOnCallTimelineToWhatsAppLogIndexAndKey1809100210000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f6f9b9b3a51e0eee9b1bfa95b7" ON "WhatsAppLog" ("userOnCallLogTimelineId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_f6f9b9b3a51e0eee9b1bfa95b76" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_f6f9b9b3a51e0eee9b1bfa95b76"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f6f9b9b3a51e0eee9b1bfa95b7"`,
    );
  }
}
