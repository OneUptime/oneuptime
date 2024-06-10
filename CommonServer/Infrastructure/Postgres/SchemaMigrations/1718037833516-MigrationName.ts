import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1718037833516 implements MigrationInterface {
    name = 'MigrationName1718037833516';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "CopilotEvent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "codeRepositoryId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "filePath" character varying NOT NULL, "commitHash" character varying NOT NULL, "copilotEventType" character varying NOT NULL, CONSTRAINT "PK_df9ab694204304a1416a720bbfc" PRIMARY KEY ("_id"))`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_02c9884520b692949fea5c65f9" ON "CopilotEvent" ("projectId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e9db4a03a7d521b1d242ff3c9a" ON "CopilotEvent" ("codeRepositoryId") `
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_02c9884520b692949fea5c65f9c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_e9db4a03a7d521b1d242ff3c9a2" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_7ff1de5682d290b1686848fc5cf" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_81c5f57878dd2230d2eec3bcb44" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_81c5f57878dd2230d2eec3bcb44"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_7ff1de5682d290b1686848fc5cf"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_e9db4a03a7d521b1d242ff3c9a2"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_02c9884520b692949fea5c65f9c"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_e9db4a03a7d521b1d242ff3c9a"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_02c9884520b692949fea5c65f9"`
        );
        await queryRunner.query(`DROP TABLE "CopilotEvent"`);
    }
}
