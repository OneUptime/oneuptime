import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 * Custom roles: a set of permissions named once ("Incident Responder") and
 * given to teams.
 *
 *   - "CustomRole": a project's roles - a name, a description and how many
 *     permissions each holds;
 *   - "CustomRolePermission" (+ "CustomRolePermissionLabel"): a role's
 *     permissions, each with the scope and labels a team's own permission
 *     takes;
 *   - "TeamCustomRole": the roles given to teams, once per team;
 *   - "TeamPermission"."customRoleId" / "teamCustomRoleId" /
 *     "customRolePermissionId": a team's copy of a role's permission names
 *     the role, the role given to the team and the role's own row it copies
 *     (Server/Utils/CustomRole/CustomRoleSync). Every existing row is a
 *     permission given to a team directly, so the three start null and
 *     every team's permissions stay exactly as they are.
 *
 * The new tables are empty, so their indexes and foreign keys are built
 * here. The three columns are nullable with no default, which Postgres adds
 * without rewriting or scanning "TeamPermission"; their indexes and foreign
 * keys are built online in AddTeamPermissionCustomRoleLinks1803150000000.
 */
export class AddCustomRoles1803100000000 implements MigrationInterface {
  public name: string = "AddCustomRoles1803100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CustomRole" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "slug" character varying(100) NOT NULL, "permissionCount" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_0b9be65878363ad07f47bd31d49" UNIQUE ("slug"), CONSTRAINT "PK_128f27287b5d199563ea795408d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d386a65e52ce3c35479c80d481" ON "CustomRole" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_016612c2e1a1a1a92f7983f4b5" ON "CustomRole" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b9be65878363ad07f47bd31d4" ON "CustomRole" ("slug")`,
    );
    await queryRunner.query(
      `CREATE TABLE "CustomRolePermission" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "customRoleId" uuid NOT NULL, "permission" character varying(100) NOT NULL, "scope" character varying(100) NOT NULL DEFAULT 'All', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_1b0d041910133275ed33952ab92" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_95bcd0e679ec0c2a124ba74eec" ON "CustomRolePermission" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eadeaa1844573fac7050f4ca70" ON "CustomRolePermission" ("customRoleId")`,
    );
    await queryRunner.query(
      `CREATE TABLE "TeamCustomRole" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "customRoleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_66c24b0d42e5b5ca7fe72ceabf4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_49e5f7c5c14f4d9d87674fa510" ON "TeamCustomRole" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c91667a9460ccd2fa64a429999" ON "TeamCustomRole" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae5042edb4f7d96b40a12e34a6" ON "TeamCustomRole" ("customRoleId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3dfe2689fd0c1fe57196bcdc2d" ON "TeamCustomRole" ("teamId", "customRoleId", "projectId")`,
    );
    await queryRunner.query(
      `CREATE TABLE "CustomRolePermissionLabel" ("customRolePermissionId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_fa7339bfbdaa7e5f828f96d5f63" PRIMARY KEY ("customRolePermissionId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f60c227ea768ffdcabe6c8ecb7" ON "CustomRolePermissionLabel" ("customRolePermissionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fab0c0cdd27bbccef36ca94a7" ON "CustomRolePermissionLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD "customRoleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD "teamCustomRoleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD "customRolePermissionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRole" ADD CONSTRAINT "FK_d386a65e52ce3c35479c80d4814" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRole" ADD CONSTRAINT "FK_650f7ccb2455ce754df5ee134a8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRole" ADD CONSTRAINT "FK_0e8d74a9a7e6aa2f3e9fa52463d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" ADD CONSTRAINT "FK_95bcd0e679ec0c2a124ba74eecc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" ADD CONSTRAINT "FK_eadeaa1844573fac7050f4ca704" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" ADD CONSTRAINT "FK_99a6e61602eeef45460f23bea91" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" ADD CONSTRAINT "FK_87f97c43da0afcbbdd0bc09695b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" ADD CONSTRAINT "FK_49e5f7c5c14f4d9d87674fa5105" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" ADD CONSTRAINT "FK_c91667a9460ccd2fa64a429999d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" ADD CONSTRAINT "FK_ae5042edb4f7d96b40a12e34a64" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" ADD CONSTRAINT "FK_0206479014c992973290c8b8e74" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" ADD CONSTRAINT "FK_9f3c28eb2f358d204b3fabdaa45" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermissionLabel" ADD CONSTRAINT "FK_f60c227ea768ffdcabe6c8ecb75" FOREIGN KEY ("customRolePermissionId") REFERENCES "CustomRolePermission"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermissionLabel" ADD CONSTRAINT "FK_1fab0c0cdd27bbccef36ca94a78" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermissionLabel" DROP CONSTRAINT "FK_1fab0c0cdd27bbccef36ca94a78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermissionLabel" DROP CONSTRAINT "FK_f60c227ea768ffdcabe6c8ecb75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" DROP CONSTRAINT "FK_9f3c28eb2f358d204b3fabdaa45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" DROP CONSTRAINT "FK_0206479014c992973290c8b8e74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" DROP CONSTRAINT "FK_ae5042edb4f7d96b40a12e34a64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" DROP CONSTRAINT "FK_c91667a9460ccd2fa64a429999d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomRole" DROP CONSTRAINT "FK_49e5f7c5c14f4d9d87674fa5105"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" DROP CONSTRAINT "FK_87f97c43da0afcbbdd0bc09695b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" DROP CONSTRAINT "FK_99a6e61602eeef45460f23bea91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" DROP CONSTRAINT "FK_eadeaa1844573fac7050f4ca704"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRolePermission" DROP CONSTRAINT "FK_95bcd0e679ec0c2a124ba74eecc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRole" DROP CONSTRAINT "FK_0e8d74a9a7e6aa2f3e9fa52463d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRole" DROP CONSTRAINT "FK_650f7ccb2455ce754df5ee134a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomRole" DROP CONSTRAINT "FK_d386a65e52ce3c35479c80d4814"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP COLUMN "customRolePermissionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP COLUMN "teamCustomRoleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP COLUMN "customRoleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fab0c0cdd27bbccef36ca94a7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f60c227ea768ffdcabe6c8ecb7"`,
    );
    await queryRunner.query(`DROP TABLE "CustomRolePermissionLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3dfe2689fd0c1fe57196bcdc2d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae5042edb4f7d96b40a12e34a6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c91667a9460ccd2fa64a429999"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_49e5f7c5c14f4d9d87674fa510"`,
    );
    await queryRunner.query(`DROP TABLE "TeamCustomRole"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eadeaa1844573fac7050f4ca70"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_95bcd0e679ec0c2a124ba74eec"`,
    );
    await queryRunner.query(`DROP TABLE "CustomRolePermission"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b9be65878363ad07f47bd31d4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_016612c2e1a1a1a92f7983f4b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d386a65e52ce3c35479c80d481"`,
    );
    await queryRunner.query(`DROP TABLE "CustomRole"`);
  }
}
