import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Activity feeds for the nine infrastructure and catalog resources that had
 * none: Kubernetes clusters, Docker and Podman hosts, Docker Swarm / Proxmox /
 * Ceph clusters, servers, cloud resources and catalog services. One
 * append-only table each, shaped like MonitorFeed, indexed on
 * (<resource>Id, postedAt) because that is the detail page's only query.
 */

export class AddResourceActivityFeeds1790100000000
  implements MigrationInterface
{
  public name: string = "AddResourceActivityFeeds1790100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "kubernetesClusterFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7f6e2cd1588e59a97ef68457bcf" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0db62df01f5b08a8c05a7c262c" ON "KubernetesClusterFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f79fece2ef9255c2714deb326b" ON "KubernetesClusterFeed" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf2faa50226f2c0536ad493134" ON "KubernetesClusterFeed" ("kubernetesClusterId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "dockerHostFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1048cccb34b66d90e0eda501878" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_733bc4fdb75299fe7109790286" ON "DockerHostFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_83b59956e0e2b2599b9a7ac6f0" ON "DockerHostFeed" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0b72c26ef70090c0ab06bedcc" ON "DockerHostFeed" ("dockerHostId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "dockerSwarmClusterFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c010e1007525e804030c509be31" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_70bb094e669a63a95f3eef57e6" ON "DockerSwarmClusterFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4eb62dc07d1a2f89eb557056b6" ON "DockerSwarmClusterFeed" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_814aaf0075060f806b80d2f6e1" ON "DockerSwarmClusterFeed" ("dockerSwarmClusterId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CephClusterFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "cephClusterFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c443284a9ecd531aac7cdd3f5c3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1577080a2c3af363198f01469a" ON "CephClusterFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e6aad52ba51f5093b05438183" ON "CephClusterFeed" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_17ff80c3072116c5401248dd1e" ON "CephClusterFeed" ("cephClusterId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "PodmanHostFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "podmanHostFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b663085c9c989aa447a99765f63" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a0acc80fd9897bc0a93e17fef" ON "PodmanHostFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d212120a2fbbb93154722d83d6" ON "PodmanHostFeed" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2b261c1b0773273244893227c" ON "PodmanHostFeed" ("podmanHostId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "proxmoxClusterFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6defd911bdd901fa445ff0b6915" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_742c5f095c3c04b2b7afaf656f" ON "ProxmoxClusterFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_51f0acc8226a99082ba95ede8c" ON "ProxmoxClusterFeed" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_545d9b8f06da86244d5f1ee80f" ON "ProxmoxClusterFeed" ("proxmoxClusterId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "hostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "hostFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0fb5f2fd75b026cb9f42e6e33ee" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff3c7a618777a517d30d84e4fb" ON "HostFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_27d9de66dbfa7e333745d18467" ON "HostFeed" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_609dd0a8cd7adf8b1e9972ee14" ON "HostFeed" ("hostId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudResourceFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "cloudResourceFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_54b6457b4ccb7c827a1d2fc19dd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b07973aeaa31a25a6bca796405" ON "CloudResourceFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ec6e25c2f7da2db4fff8e3363" ON "CloudResourceFeed" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_adc4900f8d69e476f4c76f0b2c" ON "CloudResourceFeed" ("cloudResourceId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "serviceFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e1512e2557e9c696806d5e1d836" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a5fe18c8efc91abac1bcfb086" ON "ServiceFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2313cb2cfb4f7c187875a1d4a8" ON "ServiceFeed" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a275ab75ef45335db6074f2d9" ON "ServiceFeed" ("serviceId", "postedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" ADD CONSTRAINT "FK_0db62df01f5b08a8c05a7c262cd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" ADD CONSTRAINT "FK_f79fece2ef9255c2714deb326b1" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" ADD CONSTRAINT "FK_731db82fb2211587da1a5969ae1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" ADD CONSTRAINT "FK_96955d2c6045e7614ea7e32d094" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" ADD CONSTRAINT "FK_a8ee18623036d679ab65a063937" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" ADD CONSTRAINT "FK_733bc4fdb75299fe71097902863" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" ADD CONSTRAINT "FK_83b59956e0e2b2599b9a7ac6f02" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" ADD CONSTRAINT "FK_a4d75a8fbef8c50364b914fc877" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" ADD CONSTRAINT "FK_ea2fec5b67b4793012567f37e42" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" ADD CONSTRAINT "FK_cfbff3fb7cfbbbfb196ece6615d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" ADD CONSTRAINT "FK_70bb094e669a63a95f3eef57e6d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" ADD CONSTRAINT "FK_4eb62dc07d1a2f89eb557056b67" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" ADD CONSTRAINT "FK_37e0ffe26f5feb8848f28ffd553" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" ADD CONSTRAINT "FK_03d94c48846fb0bc5a3c6fb2ce5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" ADD CONSTRAINT "FK_f14509264eee72155c3e9c6fb09" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" ADD CONSTRAINT "FK_1577080a2c3af363198f01469a8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" ADD CONSTRAINT "FK_0e6aad52ba51f5093b05438183d" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" ADD CONSTRAINT "FK_3b2ba3ec99aad14b711401e55b2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" ADD CONSTRAINT "FK_ffb8fc8339ba3f3f464dbe6fed9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" ADD CONSTRAINT "FK_9f581fe818d55c8a618a6ff9222" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" ADD CONSTRAINT "FK_5a0acc80fd9897bc0a93e17fef4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" ADD CONSTRAINT "FK_d212120a2fbbb93154722d83d6e" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" ADD CONSTRAINT "FK_eea38611c7abb7c7fe36cd828f8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" ADD CONSTRAINT "FK_97f590a072f99ab8701b61e137e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" ADD CONSTRAINT "FK_673de31f84fdc73c3da3ccc1c25" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" ADD CONSTRAINT "FK_742c5f095c3c04b2b7afaf656f8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" ADD CONSTRAINT "FK_51f0acc8226a99082ba95ede8cc" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" ADD CONSTRAINT "FK_c108755b315afc261df5ae1e25d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" ADD CONSTRAINT "FK_214df63ee38457195f1e909b4d7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" ADD CONSTRAINT "FK_cfd72f66e103f372e3e3efd07e2" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" ADD CONSTRAINT "FK_ff3c7a618777a517d30d84e4fb2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" ADD CONSTRAINT "FK_27d9de66dbfa7e333745d184674" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" ADD CONSTRAINT "FK_c67196812f0ffea5b57e9ec78a6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" ADD CONSTRAINT "FK_53868e9c522cc109a2f5e22f040" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" ADD CONSTRAINT "FK_907ed38febab6d3721102397021" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" ADD CONSTRAINT "FK_b07973aeaa31a25a6bca7964051" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" ADD CONSTRAINT "FK_5ec6e25c2f7da2db4fff8e33630" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" ADD CONSTRAINT "FK_18ce7be4e171964884f6ecb304d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" ADD CONSTRAINT "FK_1f9d0fef780f87f6de8c8025313" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" ADD CONSTRAINT "FK_d975a5f7188a81b0744fdb3618d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" ADD CONSTRAINT "FK_1a5fe18c8efc91abac1bcfb086f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" ADD CONSTRAINT "FK_2313cb2cfb4f7c187875a1d4a8c" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" ADD CONSTRAINT "FK_f53dbd8d854ca5c7fc9d1940d32" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" ADD CONSTRAINT "FK_73fcc4e6dfa23188f0668991916" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" ADD CONSTRAINT "FK_178ee5840893ca85c60d7833d9c" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" DROP CONSTRAINT "FK_178ee5840893ca85c60d7833d9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" DROP CONSTRAINT "FK_73fcc4e6dfa23188f0668991916"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" DROP CONSTRAINT "FK_f53dbd8d854ca5c7fc9d1940d32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" DROP CONSTRAINT "FK_2313cb2cfb4f7c187875a1d4a8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceFeed" DROP CONSTRAINT "FK_1a5fe18c8efc91abac1bcfb086f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" DROP CONSTRAINT "FK_d975a5f7188a81b0744fdb3618d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" DROP CONSTRAINT "FK_1f9d0fef780f87f6de8c8025313"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" DROP CONSTRAINT "FK_18ce7be4e171964884f6ecb304d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" DROP CONSTRAINT "FK_5ec6e25c2f7da2db4fff8e33630"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceFeed" DROP CONSTRAINT "FK_b07973aeaa31a25a6bca7964051"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" DROP CONSTRAINT "FK_907ed38febab6d3721102397021"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" DROP CONSTRAINT "FK_53868e9c522cc109a2f5e22f040"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" DROP CONSTRAINT "FK_c67196812f0ffea5b57e9ec78a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" DROP CONSTRAINT "FK_27d9de66dbfa7e333745d184674"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostFeed" DROP CONSTRAINT "FK_ff3c7a618777a517d30d84e4fb2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" DROP CONSTRAINT "FK_cfd72f66e103f372e3e3efd07e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" DROP CONSTRAINT "FK_214df63ee38457195f1e909b4d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" DROP CONSTRAINT "FK_c108755b315afc261df5ae1e25d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" DROP CONSTRAINT "FK_51f0acc8226a99082ba95ede8cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterFeed" DROP CONSTRAINT "FK_742c5f095c3c04b2b7afaf656f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" DROP CONSTRAINT "FK_673de31f84fdc73c3da3ccc1c25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" DROP CONSTRAINT "FK_97f590a072f99ab8701b61e137e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" DROP CONSTRAINT "FK_eea38611c7abb7c7fe36cd828f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" DROP CONSTRAINT "FK_d212120a2fbbb93154722d83d6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostFeed" DROP CONSTRAINT "FK_5a0acc80fd9897bc0a93e17fef4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" DROP CONSTRAINT "FK_9f581fe818d55c8a618a6ff9222"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" DROP CONSTRAINT "FK_ffb8fc8339ba3f3f464dbe6fed9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" DROP CONSTRAINT "FK_3b2ba3ec99aad14b711401e55b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" DROP CONSTRAINT "FK_0e6aad52ba51f5093b05438183d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterFeed" DROP CONSTRAINT "FK_1577080a2c3af363198f01469a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" DROP CONSTRAINT "FK_f14509264eee72155c3e9c6fb09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" DROP CONSTRAINT "FK_03d94c48846fb0bc5a3c6fb2ce5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" DROP CONSTRAINT "FK_37e0ffe26f5feb8848f28ffd553"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" DROP CONSTRAINT "FK_4eb62dc07d1a2f89eb557056b67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterFeed" DROP CONSTRAINT "FK_70bb094e669a63a95f3eef57e6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" DROP CONSTRAINT "FK_cfbff3fb7cfbbbfb196ece6615d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" DROP CONSTRAINT "FK_ea2fec5b67b4793012567f37e42"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" DROP CONSTRAINT "FK_a4d75a8fbef8c50364b914fc877"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" DROP CONSTRAINT "FK_83b59956e0e2b2599b9a7ac6f02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostFeed" DROP CONSTRAINT "FK_733bc4fdb75299fe71097902863"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" DROP CONSTRAINT "FK_a8ee18623036d679ab65a063937"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" DROP CONSTRAINT "FK_96955d2c6045e7614ea7e32d094"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" DROP CONSTRAINT "FK_731db82fb2211587da1a5969ae1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" DROP CONSTRAINT "FK_f79fece2ef9255c2714deb326b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterFeed" DROP CONSTRAINT "FK_0db62df01f5b08a8c05a7c262cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a275ab75ef45335db6074f2d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2313cb2cfb4f7c187875a1d4a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a5fe18c8efc91abac1bcfb086"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_adc4900f8d69e476f4c76f0b2c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ec6e25c2f7da2db4fff8e3363"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b07973aeaa31a25a6bca796405"`,
    );
    await queryRunner.query(`DROP TABLE "CloudResourceFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_609dd0a8cd7adf8b1e9972ee14"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27d9de66dbfa7e333745d18467"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff3c7a618777a517d30d84e4fb"`,
    );
    await queryRunner.query(`DROP TABLE "HostFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_545d9b8f06da86244d5f1ee80f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_51f0acc8226a99082ba95ede8c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_742c5f095c3c04b2b7afaf656f"`,
    );
    await queryRunner.query(`DROP TABLE "ProxmoxClusterFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b2b261c1b0773273244893227c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d212120a2fbbb93154722d83d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a0acc80fd9897bc0a93e17fef"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_17ff80c3072116c5401248dd1e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e6aad52ba51f5093b05438183"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1577080a2c3af363198f01469a"`,
    );
    await queryRunner.query(`DROP TABLE "CephClusterFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_814aaf0075060f806b80d2f6e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4eb62dc07d1a2f89eb557056b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_70bb094e669a63a95f3eef57e6"`,
    );
    await queryRunner.query(`DROP TABLE "DockerSwarmClusterFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0b72c26ef70090c0ab06bedcc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_83b59956e0e2b2599b9a7ac6f0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_733bc4fdb75299fe7109790286"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf2faa50226f2c0536ad493134"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f79fece2ef9255c2714deb326b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0db62df01f5b08a8c05a7c262c"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterFeed"`);
  }
}
