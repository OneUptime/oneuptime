import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * "CREATED", AS AN IMPORT SAYS WHAT HAPPENED TO A ROW (#7097).
 *
 * The CSV imports' results (network sites, a status page's groups) and an
 * import from another tool mark each row "Created", "Failed" or "Skipped".
 * "Created" alone is mostly a date column's title ("Created" over the
 * time a record was made), so a language words that key as the column:
 * Arabic تاريخ الإنشاء ("creation date"), Japanese 作成. Over a row that
 * was just imported it read as a date's heading, not as what happened.
 *
 * So the outcome has a key of its own, worded as the outcome in every
 * language: Arabic تم الإنشاء ("was created", beside تم التخطي for
 * Skipped), Japanese 作成済み (beside スキップ済み). The key's English
 * names its meaning for the translator, and the translator reads it as
 * "Created" on an English page, as the docs quote it, and in a language
 * with no wording of its own (Common/Types/MeaningKeys). Look it up as any
 * key: translator.translateText(CREATED_IMPORT_RESULT).
 */
export const CREATED_IMPORT_RESULT: string = translationKey(
  "Created (import result)",
);
