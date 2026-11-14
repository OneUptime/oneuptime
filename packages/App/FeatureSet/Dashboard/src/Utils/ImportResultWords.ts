import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

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
 * names its meaning for the translator, and an English page still reads
 * "Created", as the docs quote it.
 */
export const CREATED_IMPORT_RESULT: string = translationKey(
  "Created (import result)",
);

// What an English page reads, and a language without a wording of its own.
export const CREATED_IMPORT_RESULT_IN_ENGLISH: string = "Created";

export function getCreatedImportResultLabel(translator: Translator): string {
  if (!translator.hasTranslation(CREATED_IMPORT_RESULT)) {
    return CREATED_IMPORT_RESULT_IN_ENGLISH;
  }

  return (
    translator.translateText(CREATED_IMPORT_RESULT) ||
    CREATED_IMPORT_RESULT_IN_ENGLISH
  );
}
