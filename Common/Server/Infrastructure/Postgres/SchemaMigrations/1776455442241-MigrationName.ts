import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1776455442241 implements MigrationInterface {
  public name = "MigrationName1776455442241";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_clusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_kc_owner_team_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_clusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_kc_owner_user_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_hostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dh_owner_team_deletedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_hostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_dh_owner_user_deletedBy"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_team_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_team_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_team_clusterId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_team_notified"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_user_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_user_userId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kc_owner_user_clusterId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_kc_owner_user_notified"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dh_owner_team_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_team_teamId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_team_hostId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_team_notified"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dh_owner_user_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_user_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_user_hostId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dh_owner_user_notified"`);
    await queryRunner.query(
      `CREATE TABLE "KubernetesResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "namespaceKey" character varying(100) NOT NULL DEFAULT '', "name" character varying(100) NOT NULL, "uid" character varying(100), "phase" character varying(100), "isReady" boolean, "hasMemoryPressure" boolean, "hasDiskPressure" boolean, "hasPidPressure" boolean, "labels" jsonb, "annotations" jsonb, "ownerReferences" jsonb, "spec" jsonb, "status" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "resourceCreationTimestamp" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_3df82592f51fae6527786e97361" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ba6ae746a1497c4206e0fe43e" ON "KubernetesResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f34bd01ec1d8fa16df1965ba1" ON "KubernetesResource" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1edddbc2265ebc59e28012a241" ON "KubernetesClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4121a7fd3ed06b3acb3ba3e67d" ON "KubernetesClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf4e9cce4fbc4f0ecafd55ff16" ON "KubernetesClusterOwnerTeam" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0a0c2dedd022deb9b1d98e551" ON "KubernetesClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a028624594c3af19fd357f63d9" ON "KubernetesClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f0f41ec22c5cba97ae683bcea" ON "KubernetesClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55b86a79c8d0a83f0f5310af10" ON "KubernetesClusterOwnerUser" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8c195454312acaade0e6eb317" ON "KubernetesClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dffee2c443b46371e3776d1a22" ON "DockerHostOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92de0bd17ce0ed78667f75850a" ON "DockerHostOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6b3b8eb0f50b6b75084d6a847" ON "DockerHostOwnerTeam" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_055ca044d2cede9047f5b37f95" ON "DockerHostOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d48394c7e4cc190543d244b3bb" ON "DockerHostOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_085f1c777c88f27c799a17fd05" ON "DockerHostOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1a1ba85edda82690ecc0119e3" ON "DockerHostOwnerUser" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0d5bdf7ff4dbc2fb24dada34d" ON "DockerHostOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_1edddbc2265ebc59e28012a241f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_4121a7fd3ed06b3acb3ba3e67d5" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_bf4e9cce4fbc4f0ecafd55ff16c" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_ae592ae3b0955a7eaf2ce74cc9e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_47ccc73fd46b91032858e89f9c0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_a028624594c3af19fd357f63d97" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_0f0f41ec22c5cba97ae683bcead" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_55b86a79c8d0a83f0f5310af107" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_a0f521334eb132e3d85a44cbc57" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_abf04cdd9bfc085448061c1249f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_0ba6ae746a1497c4206e0fe43e1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_3f34bd01ec1d8fa16df1965ba1c" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_648fa46113b326f1a5b97f773fc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_1c837345d0112e50866c0b4773e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dffee2c443b46371e3776d1a227" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_92de0bd17ce0ed78667f75850ab" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_c6b3b8eb0f50b6b75084d6a8476" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_5071986b436142416ba3123dd3c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_6d66a84d603aaff4b5ac2c64cc1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_d48394c7e4cc190543d244b3bbf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_085f1c777c88f27c799a17fd055" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_e1a1ba85edda82690ecc0119e34" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_62a4b021f9a6282b95f4a6065a0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_090e1ea6d6de6945d97e6c104b0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_090e1ea6d6de6945d97e6c104b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_62a4b021f9a6282b95f4a6065a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_e1a1ba85edda82690ecc0119e34"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_085f1c777c88f27c799a17fd055"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_d48394c7e4cc190543d244b3bbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_6d66a84d603aaff4b5ac2c64cc1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_5071986b436142416ba3123dd3c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_c6b3b8eb0f50b6b75084d6a8476"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_92de0bd17ce0ed78667f75850ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dffee2c443b46371e3776d1a227"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_1c837345d0112e50866c0b4773e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_648fa46113b326f1a5b97f773fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_3f34bd01ec1d8fa16df1965ba1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_0ba6ae746a1497c4206e0fe43e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_abf04cdd9bfc085448061c1249f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_a0f521334eb132e3d85a44cbc57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_55b86a79c8d0a83f0f5310af107"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_0f0f41ec22c5cba97ae683bcead"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_a028624594c3af19fd357f63d97"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_47ccc73fd46b91032858e89f9c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_ae592ae3b0955a7eaf2ce74cc9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_bf4e9cce4fbc4f0ecafd55ff16c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_4121a7fd3ed06b3acb3ba3e67d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_1edddbc2265ebc59e28012a241f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0d5bdf7ff4dbc2fb24dada34d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1a1ba85edda82690ecc0119e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_085f1c777c88f27c799a17fd05"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d48394c7e4cc190543d244b3bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_055ca044d2cede9047f5b37f95"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6b3b8eb0f50b6b75084d6a847"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92de0bd17ce0ed78667f75850a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dffee2c443b46371e3776d1a22"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8c195454312acaade0e6eb317"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55b86a79c8d0a83f0f5310af10"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f0f41ec22c5cba97ae683bcea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a028624594c3af19fd357f63d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0a0c2dedd022deb9b1d98e551"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf4e9cce4fbc4f0ecafd55ff16"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4121a7fd3ed06b3acb3ba3e67d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1edddbc2265ebc59e28012a241"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f34bd01ec1d8fa16df1965ba1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ba6ae746a1497c4206e0fe43e"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesResource"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_notified" ON "DockerHostOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_hostId" ON "DockerHostOwnerUser" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_userId" ON "DockerHostOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_user_projectId" ON "DockerHostOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_notified" ON "DockerHostOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_hostId" ON "DockerHostOwnerTeam" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_teamId" ON "DockerHostOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dh_owner_team_projectId" ON "DockerHostOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_notified" ON "KubernetesClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_clusterId" ON "KubernetesClusterOwnerUser" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_userId" ON "KubernetesClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_user_projectId" ON "KubernetesClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_notified" ON "KubernetesClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_clusterId" ON "KubernetesClusterOwnerTeam" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_teamId" ON "KubernetesClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kc_owner_team_projectId" ON "KubernetesClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_hostId" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_dh_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_hostId" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dh_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_clusterId" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_kc_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_clusterId" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_kc_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
