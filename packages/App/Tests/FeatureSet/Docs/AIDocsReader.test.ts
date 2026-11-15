import DocsAIReader, {
  AIDocsLanguageIndex,
  cutQuestionWords,
  normalizeDocsPage,
  splitDocsSections,
  splitQuestionWords,
  stemDocsWord,
  tokenizeForDocs,
  tokenizeQueryForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import {
  ASK_AI_WEBSITE_QUESTIONS,
  AskAiHowDoIQuestionTranslated,
} from "./AskAiHowDoIQuestions";
import { makeDocsIndex } from "./DocsSearchHelpers";
import {
  AIDocsPage,
  AIDocsSearchHit,
} from "Common/Server/Utils/AI/Docs/AIDocsLibrary";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS AS ASK AI READS THEM (Docs/Utils/AIDocsReader, issue #6828):
 * the reader the Docs feature set hands Common's AIDocsLibrary, read here
 * against the real docs. It searches every page in the nav in full, in the
 * reader's language where a page is translated; reads a page as the docs
 * site draws it; and answers only for pages the nav lists.
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

const CONTENT: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const BUILD_TIMEOUT_MS: number = 600000;

const reader: DocsAIReader = new DocsAIReader();

/*
 * "How do I" questions in every docs language, each with the page named
 * for what it asks about, once its words are read without their endings
 * and without the question's own words (#7799, #7875): every language's
 * website question (ASK_AI_WEBSITE_QUESTIONS: German's finds
 * Website-Überwachung, not "Wie ich erreichbar bin", How to Reach Me), and
 * these.
 */
const NAMED_FOR_THE_QUESTION: Array<[string, string, string]> = [
  ["de", "Wie erstelle ich eine Bereitschaftsrichtlinie?", "on-call/policies"],
  ["de", "Wie erstelle ich einen Monitor?", "monitor/create-monitor"],
  ["fr", "Comment déclarer un incident ?", "incidents/declaring-incidents"],
  ["fr", "Comment créer un moniteur ?", "monitor/create-monitor"],
  ["fr", "Comment configurer un planning d'astreinte ?", "on-call/schedules"],
  ["es", "¿Cómo declaro un incidente?", "incidents/declaring-incidents"],
  ["es", "¿Cómo creo un monitor?", "monitor/create-monitor"],
  ["it", "Come creo una pagina di stato?", "status-pages/index"],
  [
    "it",
    "Come imposto una pianificazione di reperibilità?",
    "on-call/schedules",
  ],
  ["it", "Come creo un monitor?", "monitor/create-monitor"],
  ["pt", "Como crio uma página de status?", "status-pages/index"],
  ["pt", "Como configuro um agendamento de plantão?", "on-call/schedules"],
  ["pt", "Como crio um monitor?", "monitor/create-monitor"],
  // "maak" is "maken", the name's word.
  ["nl", "Hoe maak ik een monitor?", "monitor/create-monitor"],
  ["nl", "Hoe meld ik een incident?", "incidents/declaring-incidents"],
  // "opretter" is "Opret", the name's word.
  ["da", "Hvordan opretter jeg en monitor?", "monitor/create-monitor"],
  ["da", "Hvordan opretter jeg en statusside?", "status-pages/index"],
  ["da", "Hvordan opretter jeg en hændelse?", "incidents/declaring-incidents"],
  ["no", "Hvordan oppretter jeg en monitor?", "monitor/create-monitor"],
  ["no", "Hvordan oppretter jeg en hendelse?", "incidents/declaring-incidents"],
  ["sv", "Hur skapar jag en statussida?", "status-pages/index"],
  ["sv", "Hur skapar jag en monitor?", "monitor/create-monitor"],
  ["ru", "Как создать страницу статуса?", "status-pages/index"],
  ["ru", "Как настроить расписание дежурств?", "on-call/schedules"],
  ["ru", "Как создать монитор?", "monitor/create-monitor"],
  [
    "ja",
    "ステータスページを作成するにはどうすればいいですか？",
    "status-pages/index",
  ],
  [
    "ja",
    "モニターを作成するにはどうすればいいですか？",
    "monitor/create-monitor",
  ],
  ["ko", "온콜 스케줄을 어떻게 설정하나요?", "on-call/schedules"],
  ["ko", "인시던트를 어떻게 선언하나요?", "incidents/declaring-incidents"],
  ["zh-CN", "如何创建状态页？", "status-pages/index"],
  ["zh-CN", "如何创建监视器？", "monitor/create-monitor"],
  ["zh-TW", "如何建立狀態頁？", "status-pages/index"],
  ["zh-TW", "如何設定待命排程？", "on-call/schedules"],
  ["hi", "मैं स्थिति पृष्ठ कैसे बनाऊँ?", "status-pages/index"],
  ["hi", "मैं मॉनिटर कैसे बनाऊँ?", "monitor/create-monitor"],
  ["fa", "چطور یک صفحه وضعیت بسازم؟", "status-pages/index"],
  ["fa", "چطور یک حادثه اعلام کنم؟", "incidents/declaring-incidents"],
  /*
   * Named for the question once the forms its verb is asked in meet the
   * name's (#8335): Persian "بسازم" is "ساخت" (making), "بنویسم"
   * "نوشتن" (writing), "بگیرم" the "گیری" of "پشتیبان‌گیری" (backing
   * up); Korean "만드나요" is "만들기", "가져오나요" "가져오기",
   * "내보내나요" "내보내기"; Danish and Norwegian "inviterer" is
   * "Inviter"; Dutch "nodig ... uit" is "uitnodigen"; Russian
   * "пригласить" is "Приглашение".
   */
  ["fa", "چطور یک مانیتور بسازم؟", "monitor/create-monitor"],
  ["fa", "چطور می‌توانم یک مانیتور بسازم؟", "monitor/create-monitor"],
  ["fa", "چطور یک رانبوک بنویسم؟", "runbooks/authoring"],
  ["fa", "چطور از OneUptime پشتیبان بگیرم؟", "installation/backups"],
  ["fa", "چطور یک داشبورد بسازم؟", "dashboards/authoring"],
  ["ko", "모니터를 어떻게 만드나요?", "monitor/create-monitor"],
  ["ko", "리소스를 어떻게 가져오나요?", "terraform/importing-resources"],
  ["ko", "감사 로그를 어떻게 내보내나요?", "configuration/audit-log-export"],
  [
    "da",
    "Hvordan inviterer jeg en kollega til mit projekt?",
    "permissions/inviting-people",
  ],
  [
    "no",
    "Hvordan inviterer jeg en kollega til prosjektet mitt?",
    "permissions/inviting-people",
  ],
  [
    "nl",
    "Hoe nodig ik een collega uit voor mijn project?",
    "permissions/inviting-people",
  ],
  ["ru", "Как пригласить коллегу в проект?", "permissions/inviting-people"],
  ...ASK_AI_WEBSITE_QUESTIONS.map(
    (entry: AskAiHowDoIQuestionTranslated): [string, string, string] => {
      return [entry.language, entry.question, entry.docsPage];
    },
  ),
];

describe("normalizeDocsPage", () => {
  test("reads a page however the model passes it", () => {
    expect(normalizeDocsPage("monitor/website-monitor")).toBe(
      "monitor/website-monitor",
    );
    expect(normalizeDocsPage("/docs/de/monitor/website-monitor#ssl")).toBe(
      "monitor/website-monitor",
    );
    expect(
      normalizeDocsPage("https://oneuptime.com/docs/monitor/website-monitor/"),
    ).toBe("monitor/website-monitor");
    expect(normalizeDocsPage("monitor/website-monitor.md")).toBe(
      "monitor/website-monitor",
    );
  });

  test("is null for anything that cannot be a page: no climbing out of the docs", () => {
    expect(normalizeDocsPage("../../etc/passwd")).toBeNull();
    expect(normalizeDocsPage("monitor/../secrets")).toBeNull();
    expect(normalizeDocsPage("")).toBeNull();
    expect(normalizeDocsPage("monitor/Website Monitor")).toBeNull();
  });
});

describe("the words a question and a page are compared by", () => {
  test("drops a question's own words, endings and accents", () => {
    expect(tokenizeForDocs("How do I create monitors?")).toEqual([
      "creat",
      "monitor",
    ]);
    expect(stemDocsWord("bereitschaftspläne")).toBe(
      stemDocsWord("bereitschaftsplan"),
    );
    expect(stemDocsWord("paging")).toBe(stemDocsWord("paged"));
    expect(stemDocsWord("subscribers")).toBe(stemDocsWord("subscribe"));
  });

  test("keeps Devanagari's vowel signs in their word, and Persian words whole", () => {
    expect(tokenizeForDocs("मॉनिटर बनाएँ")).toEqual(["मॉनिटर", "बनाएँ"]);
    expect(tokenizeForDocs("صفحه وضعیت")).toEqual(["صفحه", "وضعیت"]);
  });

  test("reads Chinese and Japanese, written without spaces, in pairs of characters", () => {
    expect(tokenizeForDocs("状态页面")).toEqual(["状态", "态页", "页面"]);
  });

  test("reads a newcomer's word for what the docs call otherwise into a question only", () => {
    expect(tokenizeQueryForDocs("get a text")).toEqual(
      expect.arrayContaining(["text", "sms"]),
    );
    expect(tokenizeForDocs("get a text")).not.toContain("sms");
  });

  /*
   * The forms of a word meet in every docs language (#7875): a page's
   * word and a question's are both read without their language's ending.
   */
  test.each([
    // Definite forms: "nettstedet" is the website, the name says "Nettsted".
    ["no", ["nettsted", "nettstedet", "nettstedene", "nettsteder"]],
    ["no", ["overvåker", "overvåke", "overvåking", "overvåkingen"]],
    ["no", ["opprett", "oppretter", "opprette"]],
    // "websted" keeps its "ed": English's "-ed" read it as "webst".
    ["da", ["websted", "webstedet", "websteder", "webstederne"]],
    ["da", ["overvåger", "overvåge", "overvågning"]],
    ["da", ["opret", "opretter", "oprette"]],
    ["da", ["hændelse", "hændelser", "hændelsen", "hændelserne"]],
    ["sv", ["övervakar", "övervaka", "övervakning", "övervakningen"]],
    ["sv", ["webbplatsen", "webbplatser"]],
    ["sv", ["statussida", "statussidor", "statussidan"]],
    ["sv", ["skapa", "skapar"]],
    // A verb meets its noun.
    ["pt", ["monitor", "monitorar", "monitoramento", "monitores"]],
    ["pt", ["agendo", "agendar", "agendamento", "agendamentos"]],
    ["pt", ["crio", "criar", "criação"]],
    ["es", ["monitor", "monitorear", "monitoreo", "monitores"]],
    ["es", ["configuro", "configurar", "configuración"]],
    ["es", ["página", "páginas"]],
    ["it", ["monitor", "monitorare", "monitoraggio"]],
    ["it", ["pianifico", "pianificare", "pianificazione", "pianificazioni"]],
    ["fr", ["surveiller", "surveillance"]],
    ["fr", ["configurer", "configuration"]],
    ["fr", ["déclarer", "déclaration"]],
    ["nl", ["maak", "maken"]],
    ["nl", ["stel", "stellen"]],
    // Cases: "сайт" (site) is the name's "сайта".
    ["ru", ["сайт", "сайта", "сайтом", "сайте", "сайты", "сайтов"]],
    ["ru", ["отслеживать", "отслеживание", "отслеживания"]],
    ["ru", ["монитор", "мониторить", "монитора", "мониторы"]],
    ["ru", ["расписание", "расписания"]],
    // A particle, and a verb's ending, on the word.
    ["ko", ["웹사이트", "웹사이트를", "웹사이트에서", "웹사이트의"]],
    ["ko", ["모니터링", "모니터링하나요", "모니터링하려면", "모니터링하세요"]],
    // The possessive "my".
    ["fa", ["سایت", "سایتم"]],
    ["fa", ["مانیتور", "مانیتورم"]],
    // A verb's forms, and a plural before a postposition.
    ["hi", ["बनाना", "बनाऊँ", "बनाएँ", "बनाने"]],
    ["hi", ["घटना", "घटनाएँ", "घटनाओं"]],
    /*
     * The forms no ending met before (#8335). A Hindi noun in "-इ" or
     * "-ई" and its "-इयाँ" plural: policy and policies, key and keys.
     */
    ["hi", ["नीति", "नीतियाँ", "नीतियां", "नीतियों"]],
    ["hi", ["कुंजी", "कुंजियाँ", "कुंजियां", "कुंजियों"]],
    ["hi", ["अनुमति", "अनुमतियाँ", "अनुमतियों"]],
    ["hi", ["सूची", "सूचियाँ", "सूचियों"]],
    // A Persian verb's present stem and its past one, with its prefixes and person endings.
    [
      "fa",
      [
        "ساخت",
        "ساختن",
        "ساخته",
        "بسازم",
        "بسازید",
        "سازد",
        "میسازم",
        "نمیسازد",
        "سازی",
      ],
    ],
    ["fa", ["گرفتن", "گرفته", "بگیرم", "بگیرید", "گیری"]],
    ["fa", ["نوشتن", "نوشته", "بنویسم", "بنویسید", "نویسی"]],
    ["fa", ["گذاشتن", "بگذارم", "گذاری"]],
    ["fa", ["فرستادن", "بفرستم", "فرستاده"]],
    // A plural written onto its noun without a half-space, and the Arabic plural.
    ["fa", ["مانیتور", "مانیتورها", "مانیتورهای", "مانیتورهایی", "مانیتورم"]],
    ["fa", ["تنظیم", "تنظیمات"]],
    ["fa", ["کاربر", "کاربران"]],
    ["fa", ["مشترک", "مشترکان"]],
    // A Korean irregular verb: 만들다 drops its ㄹ, 끄다 its ㅡ; 가져오다 contracts.
    [
      "ko",
      [
        "만들기",
        "만드나요",
        "만드세요",
        "만드는",
        "만든",
        "만듭니다",
        "만들어",
        "만들려면",
        "만들고",
        "만들어진",
      ],
    ],
    ["ko", ["끄기", "끄나요", "끄세요", "꺼져", "꺼짐"]],
    ["ko", ["켜기", "켜나요", "켜세요", "켜져", "켜짐"]],
    ["ko", ["가져오기", "가져오나요", "가져와", "가져온", "가져오기가"]],
    ["ko", ["내보내기", "내보내나요", "내보낸", "내보냅니다"]],
    ["ko", ["받기", "받나요", "받습니다", "받으려면"]],
    // A Korean particle written onto a Latin name.
    ["ko", ["slack", "slack을", "slack에서", "slack의"]],
    ["ko", ["api", "api를", "api가"]],
    // A Russian noun made from a verb, and the imperative a step is written in.
    [
      "ru",
      [
        "настроить",
        "настройка",
        "настройки",
        "настроек",
        "настройками",
        "настройте",
        "настраивать",
      ],
    ],
    ["ru", ["установить", "установка", "установки", "установите"]],
    ["ru", ["проверить", "проверка", "проверок", "проверьте"]],
    ["ru", ["создать", "создайте"]],
    ["ru", ["включить", "включите"]],
    ["ru", ["пригласить", "приглашение", "приглашения"]],
    ["ru", ["подписаться", "подписка", "подписчики", "подписчиков"]],
    // Swedish loanwords in "-or" keep it; their definite forms meet them.
    ["sv", ["monitor", "monitorer", "monitorn", "monitorns", "monitorerna"]],
    ["sv", ["villkor", "villkoret", "villkoren"]],
    ["sv", ["administratör", "administratörer", "administratören"]],
    ["sv", ["lista", "listor", "listorna"]],
    // A French verb in "-ier" in its other forms.
    ["fr", ["planifier", "planifiée", "planifie", "planification"]],
    ["fr", ["notifier", "notifié", "notifie", "notification"]],
    ["fr", ["vérifier", "vérifiez", "vérifiées", "vérification"]],
    // ... but a "-yer" verb keeps its "-ie": "envoie" (sends) is "envoi" (sending).
    ["fr", ["envoi", "envoie"]],
  ] as Array<[string, Array<string>]>)(
    "%s: %p are one word (#7875)",
    (language: string, forms: Array<string>) => {
      const stems: Array<string> = forms.map((form: string): string => {
        return stemDocsWord(form, language);
      });

      expect(new Set<string>(stems).size).toBe(1);
    },
  );

  test.each([
    // Words that only look alike stay apart.
    ["sv", "webbplats", "webbplatsövervakning"],
    ["ru", "сайт", "сеть"],
    ["ko", "추가", "추"],
    ["no", "nettsted", "nettst"],
    ["pt", "estado", "este"],
    // A list is not a notification: "सूची" keeps its vowel apart from "सूचना" (#8335).
    ["hi", "सूची", "सूचना"],
    // Persian "داده" (data) is not "داد" (gave); a host is not a desk, nor a guest important.
    ["fa", "داده", "داد"],
    ["fa", "میزبان", "میز"],
    ["fa", "مهمان", "مهم"],
    ["fa", "کاربرد", "کاربر"],
    // A character is not writing; an explorer is not exploring.
    ["fa", "نویسه", "نوشتن"],
    ["ko", "탐색기", "탐색"],
    ["ko", "수집기", "수집"],
    // A Swedish condition and a word that merely starts like it.
    ["sv", "villkor", "villk"],
    // French nouns in "-ie" stay theirs: a part is not "you leave", a series not "you will be".
    ["fr", "partie", "partez"],
    ["fr", "série", "serez"],
  ] as Array<[string, string, string]>)(
    "%s: %s and %s stay apart",
    (language: string, one: string, other: string) => {
      expect(stemDocsWord(one, language)).not.toBe(
        stemDocsWord(other, language),
      );
    },
  );

  test("keeps English's and German's endings as they were, and English's for a Latin-script word elsewhere", () => {
    // The eight English endings, on English and German words alike.
    for (const language of ["en", "de", undefined]) {
      expect(stemDocsWord("monitoring", language)).toBe("monitor");
      expect(stemDocsWord("subscribers", language)).toBe("subscrib");
      expect(stemDocsWord("bereitschaftspläne", language)).toBe(
        "bereitschaftsplan",
      );
      expect(stemDocsWord("überwache", language)).toBe("uberwach");
      expect(stemDocsWord("websted", language)).toBe("webst");
    }
    // A Latin-script word on a Russian, Korean or Persian page: English's endings.
    expect(stemDocsWord("monitors", "ru")).toBe("monitor");
    expect(stemDocsWord("monitors", "ko")).toBe("monitor");
    expect(stemDocsWord("monitors", "fa")).toBe("monitor");
    // A word of a script its language has no endings for is compared as written.
    expect(stemDocsWord("сайта", "en")).toBe("сайта");
    expect(stemDocsWord("웹사이트를", "ja")).toBe("웹사이트를");
    expect(stemDocsWord("監視", "ja")).toBe("監視");
    // A language the docs do not have reads as English.
    expect(stemDocsWord("monitoring", "xx")).toBe("monitor");
  });

  test("reads a page in its index's language: Norwegian's Website Monitor is named for the website", () => {
    expect(tokenizeForDocs("Nettsted-overvåking", "no")).toEqual([
      "nettsted",
      "overvak",
      "nettstedovervak",
    ]);
    // With English's endings, as every language was read: "nettst".
    expect(tokenizeForDocs("Nettsted-overvåking")).toEqual([
      "nettst",
      "overvak",
      "nettstedovervak",
    ]);
  });

  /*
   * Every docs language leaves a question's own words out of it, not out
   * of a page (#7875): "how", "I" and "my", in its own words.
   */
  test.each([
    ["fr", "Comment surveiller mon site web ?", ["surveill", "sit", "web"]],
    [
      "fr",
      "Comment puis-je surveiller mon site web ?",
      ["surveill", "sit", "web"],
    ],
    ["es", "¿Cómo puedo monitorear mi sitio web?", ["monitor", "siti", "web"]],
    ["it", "Come posso monitorare il mio sito web?", ["monitor", "sit", "web"]],
    ["pt", "Como faço para monitorar meu site?", ["monitor", "sit"]],
    ["nl", "Hoe monitor ik mijn website?", ["monitor", "websit"]],
    ["da", "Hvordan overvåger jeg mit websted?", ["overvag", "websted"]],
    ["no", "Hvordan overvåker jeg nettstedet mitt?", ["overvak", "nettsted"]],
    ["sv", "Hur kan jag övervaka min webbplats?", ["overvak", "webbplat"]],
    ["ru", "Как я могу отслеживать свой сайт?", ["отслежив", "сайт"]],
    [
      "ko",
      "웹사이트를 모니터링하려면 어떻게 해야 하나요?",
      ["웹사이트", "모니터링"],
    ],
    // "निगरानी" (monitoring) ends in the long "ी" its plural shortens: read as "निगरानि" (#8335).
    ["hi", "मैं अपनी वेबसाइट की निगरानी कैसे करूँ?", ["वेबसाइट", "निगरानि"]],
    ["fa", "چطور وب‌سایتم را پایش کنم؟", ["وب", "سایت", "پایش"]],
    // As people type it: "چطوری", "میشه" and "یه" are spoken Persian's how, can and a (#8335).
    ["fa", "چطوری میشه یه مانیتور ساخت؟", ["مانیتور", "ساخت"]],
    ["fa", "چطور یک مانیتور بسازم؟", ["مانیتور", "ساخت"]],
    [
      "fa",
      "آیا می‌توانم مانیتورها را گروه‌بندی کنم؟",
      ["مانیتور", "گروه", "بندی"],
    ],
    // A particle on a Latin name, and a verb that drops its ㄹ (#8335).
    ["ko", "Slack을 어떻게 연결하나요?", ["slack", "연결"]],
    ["ko", "모니터를 어떻게 만드나요?", ["모니터", "만들"]],
    // A step's imperative and a question's infinitive meet (#8335).
    ["ru", "Как установить агент?", ["установ", "агент"]],
    ["hi", "मैं OneUptime का बैकअप कैसे लूँ?", ["oneuptim", "बैकअप"]],
    // Written without spaces: the question's words are cut out where they stand.
    ["zh-CN", "如何监控我的网站？", ["监控", "网站"]],
    ["zh-TW", "如何監控我的網站？", ["監控", "網站"]],
    [
      "ja",
      "ウェブサイトを監視するにはどうすればいいですか？",
      ["ウェ", "ェブ", "ブサ", "サイ", "イト", "監視"],
    ],
  ] as Array<[string, string, Array<string>]>)(
    '%s: "%s" asks about %p (#7875)',
    (language: string, question: string, words: Array<string>) => {
      expect(tokenizeQueryForDocs(question, language)).toEqual(words);
    },
  );

  test.each([
    ["fr", "Comment me joindre", ["comment", "joindr"]],
    ["nl", "Hoe ik bereikbaar ben", ["hoe", "ik", "bereikbar", "ben"]],
    ["ru", "Как со мной связаться", ["как", "со", "мной", "связ"]],
    ["zh-CN", "如何联系我", ["如何", "何联", "联系", "系我"]],
    ["fa", "راه‌های تماس با من", ["راه", "های", "تماس", "با", "من"]],
  ] as Array<[string, string, Array<string>]>)(
    '%s: a page keeps them: "%s" (How to Reach Me) is read word for word',
    (language: string, name: string, words: Array<string>) => {
      expect(tokenizeForDocs(name, language)).toEqual(words);
    },
  );

  test("reads a question that is only its language's question words as nothing", () => {
    expect(tokenizeQueryForDocs("Comment puis-je ?", "fr")).toEqual([]);
    expect(tokenizeQueryForDocs("如何", "zh-CN")).toEqual([]);
    expect(tokenizeQueryForDocs("どうすればいいですか", "ja")).toEqual([]);
    // Another language's question words are words: "hur" is not left out of a Danish question.
    expect(tokenizeQueryForDocs("hur", "da")).toEqual(["hur"]);
  });

  test("leaves a German question's own words out of it, not out of a page (#7799)", () => {
    // The German docs say "Sie" and "Ihre": a question's "ich" and "meine" are on few pages.
    expect(
      tokenizeQueryForDocs("Wie überwache ich meine Website?", "de"),
    ).toEqual(["uberwach", "websit"]);
    expect(
      tokenizeQueryForDocs(
        "Wie kann man einen Bereitschaftsplan für unser Team einrichten?",
        "de",
      ),
    ).toEqual(["bereitschaftsplan", "team", "einricht"]);
    // A page keeps them: "Wie ich erreichbar bin" is a page's name.
    expect(tokenizeForDocs("Wie ich erreichbar bin")).toEqual([
      "wie",
      "ich",
      "erreichbar",
      "bin",
    ]);
    // An English question reads as it did: "ist" is German's, IST a time zone.
    expect(tokenizeQueryForDocs("How do I monitor my website?")).toEqual([
      "monitor",
      "websit",
    ]);
    expect(tokenizeQueryForDocs("How do I show times in IST?", "en")).toEqual([
      "show",
      "tim",
      "ist",
    ]);
  });
});

describe("a question's own words, where words are not spaced (#7875)", () => {
  test("cuts Chinese question words out wherever they stand, longest first", () => {
    expect(cutQuestionWords("如何监控我的网站", "zh-CN")).toEqual([
      "监控",
      "网站",
    ]);
    // "我们的" (our) before "我" (I): nothing of it is left behind.
    expect(cutQuestionWords("如何设置我们的值班计划", "zh-CN")).toEqual([
      "设置",
      "值班计划",
    ]);
    expect(cutQuestionWords("我的網站在哪裡", "zh-TW")).toEqual(["網站在"]);
    expect(cutQuestionWords("如何", "zh-CN")).toEqual([]);
  });

  test("cuts a Japanese question's ending and its 'を' out", () => {
    expect(
      cutQuestionWords("ウェブサイトを監視するにはどうすればいいですか", "ja"),
    ).toEqual(["ウェブサイト", "監視"]);
    expect(
      cutQuestionWords("モニターを作成する方法を教えてください", "ja"),
    ).toEqual(["モニター", "作成する"]);
  });

  test("leaves a word of a spaced language, and another language's words, as they are", () => {
    expect(cutQuestionWords("website", "zh-CN")).toEqual(["website"]);
    // Chinese question words mean nothing to a Korean or English question.
    expect(cutQuestionWords("如何监控", "ko")).toEqual(["如何监控"]);
    expect(cutQuestionWords("如何监控", "en")).toEqual(["如何监控"]);
  });

  test("splits a question into the words it asks with, in order", () => {
    expect(
      splitQuestionWords("Hvordan overvåker jeg nettstedet mitt?", "no"),
    ).toEqual(["overvåker", "nettstedet"]);
    expect(splitQuestionWords("如何监控我的网站？", "zh-CN")).toEqual([
      "监控",
      "网站",
    ]);
    expect(splitQuestionWords("Wie ich erreichbar bin", "de")).toEqual([
      "erreichbar",
    ]);
  });
});

describe("DocsAIReader.compoundsOf (#7875)", () => {
  const index: AIDocsLanguageIndex = makeDocsIndex(
    [
      {
        page: "monitor/website-monitor",
        title: "Webbplatsövervakning",
        summary: "En webbplatsmonitor kontrollerar att en webbsida svarar.",
      },
      {
        page: "status-pages/index",
        title: "Statussidor",
        summary: "Berätta för kunderna vad som händer.",
      },
    ],
    "sv",
  );

  test("reads two of a question's words as the one word they make, in either order", () => {
    expect(DocsAIReader.compoundsOf(index, ["övervaka", "webbplats"])).toEqual([
      "webbplatsovervak",
    ]);
    expect(DocsAIReader.compoundsOf(index, ["webbplats", "övervakar"])).toEqual(
      ["webbplatsovervak"],
    );
    // With the "s" that links them: Norwegian "nettstedsmonitor".
    expect(
      DocsAIReader.compoundsOf(
        makeDocsIndex(
          [
            {
              page: "monitor/website-monitor",
              title: "Nettsted-overvåking",
              summary: "En nettstedsmonitor sjekker at en nettside svarer.",
            },
          ],
          "no",
        ),
        ["monitor", "nettstedet"],
      ),
    ).toEqual(["nettstedsmonitor"]);
  });

  test("reads a Dutch verb a question writes in two parts as the one word the docs write (#8335)", () => {
    const dutch: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "permissions/inviting-people",
          title: "Mensen uitnodigen",
          summary: "Nodig een collega uit voor je project.",
        },
        {
          page: "api-reference/api-reference",
          title: "API-referentie",
          summary: "Een API-sleutel aanmaken en een verzoek sturen.",
        },
      ],
      "nl",
    );

    // "nodig ... uit" is "uitnodigen", "maak ... aan" is "aanmaken".
    expect(
      DocsAIReader.compoundsOf(dutch, ["nodig", "collega", "uit"]),
    ).toEqual(["uitnodig"]);
    expect(
      DocsAIReader.compoundsOf(dutch, ["maak", "api-sleutel", "aan"]),
    ).toEqual(["aanmak"]);
    expect(
      DocsAIReader.rank(
        dutch,
        "Hoe nodig ik een collega uit voor mijn project?",
        2,
      ).map((hit: AIDocsSearchHit): string => {
        return hit.page;
      })[0],
    ).toBe("permissions/inviting-people");
  });

  test("reads only words the docs hold, and only where a language writes them as one", () => {
    expect(DocsAIReader.compoundsOf(index, ["övervaka", "status"])).toEqual([]);
    expect(DocsAIReader.compoundsOf(index, ["webbplats"])).toEqual([]);
    expect(
      DocsAIReader.compoundsOf(
        makeDocsIndex(
          [{ page: "monitor/website-monitor", title: "Websitemonitor" }],
          "en",
        ),
        ["monitor", "website"],
      ),
    ).toEqual([]);
  });

  test("makes Swedish's Website Monitor the first page for the question", () => {
    expect(
      DocsAIReader.rank(index, "Hur övervakar jag min webbplats?", 2).map(
        (hit: AIDocsSearchHit): string => {
          return hit.page;
        },
      )[0],
    ).toBe("monitor/website-monitor");
    expect(
      DocsAIReader.readQuestion(index, "Hur övervakar jag min webbplats?"),
    ).toContain("webbplatsovervak");
  });
});

describe("splitDocsSections", () => {
  test("splits at h2 and h3, never inside a fence, with each heading's anchor", () => {
    const sections: Array<{ title: string; anchor: string; body: string }> =
      splitDocsSections(
        [
          "Intro.",
          "## Add a `phone` number",
          "Steps.",
          "```",
          "## not a heading",
          "```",
          "### Verify it",
          "Code.",
        ].join("\n"),
      );

    expect(
      sections.map((section: { title: string; anchor: string }) => {
        return [section.title, section.anchor];
      }),
    ).toEqual([
      ["Add a phone number", "add-a-phone-number"],
      ["Verify it", "verify-it"],
    ]);
    expect(sections[0]!.body).toContain("## not a heading");
  });
});

describe("DocsAIReader.search", () => {
  test("finds the page that answers a question, with the section that does", async () => {
    const hits: Array<AIDocsSearchHit> = await reader.search({
      query: "How do I add a phone number for SMS notifications?",
      language: "en",
      limit: 5,
    });

    const hit: AIDocsSearchHit | undefined = hits
      .slice(0, 3)
      .find((candidate: AIDocsSearchHit): boolean => {
        return candidate.page === "notifications/notification-methods";
      });

    expect(hit).toBeDefined();
    expect(hit?.title).toBeTruthy();
    expect(hit?.group).toBeTruthy();
    expect(hit?.summary).toBeTruthy();
    expect(hit?.section?.anchor).toBeTruthy();
    expect(hit?.language).toBe("en");
  });

  test("keeps to the limit, and finds nothing for words no page has", async () => {
    expect(
      await reader.search({ query: "monitor", language: "en", limit: 3 }),
    ).toHaveLength(3);
    expect(
      await reader.search({ query: "zzqxv qqxzv", language: "en", limit: 3 }),
    ).toEqual([]);
    expect(
      await reader.search({ query: "how do I", language: "en", limit: 3 }),
    ).toEqual([]);
  });

  test("searches a translated page in its language, and says so", async () => {
    const hits: Array<AIDocsSearchHit> = await reader.search({
      query: "Statusseite erstellen",
      language: "de",
      limit: 6,
    });

    const translated: AIDocsSearchHit | undefined = hits.find(
      (hit: AIDocsSearchHit): boolean => {
        return hit.language === "de";
      },
    );
    expect(translated).toBeDefined();
  });

  test("reads a language the docs do not have as English", async () => {
    const hits: Array<AIDocsSearchHit> = await reader.search({
      query: "status page",
      language: "tlh",
      limit: 2,
    });
    expect(hits[0]?.language).toBe("en");
  });

  test.each(NAMED_FOR_THE_QUESTION)(
    '%s: "%s" finds the page named for what it asks about first (#7799, #7875)',
    async (language: string, question: string, page: string) => {
      const hits: Array<AIDocsSearchHit> = await reader.search({
        query: question,
        language,
        limit: 6,
      });

      expect({
        question,
        first: hits.slice(0, 3).map((hit: AIDocsSearchHit): string => {
          return hit.page;
        })[0],
      }).toEqual({ question, first: page });
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("DocsAIReader.rank", () => {
  test("does not cut a page's name for the words of the question it does not say (#7799)", () => {
    /*
     * "Wie richte ich einen Bereitschaftsplan ein?" in small: the page
     * named for schedules never says "set up", and a migration page says
     * every word of the question in passing.
     */
    const index: AIDocsLanguageIndex = makeDocsIndex([
      {
        page: "on-call/schedules",
        title: "Schedules",
        summary: "A schedule says who is on call, and when.",
        sections: [
          { title: "Layers", text: "Each layer of a schedule takes turns." },
        ],
      },
      {
        page: "moving-to-oneuptime/pagerduty",
        title: "Moving from PagerDuty",
        summary: "Bring your PagerDuty account over.",
        sections: [
          {
            title: "Import your account",
            text: "Set up the import, and your schedules come over too.",
          },
        ],
      },
      {
        page: "status-pages/index",
        title: "Status Pages",
        summary: "Tell customers what is happening.",
        sections: [{ title: "Branding", text: "Add your logo and colors." }],
      },
      {
        page: "incidents/index",
        title: "Incidents",
        summary: "Declare and resolve incidents.",
        sections: [
          { title: "Severity", text: "Each incident has a severity." },
        ],
      },
      {
        page: "monitor/index",
        title: "Monitors",
        summary: "Check that things work.",
        sections: [{ title: "Probes", text: "Probes run the checks." }],
      },
      {
        page: "workflows/index",
        title: "Workflows",
        summary: "Automate what happens next.",
        sections: [{ title: "Triggers", text: "A trigger starts a workflow." }],
      },
    ]);

    expect(
      DocsAIReader.rank(index, "How do I set up a schedule?", 2).map(
        (hit: AIDocsSearchHit): string => {
          return hit.page;
        },
      ),
    ).toEqual(["on-call/schedules", "moving-to-oneuptime/pagerduty"]);
  });
});

describe("DocsAIReader.readPage", () => {
  test("reads a page as the docs draw it: its nav title, without its title line", async () => {
    const page: AIDocsPage | null = await reader.readPage({
      page: "notifications/notification-methods",
      language: "en",
    });
    const source: string = fs.readFileSync(
      path.join(CONTENT, "en/notifications/notification-methods.md"),
      "utf8",
    );

    expect(page).not.toBeNull();
    expect(page!.language).toBe("en");
    expect(page!.markdown.startsWith(source.split("\n")[0]!)).toBe(false);
    expect(page!.sections.length).toBeGreaterThan(0);
    expect(page!.title).toBeTruthy();
  });

  test("reads the person's language where the page is translated", async () => {
    expect(fs.existsSync(path.join(CONTENT, "de/status-pages/index.md"))).toBe(
      true,
    );

    const page: AIDocsPage | null = await reader.readPage({
      page: "/docs/de/status-pages/index",
      language: "de",
    });
    expect(page?.language).toBe("de");
    expect(page?.page).toBe("status-pages/index");
  });

  test("fills in the docs' placeholders, as the page does", async () => {
    const page: AIDocsPage | null = await reader.readPage({
      page: "probe/custom-probe",
      language: "en",
    });
    expect(page?.markdown).not.toContain("{{IP_WHITELIST}}");
  });

  test("is null for a page the nav does not list, or no page at all", async () => {
    expect(
      await reader.readPage({ page: "made/up-page", language: "en" }),
    ).toBeNull();
    expect(
      await reader.readPage({ page: "../../../package", language: "en" }),
    ).toBeNull();
  });
});

describe("the Docs feature set", () => {
  test("hands Ask AI this reader when it starts", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../FeatureSet/Docs/Index.ts"),
      "utf8",
    );
    expect(index).toContain("AIDocsLibrary.setReader(new DocsAIReader());");
  });
});
