import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * macOS resourcedetection reports os.description as the full uname output
 * (e.g. "macOS 26.3.1 (25D2128) (Darwin … Kernel Version … RELEASE_ARM64_T6000 arm64)"),
 * which exceeds the 100-char ShortText limit. The OTel ingest pipeline
 * passes osVersion through the same atomic UPDATE that sets lastSeenAt and
 * the rest of the host metadata, so a too-long value silently failed every
 * field on the row — including lastSeenAt — leaving newly-discovered hosts
 * permanently empty and demoted to "disconnected" by the 5-min cron.
 *
 * Widen Host.osVersion and DockerHost.osVersion to LongText (500). Use
 * ALTER COLUMN ... TYPE so existing rows keep their osVersion data instead
 * of being wiped by the DROP+ADD pattern TypeORM auto-generated.
 */
export class WidenHostOsVersionToLongText1778066346303
  implements MigrationInterface
{
  public name: string = "WidenHostOsVersionToLongText1778066346303";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Host" ALTER COLUMN "osVersion" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ALTER COLUMN "osVersion" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Note: any rows with osVersion > 100 chars must be manually
     * shortened before this rollback, otherwise the ALTER COLUMN will fail.
     */
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ALTER COLUMN "osVersion" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ALTER COLUMN "osVersion" TYPE character varying(100)`,
    );
  }
}
