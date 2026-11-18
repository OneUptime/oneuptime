import DocsSearch, {
  DocsQueryAlternative,
  DocsQueryWord,
  DocsSearchAnswer,
  DocsSearchResult,
} from "../../../FeatureSet/Docs/Utils/DocsSearch";
import {
  ASK_AI_HOW_DO_I_QUESTIONS_IN_EVERY_LANGUAGE,
  ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
  ASK_AI_QUESTIONS_BY_LANGUAGE,
  ASK_AI_WEBSITE_QUESTIONS,
  AskAiHowDoIQuestionTranslated,
} from "./AskAiHowDoIQuestions";
import DocsAIReader, {
  AIDocsIndexedPage,
  AIDocsIndexedSection,
  AIDocsLanguageIndex,
  tokenizeForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import {
  DOCS_SEARCH_SYNONYMS,
  DocsSearchSynonyms,
  foldDocsSearchWord,
} from "../../../FeatureSet/Docs/Utils/DocsSearchWords";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, jest, test } from "@jest/globals";
import path from "path";

/*
 * DOCS SEARCH ON THE REAL DOCS (issue #6822), in English and in other
 * languages - the issue's "done when": "escalaton", "pager" and a phrase
 * from the middle of a page find the right section, in English and in two
 * other languages (German, French, and Japanese too).
 *
 * The phrase is not picked by hand: one section in 41 long enough to have
 * a middle gives the six words in its middle, and nine in ten of them must
 * open that very section among the first five results. (A phrase every
 * one of the eleven "Moving from" guides says word for word cannot tell
 * them apart, which is why it is nine in ten and not all.)
 *
 * Which sections are tried is decided by a hash of each one's address
 * (page and anchor), not by counting sections in order: counted, a
 * section added to one page moved every pick after it, so new docs
 * anywhere could swap the whole sample (two sections added to
 * on-call/policies made it every 41st section plus two, and the English
 * share fell to 89 in 100 with no search worse). Hashed, a new section is
 * tried or not on its own, and the other pages keep their picks.
 *
 * The index is the one Ask AI reads too (AIDocsReader), built from the
 * docs on disk.
 */

jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

const BUILD_TIMEOUT_MS: number = 600000;

/*
 * Questions of AskAiHowDoIQuestions that the docs search box does not
 * show a page for in its first ten, each with why. Ask AI's search finds
 * each in the six it shows the model. This list only shrinks: a question
 * the box finds fails its test until it is deleted here. #8698 found the
 * two-factor questions (a section of Your Account) in five languages,
 * #8700 the Spanish and Portuguese subscribers, and #8775 German's
 * escalation: Escalation Rules ("Eskalationsregeln") is named for
 * "eskaliere" now.
 */
const NOT_IN_THE_BOX_FIRST_TEN: Record<string, string> = {
  "zh-TW 如何安排維護？":
    "The maintenance pages say 排定 (schedule), never 安排 (arrange): the box reads 安排維護 as 安排, 排維 and 維護, and they hold one of the three, while Home, OpenStack and Declaring an Incident say 安排維護 in passing.",
};

const search: (
  language: string,
  query: string,
  limit?: number,
) => Promise<DocsSearchAnswer> = async (
  language: string,
  query: string,
  limit?: number,
): Promise<DocsSearchAnswer> => {
  return DocsSearch.search({ query, language, limit });
};

const urls: (answer: DocsSearchAnswer) => Array<string> = (
  answer: DocsSearchAnswer,
): Array<string> => {
  return answer.results.map((result: DocsSearchResult): string => {
    return result.url;
  });
};

// Whether one of `found` opens `page` of the docs in `language`, at the top or at a section.
const opensPage: (
  found: Array<string>,
  language: string,
  page: string,
) => boolean = (
  found: Array<string>,
  language: string,
  page: string,
): boolean => {
  const address: string = `/docs/${language}/${page}`;

  return found.some((url: string): boolean => {
    return url === address || url.startsWith(`${address}#`);
  });
};

/*
 * Whether a result holds every one of `words`: one of each word's ways
 * of being found, every term of it, in the page (its name, summary,
 * headings, group or text) or in the section (its heading, its text, or
 * its page's name), as DocsSearch.rank reads them.
 */
const holdsEveryWord: (
  index: AIDocsLanguageIndex,
  result: DocsSearchResult,
  words: Array<DocsQueryWord>,
) => boolean = (
  index: AIDocsLanguageIndex,
  result: DocsSearchResult,
  words: Array<DocsQueryWord>,
): boolean => {
  const [address, anchor] = result.url.split("#") as [
    string,
    string | undefined,
  ];
  const page: AIDocsIndexedPage | undefined = index.pages.find(
    (candidate: AIDocsIndexedPage): boolean => {
      return address === `/docs/${index.language}/${candidate.page}`;
    },
  );

  if (!page) {
    return false;
  }

  const holdsAll: (holds: (term: string) => boolean) => boolean = (
    holds: (term: string) => boolean,
  ): boolean => {
    return words.every((word: DocsQueryWord): boolean => {
      return word.alternatives.some(
        (alternative: DocsQueryAlternative): boolean => {
          return alternative.terms.every(holds);
        },
      );
    });
  };

  if (anchor === undefined) {
    return holdsAll((term: string): boolean => {
      return (
        page.titleTerms.has(term) ||
        page.summaryTerms.has(term) ||
        page.headingTerms.has(term) ||
        page.groupTerms.has(term) ||
        page.bodyTerms.has(term)
      );
    });
  }

  // A Glossary term and its other names share an anchor.
  return page.sections
    .filter((section: AIDocsIndexedSection): boolean => {
      return section.anchor === anchor;
    })
    .some((section: AIDocsIndexedSection): boolean => {
      return holdsAll((term: string): boolean => {
        return (
          section.terms.has(term) ||
          section.titleTerms.has(term) ||
          (!section.isOtherName && page.titleTerms.has(term))
        );
      });
    });
};

// FNV-1a of a section's address: the same 32-bit number for the same address, on every run.
const hashOfAddress: (address: string) => number = (
  address: string,
): number => {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < address.length; index++) {
    hash ^= address.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
};

// How many of the sampled middle-of-section phrases open their section in the first five.
const phraseSweep: (
  language: string,
) => Promise<{ tried: number; found: number; missed: Array<string> }> = async (
  language: string,
): Promise<{ tried: number; found: number; missed: Array<string> }> => {
  const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
  let tried: number = 0;
  let found: number = 0;
  const missed: Array<string> = [];

  for (const page of index.pages) {
    for (const section of page.sections) {
      if (
        hashOfAddress(`${page.page}#${section.anchor}`) % 41 !== 0 ||
        section.isOtherName ||
        section.text.length < 300
      ) {
        continue;
      }

      const words: Array<string> = section.text.split(" ");
      const middle: number = Math.floor(words.length / 2);
      const phrase: string = words.slice(middle, middle + 6).join(" ");
      const answer: DocsSearchAnswer = DocsSearch.rank(index, `${phrase} `, 5);

      tried++;

      if (
        urls(answer).includes(
          `/docs/${language}/${page.page}#${section.anchor}`,
        )
      ) {
        found++;
      } else {
        missed.push(`${page.page}#${section.anchor}: ${phrase}`);
      }
    }
  }

  return { tried, found, missed };
};

describe("docs search, on the real docs", () => {
  test(
    "English: a typo, a reader's word and a phrase from the middle of a page find the right section",
    async () => {
      const escalaton: DocsSearchAnswer = await search("en", "escalaton");
      expect(urls(escalaton).slice(0, 3)).toContain(
        "/docs/en/on-call/escalation-rules",
      );
      expect(escalaton.words).toContain("escalation");

      for (const result of (await search("en", "pager")).results.slice(0, 3)) {
        expect(`${result.title} ${result.url}`).toMatch(/on-call/i);
      }

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("en");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "English: the issue's other words, a half-typed word and a misspelt plural",
    async () => {
      expect(urls(await search("en", "2fa")).slice(0, 2)).toContain(
        "/docs/en/introduction/your-account#turn-on-two-factor-authentication",
      );
      expect(
        (await search("en", "outage")).results
          .slice(0, 3)
          .some((result: DocsSearchResult): boolean => {
            return result.url.startsWith("/docs/en/incidents/");
          }),
      ).toBe(true);
      expect(
        (await search("en", "uptime")).results.some(
          (result: DocsSearchResult): boolean => {
            return result.title.toLowerCase().includes("monitor");
          },
        ),
      ).toBe(true);
      expect(
        (await search("en", "kube")).results
          .slice(0, 3)
          .every((result: DocsSearchResult): boolean => {
            return `${result.title} ${result.url}`
              .toLowerCase()
              .includes("kubernetes");
          }),
      ).toBe(true);
      expect(urls(await search("en", "notifcations")).slice(0, 3)).toEqual(
        expect.arrayContaining(["/docs/en/notifications/notification-methods"]),
      );
      /*
       * Services' old name (#6817): the page no longer says it, so the
       * glossary's term that lists it comes first, then the page itself.
       */
      expect(
        urls(await search("en", "service catalog"))
          .slice(0, 2)
          .some((url: string): boolean => {
            return url.startsWith("/docs/en/telemetry/services");
          }),
      ).toBe(true);
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * Require SSO to Sign In was Require SSO for Login (#9278). The docs say
   * sign in now, so the old name still finds the pages about the switch.
   */
  test(
    "English: Require SSO to Sign In's old name still finds its pages",
    async () => {
      for (const query of [
        "require sso for login",
        "Require SSO for Login",
        "require sso to sign in",
      ]) {
        expect({
          query,
          found: urls(await search("en", query))
            .slice(0, 3)
            .some((url: string): boolean => {
              return url.startsWith("/docs/en/identity/");
            }),
        }).toEqual({ query, found: true });
      }
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "German: a typo, a reader's word and a phrase from the middle of a page",
    async () => {
      expect(
        urls(await search("de", "Eskalatonsregel"))
          .slice(0, 3)
          .some((url: string): boolean => {
            return url.includes("escalation-rule");
          }),
      ).toBe(true);

      for (const result of (await search("de", "pager")).results.slice(0, 3)) {
        expect(result.title).toMatch(/bereitschaft/i);
      }

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("de");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * The German API reference names its step by the button's word (#7876):
   * the button is "API-Schlüssel erstellen". The step said "anlegen", so
   * the button's name found it 14th, after other tools' "erstellen" steps.
   */
  test(
    "German: the button's name opens the API reference's step that creates an API key",
    async () => {
      expect(urls(await search("de", "API-Schlüssel erstellen"))[0]).toBe(
        "/docs/de/api-reference/api-reference#einen-api-schlüssel-erstellen",
      );
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * A German "how do I" question opens the page it asks about (#7874): the
   * words it is phrased with ("wie", "ich", "meine") are not looked for, as
   * Ask AI's search does not look for them. The German docs say "Sie" and
   * "Ihre", so the pages that held every word were the ones that quote a
   * question, and Website-Überwachung was not shown at all. A page named
   * with them is still found by its name; the API key question needs the
   * step named by the button's word, above.
   */
  test.each([
    ["Wie überwache ich meine Website?", "monitor/website-monitor", 3],
    ["Wie erstelle ich eine Bereitschaftsrichtlinie?", "on-call/policies", 2],
    ["Wie plane ich eine Wartung?", "scheduled-maintenance/creating-events", 2],
    ["Wie ich erreichbar bin", "notifications/on-call-rules", 3],
    ["Wie erstelle ich einen API-Schlüssel?", "api-reference/api-reference", 1],
  ] as Array<[string, string, number]>)(
    'German: "%s" opens %s in the first %d',
    async (question: string, page: string, within: number) => {
      const address: string = `/docs/de/${page}`;
      const first: Array<string> = urls(await search("de", question)).slice(
        0,
        within,
      );

      expect({
        question,
        first,
        opens: first.some((url: string): boolean => {
          return url === address || url.startsWith(`${address}#`);
        }),
      }).toEqual({ question, first, opens: true });
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * Every docs language's website question opens Website Monitor in the
   * search box too (#7875): its question words are left out, its words
   * read without their endings, as Ask AI reads them. Before, the French,
   * Dutch, Danish, Norwegian, Swedish, Korean and Persian ones did not show
   * it in the first 30.
   */
  test.each([
    ["en", "How do I monitor my website?"],
    ["de", "Wie überwache ich meine Website?"],
    ["fr", "Comment surveiller mon site web ?"],
    ["es", "¿Cómo puedo monitorear mi sitio web?"],
    ["it", "Come posso monitorare il mio sito web?"],
    ["pt", "Como faço para monitorar meu site?"],
    ["nl", "Hoe monitor ik mijn website?"],
    ["da", "Hvordan overvåger jeg mit websted?"],
    ["no", "Hvordan overvåker jeg nettstedet mitt?"],
    ["sv", "Hur övervakar jag min webbplats?"],
    ["ru", "Как мне мониторить мой веб-сайт?"],
    ["ja", "ウェブサイトを監視するにはどうすればいいですか？"],
    ["ko", "내 웹사이트를 어떻게 모니터링하나요?"],
    ["zh-CN", "如何监控我的网站？"],
    ["zh-TW", "如何監控我的網站？"],
    ["hi", "मैं अपनी वेबसाइट को मॉनिटर कैसे करूँ?"],
    ["fa", "چطور وب‌سایتم را پایش کنم؟"],
  ] as Array<[string, string]>)(
    '%s: "%s" opens Website Monitor in the first 5',
    async (language: string, question: string) => {
      const address: string = `/docs/${language}/monitor/website-monitor`;
      const first: Array<string> = urls(await search(language, question)).slice(
        0,
        5,
      );

      expect({
        question,
        first,
        opens: first.some((url: string): boolean => {
          return url === address || url.startsWith(`${address}#`);
        }),
      }).toEqual({ question, first, opens: true });
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * A question whose verb the answer's page never says (#8334): Website
   * Monitor's Russian page says "мониторинг" and "сайт", not
   * "отслеживать" (track) or "настроить" (set up); On-Call Schedules'
   * Danish page says "vagtplan", not "opsætte" (set up). Every typed
   * word had to be in a result, so other pages that say every word in
   * passing pushed the page out of the first 30. Six of the nine Russian
   * website questions did not show Website Monitor at all.
   */
  test.each([
    ...ASK_AI_WEBSITE_QUESTIONS.filter(
      (entry: AskAiHowDoIQuestionTranslated): boolean => {
        return entry.language === "ru";
      },
    ).map((entry: AskAiHowDoIQuestionTranslated): [string, string, string] => {
      return [entry.language, entry.question, entry.docsPage];
    }),
    ["da", "Hvordan opsætter jeg en vagtplan?", "on-call/schedules"],
    ["es", "¿Cómo configuro una programación de guardia?", "on-call/schedules"],
    ["zh-CN", "如何设置值班计划？", "on-call/schedules"],
    ["nl", "Hoe stel ik een bereikbaarheidsschema in?", "on-call/schedules"],
    ["de", "Wie richte ich einen Bereitschaftsplan ein?", "on-call/schedules"],
    ["ru", "Как настроить расписание дежурств?", "on-call/schedules"],
  ] as Array<[string, string, string]>)(
    '%s: "%s" opens %s in the first 5, though its page never says the verb (#8334)',
    async (language: string, question: string, page: string) => {
      const first: Array<string> = urls(await search(language, question)).slice(
        0,
        5,
      );

      expect({
        question,
        first,
        opens: opensPage(first, language, page),
      }).toEqual({ question, first, opens: true });
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * A question answered by a section of a page named for something else
   * (#8698): two-factor authentication is a step of Your Account, whose
   * heading names it ("Slå på tofaktorautentisering", "2 要素認証をオンにする")
   * where the question's verb is another ("slår", "aktiverar", 有効).
   * None of these was in the box's first 30.
   */
  test.each([
    ["nl", "Hoe zet ik tweestapsverificatie aan?"],
    ["da", "Hvordan slår jeg totrinsgodkendelse til?"],
    ["no", "Hvordan slår jeg på tofaktorautentisering?"],
    ["sv", "Hur aktiverar jag tvåfaktorsautentisering?"],
    ["ja", "二要素認証を有効にするにはどうすればいいですか？"],
  ] as Array<[string, string]>)(
    '%s: "%s" opens Your Account\'s two-factor step in the first 3 (#8698)',
    async (language: string, question: string) => {
      const first: Array<string> = urls(await search(language, question)).slice(
        0,
        3,
      );

      expect({
        question,
        first,
        opens: first.some((url: string): boolean => {
          return url.startsWith(`/docs/${language}/introduction/your-account#`);
        }),
      }).toEqual({ question, first, opens: true });
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * Each language names two-factor authentication with one word, the
   * Dashboard's (#8774): a question with it opens Your Account's step
   * first, and so does one with the other name readers say, which the
   * docs no longer write ("이중 인증", 双重身份验证, 雙因素驗證, "टू-फ़ैक्टर").
   */
  test.each([
    ["da", "Hvordan slår jeg tofaktorgodkendelse til?"],
    ["nl", "Hoe zet ik tweefactorauthenticatie aan?"],
    ["pt", "Como ativo a autenticação de dois fatores?"],
    ["it", "Come attivo l'autenticazione a due fattori?"],
    ["fr", "Comment activer l'authentification à deux facteurs ?"],
    ["ru", "Как включить двухфакторную аутентификацию?"],
    ["sv", "Hur slår jag på tvåfaktorsautentisering?"],
    ["hi", "दो-कारक प्रमाणीकरण कैसे चालू करें?"],
    ["hi", "टू-फ़ैक्टर ऑथेंटिकेशन कैसे चालू करें?"],
    ["ko", "이중 인증은 어떻게 켜나요?"],
    ["zh-CN", "如何开启双重身份验证？"],
    ["zh-TW", "如何開啟雙因素驗證？"],
  ] as Array<[string, string]>)(
    '%s: "%s" opens Your Account\'s two-factor step first (#8774)',
    async (language: string, question: string) => {
      const found: string | undefined = urls(
        await search(language, question),
      )[0];

      expect({ question, found }).toEqual({
        question,
        found: expect.stringMatching(
          new RegExp(`^/docs/${language}/introduction/your-account#`),
        ),
      });
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * A German verb in "-ieren" meets the noun a page is named with
   * (#8775): "eskaliere" and "konfiguriere" are Escalation Rules'
   * ("Eskalationsregeln") "Eskalation", read as a word of the compound.
   */
  test.each([
    ["Wie eskaliere ich, wenn niemand antwortet?", "on-call/escalation-rules"],
    ["Wie konfiguriere ich die Eskalation?", "on-call/escalation-rules"],
    [
      "Wie aktiviere ich die Zwei-Faktor-Authentifizierung?",
      "introduction/your-account",
    ],
  ] as Array<[string, string]>)(
    'de: "%s" opens %s first (#8775)',
    async (question: string, page: string) => {
      const first: Array<string> = urls(await search("de", question)).slice(
        0,
        1,
      );

      expect({ question, first, opens: opensPage(first, "de", page) }).toEqual({
        question,
        first,
        opens: true,
      });
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * Every question asked in another language than English, in the
   * search box as in Ask AI (AskAiHowDoIQuestions): its page is in the
   * first ten, but for the ones in NOT_IN_THE_BOX_FIRST_TEN.
   */
  test.each(
    [
      ...ASK_AI_WEBSITE_QUESTIONS,
      ...ASK_AI_HOW_DO_I_QUESTIONS_IN_EVERY_LANGUAGE,
      ...ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
      ...ASK_AI_QUESTIONS_BY_LANGUAGE,
    ].map(
      (
        entry: AskAiHowDoIQuestionTranslated,
      ): [string, string, Array<string>] => {
        return [
          entry.language,
          entry.question,
          [entry.docsPage, ...(entry.alsoAnswers || [])],
        ];
      },
    ),
  )(
    '%s: the search box shows a page that answers "%s" (%p) in the first 10',
    async (language: string, question: string, pages: Array<string>) => {
      const first: Array<string> = urls(await search(language, question)).slice(
        0,
        10,
      );
      const opens: boolean = pages.some((page: string): boolean => {
        return opensPage(first, language, page);
      });
      const notYet: string | undefined =
        NOT_IN_THE_BOX_FIRST_TEN[`${language} ${question}`];

      if (notYet) {
        // Found now: delete it from NOT_IN_THE_BOX_FIRST_TEN.
        expect({ question, notYet, opens }).toEqual({
          question,
          notYet,
          opens: false,
        });
        return;
      }

      expect({ question, first, opens }).toEqual({
        question,
        first,
        opens: true,
      });
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * Keywords are as strict as before (#8334): every result holds every
   * word typed, as the docs search box has always asked. Only a question
   * gets the results that hold most of its words.
   */
  test.each([
    ["en", "kubernetes helm"],
    ["en", "website ssl"],
    ["en", "escalation rules"],
    ["de", "API-Schlüssel erstellen"],
    ["fr", "politique astreinte"],
    ["ru", "отслеживать сайт"],
    ["ru", "настроить мониторинг сайта"],
    ["da", "opsætte vagtplan"],
    ["es", "configurar programación guardia"],
    ["zh-CN", "设置值班计划"],
    ["ja", "ステータスページ 作成"],
  ] as Array<[string, string]>)(
    '%s: keywords "%s" still need every word in every result',
    async (language: string, keywords: string) => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
      const answer: DocsSearchAnswer = DocsSearch.rank(
        index,
        `${keywords} `,
        30,
      );
      const words: Array<DocsQueryWord> = DocsSearch.readQuery(
        index,
        `${keywords} `,
      );

      expect(DocsSearch.isQuestion(index, `${keywords} `)).toBe(false);
      expect(
        answer.results
          .filter((result: DocsSearchResult): boolean => {
            return !holdsEveryWord(index, result, words);
          })
          .map((result: DocsSearchResult): string => {
            return result.url;
          }),
      ).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "Russian: asked as a question, the words find Website Monitor first; typed as keywords, only results that hold both",
    async () => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex("ru");
      const keywords: DocsSearchAnswer = DocsSearch.rank(
        index,
        "настроить сайт ",
        30,
      );
      const question: Array<string> = urls(
        await search("ru", "Как отслеживать мой сайт?", 30),
      );
      const words: Array<DocsQueryWord> = DocsSearch.readQuery(
        index,
        "настроить сайт ",
      );

      expect(keywords.results.length).toBeGreaterThan(0);
      expect(
        keywords.results.every((result: DocsSearchResult): boolean => {
          return holdsEveryWord(index, result, words);
        }),
      ).toBe(true);
      expect(
        opensPage(question.slice(0, 3), "ru", "monitor/website-monitor"),
      ).toBe(true);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "French: a half-typed word, a reader's word and a phrase from the middle of a page",
    async () => {
      expect(urls(await search("fr", "escalad"))[0]).toBe(
        "/docs/fr/on-call/escalation-rules",
      );

      for (const result of (await search("fr", "pager")).results.slice(0, 3)) {
        expect(result.title).toMatch(/astreinte/i);
      }

      expect(
        (await search("fr", "panne")).results.some(
          (result: DocsSearchResult): boolean => {
            return result.url.startsWith("/docs/fr/incidents/");
          },
        ),
      ).toBe(true);

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("fr");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "Japanese: written without spaces, a reader's word and a phrase from the middle of a page",
    async () => {
      expect(urls(await search("ja", "エスカレーション"))[0]).toBe(
        "/docs/ja/on-call/escalation-rules",
      );

      for (const result of (await search("ja", "pager")).results.slice(0, 3)) {
        expect(result.title).toMatch(/オンコール/);
      }

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("ja");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * A synonym that names a word the docs of its language never use finds
   * nothing: each one must match a word of that language's index - every
   * word of a phrase, or at least one word a word start begins.
   */
  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s: every synonym leads to words the docs in that language use",
    async (language: string) => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
      const list: DocsSearchSynonyms = (
        DOCS_SEARCH_SYNONYMS as Record<string, DocsSearchSynonyms>
      )[language] as DocsSearchSynonyms;
      const dead: Array<string> = [];

      for (const [word, values] of Object.entries(list)) {
        for (const value of values) {
          if (value.endsWith("*")) {
            const start: string = foldDocsSearchWord(value.slice(0, -1));
            if (
              !index.vocabulary.has(start) &&
              index.vocabulary.startingWith(start, 1).length === 0
            ) {
              dead.push(`${word} -> ${value}`);
            }
            continue;
          }

          // Read as the index reads its language's words (#7875).
          if (
            !tokenizeForDocs(value, language).every((term: string): boolean => {
              return index.vocabulary.has(term);
            })
          ) {
            dead.push(`${word} -> ${value}`);
          }
        }
      }

      expect(dead).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * What a search sends the browser is small: twenty results, each a title,
   * where it is, an address and one line (Devanagari takes three bytes a
   * letter, so Hindi's is the largest). The whole docs as an index the
   * browser could search measured 1.2 to 3 MB a language, which is why the
   * search runs on the docs server (Utils/DocsSearch.ts).
   */
  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s: an answer of twenty results stays under 16 KB",
    async (language: string) => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
      const monitorPage: AIDocsIndexedPage | undefined = index.pages.find(
        (page: AIDocsIndexedPage): boolean => {
          return page.page === "monitor/website-monitor";
        },
      );
      const firstSection: AIDocsIndexedSection | undefined =
        monitorPage?.sections[0];

      for (const query of [
        "monitor",
        monitorPage?.title || "monitor",
        firstSection?.title || "monitor",
      ]) {
        const answer: DocsSearchAnswer = DocsSearch.rank(index, query, 20);

        expect(answer.results.length).toBeGreaterThan(0);
        expect({
          language,
          query,
          small: Buffer.byteLength(JSON.stringify(answer), "utf8") < 16 * 1024,
        }).toEqual({ language, query, small: true });
      }
    },
    BUILD_TIMEOUT_MS,
  );
});
