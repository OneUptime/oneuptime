import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774000000002 implements MigrationInterface {
  public name = "MigrationName1774000000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DockerHost" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "hostIdentifier" character varying(100) NOT NULL, "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "lastSeenAt" TIMESTAMP WITH TIME ZONE, "containersRunning" integer DEFAULT '0', "containersStopped" integer DEFAULT '0', "containersPaused" integer DEFAULT '0', "osType" character varying(100), "osVersion" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_docker_host_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_docker_host_projectId" ON "DockerHost" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_docker_host_hostIdentifier" ON "DockerHost" ("hostIdentifier")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_docker_host_slug" ON "DockerHost" ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_docker_host_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_docker_host_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_docker_host_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Label join table
    await queryRunner.query(
      `CREATE TABLE "DockerHostLabel" ("dockerHostId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_docker_host_label" PRIMARY KEY ("dockerHostId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_docker_host_label_dockerHostId" ON "DockerHostLabel" ("dockerHostId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_docker_host_label_labelId" ON "DockerHostLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabel" ADD CONSTRAINT "FK_docker_host_label_dockerHostId" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabel" ADD CONSTRAINT "FK_docker_host_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabel" DROP CONSTRAINT "FK_docker_host_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabel" DROP CONSTRAINT "FK_docker_host_label_dockerHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_docker_host_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_docker_host_label_dockerHostId"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostLabel"`);
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_docker_host_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_docker_host_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_docker_host_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_docker_host_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_docker_host_hostIdentifier"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_docker_host_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHost"`);
  }
}
