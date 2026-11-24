import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSecurityCasePullRequest1809187520604 implements MigrationInterface {
    name = 'AddSecurityCasePullRequest1809187520604'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "SecurityCasePullRequest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "pullRequestUrl" text NOT NULL, "codeRepositoryId" uuid, "pullRequestNumber" integer, "repoOrganizationName" text, "repoName" character varying(100), "pullRequestState" character varying(100), "mergeCommitSha" character varying(100), "mergedAt" TIMESTAMP WITH TIME ZONE, "deployedAt" TIMESTAMP WITH TIME ZONE, "deployedVersion" character varying(100), "deployedCommitSha" character varying(100), "followedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, CONSTRAINT "PK_45298e1dadc49450bb2ef31e8ab" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a8fb937ec0489fff72151444de" ON "SecurityCasePullRequest" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d2c537c48f568d5d65f5ce9089" ON "SecurityCasePullRequest" ("securityCaseId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e5b54fb3e7ef8f6173905ba394" ON "SecurityCasePullRequest" ("codeRepositoryId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e085146d8d059bd028681a8525" ON "SecurityCasePullRequest" ("pullRequestState") `);
        await queryRunner.query(`CREATE INDEX "IDX_c58114301d92f664de47f07944" ON "SecurityCasePullRequest" ("followedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_2a12a4551058c3d4c62121e489" ON "SecurityCasePullRequest" ("securityCaseId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" ADD CONSTRAINT "FK_a8fb937ec0489fff72151444de3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" ADD CONSTRAINT "FK_d2c537c48f568d5d65f5ce90895" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" ADD CONSTRAINT "FK_e5b54fb3e7ef8f6173905ba394c" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" ADD CONSTRAINT "FK_7843dad59b695db27e1c86c88df" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" DROP CONSTRAINT "FK_7843dad59b695db27e1c86c88df"`);
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" DROP CONSTRAINT "FK_e5b54fb3e7ef8f6173905ba394c"`);
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" DROP CONSTRAINT "FK_d2c537c48f568d5d65f5ce90895"`);
        await queryRunner.query(`ALTER TABLE "SecurityCasePullRequest" DROP CONSTRAINT "FK_a8fb937ec0489fff72151444de3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2a12a4551058c3d4c62121e489"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c58114301d92f664de47f07944"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e085146d8d059bd028681a8525"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e5b54fb3e7ef8f6173905ba394"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d2c537c48f568d5d65f5ce9089"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a8fb937ec0489fff72151444de"`);
        await queryRunner.query(`DROP TABLE "SecurityCasePullRequest"`);
    }

}
