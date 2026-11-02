import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Whether a Kubernetes object needed attention when the agent last saw it -
 * "critical", "warning", or null when it did not - as ingest works it out
 * from the object's status (Common/Types/Kubernetes/KubernetesHealth). The
 * cluster's Overview reads the objects that need attention through it,
 * instead of the whole inventory.
 *
 * The column is new and nullable, with no default: adding it only changes
 * the catalogue, never rewrites a row or holds a long lock. Every row is
 * null until the agent's next snapshot of it, within five minutes. Its
 * index is built online in AddKubernetesResourceHealthSeverityIndex.
 */
export class AddKubernetesResourceHealthSeverity1808800000000
  implements MigrationInterface
{
  public name: string = "AddKubernetesResourceHealthSeverity1808800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "healthSeverity" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "healthSeverity"`,
    );
  }
}
