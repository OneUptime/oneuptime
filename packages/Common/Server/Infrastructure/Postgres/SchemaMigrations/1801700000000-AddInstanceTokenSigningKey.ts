import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The key an installation signs its tokens with when ENCRYPTION_SECRET is
 * unset or still a placeholder the repository ships (TokenSigningKey). The
 * table starts empty: the first OneUptime process to start on such an
 * installation writes its one row, and an installation that set its own
 * ENCRYPTION_SECRET never writes it.
 */
export class AddInstanceTokenSigningKey1801700000000
  implements MigrationInterface
{
  public name: string = "AddInstanceTokenSigningKey1801700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "InstanceTokenSigningKey" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "signingKey" character varying(100) NOT NULL, CONSTRAINT "PK_97cfee3bded01f859db2abbd4ee" PRIMARY KEY ("_id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "InstanceTokenSigningKey"`);
  }
}
