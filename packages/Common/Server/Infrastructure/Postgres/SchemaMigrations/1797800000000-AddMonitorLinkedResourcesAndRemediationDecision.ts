import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two additions:
 *
 * - A monitor can say what it watches (Monitor > Overview > Linked
 *   Resources): the hosts, Kubernetes clusters, container hosts, clusters,
 *   databases, IoT fleets and services an incident or alert from it is
 *   about. One join table per resource type, as for an incident's affected
 *   resources. Deleting the monitor or the resource only removes the link.
 *   Every existing monitor starts with no links, so nothing it creates
 *   changes until someone adds one.
 *
 * - AutoRemediationDecision: what auto-remediation did, or why it did
 *   nothing, each time the rule engine evaluated an incident or alert.
 *   Written by the server only, and deleted with its incident or alert.
 */

export class AddMonitorLinkedResourcesAndRemediationDecision1797800000000
  implements MigrationInterface
{
  public name: string =
    "AddMonitorLinkedResourcesAndRemediationDecision1797800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationDecision" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid, "alertId" uuid, "stage" character varying(100) NOT NULL, "entries" jsonb, CONSTRAINT "PK_5768d6aa0eef3f7e43c240e4305" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4247a3ebf89c2d3331d70c6d6" ON "AutoRemediationDecision" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_113e5f8a49dad86ef05e154d65" ON "AutoRemediationDecision" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7dbbcc21db65ad11f461b8fbba" ON "AutoRemediationDecision" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorHost" ("monitorId" uuid NOT NULL, "hostId" uuid NOT NULL, CONSTRAINT "PK_aa8611fe6794f825af8e6423903" PRIMARY KEY ("monitorId", "hostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b85e80125d82a4dd758a94baf8" ON "MonitorHost" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_388584dbeabf5a64cf33553cab" ON "MonitorHost" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorKubernetesCluster" ("monitorId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, CONSTRAINT "PK_13710d86d312d1ad48ac25260eb" PRIMARY KEY ("monitorId", "kubernetesClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ecdad99790492c798564b7d7db" ON "MonitorKubernetesCluster" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c68815b92d5c38cb556be8e44" ON "MonitorKubernetesCluster" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorDockerHost" ("monitorId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, CONSTRAINT "PK_04acc74ef3e8f0f7a97bc715ffc" PRIMARY KEY ("monitorId", "dockerHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a71084b8a1e7be46c6e94524e" ON "MonitorDockerHost" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e530797d0235e78875667984ee" ON "MonitorDockerHost" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorPodmanHost" ("monitorId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_1511c5e9075fc9c6820d647330d" PRIMARY KEY ("monitorId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_86883fcc1cc799d8d63780d99b" ON "MonitorPodmanHost" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0c3a08e6df30f8467a6c692d9" ON "MonitorPodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorProxmoxCluster" ("monitorId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, CONSTRAINT "PK_1c1f062326d718d48dd777be48d" PRIMARY KEY ("monitorId", "proxmoxClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a30aa2d5693bf1eaa4cdb3280d" ON "MonitorProxmoxCluster" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_789c58f261d334daf4162993cd" ON "MonitorProxmoxCluster" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorVMwareVCenter" ("monitorId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, CONSTRAINT "PK_e9e7ef1e030c9089803ba519191" PRIMARY KEY ("monitorId", "vmwareVCenterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_069c024d5570b46d8a05d58410" ON "MonitorVMwareVCenter" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6327a45ee36b3e28c6b7cbdeee" ON "MonitorVMwareVCenter" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorCephCluster" ("monitorId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, CONSTRAINT "PK_fd4f66dbbd3333f0e096844d281" PRIMARY KEY ("monitorId", "cephClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf4540eaadea00442566aead1a" ON "MonitorCephCluster" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7577b24ed0435cfd95f5b52a9" ON "MonitorCephCluster" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorDockerSwarmCluster" ("monitorId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, CONSTRAINT "PK_2eb87731115c3ebc580d85c5776" PRIMARY KEY ("monitorId", "dockerSwarmClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d121dfee4b5446e9673e7f629" ON "MonitorDockerSwarmCluster" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_245b3cc5f7a57ebfc4e61a2dfd" ON "MonitorDockerSwarmCluster" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorIoTFleet" ("monitorId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, CONSTRAINT "PK_6bc3638d64379c7048eab02a060" PRIMARY KEY ("monitorId", "iotFleetId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d519afba0c021a6b353896ffb8" ON "MonitorIoTFleet" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_867d337f0a0382106dcc9bcccb" ON "MonitorIoTFleet" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorDatabaseServer" ("monitorId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, CONSTRAINT "PK_e2ffcac4b4cc27ff11060ef4175" PRIMARY KEY ("monitorId", "databaseServerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad3b4cfa1a0226dbe17d37ff17" ON "MonitorDatabaseServer" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45482249ed771d87a1735af289" ON "MonitorDatabaseServer" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorService" ("monitorId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_0c9d40b2eb1b3d7e1f2a84e8627" PRIMARY KEY ("monitorId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a59a927b0a7e0f903716c9e195" ON "MonitorService" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c99337c886ff40f72922ceb3e" ON "MonitorService" ("serviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationDecision" ADD CONSTRAINT "FK_a4247a3ebf89c2d3331d70c6d62" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationDecision" ADD CONSTRAINT "FK_113e5f8a49dad86ef05e154d65b" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationDecision" ADD CONSTRAINT "FK_7dbbcc21db65ad11f461b8fbbaa" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorHost" ADD CONSTRAINT "FK_b85e80125d82a4dd758a94baf81" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorHost" ADD CONSTRAINT "FK_388584dbeabf5a64cf33553cab6" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorKubernetesCluster" ADD CONSTRAINT "FK_ecdad99790492c798564b7d7db9" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorKubernetesCluster" ADD CONSTRAINT "FK_5c68815b92d5c38cb556be8e44c" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerHost" ADD CONSTRAINT "FK_8a71084b8a1e7be46c6e94524ed" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerHost" ADD CONSTRAINT "FK_e530797d0235e78875667984eed" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorPodmanHost" ADD CONSTRAINT "FK_86883fcc1cc799d8d63780d99b4" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorPodmanHost" ADD CONSTRAINT "FK_c0c3a08e6df30f8467a6c692d9d" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProxmoxCluster" ADD CONSTRAINT "FK_a30aa2d5693bf1eaa4cdb3280dc" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProxmoxCluster" ADD CONSTRAINT "FK_789c58f261d334daf4162993cd1" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorVMwareVCenter" ADD CONSTRAINT "FK_069c024d5570b46d8a05d584105" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorVMwareVCenter" ADD CONSTRAINT "FK_6327a45ee36b3e28c6b7cbdeeeb" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCephCluster" ADD CONSTRAINT "FK_bf4540eaadea00442566aead1ae" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCephCluster" ADD CONSTRAINT "FK_b7577b24ed0435cfd95f5b52a99" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerSwarmCluster" ADD CONSTRAINT "FK_6d121dfee4b5446e9673e7f6290" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerSwarmCluster" ADD CONSTRAINT "FK_245b3cc5f7a57ebfc4e61a2dfde" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorIoTFleet" ADD CONSTRAINT "FK_d519afba0c021a6b353896ffb8d" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorIoTFleet" ADD CONSTRAINT "FK_867d337f0a0382106dcc9bcccb7" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDatabaseServer" ADD CONSTRAINT "FK_ad3b4cfa1a0226dbe17d37ff17c" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDatabaseServer" ADD CONSTRAINT "FK_45482249ed771d87a1735af289e" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorService" ADD CONSTRAINT "FK_a59a927b0a7e0f903716c9e1955" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorService" ADD CONSTRAINT "FK_0c99337c886ff40f72922ceb3e2" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorService" DROP CONSTRAINT "FK_0c99337c886ff40f72922ceb3e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorService" DROP CONSTRAINT "FK_a59a927b0a7e0f903716c9e1955"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDatabaseServer" DROP CONSTRAINT "FK_45482249ed771d87a1735af289e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDatabaseServer" DROP CONSTRAINT "FK_ad3b4cfa1a0226dbe17d37ff17c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorIoTFleet" DROP CONSTRAINT "FK_867d337f0a0382106dcc9bcccb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorIoTFleet" DROP CONSTRAINT "FK_d519afba0c021a6b353896ffb8d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerSwarmCluster" DROP CONSTRAINT "FK_245b3cc5f7a57ebfc4e61a2dfde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerSwarmCluster" DROP CONSTRAINT "FK_6d121dfee4b5446e9673e7f6290"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCephCluster" DROP CONSTRAINT "FK_b7577b24ed0435cfd95f5b52a99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCephCluster" DROP CONSTRAINT "FK_bf4540eaadea00442566aead1ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorVMwareVCenter" DROP CONSTRAINT "FK_6327a45ee36b3e28c6b7cbdeeeb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorVMwareVCenter" DROP CONSTRAINT "FK_069c024d5570b46d8a05d584105"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProxmoxCluster" DROP CONSTRAINT "FK_789c58f261d334daf4162993cd1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProxmoxCluster" DROP CONSTRAINT "FK_a30aa2d5693bf1eaa4cdb3280dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorPodmanHost" DROP CONSTRAINT "FK_c0c3a08e6df30f8467a6c692d9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorPodmanHost" DROP CONSTRAINT "FK_86883fcc1cc799d8d63780d99b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerHost" DROP CONSTRAINT "FK_e530797d0235e78875667984eed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDockerHost" DROP CONSTRAINT "FK_8a71084b8a1e7be46c6e94524ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorKubernetesCluster" DROP CONSTRAINT "FK_5c68815b92d5c38cb556be8e44c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorKubernetesCluster" DROP CONSTRAINT "FK_ecdad99790492c798564b7d7db9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorHost" DROP CONSTRAINT "FK_388584dbeabf5a64cf33553cab6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorHost" DROP CONSTRAINT "FK_b85e80125d82a4dd758a94baf81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationDecision" DROP CONSTRAINT "FK_7dbbcc21db65ad11f461b8fbbaa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationDecision" DROP CONSTRAINT "FK_113e5f8a49dad86ef05e154d65b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationDecision" DROP CONSTRAINT "FK_a4247a3ebf89c2d3331d70c6d62"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c99337c886ff40f72922ceb3e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a59a927b0a7e0f903716c9e195"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorService"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45482249ed771d87a1735af289"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad3b4cfa1a0226dbe17d37ff17"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorDatabaseServer"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_867d337f0a0382106dcc9bcccb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d519afba0c021a6b353896ffb8"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorIoTFleet"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_245b3cc5f7a57ebfc4e61a2dfd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d121dfee4b5446e9673e7f629"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorDockerSwarmCluster"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7577b24ed0435cfd95f5b52a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf4540eaadea00442566aead1a"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorCephCluster"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6327a45ee36b3e28c6b7cbdeee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_069c024d5570b46d8a05d58410"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorVMwareVCenter"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_789c58f261d334daf4162993cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a30aa2d5693bf1eaa4cdb3280d"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorProxmoxCluster"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0c3a08e6df30f8467a6c692d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_86883fcc1cc799d8d63780d99b"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorPodmanHost"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e530797d0235e78875667984ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a71084b8a1e7be46c6e94524e"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorDockerHost"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c68815b92d5c38cb556be8e44"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ecdad99790492c798564b7d7db"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorKubernetesCluster"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_388584dbeabf5a64cf33553cab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b85e80125d82a4dd758a94baf8"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorHost"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7dbbcc21db65ad11f461b8fbba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_113e5f8a49dad86ef05e154d65"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4247a3ebf89c2d3331d70c6d6"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationDecision"`);
  }
}
