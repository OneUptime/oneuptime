import DocsSearch, {
  DOCS_SEARCH_MAX_LIMIT,
  DOCS_SEARCH_QUERY_MAX_LENGTH,
  DocsQueryAlternative,
  DocsQueryWord,
  DocsSearchAnswer,
  DocsSearchResult,
} from "../../../FeatureSet/Docs/Utils/DocsSearch";
import { AIDocsLanguageIndex } from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import { makeDocsIndex } from "./DocsSearchHelpers";
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
