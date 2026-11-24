import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as npm run generate-postgres-migration writes it, alongside
 * AddOnCallPolicyIncidentRole1809187660000, and moved into a migration of
 * its own: "OnCallDutyPolicy" is read by every page and written whenever a
 * policy is changed, and "IncidentRole" by every role given on an incident.
 * So the index on the new "incidentRoleId" column is built online, and its
 * key to "IncidentRole" is added NOT VALID and then validated, without
 * blocking those reads and writes meanwhile. Every existing row's column is
 * null, so the validation finds nothing to refuse. Index and key names are
 * TypeORM's own, so the schema drift check finds nothing to change.
 *
 * The key empties a policy's role when the role is deleted (ON DELETE SET
 * NULL): the policy is kept, and goes on paging, giving nobody a role.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddOnCallPolicyIncidentRoleIndexAndKey1809187660010
  implements MigrationInterface
{
  public name: string = "AddOnCallPolicyIncidentRoleIndexAndKey1809187660010";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_72d246693db0dfe87c9328dd10" ON "OnCallDutyPolicy" ("incidentRoleId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicy" ADD CONSTRAINT "FK_72d246693db0dfe87c9328dd101" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP CONSTRAINT "FK_72d246693db0dfe87c9328dd101"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_72d246693db0dfe87c9328dd10"`,
    );
  }
}
