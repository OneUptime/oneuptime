import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLlmModelPrice1788300000000 implements MigrationInterface {
  public name: string = "AddLlmModelPrice1788300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LlmModelPrice" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "modelPrefix" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "inputPricePerMillionTokensInUSD" numeric NOT NULL, "outputPricePerMillionTokensInUSD" numeric NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c4cf92c47ce15b3fae65debb444" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f137c3e611115556a475ca9f8" ON "LlmModelPrice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2e35a60cd0af1750162829984" ON "LlmModelPrice" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmModelPrice" ADD CONSTRAINT "FK_0f137c3e611115556a475ca9f88" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmModelPrice" ADD CONSTRAINT "FK_0955d9d3b7b49d0dbeb2011610f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmModelPrice" ADD CONSTRAINT "FK_fe6a5aa119cbb45391d3daa4801" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmModelPrice" DROP CONSTRAINT "FK_fe6a5aa119cbb45391d3daa4801"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmModelPrice" DROP CONSTRAINT "FK_0955d9d3b7b49d0dbeb2011610f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmModelPrice" DROP CONSTRAINT "FK_0f137c3e611115556a475ca9f88"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2e35a60cd0af1750162829984"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f137c3e611115556a475ca9f8"`,
    );
    await queryRunner.query(`DROP TABLE "LlmModelPrice"`);
  }
}
