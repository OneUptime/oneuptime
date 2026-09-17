import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * These foreign keys previously used `ON DELETE SET NULL` even though their
 * referencing columns are `NOT NULL`. Deleting the referenced row (e.g. a User
 * or an IncidentRole) therefore tried to set the column to NULL and failed with
 * a not-null constraint violation. Since each of these columns is required, the
 * dependent row is meaningless without its parent, so the correct behavior is
 * `ON DELETE CASCADE`.
 */
export class FixNotNullForeignKeysOnDelete1783510935686
  implements MigrationInterface
{
  public name = "FixNotNullForeignKeysOnDelete1783510935686";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_6e8334ec5b25d596548c88d0832"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" DROP CONSTRAINT "FK_43da7ffeee531e9452d36a89ba5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_08c8933e37d14069c0d18b34f14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_4b3f696aaaf327b245ebeb3d146"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_8771068ec4c16763a7ff796895d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_6e8334ec5b25d596548c88d0832" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" ADD CONSTRAINT "FK_43da7ffeee531e9452d36a89ba5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_08c8933e37d14069c0d18b34f14" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_4b3f696aaaf327b245ebeb3d146" FOREIGN KEY ("overrideUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_8771068ec4c16763a7ff796895d" FOREIGN KEY ("routeAlertsToUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_8771068ec4c16763a7ff796895d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_4b3f696aaaf327b245ebeb3d146"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_08c8933e37d14069c0d18b34f14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" DROP CONSTRAINT "FK_43da7ffeee531e9452d36a89ba5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" DROP CONSTRAINT "FK_6e8334ec5b25d596548c88d0832"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_8771068ec4c16763a7ff796895d" FOREIGN KEY ("routeAlertsToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_4b3f696aaaf327b245ebeb3d146" FOREIGN KEY ("overrideUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_08c8933e37d14069c0d18b34f14" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" ADD CONSTRAINT "FK_43da7ffeee531e9452d36a89ba5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMember" ADD CONSTRAINT "FK_6e8334ec5b25d596548c88d0832" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
