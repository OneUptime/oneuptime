import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Log sessions (#9806): every app's logs from an Android device for a while,
 * asked for on the device's host and allowed by the person at the device
 * (HostLogSession). A new table, so it is empty while its indexes and keys
 * are made.
 */
export class AddHostLogSessions1809186600000 implements MigrationInterface {
  public name: string = "AddHostLogSessions1809186600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "HostLogSession" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "hostId" uuid NOT NULL, "status" character varying(100) NOT NULL DEFAULT 'Requested', "durationMinutes" integer NOT NULL DEFAULT '30', "minimumLevel" character varying(100) NOT NULL DEFAULT 'info', "expiresAt" TIMESTAMP WITH TIME ZONE, "startedAt" TIMESTAMP WITH TIME ZONE, "endsAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "statusMessage" character varying(500), "createdByUserId" uuid, CONSTRAINT "PK_f650d5c8df96e916e4bee10537f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8be1a2a64e026da6b41401c8b4" ON "HostLogSession" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_04451185d01da5b92f6fb686e0" ON "HostLogSession" ("hostId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLogSession" ADD CONSTRAINT "FK_8be1a2a64e026da6b41401c8b4a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLogSession" ADD CONSTRAINT "FK_efb6d32a9dd96d50a30a782db96" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLogSession" ADD CONSTRAINT "FK_614e4398f13bfc41854e0e21de0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "HostLogSession" DROP CONSTRAINT "FK_614e4398f13bfc41854e0e21de0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLogSession" DROP CONSTRAINT "FK_efb6d32a9dd96d50a30a782db96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLogSession" DROP CONSTRAINT "FK_8be1a2a64e026da6b41401c8b4a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04451185d01da5b92f6fb686e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8be1a2a64e026da6b41401c8b4"`,
    );
    await queryRunner.query(`DROP TABLE "HostLogSession"`);
  }
}
