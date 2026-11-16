import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Deleting a picture's file keeps what shows it (issue #9069): a person's
 * profile picture, a status page's logo, favicon or cover image, a
 * dashboard's logo or favicon, a probe's or an AI agent's icon.
 *
 * Each referenced its File row ON DELETE CASCADE: deleting the file deleted
 * the person - and, by the database's own cascades from "User", their
 * memberships and every row that goes with an account - or the whole status
 * page, dashboard, probe or AI agent. Nothing deletes such a file today (the
 * File API allows no delete), but any cleanup of unused or replaced files
 * would have. Now the database clears the picture instead (ON DELETE SET
 * NULL), as it already did for a status page's and a dashboard's dark-theme
 * logo.
 *
 * Generated as a DROP and an ADD of each constraint. Each ADD, as generated,
 * goes to OnlineDdl.replaceForeignKey: dropped and added NOT VALID in one
 * statement - an instant's ACCESS EXCLUSIVE on the table and "File", its
 * wait bounded by the migration's lock_timeout - then validated without
 * blocking either table. Safe to run again: a key already replaced and
 * validated is left as it is.
 */
export class KeepOwnersWhenTheirPictureFileIsDeleted1809182520000
  implements MigrationInterface
{
  public name: string = "KeepOwnersWhenTheirPictureFileIsDeleted1809182520000";

  // OnlineDdl.replaceForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "User" ADD CONSTRAINT "FK_1f25f5fc0032f7014482d9c195e" FOREIGN KEY ("profilePictureId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_1f17f293352ebdc3bcf383158cc" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_84df83d1f492a19a08aee465500" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_602b456a61d73a96e97f483064d" FOREIGN KEY ("coverImageFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_2f81cafa1d653e4a023da14e541" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_83b237be936983b34fb7bcf1584" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "Probe" ADD CONSTRAINT "FK_6bd931aae4920e296ea08864cd0" FOREIGN KEY ("iconFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "AIAgent" ADD CONSTRAINT "FK_5b650f1a5349ec3baa09948642d" FOREIGN KEY ("iconFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgent" DROP CONSTRAINT "FK_5b650f1a5349ec3baa09948642d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP CONSTRAINT "FK_6bd931aae4920e296ea08864cd0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_83b237be936983b34fb7bcf1584"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_2f81cafa1d653e4a023da14e541"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_602b456a61d73a96e97f483064d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_84df83d1f492a19a08aee465500"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_1f17f293352ebdc3bcf383158cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP CONSTRAINT "FK_1f25f5fc0032f7014482d9c195e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgent" ADD CONSTRAINT "FK_5b650f1a5349ec3baa09948642d" FOREIGN KEY ("iconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD CONSTRAINT "FK_6bd931aae4920e296ea08864cd0" FOREIGN KEY ("iconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_83b237be936983b34fb7bcf1584" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_2f81cafa1d653e4a023da14e541" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_602b456a61d73a96e97f483064d" FOREIGN KEY ("coverImageFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_84df83d1f492a19a08aee465500" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_1f17f293352ebdc3bcf383158cc" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD CONSTRAINT "FK_1f25f5fc0032f7014482d9c195e" FOREIGN KEY ("profilePictureId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
