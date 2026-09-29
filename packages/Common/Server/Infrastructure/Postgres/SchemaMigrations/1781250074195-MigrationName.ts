import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1781250074195 implements MigrationInterface {
  public name = "MigrationName1781250074195";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08a0cfa9f184257b1e57da4cf5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f55d43a0b73e883bb226158c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9f49cd8318a35757fc843ee90"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_proj_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_proj_resource"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_lastSeenAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_TelemetryEntity_proj_type_key"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_TelEntityRel_projectId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_TelEntityRel_proj_from"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_TelEntityRel_proj_to"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelEntityRel_lastSeenAt"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_TelEntityRel_edge"`);
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bdfcf0032c1141eaeeafccd418" ON "TelemetryException" ("primaryEntityId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_812052e3d9ff70b549b2cd40e7" ON "TelemetryException" ("projectId", "primaryEntityId", "fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c57a34423f8ee379eaea4779fc" ON "TelemetryUsageBilling" ("primaryEntityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e1ef427f431558a59263d6463" ON "TelemetryEntity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f5b6d2bb634b2396f2dee6ab1" ON "TelemetryEntity" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_64e28273ad4bc2543316ef82d2" ON "TelemetryEntity" ("projectId", "resourceType", "resourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2ad53c6527cd8d74a63d2fda7" ON "TelemetryEntity" ("projectId", "entityType") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cd0b36552d8224cbb200eedc4e" ON "TelemetryEntity" ("projectId", "entityType", "entityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69e77606b8cd6b0a340b561ee8" ON "TelemetryEntityRelationship" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff3c08f70cd90cd30909ab4508" ON "TelemetryEntityRelationship" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0207b1a581cc3b588835a526f5" ON "TelemetryEntityRelationship" ("projectId", "toEntityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf1de4c74c6034f957103e6434" ON "TelemetryEntityRelationship" ("projectId", "fromEntityKey") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1b26aa0f1dc0856218b446b82e" ON "TelemetryEntityRelationship" ("projectId", "fromEntityKey", "toEntityKey", "relationshipType") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD CONSTRAINT "FK_4e1ef427f431558a59263d6463d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD CONSTRAINT "FK_5c79b80b19265b19b2f40b3f6bb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD CONSTRAINT "FK_28d95749a9f6f712448c371eb7d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD CONSTRAINT "FK_69e77606b8cd6b0a340b561ee88" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD CONSTRAINT "FK_e3bcf3792c0290f28e0c151ff61" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD CONSTRAINT "FK_358f60285a6b280da4b7ce1703d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP CONSTRAINT "FK_358f60285a6b280da4b7ce1703d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP CONSTRAINT "FK_e3bcf3792c0290f28e0c151ff61"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP CONSTRAINT "FK_69e77606b8cd6b0a340b561ee88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP CONSTRAINT "FK_28d95749a9f6f712448c371eb7d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP CONSTRAINT "FK_5c79b80b19265b19b2f40b3f6bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP CONSTRAINT "FK_4e1ef427f431558a59263d6463d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b26aa0f1dc0856218b446b82e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf1de4c74c6034f957103e6434"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0207b1a581cc3b588835a526f5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff3c08f70cd90cd30909ab4508"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_69e77606b8cd6b0a340b561ee8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd0b36552d8224cbb200eedc4e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2ad53c6527cd8d74a63d2fda7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_64e28273ad4bc2543316ef82d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f5b6d2bb634b2396f2dee6ab1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e1ef427f431558a59263d6463"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c57a34423f8ee379eaea4779fc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_812052e3d9ff70b549b2cd40e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdfcf0032c1141eaeeafccd418"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_TelEntityRel_edge" ON "TelemetryEntityRelationship" ("projectId", "fromEntityKey", "toEntityKey", "relationshipType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_lastSeenAt" ON "TelemetryEntityRelationship" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_proj_to" ON "TelemetryEntityRelationship" ("projectId", "toEntityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_proj_from" ON "TelemetryEntityRelationship" ("projectId", "fromEntityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_projectId" ON "TelemetryEntityRelationship" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_TelemetryEntity_proj_type_key" ON "TelemetryEntity" ("projectId", "entityType", "entityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_lastSeenAt" ON "TelemetryEntity" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_proj_resource" ON "TelemetryEntity" ("projectId", "resourceType", "resourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_proj_type" ON "TelemetryEntity" ("projectId", "entityType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_projectId" ON "TelemetryEntity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9f49cd8318a35757fc843ee90" ON "TelemetryUsageBilling" ("primaryEntityId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1f55d43a0b73e883bb226158c7" ON "TelemetryException" ("projectId", "primaryEntityId", "fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08a0cfa9f184257b1e57da4cf5" ON "TelemetryException" ("primaryEntityId") `,
    );
  }
}
