/*
 * WHEN A FORM SHOWS ITS MODEL COLUMN'S DESCRIPTION.
 *
 * A form field with no description of its own shows its column's
 * (BasicModelForm). Those are written for the API reference, and the most
 * common of them only say what the field's title already says, in English
 * whatever the reader's language: "Any friendly name of this object" under
 * Name, "Friendly description that will help you remember" under
 * Description, "Name of this alert grouping rule" - on the create and edit
 * form of nearly every settings page. They are left off: the title and the
 * placeholder say it, and a page that has something to add says it in its
 * own words, translated.
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

/*
 * And the plainer form most rules, templates and records carry: "Name of
 * this alert grouping rule", "Description of the Notification Rule",
 * "Title of this incident", "A description of this code repository". The
 * field's title, "of" or "for", "this" or "the", then the record's name in
 * at most six words, none of them a word that goes on to say more (below).
 * A bounded repeat of words with no space in them: linear in the text.
 */
const NAMING_CLAUSE: RegExp =
  /^(?:(?:a|an|any) )?(?:friendly )?(?:name|description|title) (?:of|for) (?:this|the) ((?:[^\s.,]+ ){0,5}[^\s.,]+)\.?$/i;

/*
 * A record's name holds none of these: they start what a description adds
 * to it - "Name of the Slack workspace for validation and identification",
 * "Name of the custom field on the related resource this field copies its
 * value from", "Name of the plan this project is subscribed to" - and such
 * a description is still shown.
 */
const WORDS_THAT_SAY_MORE: ReadonlySet<string> = new Set<string>([
  "about",
  "and",
  "as",
  "at",
  "be",
  "by",
  "can",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "used",
  "was",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
]);

const isNamingClause: (text: string) => boolean = (text: string): boolean => {
  const match: RegExpExecArray | null = NAMING_CLAUSE.exec(text);

  if (!match || !match[1]) {
    return false;
  }

  return !match[1].split(" ").some((word: string): boolean => {
    return WORDS_THAT_SAY_MORE.has(word.toLowerCase());
  });
};

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

  return RESTATING_CLAUSE.test(text) || isNamingClause(text);
};
