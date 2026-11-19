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
  /*
   * The docs say "sign in" (#9212), and Require SSO for Login is Require
   * SSO to Sign In now (#9278): "login" still finds what they say.
   */
  login: ["sign in"],
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
    "2fa": ["tweefactorauthenticatie"],
    tweestapsverificatie: ["tweefactorauthenticatie"],
  },
  /*
   * A website is a "hjemmeside" or "hemsida" to most who ask, and a
   * "websted", "nettsted" or "webbplats" in the docs: no Danish page says
   * "hjemmeside", so "Hvordan overvåger jeg min hjemmeside?" found
   * Website Monitor 99th (#7875).
   */
  /*
   * Two-factor authentication is "tofaktorgodkendelse" in Danish and
   * "tofaktorautentisering" in Norwegian, in the Dashboard and the docs
   * alike (#8701, #8774). A reader's "totrinsgodkendelse" or
   * "totrinnsbekreftelse", which Google and banks say, is read as it.
   */
  da: {
    pager: ["vagt*"],
    nedbrud: ["hændelse*"],
    outage: ["hændelse*"],
    uptime: ["overvågning*"],
    hjemmeside: ["websted"],
    "2fa": ["tofaktorgodkendelse"],
    totrinsgodkendelse: ["tofaktorgodkendelse"],
    tofaktorautentificering: ["tofaktorgodkendelse"],
  },
  no: {
    pager: ["vakt*"],
    nedetid: ["hendelse*"],
    outage: ["hendelse*"],
    uptime: ["overvåking*"],
    hjemmeside: ["nettsted"],
    "2fa": ["tofaktorautentisering"],
    totrinnsbekreftelse: ["tofaktorautentisering"],
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
    // The docs and the Dashboard say "दो-कारक प्रमाणीकरण"; many readers say it in English letters (#8774).
    "2fa": ["दो-कारक प्रमाणीकरण"],
    "टू-फ़ैक्टर": ["दो-कारक"],
    "टू-फैक्टर": ["दो-कारक"],
    ऑथेंटिकेशन: ["प्रमाणीकरण"],
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
    // "이중 인증" (double authentication) is the docs' "2단계 인증" (#8774).
    이중: ["2단계"],
  },
  "zh-CN": {
    pager: ["值班"],
    寻呼: ["值班"],
    故障: ["事件"],
    宕机: ["事件"],
    outage: ["事件"],
    uptime: ["监视器"],
    // The docs and the Dashboard say "双因素身份验证" (#8774).
    "2fa": ["双因素身份验证"],
    双重身份验证: ["双因素身份验证"],
    双因素认证: ["双因素身份验证"],
  },
  "zh-TW": {
    pager: ["待命"],
    呼叫器: ["待命"],
    故障: ["事件"],
    當機: ["事件"],
    outage: ["事件"],
    uptime: ["監測器"],
    "2fa": ["雙重驗證"],
    雙因素驗證: ["雙重驗證"],
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
 *
 * Every list was read again for #8335, against real questions in each
 * language (AskAiHowDoIQuestions' ASK_AI_QUESTIONS_BY_LANGUAGE): each
 * lacked its "how much" or "how many", its "I want" and "should", and
 * the part of a verb a question writes apart where the docs write the
 * verb another way (German "lege ... an", Danish "sætte ... op"). Dutch
 * "aan" and "in" left the list instead: they are the first part of a verb
 * a question writes after it (DOCS_SEARCH_SEPARABLE_PARTICLES): "maak ... aan" is the
 * docs' "aanmaken". Persian gained "آیا", which opens a yes-or-no
 * question, and the spoken "یه" (a).
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
    // someone, nobody: "Wie eskaliere ich, wenn niemand antwortet?" (#8775)
    "jemand",
    "niemand",
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
    // must, should, want, would like (#8335)
    "muss",
    "soll",
    "will",
    "möchte",
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
    // the rest of a verb written apart: "lege ... an", "schalte ... aus", "melde ... ab" (#8335)
    "an",
    "aus",
    "ab",
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
    // how many, I want, I would like (#8335)
    "combien",
    "veux",
    "voudrais",
    "souhaite",
    "aimerais",
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
    // how much, how many, I want, I need, should, could (#8335)
    "cuánto",
    "cuánta",
    "cuántos",
    "cuántas",
    "quiero",
    "necesito",
    "debería",
    "podría",
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
    // how much, how many, I want, I would like, should, one must (#8335)
    "quanto",
    "quanta",
    "quanti",
    "quante",
    "voglio",
    "vorrei",
    "dovrei",
    "bisogna",
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
    // how much, how many, I want, I would like, I need, I manage to, should (#8335)
    "quanto",
    "quanta",
    "quantos",
    "quantas",
    "quero",
    "gostaria",
    "preciso",
    "consigo",
    "deveria",
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
    // how many, want, would (#8335)
    "hoeveel",
    "wil",
    "wilt",
    "zou",
    /*
     * for, of, on, to, with. Not "aan" or "in": they are also the first
     * part of a verb a question writes after it, "maak ... aan" (aanmaken,
     * create) and "stel ... in" (instellen, set up), read joined as the
     * docs write them (DOCS_SEARCH_SEPARABLE_PARTICLES, #8335).
     */
    "voor",
    "van",
    "op",
    "met",
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
    // the rest of a verb written apart: "sætte op" (set up) (#8335)
    "op",
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
    // the rest of a verb written apart: "sette opp" (set up) (#8335)
    "opp",
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
    // the rest of a verb written apart: "sätta upp" (set up) (#8335)
    "upp",
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
    // they can, you can, I want, one should (#8335)
    "могут",
    "можете",
    "хочу",
    "следует",
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
    // should I ...: "書けばいいですか" (#8335)
    "ばいいですか",
    "ばよいですか",
    "いいですか",
    "よいですか",
    "いいでしょうか",
    "よいでしょうか",
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
    // what do I do, can or cannot (#8335)
    "怎么办",
    "能不能",
    "可不可以",
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
    // what do I do, can or cannot (#8335)
    "怎麼辦",
    "能不能",
    "可不可以",
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
    // may I take, take, may I give, give: "बैकअप कैसे लूँ" (#8335)
    "लूँ",
    "लूं",
    "लें",
    "दूँ",
    "दूं",
    "दें",
    // want, will I get (#8335)
    "चाहता",
    "चाहती",
    "चाहते",
    "मिलेगा",
    "मिलेगी",
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
    // a, this, that, there ("یه" is "یک" as it is spoken and typed)
    "یک",
    "یه",
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
    // a yes-or-no question's opening, how much, not, you do, can I and I want typed without the half-space, become (#8335)
    "آیا",
    "چقدر",
    "نمی",
    "کنید",
    "بکنید",
    "میتوانم",
    "میتونم",
    "خواهم",
    "میخواهم",
    "میخوام",
    "خوام",
    "شوم",
    "شوید",
    "شوند",
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
    "combien",
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
    "cuánto",
    "cuánta",
    "cuántos",
    "cuántas",
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
    "quanto",
    "quanta",
    "quanti",
    "quante",
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
    "quanto",
    "quanta",
    "quantos",
    "quantas",
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
    "hoeveel",
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
    "怎么办",
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
    "怎麼辦",
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
    "آیا",
    "چقدر",
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
 *
 * Read again for #8335 against every word of each language's docs, each
 * change kept only where the words it made meet were one word's forms:
 * Persian, Korean and Russian verbs whose stems differ (`forms`), Hindi
 * plurals in "-इयाँ" (`rewrites`), Swedish "-or" loanwords (`keptAfter`),
 * Korean particles on a Latin name (`writtenOnto`), Persian plurals and
 * possessives one after another (`stacksEndings`), Russian imperatives,
 * Danish and Norwegian "-ere" verbs, French "-ier" verbs and Spanish and
 * Italian verbs with their "self" on them.
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
  /*
   * An ending read as another rather than taken off (#8335): Hindi's
   * plural "ियाँ" as its singular's "ि", so "नीतियाँ" (policies) is
   * "नीति" (policy). Tried with `endings`, longest first.
   */
  rewrites?: Readonly<Record<string, string>> | undefined;
  /*
   * An ending kept where what is before it matches (#8335): Swedish takes
   * "-or" off a plural ("statussidor"), not off "monitor" or "villkor".
   */
  keptAfter?: Readonly<Record<string, RegExp>> | undefined;
  // Words whose forms no ending meets, read as one (DocsWordForms).
  forms?: DocsWordForms | undefined;
  /*
   * Where a compound word is joined, by its first word and the rest: each
   * is also read as a word of its own, beside the compound (#8775).
   */
  compoundJoint?: RegExp | undefined;
  /*
   * Endings come off one after another, not one alone (#8335): a Persian
   * word ending in "م" loses it as if it were "my" ("تنظیم", set up, is
   * "تنظی"), so "تنظیمات" (settings) must lose "ات" and then "م" to meet it,
   * and "پیامها" (messages) "ها" and then "م" to meet "پیام" (message).
   */
  stacksEndings?: boolean | undefined;
  /*
   * A word of another script its endings are written onto, the name
   * first and the ending after (#8335): Korean writes its particles onto
   * a Latin name, so "Slack을" is "Slack" with its object's mark. The
   * name is read as a word of its own script, the ending taken off.
   */
  writtenOnto?: RegExp | undefined;
}

/*
 * THE FORMS NO ENDING MEETS, per language (#8335): a verb's stems that
 * differ ("بسازم", may I make, is "ساز"; "ساخت", making, is "ساخت"), an
 * irregular verb's ("만드나요" is "만드", "만들기" is "만들"), a noun
 * made from a verb ("настройка", setting, and "настроить", set up). Each
 * stem a word is written with is read as the one it is listed with.
 *
 * `prefixes` and `endings` come off a word only where what is left is
 * one of `stems`, so they are no risk to any other word: as an ending
 * of every Korean word, "기" would read 탐색기 (explorer) as 탐색
 * (explore). What is left once a word's ordinary ending is taken off is
 * read the same way, so "가져오기가" (the import, its subject) is
 * "가져오기", and so "가져오".
 */
export interface DocsWordForms {
  prefixes: ReadonlyArray<string>;
  endings: ReadonlyArray<string>;
  stems: Readonly<Record<string, string>>;
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
  /*
   * A verb in "-ere" (#8335): "inviterer" (invites) and "invitere" (to
   * invite) are "invit", as "Inviter" (invite!) is, the imperative the
   * docs name a page with ("Inviter personer"). Taking "-er" alone off
   * left them "inviter" and "invit", and the question never met the page.
   */
  "erer",
  "ere",
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

// A German verb's endings in "-ieren", and its nouns' (#8775).
const GERMAN_VERB_ENDINGS: ReadonlyArray<string> = [
  "ierungen",
  "ierung",
  "ierten",
  "ierte",
  "ieren",
  "ierst",
  "iert",
  "iere",
  "ationen",
  "ation",
];
const GERMAN_VERB_LONGER_STEMS: Readonly<Record<string, number>> =
  Object.fromEntries(
    GERMAN_VERB_ENDINGS.map((ending: string): [string, number] => {
      return [ending, 4];
    }),
  );
const GERMAN_VERB_KEPT_AFTER: Readonly<Record<string, RegExp>> =
  Object.fromEntries(
    GERMAN_VERB_ENDINGS.filter((ending: string): boolean => {
      return ending.startsWith("ier");
    }).map((ending: string): [string, RegExp] => {
      return [ending, /^(?:pass|prob)$/];
    }),
  );

export const DOCS_SEARCH_WORD_ENDINGS: Readonly<
  Record<string, DocsWordEndings>
> = {
  en: ENGLISH_ENDINGS,
  /*
   * English's eight, as every German word had (#7875), and the forms of a
   * verb in "-ieren" with the nouns it makes (#8775): "eskaliere",
   * "eskalieren" and "eskaliert" are "eskal", as "Eskalation" is;
   * "konfigurieren" and "Konfiguration" are "konfigur", "aktivieren" and
   * "Aktivierung" "aktiv". They met nowhere before: "-en" left
   * "eskalier", and "Eskalation" kept its "-ation".
   */
  de: {
    endings: [...ENGLISH_ENDINGS.endings, ...GERMAN_VERB_ENDINGS],
    shortestStem: 3,
    /*
     * Four letters before them, or "Rotation" would be "rot" (red), and
     * "datiert" (dated) would meet "Daten" (data) as "dat".
     */
    longerStems: GERMAN_VERB_LONGER_STEMS,
    /*
     * "passiert" (happens) is not "passen" (fits), nor "probieren" (to try)
     * a Probe.
     */
    keptAfter: GERMAN_VERB_KEPT_AFTER,
    script: LATIN_SCRIPT_WORD,
    /*
     * A compound joined at the "s" after "-ung", "-tion", "-heit", "-keit",
     * "-schaft" or "-ität" is also read as its two words: the Escalation
     * Rules page, "Eskalationsregeln", holds "Eskalation" (so "eskal") and
     * "Regeln", and "Benachrichtigungsmethoden" holds "Benachrichtigung".
     */
    compoundJoint:
      /^(\p{L}{3,}?(?:ung|tion|heit|keit|schaft|ität))s(\p{L}{3,})$/u,
  },
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
      /*
       * A verb in "-ier" in its other forms (#8335): "planifiée" (planned)
       * and "il planifie" are "planifier", as "planification" is. They
       * were "planifi", and "Comment planifier une maintenance ?" never
       * met "Vue d'ensemble de la maintenance planifiée".
       */
      "iees",
      "iee",
      "iez",
      "ies",
      "ie",
      "ees",
      "ee",
      "er",
      "ez",
      "es",
      "e",
      "s",
    ],
    /*
     * "-ie" and "-ies" are a "-fier", "-lier", "-pier" or "-dier" verb's
     * ("vérifie", "notifie", "publie", "copie"); after any other letter
     * they are a noun's ("partie", "série", "sortie"), which would meet
     * "partez", "serez" and "sorte", or a "-yer" verb's ("envoie", which
     * is "envoi" with them kept).
     */
    keptAfter: { ie: /[^fldp]$/, ies: /[^fldp]$/ },
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
      // A verb with its "self" on it: "suscribirse" (subscribe) is "suscrib", as "suscribo" is (#8335).
      "arse",
      "erse",
      "irse",
      "ear",
      "eo",
      "ar",
      "er",
      "ir",
      /*
       * A verb's "they" form (#8700): "se suscriben" (they subscribe) is
       * "suscrib", as "suscribo" and "suscribirse" are; "funcionan" is
       * "funcion", as "funciona" is. A noun in "-en" takes "-enes" in the
       * plural, so both come off it: "imagen" and "imágenes" are "imag",
       * "volumen" and "volúmenes" "volum". A "-ear" verb's is "-ean":
       * "monitorean" is "monitor", as "monitorear" is.
       */
      "enes",
      "ean",
      "an",
      "en",
      "es",
      "os",
      "as",
      "o",
      "a",
      "e",
      "s",
    ],
    /*
     * "-en" stays on an English word the docs say in Spanish, whose plural
     * takes an "-s" ("token" and "tokens", "screen" and "screens"), on
     * the nouns whose verb keeps it ("orden" and "almacén" meet "ordenar"
     * and "almacenar", sort and store), and after "i", where it is no
     * verb's ("bien", "quien", "también"; "mantienes" meets "mantiene").
     */
    keptAfter: {
      en: /(?:k|e|i|almac|ord)$/,
      enes: /(?:k|e|i|almac|ord)$/,
    },
    forms: {
      prefixes: [],
      endings: [],
      stems: {
        /*
         * "Suscriptores y anuncios" (Subscribers and Announcements) names
         * the people by a form no ending makes of "suscribir" (#8700).
         */
        suscriptor: "suscrib",
        /*
         * The "you" commands that end in "-én", which "-en" would part from
         * their verb: "Mantén" (keep) is "mantener", "Obtén" (get)
         * "obtener", "Detén" (stop) "detener", "Retén" (hold) "retener".
         */
        mant: "manten",
        obt: "obten",
        det: "deten",
        ret: "reten",
      },
    },
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
      // A verb with its "self" on it: "iscriversi" (subscribe) is "iscriv", as "iscrivo" is (#8335).
      "arsi",
      "ersi",
      "irsi",
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
      /*
       * A verb's "they" form (#8700): "assinam" (they subscribe) is
       * "assin", as "assinar" is; "recebem" is "receb". A noun in "-em"
       * takes "-ens" in the plural, so both come off it: "mensagem" and
       * "mensagens" are "mensag", "nuvem" and "nuvens" "nuv". "We" forms
       * too: "enviamos" is "envi", as "enviam" is.
       */
      "amos",
      "emos",
      "ens",
      "am",
      "em",
      "es",
      "os",
      "as",
      "o",
      "a",
      "e",
      "s",
    ],
    /*
     * The ending stays on an English word the docs say in Portuguese,
     * whose plural takes an "-s": "stream" and "streams", "program" and
     * "programs", "system", "problem" and "post-mortem", "token" and
     * "tokens".
     */
    keptAfter: { am: /(?:e|gr)$/, em: /(?:st|rt|bl)$/, ens: /(?:k|e)$/ },
    /*
     * "Assinantes e comunicados" (Subscribers and Announcements) names the
     * people by a form no ending makes of "assinar" (#8700).
     */
    forms: { prefixes: [], endings: [], stems: { assinant: "assin" } },
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
    /*
     * "monitorn" and "monitorns" (the monitor, the monitor's) are
     * "monitor", as "monitorer" (monitors) is (#8335).
     */
    rewrites: { orn: "or", orns: "or" },
    /*
     * "-or" is a plural's ("statussidor", status pages, is "statussid",
     * as "statussida" is), not the end of a loanword in "-tor", "-sor",
     * "-cor" or "-rror" ("monitor", "sensor", "error") or of "villkor"
     * (condition). Taken off them, "monitor" was "monit" while
     * "monitorer" was "monitor", and the two never met (#8335). "Listor"
     * (lists) still loses it: "-stor" is no loanword's "-tor".
     */
    keptAfter: { or: /(?:[^s]t|s|c|rr|villk)$/ },
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
      /*
       * The plural cases of a noun in "-ние" the singular ones meet: of
       * them ("Настройки уведомлений", Notification Settings), to them, in
       * them. Without them "уведомлений" was "уведомлен" and "уведомления"
       * (notifications) "уведомл", so "Как настроить уведомления?" did not
       * read the page named for it as named for it, and found it 9th to
       * 11th, behind sections that only say whom they notify.
       */
      "ениям",
      "аниям",
      "ениях",
      "аниях",
      "ением",
      "анием",
      "ений",
      "аний",
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
      /*
       * The imperative the docs write a step in, which a question asks as
       * an infinitive (#8335): "Создайте" (create) is "Как создать?",
       * "Установите" (install) "Как установить?", "Проверьте" (check)
       * "Как проверить?", "Настройте" (set up) "Как настроить?".
       */
      "айте",
      "яйте",
      "ите",
      "йте",
      "ьте",
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
    /*
     * A noun made from a verb with "-ка" is the verb (#8335): "настройка"
     * and "настройки" (setting, settings) are "настроить" (set up), as
     * "установка" (installation) is "установить" and "проверка" (check)
     * "проверить". So are "настроек" and the other "of the ..." plurals,
     * which no ending makes, and the imperfective "настраивать".
     * "Приглашение" (invitation) is "пригласить" (invite), "подписчики"
     * (subscribers) "подписаться" (subscribe).
     */
    forms: {
      prefixes: [],
      endings: [],
      stems: {
        настройк: "настро",
        настроек: "настро",
        настраив: "настро",
        установк: "установ",
        установок: "установ",
        устанавлив: "установ",
        проверк: "провер",
        проверок: "провер",
        отправк: "отправ",
        отправок: "отправ",
        загрузк: "загруз",
        загрузок: "загруз",
        выгрузк: "выгруз",
        выгрузок: "выгруз",
        подписк: "подпис",
        подписок: "подпис",
        подписчик: "подпис",
        приглаш: "приглас",
      },
    },
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
      "에서의",
      "에게서",
      "에게는",
      "으로는",
      "이라는",
      "이므로",
      "라는",
      "이며",
      "이고",
      "이면",
      "에만",
      "로만",
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
    /*
     * The native verbs a how-to question asks with, whose forms the
     * endings above do not meet (#8335). 만들다 (make) drops its ㄹ before
     * ㄴ, ㅂ and ㅅ: "만드나요" (do I make?), "만드세요", "만든", "만듭니다",
     * and the name's "만들기" (making). 끄다 (turn off) and 쓰다 (write)
     * lose their ㅡ ("꺼져", "써야"); 가져오다 (import) contracts to
     * "가져와". Their endings ("기", "고", "지", "면", "어" ...) come off
     * these stems only: off every word, "기" would read 탐색기 (explorer)
     * as 탐색 (explore) and 수집기 (collector) as 수집 (collect).
     */
    forms: {
      prefixes: [],
      endings: [
        "었습니다",
        "았습니다",
        "어집니다",
        "아집니다",
        "으려면",
        "으려고",
        "으므로",
        "습니다",
        "십시오",
        "었나요",
        "았나요",
        "집니다",
        "는지",
        "나요",
        "세요",
        "니다",
        "려면",
        "려고",
        "거나",
        "므로",
        "으며",
        "으면",
        "어서",
        "아서",
        "어야",
        "아야",
        "어요",
        "아요",
        "어도",
        "아도",
        "어지",
        "아지",
        "어진",
        "아진",
        "어져",
        "아져",
        "지는",
        "기",
        "는",
        "고",
        "지",
        "면",
        "며",
        "은",
        "을",
        "음",
        "어",
        "아",
        "서",
        "야",
        "요",
        "도",
        "져",
        "진",
        "짐",
        "질",
      ],
      stems: {
        만들: "만들",
        만드: "만들",
        만든: "만들",
        만듭: "만들",
        가져오: "가져오",
        가져와: "가져오",
        가져온: "가져오",
        가져옵: "가져오",
        내보내: "내보내",
        내보낸: "내보내",
        내보냅: "내보내",
        보내: "보내",
        보낸: "보내",
        보냅: "보내",
        받: "받",
        켜: "켜",
        켠: "켜",
        켭: "켜",
        끄: "끄",
        꺼: "끄",
        끕: "끄",
        쓰: "쓰",
        써: "쓰",
        쓴: "쓰",
        씁: "쓰",
        찾: "찾",
      },
    },
    writtenOnto:
      /^(\p{Script=Latin}[\p{Script=Latin}\p{N}]*)(\p{Script=Hangul}+)$/u,
    shortestStem: 2,
    script: HANGUL_WORD,
  },
  /*
   * The possessive "my" ("سایتم" is "سایت"), the plural written onto its
   * noun without a half-space ("مانیتورها" and "مانیتورهای" are
   * "مانیتور"), and the Arabic plural "ات" ("تنظیمات", settings, is
   * "تنظیم", set up) (#8335).
   */
  fa: {
    endings: ["هایی", "هایم", "های", "ها", "ات", "م"],
    stacksEndings: true,
    /*
     * A verb's present stem and its past one are read as one, the past
     * (#8335): "بسازم" (may I make) is "ساز", the name's "ساخت" (making)
     * "ساخت". A verb's prefixes ("می", "نمی", "ب", "ن") and person
     * endings come off these stems only. Its past participle is listed
     * whole ("ساخته", made): "ه" after a present stem makes a noun
     * ("نویسه", a character; "سازه", a structure), not the verb.
     *
     * The plural "ان" of the people the docs name is listed whole too
     * ("کاربران", users; "مشترکان", subscribers): off every word it would
     * read "میزبان" (host) as "میزب" and "مهمان" (guest) as "مهم"
     * (important), and off "کاربر" (user) it would meet "کاربرد" (use).
     * Not "دادن" (give): its "داده" (given) is the docs' "داده" (data).
     */
    forms: {
      prefixes: ["نمی", "می", "ب", "ن"],
      endings: ["یم", "ید", "ند", "ن", "م", "ی", "د"],
      stems: {
        ساز: "ساخت",
        ساخت: "ساخت",
        ساخته: "ساخت",
        گیر: "گرفت",
        گرفت: "گرفت",
        گرفته: "گرفت",
        نویس: "نوشت",
        نوشت: "نوشت",
        نوشته: "نوشت",
        گذار: "گذاشت",
        گذاشت: "گذاشت",
        گذاشته: "گذاشت",
        فرست: "فرستاد",
        فرستاد: "فرستاد",
        فرستاده: "فرستاد",
        کاربران: "کاربر",
        مشترکان: "مشترک",
        مالکان: "مالک",
        مدیران: "مدیر",
        مشتریان: "مشتری",
      },
    },
    shortestStem: 3,
    script: ARABIC_WORD,
  },
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
    /*
     * A noun in "-इ" or "-ई" takes "-इयाँ" in the plural (#8335): "नीति"
     * (policy) is "नीतियाँ", "नीतियां" or "नीतियों" (policies), "कुंजी"
     * (key) "कुंजियाँ", "सूची" (list) "सूचियाँ". The plural's "ियाँ" is
     * read as the singular's "ि", and a long "ी" at a word's end as the
     * short "ि" the plural shortens it to, so "कुंजी" and "कुंजियाँ" are
     * both "कुंजि". Taking "ी" off instead would read "सूची" (list) as
     * "सूच", as "सूचना" (notification) is.
     */
    rewrites: {
      "ियाँ": "ि",
      "ियां": "ि",
      "ियों": "ि",
      "ी": "ि",
    },
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
 * The first parts of a verb a question writes after it, per language
 * (#8335): Dutch "Hoe nodig ik een collega uit?" asks for "uitnodigen"
 * (invite), the page's "Mensen uitnodigen", and "Hoe maak ik een
 * API-sleutel aan?" for the heading's "Een API-sleutel aanmaken". Each
 * is read joined to the question's other words, itself first, where the
 * docs hold the word they make (AIDocsReader.compoundsOf), and is no
 * question word, so it is there to join. Only these: read as Danish's,
 * every two words of a Dutch question joined, "Hoe meld ik een incident?"
 * found "incidentmelding" on the Huntress page before Een incident melden.
 */
export const DOCS_SEARCH_SEPARABLE_PARTICLES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  nl: [
    "aan",
    "af",
    "door",
    "in",
    "mee",
    "na",
    "over",
    "terug",
    "toe",
    "uit",
    "vast",
    "weg",
  ],
};

const particleCache: Map<string, ReadonlySet<string>> = new Map();

// A language's separable particles (DOCS_SEARCH_SEPARABLE_PARTICLES): none for most.
export const getDocsSearchSeparableParticles: (
  language: string,
) => ReadonlySet<string> = (language: string): ReadonlySet<string> => {
  const cached: ReadonlySet<string> | undefined = particleCache.get(language);

  if (cached) {
    return cached;
  }

  const particles: ReadonlySet<string> = new Set<string>(
    Object.prototype.hasOwnProperty.call(
      DOCS_SEARCH_SEPARABLE_PARTICLES,
      language,
    )
      ? DOCS_SEARCH_SEPARABLE_PARTICLES[language] || []
      : [],
  );

  particleCache.set(language, particles);

  return particles;
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
 * The words of a vocabulary: how many pages hold each, by the word - or,
 * as a docs index builds one (DocsIndexBuilder), the words already sorted
 * with those counts by their place, which the index's entries are numbered
 * by too (DocsIndexPostings).
 */
export type DocsVocabularyWords =
  | ReadonlyMap<string, number>
  | {
      sorted: ReadonlyArray<string>;
      pageCounts: ArrayLike<number>;
    };

/*
 * Every word a language's docs hold, with how many pages hold it, laid out
 * to find the words a typed word starts or nearly spells.
 *
 * The words are one sorted list, and a word's place in it is its number:
 * how many pages hold it is a typed array by that number, the words of
 * each length a typed array of those numbers (#8818). A word the index
 * lists that no page holds - one only a nav group or a section's heading
 * says - has 0 pages: the vocabulary does not have it.
 */
export class DocsVocabulary {
  private readonly sorted: ReadonlyArray<string>;
  private readonly pageCounts: ArrayLike<number>;
  // The places of the words pages hold, by their length in characters, in sorted order.
  private readonly byLength: Map<number, Uint32Array> = new Map();

  public constructor(words: DocsVocabularyWords) {
    if (DocsVocabulary.isByWord(words)) {
      const sorted: Array<string> = Array.from(words.keys()).sort();

      this.sorted = sorted;
      this.pageCounts = Uint32Array.from(sorted, (term: string): number => {
        return words.get(term) || 0;
      });
    } else {
      this.sorted = words.sorted;
      this.pageCounts = words.pageCounts;
    }

    const places: Map<number, Array<number>> = new Map();

    this.sorted.forEach((term: string, place: number): void => {
      if (this.pageCounts[place]! === 0) {
        return;
      }

      const length: number = Array.from(term).length;
      const sameLength: Array<number> = places.get(length) || [];

      sameLength.push(place);
      places.set(length, sameLength);
    });

    for (const [length, sameLength] of places) {
      this.byLength.set(length, Uint32Array.from(sameLength));
    }
  }

  private static isByWord(
    words: DocsVocabularyWords,
  ): words is ReadonlyMap<string, number> {
    return words instanceof Map;
  }

  // How many words it lists, the ones no page holds too.
  public get size(): number {
    return this.sorted.length;
  }

  // The word at `place` in sorted order.
  public termAt(place: number): string {
    return this.sorted[place]!;
  }

  // The place of `term` in sorted order: its number in the index. -1 for a word it does not list.
  public positionOf(term: string): number {
    const place: number = this.firstAtOrAfter(term);

    return place < this.sorted.length && this.sorted[place] === term
      ? place
      : -1;
  }

  public has(term: string): boolean {
    return this.pagesHolding(term) > 0;
  }

  public pagesHolding(term: string): number {
    const place: number = this.positionOf(term);

    return place < 0 ? 0 : this.pageCounts[place]!;
  }

  // The words that start with `start` (itself not included), most used first.
  public startingWith(
    start: string,
    limit: number,
  ): Array<DocsVocabularyMatch> {
    if (!start) {
      return [];
    }

    const matches: Array<DocsVocabularyMatch> = [];

    for (
      let place: number = this.firstAtOrAfter(start);
      place < this.sorted.length;
      place++
    ) {
      const term: string = this.sorted[place]!;

      if (!term.startsWith(start)) {
        break;
      }

      const pages: number = this.pageCounts[place]!;

      if (term !== start && pages > 0) {
        matches.push({ term, pages, distance: 0 });
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
      for (const place of this.byLength.get(size) || []) {
        const term: string = this.sorted[place]!;

        // A typo is rarely the first letter, and keeping it cuts out near-misses ("hello" is not "help").
        if (term === word || !term.startsWith(first)) {
          continue;
        }

        const distance: number | null = isWithinEditDistance(word, term, max);

        if (distance !== null) {
          matches.push({ term, pages: this.pageCounts[place]!, distance });
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

  // The first place whose word sorts at or after `term`.
  private firstAtOrAfter(term: string): number {
    let low: number = 0;
    let high: number = this.sorted.length;

    while (low < high) {
      const middle: number = (low + high) >> 1;
      if (this.sorted[middle]! < term) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
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
