import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778776830462 implements MigrationInterface {
  public name: string = "MigrationName1778776830462";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "runbookId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_e332f1acf3f81d83ccdd499f722" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5d26cb7ae059b21399bcfa30a" ON "RunbookOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_50a378c7d0063d754ccce99996" ON "RunbookOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7bbd5c2931e3c184188f27933" ON "RunbookOwnerTeam" ("runbookId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dc17ecd70225acd86d96ae0e9a" ON "RunbookOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b57159bdf315d24ac3116739c" ON "RunbookOwnerTeam" ("runbookId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "runbookId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_d733ff1e0e634407ae95d6883ac" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20d098029a6624868133b6d47d" ON "RunbookOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0fb9fc4240cac447061fa23998" ON "RunbookOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c2b47a48249c76e26d7dc0f047" ON "RunbookOwnerUser" ("runbookId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32caf813cf39e83f354990051a" ON "RunbookOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d02f1b9d7f33e124ca2deda720" ON "RunbookOwnerUser" ("runbookId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" ADD CONSTRAINT "FK_f5d26cb7ae059b21399bcfa30ac" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" ADD CONSTRAINT "FK_50a378c7d0063d754ccce99996b" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" ADD CONSTRAINT "FK_a7bbd5c2931e3c184188f279336" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" ADD CONSTRAINT "FK_fbea271da331c78775942948d97" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" ADD CONSTRAINT "FK_c64b244e1306f1ff5c80b2ad443" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" ADD CONSTRAINT "FK_20d098029a6624868133b6d47d4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" ADD CONSTRAINT "FK_0fb9fc4240cac447061fa239980" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" ADD CONSTRAINT "FK_c2b47a48249c76e26d7dc0f0470" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" ADD CONSTRAINT "FK_82b4f02eec75ea52d6b16325cd6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" ADD CONSTRAINT "FK_9ec2e96574697b30db0175792d9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" DROP CONSTRAINT "FK_9ec2e96574697b30db0175792d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" DROP CONSTRAINT "FK_82b4f02eec75ea52d6b16325cd6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" DROP CONSTRAINT "FK_c2b47a48249c76e26d7dc0f0470"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" DROP CONSTRAINT "FK_0fb9fc4240cac447061fa239980"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerUser" DROP CONSTRAINT "FK_20d098029a6624868133b6d47d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" DROP CONSTRAINT "FK_c64b244e1306f1ff5c80b2ad443"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" DROP CONSTRAINT "FK_fbea271da331c78775942948d97"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" DROP CONSTRAINT "FK_a7bbd5c2931e3c184188f279336"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" DROP CONSTRAINT "FK_50a378c7d0063d754ccce99996b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerTeam" DROP CONSTRAINT "FK_f5d26cb7ae059b21399bcfa30ac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d02f1b9d7f33e124ca2deda720"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32caf813cf39e83f354990051a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c2b47a48249c76e26d7dc0f047"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0fb9fc4240cac447061fa23998"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20d098029a6624868133b6d47d"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b57159bdf315d24ac3116739c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dc17ecd70225acd86d96ae0e9a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7bbd5c2931e3c184188f27933"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_50a378c7d0063d754ccce99996"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5d26cb7ae059b21399bcfa30a"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookOwnerTeam"`);
  }
}
