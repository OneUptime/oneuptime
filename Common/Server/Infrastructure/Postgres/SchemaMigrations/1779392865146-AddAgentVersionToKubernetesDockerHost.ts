import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentVersionToKubernetesDockerHost1779392865146
  implements MigrationInterface
{
  name = "AddAgentVersionToKubernetesDockerHost1779392865146";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "agentVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "agentVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "agentVersion" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "agentVersion"`);
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "agentVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "agentVersion"`,
    );
  }
}
