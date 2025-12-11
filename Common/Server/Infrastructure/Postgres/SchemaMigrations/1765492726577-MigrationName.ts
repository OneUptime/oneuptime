import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765492726577 implements MigrationInterface {
    public name = 'MigrationName1765492726577'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "LLM" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "name" character varying(50) NOT NULL, "description" character varying, "slug" character varying(100) NOT NULL, "llmType" character varying(100) NOT NULL, "apiKey" character varying, "modelName" character varying(100), "baseUrl" character varying(100), "projectId" uuid, "deletedByUserId" uuid, "createdByUserId" uuid, "isGlobalLlm" boolean NOT NULL DEFAULT false, "isEnabled" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_165a2fdc1f33b8558c0941cde81" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`ALTER TABLE "LLM" ADD CONSTRAINT "FK_d6a3480f8aec3211cc16b63119f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "LLM" ADD CONSTRAINT "FK_91eb4e5001f05a685982e986618" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "LLM" ADD CONSTRAINT "FK_b1346d9d92e6b55e0676baacc69" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "LLM" DROP CONSTRAINT "FK_b1346d9d92e6b55e0676baacc69"`);
        await queryRunner.query(`ALTER TABLE "LLM" DROP CONSTRAINT "FK_91eb4e5001f05a685982e986618"`);
        await queryRunner.query(`ALTER TABLE "LLM" DROP CONSTRAINT "FK_d6a3480f8aec3211cc16b63119f"`);
        await queryRunner.query(`DROP TABLE "LLM"`);
    }

}
