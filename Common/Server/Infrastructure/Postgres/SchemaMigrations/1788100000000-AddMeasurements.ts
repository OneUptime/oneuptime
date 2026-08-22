import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMeasurements1788100000000 implements MigrationInterface {
  public name = "AddMeasurements1788100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentMeasurement" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "key" character varying(100) NOT NULL, "description" character varying(500), "metricName" character varying(100) NOT NULL, "startAnchorType" character varying(100) NOT NULL, "endAnchorType" character varying(100) NOT NULL, "startIncidentStateId" uuid, "endIncidentStateId" uuid, "startIncidentStateRole" character varying(100), "endIncidentStateRole" character varying(100), "startStateOccurrence" character varying(100) DEFAULT 'First', "endStateOccurrence" character varying(100) DEFAULT 'First', "unit" character varying(100) DEFAULT 'seconds', "aggregationType" character varying(100) DEFAULT 'Avg', "isEnabled" boolean NOT NULL DEFAULT true, "showOnIncidentView" boolean NOT NULL DEFAULT true, "order" integer NOT NULL DEFAULT '1', "isSystemDefined" boolean NOT NULL DEFAULT false, "backfillRequestedAt" TIMESTAMP WITH TIME ZONE, "backfillCursorCreatedAt" TIMESTAMP WITH TIME ZONE, "backfillCompletedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b63aa88c70bcc2a9092d4a2bb52" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4bb2eeba1479a85aaec28352d7" ON "IncidentMeasurement" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0228a178ab48344ffd16f6d161" ON "IncidentMeasurement" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c90a0730d38919406d865fe407" ON "IncidentMeasurement" ("key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3270145bf369fa6ab151ed87a4" ON "IncidentMeasurement" ("startIncidentStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f532fc9bff46fe6c03a348068" ON "IncidentMeasurement" ("endIncidentStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9fc934cd452e16238e63f5029" ON "IncidentMeasurement" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_436b0a605f61be0db556a2832b" ON "IncidentMeasurement" ("order") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8f7e13fe765b9e44a96617e6bc" ON "IncidentMeasurement" ("projectId", "key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentMeasurementValue" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid NOT NULL, "incidentMeasurementId" uuid NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "valueInSeconds" integer, "status" character varying(100) NOT NULL DEFAULT 'Pending', "statusMessage" character varying(500), "startIncidentStateTimelineId" uuid, "endIncidentStateTimelineId" uuid, "computedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1ff18d23bfaa5e2bb41584fddf9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b6ed656c48d7620108b99d81cd" ON "IncidentMeasurementValue" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24dbe2aac2f22edb6fa1e3ea8a" ON "IncidentMeasurementValue" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47aa6f05bed26266dd2d5ade7d" ON "IncidentMeasurementValue" ("incidentMeasurementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48fb00fdbea5e11c3ea529071d" ON "IncidentMeasurementValue" ("valueInSeconds") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccd95220cefeb3fbfbe444a48b" ON "IncidentMeasurementValue" ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ad37a1c1f3c9b5f1d42b08de89" ON "IncidentMeasurementValue" ("incidentId", "incidentMeasurementId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertMeasurement" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "key" character varying(100) NOT NULL, "description" character varying(500), "metricName" character varying(100) NOT NULL, "startAnchorType" character varying(100) NOT NULL, "endAnchorType" character varying(100) NOT NULL, "startAlertStateId" uuid, "endAlertStateId" uuid, "startAlertStateRole" character varying(100), "endAlertStateRole" character varying(100), "startStateOccurrence" character varying(100) DEFAULT 'First', "endStateOccurrence" character varying(100) DEFAULT 'First', "unit" character varying(100) DEFAULT 'seconds', "aggregationType" character varying(100) DEFAULT 'Avg', "isEnabled" boolean NOT NULL DEFAULT true, "showOnAlertView" boolean NOT NULL DEFAULT true, "order" integer NOT NULL DEFAULT '1', "isSystemDefined" boolean NOT NULL DEFAULT false, "backfillRequestedAt" TIMESTAMP WITH TIME ZONE, "backfillCursorCreatedAt" TIMESTAMP WITH TIME ZONE, "backfillCompletedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c217c4f44919c0fd1f38a6c0011" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4780aa79cfcb70140d25685ead" ON "AlertMeasurement" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e5f5b2c335ef4e0641dc7aa62" ON "AlertMeasurement" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a06f185bdcfd6cee978297f21" ON "AlertMeasurement" ("key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80c93f51e33fce330f32e8ce2d" ON "AlertMeasurement" ("startAlertStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_17178f34b59610e3e4e659351d" ON "AlertMeasurement" ("endAlertStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_215c26643846e9ab43fb154f36" ON "AlertMeasurement" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f62933bd4e82a45081970bef78" ON "AlertMeasurement" ("order") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b04c704778ad3b81a6085e4419" ON "AlertMeasurement" ("projectId", "key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertMeasurementValue" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertId" uuid NOT NULL, "alertMeasurementId" uuid NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "valueInSeconds" integer, "status" character varying(100) NOT NULL DEFAULT 'Pending', "statusMessage" character varying(500), "startAlertStateTimelineId" uuid, "endAlertStateTimelineId" uuid, "computedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9eabfe70b4734919fe55bd63313" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b914406e7723ecc476110fc79f" ON "AlertMeasurementValue" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_59ea9279ec8500b77e649a2e8e" ON "AlertMeasurementValue" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00d9747fdfbd0e6740eb8fc69d" ON "AlertMeasurementValue" ("alertMeasurementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f23ff68f2848657f3ab5883440" ON "AlertMeasurementValue" ("valueInSeconds") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_26423cecf70d8a9436bd953a13" ON "AlertMeasurementValue" ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_73bee7a7805ec991b991fb1a8d" ON "AlertMeasurementValue" ("alertId", "alertMeasurementId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceMeasurement" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "key" character varying(100) NOT NULL, "description" character varying(500), "metricName" character varying(100) NOT NULL, "startAnchorType" character varying(100) NOT NULL, "endAnchorType" character varying(100) NOT NULL, "startScheduledMaintenanceStateId" uuid, "endScheduledMaintenanceStateId" uuid, "startScheduledMaintenanceStateRole" character varying(100), "endScheduledMaintenanceStateRole" character varying(100), "startStateOccurrence" character varying(100) DEFAULT 'First', "endStateOccurrence" character varying(100) DEFAULT 'First', "unit" character varying(100) DEFAULT 'seconds', "aggregationType" character varying(100) DEFAULT 'Avg', "isEnabled" boolean NOT NULL DEFAULT true, "showOnScheduledMaintenanceView" boolean NOT NULL DEFAULT true, "order" integer NOT NULL DEFAULT '1', "isSystemDefined" boolean NOT NULL DEFAULT false, "backfillRequestedAt" TIMESTAMP WITH TIME ZONE, "backfillCursorCreatedAt" TIMESTAMP WITH TIME ZONE, "backfillCompletedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_99860965c14f50db32dad7ec9af" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c066bdc7849e2d4d73d5f11be7" ON "ScheduledMaintenanceMeasurement" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f61748d98aeec13c6010559a2a" ON "ScheduledMaintenanceMeasurement" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fce9fc20f44a0bbb34b3b2fd63" ON "ScheduledMaintenanceMeasurement" ("key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4823f52854290b0205f17a9968" ON "ScheduledMaintenanceMeasurement" ("startScheduledMaintenanceStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e4bd9930063375be1d29cc244" ON "ScheduledMaintenanceMeasurement" ("endScheduledMaintenanceStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a474d68553920a24346e2a694" ON "ScheduledMaintenanceMeasurement" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7cbd52c6913666c4656867a0a1" ON "ScheduledMaintenanceMeasurement" ("order") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bb3486578e2e4a6cd437d1dbd2" ON "ScheduledMaintenanceMeasurement" ("projectId", "key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceMeasurementValue" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "scheduledMaintenanceId" uuid NOT NULL, "scheduledMaintenanceMeasurementId" uuid NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "valueInSeconds" integer, "status" character varying(100) NOT NULL DEFAULT 'Pending', "statusMessage" character varying(500), "startScheduledMaintenanceStateTimelineId" uuid, "endScheduledMaintenanceStateTimelineId" uuid, "computedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_60f1ecbb3f29616d326144eb930" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d005630c98d5147e70f1cb0e4" ON "ScheduledMaintenanceMeasurementValue" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a56522d2f40a8a975f868364d" ON "ScheduledMaintenanceMeasurementValue" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c7969aeb81562016806421dd3" ON "ScheduledMaintenanceMeasurementValue" ("scheduledMaintenanceMeasurementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbaa06c1ac0024314ef03f4e86" ON "ScheduledMaintenanceMeasurementValue" ("valueInSeconds") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90b70e49330e0f5db44b039460" ON "ScheduledMaintenanceMeasurementValue" ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_815c11e4c8c9b6557995b6456f" ON "ScheduledMaintenanceMeasurementValue" ("scheduledMaintenanceId", "scheduledMaintenanceMeasurementId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "impactStartedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "impactStartedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7753a9da84cb33b66477f2eb13" ON "Incident" ("impactStartedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2881110ef797a56914f86a557" ON "Alert" ("impactStartedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" ADD CONSTRAINT "FK_4bb2eeba1479a85aaec28352d79" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" ADD CONSTRAINT "FK_3270145bf369fa6ab151ed87a44" FOREIGN KEY ("startIncidentStateId") REFERENCES "IncidentState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" ADD CONSTRAINT "FK_7f532fc9bff46fe6c03a3480682" FOREIGN KEY ("endIncidentStateId") REFERENCES "IncidentState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" ADD CONSTRAINT "FK_84efaebce32b0b58d41c2ff2f46" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" ADD CONSTRAINT "FK_5132d6cca9f27d19ef0b5862ca8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurementValue" ADD CONSTRAINT "FK_b6ed656c48d7620108b99d81cd6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurementValue" ADD CONSTRAINT "FK_24dbe2aac2f22edb6fa1e3ea8a6" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurementValue" ADD CONSTRAINT "FK_47aa6f05bed26266dd2d5ade7d4" FOREIGN KEY ("incidentMeasurementId") REFERENCES "IncidentMeasurement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" ADD CONSTRAINT "FK_4780aa79cfcb70140d25685ead0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" ADD CONSTRAINT "FK_80c93f51e33fce330f32e8ce2de" FOREIGN KEY ("startAlertStateId") REFERENCES "AlertState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" ADD CONSTRAINT "FK_17178f34b59610e3e4e659351da" FOREIGN KEY ("endAlertStateId") REFERENCES "AlertState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" ADD CONSTRAINT "FK_6e8dfe6c9bb387d5fbfc48d3b4c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" ADD CONSTRAINT "FK_3ad10caaff5f7ad20e9d3b803e9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurementValue" ADD CONSTRAINT "FK_b914406e7723ecc476110fc79f2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurementValue" ADD CONSTRAINT "FK_59ea9279ec8500b77e649a2e8e5" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurementValue" ADD CONSTRAINT "FK_00d9747fdfbd0e6740eb8fc69d7" FOREIGN KEY ("alertMeasurementId") REFERENCES "AlertMeasurement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" ADD CONSTRAINT "FK_c066bdc7849e2d4d73d5f11be70" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" ADD CONSTRAINT "FK_4823f52854290b0205f17a9968b" FOREIGN KEY ("startScheduledMaintenanceStateId") REFERENCES "ScheduledMaintenanceState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" ADD CONSTRAINT "FK_4e4bd9930063375be1d29cc2448" FOREIGN KEY ("endScheduledMaintenanceStateId") REFERENCES "ScheduledMaintenanceState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" ADD CONSTRAINT "FK_b9930166086a2ece02297bcdeb5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" ADD CONSTRAINT "FK_50572dc7759e681975be5888cd9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurementValue" ADD CONSTRAINT "FK_9d005630c98d5147e70f1cb0e4e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurementValue" ADD CONSTRAINT "FK_1a56522d2f40a8a975f868364d0" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurementValue" ADD CONSTRAINT "FK_5c7969aeb81562016806421dd31" FOREIGN KEY ("scheduledMaintenanceMeasurementId") REFERENCES "ScheduledMaintenanceMeasurement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurementValue" DROP CONSTRAINT "FK_5c7969aeb81562016806421dd31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurementValue" DROP CONSTRAINT "FK_1a56522d2f40a8a975f868364d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurementValue" DROP CONSTRAINT "FK_9d005630c98d5147e70f1cb0e4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" DROP CONSTRAINT "FK_50572dc7759e681975be5888cd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" DROP CONSTRAINT "FK_b9930166086a2ece02297bcdeb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" DROP CONSTRAINT "FK_4e4bd9930063375be1d29cc2448"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" DROP CONSTRAINT "FK_4823f52854290b0205f17a9968b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceMeasurement" DROP CONSTRAINT "FK_c066bdc7849e2d4d73d5f11be70"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurementValue" DROP CONSTRAINT "FK_00d9747fdfbd0e6740eb8fc69d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurementValue" DROP CONSTRAINT "FK_59ea9279ec8500b77e649a2e8e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurementValue" DROP CONSTRAINT "FK_b914406e7723ecc476110fc79f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" DROP CONSTRAINT "FK_3ad10caaff5f7ad20e9d3b803e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" DROP CONSTRAINT "FK_6e8dfe6c9bb387d5fbfc48d3b4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" DROP CONSTRAINT "FK_17178f34b59610e3e4e659351da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" DROP CONSTRAINT "FK_80c93f51e33fce330f32e8ce2de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertMeasurement" DROP CONSTRAINT "FK_4780aa79cfcb70140d25685ead0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurementValue" DROP CONSTRAINT "FK_47aa6f05bed26266dd2d5ade7d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurementValue" DROP CONSTRAINT "FK_24dbe2aac2f22edb6fa1e3ea8a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurementValue" DROP CONSTRAINT "FK_b6ed656c48d7620108b99d81cd6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" DROP CONSTRAINT "FK_5132d6cca9f27d19ef0b5862ca8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" DROP CONSTRAINT "FK_84efaebce32b0b58d41c2ff2f46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" DROP CONSTRAINT "FK_7f532fc9bff46fe6c03a3480682"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" DROP CONSTRAINT "FK_3270145bf369fa6ab151ed87a44"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentMeasurement" DROP CONSTRAINT "FK_4bb2eeba1479a85aaec28352d79"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b2881110ef797a56914f86a557"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7753a9da84cb33b66477f2eb13"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "impactStartedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "impactStartedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_815c11e4c8c9b6557995b6456f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90b70e49330e0f5db44b039460"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cbaa06c1ac0024314ef03f4e86"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c7969aeb81562016806421dd3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a56522d2f40a8a975f868364d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d005630c98d5147e70f1cb0e4"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceMeasurementValue"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb3486578e2e4a6cd437d1dbd2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7cbd52c6913666c4656867a0a1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a474d68553920a24346e2a694"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e4bd9930063375be1d29cc244"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4823f52854290b0205f17a9968"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fce9fc20f44a0bbb34b3b2fd63"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f61748d98aeec13c6010559a2a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c066bdc7849e2d4d73d5f11be7"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceMeasurement"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73bee7a7805ec991b991fb1a8d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_26423cecf70d8a9436bd953a13"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f23ff68f2848657f3ab5883440"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00d9747fdfbd0e6740eb8fc69d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_59ea9279ec8500b77e649a2e8e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b914406e7723ecc476110fc79f"`,
    );
    await queryRunner.query(`DROP TABLE "AlertMeasurementValue"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b04c704778ad3b81a6085e4419"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f62933bd4e82a45081970bef78"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_215c26643846e9ab43fb154f36"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_17178f34b59610e3e4e659351d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80c93f51e33fce330f32e8ce2d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a06f185bdcfd6cee978297f21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e5f5b2c335ef4e0641dc7aa62"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4780aa79cfcb70140d25685ead"`,
    );
    await queryRunner.query(`DROP TABLE "AlertMeasurement"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad37a1c1f3c9b5f1d42b08de89"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccd95220cefeb3fbfbe444a48b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48fb00fdbea5e11c3ea529071d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47aa6f05bed26266dd2d5ade7d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24dbe2aac2f22edb6fa1e3ea8a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b6ed656c48d7620108b99d81cd"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentMeasurementValue"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f7e13fe765b9e44a96617e6bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_436b0a605f61be0db556a2832b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9fc934cd452e16238e63f5029"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f532fc9bff46fe6c03a348068"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3270145bf369fa6ab151ed87a4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c90a0730d38919406d865fe407"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0228a178ab48344ffd16f6d161"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4bb2eeba1479a85aaec28352d7"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentMeasurement"`);
  }
}
