import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1773761409952 implements MigrationInterface {
    name = 'MigrationName1773761409952'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_kubernetes_cluster_projectId"`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_kubernetes_cluster_createdByUserId"`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_kubernetes_cluster_deletedByUserId"`);
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" DROP CONSTRAINT "FK_kubernetes_cluster_label_clusterId"`);
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" DROP CONSTRAINT "FK_kubernetes_cluster_label_labelId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_kubernetes_cluster_projectId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_kubernetes_cluster_clusterIdentifier"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_kubernetes_cluster_slug"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_kubernetes_cluster_label_clusterId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_kubernetes_cluster_label_labelId"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_5ae5bbb0c93c048b0b76b1d426" ON "KubernetesCluster" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_b9259f6741a7965a518e258f61" ON "KubernetesCluster" ("clusterIdentifier") `);
        await queryRunner.query(`CREATE INDEX "IDX_ed1b53bd041aa21b44ca8cdab5" ON "KubernetesClusterLabel" ("kubernetesClusterId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2ec82ad068e84cf762c32ad7c7" ON "KubernetesClusterLabel" ("labelId") `);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_5ae5bbb0c93c048b0b76b1d4268" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_1bee392c44b1aebe754932133a8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_b0f6c98aac521060f8b68fe5c87" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" ADD CONSTRAINT "FK_ed1b53bd041aa21b44ca8cdab5e" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" ADD CONSTRAINT "FK_2ec82ad068e84cf762c32ad7c76" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" DROP CONSTRAINT "FK_2ec82ad068e84cf762c32ad7c76"`);
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" DROP CONSTRAINT "FK_ed1b53bd041aa21b44ca8cdab5e"`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_b0f6c98aac521060f8b68fe5c87"`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_1bee392c44b1aebe754932133a8"`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_5ae5bbb0c93c048b0b76b1d4268"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2ec82ad068e84cf762c32ad7c7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ed1b53bd041aa21b44ca8cdab5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b9259f6741a7965a518e258f61"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5ae5bbb0c93c048b0b76b1d426"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_kubernetes_cluster_label_labelId" ON "KubernetesClusterLabel" ("labelId") `);
        await queryRunner.query(`CREATE INDEX "IDX_kubernetes_cluster_label_clusterId" ON "KubernetesClusterLabel" ("kubernetesClusterId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_kubernetes_cluster_slug" ON "KubernetesCluster" ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_kubernetes_cluster_clusterIdentifier" ON "KubernetesCluster" ("clusterIdentifier") `);
        await queryRunner.query(`CREATE INDEX "IDX_kubernetes_cluster_projectId" ON "KubernetesCluster" ("projectId") `);
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" ADD CONSTRAINT "FK_kubernetes_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "KubernetesClusterLabel" ADD CONSTRAINT "FK_kubernetes_cluster_label_clusterId" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_kubernetes_cluster_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_kubernetes_cluster_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_kubernetes_cluster_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
