/*
 * THE WORDS DOCS SEARCH FORGIVES (issue #6822).
 *
 * Shared by everything that searches this installation's docs: the docs'
 * own search box and Search (Cmd/Ctrl+K)'s Docs group (Utils/DocsSearch.ts),
 * and Ask AI's search_docs (Utils/AIDocsReader.ts). All three read the same
 * index, built per language by AIDocsReader, so a word is forgiven, or left
 * out, the same way wherever it is typed:
 *
 *   - a reader's word for what the docs call otherwise: "pager" finds the
 *     on-call pages, "outage" the incident pages, "2fa" two-factor
 *     authentication (DOCS_SEARCH_SYNONYMS, a short list per language);
 *   - one or two wrong letters: "escalaton" finds "escalation"
 *     (getTypoAllowance, isWithinEditDistance);
 *   - the start of a word: "kube" finds "kubernetes" (DocsVocabulary);
 *   - a word a question is phrased with, not about: "Wie überwache ich
 *     meine Website?" looks for "überwache" and "Website"
 *     (DOCS_SEARCH_QUESTION_WORDS, a list per language);
 *   - a word's endings: "nettstedet" is "nettsted", "сайта" is "сайт",
 *     "웹사이트를" is "웹사이트" (DOCS_SEARCH_WORD_ENDINGS, per language,
 *     taken off a page's words and a question's alike);
 *   - a compound the question's words make: "övervaka" and "webbplats" are
 *     "Webbplatsövervakning" (DOCS_SEARCH_COMPOUNDING_LANGUAGES).
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
  /*
   * A website is a "hjemmeside" or "hemsida" to most who ask, and a
   * "websted", "nettsted" or "webbplats" in the docs: no Danish page says
   * "hjemmeside", so "Hvordan overvåger jeg min hjemmeside?" found
   * Website Monitor 99th (#7875).
   */
  da: {
    pager: ["vagt*"],
    nedbrud: ["hændelse*"],
    outage: ["hændelse*"],
    uptime: ["overvågning*"],
    hjemmeside: ["websted"],
  },
  no: {
    pager: ["vakt*"],
    nedetid: ["hendelse*"],
    outage: ["hendelse*"],
    uptime: ["overvåking*"],
    hjemmeside: ["nettsted"],
  },
  sv: {
    hemsida: ["webbplats"],
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
    /*
     * A page is "صفحه", pages are "صفحات": a plural no ending makes, and
     * the name of the status pages' overview, "نمای کلی صفحات وضعیت".
     */
    صفحه: ["صفحات"],
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
 * Words a question is phrased with rather than about, per language (#7799,
 * #7874): its "how", "I" and "my". Ask AI's search_docs (AIDocsReader's
 * tokenizeQueryForDocs) and the docs' search box (DocsSearch.readQuery)
 * both leave them out of what is asked. Read as words, a German
 * question's "ich" and "meine" counted like what it asks about: the
 * German docs say "Sie" and "Ihre", so those are on few pages, and "Wie
 * überwache ich meine Website?" found the pages that quote a question, and
 * "Wie ich erreichbar bin" (How to Reach Me), not Website-Überwachung.
 * Only what is asked leaves them out: the index keeps them, so that page
 * is still found by its name.
 *
 * Every docs language has a list (#7875): outside German too, "how", "I"
 * and "my" were read as what is asked. A Persian question's "چطور" (how),
 * "را" (its object's mark, on 357 of the 361 pages) and "کنم" (I do) gave
 * the Ask AI page, which quotes example questions, 63% of its points, and
 * Website Monitor came 4th. A Korean question's "어떻게" (how), and a
 * Norwegian one's "hvordan", "jeg" and "mitt", did the same.
 *
 * By docs language code (SUPPORTED_DOCS_LANGUAGE_CODES). English has none
 * here: AIDocsReader's QUESTION_WORDS leaves English's out of every page
 * and every question. Written as a reader types them; compared folded
 * (foldDocsSearchWord). A word that takes an ending of its own (Korean
 * "무엇을", what with its object's mark) is listed with it.
 *
 * Chinese and Japanese are written without spaces: their entries are cut
 * out of what is typed wherever they stand ("如何监控我的网站" is "监控" and
 * "网站"), longest first (getDocsSearchQuestionPhrases). Japanese ends a
 * question with its own words ("するには", "どうすればいいですか") and marks
 * what is asked about with "を", which is never part of a word.
 */
export const DOCS_SEARCH_QUESTION_WORDS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  de: [
    // how, what, where, when, why, who, which
    "wie",
    "was",
    "wo",
    "wann",
    "warum",
    "wieso",
    "weshalb",
    "wer",
    "wen",
    "wem",
    "welche",
    "welcher",
    "welches",
    "welchen",
    "welchem",
    // I, me, my, we
    "ich",
    "mich",
    "mir",
    "mein",
    "meine",
    "meinen",
    "meinem",
    "meiner",
    "meines",
    "wir",
    "uns",
    "unser",
    "unsere",
    "unseren",
    "unserem",
    "unserer",
    "unseres",
    // you, your, one ("wie richtet man ... ein")
    "sie",
    "ihnen",
    "ihr",
    "ihre",
    "ihren",
    "ihrem",
    "ihrer",
    "ihres",
    "du",
    "dich",
    "dir",
    "dein",
    "deine",
    "deinen",
    "deinem",
    "deiner",
    "deines",
    "man",
    // a, an, the
    "der",
    "die",
    "das",
    "den",
    "dem",
    "des",
    "ein",
    "eine",
    "einen",
    "einem",
    "einer",
    "eines",
    // it, this, that, there
    "es",
    "dies",
    "diese",
    "dieser",
    "dieses",
    "diesen",
    "diesem",
    "dass",
    "da",
    "dort",
    // and, or, if
    "und",
    "oder",
    "wenn",
    "ob",
    // am, is, are, be, can, do
    "bin",
    "bist",
    "ist",
    "sind",
    "sein",
    "kann",
    "kannst",
    "können",
    "tue",
    "tun",
    // for, of, on, to, with, in
    "für",
    "von",
    "vom",
    "auf",
    "zu",
    "zum",
    "zur",
    "mit",
    "im",
    "am",
  ],
  fr: [
    // how, what, where, when, why, who, which
    "comment",
    "quoi",
    "que",
    "qu",
    "quel",
    "quelle",
    "quels",
    "quelles",
    "où",
    "quand",
    "pourquoi",
    "qui",
    "lequel",
    "laquelle",
    "est-ce",
    // I, me, my, we, our
    "je",
    "me",
    "moi",
    "mon",
    "ma",
    "mes",
    "nous",
    "notre",
    "nos",
    // you, your, one
    "vous",
    "votre",
    "vos",
    "tu",
    "te",
    "toi",
    "ton",
    "ta",
    "tes",
    "on",
    // a, the, some
    "le",
    "la",
    "les",
    "un",
    "une",
    "des",
    "du",
    "de",
    // it, this, that, there
    "il",
    "elle",
    "ce",
    "cela",
    "ça",
    "cet",
    "cette",
    "ces",
    "y",
    // and, or, if
    "et",
    "ou",
    "si",
    // am, is, are, be, can, do, must
    "suis",
    "est",
    "sont",
    "être",
    "puis",
    "puis-je",
    "peux",
    "peut",
    "peut-on",
    "pouvons",
    "pouvez",
    "faire",
    "fais",
    "fait",
    "faut",
    "faut-il",
    "dois",
    "dois-je",
    "doit",
    // for, of, on, to, with, in
    "pour",
    "par",
    "sur",
    "à",
    "au",
    "aux",
    "avec",
    "dans",
    "en",
  ],
  es: [
    // how, what, where, when, why, who, which
    "cómo",
    "qué",
    "cuál",
    "cuáles",
    "dónde",
    "cuándo",
    "porqué",
    "quién",
    "quiénes",
    // I, me, my, we, our
    "yo",
    "me",
    "mi",
    "mis",
    "nosotros",
    "nosotras",
    "nuestro",
    "nuestra",
    "nuestros",
    "nuestras",
    // you, your, one
    "tú",
    "tus",
    "te",
    "usted",
    "ustedes",
    "su",
    "sus",
    "se",
    "uno",
    // a, the
    "el",
    "la",
    "los",
    "las",
    "lo",
    "un",
    "una",
    "unos",
    "unas",
    "del",
    "al",
    "de",
    // it, this, that, there
    "esto",
    "esta",
    "este",
    "estos",
    "estas",
    "eso",
    "esa",
    "ese",
    "ahí",
    "allí",
    // and, or, if
    "y",
    "o",
    "si",
    // am, is, are, be, can, do, must
    "soy",
    "es",
    "son",
    "ser",
    "estar",
    "está",
    "puedo",
    "puede",
    "podemos",
    "pueden",
    "hago",
    "hacer",
    "hace",
    "debo",
    "debe",
    "tengo",
    "hay",
    // for, of, on, to, with, in
    "para",
    "por",
    "en",
    "con",
    "sobre",
    "a",
  ],
  it: [
    // how, what, where, when, why, who, which
    "come",
    "cosa",
    "che",
    "quale",
    "quali",
    "dove",
    "quando",
    "perché",
    "chi",
    // I, me, my, we, our
    "io",
    "mi",
    "me",
    "mio",
    "mia",
    "miei",
    "mie",
    "noi",
    "ci",
    "nostro",
    "nostra",
    "nostri",
    "nostre",
    // you, your, one
    "tu",
    "ti",
    "tuo",
    "tua",
    "tuoi",
    "tue",
    "voi",
    "vostro",
    "vostra",
    "lei",
    "suo",
    "sua",
    "si",
    // a, the, of the, in the, on the
    "il",
    "lo",
    "la",
    "gli",
    "le",
    "un",
    "uno",
    "una",
    "del",
    "dello",
    "della",
    "dei",
    "degli",
    "delle",
    "al",
    "allo",
    "alla",
    "ai",
    "agli",
    "alle",
    "nel",
    "nello",
    "nella",
    "nei",
    "negli",
    "nelle",
    "sul",
    "sulla",
    "dal",
    "dalla",
    // it, this, that, there
    "questo",
    "questa",
    "questi",
    "queste",
    "quello",
    "quella",
    "ce",
    // and, or, if
    "ed",
    "o",
    "se",
    // am, is, are, be, can, do, must
    "sono",
    "è",
    "essere",
    "posso",
    "può",
    "possiamo",
    "potete",
    "faccio",
    "fare",
    "fa",
    "devo",
    "deve",
    // for, of, on, to, with, in
    "per",
    "di",
    "da",
    "in",
    "con",
    "su",
    "a",
    "tra",
    "fra",
  ],
  pt: [
    // how, what, where, when, why, who, which
    "como",
    "que",
    "quê",
    "qual",
    "quais",
    "onde",
    "quando",
    "porque",
    "quem",
    // I, me, my, we, our
    "eu",
    "me",
    "mim",
    "meu",
    "minha",
    "meus",
    "minhas",
    "nós",
    "nosso",
    "nossa",
    "nossos",
    "nossas",
    // you, your, one
    "você",
    "vocês",
    "seu",
    "sua",
    "seus",
    "suas",
    "te",
    "tu",
    "teu",
    "tua",
    "se",
    // a, the, of the, in the
    "o",
    "a",
    "os",
    "as",
    "um",
    "uma",
    "uns",
    "umas",
    "do",
    "da",
    "dos",
    "das",
    "no",
    "na",
    "nas",
    "ao",
    "aos",
    "à",
    "pelo",
    "pela",
    // it, this, that, there
    "isso",
    "isto",
    "este",
    "esta",
    "esse",
    "essa",
    "aquele",
    "aquela",
    "lá",
    "aí",
    // and, or, if
    "e",
    "ou",
    // am, is, are, be, can, do, must
    "sou",
    "é",
    "são",
    "ser",
    "estar",
    "está",
    "posso",
    "pode",
    "podemos",
    "faço",
    "fazer",
    "faz",
    "devo",
    "deve",
    "tenho",
    "há",
    // for, of, on, to, with, in
    "para",
    "pra",
    "por",
    "de",
    "em",
    "com",
    "sobre",
  ],
  nl: [
    // how, what, where, when, why, who, which
    "hoe",
    "wat",
    "waar",
    "wanneer",
    "waarom",
    "wie",
    "welk",
    "welke",
    // I, me, my, we, our
    "ik",
    "me",
    "mij",
    "mijn",
    "we",
    "wij",
    "ons",
    "onze",
    // you, your, one
    "u",
    "uw",
    "je",
    "jij",
    "jou",
    "jouw",
    "jullie",
    "men",
    // a, the
    "de",
    "het",
    "een",
    // it, this, that, there
    "dit",
    "dat",
    "deze",
    "die",
    "er",
    "daar",
    "hier",
    // and, or, if
    "en",
    "of",
    "als",
    // am, is, are, be, can, do, must
    "ben",
    "is",
    "zijn",
    "kan",
    "kun",
    "kunt",
    "kunnen",
    "doe",
    "doen",
    "moet",
    "moeten",
    // for, of, on, to, with, in ("stel ... in": the rest of a verb)
    "voor",
    "van",
    "op",
    "aan",
    "met",
    "in",
    "naar",
    "bij",
    "om",
    "te",
  ],
  da: [
    // how, what, where, when, why, who, which
    "hvordan",
    "hvad",
    "hvor",
    "hvornår",
    "hvorfor",
    "hvem",
    "hvilken",
    "hvilket",
    "hvilke",
    "når",
    // I, me, my, we, our
    "jeg",
    "mig",
    "min",
    "mit",
    "mine",
    "vi",
    "os",
    "vores",
    // you, your, one
    "du",
    "dig",
    "din",
    "dit",
    "dine",
    "jer",
    "jeres",
    "man",
    "sig",
    // a, the
    "en",
    "et",
    "den",
    "det",
    "de",
    // it, this, that, there
    "dette",
    "denne",
    "disse",
    "der",
    "her",
    // and, or, if
    "og",
    "eller",
    "hvis",
    "om",
    // am, is, are, be, can, do, must
    "er",
    "være",
    "kan",
    "gør",
    "gøre",
    "skal",
    "vil",
    "må",
    // for, of, on, to, with, in
    "for",
    "af",
    "på",
    "til",
    "med",
    "i",
    "fra",
    "ved",
  ],
  no: [
    // how, what, where, when, why, who, which
    "hvordan",
    "hva",
    "hvor",
    "når",
    "hvorfor",
    "hvem",
    "hvilken",
    "hvilket",
    "hvilke",
    // I, me, my, we, our
    "jeg",
    "meg",
    "min",
    "mitt",
    "mine",
    "vi",
    "oss",
    "vår",
    "vårt",
    "våre",
    // you, your, one
    "du",
    "deg",
    "din",
    "ditt",
    "dine",
    "dere",
    "deres",
    "man",
    "seg",
    // a, the
    "en",
    "ei",
    "et",
    "den",
    "det",
    "de",
    // it, this, that, there
    "dette",
    "denne",
    "disse",
    "der",
    "her",
    // and, or, if
    "og",
    "eller",
    "hvis",
    "om",
    // am, is, are, be, can, do, must
    "er",
    "være",
    "kan",
    "gjør",
    "gjøre",
    "skal",
    "vil",
    "må",
    "bør",
    // for, of, on, to, with, in
    "for",
    "av",
    "på",
    "til",
    "med",
    "i",
    "fra",
    "ved",
  ],
  sv: [
    // how, what, where, when, why, who, which
    "hur",
    "vad",
    "var",
    "när",
    "varför",
    "vem",
    "vilken",
    "vilket",
    "vilka",
    // I, me, my, we, our
    "jag",
    "mig",
    "mej",
    "min",
    "mitt",
    "mina",
    "vi",
    "oss",
    "vår",
    "vårt",
    "våra",
    // you, your, one
    "du",
    "dig",
    "din",
    "ditt",
    "dina",
    "ni",
    "er",
    "ert",
    "era",
    "man",
    "sig",
    // a, the
    "en",
    "ett",
    "den",
    "det",
    "de",
    // it, this, that, there
    "detta",
    "denna",
    "dessa",
    "där",
    "här",
    // and, or, if
    "och",
    "eller",
    "om",
    // am, is, are, be, can, do, must
    "är",
    "vara",
    "kan",
    "gör",
    "göra",
    "ska",
    "skall",
    "vill",
    "måste",
    "bör",
    // for, of, on, to, with, in ("ställa in": the rest of a verb)
    "för",
    "av",
    "på",
    "till",
    "med",
    "i",
    "in",
    "från",
    "vid",
  ],
  ru: [
    // how, what, where, when, why, who, which
    "как",
    "что",
    "чем",
    "где",
    "куда",
    "когда",
    "почему",
    "зачем",
    "кто",
    "какой",
    "какая",
    "какое",
    "какие",
    "каким",
    "какую",
    "каком",
    "который",
    "которая",
    "которое",
    "которые",
    // I, me, my, we, our, one's own
    "я",
    "меня",
    "мне",
    "мной",
    "мой",
    "моя",
    "моё",
    "мои",
    "моего",
    "моей",
    "моему",
    "моим",
    "моих",
    "моими",
    "моём",
    "мы",
    "нас",
    "нам",
    "нами",
    "наш",
    "наша",
    "наше",
    "наши",
    "нашего",
    "нашей",
    "нашему",
    "нашим",
    "наших",
    "свой",
    "своя",
    "своё",
    "свои",
    "своего",
    "своей",
    "своему",
    "своим",
    "своих",
    "свою",
    // you, your
    "вы",
    "вас",
    "вам",
    "вами",
    "ваш",
    "ваша",
    "ваше",
    "ваши",
    "вашего",
    "вашей",
    "вашим",
    "ваших",
    "ты",
    "тебя",
    "тебе",
    "твой",
    "твоя",
    "твоё",
    "твои",
    // it, this, that, there
    "это",
    "этот",
    "эта",
    "эти",
    "этого",
    "этой",
    "тот",
    "там",
    "тут",
    "здесь",
    // and, or, if, whether
    "и",
    "или",
    "а",
    "если",
    "ли",
    "же",
    "бы",
    // is, be, can, must, do
    "есть",
    "быть",
    "можно",
    "могу",
    "может",
    "можем",
    "нужно",
    "надо",
    "делать",
    "сделать",
    // for, of, on, to, with, in
    "в",
    "во",
    "на",
    "с",
    "со",
    "к",
    "ко",
    "о",
    "об",
    "по",
    "для",
    "из",
    "за",
    "у",
    "от",
    "до",
    "при",
  ],
  ja: [
    // how do I, how should I, what should I do
    "どうすればいいですか",
    "どうすればよいですか",
    "どうすればいいでしょうか",
    "どうすればよいでしょうか",
    "どうすればいい",
    "どうすればよい",
    "どうすれば",
    "どうしたらいいですか",
    "どうしたらいい",
    "どうしたら",
    "どうやったら",
    "どうやって",
    "どのようにして",
    "どのように",
    // in order to, I want to, please tell me
    "するには",
    "には",
    "したいです",
    "したい",
    "教えてください",
    "教えて",
    "ください",
    // the marks a question ends with
    "でしょうか",
    "ですか",
    "ますか",
    // what is asked about: "ウェブサイトを監視" (monitor the website)
    "を",
    // I, my, one's own
    "私の",
    "私は",
    "私",
    "自分の",
    "自分",
    // what, who, the way to
    "何",
    "誰",
    "方法",
  ],
  ko: [
    // how, what, where, when, why, who, which
    "어떻게",
    "어떡하나요",
    "무엇",
    "무엇을",
    "무엇이",
    "뭐",
    "뭘",
    "어디",
    "어디서",
    "어디에",
    "어디에서",
    "언제",
    "왜",
    "누가",
    "누구",
    "어떤",
    "어느",
    "무슨",
    // I, me, my, we, our
    "나",
    "나는",
    "내",
    "내가",
    "나의",
    "나에게",
    "저",
    "저는",
    "제",
    "제가",
    "저의",
    "저에게",
    "우리",
    "우리는",
    "우리가",
    "우리의",
    "저희",
    "저희는",
    "저희의",
    // you
    "당신",
    "당신의",
    // can, must, do, is: the words a question ends with
    "해야",
    "하나요",
    "하려면",
    "할",
    "수",
    "있나요",
    "있습니까",
    "있어요",
    "있을까요",
    "합니까",
    "하죠",
    "하면",
    "되나요",
    "됩니까",
    "돼요",
    "좋을까요",
    "좋나요",
    "되는",
    "방법",
    "방법은",
    "방법이",
    "알려주세요",
    "주세요",
  ],
  "zh-CN": [
    // how, what, where, why, who, which
    "如何",
    "怎么",
    "怎么样",
    "怎样",
    "怎么做",
    "什么",
    "哪里",
    "哪儿",
    "哪个",
    "为什么",
    "为何",
    "谁",
    // I, my, we, our, you
    "我的",
    "我们的",
    "我们",
    "我",
    "你的",
    "您的",
    "你",
    "您",
    // can, should, a
    "可以",
    "能否",
    "应该",
    "一个",
    "请问",
    // the marks a question ends with
    "吗",
    "呢",
    "吧",
  ],
  "zh-TW": [
    // how, what, where, why, who, which
    "如何",
    "怎麼",
    "怎麼樣",
    "怎樣",
    "怎麼做",
    "什麼",
    "哪裡",
    "哪兒",
    "哪個",
    "為什麼",
    "為何",
    "誰",
    // I, my, we, our, you
    "我的",
    "我們的",
    "我們",
    "我",
    "你的",
    "您的",
    "你",
    "您",
    // can, should, a
    "可以",
    "能否",
    "應該",
    "一個",
    "請問",
    // the marks a question ends with
    "嗎",
    "呢",
    "吧",
  ],
  hi: [
    // how, what, where, when, why, who, which
    "कैसे",
    "क्या",
    "कहाँ",
    "कहां",
    "कब",
    "क्यों",
    "कौन",
    "कौनसा",
    "कौन-सा",
    "किस",
    "किसे",
    // I, me, my, we, our, one's own
    "मैं",
    "मुझे",
    "मेरा",
    "मेरी",
    "मेरे",
    "हम",
    "हमें",
    "हमारा",
    "हमारी",
    "हमारे",
    "अपना",
    "अपनी",
    "अपने",
    // you, your
    "आप",
    "आपका",
    "आपकी",
    "आपके",
    "तुम",
    // a, it, this, that, there
    "एक",
    "यह",
    "ये",
    "वह",
    "वे",
    "इस",
    "उस",
    "इसे",
    "उसे",
    "यहाँ",
    "वहाँ",
    // and, or, if
    "और",
    "या",
    "अगर",
    "तो",
    // am, is, be, can, do, must
    "है",
    "हैं",
    "हूँ",
    "हूं",
    "हो",
    "होना",
    "कर",
    "करूँ",
    "करूं",
    "करें",
    "करना",
    "करते",
    "करता",
    "करती",
    "सकता",
    "सकती",
    "सकते",
    "सकूँ",
    "सकूं",
    "चाहिए",
    // of, to, in, from, on, for, with
    "को",
    "का",
    "की",
    "के",
    "में",
    "से",
    "पर",
    "लिए",
    "तक",
    "साथ",
    "ने",
  ],
  fa: [
    // how, what, where, when, why, who, which
    "چطور",
    "چطوری",
    "چگونه",
    "چه",
    "چی",
    "چیست",
    "کجا",
    "کجاست",
    "کی",
    "چرا",
    "کدام",
    "کدوم",
    // I, me, we, you, one's own
    "من",
    "مرا",
    "ما",
    "شما",
    "تو",
    "خودم",
    "خودمان",
    "خود",
    // a, this, that, there
    "یک",
    "این",
    "آن",
    "اینجا",
    "آنجا",
    // and, or, if, that
    "و",
    "یا",
    "اگر",
    "که",
    // is, can, must, do: "می‌توانم" is read as "می" and "توانم"
    "است",
    "هست",
    "باید",
    "می",
    "توانم",
    "تونم",
    "میشه",
    "شود",
    "کنم",
    "کنیم",
    "بکنم",
    "کرد",
    // the object's mark, and to, from, in, with, for, on
    "را",
    "رو",
    "به",
    "از",
    "در",
    "با",
    "برای",
    "روی",
    "تا",
  ],
};

const questionWordCache: Map<string, ReadonlySet<string>> = new Map();

/*
 * A language's question words (DOCS_SEARCH_QUESTION_WORDS), folded as a
 * typed word is compared: none for a language without a list.
 */
export const getDocsSearchQuestionWords: (
  language: string,
) => ReadonlySet<string> = (language: string): ReadonlySet<string> => {
  const cached: ReadonlySet<string> | undefined =
    questionWordCache.get(language);

  if (cached) {
    return cached;
  }

  const listed: ReadonlyArray<string> = Object.prototype.hasOwnProperty.call(
    DOCS_SEARCH_QUESTION_WORDS,
    language,
  )
    ? DOCS_SEARCH_QUESTION_WORDS[language] || []
    : [];
  const folded: ReadonlySet<string> = new Set<string>(
    listed.map(foldDocsSearchWord),
  );

  questionWordCache.set(language, folded);

  return folded;
};

const UNSPACED_QUESTION_WORD: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const questionPhraseCache: Map<string, ReadonlyArray<string>> = new Map();

/*
 * A language's question words that are written without spaces (Chinese,
 * Japanese), longest first: cut out of what is typed wherever they stand,
 * since they are not words of their own there.
 */
export const getDocsSearchQuestionPhrases: (
  language: string,
) => ReadonlyArray<string> = (language: string): ReadonlyArray<string> => {
  const cached: ReadonlyArray<string> | undefined =
    questionPhraseCache.get(language);

  if (cached) {
    return cached;
  }

  const phrases: ReadonlyArray<string> = Array.from(
    getDocsSearchQuestionWords(language),
  )
    .filter((word: string): boolean => {
      return UNSPACED_QUESTION_WORD.test(word);
    })
    .sort((a: string, b: string): number => {
      return Array.from(b).length - Array.from(a).length || a.localeCompare(b);
    });

  questionPhraseCache.set(language, phrases);

  return phrases;
};

/*
 * THE WORDS THAT MAKE WHAT WAS TYPED A QUESTION, not keywords (#8334): a
 * language's "how", "what", "where", "when", "why", "who" and "which", the
 * asker's "me" and "my", and the endings a question closes with where they
 * are words of their own (Korean "하나요", Japanese "ですか", Chinese "吗").
 * Each is also one of the language's question words (English's are in
 * AIDocsReader's QUESTION_WORDS), so it is never looked for: it only tells
 * the docs search box (DocsSearch.isQuestion) that a page may answer what
 * was asked without saying every one of its words. A question's verb is
 * often one the answer's page never says: Website Monitor's Russian page
 * says "мониторинг" and "сайт", not "отслеживать" (track) or "настроить"
 * (set up).
 *
 * A keyword search has none of these: "kubernetes helm", "website ssl",
 * "API-Schlüssel erstellen". Articles and prepositions ("the", "for",
 * "der", "pour") are question words but not asking ones: "create a
 * monitor" is keywords, as strict as before. English "I" is not one
 * either: "disk i/o latency" is keywords.
 *
 * Chinese and Japanese entries are found wherever they stand in what was
 * typed, as their question words are cut (getDocsSearchQuestionPhrases).
 */
export const DOCS_SEARCH_ASKING_WORDS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  en: ["how", "what", "where", "when", "why", "which", "who", "me", "my"],
  de: [
    "wie",
    "was",
    "wo",
    "wann",
    "warum",
    "wieso",
    "weshalb",
    "wer",
    "wen",
    "wem",
    "welche",
    "welcher",
    "welches",
    "welchen",
    "welchem",
    "ich",
    "mich",
    "mir",
    "mein",
    "meine",
    "meinen",
    "meinem",
    "meiner",
    "meines",
  ],
  fr: [
    "comment",
    "quoi",
    "quel",
    "quelle",
    "quels",
    "quelles",
    "où",
    "quand",
    "pourquoi",
    "qui",
    "lequel",
    "laquelle",
    "est-ce",
    "je",
    "moi",
    "mon",
    "ma",
    "mes",
    "puis-je",
    "dois-je",
  ],
  // Not "qué": typed without its accent, as many do, it is "que", mostly "that".
  es: [
    "cómo",
    "cuál",
    "cuáles",
    "dónde",
    "cuándo",
    "porqué",
    "quién",
    "quiénes",
    "yo",
    "mi",
    "mis",
  ],
  // Not "che": mostly "that", not "what".
  it: [
    "come",
    "cosa",
    "quale",
    "quali",
    "dove",
    "quando",
    "perché",
    "chi",
    "io",
    "mio",
    "mia",
    "miei",
    "mie",
  ],
  // Not "que" (mostly "that", not "what"), nor "quê", which is "que" without its accent.
  pt: [
    "como",
    "qual",
    "quais",
    "onde",
    "quando",
    "porque",
    "quem",
    "eu",
    "mim",
    "meu",
    "minha",
    "meus",
    "minhas",
  ],
  nl: [
    "hoe",
    "wat",
    "waar",
    "wanneer",
    "waarom",
    "wie",
    "welk",
    "welke",
    "ik",
    "mij",
    "mijn",
  ],
  da: [
    "hvordan",
    "hvad",
    "hvor",
    "hvornår",
    "hvorfor",
    "hvem",
    "hvilken",
    "hvilket",
    "hvilke",
    "jeg",
    "mig",
    "min",
    "mit",
    "mine",
  ],
  no: [
    "hvordan",
    "hva",
    "hvor",
    "når",
    "hvorfor",
    "hvem",
    "hvilken",
    "hvilket",
    "hvilke",
    "jeg",
    "meg",
    "min",
    "mitt",
    "mine",
  ],
  sv: [
    "hur",
    "vad",
    "var",
    "när",
    "varför",
    "vem",
    "vilken",
    "vilket",
    "vilka",
    "jag",
    "mig",
    "mej",
    "min",
    "mitt",
    "mina",
  ],
  // Not "что" (mostly "that") or "который" ("which" that joins a clause, not one that asks).
  ru: [
    "как",
    "где",
    "куда",
    "когда",
    "почему",
    "зачем",
    "кто",
    "какой",
    "какая",
    "какое",
    "какие",
    "каким",
    "какую",
    "каком",
    "я",
    "меня",
    "мне",
    "мой",
    "моя",
    "моё",
    "мои",
    "моего",
    "моей",
    "моему",
    "моим",
    "моих",
    "моём",
    "свой",
    "свою",
    "своего",
    "своей",
    "своим",
    "своих",
  ],
  ja: [
    "どうすればいいですか",
    "どうすればよいですか",
    "どうすればいいでしょうか",
    "どうすればよいでしょうか",
    "どうすればいい",
    "どうすればよい",
    "どうすれば",
    "どうしたらいいですか",
    "どうしたらいい",
    "どうしたら",
    "どうやったら",
    "どうやって",
    "どのようにして",
    "どのように",
    "したいです",
    "したい",
    "教えてください",
    "教えて",
    "でしょうか",
    "ですか",
    "ますか",
    "私の",
    "私は",
    "私",
    "何",
    "誰",
  ],
  ko: [
    "어떻게",
    "어떡하나요",
    "무엇",
    "무엇을",
    "무엇이",
    "뭐",
    "뭘",
    "어디",
    "어디서",
    "어디에",
    "어디에서",
    "언제",
    "왜",
    "누가",
    "누구",
    "어떤",
    "어느",
    "무슨",
    "나",
    "나는",
    "내",
    "내가",
    "나의",
    "저는",
    "제",
    "제가",
    "저의",
    "하나요",
    "있나요",
    "있습니까",
    "있을까요",
    "합니까",
    "되나요",
    "됩니까",
    "좋을까요",
    "좋나요",
    "알려주세요",
  ],
  "zh-CN": [
    "如何",
    "怎么",
    "怎么样",
    "怎样",
    "怎么做",
    "什么",
    "哪里",
    "哪儿",
    "哪个",
    "为什么",
    "为何",
    "我的",
    "我们的",
    "请问",
    "吗",
    "呢",
  ],
  "zh-TW": [
    "如何",
    "怎麼",
    "怎麼樣",
    "怎樣",
    "怎麼做",
    "什麼",
    "哪裡",
    "哪兒",
    "哪個",
    "為什麼",
    "為何",
    "我的",
    "我們的",
    "請問",
    "嗎",
    "呢",
  ],
  hi: [
    "कैसे",
    "क्या",
    "कहाँ",
    "कहां",
    "कब",
    "क्यों",
    "कौन",
    "कौनसा",
    "कौन-सा",
    "किस",
    "किसे",
    "मैं",
    "मुझे",
    "मेरा",
    "मेरी",
    "मेरे",
  ],
  fa: [
    "چطور",
    "چطوری",
    "چگونه",
    "چه",
    "چی",
    "چیست",
    "کجا",
    "کجاست",
    "کی",
    "چرا",
    "کدام",
    "کدوم",
    "من",
    "مرا",
    "خودم",
  ],
};

const askingWordCache: Map<string, ReadonlySet<string>> = new Map();

/*
 * A language's asking words (DOCS_SEARCH_ASKING_WORDS), folded as a typed
 * word is compared: none for a language the docs do not have.
 */
export const getDocsSearchAskingWords: (
  language: string,
) => ReadonlySet<string> = (language: string): ReadonlySet<string> => {
  const cached: ReadonlySet<string> | undefined = askingWordCache.get(language);

  if (cached) {
    return cached;
  }

  const listed: ReadonlyArray<string> = Object.prototype.hasOwnProperty.call(
    DOCS_SEARCH_ASKING_WORDS,
    language,
  )
    ? DOCS_SEARCH_ASKING_WORDS[language] || []
    : [];
  const folded: ReadonlySet<string> = new Set<string>(
    listed.map(foldDocsSearchWord),
  );

  askingWordCache.set(language, folded);

  return folded;
};

/*
 * Whether `word`, as typed, asks: it is one of `language`'s asking words,
 * or, written without spaces, holds one wherever it stands
 * ("如何监控我的网站" holds "如何").
 */
export const isDocsSearchAskingWord: (
  word: string,
  language: string,
) => boolean = (word: string, language: string): boolean => {
  const asking: ReadonlySet<string> = getDocsSearchAskingWords(language);
  const folded: string = foldDocsSearchWord(word);

  if (asking.has(folded)) {
    return true;
  }

  if (!UNSPACED_QUESTION_WORD.test(folded)) {
    return false;
  }

  for (const phrase of asking) {
    if (UNSPACED_QUESTION_WORD.test(phrase) && folded.includes(phrase)) {
      return true;
    }
  }

  return false;
};

/*
 * THE ENDINGS A WORD IS COMPARED WITHOUT, per language (#7875).
 *
 * A page's words and a question's are both read without one ending, so
 * the forms of a word meet: Norwegian "nettstedet" (the website) is
 * "nettsted", Russian "сайта" (of the site) "сайт", Portuguese "monitorar"
 * (to monitor) "monitor", Korean "웹사이트를" (website, with its object's
 * mark) "웹사이트" and Persian "سایتم" (my site) "سایت". Read with
 * English's endings, "Nettsted-overvåking" lost "ed" and read as "nettst",
 * and "Hvordan overvåker jeg nettstedet mitt?" found Website Monitor 9th.
 *
 * The index is built per language (AIDocsReader.build), so a language's
 * endings are taken off every word of its index in its script, and off
 * what is typed in it: the two always meet. A Latin-script word in a
 * language of another script (an English product name on a Russian page)
 * loses English's endings, as every word did before.
 *
 * English and German keep the endings every language had (ENGLISH_ENDINGS),
 * so their results are as they were. Chinese and Japanese have no endings
 * to take off: their words are compared as written.
 */
export interface DocsWordEndings {
  // Tried longest first; one is taken off.
  endings: ReadonlyArray<string>;
  // The fewest letters a word keeps once one is.
  shortestStem: number;
  // An ending that needs more of the word left: Danish "opret" keeps its "et".
  longerStems?: Readonly<Record<string, number>> | undefined;
  /*
   * The letters it is taken off. Latin-script words are compared without
   * their accents, so their endings are written without them.
   */
  script: RegExp;
  /*
   * A doubled consonant at the end is read as one, so the forms of a verb
   * meet: Danish "opretter" and "oprette" are "oprett", and "opret" is too.
   */
  undoublesConsonants?: boolean | undefined;
  // A doubled vowel before the last consonant is read as one: Dutch "maak" is "mak", as "maken" is.
  undoublesVowels?: boolean | undefined;
}

export const LATIN_SCRIPT_WORD: RegExp = /^[\p{Script=Latin}\p{M}\p{N}]+$/u;
const CYRILLIC_WORD: RegExp = /^[\p{Script=Cyrillic}\p{M}\p{N}]+$/u;
const HANGUL_WORD: RegExp = /^[\p{Script=Hangul}\p{N}]+$/u;
const ARABIC_WORD: RegExp = /^[\p{Script=Arabic}\p{M}\p{N}]+$/u;
const DEVANAGARI_WORD: RegExp = /^[\p{Script=Devanagari}\p{M}\p{N}]+$/u;

// Plural and verb endings: "monitors", "paging", "paged".
export const ENGLISH_ENDINGS: DocsWordEndings = {
  endings: ["ing", "ers", "ed", "es", "en", "er", "s", "e"],
  shortestStem: 3,
  script: LATIN_SCRIPT_WORD,
};

// Danish and Norwegian: definite forms, plurals, verbs and verbal nouns.
const NORDIC_ENDINGS: ReadonlyArray<string> = [
  "ingene",
  "ingen",
  "inger",
  "ninger",
  "ningen",
  "ning",
  "erne",
  "ende",
  "ede",
  "ene",
  "eten",
  "ing",
  "er",
  "en",
  "et",
  "e",
  "a",
  "s",
];

// "opret" (create) is not "opr" with a definite "-et"; "webstedet" is "websted".
const NORDIC_LONGER_STEMS: Readonly<Record<string, number>> = { et: 4 };

export const DOCS_SEARCH_WORD_ENDINGS: Readonly<
  Record<string, DocsWordEndings>
> = {
  en: ENGLISH_ENDINGS,
  de: ENGLISH_ENDINGS,
  // "maak", "maakt" and "maken"; "stel" and "stellen"; "instellingen".
  nl: {
    endings: [...ENGLISH_ENDINGS.endings, "ingen"],
    shortestStem: 3,
    script: LATIN_SCRIPT_WORD,
    undoublesConsonants: true,
    undoublesVowels: true,
  },
  // "surveiller" and "surveillance", "configurer" and "configuration".
  fr: {
    endings: [
      "ications",
      "ication",
      "ations",
      "ation",
      "ements",
      "ement",
      "ances",
      "ance",
      "ences",
      "ence",
      "euses",
      "euse",
      "eurs",
      "eur",
      "iers",
      "ier",
      "ees",
      "ee",
      "er",
      "ez",
      "es",
      "e",
      "s",
    ],
    shortestStem: 3,
    script: LATIN_SCRIPT_WORD,
  },
  // "monitorear", "monitoreo" and "monitor"; "configuro" and "configuración".
  es: {
    endings: [
      "aciones",
      "acion",
      "amientos",
      "amiento",
      "ear",
      "eo",
      "ar",
      "er",
      "ir",
      "es",
      "os",
      "as",
      "o",
      "a",
      "e",
      "s",
    ],
    shortestStem: 3,
    script: LATIN_SCRIPT_WORD,
  },
  // "monitorare", "monitoraggio" and "monitor"; "imposto" and "impostazione".
  it: {
    endings: [
      "azioni",
      "azione",
      "aggi",
      "aggio",
      "are",
      "ere",
      "ire",
      "i",
      "o",
      "a",
      "e",
    ],
    shortestStem: 3,
    script: LATIN_SCRIPT_WORD,
  },
  // "monitorar", "monitoramento" and "monitor"; "agendo" and "agendamento".
  pt: {
    endings: [
      "amentos",
      "amento",
      "acoes",
      "acao",
      "oes",
      "ao",
      "ar",
      "er",
      "ir",
      "es",
      "os",
      "as",
      "o",
      "a",
      "e",
      "s",
    ],
    shortestStem: 3,
    script: LATIN_SCRIPT_WORD,
  },
  // "nettstedet" and "nettsted", "overvåker" and "overvåking".
  da: {
    endings: NORDIC_ENDINGS,
    shortestStem: 3,
    longerStems: NORDIC_LONGER_STEMS,
    script: LATIN_SCRIPT_WORD,
    undoublesConsonants: true,
  },
  no: {
    endings: NORDIC_ENDINGS,
    shortestStem: 3,
    longerStems: NORDIC_LONGER_STEMS,
    script: LATIN_SCRIPT_WORD,
    undoublesConsonants: true,
  },
  // "övervakar", "övervaka" and "övervakning"; "statussida" and "statussidor".
  sv: {
    endings: [
      "ningarna",
      "ningar",
      "ningen",
      "ning",
      "arna",
      "erna",
      "orna",
      "ande",
      "ade",
      "ar",
      "er",
      "or",
      "en",
      "et",
      "an",
      "at",
      "na",
      "a",
      "e",
      "s",
    ],
    shortestStem: 3,
    script: LATIN_SCRIPT_WORD,
    undoublesConsonants: true,
  },
  // Cases, and verbs with their nouns: "сайта" and "сайт", "отслеживать" and "отслеживание".
  ru: {
    endings: [
      "ированием",
      "ирования",
      "ирование",
      "ировать",
      "ениями",
      "аниями",
      "ением",
      "анием",
      "ения",
      "ание",
      "ение",
      "ании",
      "ении",
      "анию",
      "ению",
      "ания",
      "иться",
      "аться",
      "ться",
      "тся",
      "ами",
      "ями",
      "ого",
      "его",
      "ому",
      "ему",
      "ыми",
      "ими",
      "ать",
      "ять",
      "ить",
      "еть",
      "ует",
      "уют",
      "ает",
      "яет",
      "ают",
      "яют",
      "ах",
      "ях",
      "ов",
      "ев",
      "ей",
      "ой",
      "ий",
      "ый",
      "ая",
      "яя",
      "ое",
      "ее",
      "ые",
      "ие",
      "ым",
      "им",
      "ом",
      "ем",
      "ам",
      "ям",
      "ую",
      "юю",
      "ых",
      "их",
      "ет",
      "ит",
      "ют",
      "ят",
      "ут",
      "ь",
      "а",
      "я",
      "о",
      "е",
      "ы",
      "и",
      "у",
      "ю",
    ],
    shortestStem: 3,
    script: CYRILLIC_WORD,
  },
  // Particles and the endings of a verb made with 하다: "웹사이트를", "모니터링하나요".
  ko: {
    endings: [
      "했습니다",
      "하도록",
      "하거나",
      "하려면",
      "하나요",
      "하세요",
      "합니다",
      "합니까",
      "했나요",
      "하는지",
      "됩니다",
      "되나요",
      "입니다",
      "인가요",
      "에서는",
      "에서도",
      "에게서",
      "에게는",
      "으로는",
      "하는",
      "하기",
      "하고",
      "하면",
      "하여",
      "해서",
      "해야",
      "하지",
      "되는",
      "되면",
      "되어",
      "나요",
      "려면",
      "세요",
      "에서",
      "에게",
      "께서",
      "한테",
      "으로",
      "로는",
      "에는",
      "에도",
      "까지",
      "부터",
      "보다",
      "처럼",
      "마다",
      "이나",
      "한",
      "할",
      "함",
      "해",
      "된",
      "돼",
      "로",
      "을",
      "를",
      "이",
      "가",
      "은",
      "는",
      "의",
      "에",
      "와",
      "과",
      "도",
    ],
    shortestStem: 2,
    script: HANGUL_WORD,
  },
  // The possessive "my": "سایتم" is "سایت".
  fa: { endings: ["م"], shortestStem: 3, script: ARABIC_WORD },
  /*
   * A verb's forms, and the plural a noun takes before a postposition:
   * "बनाऊँ" (may I make), "बनाएँ" (make) and "बनाना" (making) are "बना";
   * "घटनाएँ" and "घटनाओं" (incidents) are "घट", as "घटना" is.
   */
  hi: {
    endings: [
      "नाएँ",
      "नाएं",
      "नाओं",
      "ऊँ",
      "ऊं",
      "ूँ",
      "ूं",
      "एँ",
      "एं",
      "ओं",
      "ें",
      "ों",
      "ना",
      "ने",
    ],
    shortestStem: 2,
    script: DEVANAGARI_WORD,
  },
};

/*
 * The endings `language`'s words are compared without, for a word of the
 * given script: its own for its own script, English's for a Latin-script
 * word in a language of another script (or a language the docs do not
 * have), and none otherwise.
 */
export const getDocsWordEndings: (
  word: string,
  language?: string | undefined,
) => DocsWordEndings | null = (
  word: string,
  language?: string | undefined,
): DocsWordEndings | null => {
  const own: DocsWordEndings | undefined =
    language &&
    Object.prototype.hasOwnProperty.call(DOCS_SEARCH_WORD_ENDINGS, language)
      ? DOCS_SEARCH_WORD_ENDINGS[language]
      : undefined;

  if (own && own.script.test(word)) {
    return own;
  }

  return LATIN_SCRIPT_WORD.test(word) ? ENGLISH_ENDINGS : null;
};

/*
 * Languages that write a thing's name as one word made of others, which a
 * question asks with the words apart: Swedish "Webbplatsövervakning" for
 * "övervaka min webbplats", Norwegian "nettstedsmonitor". The question's
 * words are also read joined, in either order and with the "s" that links
 * them, where the docs hold the word they make (AIDocsReader.readQuestion).
 */
export const DOCS_SEARCH_COMPOUNDING_LANGUAGES: ReadonlySet<string> =
  new Set<string>(["da", "no", "sv"]);

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
