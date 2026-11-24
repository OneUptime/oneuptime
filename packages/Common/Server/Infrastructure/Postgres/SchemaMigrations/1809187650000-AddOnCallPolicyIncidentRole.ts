import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An on-call policy can give the people it pages a role on the incident or
 * the incident episode it pages them about ("OnCallDutyPolicy".
 * "incidentRoleId", OnCallPolicyIncidentRole): the on-call person of the
 * team that owns a service is listed under the incident's roles as its
 * Service Owner, say, without anybody adding them. One nullable column, so
 * no row is rewritten: every policy so far gives no role, and keeps null
 * here.
 *
 * Written as npm run generate-postgres-migration writes it. Its index and
 * its key to "IncidentRole" are built online, in
 * AddOnCallPolicyIncidentRoleIndexAndKey1809187650010: every page reads the
 * policy, and a key added in a transaction would hold "OnCallDutyPolicy"
 * and "IncidentRole" while it checked every policy.
 */
export class AddOnCallPolicyIncidentRole1809187650000
  implements MigrationInterface
{
  public name: string = "AddOnCallPolicyIncidentRole1809187650000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD "incidentRoleId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP COLUMN "incidentRoleId"`,
    );
  }
}
