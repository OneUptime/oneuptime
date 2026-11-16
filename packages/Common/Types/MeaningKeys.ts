/*
 * KEYS THAT NAME THEIR MEANING.
 *
 * A key of the Dashboard's locales is its English text, so an English word
 * that means two things is worded one way in each language, for every place
 * that looks it up. "Open" is every Open button's verb, so an open invoice
 * read "Abrir" ("open it") in Spanish; "View" is the View buttons' verb, so a
 * database's view read "Ver"; "Change" is the Change buttons' verb, so a
 * schema change read "Cambiar".
 *
 * Such a meaning takes a key of its own: the word, then what it means in
 * brackets, for the translator - "Open (invoice status)", "View (database
 * object)" - worded as that meaning in every language ("Pendiente",
 * "Vista"). English reads the word alone, "Open" or "View", and so does a
 * language whose locale has no wording of the key yet.
 *
 * The translator knows the keys listed here: wherever one is looked up with
 * no wording of its own - Translator's translateText and translateTerm, a
 * value of an English sentence, the front ends' translateString - it reads as
 * its word. So such a key can be anything a key can be: a column's or a
 * filter's title, a dropdown's option, a pill's text, drawn by any component.
 *
 * A key is listed here once its meaning is checked against every place that
 * looks it up (App/Tests/Dashboard/OneMeaningPerKey). A key that only looks
 * like one - "Description (optional)", "Retention (days)" - is not, and reads
 * as its whole text.
 */
export const MEANING_KEYS: ReadonlyArray<string> = [
  // A data security issue that is still open (DataSecurityPills).
  "Open (status)",
  // An invoice that is issued and not paid yet (Settings > Invoices).
  "Open (invoice status)",
  // What an import did with a row (ImportResultWords).
  "Created (import result)",
  /*
   * A data asset's kind: a database's view and table (DataAssetKindWords).
   * The table is also the title over Data Observability's lists of tables,
   * a table's page and its side menu (#8176).
   */
  "View (database object)",
  "Table (database object)",
  // The Schema Changes list's Change filter and column.
  "Change (schema change)",
  /*
   * The dbt Tests card's Test column and filter, over the names of the
   * tests dbt runs: "Test" alone is the Test buttons' verb ("Testen",
   * "Probar", "Tester").
   */
  "Test (dbt test)",
  /*
   * The environment a data store serves, beside Production and Staging:
   * its form's and the Data Stores list's choice, its Overview and its
   * settings (DATA_STORE_ENVIRONMENT_TITLES). The bare "Test" read
   * "Testen" on a German store and "Probar" ("to try") on a Spanish one
   * (#8342).
   */
  "Test (environment)",
  /*
   * The storage array a hardware component or a volume is in: the storage
   * widgets' column, a tile's row and the Sort setting's choice (#7522).
   * The bare "Array" read as a programming array in six languages (配列,
   * Matriz, Tableau, 배열, 数组, Matrise).
   */
  "Array (storage array)",
  /*
   * The two ends of a range: a date or number filter's "is between", a
   * custom time range, a dashboard's time range and a facet's date range
   * (#8201). The bare "From" and "To" are a message's sender and recipient
   * - the notification logs' columns - so a German filter read "Von" ...
   * "An" (to someone), a Japanese one 差出人 ... 宛先.
   */
  "From (range start)",
  "To (range end)",
  /*
   * A month that fell short of its SLO's target: the verdict on an SLO's
   * Monthly Report (#5476). The bare "Missed" is an incident SLA's missed
   * deadline, worded for a deadline in most languages - Danish
   * "Overskredet" (exceeded), Norwegian "Oversittet", Japanese 見逃し
   * (overlooked) - which no target is.
   */
  "Missed (target)",
];

// "<word> (<what it means>)": the word, and its meaning in brackets.
export const MEANING_KEY_PATTERN: RegExp = /^(\S(?:.*\S)?) \(([^()]+)\)$/;

const WORD_OF_MEANING_KEY: ReadonlyMap<string, string> = new Map<
  string,
  string
>(
  MEANING_KEYS.map((key: string): [string, string] => {
    const match: RegExpMatchArray | null = key.match(MEANING_KEY_PATTERN);

    return [key, match ? (match[1] as string) : key];
  }),
);

/*
 * What a listed key reads as where the reader's language has no wording of
 * its own: "Open" for "Open (invoice status)". Undefined for any other text,
 * which reads as it is written.
 */
export function getWordOfMeaningKey(
  text: string | undefined,
): string | undefined {
  if (typeof text !== "string" || text.length === 0) {
    return undefined;
  }

  return WORD_OF_MEANING_KEY.get(text);
}

// The text as English draws it: a listed key's word, any other text itself.
export function withMeaningKeyAsItsWord(text: string): string {
  return getWordOfMeaningKey(text) ?? text;
}
