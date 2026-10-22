import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Postmortem statuses (Incidents > Postmortems): how far an incident's
 * postmortem has come.
 *
 *   - "IncidentPostmortemStatus", a new table: a project's statuses - their
 *     name, colour, place in the list, the three built-in flags (not
 *     started, draft, completed) and the archive switch every value records
 *     pick from has.
 *   - "Incident"."postmortemStatusId": the status the incident's postmortem
 *     is in, null for every existing row until the data migration
 *     AddDefaultPostmortemStatusesToExistingProjects gives each project its
 *     statuses and each incident the status its postmortem is in. A
 *     nullable column with no default is added without rewriting the table;
 *     its indexes and its foreign key are built online by
 *     AddIncidentPostmortemStatusIndexesAndKey1805910000000.
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name, this comment, the
 * formatting and the move of the "Incident" indexes and key are
 * hand-written. The other indexes and foreign keys are on the table this
 * migration creates, so they hold no lock on rows anyone writes.
 */
export class AddIncidentPostmortemStatus1805900000000
  implements MigrationInterface
{
  public name: string = "AddIncidentPostmortemStatus1805900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentPostmortemStatus" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "color" character varying(10) NOT NULL, "isNotStartedStatus" boolean NOT NULL DEFAULT false, "isDraftStatus" boolean NOT NULL DEFAULT false, "isCompletedStatus" boolean NOT NULL DEFAULT false, "order" smallint NOT NULL, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, CONSTRAINT "PK_fd7d2ae2e3b9134d06ab17ffe13" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_067ab123dfc4a8eeccacce3b01" ON "IncidentPostmortemStatus" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4cfd922a25884fc93bb8a5fc8b" ON "IncidentPostmortemStatus" ("projectId", "order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b800f4ce7409a89fbc863aa08c" ON "IncidentPostmortemStatus" ("projectId", "isNotStartedStatus") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "postmortemStatusId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" ADD CONSTRAINT "FK_067ab123dfc4a8eeccacce3b018" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" ADD CONSTRAINT "FK_dae8760149d89c29881b0a5618e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" ADD CONSTRAINT "FK_038ba648dd7294c0f4b1c5e52c5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" ADD CONSTRAINT "FK_c29948ee8c827dee724d96d9945" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" DROP CONSTRAINT "FK_c29948ee8c827dee724d96d9945"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" DROP CONSTRAINT "FK_038ba648dd7294c0f4b1c5e52c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" DROP CONSTRAINT "FK_dae8760149d89c29881b0a5618e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemStatus" DROP CONSTRAINT "FK_067ab123dfc4a8eeccacce3b018"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "postmortemStatusId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b800f4ce7409a89fbc863aa08c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4cfd922a25884fc93bb8a5fc8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_067ab123dfc4a8eeccacce3b01"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPostmortemStatus"`);
  }
}
