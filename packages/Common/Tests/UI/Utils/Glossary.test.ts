import { DOCS_URL } from "../../../UI/Config";
import GlossaryTerm from "../../../Types/Docs/GlossaryTerm";
import {
  getDocsLanguageFor,
  getDocsPagePath,
} from "../../../Types/Docs/DocsLanguage";
import {
  CORE_CONCEPTS_DOCS_PAGE,
  GLOSSARY_DEFINITION_MAX_SENTENCES,
  GLOSSARY_INDEX_DOCS_PAGE,
  LoadedGlossary,
  QUICKSTART_DOCS_PAGE,
  clearGlossaryReads,
  getDocsPageUrl,
  getGlossaryDataUrl,
  getGlossaryTermUrl,
  loadGlossary,
  readGlossaryData,
  shortenDefinition,
} from "../../../UI/Utils/Glossary";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The product's definitions read the docs' Glossary as data
 * (/docs/glossary/<lang>.json, #6818): the same sentences the Glossary page
 * shows, in the reader's language, read once per language. These pin the
 * addresses, the reading of the data, the three-sentence cut and the read
 * itself - once per language, forgotten when it fails.
 */

const DOCS: string = DOCS_URL.toString();

type FetchMock = jest.Mock<(url: string) => Promise<unknown>>;

const answer: (body: unknown, status?: number) => Promise<unknown> = (
  body: unknown,
  status?: number,
): Promise<unknown> => {
  return Promise.resolve({
    ok: (status ?? 200) < 400,
    status: status ?? 200,
    json: (): Promise<unknown> => {
      return Promise.resolve(body);
    },
  });
};

const GERMAN: unknown = {
  lang: "de",
  entries: [
    {
      id: "probe",
      term: "Sonde",
      definition: "Eine Maschine, die die Prüfungen von Monitoren ausführt.",
      alsoCalled: [],
      links: [],
      url: "/docs/de/introduction/glossary#probe",
    },
    {
      id: "criteria",
      term: "Kriterien",
      definition: "Die Regeln eines Monitors.",
      alsoCalled: [],
      links: [],
      url: "/docs/de/introduction/glossary#criteria",
    },
  ],
};

describe("addresses", () => {
  it("opens a docs page in the reader's language where the docs have it", () => {
    expect(getDocsPageUrl(QUICKSTART_DOCS_PAGE, "de")).toBe(
      `${DOCS}/de/introduction/quickstart`,
    );
    expect(getDocsPageUrl(CORE_CONCEPTS_DOCS_PAGE, "zh-TW")).toBe(
      `${DOCS}/zh-TW/introduction/core-concepts`,
    );
    expect(getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, "fa")).toBe(
      `${DOCS}/fa/introduction/glossary`,
    );
  });

  it("opens the English page for a language the docs are not written in, or none", () => {
    expect(getDocsPageUrl(QUICKSTART_DOCS_PAGE, "ar")).toBe(
      `${DOCS}/en/introduction/quickstart`,
    );
    expect(getDocsPageUrl(QUICKSTART_DOCS_PAGE)).toBe(
      `${DOCS}/en/introduction/quickstart`,
    );
    expect(getDocsPageUrl(QUICKSTART_DOCS_PAGE, "")).toBe(
      `${DOCS}/en/introduction/quickstart`,
    );
  });

  it("opens a term at its English anchor, which every language answers", () => {
    expect(getGlossaryTermUrl(GlossaryTerm.Criteria, "de")).toBe(
      `${DOCS}/de/introduction/glossary#criteria`,
    );
    expect(getGlossaryTermUrl(GlossaryTerm.OnCallPolicy, "ar")).toBe(
      `${DOCS}/en/introduction/glossary#on-call-policy`,
    );
    expect(getGlossaryTermUrl(GlossaryTerm.Layer, "ja")).toBe(
      `${DOCS}/ja/introduction/glossary#layer`,
    );
  });

  it("reads the data from the docs' glossary route, one file per docs language", () => {
    expect(getGlossaryDataUrl("de")).toBe(`${DOCS}/glossary/de.json`);
    expect(getGlossaryDataUrl("ar")).toBe(`${DOCS}/glossary/en.json`);
    expect(getGlossaryDataUrl(undefined)).toBe(`${DOCS}/glossary/en.json`);
  });

  it("builds every address on this instance's docs, never a public site", () => {
    for (const url of [
      getDocsPageUrl(QUICKSTART_DOCS_PAGE, "de"),
      getGlossaryTermUrl(GlossaryTerm.Probe, "de"),
      getGlossaryDataUrl("de"),
    ]) {
      expect(url.startsWith(DOCS)).toBe(true);
      expect(url).not.toContain("oneuptime.com/docs");
      // The docs address is not repeated: no /docs/docs/.
      expect(url).not.toContain("/docs/docs/");
    }
  });

  it("answers a docs page path the same way the shared types do", () => {
    expect(getDocsLanguageFor("de")).toBe("de");
    expect(getDocsLanguageFor("DE")).toBe("en");
    expect(getDocsLanguageFor("ar")).toBe("en");
    expect(getDocsPagePath("on-call/schedules#layers", "fr")).toBe(
      "/docs/fr/on-call/schedules#layers",
    );
  });
});

describe("shortenDefinition", () => {
  it("leaves a definition of three sentences or fewer as it is", () => {
    const three: string = "One. Two two. Three three three.";

    expect(shortenDefinition(three)).toBe(three);
    expect(shortenDefinition("Just one")).toBe("Just one");
    expect(GLOSSARY_DEFINITION_MAX_SENTENCES).toBe(3);
  });

  it("cuts a longer one after its third sentence", () => {
    expect(shortenDefinition("One. Two? Three! Four. Five.")).toBe(
      "One. Two? Three!",
    );
  });

  it("does not take a dot inside a number or a name for a sentence's end", () => {
    const definition: string =
      "Up 99.9% of the time. Named by its service.name attribute. It sends to x.y.z. A fourth one.";

    expect(shortenDefinition(definition)).toBe(
      "Up 99.9% of the time. Named by its service.name attribute. It sends to x.y.z.",
    );
  });

  it("ends sentences where Chinese, Japanese, Hindi and Persian end them", () => {
    expect(shortenDefinition("一。二。三。四。")).toBe("一。二。三。");
    expect(shortenDefinition("एक। दो। तीन। चार।")).toBe("एक। दो। तीन।");
    expect(shortenDefinition("یک؟ دو. سه. چهار.")).toBe("یک؟ دو. سه.");
  });

  it("can cut to another length, and trims what it keeps", () => {
    expect(shortenDefinition("  One. Two. Three.  ", 1)).toBe("One.");
  });
});

describe("readGlossaryData", () => {
  it("reads every entry, by id, in the language the data says", () => {
    const glossary: LoadedGlossary | null = readGlossaryData(GERMAN);

    expect(glossary).not.toBeNull();
    expect(glossary!.language).toBe("de");
    expect(glossary!.direction).toBe("ltr");
    expect(glossary!.definitions.get("probe")).toEqual({
      id: "probe",
      term: "Sonde",
      definition: "Eine Maschine, die die Prüfungen von Monitoren ausführt.",
    });
    expect(Array.from(glossary!.definitions.keys())).toEqual([
      "probe",
      "criteria",
    ]);
  });

  it("knows a language read from the right", () => {
    const glossary: LoadedGlossary | null = readGlossaryData({
      lang: "fa",
      entries: [{ id: "probe", term: "پراب", definition: "ماشینی که..." }],
    });

    expect(glossary!.direction).toBe("rtl");
    expect(glossary!.language).toBe("fa");
  });

  it("calls data in a language it does not know English", () => {
    const glossary: LoadedGlossary | null = readGlossaryData({
      lang: "xx",
      entries: [{ id: "probe", term: "Probe", definition: "A machine." }],
    });

    expect(glossary!.language).toBe("en");
    expect(glossary!.direction).toBe("ltr");
  });

  it("leaves out an entry without an id, a term or a definition", () => {
    const glossary: LoadedGlossary | null = readGlossaryData({
      lang: "en",
      entries: [
        { id: "probe", term: "Probe", definition: "A machine." },
        { term: "No id", definition: "Text." },
        { id: "no-term", definition: "Text." },
        { id: "no-definition", term: "Empty", definition: "   " },
        "not an entry",
        null,
      ],
    });

    expect(Array.from(glossary!.definitions.keys())).toEqual(["probe"]);
  });

  it("turns down anything that is not the glossary's shape", () => {
    expect(readGlossaryData(null)).toBeNull();
    expect(readGlossaryData([])).toBeNull();
    expect(readGlossaryData({ lang: "en" })).toBeNull();
    expect(readGlossaryData({ lang: "en", entries: {} })).toBeNull();
    // No definitions at all is a failed read, not an empty glossary.
    expect(readGlossaryData({ lang: "en", entries: [] })).toBeNull();
  });
});

describe("loadGlossary", () => {
  let fetchMock: FetchMock;
  const originalFetch: unknown = (globalThis as Record<string, unknown>)[
    "fetch"
  ];

  beforeEach(() => {
    clearGlossaryReads();
    fetchMock = jest.fn((_url: string): Promise<unknown> => {
      return answer(GERMAN);
    });
    (globalThis as Record<string, unknown>)["fetch"] = fetchMock;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
    clearGlossaryReads();
  });

  it("reads the reader's language from the docs, once for every definition", async () => {
    const [first, second] = await Promise.all([
      loadGlossary("de"),
      loadGlossary("de"),
    ]);
    const third: LoadedGlossary = await loadGlossary("de");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${DOCS}/glossary/de.json`);
    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(first.definitions.get("criteria")?.term).toBe("Kriterien");
  });

  it("reads English for a language the docs are not written in", async () => {
    await loadGlossary("ar");

    expect(fetchMock.mock.calls[0]![0]).toBe(`${DOCS}/glossary/en.json`);
  });

  it("reads each language on its own", async () => {
    await loadGlossary("de");
    await loadGlossary("fr");

    expect(
      fetchMock.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([`${DOCS}/glossary/de.json`, `${DOCS}/glossary/fr.json`]);
  });

  it("forgets a read that failed, so the next definition asks again", async () => {
    fetchMock.mockImplementationOnce((): Promise<unknown> => {
      return Promise.reject(new Error("offline"));
    });

    await expect(loadGlossary("de")).rejects.toThrow("offline");

    const glossary: LoadedGlossary = await loadGlossary("de");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(glossary.language).toBe("de");
  });

  it("fails on an error answer and on an answer without definitions", async () => {
    fetchMock.mockImplementationOnce((): Promise<unknown> => {
      return answer({ lang: "de", entries: [] }, 404);
    });

    await expect(loadGlossary("de")).rejects.toThrow("404");

    fetchMock.mockImplementationOnce((): Promise<unknown> => {
      return answer({ lang: "de", entries: [] });
    });

    await expect(loadGlossary("de")).rejects.toThrow("no definitions");

    // Both were forgotten: the third read asks again, and gets the glossary.
    await expect(loadGlossary("de")).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
