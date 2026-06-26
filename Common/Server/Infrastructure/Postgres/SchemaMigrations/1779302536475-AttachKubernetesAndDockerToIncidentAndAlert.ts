import { MigrationInterface, QueryRunner } from "typeorm";

export class AttachKubernetesAndDockerToIncidentAndAlert1779302536475
  implements MigrationInterface
{
  public name: string =
    "AttachKubernetesAndDockerToIncidentAndAlert1779302536475";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IncidentKubernetesCluster
    await queryRunner.query(
      `CREATE TABLE "IncidentKubernetesCluster" ("incidentId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, CONSTRAINT "PK_0706004605b87701df3fb2fc4fb" PRIMARY KEY ("incidentId", "kubernetesClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d49468cbea4ece4fe7e2ecf3f" ON "IncidentKubernetesCluster" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb313f51853d6178c1ea498405" ON "IncidentKubernetesCluster" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesCluster" ADD CONSTRAINT "FK_4d49468cbea4ece4fe7e2ecf3f8" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesCluster" ADD CONSTRAINT "FK_cb313f51853d6178c1ea498405e" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentKubernetesResource
    await queryRunner.query(
      `CREATE TABLE "IncidentKubernetesResource" ("incidentId" uuid NOT NULL, "kubernetesResourceId" uuid NOT NULL, CONSTRAINT "PK_2d7d43459ccef0edddd433dab0f" PRIMARY KEY ("incidentId", "kubernetesResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_706dad5f9b04e57516310bb107" ON "IncidentKubernetesResource" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd41e6a5b7368685534190f8e8" ON "IncidentKubernetesResource" ("kubernetesResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesResource" ADD CONSTRAINT "FK_706dad5f9b04e57516310bb1076" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesResource" ADD CONSTRAINT "FK_bd41e6a5b7368685534190f8e85" FOREIGN KEY ("kubernetesResourceId") REFERENCES "KubernetesResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentKubernetesContainer
    await queryRunner.query(
      `CREATE TABLE "IncidentKubernetesContainer" ("incidentId" uuid NOT NULL, "kubernetesContainerId" uuid NOT NULL, CONSTRAINT "PK_96c823347cee097c4c99d60d472" PRIMARY KEY ("incidentId", "kubernetesContainerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_318c277a133ab782087eee5a93" ON "IncidentKubernetesContainer" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_411d29efab26561877b148bb21" ON "IncidentKubernetesContainer" ("kubernetesContainerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesContainer" ADD CONSTRAINT "FK_318c277a133ab782087eee5a93b" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesContainer" ADD CONSTRAINT "FK_411d29efab26561877b148bb218" FOREIGN KEY ("kubernetesContainerId") REFERENCES "KubernetesContainer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentDockerHost
    await queryRunner.query(
      `CREATE TABLE "IncidentDockerHost" ("incidentId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, CONSTRAINT "PK_56a970e60a6af0ae3bc03952a82" PRIMARY KEY ("incidentId", "dockerHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_364b7b272015813b8ee02314c4" ON "IncidentDockerHost" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9761ce8eb83f4d63d7fef00a55" ON "IncidentDockerHost" ("dockerHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerHost" ADD CONSTRAINT "FK_364b7b272015813b8ee02314c45" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerHost" ADD CONSTRAINT "FK_9761ce8eb83f4d63d7fef00a55c" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentDockerResource
    await queryRunner.query(
      `CREATE TABLE "IncidentDockerResource" ("incidentId" uuid NOT NULL, "dockerResourceId" uuid NOT NULL, CONSTRAINT "PK_5c1f59bafc8278da53767c2aeae" PRIMARY KEY ("incidentId", "dockerResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a1cf0cb50fec5135cfd715e2c" ON "IncidentDockerResource" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c90832cd0bce96661ae3e3652c" ON "IncidentDockerResource" ("dockerResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerResource" ADD CONSTRAINT "FK_5a1cf0cb50fec5135cfd715e2cb" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerResource" ADD CONSTRAINT "FK_c90832cd0bce96661ae3e3652cc" FOREIGN KEY ("dockerResourceId") REFERENCES "DockerResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertKubernetesCluster
    await queryRunner.query(
      `CREATE TABLE "AlertKubernetesCluster" ("alertId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, CONSTRAINT "PK_36951c4b963d30a51d49db2f185" PRIMARY KEY ("alertId", "kubernetesClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c59dd1fbaa2623c55147588fa" ON "AlertKubernetesCluster" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b880dd9641b488d37e9c4dbc96" ON "AlertKubernetesCluster" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesCluster" ADD CONSTRAINT "FK_9c59dd1fbaa2623c55147588fa4" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesCluster" ADD CONSTRAINT "FK_b880dd9641b488d37e9c4dbc967" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertKubernetesResource
    await queryRunner.query(
      `CREATE TABLE "AlertKubernetesResource" ("alertId" uuid NOT NULL, "kubernetesResourceId" uuid NOT NULL, CONSTRAINT "PK_55c136562d0b3ca986eedd20344" PRIMARY KEY ("alertId", "kubernetesResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09847045f3b90d01b5d5116a27" ON "AlertKubernetesResource" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_04479f7cd61764c417284364e4" ON "AlertKubernetesResource" ("kubernetesResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesResource" ADD CONSTRAINT "FK_09847045f3b90d01b5d5116a278" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesResource" ADD CONSTRAINT "FK_04479f7cd61764c417284364e49" FOREIGN KEY ("kubernetesResourceId") REFERENCES "KubernetesResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertKubernetesContainer
    await queryRunner.query(
      `CREATE TABLE "AlertKubernetesContainer" ("alertId" uuid NOT NULL, "kubernetesContainerId" uuid NOT NULL, CONSTRAINT "PK_5004da87e6cee38c2cdce1c015b" PRIMARY KEY ("alertId", "kubernetesContainerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5e3b19d56842d98ad736f2451" ON "AlertKubernetesContainer" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cc7bd03e0d9fec67856319959b" ON "AlertKubernetesContainer" ("kubernetesContainerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesContainer" ADD CONSTRAINT "FK_e5e3b19d56842d98ad736f2451e" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesContainer" ADD CONSTRAINT "FK_cc7bd03e0d9fec67856319959be" FOREIGN KEY ("kubernetesContainerId") REFERENCES "KubernetesContainer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertDockerHost
    await queryRunner.query(
      `CREATE TABLE "AlertDockerHost" ("alertId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, CONSTRAINT "PK_12c730ea1126a0cccde73ce819e" PRIMARY KEY ("alertId", "dockerHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2b33c4643132be69e65dc48653" ON "AlertDockerHost" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e98f39fecd1bc955015882ca34" ON "AlertDockerHost" ("dockerHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerHost" ADD CONSTRAINT "FK_2b33c4643132be69e65dc48653c" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerHost" ADD CONSTRAINT "FK_e98f39fecd1bc955015882ca34b" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertDockerResource
    await queryRunner.query(
      `CREATE TABLE "AlertDockerResource" ("alertId" uuid NOT NULL, "dockerResourceId" uuid NOT NULL, CONSTRAINT "PK_60dbce6b63a1cac67178bbb3998" PRIMARY KEY ("alertId", "dockerResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8843cfc9ef7118e39a40d32548" ON "AlertDockerResource" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c781b3411915ba016ea3fc30fd" ON "AlertDockerResource" ("dockerResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerResource" ADD CONSTRAINT "FK_8843cfc9ef7118e39a40d325489" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerResource" ADD CONSTRAINT "FK_c781b3411915ba016ea3fc30fd3" FOREIGN KEY ("dockerResourceId") REFERENCES "DockerResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertDockerResource" DROP CONSTRAINT "FK_c781b3411915ba016ea3fc30fd3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerResource" DROP CONSTRAINT "FK_8843cfc9ef7118e39a40d325489"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerHost" DROP CONSTRAINT "FK_e98f39fecd1bc955015882ca34b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerHost" DROP CONSTRAINT "FK_2b33c4643132be69e65dc48653c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesContainer" DROP CONSTRAINT "FK_cc7bd03e0d9fec67856319959be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesContainer" DROP CONSTRAINT "FK_e5e3b19d56842d98ad736f2451e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesResource" DROP CONSTRAINT "FK_04479f7cd61764c417284364e49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesResource" DROP CONSTRAINT "FK_09847045f3b90d01b5d5116a278"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesCluster" DROP CONSTRAINT "FK_b880dd9641b488d37e9c4dbc967"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertKubernetesCluster" DROP CONSTRAINT "FK_9c59dd1fbaa2623c55147588fa4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerResource" DROP CONSTRAINT "FK_c90832cd0bce96661ae3e3652cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerResource" DROP CONSTRAINT "FK_5a1cf0cb50fec5135cfd715e2cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerHost" DROP CONSTRAINT "FK_9761ce8eb83f4d63d7fef00a55c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerHost" DROP CONSTRAINT "FK_364b7b272015813b8ee02314c45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesContainer" DROP CONSTRAINT "FK_411d29efab26561877b148bb218"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesContainer" DROP CONSTRAINT "FK_318c277a133ab782087eee5a93b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesResource" DROP CONSTRAINT "FK_bd41e6a5b7368685534190f8e85"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesResource" DROP CONSTRAINT "FK_706dad5f9b04e57516310bb1076"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesCluster" DROP CONSTRAINT "FK_cb313f51853d6178c1ea498405e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentKubernetesCluster" DROP CONSTRAINT "FK_4d49468cbea4ece4fe7e2ecf3f8"`,
    );
    await queryRunner.query(`DROP TABLE "AlertDockerResource"`);
    await queryRunner.query(`DROP TABLE "AlertDockerHost"`);
    await queryRunner.query(`DROP TABLE "AlertKubernetesContainer"`);
    await queryRunner.query(`DROP TABLE "AlertKubernetesResource"`);
    await queryRunner.query(`DROP TABLE "AlertKubernetesCluster"`);
    await queryRunner.query(`DROP TABLE "IncidentDockerResource"`);
    await queryRunner.query(`DROP TABLE "IncidentDockerHost"`);
    await queryRunner.query(`DROP TABLE "IncidentKubernetesContainer"`);
    await queryRunner.query(`DROP TABLE "IncidentKubernetesResource"`);
    await queryRunner.query(`DROP TABLE "IncidentKubernetesCluster"`);
  }
}
