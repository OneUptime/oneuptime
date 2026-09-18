import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725880508430 implements MigrationInterface {
  public name = "MigrationName1725880508430";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "title" character varying(100) NOT NULL, "description" text, "slug" character varying(100) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "currentScheduledMaintenanceStateId" uuid NOT NULL, "changeMonitorStatusToId" uuid, "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "shouldStatusPageSubscribersBeNotifiedOnEventCreated" boolean NOT NULL DEFAULT true, "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing" boolean NOT NULL DEFAULT true, "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded" boolean NOT NULL DEFAULT true, "customFields" jsonb, CONSTRAINT "UQ_389395798bdc01f66af7f579a93" UNIQUE ("slug"), CONSTRAINT "PK_92912fb2ee31a1d2912e0077b65" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4bc0497469ba2ff3f0529b559b" ON "ScheduledMaintenanceTemplate" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80207298923fc3ab7f81dd894e" ON "ScheduledMaintenanceTemplate" ("title") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_389395798bdc01f66af7f579a9" ON "ScheduledMaintenanceTemplate" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aea47be8b8af9673e9639e7dae" ON "ScheduledMaintenanceTemplate" ("currentScheduledMaintenanceStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4cc8c23853c501e97775da6ed3" ON "ScheduledMaintenanceTemplate" ("changeMonitorStatusToId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "scheduledMaintenanceTemplateId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b24970c6b2650f20d7b49f8ecaa" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5f1e2a1690bb206db8e347e3a1" ON "ScheduledMaintenanceTemplateOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b036b7ebd2dac47873ec747569" ON "ScheduledMaintenanceTemplateOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aaa6f86f8051e665c5f89e2d50" ON "ScheduledMaintenanceTemplateOwnerTeam" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "scheduledMaintenanceTemplateId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_5fcc3e2c12a767272df3c5b5bcf" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_140d75c5e19b78bb8ae501e13c" ON "ScheduledMaintenanceTemplateOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdb90f1cfbc8e93f112cdb6d7f" ON "ScheduledMaintenanceTemplateOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6f33a193e706fd33bf73a082d" ON "ScheduledMaintenanceTemplateOwnerUser" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateMonitor" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_02a4a6de799fb67ef398fa4a3c3" PRIMARY KEY ("scheduledMaintenanceTemplateId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0eda8905ca25a3eec57cb19fab" ON "ScheduledMaintenanceTemplateMonitor" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db24c4717822cde914200b7c85" ON "ScheduledMaintenanceTemplateMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateStatusPage" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "statusPageId" uuid NOT NULL, CONSTRAINT "PK_4e794eaefae58b86e93a53d8706" PRIMARY KEY ("scheduledMaintenanceTemplateId", "statusPageId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b57f8cba41ee1e45fe68132565" ON "ScheduledMaintenanceTemplateStatusPage" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f64b739e4faa9a5d049fbd9188" ON "ScheduledMaintenanceTemplateStatusPage" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateLabel" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_04b58817e7f5914ee51715c8010" PRIMARY KEY ("scheduledMaintenanceTemplateId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fce937b99d63f0a489b94725af" ON "ScheduledMaintenanceTemplateLabel" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac1b6389a147d1556e38de4bff" ON "ScheduledMaintenanceTemplateLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_4bc0497469ba2ff3f0529b559bf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_f4c80315f60dcc694fd21777787" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_ee916416bbbc5f73761cbee3d22" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_aea47be8b8af9673e9639e7dae3" FOREIGN KEY ("currentScheduledMaintenanceStateId") REFERENCES "ScheduledMaintenanceState"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_4cc8c23853c501e97775da6ed31" FOREIGN KEY ("changeMonitorStatusToId") REFERENCES "MonitorStatus"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_5f1e2a1690bb206db8e347e3a11" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_b036b7ebd2dac47873ec7475694" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_aaa6f86f8051e665c5f89e2d50f" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_b49e225394926114327cc3ad7ca" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_0c26675c50ec4624c10255a85c9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_140d75c5e19b78bb8ae501e13cb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_fdb90f1cfbc8e93f112cdb6d7f6" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_f6f33a193e706fd33bf73a082d7" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_1c3750c2c2128cf912fa580a45f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_64da70a3e70ddc728b6b15659ca" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateMonitor" ADD CONSTRAINT "FK_0eda8905ca25a3eec57cb19fab5" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateMonitor" ADD CONSTRAINT "FK_db24c4717822cde914200b7c85d" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateStatusPage" ADD CONSTRAINT "FK_b57f8cba41ee1e45fe681325652" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateStatusPage" ADD CONSTRAINT "FK_f64b739e4faa9a5d049fbd91880" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateLabel" ADD CONSTRAINT "FK_fce937b99d63f0a489b94725af8" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateLabel" ADD CONSTRAINT "FK_ac1b6389a147d1556e38de4bff2" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateLabel" DROP CONSTRAINT "FK_ac1b6389a147d1556e38de4bff2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateLabel" DROP CONSTRAINT "FK_fce937b99d63f0a489b94725af8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateStatusPage" DROP CONSTRAINT "FK_f64b739e4faa9a5d049fbd91880"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateStatusPage" DROP CONSTRAINT "FK_b57f8cba41ee1e45fe681325652"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateMonitor" DROP CONSTRAINT "FK_db24c4717822cde914200b7c85d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateMonitor" DROP CONSTRAINT "FK_0eda8905ca25a3eec57cb19fab5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_64da70a3e70ddc728b6b15659ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_1c3750c2c2128cf912fa580a45f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_f6f33a193e706fd33bf73a082d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_fdb90f1cfbc8e93f112cdb6d7f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_140d75c5e19b78bb8ae501e13cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_0c26675c50ec4624c10255a85c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_b49e225394926114327cc3ad7ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_aaa6f86f8051e665c5f89e2d50f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_b036b7ebd2dac47873ec7475694"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_5f1e2a1690bb206db8e347e3a11"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_4cc8c23853c501e97775da6ed31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_aea47be8b8af9673e9639e7dae3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_ee916416bbbc5f73761cbee3d22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_f4c80315f60dcc694fd21777787"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_4bc0497469ba2ff3f0529b559bf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac1b6389a147d1556e38de4bff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fce937b99d63f0a489b94725af"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceTemplateLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f64b739e4faa9a5d049fbd9188"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b57f8cba41ee1e45fe68132565"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceTemplateStatusPage"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db24c4717822cde914200b7c85"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eda8905ca25a3eec57cb19fab"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceTemplateMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6f33a193e706fd33bf73a082d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fdb90f1cfbc8e93f112cdb6d7f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_140d75c5e19b78bb8ae501e13c"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceTemplateOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aaa6f86f8051e665c5f89e2d50"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b036b7ebd2dac47873ec747569"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5f1e2a1690bb206db8e347e3a1"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceTemplateOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4cc8c23853c501e97775da6ed3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aea47be8b8af9673e9639e7dae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_389395798bdc01f66af7f579a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80207298923fc3ab7f81dd894e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4bc0497469ba2ff3f0529b559b"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceTemplate"`);
  }
}
