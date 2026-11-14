import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import DocsGlossaryData, {
  DocsGlossary,
  DocsGlossaryEntry,
  parseGlossary,
} from "../../../FeatureSet/Docs/Utils/Glossary";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsSearchIndex, {
  DocsSearchEntry,
} from "../../../FeatureSet/Docs/Utils/SearchIndex";
import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import { GLOSSARY } from "./GlossaryDocsSupport";
import GlossaryTerm, {
  ALL_GLOSSARY_TERMS,
} from "Common/Types/Docs/GlossaryTerm";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import path from "path";

/*
 * THE GLOSSARY AS DATA (Utils/Glossary.ts, /docs/glossary/<lang>.json).
 *
 * The Dashboard shows a term's definition where the word is used (#6819),
 * and Ask AI reads the Glossary (#6828), from the same Markdown the
 * Glossary page is drawn from: one definition per language, written once.
 * This suite holds the reader to that page's shape, the route to what it
 * serves, and the page, as the docs draw it, to the English anchor of every
 * term in every language - the address code links a term by.
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

const ENGLISH: string = readPage("en", GLOSSARY);

/*
 * What comes right before an id the page gives a term: the term's own
 * heading ("<h3 id=..."), or the English anchor's mark at the top of a
 * translated heading ("<h3 ...><span id=...").
 */
const ON_HEADING: RegExp = /(<h3|<h3 [^>]*><span)$/;

// Bold, a link or code: Markdown a plain definition no longer has.
const MARKDOWN_LEFT: RegExp = /\*\*|\]\(|`/;

const SAMPLE_ENGLISH: string = [
  "# Glossary",
  "",
  "Every word.",
  "",
  ":::cards",
  "- [Start here](#start-here): The loop.",
  ":::",
  "",
  "## Start here",
  "",
  "### On-Call Policy",
  "",
  "Decides who is paged, and who is **next**. Uses `escalation`.",
  "",
  "Also called: **On-Call Duty**, `OnCallDutyPolicy`. See [On-Call Policies](/docs/on-call/policies).",
  "",
  "### Monitor",
  "",
  "Checks one thing you run.",
  "",
  "See [Creating a Monitor](/docs/monitor/create-monitor) and [Monitor Groups](/docs/monitor/monitor-groups#create-a-monitor-group).",
  "",
  "## Next steps",
  "",
  ":::cards",
  "- [Quickstart](/docs/introduction/quickstart): Go.",
  ":::",
].join("\n");

const SAMPLE_GERMAN: string = [
  "# Glossar",
  "",
  "Jedes Wort.",
  "",
  ":::cards",
  "- [Hier anfangen](#hier-anfangen): Der Kreislauf.",
  ":::",
  "",
  "## Hier anfangen",
  "",
  "### Bereitschaftsrichtlinie",
  "",
  "Entscheidet, wer alarmiert wird, und wer **als Nächstes**. Nutzt `escalation`.",
  "",
  "Auch genannt: **Bereitschaftsdienst**, `OnCallDutyPolicy`. Siehe [Bereitschaftsrichtlinien](/docs/on-call/policies).",
  "",
  "### Überwachung",
  "",
  "Prüft eine Sache.",
  "",
  "Siehe [Einen Monitor erstellen](/docs/monitor/create-monitor) und [Monitor-Gruppen](/docs/monitor/monitor-groups#eine-monitor-gruppe-erstellen).",
  "",
  "## Nächste Schritte",
  "",
  ":::cards",
  "- [Schnellstart](/docs/introduction/quickstart): Los.",
  ":::",
].join("\n");

describe("parseGlossary", () => {
  it("reads each term: its id, group, plain definition, other names and pages", () => {
    const entries: Array<DocsGlossaryEntry> = parseGlossary(
      SAMPLE_ENGLISH,
      SAMPLE_ENGLISH,
      "en",
    ) as Array<DocsGlossaryEntry>;

    expect(entries).toEqual([
      {
        id: "on-call-policy",
        term: "On-Call Policy",
        anchor: "on-call-policy",
        group: "Start here",
        definition: "Decides who is paged, and who is next. Uses escalation.",
        alsoCalled: ["On-Call Duty", "OnCallDutyPolicy"],
        links: [
          { title: "On-Call Policies", url: "/docs/en/on-call/policies" },
        ],
        url: "/docs/en/introduction/glossary#on-call-policy",
      },
      {
        id: "monitor",
        term: "Monitor",
        anchor: "monitor",
        group: "Start here",
        definition: "Checks one thing you run.",
        alsoCalled: [],
        links: [
          {
            title: "Creating a Monitor",
            url: "/docs/en/monitor/create-monitor",
          },
          {
            title: "Monitor Groups",
            url: "/docs/en/monitor/monitor-groups#create-a-monitor-group",
          },
        ],
        url: "/docs/en/introduction/glossary#monitor",
      },
    ]);
  });

  it("gives a translated term the English term's id, and its own words, anchor and links in its language", () => {
    const entries: Array<DocsGlossaryEntry> = parseGlossary(
      SAMPLE_ENGLISH,
      SAMPLE_GERMAN,
      "de",
    ) as Array<DocsGlossaryEntry>;

    expect(
      entries.map((entry: DocsGlossaryEntry): string => {
        return entry.id;
      }),
    ).toEqual(["on-call-policy", "monitor"]);
    expect(entries[0]).toEqual({
      id: "on-call-policy",
      term: "Bereitschaftsrichtlinie",
      anchor: "bereitschaftsrichtlinie",
      group: "Hier anfangen",
      definition:
        "Entscheidet, wer alarmiert wird, und wer als Nächstes. Nutzt escalation.",
      alsoCalled: ["Bereitschaftsdienst", "OnCallDutyPolicy"],
      links: [
        { title: "Bereitschaftsrichtlinien", url: "/docs/de/on-call/policies" },
      ],
      url: "/docs/de/introduction/glossary#on-call-policy",
    });
    expect(entries[1]!.links[1]).toEqual({
      title: "Monitor-Gruppen",
      url: "/docs/de/monitor/monitor-groups#eine-monitor-gruppe-erstellen",
    });
  });

  it("gives no term an id when the translation is not the English page's shape", () => {
    // A term missing.
    expect(
      parseGlossary(
        SAMPLE_ENGLISH,
        SAMPLE_GERMAN.replace("### Überwachung", "Überwachung"),
        "de",
      ),
    ).toBeNull();
    // A term moved up a level.
    expect(
      parseGlossary(
        SAMPLE_ENGLISH,
        SAMPLE_GERMAN.replace("### Überwachung", "## Überwachung"),
        "de",
      ),
    ).toBeNull();
  });

  it("reads a term with no names line as all definition", () => {
    const markdown: string = SAMPLE_ENGLISH.replace(
      "\n\nSee [Creating a Monitor](/docs/monitor/create-monitor) and [Monitor Groups](/docs/monitor/monitor-groups#create-a-monitor-group).",
      "\n\nIt has two paragraphs.",
    );
    const monitor: DocsGlossaryEntry = (
      parseGlossary(markdown, markdown, "en") as Array<DocsGlossaryEntry>
    )[1] as DocsGlossaryEntry;

    expect(monitor.definition).toBe(
      "Checks one thing you run. It has two paragraphs.",
    );
    expect(monitor.alsoCalled).toEqual([]);
    expect(monitor.links).toEqual([]);
  });

  it("does not read a code sample's lines as terms or definitions", () => {
    const markdown: string = SAMPLE_ENGLISH.replace(
      "Checks one thing you run.",
      "Checks one thing you run.\n\n```bash\n### not a term\n**not a name**\n```",
    );
    const entries: Array<DocsGlossaryEntry> = parseGlossary(
      markdown,
      markdown,
      "en",
    ) as Array<DocsGlossaryEntry>;

    expect(entries.length).toBe(2);
    expect(entries[1]!.definition).toBe("Checks one thing you run.");
  });

  it("reads every term of the docs' Glossary, with a definition and a page each", () => {
    const entries: Array<DocsGlossaryEntry> = parseGlossary(
      ENGLISH,
      ENGLISH,
      "en",
    ) as Array<DocsGlossaryEntry>;

    expect(
      entries.map((entry: DocsGlossaryEntry): string => {
        return entry.id;
      }),
    ).toEqual([...ALL_GLOSSARY_TERMS]);

    for (const entry of entries) {
      expect({ id: entry.id, defined: entry.definition.length > 20 }).toEqual({
        id: entry.id,
        defined: true,
      });
      expect({ id: entry.id, linked: entry.links.length >= 1 }).toEqual({
        id: entry.id,
        linked: true,
      });
      // Plain text: no Markdown left for the Dashboard to draw.
      expect({
        id: entry.id,
        markdown: MARKDOWN_LEFT.test(entry.definition),
      }).toEqual({ id: entry.id, markdown: false });
    }

    const service: DocsGlossaryEntry = entries.find(
      (entry: DocsGlossaryEntry): boolean => {
        return entry.id === GlossaryTerm.Service;
      },
    ) as DocsGlossaryEntry;

    expect(service.alsoCalled).toEqual([
      "Service Catalog",
      "Telemetry Service",
    ]);
    expect(service.links).toEqual([
      { title: "Services", url: "/docs/en/telemetry/services" },
    ]);
  });
});

describe("DocsGlossaryData", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "serves %s in its own language, every term by its id",
    async (language: string) => {
      DocsGlossaryData.clearCache();

      const glossary: DocsGlossary =
        await DocsGlossaryData.getGlossary(language);

      expect(glossary.lang).toBe(language);
      expect(
        glossary.entries.map((entry: DocsGlossaryEntry): string => {
          return entry.id;
        }),
      ).toEqual([...ALL_GLOSSARY_TERMS]);

      for (const entry of glossary.entries) {
        expect(entry.url).toBe(
          `/docs/${language}/introduction/glossary#${entry.id}`,
        );

        for (const link of entry.links) {
          expect(link.url.startsWith(`/docs/${language}/`)).toBe(true);
        }
      }
    },
  );

  it("serves English for a language the docs are not written in", async () => {
    DocsGlossaryData.clearCache();

    const glossary: DocsGlossary = await DocsGlossaryData.getGlossary("xx");

    expect(glossary.lang).toBe("en");
    expect(glossary.entries.length).toBe(ALL_GLOSSARY_TERMS.length);
  });

  it("keeps what it read for a while, and reads again once cleared", async () => {
    DocsGlossaryData.clearCache();

    const first: DocsGlossary = await DocsGlossaryData.getGlossary("de");
    const again: DocsGlossary = await DocsGlossaryData.getGlossary("de");

    expect(again).toBe(first);

    DocsGlossaryData.clearCache();

    expect(await DocsGlossaryData.getGlossary("de")).not.toBe(first);
  });
});

describe("docs search, on the Glossary's other names", () => {
  it("finds a term by any other name it goes by, and opens the term", async () => {
    DocsSearchIndex.clearCache();

    const glossary: DocsSearchEntry = (
      await DocsSearchIndex.getIndex("en")
    ).find((entry: DocsSearchEntry): boolean => {
      return entry.u === "/docs/en/introduction/glossary";
    }) as DocsSearchEntry;

    expect(glossary.h).toEqual(
      expect.arrayContaining([
        { t: "Service", a: "service" },
        { t: "Service Catalog (Service)", a: "service" },
        { t: "Telemetry Service (Service)", a: "service" },
        { t: "On-Call Duty (On-Call Policy)", a: "on-call-policy" },
        { t: "OnCallDutyPolicy (On-Call Policy)", a: "on-call-policy" },
      ]),
    );

    // One result for each other name, and nothing for a term with none.
    const otherNames: number = (
      parseGlossary(ENGLISH, ENGLISH, "en") as Array<DocsGlossaryEntry>
    ).reduce((count: number, entry: DocsGlossaryEntry): number => {
      return count + entry.alsoCalled.length;
    }, 0);

    expect(
      glossary.h.filter((heading: { t: string }): boolean => {
        return heading.t.endsWith(")");
      }).length,
    ).toBe(otherNames);
    expect(otherNames).toBeGreaterThan(30);
  });

  it("finds them in each language by that language's names", async () => {
    DocsSearchIndex.clearCache();

    const glossary: DocsSearchEntry = (
      await DocsSearchIndex.getIndex("de")
    ).find((entry: DocsSearchEntry): boolean => {
      return entry.u === "/docs/de/introduction/glossary";
    }) as DocsSearchEntry;

    expect(glossary.h).toEqual(
      expect.arrayContaining([
        { t: "Dienstkatalog (Dienst)", a: "service" },
        {
          t: "OnCallDutyPolicy (Bereitschaftsrichtlinie)",
          a: "on-call-policy",
        },
      ]),
    );
  });
});

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

describe("/docs/glossary/<lang>.json", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "answers %s with that language's entries",
    async (language: string) => {
      const response: Response = await fetch(
        `${origin}/docs/glossary/${language}.json`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe("public, max-age=600");

      const glossary: DocsGlossary = (await response.json()) as DocsGlossary;

      expect(glossary.lang).toBe(language);
      expect(
        glossary.entries.map((entry: DocsGlossaryEntry): string => {
          return entry.id;
        }),
      ).toEqual([...ALL_GLOSSARY_TERMS]);
    },
  );

  it("is not found for a language the docs do not have", async () => {
    const response: Response = await fetch(`${origin}/docs/glossary/xx.json`, {
      redirect: "manual",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ lang: "xx", entries: [] });
  });
});

describe("the Glossary page, as the docs draw it", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "answers every term's English anchor in %s, on the term's own heading",
    async (language: string) => {
      const response: Response = await fetch(
        `${origin}/docs/${language}/introduction/glossary`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(200);

      const html: string = await response.text();
      const missing: Array<string> = ALL_GLOSSARY_TERMS.filter(
        (id: GlossaryTerm): boolean => {
          return html.split(` id="${id}"`).length - 1 !== 1;
        },
      );

      expect(missing).toEqual([]);

      // Each id is on the heading, or the heading's alias mark, never elsewhere.
      for (const id of ALL_GLOSSARY_TERMS) {
        const at: number = html.indexOf(` id="${id}"`);
        const before: string = html.slice(Math.max(0, at - 300), at);

        expect({ id: id, onHeading: ON_HEADING.test(before) }).toEqual({
          id: id,
          onHeading: true,
        });
      }

      /*
       * And on its own term: a translated heading names the English anchor
       * it answers, and that anchor is its own id or the mark at its top -
       * never another term's heading that happens to have that id.
       */
      if (language !== "en") {
        const wrong: Array<string> = ALL_GLOSSARY_TERMS.filter(
          (id: GlossaryTerm): boolean => {
            const tag: RegExpMatchArray | null = html.match(
              new RegExp(
                `<h3 id="([^"]*)" data-english-anchor="${escapeRegExp(id)}"[^>]*>(<span id="${escapeRegExp(id)}")?`,
              ),
            );

            return !tag || (tag[1] !== id && !tag[2]);
          },
        );

        expect(wrong).toEqual([]);
      }
    },
  );
});
