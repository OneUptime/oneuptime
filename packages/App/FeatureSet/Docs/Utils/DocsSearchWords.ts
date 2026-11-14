/*
 * THE WORDS DOCS SEARCH FORGIVES (issue #6822).
 *
 * Shared by everything that searches this installation's docs: the docs'
 * own search box and Search (Cmd/Ctrl+K)'s Docs group (Utils/DocsSearch.ts),
 * and Ask AI's search_docs (Utils/AIDocsReader.ts). All three read the same
 * index, built per language by AIDocsReader, so a word is forgiven the same
 * way wherever it is typed:
 *
 *   - a reader's word for what the docs call otherwise: "pager" finds the
 *     on-call pages, "outage" the incident pages, "2fa" two-factor
 *     authentication (DOCS_SEARCH_SYNONYMS, a short list per language);
 *   - one or two wrong letters: "escalaton" finds "escalation"
 *     (getTypoAllowance, isWithinEditDistance);
 *   - the start of a word: "kube" finds "kubernetes" (DocsVocabulary).
 *
 * Nothing here reads a file or a network: it is the same on an air-gapped
 * server as on OneUptime Cloud.
 */

/*
 * What a reader may type, and the words the docs use for it, per language.
 * A key is matched against a whole word of what was typed, written as a
 * reader writes it (lower case, accents as typed: the comparison folds both).
 * A value is a word or a short phrase the docs use, matched like typed words
 * (every word of a phrase in the same section), or a word start ending in
 * "*" for languages that build long compounds from it: German
 * "bereitschaft*" is Bereitschaftsrichtlinie, Bereitschaftszeitplan and
 * every other on-call word. The English list applies in every language, to
 * a word the language's own list does not answer: people type "2fa" and
 * "k8s" whatever language they read.
 *
 * Every value must be a word the docs of that language actually hold, or
 * it would find nothing: DocsSearch.test.ts checks each against the index.
 */
export type DocsSearchSynonyms = Readonly<
  Record<string, ReadonlyArray<string>>
>;

const ENGLISH: DocsSearchSynonyms = {
  pager: ["on-call"],
  paging: ["on-call"],
  oncall: ["on-call"],
  uptime: ["monitor"],
  outage: ["incident"],
  outages: ["incident"],
  downtime: ["incident"],
  "2fa": ["two-factor", "two factor"],
  mfa: ["two-factor", "two factor"],
  otp: ["two-factor"],
  totp: ["two-factor"],
  text: ["sms"],
  texts: ["sms"],
  k8s: ["kubernetes"],
  rota: ["schedule", "rotation"],
  vm: ["server"],
  apm: ["traces"],
  sso: ["saml", "single sign-on"],
  /*
   * On-Call Duty is On-Call now (#6817): the docs no longer say "duty", so
   * "on-call duty" would find only the glossary's list of old names.
   */
  duty: ["on-call"],
};

// By docs language code (SUPPORTED_DOCS_LANGUAGE_CODES): every language has a list.
export const DOCS_SEARCH_SYNONYMS: Readonly<
  Record<string, DocsSearchSynonyms>
> = {
  en: ENGLISH,
  de: {
    pager: ["bereitschaft*"],
    rufbereitschaft: ["bereitschaft*"],
    ausfall: ["vorfall"],
    ausfälle: ["vorfall"],
    störung: ["vorfall"],
    outage: ["vorfall"],
    uptime: ["überwachung"],
    "2fa": ["zwei-faktor"],
  },
  fr: {
    pager: ["astreinte"],
    panne: ["incident"],
    pannes: ["incident"],
    outage: ["incident"],
    uptime: ["moniteur"],
    "2fa": ["deux facteurs"],
  },
  es: {
    pager: ["guardia"],
    caída: ["incidente"],
    caídas: ["incidente"],
    interrupción: ["incidente"],
    outage: ["incidente"],
    uptime: ["monitor"],
    "2fa": ["dos factores"],
  },
  it: {
    pager: ["reperibilità"],
    interruzione: ["incidente"],
    disservizio: ["incidente"],
    outage: ["incidente"],
    uptime: ["monitor"],
    "2fa": ["due fattori"],
  },
  pt: {
    pager: ["plantão"],
    queda: ["incidente"],
    interrupção: ["incidente"],
    outage: ["incidente"],
    uptime: ["monitor"],
    "2fa": ["dois fatores"],
  },
  nl: {
    pager: ["bereikbaarheid*"],
    storing: ["incident"],
    uitval: ["incident"],
    outage: ["incident"],
    uptime: ["monitor"],
    "2fa": ["tweestapsverificatie"],
  },
  da: {
    pager: ["vagt*"],
    nedbrud: ["hændelse*"],
    outage: ["hændelse*"],
    uptime: ["overvågning*"],
  },
  no: {
    pager: ["vakt*"],
    nedetid: ["hendelse*"],
    outage: ["hendelse*"],
    uptime: ["overvåking*"],
  },
  sv: {
    pager: ["jour*"],
    avbrott: ["incident"],
    driftstopp: ["incident"],
    outage: ["incident"],
    uptime: ["övervakning*"],
    "2fa": ["tvåfaktor*"],
  },
  ru: {
    pager: ["дежурств*"],
    пейджер: ["дежурств*"],
    сбой: ["инцидент*"],
    авария: ["инцидент*"],
    outage: ["инцидент*"],
    uptime: ["монитор*"],
    аптайм: ["монитор*"],
    "2fa": ["двухфактор*"],
  },
  fa: {
    pager: ["آنکال"],
    قطعی: ["حادثه"],
    outage: ["حادثه"],
    uptime: ["مانیتور"],
    "2fa": ["دومرحله‌ای"],
  },
  hi: {
    pager: ["ऑन-कॉल"],
    पेजर: ["ऑन-कॉल"],
    outage: ["घटना"],
    आउटेज: ["घटना"],
    uptime: ["मॉनिटर"],
    अपटाइम: ["मॉनिटर"],
  },
  ja: {
    pager: ["オンコール"],
    ページャー: ["オンコール"],
    障害: ["インシデント"],
    outage: ["インシデント"],
    uptime: ["モニター"],
    稼働率: ["モニター"],
  },
  ko: {
    pager: ["온콜"],
    호출기: ["온콜"],
    장애: ["인시던트"],
    outage: ["인시던트"],
    uptime: ["모니터"],
    "2fa": ["2단계 인증"],
  },
  "zh-CN": {
    pager: ["值班"],
    寻呼: ["值班"],
    故障: ["事件"],
    宕机: ["事件"],
    outage: ["事件"],
    uptime: ["监视器"],
  },
  "zh-TW": {
    pager: ["待命"],
    呼叫器: ["待命"],
    故障: ["事件"],
    當機: ["事件"],
    outage: ["事件"],
    uptime: ["監測器"],
    "2fa": ["雙重驗證"],
  },
};

const LATIN_WORD: RegExp = /^[\p{Script=Latin}\p{M}\p{N}-]+$/u;

/*
 * A typed word, or a synonym's key, as the two are compared: lower case,
 * and a Latin-script word without its accents ("caída" is "caida"). Other
 * scripts keep their marks: they are part of their letters.
 */
export const foldDocsSearchWord: (word: string) => string = (
  word: string,
): string => {
  const lower: string = word.normalize("NFKC").toLowerCase().trim();

  if (!LATIN_WORD.test(lower)) {
    return lower;
  }

  return lower.normalize("NFKD").replace(/\p{M}/gu, "");
};

export interface DocsSearchSynonym {
  // A word or phrase the docs use, as written in DOCS_SEARCH_SYNONYMS.
  words: string;
  // A word start ("bereitschaft*"): matches every docs word it starts.
  isWordStart: boolean;
}

const synonymCache: Map<
  string,
  Map<string, Array<DocsSearchSynonym>>
> = new Map();

/*
 * The synonyms a language's search reads, by folded key: its own list,
 * then the English one for the words its own list does not answer.
 */
export const getDocsSearchSynonyms: (
  language: string,
) => Map<string, Array<DocsSearchSynonym>> = (
  language: string,
): Map<string, Array<DocsSearchSynonym>> => {
  const cached: Map<string, Array<DocsSearchSynonym>> | undefined =
    synonymCache.get(language);

  if (cached) {
    return cached;
  }

  const synonyms: Map<string, Array<DocsSearchSynonym>> = new Map();
  const own: DocsSearchSynonyms | undefined =
    language === "en" ? undefined : DOCS_SEARCH_SYNONYMS[language];

  for (const list of [own, ENGLISH]) {
    if (!list) {
      continue;
    }

    const isFallback: boolean = list === ENGLISH && own !== undefined;

    for (const [key, values] of Object.entries(list)) {
      const folded: string = foldDocsSearchWord(key);

      /*
       * A word the language's own list answers is answered by it alone:
       * "pager" on a Japanese page is オンコール, not the English
       * "on-call" of the few pages that name Splunk On-Call.
       */
      if (isFallback && synonyms.has(folded)) {
        continue;
      }

      const existing: Array<DocsSearchSynonym> = synonyms.get(folded) || [];

      for (const value of values) {
        const isWordStart: boolean = value.endsWith("*");
        const words: string = isWordStart ? value.slice(0, -1) : value;

        if (
          !existing.some((synonym: DocsSearchSynonym): boolean => {
            return synonym.words === words;
          })
        ) {
          existing.push({ words, isWordStart });
        }
      }

      synonyms.set(folded, existing);
    }
  }

  synonymCache.set(language, synonyms);

  return synonyms;
};

/*
 * How many wrong letters a word may have and still find what it meant:
 * none in a word of three letters or fewer ("sms", "api" mean themselves),
 * one up to seven letters, two from eight ("escalaton", "notifcations").
 * Counted in characters, so a Devanagari or Cyrillic word is measured as
 * it is read.
 */
export const getTypoAllowance: (word: string) => number = (
  word: string,
): number => {
  const length: number = Array.from(word).length;

  if (length <= 3) {
    return 0;
  }

  return length >= 8 ? 2 : 1;
};

/*
 * Whether `a` becomes `b` in at most `max` edits - a letter added, dropped,
 * changed, or two neighbours swapped ("teh" is "the") - and how many. Null
 * when it takes more. Stops as soon as every way left needs more than
 * `max`, so checking a word against a whole vocabulary stays quick.
 */
export const isWithinEditDistance: (
  a: string,
  b: string,
  max: number,
) => number | null = (a: string, b: string, max: number): number | null => {
  if (a === b) {
    return 0;
  }

  const left: Array<string> = Array.from(a);
  const right: Array<string> = Array.from(b);

  if (Math.abs(left.length - right.length) > max) {
    return null;
  }

  // Three rows of the edit table: two back (for a swap), one back, and this one.
  let beforePrevious: Array<number> = [];
  let previous: Array<number> = [];

  for (let j: number = 0; j <= right.length; j++) {
    previous.push(j);
  }

  for (let i: number = 1; i <= left.length; i++) {
    const current: Array<number> = [i];
    let rowMinimum: number = i;

    for (let j: number = 1; j <= right.length; j++) {
      const cost: number = left[i - 1] === right[j - 1] ? 0 : 1;
      let value: number = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );

      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        value = Math.min(value, beforePrevious[j - 2]! + 1);
      }

      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > max) {
      return null;
    }

    beforePrevious = previous;
    previous = current;
  }

  const distance: number = previous[right.length]!;

  return distance <= max ? distance : null;
};

export interface DocsVocabularyMatch {
  term: string;
  // How many pages hold it.
  pages: number;
  // Wrong letters, for a typo match; 0 for a word start.
  distance: number;
}

/*
 * Every word a language's docs hold, with how many pages hold it, laid out
 * to find the words a typed word starts or nearly spells.
 */
export class DocsVocabulary {
  private readonly sorted: Array<string>;
  private readonly byLength: Map<number, Array<string>> = new Map();
  private readonly pageCounts: Map<string, number>;

  public constructor(pageCounts: Map<string, number>) {
    this.pageCounts = pageCounts;
    this.sorted = Array.from(pageCounts.keys()).sort();

    for (const term of this.sorted) {
      const length: number = Array.from(term).length;
      const sameLength: Array<string> = this.byLength.get(length) || [];
      sameLength.push(term);
      this.byLength.set(length, sameLength);
    }
  }

  public has(term: string): boolean {
    return this.pageCounts.has(term);
  }

  public pagesHolding(term: string): number {
    return this.pageCounts.get(term) || 0;
  }

  // The words that start with `start` (itself not included), most used first.
  public startingWith(
    start: string,
    limit: number,
  ): Array<DocsVocabularyMatch> {
    if (!start) {
      return [];
    }

    let low: number = 0;
    let high: number = this.sorted.length;

    while (low < high) {
      const middle: number = (low + high) >> 1;
      if (this.sorted[middle]! < start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const matches: Array<DocsVocabularyMatch> = [];

    for (let i: number = low; i < this.sorted.length; i++) {
      const term: string = this.sorted[i]!;

      if (!term.startsWith(start)) {
        break;
      }

      if (term !== start) {
        matches.push({ term, pages: this.pagesHolding(term), distance: 0 });
      }
    }

    return DocsVocabulary.mostUsed(matches, limit);
  }

  /*
   * The words `word` spells with up to `max` wrong letters (itself not
   * included), starting with the same letter, closest first, then most
   * used.
   */
  public near(
    word: string,
    max: number,
    limit: number,
  ): Array<DocsVocabularyMatch> {
    if (max <= 0) {
      return [];
    }

    const characters: Array<string> = Array.from(word);
    const length: number = characters.length;
    const first: string = characters[0] || "";
    const matches: Array<DocsVocabularyMatch> = [];

    for (let size: number = length - max; size <= length + max; size++) {
      for (const term of this.byLength.get(size) || []) {
        // A typo is rarely the first letter, and keeping it cuts out near-misses ("hello" is not "help").
        if (term === word || !term.startsWith(first)) {
          continue;
        }

        const distance: number | null = isWithinEditDistance(word, term, max);

        if (distance !== null) {
          matches.push({ term, pages: this.pagesHolding(term), distance });
        }
      }
    }

    return matches
      .sort((a: DocsVocabularyMatch, b: DocsVocabularyMatch): number => {
        return (
          a.distance - b.distance ||
          b.pages - a.pages ||
          a.term.localeCompare(b.term)
        );
      })
      .slice(0, limit);
  }

  private static mostUsed(
    matches: Array<DocsVocabularyMatch>,
    limit: number,
  ): Array<DocsVocabularyMatch> {
    return matches
      .sort((a: DocsVocabularyMatch, b: DocsVocabularyMatch): number => {
        return b.pages - a.pages || a.term.localeCompare(b.term);
      })
      .slice(0, limit);
  }
}
