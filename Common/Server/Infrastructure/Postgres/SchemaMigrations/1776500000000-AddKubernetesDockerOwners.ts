import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKubernetesDockerOwners1776500000000
  implements MigrationInterface
{
  public name = "AddKubernetesDockerOwners1776500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // KubernetesClusterOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_kc_owner_team_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_projectId" ON "KubernetesClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_teamId" ON "KubernetesClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_clusterId" ON "KubernetesClusterOwnerTeam" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_notified" ON "KubernetesClusterOwnerTeam" ("isOwnerNotified") `,
    );

    // KubernetesClusterOwnerUser
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_kc_owner_user_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_projectId" ON "KubernetesClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_userId" ON "KubernetesClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_clusterId" ON "KubernetesClusterOwnerUser" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_notified" ON "KubernetesClusterOwnerUser" ("isOwnerNotified") `,
    );

    // DockerHostOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_dh_owner_team_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_projectId" ON "DockerHostOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_teamId" ON "DockerHostOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_hostId" ON "DockerHostOwnerTeam" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_notified" ON "DockerHostOwnerTeam" ("isOwnerNotified") `,
    );

    // DockerHostOwnerUser
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_dh_owner_user_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_projectId" ON "DockerHostOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_userId" ON "DockerHostOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_hostId" ON "DockerHostOwnerUser" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_notified" ON "DockerHostOwnerUser" ("isOwnerNotified") `,
    );

    // Foreign keys - KubernetesClusterOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_clusterId" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys - KubernetesClusterOwnerUser
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_clusterId" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys - DockerHostOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_hostId" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys - DockerHostOwnerUser
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_hostId" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FKs - DockerHostOwnerUser
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_hostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_projectId"`,
    );

    // Drop FKs - DockerHostOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_hostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_projectId"`,
    );

    // Drop FKs - KubernetesClusterOwnerUser
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_clusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_projectId"`,
    );

    // Drop FKs - KubernetesClusterOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_clusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_projectId"`,
    );

    // Drop indexes and tables
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_user_notified"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_user_hostId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_user_userId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dh_owner_user_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerUser"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_team_notified"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_team_hostId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_team_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dh_owner_team_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerTeam"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_user_notified"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_user_clusterId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_user_userId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_user_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterOwnerUser"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_team_notified"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_team_clusterId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_team_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_team_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterOwnerTeam"`);
  }
}
