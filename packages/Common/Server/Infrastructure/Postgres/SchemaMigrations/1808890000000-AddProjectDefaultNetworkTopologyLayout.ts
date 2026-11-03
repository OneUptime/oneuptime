import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The layout a project's network topology maps open on (issue #5378): one
 * of the ids in Types/NetworkDevice/NetworkTopologyLayout, set by a Project
 * Owner or Admin from the map's Arrange the map options.
 *
 * Nullable, with no default and no row written: every project has chosen
 * none, so each map opens on its own default as it did before - Automatic
 * for all devices, By network layer for one site. Adding it is a catalogue
 * change, not a rewrite.
 */
export class AddProjectDefaultNetworkTopologyLayout1808890000000
  implements MigrationInterface
{
  public name = "AddProjectDefaultNetworkTopologyLayout1808890000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "defaultNetworkTopologyLayout" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "defaultNetworkTopologyLayout"`,
    );
  }
}
