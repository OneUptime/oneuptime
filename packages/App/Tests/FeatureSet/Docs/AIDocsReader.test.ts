import DocsAIReader, {
  AIDocsLanguageIndex,
  normalizeDocsPage,
  splitDocsSections,
  stemDocsWord,
  tokenizeForDocs,
  tokenizeQueryForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
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

// German "how do I" questions, each with the page named for what it asks about.
const NAMED_FOR_THE_QUESTION: Array<[string, string]> = [
  // Website-Überwachung, not "Wie ich erreichbar bin" (How to Reach Me).
  ["Wie überwache ich meine Website?", "monitor/website-monitor"],
  ["Wie erstelle ich eine Bereitschaftsrichtlinie?", "on-call/policies"],
  ["Wie erstelle ich einen Monitor?", "monitor/create-monitor"],
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
    'in German, "%s" finds the page named for what it asks about first (#7799)',
    async (question: string, page: string) => {
      const hits: Array<AIDocsSearchHit> = await reader.search({
        query: question,
        language: "de",
        limit: 6,
      });

      expect(hits[0]?.page).toBe(page);
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
