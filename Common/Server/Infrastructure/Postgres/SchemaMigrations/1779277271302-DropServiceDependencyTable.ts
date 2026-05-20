import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class DropServiceDependencyTable1779277271302
  implements MigrationInterface
{
  public name = "DropServiceDependencyTable1779277271302";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ServiceDependency" CASCADE`);
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceDependency" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceId" uuid NOT NULL, "dependencyServiceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f4c8003faa6daec34a5b97f88e8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e2a1ef7e8795a46c2e2e9955c" ON "ServiceDependency" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3af01e69f3e28ae56a968bbd81" ON "ServiceDependency" ("serviceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c2562045902370ec46091924fc" ON "ServiceDependency" ("dependencyServiceId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceDependency" ADD CONSTRAINT "FK_3e2a1ef7e8795a46c2e2e9955c2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceDependency" ADD CONSTRAINT "FK_3af01e69f3e28ae56a968bbd812" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceDependency" ADD CONSTRAINT "FK_c2562045902370ec46091924fc8" FOREIGN KEY ("dependencyServiceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceDependency" ADD CONSTRAINT "FK_cc8c8d41106bebab21d1c69e129" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceDependency" ADD CONSTRAINT "FK_feb830e4e4f8259a871105b16e8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
