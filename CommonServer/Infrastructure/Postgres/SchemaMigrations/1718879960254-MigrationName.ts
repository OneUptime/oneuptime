import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1718879960254 implements MigrationInterface {
    public name = 'MigrationName1718879960254'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "CopilotAction" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "codeRepositoryId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "filePath" character varying NOT NULL, "commitHash" character varying NOT NULL, "copilotActionType" character varying NOT NULL, "serviceCatalogId" uuid NOT NULL, "serviceRepositoryId" uuid NOT NULL, "pullRequestId" character varying, "copilotActionStatus" character varying NOT NULL, CONSTRAINT "PK_1a2ad3762ca1616c1f31c04ef1e" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2333094e9d86acd253c95f55c5" ON "CopilotAction" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d1f62129e09784b750ef9143bf" ON "CopilotAction" ("codeRepositoryId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2ffc457556fee646554bea0577" ON "CopilotAction" ("serviceCatalogId") `);
        await queryRunner.query(`CREATE INDEX "IDX_786400c4dce05f85bbbd524424" ON "CopilotAction" ("serviceRepositoryId") `);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_2333094e9d86acd253c95f55c5b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_d1f62129e09784b750ef9143bfe" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_b96813e25e4fecf035232c9a3df" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_0bc946cbe9cc8977246816bd3c6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_2ffc457556fee646554bea05771" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_786400c4dce05f85bbbd5244249" FOREIGN KEY ("serviceRepositoryId") REFERENCES "ServiceRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_786400c4dce05f85bbbd5244249"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_2ffc457556fee646554bea05771"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_0bc946cbe9cc8977246816bd3c6"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_b96813e25e4fecf035232c9a3df"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_d1f62129e09784b750ef9143bfe"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_2333094e9d86acd253c95f55c5b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_786400c4dce05f85bbbd524424"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2ffc457556fee646554bea0577"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d1f62129e09784b750ef9143bf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2333094e9d86acd253c95f55c5"`);
        await queryRunner.query(`DROP TABLE "CopilotAction"`);
    }

}
