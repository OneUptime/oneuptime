/*
 * EACH LANGUAGE'S ONE NAME FOR A THING IT ONCE NAMED TWO OR THREE WAYS
 * (#8029, #8030, #8031).
 *
 * A thing's name is the one its language's side menu, Products menu and page
 * titles say. The languages here said another word beside it in counts,
 * sentences and buttons, so a French reader picked "Flux de travail" in the
 * menu and read "workflow" on the page it opened:
 *
 *   - French, Italian and Danish said "workflow" under a list called "Flux
 *     de travail", "Flussi di lavoro" and "Arbejdsgange" (#8030);
 *   - Simplified Chinese said 监控项 and 监控器 beside its 监视器 list,
 *     Traditional Chinese 監視器 and 監控器 beside 監測器, and Swedish
 *     "övervakare" beside "Monitorer" (#8031);
 *   - Russian said "статус-страница" and "страница состояния" beside
 *     "страница статуса", and "дашборд" beside its "Панели" list; Hindi
 *     "स्टेटस पेज" beside "स्थिति पृष्ठ", and spelled a metric "मीट्रिक" beside
 *     "मेट्रिक"; Traditional Chinese wrote its maintenance "排程維護" beside
 *     the menu's "排定維護", and Norwegian counted "metrikker" under a list
 *     called "Målinger" (#8029).
 *
 * The guard (OneNamePerThingGuard) reads every string of every app's locale
 * file for these languages, and the translated docs pages of the languages
 * whose docs say the one name too, with these patterns:
 *
 *   - word: the one name, which the menu's title says;
 *   - others: the words the language no longer says for it.
 *
 * A text whose "other" word names something else is listed with why
 * (keptKeys, by its English key; keptPhrases, a phrase taken out of a text
 * before it is read): another product's workflow keeps that product's word.
 */

export interface KeptPhrase {
  phrase: RegExp;
  why: string;
}

export interface OneName {
  // The thing's name in the Products menu, as PRODUCT_TITLES says it.
  title: string;
  // The language's one word for the thing, which its menu says.
  word: RegExp;
  // The words the language no longer says for it.
  others: RegExp;
  // English keys whose other word names something else, each with why.
  keptKeys?: Readonly<Record<string, string>>;
  // Phrases whose other word names something else, taken out first.
  keptPhrases?: ReadonlyArray<KeptPhrase>;
}

/*
 * Swedish "övervakar" followed by a letter is the noun: övervakare,
 * övervakaren, övervakarna, övervakarstatus. Followed by anything else it is
 * the verb (Monitorn övervakar tjänsten), which stays.
 */
const SWEDISH_NOUN_FOR_A_WATCHER: RegExp = /övervakar(?=\p{L})/iu;

// Several keys kept for one reason.
function keptForOneReason(
  keys: ReadonlyArray<string>,
  why: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    keys.map((key: string): [string, string] => {
      return [key, why];
    }),
  );
}

/*
 * Data Observability's sentences about a BI tool's own dashboards
 * (Metabase, Superset, Tableau, Looker, Power BI) and the tables they read.
 */
const BI_TOOLS_DASHBOARDS: ReadonlyArray<string> = [
  "A BI tool whose dashboards, and the tables behind them, Data Observability reads, so a table's alerts list the dashboards built on it.",
  "A dashboard of a connected BI tool, with the watched tables its charts query.",
  "BI Dashboard",
  "BI Dashboards",
  "Dashboards Built On It",
  "Every dashboard of the BI tools above, with the watched tables its charts query - and, for Power BI, how often it is viewed and when its data last refreshed.",
  "JSON with what may read its dashboards: an API key, a user, a token or a service principal, as the tool asks. Encrypted, and never shown again.",
  "Metabase, Superset, Tableau, Looker and Power BI dashboards, and Hightouch and Census syncs, read every hour, so a table's alerts list what is built on it.",
  "No data product yet. Create one for the tables a dashboard or report reads, with when their data must land: its consumers then see if it is fresh.",
  "Read its dashboards every hour.",
];

const RUSSIAN_BI_DASHBOARDS: string =
  "A BI tool's own dashboard, which Russian BI users call a дашборд: set apart from OneUptime's Панели, as another product's workflow keeps its name";

export const ONE_NAME: Readonly<Record<string, ReadonlyArray<OneName>>> = {
  fr: [
    {
      title: "Workflows",
      word: /flux de travail/i,
      others: /workflow/i,
    },
  ],
  it: [
    {
      title: "Workflows",
      word: /fluss[oi] di lavoro/i,
      others: /workflow/i,
    },
  ],
  da: [
    {
      title: "Workflows",
      word: /arbejdsgang/i,
      others: /workflow/i,
    },
  ],
  sv: [
    {
      title: "Monitors",
      word: /monitor/i,
      others: SWEDISH_NOUN_FOR_A_WATCHER,
    },
  ],
  "zh-CN": [
    {
      title: "Monitors",
      word: /监视器/,
      others: /监控项|监控器/,
      keptPhrases: [
        {
          phrase: /^\| 监控项 \||监控项原型/,
          why: "Zabbix's own words for an item and an item prototype, in the network device page's table of what a Zabbix user knows each thing as",
        },
      ],
    },
  ],
  "zh-TW": [
    {
      title: "Monitors",
      word: /監測器/,
      others: /監視器|監控器/,
    },
    {
      title: "Scheduled Maintenance",
      word: /排定維護/,
      others: /排程維護/,
    },
  ],
  ru: [
    {
      title: "Status Pages",
      word: /страниц\S* статуса/i,
      others: /статус-страниц|страниц\S* состояния/i,
    },
    {
      title: "Dashboards",
      word: /панел/i,
      others: /дашборд/i,
      keptKeys: keptForOneReason(BI_TOOLS_DASHBOARDS, RUSSIAN_BI_DASHBOARDS),
    },
  ],
  hi: [
    {
      title: "Status Pages",
      word: /स्थिति पृष्ठ/,
      others: /स्टेटस पेज/,
    },
    {
      title: "Metrics",
      word: /मेट्रिक/,
      others: /मीट्रिक/,
    },
  ],
  no: [
    {
      title: "Metrics",
      word: /måling/i,
      others: /metrikk/i,
    },
  ],
};

/*
 * What a text says in words: a placeholder's name, code (a `code span`, or
 * <code> in the API reference), a tag and an address are not words a reader
 * reads as a name ({{workflowName}}, {queueName}, `workflow.yml`,
 * <code>Workflow</code>, https://.../workflows).
 */
const NOT_WORDS: RegExp =
  /\{\{[^{}]*\}\}|\{[A-Za-z_][\w.]*\}|`[^`]*`|<code>[\s\S]*?<\/code>|<[^<>]*>|\]\([^)]*\)|https?:\/\/\S+/g;

export function wordsOf(text: string): string {
  return text.replace(NOT_WORDS, " ");
}

/*
 * The other word a text says for `name`, if any: null when the text says
 * none, or says it only inside a kept phrase.
 */
export function otherWordIn(name: OneName, text: string): string | null {
  let words: string = wordsOf(text);

  for (const kept of name.keptPhrases || []) {
    words = words.replace(
      new RegExp(kept.phrase.source, `${kept.phrase.flags.replace("g", "")}g`),
      " ",
    );
  }

  const match: RegExpExecArray | null = name.others.exec(words);

  return match ? match[0] : null;
}
