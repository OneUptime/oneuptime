import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (the statements TypeORM
 * generates for the models), then renumbered after the last registered
 * migration.
 *
 * Rules can belong to teams (TeamOwnedRuleKinds): a table of owning teams for
 * each kind - the incident and alert on-call rules and their episodes', the
 * incident owner rules and the workspace notification rules. A rule with
 * owning teams is changed and deleted only through them and by project
 * admins; a rule with none is the project's, as every rule is today. Six new
 * tables, empty: nothing existing changes.
 */
export class AddRuleOwningTeams1808995400000 implements MigrationInterface {
    public name = 'AddRuleOwningTeams1808995400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "AlertOnCallRuleOwningTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "alertOnCallRuleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_bf155f3cdf5ce54dde16837b63e" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cef99f21205f5fde8dc4604aa9" ON "AlertOnCallRuleOwningTeam" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_be18a21c10178d3476245510be" ON "AlertOnCallRuleOwningTeam" ("teamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6b1211cc61e48756cefba68cf3" ON "AlertOnCallRuleOwningTeam" ("alertOnCallRuleId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_024f290bf2a7dbec8ddf4c4d0c" ON "AlertOnCallRuleOwningTeam" ("alertOnCallRuleId", "teamId", "projectId") `);
        await queryRunner.query(`CREATE TABLE "AlertEpisodeOnCallRuleOwningTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "alertEpisodeOnCallRuleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c08a0d7f0d07c520f02432e25c1" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_627c5328d184e1332c3b292ea8" ON "AlertEpisodeOnCallRuleOwningTeam" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_cce5bc3f01e8c024634badd5f5" ON "AlertEpisodeOnCallRuleOwningTeam" ("teamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2d4a3bf23423c3d5935001b4b6" ON "AlertEpisodeOnCallRuleOwningTeam" ("alertEpisodeOnCallRuleId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_05b81c0939b5c6e9e02da823dd" ON "AlertEpisodeOnCallRuleOwningTeam" ("alertEpisodeOnCallRuleId", "teamId", "projectId") `);
        await queryRunner.query(`CREATE TABLE "IncidentOnCallRuleOwningTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "incidentOnCallRuleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6557acfb6c0a3a9f622ecd53625" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9ca70619ff03ad9bca1f228eac" ON "IncidentOnCallRuleOwningTeam" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_39bd4094d7920d2e403ab51133" ON "IncidentOnCallRuleOwningTeam" ("teamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4ef87ccb23f969b55dea705745" ON "IncidentOnCallRuleOwningTeam" ("incidentOnCallRuleId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_157a6674c1749431e656ae6501" ON "IncidentOnCallRuleOwningTeam" ("incidentOnCallRuleId", "teamId", "projectId") `);
        await queryRunner.query(`CREATE TABLE "IncidentOwnerRuleOwningTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "incidentOwnerRuleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_3ddcad51fbd15213f4ca0edcabb" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d44f21f0f6918accfea2a9e11d" ON "IncidentOwnerRuleOwningTeam" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2f4ed5e049c0e7bfcd37d9eb06" ON "IncidentOwnerRuleOwningTeam" ("teamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_143b024cdbebffa620fc21b54f" ON "IncidentOwnerRuleOwningTeam" ("incidentOwnerRuleId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_37c7cf566e6f4638d49549167c" ON "IncidentOwnerRuleOwningTeam" ("incidentOwnerRuleId", "teamId", "projectId") `);
        await queryRunner.query(`CREATE TABLE "IncidentEpisodeOnCallRuleOwningTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "incidentEpisodeOnCallRuleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_706109abbd12f40a90069866870" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2be6841a5aacc759338d69f41f" ON "IncidentEpisodeOnCallRuleOwningTeam" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9f8b752e6c7bbf0384ee0711c6" ON "IncidentEpisodeOnCallRuleOwningTeam" ("teamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0f213abd1cc56b8b3b1dd18a11" ON "IncidentEpisodeOnCallRuleOwningTeam" ("incidentEpisodeOnCallRuleId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3cb33deb2ce1bbc045b3f63598" ON "IncidentEpisodeOnCallRuleOwningTeam" ("incidentEpisodeOnCallRuleId", "teamId", "projectId") `);
        await queryRunner.query(`CREATE TABLE "WorkspaceNotificationRuleOwningTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "workspaceNotificationRuleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_eaea3f1f886fbe6b7466184a078" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5dd0570198d6419bd19f700ed6" ON "WorkspaceNotificationRuleOwningTeam" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_8d883a80465242c45f065e4d1b" ON "WorkspaceNotificationRuleOwningTeam" ("teamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_fa05afba2fc95a53f9f9a700e9" ON "WorkspaceNotificationRuleOwningTeam" ("workspaceNotificationRuleId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_36d2749d9e54a0cf23eeaf8abf" ON "WorkspaceNotificationRuleOwningTeam" ("workspaceNotificationRuleId", "teamId", "projectId") `);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" ADD CONSTRAINT "FK_cef99f21205f5fde8dc4604aa9e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" ADD CONSTRAINT "FK_be18a21c10178d3476245510be5" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" ADD CONSTRAINT "FK_6b1211cc61e48756cefba68cf3a" FOREIGN KEY ("alertOnCallRuleId") REFERENCES "AlertOnCallRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" ADD CONSTRAINT "FK_900df05930bba4acf901552d0e3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" ADD CONSTRAINT "FK_9d4dd58f916b7353e3e314da85f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_627c5328d184e1332c3b292ea8c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_cce5bc3f01e8c024634badd5f53" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_2d4a3bf23423c3d5935001b4b6b" FOREIGN KEY ("alertEpisodeOnCallRuleId") REFERENCES "AlertEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_ee7750cb261b35d340db14067d7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_63effa9573d2a3596cf2e264732" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" ADD CONSTRAINT "FK_9ca70619ff03ad9bca1f228eac2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" ADD CONSTRAINT "FK_39bd4094d7920d2e403ab51133f" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" ADD CONSTRAINT "FK_4ef87ccb23f969b55dea705745a" FOREIGN KEY ("incidentOnCallRuleId") REFERENCES "IncidentOnCallRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" ADD CONSTRAINT "FK_9e9d5ae2ce1b6c640287eda390f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" ADD CONSTRAINT "FK_fa51347a4dc545203c254652358" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" ADD CONSTRAINT "FK_d44f21f0f6918accfea2a9e11df" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" ADD CONSTRAINT "FK_2f4ed5e049c0e7bfcd37d9eb06b" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" ADD CONSTRAINT "FK_143b024cdbebffa620fc21b54fd" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" ADD CONSTRAINT "FK_24adde66efd64a9845b693b327a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" ADD CONSTRAINT "FK_3dcda6d829ccc2f7ce7afa36880" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_2be6841a5aacc759338d69f41f3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_9f8b752e6c7bbf0384ee0711c68" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_0f213abd1cc56b8b3b1dd18a11a" FOREIGN KEY ("incidentEpisodeOnCallRuleId") REFERENCES "IncidentEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_5cead0fe9807b028fa77ead3c82" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" ADD CONSTRAINT "FK_4a2d3af35ee38a5d9c5990051c2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" ADD CONSTRAINT "FK_5dd0570198d6419bd19f700ed6a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" ADD CONSTRAINT "FK_8d883a80465242c45f065e4d1b8" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" ADD CONSTRAINT "FK_fa05afba2fc95a53f9f9a700e93" FOREIGN KEY ("workspaceNotificationRuleId") REFERENCES "WorkspaceNotificationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" ADD CONSTRAINT "FK_b6204efa06983243901585a34d6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" ADD CONSTRAINT "FK_4a30e2c4288a11d8f1915b64deb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" DROP CONSTRAINT "FK_4a30e2c4288a11d8f1915b64deb"`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" DROP CONSTRAINT "FK_b6204efa06983243901585a34d6"`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" DROP CONSTRAINT "FK_fa05afba2fc95a53f9f9a700e93"`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" DROP CONSTRAINT "FK_8d883a80465242c45f065e4d1b8"`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationRuleOwningTeam" DROP CONSTRAINT "FK_5dd0570198d6419bd19f700ed6a"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_4a2d3af35ee38a5d9c5990051c2"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_5cead0fe9807b028fa77ead3c82"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_0f213abd1cc56b8b3b1dd18a11a"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_9f8b752e6c7bbf0384ee0711c68"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_2be6841a5aacc759338d69f41f3"`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" DROP CONSTRAINT "FK_3dcda6d829ccc2f7ce7afa36880"`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" DROP CONSTRAINT "FK_24adde66efd64a9845b693b327a"`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" DROP CONSTRAINT "FK_143b024cdbebffa620fc21b54fd"`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" DROP CONSTRAINT "FK_2f4ed5e049c0e7bfcd37d9eb06b"`);
        await queryRunner.query(`ALTER TABLE "IncidentOwnerRuleOwningTeam" DROP CONSTRAINT "FK_d44f21f0f6918accfea2a9e11df"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" DROP CONSTRAINT "FK_fa51347a4dc545203c254652358"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" DROP CONSTRAINT "FK_9e9d5ae2ce1b6c640287eda390f"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" DROP CONSTRAINT "FK_4ef87ccb23f969b55dea705745a"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" DROP CONSTRAINT "FK_39bd4094d7920d2e403ab51133f"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallRuleOwningTeam" DROP CONSTRAINT "FK_9ca70619ff03ad9bca1f228eac2"`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_63effa9573d2a3596cf2e264732"`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_ee7750cb261b35d340db14067d7"`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_2d4a3bf23423c3d5935001b4b6b"`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_cce5bc3f01e8c024634badd5f53"`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeOnCallRuleOwningTeam" DROP CONSTRAINT "FK_627c5328d184e1332c3b292ea8c"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" DROP CONSTRAINT "FK_9d4dd58f916b7353e3e314da85f"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" DROP CONSTRAINT "FK_900df05930bba4acf901552d0e3"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" DROP CONSTRAINT "FK_6b1211cc61e48756cefba68cf3a"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" DROP CONSTRAINT "FK_be18a21c10178d3476245510be5"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallRuleOwningTeam" DROP CONSTRAINT "FK_cef99f21205f5fde8dc4604aa9e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36d2749d9e54a0cf23eeaf8abf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fa05afba2fc95a53f9f9a700e9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8d883a80465242c45f065e4d1b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5dd0570198d6419bd19f700ed6"`);
        await queryRunner.query(`DROP TABLE "WorkspaceNotificationRuleOwningTeam"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3cb33deb2ce1bbc045b3f63598"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0f213abd1cc56b8b3b1dd18a11"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9f8b752e6c7bbf0384ee0711c6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2be6841a5aacc759338d69f41f"`);
        await queryRunner.query(`DROP TABLE "IncidentEpisodeOnCallRuleOwningTeam"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_37c7cf566e6f4638d49549167c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_143b024cdbebffa620fc21b54f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2f4ed5e049c0e7bfcd37d9eb06"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d44f21f0f6918accfea2a9e11d"`);
        await queryRunner.query(`DROP TABLE "IncidentOwnerRuleOwningTeam"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_157a6674c1749431e656ae6501"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4ef87ccb23f969b55dea705745"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_39bd4094d7920d2e403ab51133"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9ca70619ff03ad9bca1f228eac"`);
        await queryRunner.query(`DROP TABLE "IncidentOnCallRuleOwningTeam"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_05b81c0939b5c6e9e02da823dd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2d4a3bf23423c3d5935001b4b6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cce5bc3f01e8c024634badd5f5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_627c5328d184e1332c3b292ea8"`);
        await queryRunner.query(`DROP TABLE "AlertEpisodeOnCallRuleOwningTeam"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_024f290bf2a7dbec8ddf4c4d0c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b1211cc61e48756cefba68cf3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_be18a21c10178d3476245510be"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cef99f21205f5fde8dc4604aa9"`);
        await queryRunner.query(`DROP TABLE "AlertOnCallRuleOwningTeam"`);
    }

}
