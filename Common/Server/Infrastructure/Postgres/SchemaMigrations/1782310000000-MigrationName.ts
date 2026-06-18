import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1782310000000 implements MigrationInterface {
  public name = "MigrationName1782310000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP CONSTRAINT "FK_GlobalSSO_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP CONSTRAINT "FK_GlobalSSO_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP CONSTRAINT "FK_GlobalOIDC_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP CONSTRAINT "FK_GlobalOIDC_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_GlobalSSOProject_globalSsoId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_GlobalSSOProject_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_GlobalSSOProject_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_GlobalOIDCProject_globalOidcId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_GlobalOIDCProject_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_GlobalOIDCProject_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" DROP CONSTRAINT "FK_GlobalSSOProjectTeam_globalSsoProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" DROP CONSTRAINT "FK_GlobalSSOProjectTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" DROP CONSTRAINT "FK_GlobalOIDCProjectTeam_globalOidcProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" DROP CONSTRAINT "FK_GlobalOIDCProjectTeam_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalSSOProject_globalSsoId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalSSOProject_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalSSOProject_globalSsoId_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalOIDCProject_globalOidcId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalOIDCProject_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalOIDCProject_globalOidcId_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalSSOProjectTeam_globalSsoProjectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalSSOProjectTeam_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalOIDCProjectTeam_globalOidcProjectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_GlobalOIDCProjectTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_71298cc376a253647839650fb0" ON "GlobalSSOProject" ("globalSsoId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a58c789ff9fe63f416b0146084" ON "GlobalSSOProject" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e4bf7b1571a065aad6feed4bc" ON "GlobalOIDCProject" ("globalOidcId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8522835aea64186bc53722f31" ON "GlobalOIDCProject" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_390d2b4b9718741c13a9bf3646" ON "GlobalSSOProjectTeam" ("globalSsoProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c088ff9d9ca99dd93a8cbeec50" ON "GlobalSSOProjectTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c9b95c3d5d24e56c003467e82" ON "GlobalOIDCProjectTeam" ("globalOidcProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c11b9a707701e7c10b5b86c9a2" ON "GlobalOIDCProjectTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD CONSTRAINT "FK_1003cf4114a89a4ff7ec16e7406" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD CONSTRAINT "FK_4f520827496e355d4bdfda66120" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD CONSTRAINT "FK_b04eac8e1886aefae5e2b16cddc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD CONSTRAINT "FK_0febb2e4c4d8703fce4bc816b36" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_71298cc376a253647839650fb0b" FOREIGN KEY ("globalSsoId") REFERENCES "GlobalSSO"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_a58c789ff9fe63f416b01460840" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_91f47fc5d7c0f09bec7c9dd3e86" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_8e4bf7b1571a065aad6feed4bca" FOREIGN KEY ("globalOidcId") REFERENCES "GlobalOIDC"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_e8522835aea64186bc53722f314" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_63f1d796f2f259be00f402e936c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" ADD CONSTRAINT "FK_390d2b4b9718741c13a9bf36467" FOREIGN KEY ("globalSsoProjectId") REFERENCES "GlobalSSOProject"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" ADD CONSTRAINT "FK_c088ff9d9ca99dd93a8cbeec50a" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" ADD CONSTRAINT "FK_8c9b95c3d5d24e56c003467e820" FOREIGN KEY ("globalOidcProjectId") REFERENCES "GlobalOIDCProject"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" ADD CONSTRAINT "FK_c11b9a707701e7c10b5b86c9a21" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" DROP CONSTRAINT "FK_c11b9a707701e7c10b5b86c9a21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" DROP CONSTRAINT "FK_8c9b95c3d5d24e56c003467e820"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" DROP CONSTRAINT "FK_c088ff9d9ca99dd93a8cbeec50a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" DROP CONSTRAINT "FK_390d2b4b9718741c13a9bf36467"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_63f1d796f2f259be00f402e936c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_e8522835aea64186bc53722f314"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_8e4bf7b1571a065aad6feed4bca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_91f47fc5d7c0f09bec7c9dd3e86"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_a58c789ff9fe63f416b01460840"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_71298cc376a253647839650fb0b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP CONSTRAINT "FK_0febb2e4c4d8703fce4bc816b36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP CONSTRAINT "FK_b04eac8e1886aefae5e2b16cddc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP CONSTRAINT "FK_4f520827496e355d4bdfda66120"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP CONSTRAINT "FK_1003cf4114a89a4ff7ec16e7406"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c11b9a707701e7c10b5b86c9a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c9b95c3d5d24e56c003467e82"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c088ff9d9ca99dd93a8cbeec50"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_390d2b4b9718741c13a9bf3646"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8522835aea64186bc53722f31"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e4bf7b1571a065aad6feed4bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a58c789ff9fe63f416b0146084"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_71298cc376a253647839650fb0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProjectTeam_teamId" ON "GlobalOIDCProjectTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProjectTeam_globalOidcProjectId" ON "GlobalOIDCProjectTeam" ("globalOidcProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProjectTeam_teamId" ON "GlobalSSOProjectTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProjectTeam_globalSsoProjectId" ON "GlobalSSOProjectTeam" ("globalSsoProjectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_GlobalOIDCProject_globalOidcId_projectId" ON "GlobalOIDCProject" ("globalOidcId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProject_projectId" ON "GlobalOIDCProject" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProject_globalOidcId" ON "GlobalOIDCProject" ("globalOidcId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_GlobalSSOProject_globalSsoId_projectId" ON "GlobalSSOProject" ("globalSsoId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProject_projectId" ON "GlobalSSOProject" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProject_globalSsoId" ON "GlobalSSOProject" ("globalSsoId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" ADD CONSTRAINT "FK_GlobalOIDCProjectTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" ADD CONSTRAINT "FK_GlobalOIDCProjectTeam_globalOidcProjectId" FOREIGN KEY ("globalOidcProjectId") REFERENCES "GlobalOIDCProject"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" ADD CONSTRAINT "FK_GlobalSSOProjectTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" ADD CONSTRAINT "FK_GlobalSSOProjectTeam_globalSsoProjectId" FOREIGN KEY ("globalSsoProjectId") REFERENCES "GlobalSSOProject"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_GlobalOIDCProject_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_GlobalOIDCProject_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_GlobalOIDCProject_globalOidcId" FOREIGN KEY ("globalOidcId") REFERENCES "GlobalOIDC"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_GlobalSSOProject_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_GlobalSSOProject_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_GlobalSSOProject_globalSsoId" FOREIGN KEY ("globalSsoId") REFERENCES "GlobalSSO"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD CONSTRAINT "FK_GlobalOIDC_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD CONSTRAINT "FK_GlobalOIDC_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD CONSTRAINT "FK_GlobalSSO_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD CONSTRAINT "FK_GlobalSSO_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
