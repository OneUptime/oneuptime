import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A form's branding (Forms > a form > Build > Branding): the logo its public
 * page shows in place of the OneUptime logo, what that logo says for screen
 * readers, and the browser tab's icon. Both images are Files; deleting one
 * only takes it off the form (ON DELETE SET NULL), never the form with it.
 * Every existing form starts without either, so its page keeps the
 * OneUptime logo and favicon.
 */
export class AddFormBranding1797700000000 implements MigrationInterface {
  public name: string = "AddFormBranding1797700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Form" ADD "logoFileId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "Form" ADD "logoAltText" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "Form" ADD "faviconFileId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "Form" ADD CONSTRAINT "FK_995c34464a0d0e3e6502afef243" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" ADD CONSTRAINT "FK_2782e1b9491115ab7fee075be25" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Form" DROP CONSTRAINT "FK_2782e1b9491115ab7fee075be25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" DROP CONSTRAINT "FK_995c34464a0d0e3e6502afef243"`,
    );
    await queryRunner.query(`ALTER TABLE "Form" DROP COLUMN "faviconFileId"`);
    await queryRunner.query(`ALTER TABLE "Form" DROP COLUMN "logoAltText"`);
    await queryRunner.query(`ALTER TABLE "Form" DROP COLUMN "logoFileId"`);
  }
}
