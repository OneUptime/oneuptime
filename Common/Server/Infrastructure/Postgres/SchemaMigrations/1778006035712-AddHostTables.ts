import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHostTables1778006035712 implements MigrationInterface {
  public name = "AddHostTables1778006035712";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "Host" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "hostIdentifier" character varying(100) NOT NULL, "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "lastSeenAt" TIMESTAMP WITH TIME ZONE, "osType" character varying(100), "osVersion" character varying(100), "hostId" character varying(100), "hostArch" character varying(100), "hostType" character varying(100), "cpuCores" integer, "totalMemoryBytes" bigint, "processCount" integer, "containerRuntime" character varying(100), "dockerHostId" uuid, "kubernetesClusterId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8932b1fbd5379a13b1b36ec2d3d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e22ae9b0a967fb6543ff8c301f" ON "Host" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3fde0ad120dcc2add43571d32f" ON "Host" ("hostIdentifier") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "hostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_84405badc1534865339c8c5e406" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1d978cf937110822c0a8c16b6" ON "HostOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1290ff7710538a05b836d6963f" ON "HostOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfd5c58b1da0f125d89e18e0bc" ON "HostOwnerTeam" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_495bfc6fd17ac913d87b4e1343" ON "HostOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "hostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_0162afb1404ef9533b18c896e4e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a702bcd1aae2116c995c9e629" ON "HostOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3defdc18ccc7f39331f2421642" ON "HostOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_548d344a8aacbfcfe9c7e976d2" ON "HostOwnerUser" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b31e255a3a84c744f345655de3" ON "HostOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostLabel" ("hostId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_86a7f1b9bc210b18c81113b5a33" PRIMARY KEY ("hostId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_59e952ca592c04398e3d64bfde" ON "HostLabel" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9430f41b66935ad844c956aee6" ON "HostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_e22ae9b0a967fb6543ff8c301f1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_4bd303f959a5149deaf49cc7829" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_f3aaabe9c2b44fb291de44db2b8" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_d49356815c565cb9d8daddbb673" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_aa5c88e1babc531c2f494117f2e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" ADD CONSTRAINT "FK_c1d978cf937110822c0a8c16b63" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" ADD CONSTRAINT "FK_1290ff7710538a05b836d6963f5" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" ADD CONSTRAINT "FK_cfd5c58b1da0f125d89e18e0bc8" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" ADD CONSTRAINT "FK_ee4a1b1c2c24c1b2e9a75aa16c9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" ADD CONSTRAINT "FK_6d4be0abe0aafe5f92dabe17c39" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" ADD CONSTRAINT "FK_0a702bcd1aae2116c995c9e6294" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" ADD CONSTRAINT "FK_3defdc18ccc7f39331f24216427" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" ADD CONSTRAINT "FK_548d344a8aacbfcfe9c7e976d22" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" ADD CONSTRAINT "FK_77c8d3ccc2887cd21f6fee2e283" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" ADD CONSTRAINT "FK_aae3727b2c7f6567667f367996a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabel" ADD CONSTRAINT "FK_59e952ca592c04398e3d64bfde6" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabel" ADD CONSTRAINT "FK_9430f41b66935ad844c956aee6a" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "HostLabel" DROP CONSTRAINT "FK_9430f41b66935ad844c956aee6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabel" DROP CONSTRAINT "FK_59e952ca592c04398e3d64bfde6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" DROP CONSTRAINT "FK_aae3727b2c7f6567667f367996a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" DROP CONSTRAINT "FK_77c8d3ccc2887cd21f6fee2e283"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" DROP CONSTRAINT "FK_548d344a8aacbfcfe9c7e976d22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" DROP CONSTRAINT "FK_3defdc18ccc7f39331f24216427"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerUser" DROP CONSTRAINT "FK_0a702bcd1aae2116c995c9e6294"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" DROP CONSTRAINT "FK_6d4be0abe0aafe5f92dabe17c39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" DROP CONSTRAINT "FK_ee4a1b1c2c24c1b2e9a75aa16c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" DROP CONSTRAINT "FK_cfd5c58b1da0f125d89e18e0bc8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" DROP CONSTRAINT "FK_1290ff7710538a05b836d6963f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerTeam" DROP CONSTRAINT "FK_c1d978cf937110822c0a8c16b63"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_aa5c88e1babc531c2f494117f2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_d49356815c565cb9d8daddbb673"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_f3aaabe9c2b44fb291de44db2b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_4bd303f959a5149deaf49cc7829"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_e22ae9b0a967fb6543ff8c301f1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9430f41b66935ad844c956aee6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_59e952ca592c04398e3d64bfde"`,
    );
    await queryRunner.query(`DROP TABLE "HostLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b31e255a3a84c744f345655de3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_548d344a8aacbfcfe9c7e976d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3defdc18ccc7f39331f2421642"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a702bcd1aae2116c995c9e629"`,
    );
    await queryRunner.query(`DROP TABLE "HostOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_495bfc6fd17ac913d87b4e1343"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfd5c58b1da0f125d89e18e0bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1290ff7710538a05b836d6963f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1d978cf937110822c0a8c16b6"`,
    );
    await queryRunner.query(`DROP TABLE "HostOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fde0ad120dcc2add43571d32f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e22ae9b0a967fb6543ff8c301f"`,
    );
    await queryRunner.query(`DROP TABLE "Host"`);
  }
}
