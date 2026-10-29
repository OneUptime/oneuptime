import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Detection rule exceptions (Types/SecurityEvent/DetectionRuleException):
 * what a detection rule skips - an entity, a value or a time window - with
 * who added it, why, and when it expires.
 *
 *   - "DetectionRuleException": one row per exception, for one rule of the
 *     project (deleted with the rule), with only the columns of its kind
 *     set.
 *
 * The table is new and empty, so its indexes and foreign keys are built
 * here; no existing table changes.
 */
export class AddDetectionRuleExceptions1808160000000
  implements MigrationInterface
{
  public name: string = "AddDetectionRuleExceptions1808160000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DetectionRuleException" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "detectionRuleId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "entityType" character varying(100), "fieldName" character varying(100), "value" character varying(500), "startsAt" TIMESTAMP WITH TIME ZONE, "endsAt" TIMESTAMP WITH TIME ZONE, "reason" character varying(500) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a4a3c8962ef23d7ee7848ffb308" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e077edf69e56cf94c70ef3be7" ON "DetectionRuleException" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db1580b1023b5bcf748d3fa823" ON "DetectionRuleException" ("detectionRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c052bfceb26a9cf60348bbe5e" ON "DetectionRuleException" ("projectId", "detectionRuleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" ADD CONSTRAINT "FK_6e077edf69e56cf94c70ef3be71" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" ADD CONSTRAINT "FK_db1580b1023b5bcf748d3fa823f" FOREIGN KEY ("detectionRuleId") REFERENCES "DetectionRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" ADD CONSTRAINT "FK_f1234b2871ae0f3faa31cce001c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" ADD CONSTRAINT "FK_2d056e467296c5bd38448739482" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" DROP CONSTRAINT "FK_2d056e467296c5bd38448739482"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" DROP CONSTRAINT "FK_f1234b2871ae0f3faa31cce001c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" DROP CONSTRAINT "FK_db1580b1023b5bcf748d3fa823f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRuleException" DROP CONSTRAINT "FK_6e077edf69e56cf94c70ef3be71"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c052bfceb26a9cf60348bbe5e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db1580b1023b5bcf748d3fa823"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e077edf69e56cf94c70ef3be7"`,
    );
    await queryRunner.query(`DROP TABLE "DetectionRuleException"`);
  }
}
