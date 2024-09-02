import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725291476867 implements MigrationInterface {
  public name = "MigrationName1725291476867";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CopilotActionTypePriority" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "codeRepositoryId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "actionType" character varying(100) NOT NULL, "priority" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_e87af58e75ac25610e48807703e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8e9d95bc4e4094b84d812950f" ON "CopilotActionTypePriority" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4c64c718646aebbfe469d6c95" ON "CopilotActionTypePriority" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_d8e9d95bc4e4094b84d812950f2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_a4c64c718646aebbfe469d6c950" FOREIGN KEY ("codeRepositoryId") REFERENCES "CopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_039fd3af73a2c910eee5ed67669" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_01864ec4b8b5f343e484a09128a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_01864ec4b8b5f343e484a09128a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_039fd3af73a2c910eee5ed67669"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_a4c64c718646aebbfe469d6c950"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_d8e9d95bc4e4094b84d812950f2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4c64c718646aebbfe469d6c95"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8e9d95bc4e4094b84d812950f"`,
    );
    await queryRunner.query(`DROP TABLE "CopilotActionTypePriority"`);
  }
}
