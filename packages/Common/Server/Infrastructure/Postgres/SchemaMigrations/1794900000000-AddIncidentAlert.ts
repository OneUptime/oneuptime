import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Adds the IncidentAlert link table (alerts
 * linked to incidents, many-to-many, one row per incident/alert pair) and the
 * two project switches that let an incident's acknowledge and resolve carry
 * over to the alerts linked to it. Both switches default to false, so no
 * existing project changes behaviour.
 */
export class AddIncidentAlert1794900000000 implements MigrationInterface {
  public name: string = "AddIncidentAlert1794900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentAlert" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid NOT NULL, "alertId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_cadb02bcf16f34fb6b131ad3a56" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2456e245d2ac16087057be57ea" ON "IncidentAlert" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f38346a69539fb7a363ee39e69" ON "IncidentAlert" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_828188b356c5335f78af09466f" ON "IncidentAlert" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b836b78cef9ce62e4d8f2cc586" ON "IncidentAlert" ("incidentId", "alertId", "projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "acknowledgeLinkedAlertsWhenIncidentAcknowledged" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "resolveLinkedAlertsWhenIncidentResolved" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" ADD CONSTRAINT "FK_2456e245d2ac16087057be57ea5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" ADD CONSTRAINT "FK_f38346a69539fb7a363ee39e698" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" ADD CONSTRAINT "FK_828188b356c5335f78af09466fa" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" ADD CONSTRAINT "FK_ad078609e5bacad1f7861f92176" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" ADD CONSTRAINT "FK_572a63b76f7053f4fd28e666295" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" DROP CONSTRAINT "FK_572a63b76f7053f4fd28e666295"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" DROP CONSTRAINT "FK_ad078609e5bacad1f7861f92176"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" DROP CONSTRAINT "FK_828188b356c5335f78af09466fa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" DROP CONSTRAINT "FK_f38346a69539fb7a363ee39e698"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAlert" DROP CONSTRAINT "FK_2456e245d2ac16087057be57ea5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "resolveLinkedAlertsWhenIncidentResolved"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "acknowledgeLinkedAlertsWhenIncidentAcknowledged"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b836b78cef9ce62e4d8f2cc586"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_828188b356c5335f78af09466f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f38346a69539fb7a363ee39e69"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2456e245d2ac16087057be57ea"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentAlert"`);
  }
}
