import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736364478985 implements MigrationInterface {
  public name = "MigrationName1736364478985";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "logInMarkdown" text NOT NULL, "moreInformationInMarkdown" text NOT NULL, "incidentLogEvent" character varying NOT NULL, CONSTRAINT "PK_947cb9f32cf204561d10d64adeb" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_855797e41af7d35b18a7f3f97b" ON "IncidentLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1eff2f3d075754ef9c16e8b962" ON "IncidentLog" ("incidentId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" ADD CONSTRAINT "FK_855797e41af7d35b18a7f3f97bd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" ADD CONSTRAINT "FK_1eff2f3d075754ef9c16e8b962c" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" ADD CONSTRAINT "FK_da6bb8bf63b18a7ddc35cc2901a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" ADD CONSTRAINT "FK_bb1b8b83ffdfc702088b74f2e16" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" DROP CONSTRAINT "FK_bb1b8b83ffdfc702088b74f2e16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" DROP CONSTRAINT "FK_da6bb8bf63b18a7ddc35cc2901a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" DROP CONSTRAINT "FK_1eff2f3d075754ef9c16e8b962c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" DROP CONSTRAINT "FK_855797e41af7d35b18a7f3f97bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1eff2f3d075754ef9c16e8b962"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_855797e41af7d35b18a7f3f97b"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentLog"`);
  }
}
