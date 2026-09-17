import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandOwnerRuleInheritFlags1779823516881
  implements MigrationInterface
{
  public name: string = "ExpandOwnerRuleInheritFlags1779823516881";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "inheritOwnersFromKubernetesClusters" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "inheritOwnersFromDockerHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "inheritOwnersFromServices" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "inheritOwnersFromKubernetesClusters" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "inheritOwnersFromDockerHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "inheritOwnersFromServices" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD "inheritOwnersFromHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD "inheritOwnersFromKubernetesClusters" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD "inheritOwnersFromDockerHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD "inheritOwnersFromServices" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP COLUMN "inheritOwnersFromServices"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP COLUMN "inheritOwnersFromDockerHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP COLUMN "inheritOwnersFromKubernetesClusters"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP COLUMN "inheritOwnersFromHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "inheritOwnersFromServices"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "inheritOwnersFromDockerHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "inheritOwnersFromKubernetesClusters"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "inheritOwnersFromServices"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "inheritOwnersFromDockerHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "inheritOwnersFromKubernetesClusters"`,
    );
  }
}
