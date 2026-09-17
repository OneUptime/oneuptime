import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1741904597606 implements MigrationInterface {
  public name = "MigrationName1741904597606";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyUserOverride" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "onCallDutyPolicyId" uuid, "name" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "overrideUserId" uuid NOT NULL, "routeAlertsToUserId" uuid NOT NULL, "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "deletedByUserId" uuid, CONSTRAINT "PK_41b216c8e71d15182fe67b75fec" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_75b4e0f9bc53be5cdaa55b2936" ON "OnCallDutyPolicyUserOverride" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a13404edca5d177b3ad539995" ON "OnCallDutyPolicyUserOverride" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0bdac6c10d7ed30e696aded2c" ON "OnCallDutyPolicyUserOverride" ("name") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_75b4e0f9bc53be5cdaa55b29361" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_6a13404edca5d177b3ad539995d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_c21b1df32e40e739a66d638a3c7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_4b3f696aaaf327b245ebeb3d146" FOREIGN KEY ("overrideUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_8771068ec4c16763a7ff796895d" FOREIGN KEY ("routeAlertsToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ADD CONSTRAINT "FK_810a8cd7f838a8e141fd750a9d5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_810a8cd7f838a8e141fd750a9d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_8771068ec4c16763a7ff796895d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_4b3f696aaaf327b245ebeb3d146"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_c21b1df32e40e739a66d638a3c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_6a13404edca5d177b3ad539995d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" DROP CONSTRAINT "FK_75b4e0f9bc53be5cdaa55b29361"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0bdac6c10d7ed30e696aded2c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a13404edca5d177b3ad539995"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_75b4e0f9bc53be5cdaa55b2936"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyUserOverride"`);
  }
}
