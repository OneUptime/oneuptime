import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * On-call user groups (WorkspaceUserGroup): a Slack user group or a
 * Microsoft Teams tag whose members OneUptime keeps equal to whoever is on
 * call in the on-call schedules it follows, with the schedules in a join
 * table (WorkspaceUserGroupOnCallDutyPolicySchedule) and what its last sync
 * came to. New tables, so their indexes are built on empty tables and need
 * no online DDL. Existing installations start with none: nothing changes
 * until somebody links a group to a schedule.
 */
export class AddWorkspaceUserGroup1802100000000 implements MigrationInterface {
  public name: string = "AddWorkspaceUserGroup1802100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkspaceUserGroup" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "workspaceType" character varying(100) NOT NULL, "workspaceGroupId" character varying(500) NOT NULL, "workspaceTeamId" character varying(100), "name" character varying(100), "handle" character varying(100), "syncState" jsonb, "syncedAt" TIMESTAMP WITH TIME ZONE, "nextSyncAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0cceb84eb63fd9adb5c41b72175" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_22145664f23a7b74a79869114c" ON "WorkspaceUserGroup" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fcf877dec29e7d4b8c8f424840" ON "WorkspaceUserGroup" ("nextSyncAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e4c29f2eec60c7994db8af913d" ON "WorkspaceUserGroup" ("projectId", "workspaceType", "workspaceGroupId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkspaceUserGroupOnCallDutyPolicySchedule" ("workspaceUserGroupId" uuid NOT NULL, "onCallDutyPolicyScheduleId" uuid NOT NULL, CONSTRAINT "PK_75e500aaf1bca4dffa88c77aaf8" PRIMARY KEY ("workspaceUserGroupId", "onCallDutyPolicyScheduleId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b13400479cbcfc8ce27d0c34f7" ON "WorkspaceUserGroupOnCallDutyPolicySchedule" ("workspaceUserGroupId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b31efdd1fafc73c202c0e1b793" ON "WorkspaceUserGroupOnCallDutyPolicySchedule" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroup" ADD CONSTRAINT "FK_22145664f23a7b74a79869114c6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroup" ADD CONSTRAINT "FK_0bc6339a8ba0d737672731b4e4a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroup" ADD CONSTRAINT "FK_d90fa3858d451b66fcccf1eb3d8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroupOnCallDutyPolicySchedule" ADD CONSTRAINT "FK_b13400479cbcfc8ce27d0c34f74" FOREIGN KEY ("workspaceUserGroupId") REFERENCES "WorkspaceUserGroup"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroupOnCallDutyPolicySchedule" ADD CONSTRAINT "FK_b31efdd1fafc73c202c0e1b7934" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroupOnCallDutyPolicySchedule" DROP CONSTRAINT "FK_b31efdd1fafc73c202c0e1b7934"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroupOnCallDutyPolicySchedule" DROP CONSTRAINT "FK_b13400479cbcfc8ce27d0c34f74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroup" DROP CONSTRAINT "FK_d90fa3858d451b66fcccf1eb3d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroup" DROP CONSTRAINT "FK_0bc6339a8ba0d737672731b4e4a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserGroup" DROP CONSTRAINT "FK_22145664f23a7b74a79869114c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b31efdd1fafc73c202c0e1b793"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b13400479cbcfc8ce27d0c34f7"`,
    );
    await queryRunner.query(
      `DROP TABLE "WorkspaceUserGroupOnCallDutyPolicySchedule"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4c29f2eec60c7994db8af913d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fcf877dec29e7d4b8c8f424840"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_22145664f23a7b74a79869114c"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspaceUserGroup"`);
  }
}
