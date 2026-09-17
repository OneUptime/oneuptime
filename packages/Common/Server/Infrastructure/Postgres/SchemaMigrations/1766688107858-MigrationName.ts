import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1766688107858 implements MigrationInterface {
  public name = "MigrationName1766688107858";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIAgentTask" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiAgentId" uuid, "taskType" character varying(100) NOT NULL, "status" character varying(100) NOT NULL DEFAULT 'Scheduled', "statusMessage" character varying, "metadata" jsonb, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_eb04a1e2a82c4ce10c5f7c71199" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d59c1b022154b111bd972b6df" ON "AIAgentTask" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_660485cda8f31485ddcc34521c" ON "AIAgentTask" ("aiAgentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abce8c37353599dcd416f5c8b3" ON "AIAgentTask" ("taskType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a3e7acb3ba2d54e97989b809f6" ON "AIAgentTask" ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" ADD CONSTRAINT "FK_8d59c1b022154b111bd972b6df5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" ADD CONSTRAINT "FK_660485cda8f31485ddcc34521cc" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" ADD CONSTRAINT "FK_ca3dba8a1e85ba0dd227636886a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" ADD CONSTRAINT "FK_e26c0359ca57facf6af5714c12c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" DROP CONSTRAINT "FK_e26c0359ca57facf6af5714c12c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" DROP CONSTRAINT "FK_ca3dba8a1e85ba0dd227636886a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" DROP CONSTRAINT "FK_660485cda8f31485ddcc34521cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTask" DROP CONSTRAINT "FK_8d59c1b022154b111bd972b6df5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a3e7acb3ba2d54e97989b809f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abce8c37353599dcd416f5c8b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_660485cda8f31485ddcc34521c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d59c1b022154b111bd972b6df"`,
    );
    await queryRunner.query(`DROP TABLE "AIAgentTask"`);
  }
}
