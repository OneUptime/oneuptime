/*
 * WHEN A FORM SHOWS ITS MODEL COLUMN'S DESCRIPTION.
 *
 * A form field with no description of its own shows its column's
 * (BasicModelForm). Those are written for the API reference, and the most
 * common of them only say what the field's title already says, in English
 * whatever the reader's language: "Any friendly name of this object" under
 * Name, "Friendly description that will help you remember" under
 * Description - on the create and edit form of nearly every settings page.
 * They are left off: the title and the placeholder say it, and a page that
 * has something to add says it in its own words, translated.
 *
 * Only a description that restates its field, as a whole: one that goes on
 * to say more ("Friendly name for this connection, shown wherever a call
 * is started") is still shown.
 *
 * React-free, so App's description scans read the same rule
 * (App/Tests/Dashboard/DescriptionScan).
 */

// Restating, word for word: the generic ones most models carry.
export const RESTATING_COLUMN_DESCRIPTIONS: ReadonlyArray<string> = [
  "Any friendly name of this object",
  "Friendly description that will help you remember",
  "Friendly description to help you remember",
];

/*
 * And their model-specific forms - "Friendly name for this rule.", "Any
 * friendly name of this policy", "Friendly description for this host" - a
 * single clause naming the field and the record and nothing else: no comma,
 * and no sentence after it. Anchored at both ends, one repeat of a class
 * that holds neither a comma nor a full stop: linear in the text.
 */
const RESTATING_CLAUSE: RegExp =
  /^(any )?friendly (name|description) (of|for) this [^.,]+\.?$/i;

// Whether a column's description only restates its field (see above).
export const isRestatingColumnDescription: (
  description: string | undefined | null,
) => boolean = (description: string | undefined | null): boolean => {
  if (!description) {
    return false;
  }

  const text: string = description.trim();

  if (RESTATING_COLUMN_DESCRIPTIONS.includes(text)) {
    return true;
  }

  return RESTATING_CLAUSE.test(text);
};
