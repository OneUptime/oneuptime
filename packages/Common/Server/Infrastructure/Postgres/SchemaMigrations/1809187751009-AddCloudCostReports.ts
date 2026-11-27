import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCloudCostReports1809187751009 implements MigrationInterface {
  public name = "AddCloudCostReports1809187751009";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudCostReport" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "scope" character varying(100) NOT NULL DEFAULT 'AllAccounts', "cloudAccountId" uuid, "cloudCostViewId" uuid, "cloudCostGroupId" uuid, "period" character varying(100) NOT NULL DEFAULT 'LastWeek', "costBasis" character varying(100), "isSentToGroupTeams" boolean NOT NULL DEFAULT false, "emailAddresses" jsonb, "slackChannelNames" jsonb, "microsoftTeamsChannelNames" jsonb, "microsoftTeamsTeamName" character varying(100), "outsideRecipientsSetByUserId" uuid, "recurringInterval" jsonb NOT NULL, "sendFirstReportAt" TIMESTAMP WITH TIME ZONE, "timezone" character varying(100), "nextSendAt" TIMESTAMP WITH TIME ZONE, "lastSentAt" TIMESTAMP WITH TIME ZONE, "lastSendResult" jsonb, "createdByUserId" uuid, CONSTRAINT "PK_7cf8cd8024d0d5687f3696263b7" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e394b976a252d4ada9920ee68c" ON "CloudCostReport" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f1306cc1d6a769af505cd47a8" ON "CloudCostReport" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cddffaf4e28a9e0e1be456b405" ON "CloudCostReport" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5220cda3a8c2070e52c29562c" ON "CloudCostReport" ("cloudCostViewId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f4444bd7b93dcdce578e154bb" ON "CloudCostReport" ("cloudCostGroupId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b544241a76f8f23dd772adecdb" ON "CloudCostReport" ("nextSendAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostReportUser" ("cloudCostReportId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_d5ec2cf956281eac5da2a7d7227" PRIMARY KEY ("cloudCostReportId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bdf13940c7ab91436e6faa61a8" ON "CloudCostReportUser" ("cloudCostReportId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_860b2ce721e482a8a5e207aacc" ON "CloudCostReportUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostReportTeam" ("cloudCostReportId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_8f33c6ab7e191db3d95487be52b" PRIMARY KEY ("cloudCostReportId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77f379c9429cb8eb8edc8783cd" ON "CloudCostReportTeam" ("cloudCostReportId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c65ac7c53c326c6827df950fb" ON "CloudCostReportTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" ADD CONSTRAINT "FK_e394b976a252d4ada9920ee68c2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" ADD CONSTRAINT "FK_cddffaf4e28a9e0e1be456b405c" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" ADD CONSTRAINT "FK_e5220cda3a8c2070e52c29562cc" FOREIGN KEY ("cloudCostViewId") REFERENCES "CloudCostView"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" ADD CONSTRAINT "FK_3f4444bd7b93dcdce578e154bb4" FOREIGN KEY ("cloudCostGroupId") REFERENCES "CloudCostGroup"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" ADD CONSTRAINT "FK_6a0e4ca09ab74756e6ce0523a9a" FOREIGN KEY ("outsideRecipientsSetByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" ADD CONSTRAINT "FK_d1e2620ab6a0eecd16dba6a9379" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportUser" ADD CONSTRAINT "FK_bdf13940c7ab91436e6faa61a84" FOREIGN KEY ("cloudCostReportId") REFERENCES "CloudCostReport"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportUser" ADD CONSTRAINT "FK_860b2ce721e482a8a5e207aacc0" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportTeam" ADD CONSTRAINT "FK_77f379c9429cb8eb8edc8783cde" FOREIGN KEY ("cloudCostReportId") REFERENCES "CloudCostReport"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportTeam" ADD CONSTRAINT "FK_2c65ac7c53c326c6827df950fbd" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportTeam" DROP CONSTRAINT "FK_2c65ac7c53c326c6827df950fbd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportTeam" DROP CONSTRAINT "FK_77f379c9429cb8eb8edc8783cde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportUser" DROP CONSTRAINT "FK_860b2ce721e482a8a5e207aacc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReportUser" DROP CONSTRAINT "FK_bdf13940c7ab91436e6faa61a84"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" DROP CONSTRAINT "FK_d1e2620ab6a0eecd16dba6a9379"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" DROP CONSTRAINT "FK_6a0e4ca09ab74756e6ce0523a9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" DROP CONSTRAINT "FK_3f4444bd7b93dcdce578e154bb4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" DROP CONSTRAINT "FK_e5220cda3a8c2070e52c29562cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" DROP CONSTRAINT "FK_cddffaf4e28a9e0e1be456b405c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostReport" DROP CONSTRAINT "FK_e394b976a252d4ada9920ee68c2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2c65ac7c53c326c6827df950fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77f379c9429cb8eb8edc8783cd"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostReportTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_860b2ce721e482a8a5e207aacc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdf13940c7ab91436e6faa61a8"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostReportUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b544241a76f8f23dd772adecdb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f4444bd7b93dcdce578e154bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5220cda3a8c2070e52c29562c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cddffaf4e28a9e0e1be456b405"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f1306cc1d6a769af505cd47a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e394b976a252d4ada9920ee68c"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostReport"`);
  }
}
