import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A network site's owners and labels (#10188): NetworkSiteOwnerUser and
 * NetworkSiteOwnerTeam, the people and teams who own a site, and
 * NetworkSiteLabel, the labels it is grouped and filtered by. Three new
 * tables, so nothing that exists is scanned. Generated.
 */
export class AddNetworkSiteOwnersAndLabels1809187000000
  implements MigrationInterface
{
  public name: string = "AddNetworkSiteOwnersAndLabels1809187000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkSiteOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "networkSiteId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8ed8937b14c8c0ec381a163c279" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b359e587ac44d6abe54e3b9c1" ON "NetworkSiteOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3b0064f077a74bb566292c4ef" ON "NetworkSiteOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_57fa259840e528dbfd0e8bff28" ON "NetworkSiteOwnerTeam" ("networkSiteId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0517f5289760ac7be825c0048e" ON "NetworkSiteOwnerTeam" ("networkSiteId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkSiteOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "networkSiteId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_2e3b8eafdb31f9ea3c362e5afe6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20fe839fbe723dbf92e30352b9" ON "NetworkSiteOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90c46969c864e2fd9ca588331c" ON "NetworkSiteOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cae9e63c4b51091f8c6ac5b13" ON "NetworkSiteOwnerUser" ("networkSiteId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3c4f814944b89df0c6eb3e895c" ON "NetworkSiteOwnerUser" ("networkSiteId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkSiteLabel" ("networkSiteId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_10c93cfd7b51a9dfc34199028c1" PRIMARY KEY ("networkSiteId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea5220c4a8f6cacc137ef9f6c5" ON "NetworkSiteLabel" ("networkSiteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f4e880166bcf5453dffb2adf22" ON "NetworkSiteLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" ADD CONSTRAINT "FK_8b359e587ac44d6abe54e3b9c15" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" ADD CONSTRAINT "FK_f3b0064f077a74bb566292c4eff" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" ADD CONSTRAINT "FK_57fa259840e528dbfd0e8bff28f" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" ADD CONSTRAINT "FK_a7442bad0d67a80dc05061b95cd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" ADD CONSTRAINT "FK_9f8e2780eb643a06dde92ace3c0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" ADD CONSTRAINT "FK_20fe839fbe723dbf92e30352b99" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" ADD CONSTRAINT "FK_90c46969c864e2fd9ca588331ca" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" ADD CONSTRAINT "FK_2cae9e63c4b51091f8c6ac5b139" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" ADD CONSTRAINT "FK_a7b40645f40ae36fb3d3b2ce80b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" ADD CONSTRAINT "FK_74e776130d5de726483117e6a54" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLabel" ADD CONSTRAINT "FK_ea5220c4a8f6cacc137ef9f6c55" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLabel" ADD CONSTRAINT "FK_f4e880166bcf5453dffb2adf228" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLabel" DROP CONSTRAINT "FK_f4e880166bcf5453dffb2adf228"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteLabel" DROP CONSTRAINT "FK_ea5220c4a8f6cacc137ef9f6c55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" DROP CONSTRAINT "FK_74e776130d5de726483117e6a54"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" DROP CONSTRAINT "FK_a7b40645f40ae36fb3d3b2ce80b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" DROP CONSTRAINT "FK_2cae9e63c4b51091f8c6ac5b139"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" DROP CONSTRAINT "FK_90c46969c864e2fd9ca588331ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerUser" DROP CONSTRAINT "FK_20fe839fbe723dbf92e30352b99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" DROP CONSTRAINT "FK_9f8e2780eb643a06dde92ace3c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" DROP CONSTRAINT "FK_a7442bad0d67a80dc05061b95cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" DROP CONSTRAINT "FK_57fa259840e528dbfd0e8bff28f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" DROP CONSTRAINT "FK_f3b0064f077a74bb566292c4eff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteOwnerTeam" DROP CONSTRAINT "FK_8b359e587ac44d6abe54e3b9c15"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f4e880166bcf5453dffb2adf22"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea5220c4a8f6cacc137ef9f6c5"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSiteLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c4f814944b89df0c6eb3e895c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cae9e63c4b51091f8c6ac5b13"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90c46969c864e2fd9ca588331c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20fe839fbe723dbf92e30352b9"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSiteOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0517f5289760ac7be825c0048e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_57fa259840e528dbfd0e8bff28"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3b0064f077a74bb566292c4ef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b359e587ac44d6abe54e3b9c1"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSiteOwnerTeam"`);
  }
}
