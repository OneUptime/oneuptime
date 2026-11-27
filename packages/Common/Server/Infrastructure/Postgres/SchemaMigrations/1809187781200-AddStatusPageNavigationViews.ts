import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusPageNavigationViews1809187781200
  implements MigrationInterface
{
  public name: string = "AddStatusPageNavigationViews1809187781200";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ADD "navigationPath" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ADD "isHidden" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ALTER COLUMN "link" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ADD CONSTRAINT "CHK_status_page_header_link_destination" CHECK (("link" IS NOT NULL) <> ("navigationPath" IS NOT NULL) AND ("navigationPath" IS NULL OR "navigationPath" ~ '^\\/(?:incidents(?:[?]category=[a-zA-Z0-9_-]+)?|announcements|scheduled-events)$'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" DROP CONSTRAINT "CHK_status_page_header_link_destination"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ALTER COLUMN "link" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" DROP COLUMN "isHidden"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" DROP COLUMN "navigationPath"`,
    );
  }
}
