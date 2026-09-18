import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Source map storage for unminifying browser exception stack traces
 * (issue #3452). One row per uploaded map, keyed by
 * (projectId, serviceId, serviceVersion, bundlePath); the composite index
 * backs the resolver's lookup on every exception detail view.
 */

export class AddTelemetrySourceMap1790000000000 implements MigrationInterface {
  public name: string = "AddTelemetrySourceMap1790000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetrySourceMap" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceId" uuid NOT NULL, "serviceVersion" character varying(100) NOT NULL, "bundlePath" character varying(500) NOT NULL, "content" text NOT NULL, "sizeInBytes" integer, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f60ecab6137171569d7da8005ac" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e10130843e508e58d565f11d2f" ON "TelemetrySourceMap" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdbfe3dd16c9869e9b18d5ddf3" ON "TelemetrySourceMap" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a91ae66cbfe28db9e34ccab75b" ON "TelemetrySourceMap" ("projectId", "serviceId", "serviceVersion") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" ADD CONSTRAINT "FK_e10130843e508e58d565f11d2fc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" ADD CONSTRAINT "FK_fdbfe3dd16c9869e9b18d5ddf31" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" ADD CONSTRAINT "FK_a1290792648323d6a34ef9df28c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" ADD CONSTRAINT "FK_33c4d65e39e1fbd5e98cf117a45" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" DROP CONSTRAINT "FK_33c4d65e39e1fbd5e98cf117a45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" DROP CONSTRAINT "FK_a1290792648323d6a34ef9df28c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" DROP CONSTRAINT "FK_fdbfe3dd16c9869e9b18d5ddf31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetrySourceMap" DROP CONSTRAINT "FK_e10130843e508e58d565f11d2fc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a91ae66cbfe28db9e34ccab75b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fdbfe3dd16c9869e9b18d5ddf3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e10130843e508e58d565f11d2f"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetrySourceMap"`);
  }
}
