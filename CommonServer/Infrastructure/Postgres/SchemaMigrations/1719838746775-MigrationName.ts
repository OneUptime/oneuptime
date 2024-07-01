import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719838746775 implements MigrationInterface {
  public name = "MigrationName1719838746775";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProbeOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "probeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_b33e4c1d912b244680e0bace977" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ffffa98ea1d05063733f36e55" ON "ProbeOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90007d943ad04dbef87aefcb6b" ON "ProbeOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9a4b1d48b2eaefefb8f5dceb7" ON "ProbeOwnerTeam" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0a43c04a374168e90b5fe63e7" ON "ProbeOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProbeOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "probeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_6dfa74aadf4e90010fc1e86c76b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e94247bb495236a2931d974cf0" ON "ProbeOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3fbca1f838f73adbba73e81de7" ON "ProbeOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d293a0a28ae8b189814761e9b" ON "ProbeOwnerUser" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da7e9e3e1f350f3f99f0271d85" ON "ProbeOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProbeLabel" ("probeId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_4564a1667bf06e98f36c266e986" PRIMARY KEY ("probeId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_171fad9149ab82a7e83d12286b" ON "ProbeLabel" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab7fd85397d8c70c77c761004d" ON "ProbeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_6ffffa98ea1d05063733f36e557" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_90007d943ad04dbef87aefcb6b7" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_d9a4b1d48b2eaefefb8f5dceb73" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_5f7e1a1dfc8380824e10d83f124" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_e72250699a438e22153d9c32ea3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_e94247bb495236a2931d974cf0a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_3fbca1f838f73adbba73e81de7a" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_5d293a0a28ae8b189814761e9b7" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_011c2a132409253ceb1234695c6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_248df6f39557f114b03dd815bcf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeLabel" ADD CONSTRAINT "FK_171fad9149ab82a7e83d12286b3" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeLabel" ADD CONSTRAINT "FK_ab7fd85397d8c70c77c761004d2" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProbeLabel" DROP CONSTRAINT "FK_ab7fd85397d8c70c77c761004d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeLabel" DROP CONSTRAINT "FK_171fad9149ab82a7e83d12286b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_248df6f39557f114b03dd815bcf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_011c2a132409253ceb1234695c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_5d293a0a28ae8b189814761e9b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_3fbca1f838f73adbba73e81de7a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_e94247bb495236a2931d974cf0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_e72250699a438e22153d9c32ea3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_5f7e1a1dfc8380824e10d83f124"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_d9a4b1d48b2eaefefb8f5dceb73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_90007d943ad04dbef87aefcb6b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_6ffffa98ea1d05063733f36e557"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab7fd85397d8c70c77c761004d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_171fad9149ab82a7e83d12286b"`,
    );
    await queryRunner.query(`DROP TABLE "ProbeLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da7e9e3e1f350f3f99f0271d85"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d293a0a28ae8b189814761e9b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fbca1f838f73adbba73e81de7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e94247bb495236a2931d974cf0"`,
    );
    await queryRunner.query(`DROP TABLE "ProbeOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0a43c04a374168e90b5fe63e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9a4b1d48b2eaefefb8f5dceb7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90007d943ad04dbef87aefcb6b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ffffa98ea1d05063733f36e55"`,
    );
    await queryRunner.query(`DROP TABLE "ProbeOwnerTeam"`);
  }
}
