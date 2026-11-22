import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run check-postgres-schema-drift alongside
 * AddDiscoveryScanRunRequested1809187450000, and moved into a migration of
 * its own: the key points at "User", which every sign-in writes, and adding
 * it in one statement would hold SHARE ROW EXCLUSIVE on "User" while it
 * checked every scan. So it is added NOT VALID and then validated, without
 * blocking those writes meanwhile. Every existing scan's
 * "runRequestedByUserId" is null, so the validation finds nothing to refuse.
 * The key's name is TypeORM's own, so the schema drift check finds nothing
 * to change.
 *
 * A deleted user leaves the scan, with no one named as having run it (ON
 * DELETE SET NULL), as the scan's creator does. No index: a user's delete
 * reads the scans' table once, and a project holds a handful of scans.
 *
 * Safe to run again after a stop part way: a key that is already there is
 * left as it is.
 */
export class AddDiscoveryScanRunRequestedByUserKey1809187450010
  implements MigrationInterface
{
  public name: string = "AddDiscoveryScanRunRequestedByUserKey1809187450010";

  // The validation runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_2983705c44fc5403d90f47ee14b" FOREIGN KEY ("runRequestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_2983705c44fc5403d90f47ee14b"`,
    );
  }
}
