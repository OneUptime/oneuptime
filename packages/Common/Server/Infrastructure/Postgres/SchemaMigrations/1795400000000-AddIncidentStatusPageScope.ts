import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Per-incident status page scope (Incident.statusPages).
 *
 * - IncidentStatusPage: the status pages an incident is limited to. Its join
 *   rows cascade when either side is deleted.
 * - Incident.isScopedToStatusPages: whether the incident is limited to its
 *   status pages, so the status page queries can split on it in SQL. Existing
 *   incidents are unscoped, which is today's behaviour, so the default needs
 *   no backfill. It is never recomputed when join rows cascade away: an
 *   incident whose only scoped page is deleted stays scoped - to nothing - and
 *   is hidden rather than widened to every page its monitors reach.
 * - Incident.statusPagesNotifiedOnCreation: the pages already sent the
 *   incident's 'created' notification, so a page added later is told once.
 * - IncidentTemplateStatusPage: the scope an incident template applies.
 * - StatusPage.onlyShowScopedIncidents: pages that never show or notify an
 *   unscoped incident. Off for every existing page.
 */
export class AddIncidentStatusPageScope1795400000000
  implements MigrationInterface
{
  public name: string = "AddIncidentStatusPageScope1795400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentStatusPage" ("incidentId" uuid NOT NULL, "statusPageId" uuid NOT NULL, CONSTRAINT "PK_704cbe88e7fbb614b8276db4326" PRIMARY KEY ("incidentId", "statusPageId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4ad6eb224d14cc17708420961" ON "IncidentStatusPage" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12a8bd395d53349410e5fce974" ON "IncidentStatusPage" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentTemplateStatusPage" ("incidentTemplateId" uuid NOT NULL, "statusPageId" uuid NOT NULL, CONSTRAINT "PK_24de18b6b85dd0baf4e0016a807" PRIMARY KEY ("incidentTemplateId", "statusPageId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20db51def3a2086a8bf62294a1" ON "IncidentTemplateStatusPage" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1a0dee8efae60ea4a0c37f6b8" ON "IncidentTemplateStatusPage" ("statusPageId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "onlyShowScopedIncidents" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "isScopedToStatusPages" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "statusPagesNotifiedOnCreation" jsonb`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97e555a923067c2fe35e4718cb" ON "Incident" ("isScopedToStatusPages") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStatusPage" ADD CONSTRAINT "FK_a4ad6eb224d14cc177084209619" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStatusPage" ADD CONSTRAINT "FK_12a8bd395d53349410e5fce9743" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateStatusPage" ADD CONSTRAINT "FK_20db51def3a2086a8bf62294a1f" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateStatusPage" ADD CONSTRAINT "FK_b1a0dee8efae60ea4a0c37f6b81" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateStatusPage" DROP CONSTRAINT "FK_b1a0dee8efae60ea4a0c37f6b81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateStatusPage" DROP CONSTRAINT "FK_20db51def3a2086a8bf62294a1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStatusPage" DROP CONSTRAINT "FK_12a8bd395d53349410e5fce9743"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStatusPage" DROP CONSTRAINT "FK_a4ad6eb224d14cc177084209619"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97e555a923067c2fe35e4718cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "statusPagesNotifiedOnCreation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "isScopedToStatusPages"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "onlyShowScopedIncidents"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1a0dee8efae60ea4a0c37f6b8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20db51def3a2086a8bf62294a1"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentTemplateStatusPage"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12a8bd395d53349410e5fce974"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4ad6eb224d14cc17708420961"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentStatusPage"`);
  }
}
