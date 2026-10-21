import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Incident and alert video calls: the providers a project connects
 * (VideoCallConnection, with its credentials encrypted) and the calls
 * started for incidents and alerts (IncidentVideoCall, AlertVideoCall).
 * Every table is new, so its indexes and foreign keys are built on an empty
 * table and block nothing.
 */
export class AddVideoCallTables1799700000000 implements MigrationInterface {
  public name = "AddVideoCallTables1799700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "VideoCallConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "provider" character varying(100) NOT NULL, "config" jsonb, "secrets" text, "lastCallStartedAt" TIMESTAMP WITH TIME ZONE, "lastError" text, "lastErrorAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0f50c49b2e74b9dc456f9e8a84c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1c760c7c209397f77318dede1" ON "VideoCallConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2375546266c2ba9000f72ff7a" ON "VideoCallConnection" ("provider") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentVideoCall" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid NOT NULL, "provider" character varying(100) NOT NULL, "videoCallConnectionId" uuid, "title" character varying(500), "joinUrl" text NOT NULL, "externalMeetingId" character varying(500), "workspaceNotificationRuleId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_9245e758aea6fcc04ecc4d94467" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_723b9d590b21e0f8aca75c55cf" ON "IncidentVideoCall" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4b041d805a5d1143fbcd43b363" ON "IncidentVideoCall" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ffc182cf1aa249e56ea98406d4" ON "IncidentVideoCall" ("videoCallConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e1dc83d8274f88af36be13db9" ON "IncidentVideoCall" ("incidentId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertVideoCall" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertId" uuid NOT NULL, "provider" character varying(100) NOT NULL, "videoCallConnectionId" uuid, "title" character varying(500), "joinUrl" text NOT NULL, "externalMeetingId" character varying(500), "workspaceNotificationRuleId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_cc9f88f7940dabaa25dbe21529b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d862f3b5b4ebc948385db7fca7" ON "AlertVideoCall" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_759981eca0cf5671ff6f3bba80" ON "AlertVideoCall" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8efd123c7d6a005f5f9e1ee9d" ON "AlertVideoCall" ("videoCallConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8fb5089fa26cc26fbf4941a7c3" ON "AlertVideoCall" ("alertId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ADD CONSTRAINT "FK_c1c760c7c209397f77318dede18" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ADD CONSTRAINT "FK_e50673fb2e6227f3523e36c6a8f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ADD CONSTRAINT "FK_a2b100a33e23b2623a84298d055" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_723b9d590b21e0f8aca75c55cfe" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_4b041d805a5d1143fbcd43b3632" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_ffc182cf1aa249e56ea98406d46" FOREIGN KEY ("videoCallConnectionId") REFERENCES "VideoCallConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_4ec2cf9383dabb1bbc8bc8b7d37" FOREIGN KEY ("workspaceNotificationRuleId") REFERENCES "WorkspaceNotificationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_d1641931531aee0f177e5f847f0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_c1834725d7cc83babc81ec4ccaf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" ADD CONSTRAINT "FK_d862f3b5b4ebc948385db7fca74" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" ADD CONSTRAINT "FK_759981eca0cf5671ff6f3bba80f" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" ADD CONSTRAINT "FK_e8efd123c7d6a005f5f9e1ee9db" FOREIGN KEY ("videoCallConnectionId") REFERENCES "VideoCallConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" ADD CONSTRAINT "FK_e4f39cc43767c66360608f1b35e" FOREIGN KEY ("workspaceNotificationRuleId") REFERENCES "WorkspaceNotificationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" ADD CONSTRAINT "FK_ec0091fc2ae879ef3d764c39098" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" ADD CONSTRAINT "FK_75e770dd8633dc95b98bf5e4217" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" DROP CONSTRAINT "FK_75e770dd8633dc95b98bf5e4217"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" DROP CONSTRAINT "FK_ec0091fc2ae879ef3d764c39098"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" DROP CONSTRAINT "FK_e4f39cc43767c66360608f1b35e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" DROP CONSTRAINT "FK_e8efd123c7d6a005f5f9e1ee9db"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" DROP CONSTRAINT "FK_759981eca0cf5671ff6f3bba80f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVideoCall" DROP CONSTRAINT "FK_d862f3b5b4ebc948385db7fca74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_c1834725d7cc83babc81ec4ccaf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_d1641931531aee0f177e5f847f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_4ec2cf9383dabb1bbc8bc8b7d37"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_ffc182cf1aa249e56ea98406d46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_4b041d805a5d1143fbcd43b3632"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_723b9d590b21e0f8aca75c55cfe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" DROP CONSTRAINT "FK_a2b100a33e23b2623a84298d055"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" DROP CONSTRAINT "FK_e50673fb2e6227f3523e36c6a8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" DROP CONSTRAINT "FK_c1c760c7c209397f77318dede18"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8fb5089fa26cc26fbf4941a7c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8efd123c7d6a005f5f9e1ee9d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_759981eca0cf5671ff6f3bba80"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d862f3b5b4ebc948385db7fca7"`,
    );
    await queryRunner.query(`DROP TABLE "AlertVideoCall"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e1dc83d8274f88af36be13db9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ffc182cf1aa249e56ea98406d4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b041d805a5d1143fbcd43b363"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_723b9d590b21e0f8aca75c55cf"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentVideoCall"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2375546266c2ba9000f72ff7a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1c760c7c209397f77318dede1"`,
    );
    await queryRunner.query(`DROP TABLE "VideoCallConnection"`);
  }
}
