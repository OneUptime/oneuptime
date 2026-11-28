import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "./TranslateTemplate";

/*
 * NAMES JOINED THE WAY A SENTENCE LISTS THEM: "Payments or Search",
 * "Payments, Search and Billing". Shared by the Dashboard's sentences
 * (Components/AiAccess/AiAccessModes re-exports it) and Common's own - a
 * lock that names the labels a permission is limited to (RecordLabelLock).
 */

export type NameListConjunction = "and" | "or";

/*
 * Names joined the way a sentence lists them, by how many there are: each
 * shape a whole key, so a locale sets its own separator and word.
 */
const NAME_LISTS: Readonly<
  Record<NameListConjunction, Readonly<Record<2 | 3, string>>>
> = {
  and: {
    2: translationKey("{{first}} and {{second}}"),
    3: translationKey("{{first}}, {{second}} and {{third}}"),
  },
  or: {
    2: translationKey("{{first}} or {{second}}"),
    3: translationKey("{{first}}, {{second}} or {{third}}"),
  },
};

/*
 * "a, b and c" / "a, b or c". Built with `translator`: hand it in as a
 * composedValue() of the sentence it goes into, so it is in that sentence's
 * language.
 */
export function formatNameList(
  names: ReadonlyArray<string>,
  conjunction: NameListConjunction,
  translator: Translator = getGlobalTranslator(),
): string {
  if (names.length <= 1) {
    return names.join("");
  }

  // Never more than three today; any more are said together as the first.
  if (names.length > 3) {
    const together: number = names.length - 2;

    return formatNameList(
      [names.slice(0, together).join(", "), ...names.slice(together)],
      conjunction,
      translator,
    );
  }

  const [first, second, third] = names;

  return translator.translateTemplate(
    NAME_LISTS[conjunction][names.length as 2 | 3],
    third === undefined
      ? { first: first!, second: second! }
      : { first: first!, second: second!, third },
  );
}
