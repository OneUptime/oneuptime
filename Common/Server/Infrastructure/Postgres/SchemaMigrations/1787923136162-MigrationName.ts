import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1787923136162 implements MigrationInterface {
  public name = "MigrationName1787923136162";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ThreatIntelFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "apiRootUrl" character varying(500) NOT NULL, "collectionId" character varying(100) NOT NULL, "apiToken" text, "basicAuthUsername" character varying(100), "basicAuthPassword" text, "isEnabled" boolean NOT NULL DEFAULT true, "pollIntervalInMinutes" integer NOT NULL DEFAULT '60', "minimumConfidence" integer NOT NULL DEFAULT '0', "shouldCreateAlert" boolean NOT NULL DEFAULT true, "shouldWriteDetectionFinding" boolean NOT NULL DEFAULT true, "shouldCreateIncident" boolean NOT NULL DEFAULT false, "alertSeverityId" uuid, "incidentSeverityId" uuid, "lastPolledAt" TIMESTAMP WITH TIME ZONE, "cursor" character varying(500), "lastPollSummary" character varying(500), "lastError" text, "lastEvaluatedAt" TIMESTAMP WITH TIME ZONE, "lastMatchAt" TIMESTAMP WITH TIME ZONE, "lastMatchError" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f439b1608d006621778c77a13de" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5cb2e4e831d2e3b78a636e8aa3" ON "ThreatIntelFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a73c0779724e007780632b751" ON "ThreatIntelFeed" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD CONSTRAINT "FK_5cb2e4e831d2e3b78a636e8aa3c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD CONSTRAINT "FK_2ffbb2319e575d9707009ef9621" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD CONSTRAINT "FK_3fa2aadff928287f194db3bdbdd" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD CONSTRAINT "FK_faced98393bfb0882cd8929ac8a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD CONSTRAINT "FK_fa32bd7c42ea2b291e649940c7f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP CONSTRAINT "FK_fa32bd7c42ea2b291e649940c7f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP CONSTRAINT "FK_faced98393bfb0882cd8929ac8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP CONSTRAINT "FK_3fa2aadff928287f194db3bdbdd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP CONSTRAINT "FK_2ffbb2319e575d9707009ef9621"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP CONSTRAINT "FK_5cb2e4e831d2e3b78a636e8aa3c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a73c0779724e007780632b751"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5cb2e4e831d2e3b78a636e8aa3"`,
    );
    await queryRunner.query(`DROP TABLE "ThreatIntelFeed"`);
  }
}
