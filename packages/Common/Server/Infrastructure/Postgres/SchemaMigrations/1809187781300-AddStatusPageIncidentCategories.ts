import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusPageIncidentCategories1809187781300
  implements MigrationInterface
{
  public name: string = "AddStatusPageIncidentCategories1809187781300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StatusPageIncidentCategory" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "labelId" uuid NOT NULL, "publicName" character varying(100) NOT NULL, "publicDescription" character varying(500), CONSTRAINT "PK_18eb025a8132916a8f4cb636438" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a4ff03ecdbd3b2b811d1a6389" ON "StatusPageIncidentCategory" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_37e0baa5c519768baf3fb8ee7b" ON "StatusPageIncidentCategory" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7373b86ad3e7e73086ae43baab" ON "StatusPageIncidentCategory" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageSubscriberStatusPageIncidentCategory" ("statusPageSubscriberId" uuid NOT NULL, "statusPageIncidentCategoryId" uuid NOT NULL, CONSTRAINT "PK_6ba9df6358865b43038aee9ab94" PRIMARY KEY ("statusPageSubscriberId", "statusPageIncidentCategoryId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3acc8126b19abf58192e1ee552" ON "StatusPageSubscriberStatusPageIncidentCategory" ("statusPageSubscriberId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2dd80868cceb46b4ecf310e3ff" ON "StatusPageSubscriberStatusPageIncidentCategory" ("statusPageIncidentCategoryId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "allowSubscribersToChooseIncidentCategories" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "isSubscribedToAllIncidentCategories" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageIncidentCategory" ADD CONSTRAINT "FK_5a4ff03ecdbd3b2b811d1a6389b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageIncidentCategory" ADD CONSTRAINT "FK_37e0baa5c519768baf3fb8ee7b9" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageIncidentCategory" ADD CONSTRAINT "FK_7373b86ad3e7e73086ae43baab7" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberStatusPageIncidentCategory" ADD CONSTRAINT "FK_3acc8126b19abf58192e1ee5522" FOREIGN KEY ("statusPageSubscriberId") REFERENCES "StatusPageSubscriber"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberStatusPageIncidentCategory" ADD CONSTRAINT "FK_2dd80868cceb46b4ecf310e3ffc" FOREIGN KEY ("statusPageIncidentCategoryId") REFERENCES "StatusPageIncidentCategory"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberStatusPageIncidentCategory" DROP CONSTRAINT "FK_2dd80868cceb46b4ecf310e3ffc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriberStatusPageIncidentCategory" DROP CONSTRAINT "FK_3acc8126b19abf58192e1ee5522"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageIncidentCategory" DROP CONSTRAINT "FK_7373b86ad3e7e73086ae43baab7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageIncidentCategory" DROP CONSTRAINT "FK_37e0baa5c519768baf3fb8ee7b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageIncidentCategory" DROP CONSTRAINT "FK_5a4ff03ecdbd3b2b811d1a6389b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "isSubscribedToAllIncidentCategories"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "allowSubscribersToChooseIncidentCategories"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2dd80868cceb46b4ecf310e3ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3acc8126b19abf58192e1ee552"`,
    );
    await queryRunner.query(
      `DROP TABLE "StatusPageSubscriberStatusPageIncidentCategory"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7373b86ad3e7e73086ae43baab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_37e0baa5c519768baf3fb8ee7b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a4ff03ecdbd3b2b811d1a6389"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageIncidentCategory"`);
  }
}
