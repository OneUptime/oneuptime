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
  // A pull request that is neither merged nor closed (a Code task's Details).
  "Open (pull request)",
  /*
   * An invoice deleted in Stripe, and one with no status: worded for the
   * invoice, feminine where it is ("Eliminada", "Supprimée"), as Paid and
   * Void are. The bare "Deleted" and "Undefined" are the whole Dashboard's,
   * worded masculine (#8181).
   */
  "Deleted (invoice status)",
  "Undefined (invoice status)",
  // What an import did with a row (ImportResultWords).
  "Created (import result)",
  /*
   * A mobile app's screen, as app.screen.name names it: the column of the
   * mobile Overview's frames-by-screen card (#9588). The bare "Screen" is a
   * device's display (the Playlist player's keys).
   */
  "Screen (app screen)",
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
   * The states a page draws together for one kind of thing agree with each
   * other (Common/Tests/App/StatesDrawnTogetherAgree, #8659). A shared word
   * worded for one thing's gender read wrong beside another's: Russian's
   * "Истёк" (masculine, as a token is) under a threat indicator's and a
   * rule exception's neuter "Активно", and "Ещё не запрашивалась"
   * (feminine) beside a token's "Действителен" and a calendar link's
   * "Отключено". Each of these pages words its state with a key of its own.
   */
  // A threat intel indicator past its validity: the Indicators list's Status.
  "Expired (threat indicator)",
  // A rule exception past its expiry, and a window not started yet (Rule Exceptions).
  "Expired (rule exception)",
  "Upcoming (rule exception)",
  // A block of the blocklist whose time is up: the Blocklist's Expires and State filter.
  "Expired (block)",
  // A workflow variable's OAuth token: never fetched, and valid.
  "Not fetched yet (OAuth token)",
  "Valid (OAuth token)",
  // An on-call calendar link no calendar app has read in its first two days.
  "Not fetched yet (calendar feed)",
  /*
   * A device manager connection not read yet, read in part, and failing to
   * read: its Status on Inventory > Managed Devices' Device Managers, for
   * every service a connection reads (DeviceManagementWords, #10009).
   * Russian words a state on its own in the neuter, as its Off, Stale and
   * Healthy are ("Выключено", "Устарело", "Исправно"), where the bare
   * words are a noun ("Ожидание"), a verb ("Догоняет") and a masculine
   * noun ("Сбой"), which stay the other pages'.
   */
  "Waiting (device manager connection)",
  "Catching up (device manager connection)",
  "Failing (device manager connection)",
  /*
   * The Logs, Traces, Metrics and Exceptions explorers' tab that counts and
   * charts what came in (their NavTabs, breadcrumbs and search entries).
   * The bare "Insights" is OneUptime AI's findings - the Products menu's
   * Insights and each AI section's page - so Spanish named both "Análisis"
   * beside sentences about "hallazgos", and Italian "Informazioni" (#8629).
   */
  "Insights (explorer analytics)",
  /*
   * A month that fell short of its SLO's target: the verdict on an SLO's
   * Monthly Report (#5476). The bare "Missed" is an incident SLA's missed
   * deadline, worded for a deadline in most languages - Danish
   * "Overskredet" (exceeded), Norwegian "Oversittet", Japanese 見逃し
   * (overlooked) - which no target is.
   */
  "Missed (target)",
  /*
   * The record of processing's words for what GDPR Article 30 asks (#10375):
   * a category of people a store's data is about, and who its data is
   * disclosed to. The bare "Children" is a span's children in a trace -
   * Japanese 子, Korean 하위 스팬 - and the bare "Recipients" is who a
   * message is sent to (受信者, 받는 사람).
   */
  "Children (people)",
  "Recipients (of data)",
  /*
   * The button that writes an empty field of a store's record, or a part of
   * its impact assessment, in a person's own words (#10375). The bare
   * "Write" is an access level - Russian Запись, Hindi लिखना - as a role's
   * Read and Write are.
   */
  "Write (own words)",
  /*
   * The title of the fact of what a data store is, one of the facts its
   * paperwork rests on (COMPLIANCE_FACT_KIND_TITLES, #10375), worded for
   * a store: French "Ce qu'il est", for le magasin. The bare "What it is"
   * heads a row of the docs' comparison tables (an alert beside an
   * incident, a maintenance event beside an announcement), which each
   * language words as its sentence needs; a key of the Dashboard held
   * those tables to the paperwork's words.
   */
  "What it is (store identity)",
  /*
   * Notification Settings' columns for phone calls and push notifications,
   * and the names its switches, its tabs' summaries and its "Channels not
   * set up yet" give them (#8887). The bare "Call" is a function call in
   * Chinese (调用) and Korean (호출), and "Push" a payment in Arabic (الدفع),
   * as the rest of the Dashboard found (#7178).
   */
  "Call (phone call)",
  "Push (push notification)",
  /*
   * The room left on a store - a volume, a disk, a datastore: the Free
   * column of the storage lists and the Free figure of a store's usage
   * (StorageUsageBar, #9539). The bare "Free" is the price, free of charge
   * (a plan's "Free"), worded so in French ("Gratuit") and Spanish
   * ("Gratis"), which no disk is.
   */
  "Free (storage space)",
  /*
   * The Pod Security Standards' Baseline control on what a container may add
   * of Linux's capabilities (CAP_NET_ADMIN, CAP_SYS_ADMIN...), on a
   * cluster's Compliance page (#9877). The bare "Capabilities" is what a
   * Runner or a session recording can do, worded as features in most
   * languages - Japanese 機能, Chinese 功能, Swedish "Funktioner" - which
   * no Linux capability is.
   */
  "Capabilities (Linux capabilities)",
  /*
   * A machine's make and model, as its maker names it: the Model of
   * Inventory's Asset Details card, of the Managed Devices list (its column
   * and its filter) and of a managed device's Esper card, a network device's
   * and a storage array controller's (#9838). The bare "Model" is an AI
   * model's - the AI / LLM pages, an LLM monitor, a workflow's AI step -
   * worded so in Chinese (模型, a machine-learning model) and Arabic
   * (النموذج), where a device's model is 型号 / 型號 and الطراز.
   */
  "Model (hardware model)",
  /*
   * A cloud budget's period: what its amount is for, in the Period
   * dropdown, the Budgets list's filter and its row's period line
   * ("Quarterly from April", CLOUD_BUDGET_PERIOD_LABELS, #11008). The bare
   * "Monthly" and "Yearly" are a plan's billing cycle, worded as a payment
   * in Japanese (月払い, 年払い: paid monthly, paid yearly), which no
   * budget's period is.
   */
  "Monthly (budget period)",
  "Quarterly (budget period)",
  "Yearly (budget period)",
  /*
   * A NetApp ONTAP aggregate, the disks its node's volumes are carved from:
   * ONTAP's Aggregates tab, the kind on its parts' pages and the aggregate a
   * volume lives in (#11001). The bare "Aggregate" is OpenStack's host
   * aggregate, a group of compute hosts, worded so in Traditional Chinese
   * (主機集合) and Arabic (تجميع المضيفين), which no group of disks is.
   */
  "Aggregate (disk aggregate)",
  "Aggregates (disk aggregates)",
  /*
   * A NetApp ONTAP disk no node owns yet, a state on its cluster's Hardware
   * tab (#11001). The bare "Unassigned" is a security case's, an
   * exception's or an issue's that nobody has taken, worded as "no one in
   * charge" in Japanese (未担当), Chinese (无人认领 / 無人認領) and Persian
   * (بی‌مسئول), which no disk is.
   */
  "Unassigned (disk not owned by a node)",
  /*
   * An ONTAP Ethernet port's link, up or down, on its cluster's Hardware
   * tab (#11001). The bare "Up" and "Down" are a machine's or a service's -
   * a Docker host, a Ceph OSD, a network device - worded as a crashed
   * machine in Chinese (宕机 / 當機) and as failed in German
   * ("Ausgefallen"), which an unplugged link is not.
   */
  "Up (port link)",
  "Down (port link)",
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
