import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The key labels are put in order by (Label.nameSortKey,
 * Utils/NaturalOrder): numbered labels first, by their numbers - "1.
 * Category", "2. SubCategory", ... "10. Owner" - then the others
 * alphabetically, case and accents aside (OneUptime issue #5183). Every
 * create and rename writes it from the name (LabelService), and labels are
 * read in its order whenever they are asked for by name or in no order.
 *
 * Under the "C" collation, which compares code points as the browser
 * compares the keys it sorts a record's labels by: a database whose default
 * collation reads text by its language (en_US.utf8 skips punctuation and
 * spaces at first) would order some keys another way.
 *
 * Nullable, with no default: adding it rewrites no rows. The labels made
 * before it have none until the data migration BackfillLabelNameSortKeys
 * writes theirs; until then they are listed after the others, by name. No
 * index: a project's labels are few enough to sort as they are read.
 */
export class AddLabelNameSortKey1806200000000 implements MigrationInterface {
  public name: string = "AddLabelNameSortKey1806200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Label" ADD "nameSortKey" character varying(500) COLLATE "C"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Label" DROP COLUMN "nameSortKey"`);
  }
}
