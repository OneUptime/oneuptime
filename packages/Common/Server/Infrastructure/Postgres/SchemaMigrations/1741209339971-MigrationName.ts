import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1741209339971 implements MigrationInterface {
  public name = "MigrationName1741209339971";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProjectUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_912199af7fc0be254b07b37306b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_770271904cf388001552bc4755" ON "ProjectUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProjectUserAcceptedTeams" ("projectUserId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_93ca44f68c74f4a859f2bcf260f" PRIMARY KEY ("projectUserId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_54f5c1c6cf385ffa6094430027" ON "ProjectUserAcceptedTeams" ("projectUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1731fb8a4540127d98fd28796" ON "ProjectUserAcceptedTeams" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProjectUserInvitedTeams" ("projectUserId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_59cc028549a2c4e35005277a507" PRIMARY KEY ("projectUserId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_baa3a99d9c899e2e59c545e288" ON "ProjectUserInvitedTeams" ("projectUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aa26c583621dab66eebfba67a4" ON "ProjectUserInvitedTeams" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" ADD CONSTRAINT "FK_770271904cf388001552bc47559" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" ADD CONSTRAINT "FK_b2a608caefe7d8206517083d856" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" ADD CONSTRAINT "FK_c4aa1af08370547825f1c76f70a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" ADD CONSTRAINT "FK_4a79e6f07a902e997f254c8c7eb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserAcceptedTeams" ADD CONSTRAINT "FK_54f5c1c6cf385ffa60944300270" FOREIGN KEY ("projectUserId") REFERENCES "ProjectUser"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserAcceptedTeams" ADD CONSTRAINT "FK_e1731fb8a4540127d98fd28796c" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserInvitedTeams" ADD CONSTRAINT "FK_baa3a99d9c899e2e59c545e288b" FOREIGN KEY ("projectUserId") REFERENCES "ProjectUser"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserInvitedTeams" ADD CONSTRAINT "FK_aa26c583621dab66eebfba67a44" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectUserInvitedTeams" DROP CONSTRAINT "FK_aa26c583621dab66eebfba67a44"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserInvitedTeams" DROP CONSTRAINT "FK_baa3a99d9c899e2e59c545e288b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserAcceptedTeams" DROP CONSTRAINT "FK_e1731fb8a4540127d98fd28796c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUserAcceptedTeams" DROP CONSTRAINT "FK_54f5c1c6cf385ffa60944300270"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" DROP CONSTRAINT "FK_4a79e6f07a902e997f254c8c7eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" DROP CONSTRAINT "FK_c4aa1af08370547825f1c76f70a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" DROP CONSTRAINT "FK_b2a608caefe7d8206517083d856"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectUser" DROP CONSTRAINT "FK_770271904cf388001552bc47559"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa26c583621dab66eebfba67a4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_baa3a99d9c899e2e59c545e288"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectUserInvitedTeams"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1731fb8a4540127d98fd28796"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_54f5c1c6cf385ffa6094430027"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectUserAcceptedTeams"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_770271904cf388001552bc4755"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectUser"`);
  }
}
