import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGoogleSecOpsDiagnostics1789060959775
  implements MigrationInterface
{
  public name: string = "AddGoogleSecOpsDiagnostics1789060959775";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "GoogleSecOpsConnectionRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "googleSecOpsConnectionId" uuid NOT NULL, "requestedByUserId" uuid, "type" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "request" jsonb, "result" jsonb, "error" text, CONSTRAINT "PK_edc505ba32341f44a99ff40be50" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0037f8381daf86ddbe38e0b485" ON "GoogleSecOpsConnectionRun" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5fc0c5f4352278ed7c7a8de5d6" ON "GoogleSecOpsConnectionRun" ("googleSecOpsConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dff8018998e3e8d5d702094e21" ON "GoogleSecOpsConnectionRun" ("requestedByUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd32cd9e57cde7e7d75d03457e" ON "GoogleSecOpsConnectionRun" ("projectId", "googleSecOpsConnectionId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" ADD "includeNonAlertingDetections" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" ADD "lastSuccessfulPollAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" ADD "lastEventIngestedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" ADD "lastPollResult" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnectionRun" ADD CONSTRAINT "FK_0037f8381daf86ddbe38e0b4854" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnectionRun" ADD CONSTRAINT "FK_5fc0c5f4352278ed7c7a8de5d65" FOREIGN KEY ("googleSecOpsConnectionId") REFERENCES "GoogleSecOpsConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnectionRun" ADD CONSTRAINT "FK_dff8018998e3e8d5d702094e212" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnectionRun" DROP CONSTRAINT "FK_dff8018998e3e8d5d702094e212"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnectionRun" DROP CONSTRAINT "FK_5fc0c5f4352278ed7c7a8de5d65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnectionRun" DROP CONSTRAINT "FK_0037f8381daf86ddbe38e0b4854"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" DROP COLUMN "lastPollResult"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" DROP COLUMN "lastEventIngestedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" DROP COLUMN "lastSuccessfulPollAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" DROP COLUMN "includeNonAlertingDetections"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd32cd9e57cde7e7d75d03457e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dff8018998e3e8d5d702094e21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5fc0c5f4352278ed7c7a8de5d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0037f8381daf86ddbe38e0b485"`,
    );
    await queryRunner.query(`DROP TABLE "GoogleSecOpsConnectionRun"`);
  }
}
