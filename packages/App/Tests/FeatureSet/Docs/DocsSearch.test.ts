import DocsSearch, {
  DOCS_SEARCH_MAX_LIMIT,
  DOCS_SEARCH_QUERY_MAX_LENGTH,
  DocsQueryAlternative,
  DocsQueryWord,
  DocsSearchAnswer,
  DocsSearchResult,
} from "../../../FeatureSet/Docs/Utils/DocsSearch";
import { AIDocsLanguageIndex } from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import { MadePage, makeDocsIndex } from "./DocsSearchHelpers";
import { describe, expect, it } from "@jest/globals";

/*
 * DOCS SEARCH'S RANKING (issue #6822), on a small index whose every word is
 * known, so each rule shows on its own:
 *
 *   - a word with a wrong letter or two, the start of a word being typed,
 *     a reader's other word (synonyms) and a hyphenated word all find the
 *     docs' word;
 *   - every word typed must be found, and a word nothing in the docs is
 *     like is set aside;
 *   - a page's title counts most, then a section's heading, then its text;
 *     a phrase typed word for word lands on its section; a guide goes above
 *     a reference page for the same words; one page offers at most three
 *     results;
 *   - each result says where it is, opens the page in the reader's language
 *     at the section, and carries a line of its text with the words to mark.
 *
 * DocsSearchRealDocs.test.ts holds the same to the real docs, in several
 * languages.
 */

const INDEX: AIDocsLanguageIndex = makeDocsIndex([
  {
    page: "monitor/website-monitor",
    title: "Website Monitor",
    group: "Monitor",
    summary: "A website monitor checks that a website answers.",
    sections: [
      {
        title: "SSL certificates",
        text: "The monitor reads the certificate and warns before it expires.",
      },
      {
        title: "Criteria",
        text: "Criteria decide when the site counts as down and an incident opens.",
      },
    ],
  },
  {
    page: "introduction/quickstart",
    title: "Quickstart",
    group: "Introduction",
    summary: "From a new account to a working setup.",
    isGuide: true,
    sections: [
      {
        title: "Publish a status page",
        text: "Create the status page, and add your monitor to it.",
      },
    ],
  },
  {
    page: "basics/status-pages",
    title: "Status Pages",
    group: "Status Pages",
    summary: "A status page tells customers what is happening.",
    sections: [
      {
        title: "Publish a status page",
        text: "Create the status page, and add your monitor to it.",
      },
    ],
  },
  {
    page: "on-call/escalation-rules",
    title: "Escalation Rules",
    group: "On Call",
    summary: "An on-call policy pages people in levels.",
    sections: [
      {
        title: "Adding an escalation rule",
        text: "Each escalation rule pages people, then waits for an answer.",
      },
    ],
  },
  {
    page: "on-call/index",
    title: "On-Call Overview",
    group: "On Call",
    summary: "On-call is how a person gets onto a problem at any hour.",
    sections: [
      {
        title: "Set up on-call",
        text: "Create an on-call policy and an on-call schedule.",
      },
    ],
  },
  {
    page: "telemetry/kubernetes-agent",
    title: "Kubernetes Agent",
    group: "Infrastructure Agents",
    summary: "The Kubernetes agent is a Helm chart for your cluster.",
    sections: [
      {
        title: "Install the agent",
        text: "Install the Kubernetes agent with Helm, then watch the installation finish.",
      },
      {
        title: "Kubernetes events",
        text: "The Kubernetes agent sends the cluster's events.",
      },
    ],
  },
  {
    page: "runbooks/authoring",
    title: "Authoring a Runbook",
    group: "Runbooks",
    summary: "A runbook is steps your team can run.",
    sections: [
      {
        title: "kubectl",
        text: "Run kubectl commands against a cluster.",
      },
    ],
  },
  {
    page: "introduction/your-account",
    title: "Your Account",
    group: "Introduction",
    summary: "Your account is how OneUptime knows you.",
    sections: [
      {
        title: "Turn on two-factor authentication",
        text: "Two-factor authentication asks for a code from an app.",
      },
    ],
  },
  {
    page: "incidents/index",
    title: "Incidents Overview",
    group: "Incidents",
    summary: "An incident is the record your team works from.",
    sections: [
      {
        title: "Declare an incident",
        text: "Declare an incident when something breaks.",
      },
    ],
  },
  {
    page: "notifications/notification-settings",
    title: "Notification Settings",
    group: "Notifications",
    summary: "Notification settings decide which updates reach you.",
    sections: [
      { title: "Email notification", text: "An email notification." },
      { title: "SMS notification", text: "An SMS notification." },
      { title: "Push notification", text: "A push notification." },
      { title: "Call notification", text: "A call notification." },
      { title: "Slack notification", text: "A Slack notification." },
    ],
  },
  {
    // Says the phrase's words over and over, but never as the phrase.
    page: "monitor/api-monitor",
    title: "API Monitor",
    group: "Monitor",
    summary: "An API monitor calls an endpoint.",
    sections: [
      {
        title: "Status codes",
        text: "Site down. Site down. Site down. Counts as counts as counts as.",
      },
    ],
  },
  // Pages that mention Kubernetes in passing: it is a word many pages use.
  {
    page: "telemetry/hosts",
    title: "Hosts",
    summary: "Add hosts, Docker machines and Kubernetes nodes.",
  },
  {
    page: "monitor/docker-monitor",
    title: "Docker Monitor",
    summary: "Docker and Kubernetes containers.",
  },
  {
    page: "telemetry/openshift",
    title: "OpenShift",
    summary: "OpenShift is Kubernetes for the enterprise.",
  },
  {
    page: "probe/custom-probe",
    title: "Custom Probes",
    summary: "Probes run on Kubernetes or on a virtual machine.",
  },
  {
    page: "introduction/glossary",
    title: "Glossary",
    group: "Introduction",
    summary: "Every word OneUptime uses.",
    sections: [
      {
        title: "Service",
        anchor: "service",
        text: "An application or microservice you run.",
      },
      {
        title: "Service Catalog (Service)",
        anchor: "service",
        text: "An application or microservice you run.",
        isOtherName: true,
      },
    ],
  },
]);

const urls: (answer: DocsSearchAnswer) => Array<string> = (
  answer: DocsSearchAnswer,
): Array<string> => {
  return answer.results.map((result: DocsSearchResult): string => {
    return result.url;
  });
};

const alternativeTerms: (word: DocsQueryWord) => Array<string> = (
  word: DocsQueryWord,
): Array<string> => {
  return word.alternatives.map((alternative: DocsQueryAlternative): string => {
    return alternative.terms.join(" ");
  });
};

// The pages a search found, each once, in the order found.
const pagesOf: (answer: DocsSearchAnswer) => Array<string> = (
  answer: DocsSearchAnswer,
): Array<string> => {
  return Array.from(
    new Set<string>(
      urls(answer).map((url: string): string => {
        return url.split("#")[0]!;
      }),
    ),
  );
};

const typedWords: (
  index: AIDocsLanguageIndex,
  query: string,
) => Array<string> = (
  index: AIDocsLanguageIndex,
  query: string,
): Array<string> => {
  return DocsSearch.readQuery(index, query).map(
    (word: DocsQueryWord): string => {
      return word.typed;
    },
  );
};

/*
 * German pages as the German docs write them: the reader is "Sie", so
 * "ich" and "meine" are on the page named with them, not on the page a
 * question with them asks about (#7874).
 */
const GERMAN_PAGES: Array<MadePage> = [
  {
    page: "monitor/website-monitor",
    title: "Website-Überwachung",
    summary:
      "Überwachen Sie Ihre Website, und eine Warnung kommt, wenn sie ausfällt.",
  },
  {
    page: "notifications/on-call-rules",
    title: "Wie ich erreichbar bin",
    summary: "Wie ich erreichbar bin, wenn meine Bereitschaft beginnt.",
  },
];

describe("docs search finds the docs' word", () => {
  it("for a word with a wrong letter: escalaton is escalation", () => {
    const answer: DocsSearchAnswer = DocsSearch.rank(INDEX, "escalaton ");

    expect(urls(answer)[0]).toBe("/docs/en/on-call/escalation-rules");
    expect(answer.words).toContain("escalation");
  });

  it("for a word with two wrong letters, when it is long enough to have them", () => {
    expect(urls(DocsSearch.rank(INDEX, "esclaton "))[0]).toBe(
      "/docs/en/on-call/escalation-rules",
    );
    // Three letters forgive nothing: "smz" is not "sms".
    expect(DocsSearch.rank(INDEX, "smz ").results).toEqual([]);
  });

  it("for the start of a word being typed, the most used word it starts first: kube is Kubernetes", () => {
    // kubectl is the rarer word, so it weighs more; Kubernetes is on five pages, so it is what kube means.
    const answer: DocsSearchAnswer = DocsSearch.rank(INDEX, "kube");

    expect(urls(answer)[0]).toBe("/docs/en/telemetry/kubernetes-agent");
    expect(urls(answer)).toContain("/docs/en/runbooks/authoring#kubectl");
    expect(
      urls(answer).indexOf("/docs/en/runbooks/authoring#kubectl"),
    ).toBeGreaterThan(
      urls(answer).indexOf("/docs/en/telemetry/kubernetes-agent"),
    );
  });

  it("for a reader's other word: pager is on-call, outage an incident, 2fa two-factor", () => {
    for (const result of DocsSearch.rank(INDEX, "pager").results.slice(0, 2)) {
      expect(result.url).toMatch(/on-call/);
    }

    expect(urls(DocsSearch.rank(INDEX, "outage"))[0]).toMatch(
      /^\/docs\/en\/incidents\/index/,
    );
    expect(urls(DocsSearch.rank(INDEX, "2fa"))[0]).toBe(
      "/docs/en/introduction/your-account#turn-on-two-factor-authentication",
    );
  });

  it("for a hyphenated word, whole or written apart", () => {
    const word: DocsQueryWord = DocsSearch.readQuery(INDEX, "on-call ")[0]!;

    expect(alternativeTerms(word)).toEqual(["oncall", "call"]);
    expect(word.alternatives[0]!.weight).toBe(1);
    expect(word.alternatives[1]!.weight).toBeLessThan(1);
    expect(urls(DocsSearch.rank(INDEX, "oncall "))[0]).toMatch(/on-call/);
    expect(urls(DocsSearch.rank(INDEX, "two factor "))[0]).toBe(
      "/docs/en/introduction/your-account#turn-on-two-factor-authentication",
    );
  });

  it("for a Glossary term's other name: Service Catalog opens the Service term", () => {
    const answer: DocsSearchAnswer = DocsSearch.rank(INDEX, "service catalog");

    expect(answer.results[0]).toEqual(
      expect.objectContaining({
        title: "Service Catalog (Service)",
        url: "/docs/en/introduction/glossary#service",
        isSection: true,
      }),
    );
  });
});

describe("reading what was typed", () => {
  it("finds the last word by its start only while it is being typed", () => {
    expect(
      alternativeTerms(DocsSearch.readQuery(INDEX, "install ")[0]!),
    ).toEqual(["install"]);
    expect(
      alternativeTerms(DocsSearch.readQuery(INDEX, "install")[0]!),
    ).toEqual(expect.arrayContaining(["install", "installation"]));
  });

  it("finds a known word by its start for less than the word itself", () => {
    const word: DocsQueryWord = DocsSearch.readQuery(INDEX, "install")[0]!;
    const weightOf: (term: string) => number = (term: string): number => {
      return word.alternatives.find((alternative: DocsQueryAlternative) => {
        return alternative.terms.join(" ") === term;
      })!.weight;
    };

    expect(weightOf("installation")).toBeLessThan(weightOf("install"));
  });

  it("looks for typos only in a word no page holds", () => {
    // "rule" is a docs word: it is read as itself, not as anything near it.
    const rule: DocsQueryWord = DocsSearch.readQuery(INDEX, "rule ")[0]!;

    expect(rule.alternatives).toHaveLength(1);
    expect(rule.alternatives[0]!.weight).toBe(1);
    // "escalaton" is not: it is read as the words it nearly spells.
    expect(
      DocsSearch.readQuery(INDEX, "escalaton ")[0]!.alternatives.length,
    ).toBeGreaterThan(0);
  });

  it("sets aside a word nothing in the docs is like, and a word every question has", () => {
    expect(DocsSearch.readQuery(INDEX, "website zzqxv ")).toHaveLength(1);
    expect(DocsSearch.readQuery(INDEX, "how do I ")).toEqual([]);
    expect(DocsSearch.rank(INDEX, "how do I").results).toEqual([]);
    expect(urls(DocsSearch.rank(INDEX, "website zzqxv "))[0]).toBe(
      "/docs/en/monitor/website-monitor",
    );
  });

  it("leaves out the words a question is phrased with in the index's language, as Ask AI does (#7874)", () => {
    const german: AIDocsLanguageIndex = makeDocsIndex(GERMAN_PAGES, "de");

    expect(typedWords(german, "Wie überwache ich meine Website?")).toEqual([
      "überwache",
      "website",
    ]);
    expect(
      urls(DocsSearch.rank(german, "Wie überwache ich meine Website?"))[0],
    ).toBe("/docs/de/monitor/website-monitor");
    // Only what was typed leaves them out: a page named with them is found by its name.
    expect(typedWords(german, "Wie ich erreichbar bin")).toEqual([
      "erreichbar",
    ]);
    expect(urls(DocsSearch.rank(german, "Wie ich erreichbar bin"))[0]).toBe(
      "/docs/de/notifications/on-call-rules",
    );
  });

  it("leaves out only the index language's question words: in English, German ones are words", () => {
    const english: AIDocsLanguageIndex = makeDocsIndex(GERMAN_PAGES, "en");

    expect(typedWords(english, "Wie ich erreichbar bin")).toEqual([
      "wie",
      "ich",
      "erreichbar",
      "bin",
    ]);
  });

  it("reads question words typed with nothing else, which the index holds, and knows the word before one is done", () => {
    const german: AIDocsLanguageIndex = makeDocsIndex(GERMAN_PAGES, "de");

    // "ein" while "Einstellungen" is typed, or a page's name as it is typed.
    expect(typedWords(german, "ein")).toEqual(["ein"]);
    expect(DocsSearch.rank(german, "ein").results.length).toBeGreaterThan(0);
    expect(typedWords(german, "Wie ich ")).toEqual(["wie", "ich"]);
    expect(urls(DocsSearch.rank(german, "Wie ich "))[0]).toBe(
      "/docs/de/notifications/on-call-rules",
    );
    // "Website" has a space after it: not the word being typed, so not read by its start.
    expect(
      alternativeTerms(DocsSearch.readQuery(german, "Website ich")[0]!),
    ).toEqual(["websit"]);
  });

  it("reads Chinese and Japanese in pairs of characters", () => {
    const index: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "status-pages/index",
          title: "ステータスページ",
          summary: "ステータスページで顧客に知らせます。",
        },
        {
          page: "on-call/index",
          title: "オンコール",
          summary: "オンコール担当者を呼び出します。",
        },
      ],
      "ja",
    );

    expect(
      DocsSearch.readQuery(index, "ステータス").map((word: DocsQueryWord) => {
        return word.typed;
      }),
    ).toEqual(["ステ", "テー", "ータ", "タス"]);
    expect(urls(DocsSearch.rank(index, "ステータス"))[0]).toBe(
      "/docs/ja/status-pages/index",
    );
    // Japanese "pager" is オンコール.
    expect(urls(DocsSearch.rank(index, "pager"))[0]).toBe(
      "/docs/ja/on-call/index",
    );
  });
});

/*
 * Every docs language, as Ask AI reads it (#7875): the question's own
 * words left out, word forms read without their endings, and a compound
 * found by the words it is made of.
 */
describe("reading what was typed, in every docs language", () => {
  it("cuts a Chinese question's own words out of what was typed", () => {
    const index: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "monitor/website-monitor",
          title: "网站监控",
          summary: "网站监控检查网页是否响应。",
        },
        {
          page: "notifications/on-call-rules",
          title: "如何联系我",
          summary: "通知规则决定在什么时候用什么方式联系您。",
        },
      ],
      "zh-CN",
    );

    expect(typedWords(index, "如何监控我的网站？")).toEqual(["监控", "网站"]);
    expect(urls(DocsSearch.rank(index, "如何监控我的网站？"))[0]).toBe(
      "/docs/zh-CN/monitor/website-monitor",
    );
    // Typed with nothing else, they are read: "如何" finds the page named with it.
    expect(typedWords(index, "如何")).toEqual(["如何"]);
    expect(urls(DocsSearch.rank(index, "如何联系我"))[0]).toBe(
      "/docs/zh-CN/notifications/on-call-rules",
    );
  });

  it("reads a word in its index's language: Norwegian 'nettstedet' is the name's 'Nettsted'", () => {
    const index: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "monitor/website-monitor",
          title: "Nettsted-overvåking",
          summary: "En nettstedsmonitor sjekker at en nettside svarer.",
        },
        {
          page: "guides/website-down",
          title: "Få beskjed når nettstedet ditt går ned",
          summary: "Følg guiden for å bli varslet.",
        },
        {
          page: "status-pages/index",
          title: "Statussider",
          summary: "Fortell kundene hva som skjer.",
        },
      ],
      "no",
    );

    expect(
      typedWords(index, "Hvordan overvåker jeg nettstedet mitt? "),
    ).toEqual(["overvåker", "nettstedet"]);
    expect(
      urls(
        DocsSearch.rank(index, "Hvordan overvåker jeg nettstedet mitt? "),
      )[0],
    ).toBe("/docs/no/monitor/website-monitor");
  });

  it("finds two typed words in the one word they make, in Swedish", () => {
    const index: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "monitor/website-monitor",
          title: "Webbplatsövervakning",
          summary: "En monitor kontrollerar att en webbsida svarar.",
        },
        {
          page: "guides/website-down",
          title: "Få veta när din webbplats går ner",
          summary: "Följ guiden.",
        },
        {
          page: "monitor/index",
          title: "Övervakning",
          summary: "Monitorer kontrollerar att saker fungerar.",
        },
      ],
      "sv",
    );
    const answer: DocsSearchAnswer = DocsSearch.rank(
      index,
      "övervaka webbplats ",
    );

    expect(urls(answer)[0]).toBe("/docs/sv/monitor/website-monitor");
    expect(
      alternativeTerms(DocsSearch.readQuery(index, "övervaka webbplats ")[0]!),
    ).toContain("webbplatsovervak");
  });

  it("opens the page whose name was typed, word for word, before one whose name says it and more", () => {
    const index: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "monitor/profiles-monitor",
          title: "Монитор профилей",
          summary: "Монитор профилей следит за профилями и профилем.",
        },
        {
          page: "telemetry/profiles",
          title: "Профили",
          summary: "Профили показывают, где тратится время.",
        },
      ],
      "ru",
    );

    // Both names hold "профил", read without its ending.
    expect(
      alternativeTerms(DocsSearch.readQuery(index, "Профили ")[0]!),
    ).toEqual(["профил"]);
    expect(urls(DocsSearch.rank(index, "Профили "))[0]).toBe(
      "/docs/ru/telemetry/profiles",
    );
    expect(urls(DocsSearch.rank(index, "Монитор профилей "))[0]).toBe(
      "/docs/ru/monitor/profiles-monitor",
    );
  });

  it("reads a phrase a section says word for word whole, its question words too", () => {
    const index: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "probe/custom-probe",
          title: "Sonde personnalisée",
          summary: "Une sonde dans votre réseau.",
          sections: [
            {
              title: "Ce sur quoi la sonde écoute",
              text: "Elle écoute sur le réseau de l'hôte ou si le conteneur le permet.",
            },
            {
              title: "Le réseau de l'hôte",
              text: "Le réseau et l'hôte de la sonde.",
            },
          ],
        },
      ],
      "fr",
    );

    expect(
      DocsSearch.isPhraseOfTheDocs(index, "le réseau de l'hôte ou si "),
    ).toBe(true);
    expect(typedWords(index, "le réseau de l'hôte ou si ")).toEqual(
      expect.arrayContaining(["le", "de", "ou", "si"]),
    );
    expect(urls(DocsSearch.rank(index, "le réseau de l'hôte ou si "))[0]).toBe(
      "/docs/fr/probe/custom-probe#ce-sur-quoi-la-sonde-écoute",
    );
    // A question no section says is read without its question words.
    expect(
      DocsSearch.isPhraseOfTheDocs(index, "Comment écoute la sonde ?"),
    ).toBe(false);
    expect(typedWords(index, "Comment écoute la sonde ?")).toEqual([
      "écoute",
      "sonde",
    ]);
    // Fewer than three words is not a phrase.
    expect(DocsSearch.isPhraseOfTheDocs(index, "le réseau")).toBe(false);
  });
});

describe("ranking", () => {
  it("needs every word typed: a section that holds them all beats a page that holds one", () => {
    // Four other pages say Kubernetes; only the agent's page says Helm too.
    const answer: DocsSearchAnswer = DocsSearch.rank(INDEX, "kubernetes helm ");

    expect(urls(answer).length).toBeGreaterThan(0);
    for (const url of urls(answer)) {
      expect(url).toMatch(/^\/docs\/en\/telemetry\/kubernetes-agent/);
    }
  });

  it("offers the pages with most of the words when none has them all", () => {
    const answer: DocsSearchAnswer = DocsSearch.rank(
      INDEX,
      "escalation kubernetes ",
    );

    expect(urls(answer)).toEqual(
      expect.arrayContaining([
        "/docs/en/on-call/escalation-rules",
        "/docs/en/telemetry/kubernetes-agent",
      ]),
    );
  });

  it("puts a page named for the words above a page that only says them", () => {
    expect(urls(DocsSearch.rank(INDEX, "escalation rules "))[0]).toBe(
      "/docs/en/on-call/escalation-rules",
    );
  });

  it("lands a phrase typed word for word on the section it is from", () => {
    // API Monitor's Status codes section says every one of these words more often, never in this order.
    expect(
      urls(DocsSearch.rank(INDEX, "when the site counts as down "))[0],
    ).toBe("/docs/en/monitor/website-monitor#criteria");
    // As it is being typed, its last word half done.
    expect(urls(DocsSearch.rank(INDEX, "when the site counts as do"))[0]).toBe(
      "/docs/en/monitor/website-monitor#criteria",
    );
  });

  it("puts a guide above a reference page for the same words", () => {
    const answer: Array<string> = urls(
      DocsSearch.rank(INDEX, "publish a status page "),
    );

    expect(
      answer.indexOf("/docs/en/introduction/quickstart#publish-a-status-page"),
    ).toBeLessThan(
      answer.indexOf("/docs/en/basics/status-pages#publish-a-status-page"),
    );
    expect(
      DocsSearch.rank(INDEX, "publish a status page ").results[0]!.isGuide,
    ).toBe(true);
  });

  it("offers at most three results from one page", () => {
    const answer: Array<string> = urls(DocsSearch.rank(INDEX, "notification "));

    expect(
      answer.filter((url: string): boolean => {
        return url.startsWith("/docs/en/notifications/notification-settings");
      }),
    ).toHaveLength(3);
  });

  it("keeps to the limit asked, never above thirty, and cuts what was typed at a hundred characters", () => {
    expect(
      DocsSearch.rank(INDEX, "notification monitor", 1).results,
    ).toHaveLength(1);
    expect(DOCS_SEARCH_MAX_LIMIT).toBe(30);
    expect(DOCS_SEARCH_QUERY_MAX_LENGTH).toBe(100);
    expect(
      DocsSearch.rank(INDEX, `${"x".repeat(150)} monitor`).query.length,
    ).toBeLessThanOrEqual(100);
    expect(
      DocsSearch.rank(INDEX, "a", 1000).results.length,
    ).toBeLessThanOrEqual(DOCS_SEARCH_MAX_LIMIT);
  });
});

/*
 * A question's verb is often a word the page that answers it never says
 * (#8334): Website Monitor's Russian page says "мониторинг" and "сайт",
 * not "отслеживать" (track). Every typed word had to be in a result, so
 * "Как отслеживать мой сайт?" found the pages that say both in passing,
 * and never Website Monitor. A question now also gets the pages named
 * for half its words or more, beside the results that hold all of them.
 * Keywords still need every word.
 */
const RUSSIAN_PAGES: Array<MadePage> = [
  {
    page: "monitor/website-monitor",
    title: "Мониторинг веб-сайта",
    summary: "Монитор веб-сайта проверяет, что сайт отвечает.",
  },
  {
    page: "introduction/getting-started",
    title: "Начало работы",
    summary: "С чего начать в первый же день.",
    sections: [
      {
        title: "Первые шаги",
        text: "Начните отслеживать сайт и сервер.",
      },
    ],
  },
  {
    page: "monitor/create-monitor",
    title: "Создание монитора",
    summary: "Монитор проверяет то, что вам важно.",
    sections: [
      {
        title: "Что проверить",
        text: "Монитор помогает отслеживать сайт, сервер или API.",
      },
    ],
  },
  {
    page: "telemetry/exceptions",
    title: "Исключения",
    summary: "Исключения в коде видны рядом с логами.",
  },
];

// The Spanish on-call schedules, named for "programación" and "guardia", not for "configurar".
const SPANISH_PAGES: Array<MadePage> = [
  {
    page: "on-call/schedules",
    title: "Programaciones de guardia",
    summary: "Una programación de guardia dice quién está de guardia y cuándo.",
  },
  {
    page: "introduction/getting-started",
    title: "Primeros pasos",
    summary:
      "Configure la guardia: una política, una programación y quién responde.",
  },
  {
    page: "incidents/settings",
    title: "Ajustes de incidentes",
    summary: "Configurar la guardia de un incidente según su programación.",
  },
  {
    page: "monitor/website-monitor",
    title: "Monitor de sitio web",
    summary: "Un monitor comprueba que un sitio web responde.",
  },
];

const CHINESE_PAGES: Array<MadePage> = [
  {
    page: "on-call/schedules",
    title: "值班计划",
    summary: "值班计划决定谁在什么时候值班。",
  },
  {
    page: "on-call/index",
    title: "值班概览",
    summary: "设置值班：先设置策略，再设置计划。",
  },
  {
    page: "introduction/quickstart",
    title: "快速开始",
    summary: "设置监视器，设置值班，设置计划。",
  },
];

describe("a question (#8334)", () => {
  it("is what has a question mark or a word its language asks with, not keywords", () => {
    const russian: AIDocsLanguageIndex = makeDocsIndex(RUSSIAN_PAGES, "ru");
    const german: AIDocsLanguageIndex = makeDocsIndex(GERMAN_PAGES, "de");
    const spanish: AIDocsLanguageIndex = makeDocsIndex(SPANISH_PAGES, "es");
    const chinese: AIDocsLanguageIndex = makeDocsIndex(CHINESE_PAGES, "zh-CN");

    // A question mark, wherever it stands, and Spanish's opening one.
    expect(DocsSearch.isQuestion(russian, "Как отслеживать мой сайт?")).toBe(
      true,
    );
    expect(DocsSearch.isQuestion(russian, "отслеживать сайт?")).toBe(true);
    expect(DocsSearch.isQuestion(spanish, "¿configurar guardia")).toBe(true);
    expect(DocsSearch.isQuestion(chinese, "设置值班计划？")).toBe(true);
    // A word it asks with, without a question mark.
    expect(DocsSearch.isQuestion(russian, "как отслеживать сайт")).toBe(true);
    expect(DocsSearch.isQuestion(russian, "отслеживать мой сайт")).toBe(true);
    expect(
      DocsSearch.isQuestion(german, "Wie überwache ich meine Website"),
    ).toBe(true);
    expect(DocsSearch.isQuestion(INDEX, "how do I install the agent")).toBe(
      true,
    );
    // Written without spaces: found wherever it stands.
    expect(DocsSearch.isQuestion(chinese, "如何设置值班计划")).toBe(true);
    // Keywords, articles and prepositions too, are not a question.
    expect(DocsSearch.isQuestion(russian, "отслеживать сайт")).toBe(false);
    expect(DocsSearch.isQuestion(german, "Website überwachen")).toBe(false);
    expect(DocsSearch.isQuestion(INDEX, "kubernetes helm")).toBe(false);
    expect(DocsSearch.isQuestion(INDEX, "create a monitor for the site")).toBe(
      false,
    );
    expect(DocsSearch.isQuestion(INDEX, "disk i/o latency")).toBe(false);
    expect(DocsSearch.isQuestion(chinese, "设置值班计划")).toBe(false);
    // Another language's question words are words: German "wie" in the English docs.
    expect(DocsSearch.isQuestion(INDEX, "Wie ich erreichbar bin")).toBe(false);
  });

  it("is not a phrase the docs say word for word, though it has a word that asks", () => {
    // Website Monitor's Criteria section says it, "when" and all.
    expect(DocsSearch.isQuestion(INDEX, "when the site counts as down ")).toBe(
      false,
    );
    expect(
      urls(DocsSearch.rank(INDEX, "when the site counts as down "))[0],
    ).toBe("/docs/en/monitor/website-monitor#criteria");
  });

  it("finds the page named for what it asks about, though the page never says its verb", () => {
    const russian: AIDocsLanguageIndex = makeDocsIndex(RUSSIAN_PAGES, "ru");

    // "отслеживать" (track) is on the two pages that say "сайт" in passing, not on Website Monitor.
    expect(typedWords(russian, "Как отслеживать мой сайт?")).toEqual([
      "отслеживать",
      "сайт",
    ]);
    expect(urls(DocsSearch.rank(russian, "Как отслеживать мой сайт?"))[0]).toBe(
      "/docs/ru/monitor/website-monitor",
    );
    // The pages that hold every word are still offered, after it.
    expect(
      pagesOf(DocsSearch.rank(russian, "Как отслеживать мой сайт?")),
    ).toEqual([
      "/docs/ru/monitor/website-monitor",
      "/docs/ru/introduction/getting-started",
      "/docs/ru/monitor/create-monitor",
    ]);
    // Without its question mark, "как" and "мой" ask it.
    expect(urls(DocsSearch.rank(russian, "как отслеживать мой сайт "))[0]).toBe(
      "/docs/ru/monitor/website-monitor",
    );
  });

  it("finds it in other languages too: Spanish and Chinese on-call schedules", () => {
    const spanish: AIDocsLanguageIndex = makeDocsIndex(SPANISH_PAGES, "es");
    const chinese: AIDocsLanguageIndex = makeDocsIndex(CHINESE_PAGES, "zh-CN");

    // "configuro" is on the pages that say "configure" and "configurar"; the schedules' page says neither.
    expect(
      urls(
        DocsSearch.rank(
          spanish,
          "¿Cómo configuro una programación de guardia?",
        ),
      )[0],
    ).toBe("/docs/es/on-call/schedules");
    // "设置" (set up) is on every page but the one named "值班计划".
    expect(urls(DocsSearch.rank(chinese, "如何设置值班计划？"))[0]).toBe(
      "/docs/zh-CN/on-call/schedules",
    );
  });

  it("keeps keywords as strict as before: every word typed, in every result", () => {
    const russian: AIDocsLanguageIndex = makeDocsIndex(RUSSIAN_PAGES, "ru");
    const spanish: AIDocsLanguageIndex = makeDocsIndex(SPANISH_PAGES, "es");

    // The same words, typed as keywords: only the pages that hold both.
    expect(
      pagesOf(DocsSearch.rank(russian, "отслеживать сайт ")).sort(),
    ).toEqual([
      "/docs/ru/introduction/getting-started",
      "/docs/ru/monitor/create-monitor",
    ]);
    expect(
      pagesOf(DocsSearch.rank(spanish, "configurar programación guardia ")),
    ).not.toContain("/docs/es/on-call/schedules");
    // English keywords, as the ranking tests above hold them.
    for (const url of urls(DocsSearch.rank(INDEX, "kubernetes helm "))) {
      expect(url).toMatch(/^\/docs\/en\/telemetry\/kubernetes-agent/);
    }
  });

  it("offers, when nothing holds every word, the results with most of them, as keywords get", () => {
    const chinese: AIDocsLanguageIndex = makeDocsIndex(CHINESE_PAGES, "zh-CN");

    // No page says "班计" and "设置" both: keywords get the pages with most of the pairs, as before.
    expect(pagesOf(DocsSearch.rank(chinese, "设置值班计划")).sort()).toEqual([
      "/docs/zh-CN/introduction/quickstart",
      "/docs/zh-CN/on-call/index",
      "/docs/zh-CN/on-call/schedules",
    ]);
    // Asked, the page named for most of them comes first.
    expect(urls(DocsSearch.rank(chinese, "如何设置值班计划？"))[0]).toBe(
      "/docs/zh-CN/on-call/schedules",
    );
  });

  it("offers a page named for fewer than half its words to nobody", () => {
    const russian: AIDocsLanguageIndex = makeDocsIndex(RUSSIAN_PAGES, "ru");

    // "Исключения" is named for one word in three, and says neither "отслеживать" nor "сайт".
    expect(
      pagesOf(DocsSearch.rank(russian, "Как отслеживать сайт и исключения?")),
    ).not.toContain("/docs/ru/telemetry/exceptions");
  });

  it("lifts a page that holds part of it by its name, never one that only says part of it", () => {
    const index: AIDocsLanguageIndex = makeDocsIndex(
      [
        {
          page: "monitor/website-monitor",
          title: "Website Monitor",
          summary: "Checks that a website answers.",
        },
        {
          page: "guides/website-down",
          title: "Know When Your Site Is Down",
          summary: "Track the website and get told when it is down.",
        },
        {
          page: "telemetry/logs",
          title: "Logs",
          summary: "Logs from the website, the server and the browser.",
          sections: [
            {
              title: "Browser logs",
              text: "Logs from a website's visitors.",
            },
          ],
        },
      ],
      "en",
    );

    /*
     * Named for the website, it is offered beside the page that says both
     * words; Logs, which says "website" in its text only, is not.
     */
    expect(
      pagesOf(DocsSearch.rank(index, "How do I track my website?")).sort(),
    ).toEqual([
      "/docs/en/guides/website-down",
      "/docs/en/monitor/website-monitor",
    ]);
    // Typed as keywords, only the page that says both.
    expect(pagesOf(DocsSearch.rank(index, "track website "))).toEqual([
      "/docs/en/guides/website-down",
    ]);
  });

  it("reads one word as before: a question of one word holds it or nothing", () => {
    const russian: AIDocsLanguageIndex = makeDocsIndex(RUSSIAN_PAGES, "ru");

    expect(DocsSearch.rank(russian, "Как отслеживать?").results).toEqual(
      DocsSearch.rank(russian, "отслеживать").results,
    );
    expect(
      pagesOf(DocsSearch.rank(russian, "Как отслеживать?")).sort(),
    ).toEqual([
      "/docs/ru/introduction/getting-started",
      "/docs/ru/monitor/create-monitor",
    ]);
  });
});

/*
 * A question answered by a section of a page named for something else
 * (#8698): two-factor authentication is a step of Your Account, "Slå på
 * tofaktorautentisering", and "Hvordan slår jeg på
 * tofaktorautentisering?" asks it with "slår" (present), which the
 * heading's "slå" is not. Where no page is named for the question, a
 * section whose own heading holds half its words or more goes beside the
 * results that hold all of them.
 */
const NORWEGIAN_ACCOUNT_PAGES: Array<MadePage> = [
  {
    page: "introduction/your-account",
    title: "Kontoen din",
    summary: "Profilen din, og hvordan du logger inn trygt.",
    sections: [
      {
        title: "Slå på tofaktorautentisering",
        text: "Legg først til et andre steg, og slå det deretter på.",
      },
      {
        title: "Endre passordet ditt",
        text: "Velg et nytt passord for kontoen.",
      },
    ],
  },
  {
    page: "mobile-desktop-apps/android-installation",
    title: "Installasjon på Android",
    summary: "Last ned appen og logg inn.",
    sections: [
      {
        title: "Logg inn i appen",
        text: "Slår du på tofaktorautentisering, ber appen om en kode.",
      },
    ],
  },
  {
    page: "self-hosted/enterprise",
    title: "Enterprise",
    summary:
      "En administrator som slår den på, kan kreve tofaktorautentisering.",
  },
];

const ACCOUNT_STEP: string = "/docs/no/introduction/your-account#";

describe("a question answered by a section (#8698)", () => {
  const norwegian: AIDocsLanguageIndex = makeDocsIndex(
    NORWEGIAN_ACCOUNT_PAGES,
    "no",
  );

  it("finds the section whose heading names what it asks, on a page named for something else", () => {
    const found: Array<string> = urls(
      DocsSearch.rank(norwegian, "Hvordan slår jeg på tofaktorautentisering?"),
    );

    expect(
      found.filter((url: string): boolean => {
        return url.startsWith(ACCOUNT_STEP);
      }),
    ).toEqual([`${ACCOUNT_STEP}slå-på-tofaktorautentisering`]);
    // Beside the results that hold every word.
    expect(found).toEqual(
      expect.arrayContaining([
        "/docs/no/self-hosted/enterprise",
        "/docs/no/mobile-desktop-apps/android-installation#logg-inn-i-appen",
      ]),
    );
  });

  it("leaves it out of keywords, which still need every word", () => {
    expect(
      urls(DocsSearch.rank(norwegian, "slår tofaktorautentisering ")).filter(
        (url: string): boolean => {
          return url.startsWith(ACCOUNT_STEP);
        },
      ),
    ).toEqual([]);
  });

  it("leaves it out where a page is named for the question: the page answers it", () => {
    const withPage: AIDocsLanguageIndex = makeDocsIndex(
      [
        ...NORWEGIAN_ACCOUNT_PAGES,
        {
          page: "security/two-factor",
          title: "Tofaktorautentisering",
          summary: "Et andre steg når du logger inn.",
        },
      ],
      "no",
    );
    const found: Array<string> = urls(
      DocsSearch.rank(withPage, "Hvordan slår jeg på tofaktorautentisering?"),
    );

    expect(found).toContain("/docs/no/security/two-factor");
    expect(
      found.filter((url: string): boolean => {
        return url.startsWith(ACCOUNT_STEP);
      }),
    ).toEqual([]);
  });

  it("leaves out a section whose heading holds fewer than half the question's words", () => {
    // "appen" (the app) is a third word, which the heading does not hold: one in three.
    const found: Array<string> = urls(
      DocsSearch.rank(
        norwegian,
        "Hvordan slår jeg på tofaktorautentisering i appen?",
      ),
    );

    expect(
      found.filter((url: string): boolean => {
        return url.startsWith(ACCOUNT_STEP);
      }),
    ).toEqual([]);
    expect(found[0]).toBe(
      "/docs/no/mobile-desktop-apps/android-installation#logg-inn-i-appen",
    );
  });
});

/*
 * A Dutch verb's first part, written after it ("Hoe zet ik ... aan?"), is
 * read joined to the verb and never alone (#8698): as a word of its own,
 * "aan" made the step "Tweestapsverificatie inschakelen" hold one of the
 * question's three words.
 */
describe("a Dutch verb written in two parts", () => {
  const dutch: AIDocsLanguageIndex = makeDocsIndex(
    [
      {
        page: "introduction/your-account",
        title: "Uw account",
        summary: "Uw profiel en hoe u veilig inlogt.",
        sections: [
          {
            title: "Tweestapsverificatie inschakelen",
            text: "Voeg eerst een tweede stap toe en zet hem daarna aan.",
          },
        ],
      },
      {
        page: "permissions/inviting-people",
        title: "Mensen uitnodigen",
        summary: "Nodig een collega uit voor je project.",
      },
    ],
    "nl",
  );

  it("does not look for the part alone, and reads it joined where the docs hold the verb", () => {
    expect(typedWords(dutch, "Hoe zet ik tweestapsverificatie aan?")).toEqual([
      "zet",
      "tweestapsverificatie",
    ]);
    // "nodig" holds "uitnodig" (uitnodigen) as a way of being found.
    const words: Array<DocsQueryWord> = DocsSearch.readQuery(
      dutch,
      "Hoe nodig ik een collega uit? ",
    );

    expect(
      words.map((word: DocsQueryWord): string => {
        return word.typed;
      }),
    ).toEqual(["nodig", "collega"]);
    expect(alternativeTerms(words[0]!)).toContain("uitnodig");
    // Typed alone, it is a word.
    expect(typedWords(dutch, "uit")).toEqual(["uit"]);
  });

  it("finds the step a question asks with the verb's other part written apart", () => {
    expect(
      urls(DocsSearch.rank(dutch, "Hoe zet ik tweestapsverificatie aan?")),
    ).toContain(
      "/docs/nl/introduction/your-account#tweestapsverificatie-inschakelen",
    );
  });
});

describe("a result", () => {
  it("says where it is and opens the page in the reader's language, at the section", () => {
    const section: DocsSearchResult = DocsSearch.rank(INDEX, "ssl ")
      .results[0]!;

    expect(section).toEqual(
      expect.objectContaining({
        title: "SSL certificates",
        where: "Monitor › Website Monitor",
        url: "/docs/en/monitor/website-monitor#ssl-certificates",
        isSection: true,
        isGuide: false,
      }),
    );

    const page: DocsSearchResult = DocsSearch.rank(INDEX, "website ")
      .results[0]!;

    expect(page).toEqual(
      expect.objectContaining({
        title: "Website Monitor",
        where: "Monitor",
        url: "/docs/en/monitor/website-monitor",
        isSection: false,
      }),
    );

    const german: AIDocsLanguageIndex = makeDocsIndex(
      [{ page: "monitor/website-monitor", title: "Website-Überwachung" }],
      "de",
    );
    expect(urls(DocsSearch.rank(german, "website "))[0]).toBe(
      "/docs/de/monitor/website-monitor",
    );
  });

  it("carries a line of its text around the first word found, and the words to mark as they are written", () => {
    const answer: DocsSearchAnswer = DocsSearch.rank(INDEX, "certificat ");

    expect(answer.results[0]!.snippet).toContain("certificate");
    expect(answer.words).toContain("certificate");
  });
});

describe("snippetOf", () => {
  const text: string = [
    "OneUptime checks your website from many probes around the world.",
    "When a check fails, the monitor opens an incident and pages whoever is on call.",
    "The incident shows on your status page if you want it there, and closes itself when the check passes again.",
  ].join(" ");

  it("cuts a line around the first word found, at words, with an ellipsis where it was cut", () => {
    const snippet: { text: string; words: Array<string> } =
      DocsSearch.snippetOf(text, new Set<string>(["incident"]));

    expect(snippet.text.startsWith("…")).toBe(true);
    expect(snippet.text.endsWith("…")).toBe(true);
    expect(snippet.text).toContain("opens an incident");
    expect(snippet.text.length).toBeLessThanOrEqual(170);
    expect(snippet.words).toEqual(["incident"]);
  });

  it("starts at the beginning when the word is near it, and says the start when nothing is found", () => {
    expect(
      DocsSearch.snippetOf(text, new Set<string>(["oneuptim"])).text.startsWith(
        "OneUptime checks",
      ),
    ).toBe(true);
    expect(
      DocsSearch.snippetOf(text, new Set<string>(["zzz"])).text.startsWith(
        "OneUptime checks",
      ),
    ).toBe(true);
    expect(DocsSearch.snippetOf("Short.", new Set<string>()).text).toBe(
      "Short.",
    );
  });

  it("marks a pair of Chinese or Japanese characters as itself", () => {
    expect(
      DocsSearch.snippetOf("ステータスページで知らせます", new Set(["ペー"]))
        .words,
    ).toEqual(["ペー"]);
  });
});
