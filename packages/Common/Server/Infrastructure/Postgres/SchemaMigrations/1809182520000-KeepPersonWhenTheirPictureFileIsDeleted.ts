import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Deleting a person's profile picture file keeps the person (issue #9069).
 *
 * "User"."profilePictureId" referenced the File row ON DELETE CASCADE:
 * deleting the file that is somebody's picture deleted their account - and,
 * by the database's own cascades from "User", their memberships and every
 * other row that goes with an account. Nothing deletes such a file today
 * (the File API allows no delete), but any cleanup of unused or replaced
 * files would have deleted people. Now the database clears the picture
 * instead (ON DELETE SET NULL); the person stays.
 *
 * Generated as a DROP and an ADD of the same constraint. Its ADD, as
 * generated, goes to OnlineDdl.replaceForeignKey: dropped and added NOT
 * VALID in one statement - an instant's ACCESS EXCLUSIVE on "User" and
 * "File", its wait bounded by the migration's lock_timeout - then validated
 * without blocking either table. Safe to run again.
 */
export class KeepPersonWhenTheirPictureFileIsDeleted1809182520000
  implements MigrationInterface
{
  public name: string = "KeepPersonWhenTheirPictureFileIsDeleted1809182520000";

  // OnlineDdl.replaceForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "User" ADD CONSTRAINT "FK_1f25f5fc0032f7014482d9c195e" FOREIGN KEY ("profilePictureId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP CONSTRAINT "FK_1f25f5fc0032f7014482d9c195e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD CONSTRAINT "FK_1f25f5fc0032f7014482d9c195e" FOREIGN KEY ("profilePictureId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
