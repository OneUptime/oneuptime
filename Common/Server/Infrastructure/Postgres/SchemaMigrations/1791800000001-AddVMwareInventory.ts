import { MigrationInterface, QueryRunner } from "typeorm";

export class AddVMwareInventory1791800000001 implements MigrationInterface {
  public name: string = "AddVMwareInventory1791800000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "VMwareSource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "sourceIdentifier" character varying(500) NOT NULL, "name" character varying(500) NOT NULL, "description" character varying(500), "kind" character varying(100), "metrics" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "lastCollectionAt" TIMESTAMP WITH TIME ZONE, "collectionIntervalSeconds" integer, "lastSuccessfulCollectionAt" TIMESTAMP WITH TIME ZONE, "isArchived" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_0e6a4a56cafacb4f651daae73d6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a87ff3c23b8ba57de2fc08b6ce" ON "VMwareSource" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_64825004d8339ea08faa63e159" ON "VMwareSource" ("projectId", "sourceIdentifier") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "sourceId" uuid NOT NULL, "resourceIdentifier" character varying(500) NOT NULL, "name" character varying(500) NOT NULL, "resourceType" character varying(100) NOT NULL, "metadata" jsonb, "metrics" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "lastReportedAt" TIMESTAMP WITH TIME ZONE, "expectedRunning" boolean, "maintenanceMode" boolean, "isArchived" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_18fe1ee9fb3c4349b3e58578ad0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38574a2aab35c6713996f1154e" ON "VMwareResource" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8b6a9f0b38229585190145154f" ON "VMwareResource" ("projectId", "sourceId", "resourceType", "resourceIdentifier") `,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareSource" ADD CONSTRAINT "FK_067384535c897afa9298183a786" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD CONSTRAINT "FK_fee43e1ac4ff94f40b34e3e57ce" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD CONSTRAINT "FK_3b574823c8b095669bdf5b748f1" FOREIGN KEY ("sourceId") REFERENCES "VMwareSource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP CONSTRAINT "FK_3b574823c8b095669bdf5b748f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP CONSTRAINT "FK_fee43e1ac4ff94f40b34e3e57ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareSource" DROP CONSTRAINT "FK_067384535c897afa9298183a786"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b6a9f0b38229585190145154f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38574a2aab35c6713996f1154e"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_64825004d8339ea08faa63e159"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a87ff3c23b8ba57de2fc08b6ce"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareSource"`);
  }
}
