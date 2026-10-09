import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Huntress connections (Incidents > Integrations > Huntress):
 * HuntressConnection is one Huntress webhook endpoint - its encrypted
 * signing secret, the on-call policies and labels it gives incidents
 * (HuntressConnectionOnCallDutyPolicy, HuntressConnectionLabel), the
 * incident severity for each Huntress severity, the organizations it
 * watches; HuntressIncidentReport is every report received, unique per
 * project, Huntress account and report id, so a report opens one incident
 * however often Huntress sends it. All four tables are new, so their indexes
 * and foreign keys are built while nothing writes to them.
 */
export class AddHuntressConnections1800420000000 implements MigrationInterface {
  public name: string = "AddHuntressConnections1800420000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "HuntressConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "signingSecret" text, "isSigningSecretSet" boolean NOT NULL DEFAULT false, "pageOnCallFor" character varying(100) NOT NULL DEFAULT 'high', "criticalIncidentSeverityId" uuid, "highIncidentSeverityId" uuid, "lowIncidentSeverityId" uuid, "watchedOrganizations" text, "resolveIncidentWhenReportCloses" boolean NOT NULL DEFAULT true, "lastEventReceivedAt" TIMESTAMP WITH TIME ZONE, "lastEventType" character varying(100), "lastError" text, "lastErrorAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_3d2baffb4283f5494c9c7aaa148" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b27f99916882386f21ba96196" ON "HuntressConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HuntressIncidentReport" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "huntressConnectionId" uuid, "huntressAccountId" character varying(100) NOT NULL DEFAULT '', "huntressIncidentReportId" character varying(100) NOT NULL, "organizationId" character varying(100), "organizationName" character varying(500), "affectedName" character varying(500), "subject" character varying(500), "severity" character varying(100), "status" character varying(100), "incidentId" uuid, "outcome" character varying(100) NOT NULL, "pagedOnCall" boolean NOT NULL DEFAULT false, "lastEventType" character varying(100), "lastEventReceivedAt" TIMESTAMP WITH TIME ZONE, "appliedMessageIds" jsonb, CONSTRAINT "PK_24d97b06ca52cdef8d6fac1c2d8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd9c8d015e7fcb5436471a5b9e" ON "HuntressIncidentReport" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0add60f51d1e44b3d30b85b735" ON "HuntressIncidentReport" ("huntressConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20031edf420acde3b755ccbd86" ON "HuntressIncidentReport" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e56d1e428af33e7e6879f4ce1c" ON "HuntressIncidentReport" ("projectId", "huntressConnectionId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_147951e2650c8f1b9873454a8d" ON "HuntressIncidentReport" ("projectId", "huntressAccountId", "huntressIncidentReportId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HuntressConnectionOnCallDutyPolicy" ("huntressConnectionId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_baa76b2983168824a4f5b42e4c5" PRIMARY KEY ("huntressConnectionId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b884639c3ca54cc593f90cdacf" ON "HuntressConnectionOnCallDutyPolicy" ("huntressConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ec3e3370b65c178c6b7b31f376" ON "HuntressConnectionOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HuntressConnectionLabel" ("huntressConnectionId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_386f8c747cc6cd87208d6e49e5f" PRIMARY KEY ("huntressConnectionId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f7dbe425b0bb1d1fbd1ce7ddd8" ON "HuntressConnectionLabel" ("huntressConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c387878a1f888b9eed0b03e4db" ON "HuntressConnectionLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" ADD CONSTRAINT "FK_9b27f99916882386f21ba961966" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" ADD CONSTRAINT "FK_b603967e4de6545316afb31baaa" FOREIGN KEY ("criticalIncidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" ADD CONSTRAINT "FK_edfc8fa422b2ac784fdce863abd" FOREIGN KEY ("highIncidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" ADD CONSTRAINT "FK_c38172baa13400117d4994ba8c8" FOREIGN KEY ("lowIncidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" ADD CONSTRAINT "FK_0e5764c4f4282f9b897a8c1204b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" ADD CONSTRAINT "FK_38553805a6e6e93716b752e8f0d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressIncidentReport" ADD CONSTRAINT "FK_cd9c8d015e7fcb5436471a5b9e4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressIncidentReport" ADD CONSTRAINT "FK_0add60f51d1e44b3d30b85b735a" FOREIGN KEY ("huntressConnectionId") REFERENCES "HuntressConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressIncidentReport" ADD CONSTRAINT "FK_20031edf420acde3b755ccbd860" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionOnCallDutyPolicy" ADD CONSTRAINT "FK_b884639c3ca54cc593f90cdacfa" FOREIGN KEY ("huntressConnectionId") REFERENCES "HuntressConnection"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionOnCallDutyPolicy" ADD CONSTRAINT "FK_ec3e3370b65c178c6b7b31f376b" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionLabel" ADD CONSTRAINT "FK_f7dbe425b0bb1d1fbd1ce7ddd88" FOREIGN KEY ("huntressConnectionId") REFERENCES "HuntressConnection"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionLabel" ADD CONSTRAINT "FK_c387878a1f888b9eed0b03e4db9" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionLabel" DROP CONSTRAINT "FK_c387878a1f888b9eed0b03e4db9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionLabel" DROP CONSTRAINT "FK_f7dbe425b0bb1d1fbd1ce7ddd88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionOnCallDutyPolicy" DROP CONSTRAINT "FK_ec3e3370b65c178c6b7b31f376b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnectionOnCallDutyPolicy" DROP CONSTRAINT "FK_b884639c3ca54cc593f90cdacfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressIncidentReport" DROP CONSTRAINT "FK_20031edf420acde3b755ccbd860"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressIncidentReport" DROP CONSTRAINT "FK_0add60f51d1e44b3d30b85b735a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressIncidentReport" DROP CONSTRAINT "FK_cd9c8d015e7fcb5436471a5b9e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" DROP CONSTRAINT "FK_38553805a6e6e93716b752e8f0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" DROP CONSTRAINT "FK_0e5764c4f4282f9b897a8c1204b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" DROP CONSTRAINT "FK_c38172baa13400117d4994ba8c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" DROP CONSTRAINT "FK_edfc8fa422b2ac784fdce863abd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" DROP CONSTRAINT "FK_b603967e4de6545316afb31baaa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HuntressConnection" DROP CONSTRAINT "FK_9b27f99916882386f21ba961966"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c387878a1f888b9eed0b03e4db"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f7dbe425b0bb1d1fbd1ce7ddd8"`,
    );
    await queryRunner.query(`DROP TABLE "HuntressConnectionLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ec3e3370b65c178c6b7b31f376"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b884639c3ca54cc593f90cdacf"`,
    );
    await queryRunner.query(`DROP TABLE "HuntressConnectionOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_147951e2650c8f1b9873454a8d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e56d1e428af33e7e6879f4ce1c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20031edf420acde3b755ccbd86"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0add60f51d1e44b3d30b85b735"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd9c8d015e7fcb5436471a5b9e"`,
    );
    await queryRunner.query(`DROP TABLE "HuntressIncidentReport"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b27f99916882386f21ba96196"`,
    );
    await queryRunner.query(`DROP TABLE "HuntressConnection"`);
  }
}
