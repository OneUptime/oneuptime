import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddXcpNgConnections1809187730000, and moved into a migration of its own:
 * XcpNgPool already exists and every XCP-ng ingest batch writes to it, so
 * the foreign key from its new "xcpNgConnectionId" column to
 * "XcpNgConnection" is added NOT VALID and then validated, without blocking
 * either table's writes. Every existing pool's column is null, so the
 * validation finds nothing to refuse. Safe to run again after a stop part
 * way: a key that is already there is left as it is.
 */
export class AddXcpNgPoolConnectionKey1809187730010
  implements MigrationInterface
{
  public name: string = "AddXcpNgPoolConnectionKey1809187730010";

  // The validation runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "XcpNgPool" ADD CONSTRAINT "FK_8dcdc51b7e1f92612016b2b7379" FOREIGN KEY ("xcpNgConnectionId") REFERENCES "XcpNgConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP CONSTRAINT "FK_8dcdc51b7e1f92612016b2b7379"`,
    );
  }
}
