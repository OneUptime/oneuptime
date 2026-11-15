import { describe, expect, test } from "@jest/globals";
import {
  SetupGuideContent,
  SetupGuideStep,
  SetupGuideTopic,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  SetupGuidePiece,
  SetupGuideTranslation,
  SetupGuideTranslations,
  SetupGuideWords,
  getSetupGuidePieceShape,
  getSetupGuidePieces,
  getSetupGuideWordPieces,
  getSetupGuideWords,
  hasWords,
  translateSetupGuideContent,
  translateSetupGuideMarkdown,
  translateSetupGuidePiece,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideTranslation";
import { loadSetupGuideWords } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/UseSetupGuideTranslation";
import {
  SETUP_GUIDE_DOCUMENTATION_PRODUCTS,
  SetupGuideDocumentationProduct,
} from "../../Helpers/SetupGuideDocumentationProducts";
import { SetupGuideWay } from "../../Helpers/SetupGuideWays";

/*
 * HOW A SETUP GUIDE'S MARKDOWN IS DRAWN IN THE READER'S LANGUAGE (#8341).
 *
 * A guide's markdown is built in code, for its reader: their URL, their
 * key and the resource's name are in its commands and code spans. So a
 * language's words for a guide are written per piece - a paragraph, a list
 * item, a table row, a heading, a quote - and a piece is found by its
 * shape, its words with its code and links set aside. These are the rules
 * that make that safe: code is never translated, a translation's code is
 * the code the guide drew for this reader, and a piece the language has no
 * words for reads in English.
 */

const GUIDE: string = [
  "Install the agent on the host.",
  "",
  "```bash",
  "Install the agent on the host.",
  "docker run --name oneuptime-agent",
  "```",
  "",
  "- **Read-only by default.** It runs `docker ps`.",
  "- See [the docs](/docs/agent).",
  "",
  "| Variable | Required |",
  "|----------|----------|",
  "| `ONEUPTIME_URL` | Yes |",
  "",
  "### Upgrade",
  "",
  "> [!WARNING]",
  "> **This token is a secret.** Keep it in your",
  "> deployment's secrets.",
  "",
  "Replace `my-host` with a name,",
  "such as `prod-01`.",
].join("\n");

const GERMAN: SetupGuideTranslation = {
  "Install the agent on the host.":
    "Installieren Sie den Agenten auf dem Host.",
  "- **Read-only by default.** It runs `docker ps`.":
    "- **Standardmäßig schreibgeschützt.** Er führt `docker ps` aus.",
  "- See [the docs](/docs/agent).": "- Siehe [die Doku](/docs/agent).",
  "| Variable | Required |": "| Variable | Erforderlich |",
  "| `ONEUPTIME_URL` | Yes |": "| `ONEUPTIME_URL` | Ja |",
  "### Upgrade": "### Aktualisieren",
  "> **This token is a secret.** Keep it in your\n> deployment's secrets.":
    "> **Dieses Token ist geheim.** Bewahren Sie es in den Secrets Ihrer Bereitstellung auf.",
  "Replace `my-host` with a name,\nsuch as `prod-01`.":
    "Ersetzen Sie `my-host` durch einen Namen,\netwa `prod-01`.",
};

function wordsIn(
  language: string,
  translation: SetupGuideTranslation,
): SetupGuideWords {
  return getSetupGuideWords({ language: language, translation: translation });
}

describe("a guide's markdown, as the pieces it is drawn from", () => {
  test("a paragraph, each list item, table row and heading, and a quote, are pieces; code, blank lines, a divider and an alert's marker are not words", () => {
    const pieces: Array<SetupGuidePiece> = getSetupGuidePieces(GUIDE);

    expect(
      pieces
        .filter((piece: SetupGuidePiece): boolean => {
          return piece.isWords;
        })
        .map((piece: SetupGuidePiece): string => {
          return piece.text;
        }),
    ).toEqual([
      "Install the agent on the host.",
      "- **Read-only by default.** It runs `docker ps`.",
      "- See [the docs](/docs/agent).",
      "| Variable | Required |",
      "| `ONEUPTIME_URL` | Yes |",
      "### Upgrade",
      "> **This token is a secret.** Keep it in your\n> deployment's secrets.",
      "Replace `my-host` with a name,\nsuch as `prod-01`.",
    ]);

    // The fenced block's lines - one of them the paragraph above - are code.
    const code: Array<string> = pieces
      .filter((piece: SetupGuidePiece): boolean => {
        return !piece.isWords && piece.text.trim() !== "";
      })
      .map((piece: SetupGuidePiece): string => {
        return piece.text;
      });

    expect(code).toEqual([
      "```bash",
      "Install the agent on the host.",
      "docker run --name oneuptime-agent",
      "```",
      "|----------|----------|",
      "> [!WARNING]",
    ]);
  });

  test("joined again, the pieces are the markdown, byte for byte", () => {
    expect(
      getSetupGuidePieces(GUIDE)
        .map((piece: SetupGuidePiece): string => {
          return piece.text;
        })
        .join("\n"),
    ).toBe(GUIDE);
  });

  test.each(
    SETUP_GUIDE_DOCUMENTATION_PRODUCTS.map(
      (
        product: SetupGuideDocumentationProduct,
      ): [string, SetupGuideDocumentationProduct] => {
        return [product.name, product];
      },
    ),
  )(
    "every markdown of every way through the %s guide splits and joins back as it is",
    (_name: string, product: SetupGuideDocumentationProduct) => {
      for (const way of product.ways()) {
        const content: SetupGuideContent = way.content;
        const markdowns: Array<string> = [
          content.intro || "",
          ...(content.prerequisites || []),
          ...content.steps.flatMap((step: SetupGuideStep): Array<string> => {
            return [
              step.markdown || "",
              ...(step.variants || []).map(
                (variant: { markdown: string }): string => {
                  return variant.markdown;
                },
              ),
              step.details || "",
            ];
          }),
          ...[
            ...(content.advanced || []),
            ...(content.troubleshooting || []),
          ].map((topic: SetupGuideTopic): string => {
            return topic.markdown;
          }),
        ];

        for (const markdown of markdowns) {
          expect(
            getSetupGuidePieces(markdown)
              .map((piece: SetupGuidePiece): string => {
                return piece.text;
              })
              .join("\n"),
          ).toBe(markdown);
        }
      }
    },
  );

  test.each([
    ["Install the agent.", true],
    ["| `ONEUPTIME_URL` | Yes |", true],
    // Devanagari writes its vowels as marks; Chinese a word in one character.
    ["| श्रेणी | डेटा |", true],
    ["| `ONEUPTIME_URL` | 是 |", true],
    ["| `ONEUPTIME_URL` | はい |", true],
    ["تحقق من الوكيل", true],
    ["`docker ps` `docker logs`", false],
    ["|----------|------|", false],
    ["](/docs/agent)", false],
    ['   `& "C:\\Program Files\\otelcol.exe"`', false],
    ["<br/>", false],
  ])("%j has words: %j", (text: string, expected: boolean) => {
    expect(hasWords(text)).toBe(expected);
  });
});

describe("a piece is found by its shape", () => {
  test("its code spans and link targets are set aside: the values a guide writes in them do not matter", () => {
    expect(
      getSetupGuidePieceShape("Replace `my-docker-host` with a name."),
    ).toBe(getSetupGuidePieceShape("Replace `web-1` with a name."));
    expect(getSetupGuidePieceShape("See [the docs](/docs/a).")).toBe(
      getSetupGuidePieceShape("See [the docs](https://example.com/docs/b)."),
    );
  });

  test("its words are not: another sentence is another piece", () => {
    expect(
      getSetupGuidePieceShape("Replace `my-docker-host` with a name."),
    ).not.toBe(getSetupGuidePieceShape("Keep `my-docker-host` as it is."));
    expect(getSetupGuidePieceShape("  - item")).not.toBe(
      getSetupGuidePieceShape("- item"),
    );
  });

  test("the first of two entries of one shape is the one drawn, and an empty one is none", () => {
    const words: SetupGuideWords = wordsIn("de", {
      "Use `a`.": "Verwenden Sie `a`.",
      "Use `b`.": "Nehmen Sie `b`.",
      "Keep it.": "   ",
    });

    expect(words.pieces.size).toBe(1);
    expect(translateSetupGuidePiece("Use `c`.", words)).toBe(
      "Verwenden Sie `c`.",
    );
    expect(translateSetupGuidePiece("Keep it.", words)).toBeUndefined();
  });
});

describe("a piece in the language keeps the code the guide drew for this reader", () => {
  const words: SetupGuideWords = wordsIn("de", {
    "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`.":
      "Ersetzen Sie `my-docker-host` durch einen Namen für diesen Host, etwa `prod-docker-01`.",
    // A language that puts the spans the other way round.
    "Pass `-e NAME=value` to `docker run`.":
      "`docker run` nimmt `-e NAME=value` entgegen.",
    "Run `a`, then `a` again.": "Führen Sie `a` aus, dann noch einmal `a`.",
    "Open [Infrastructure AI Agents](/docs/ai).":
      "Öffnen Sie [KI-Agenten](/docs/ai).",
    "Add `x`.": "Fügen Sie `x` hinzu (`y` ist optional).",
  });

  test("each code span is the drawn piece's, as many as the English has", () => {
    expect(
      translateSetupGuidePiece(
        "Replace `web-1` with a name for this host, such as `prod-docker-01`.",
        words,
      ),
    ).toBe(
      "Ersetzen Sie `web-1` durch einen Namen für diesen Host, etwa `prod-docker-01`.",
    );
  });

  test("a translation that moves its code spans gets each one's own value", () => {
    expect(
      translateSetupGuidePiece("Pass `-e KEY=1` to `podman run`.", words),
    ).toBe("`podman run` nimmt `-e KEY=1` entgegen.");
  });

  test("a span written twice is the drawn piece's twice", () => {
    expect(translateSetupGuidePiece("Run `b`, then `b` again.", words)).toBe(
      "Führen Sie `b` aus, dann noch einmal `b`.",
    );
  });

  test("a link's target is the drawn piece's", () => {
    expect(
      translateSetupGuidePiece(
        "Open [Infrastructure AI Agents](https://oneuptime.example.com/docs/ai).",
        words,
      ),
    ).toBe("Öffnen Sie [KI-Agenten](https://oneuptime.example.com/docs/ai).");
  });

  test("a span the English does not have stays as the translation writes it", () => {
    expect(translateSetupGuidePiece("Add `z`.", words)).toBe(
      "Fügen Sie `z` hinzu (`y` ist optional).",
    );
  });

  test("a piece the language has no words for has none", () => {
    expect(translateSetupGuidePiece("Something new.", words)).toBeUndefined();
  });
});

describe("a guide's markdown in the language", () => {
  test("every piece with words is drawn in them; the code block is left as it is, even a line that reads like a piece", () => {
    const drawn: string = translateSetupGuideMarkdown(
      GUIDE,
      wordsIn("de", GERMAN),
    );

    expect(drawn).toBe(
      [
        "Installieren Sie den Agenten auf dem Host.",
        "",
        "```bash",
        "Install the agent on the host.",
        "docker run --name oneuptime-agent",
        "```",
        "",
        "- **Standardmäßig schreibgeschützt.** Er führt `docker ps` aus.",
        "- Siehe [die Doku](/docs/agent).",
        "",
        "| Variable | Erforderlich |",
        "|----------|----------|",
        "| `ONEUPTIME_URL` | Ja |",
        "",
        "### Aktualisieren",
        "",
        "> [!WARNING]",
        "> **Dieses Token ist geheim.** Bewahren Sie es in den Secrets Ihrer Bereitstellung auf.",
        "",
        "Ersetzen Sie `my-host` durch einen Namen,",
        "etwa `prod-01`.",
      ].join("\n"),
    );
  });

  test("a piece the language has no words for reads in English; the rest is still the language's", () => {
    const withoutHeading: SetupGuideTranslation = { ...GERMAN };
    delete (withoutHeading as Record<string, string>)["### Upgrade"];

    const drawn: string = translateSetupGuideMarkdown(
      GUIDE,
      wordsIn("de", withoutHeading),
    );

    expect(drawn).toContain("### Upgrade");
    expect(drawn).toContain("Installieren Sie den Agenten auf dem Host.");
  });

  test("French sets its marks with no-break spaces in its words, never in code", () => {
    const drawn: string = translateSetupGuideMarkdown(
      ["Vérifiez ceci :", "", "```", "a : b ?", "```", "Lancez `x : y` !"].join(
        "\n",
      ),
      wordsIn("fr", { "Check this:": "Vérifiez ceci :" }),
    );

    expect(drawn).toBe(
      [
        "Vérifiez ceci\u00A0:",
        "",
        "```",
        "a : b ?",
        "```",
        "Lancez `x : y`\u202F!",
      ].join("\n"),
    );
  });

  test.each(["de", "ja", "fa", "ar"])(
    "%s's words are drawn as written",
    (language: string) => {
      expect(
        translateSetupGuideMarkdown(
          "Check this:",
          wordsIn(language, { "Check this:": "Prüfen : dies ?" }),
        ),
      ).toBe("Prüfen : dies ?");
    },
  );
});

describe("a guide in the language", () => {
  const content: SetupGuideContent = {
    intro: "Install the agent on the host.",
    prerequisites: ["Install the agent on the host."],
    steps: [
      {
        title: "Run the agent",
        description: "Install the agent on the host.",
        note: "Install the agent on the host.",
        markdown: "Install the agent on the host.",
        variants: [
          { label: "Docker CLI", markdown: "Install the agent on the host." },
        ],
        details: "Install the agent on the host.",
      },
    ],
    advanced: [
      {
        title: "Install the agent on the host.",
        summary: "Install the agent on the host.",
        markdown: "Install the agent on the host.",
      },
    ],
    troubleshooting: [
      {
        title: "No metrics",
        markdown: "Install the agent on the host.",
      },
    ],
    links: [{ title: "Install the agent on the host.", url: "/docs" }],
  };
  const german: string = "Installieren Sie den Agenten auf dem Host.";

  test("its markdown is the language's: the intro, Before you start, each step's body, tab and details, each topic", () => {
    const drawn: SetupGuideContent = translateSetupGuideContent(
      content,
      wordsIn("de", GERMAN),
    );

    expect(drawn.language).toBe("de");
    expect(drawn.intro).toBe(german);
    expect(drawn.prerequisites).toEqual([german]);
    expect(drawn.steps[0]!.markdown).toBe(german);
    expect(drawn.steps[0]!.variants![0]!.markdown).toBe(german);
    expect(drawn.steps[0]!.details).toBe(german);
    expect(drawn.advanced![0]!.markdown).toBe(german);
    expect(drawn.troubleshooting![0]!.markdown).toBe(german);
  });

  test("its titles, descriptions, notes, tabs and links stay keys, for the card to word from the locale files", () => {
    const drawn: SetupGuideContent = translateSetupGuideContent(
      content,
      wordsIn("de", GERMAN),
    );

    expect(drawn.steps[0]!.title).toBe("Run the agent");
    expect(drawn.steps[0]!.description).toBe(content.steps[0]!.description);
    expect(drawn.steps[0]!.note).toBe(content.steps[0]!.note);
    expect(drawn.steps[0]!.variants![0]!.label).toBe("Docker CLI");
    expect(drawn.advanced![0]!.title).toBe(content.advanced![0]!.title);
    expect(drawn.advanced![0]!.summary).toBe(content.advanced![0]!.summary);
    expect(drawn.links).toEqual(content.links);
  });

  test("the English guide is not changed", () => {
    const before: string = JSON.stringify(content);

    translateSetupGuideContent(content, wordsIn("de", GERMAN));

    expect(JSON.stringify(content)).toBe(before);
    expect(content.language).toBeUndefined();
  });

  test("its pieces with words are listed in reading order, every markdown of it", () => {
    expect(getSetupGuideWordPieces(content)).toEqual(
      new Array(7).fill("Install the agent on the host."),
    );
  });

  test("a guide with nothing to word, as the card draws it before a key", () => {
    const empty: SetupGuideContent = { steps: [{ title: "Run the agent" }] };

    expect(translateSetupGuideContent(empty, wordsIn("de", GERMAN))).toEqual({
      steps: [{ title: "Run the agent" }],
      language: "de",
      intro: undefined,
      prerequisites: undefined,
      advanced: undefined,
      troubleshooting: undefined,
    });
  });
});

describe("which words a reader reads", () => {
  const translations: SetupGuideTranslations = {
    de: async () => {
      return { default: { "Run it.": "Führen Sie es aus." } };
    },
    es: async () => {
      throw new Error("The chunk could not be fetched.");
    },
    it: async () => {
      return { default: {} };
    },
    fr: async () => {
      return { default: undefined as unknown as SetupGuideTranslation };
    },
  };

  test("the reader's, when the guide has them", async () => {
    const words: SetupGuideWords | null = await loadSetupGuideWords({
      language: "de",
      translations,
    });

    expect(words?.language).toBe("de");
    expect(translateSetupGuidePiece("Run it.", words!)).toBe(
      "Führen Sie es aus.",
    );
  });

  test("the guide as written for English, without fetching anything", async () => {
    let fetched: boolean = false;

    expect(
      await loadSetupGuideWords({
        language: "en",
        translations: {
          en: async () => {
            fetched = true;
            return { default: { "Run it.": "Never." } };
          },
        },
      }),
    ).toBeNull();
    expect(fetched).toBe(false);
  });

  test.each([
    // A chunk that cannot be fetched, holds nothing, or is not a table.
    "es",
    "it",
    "fr",
    // A language the guide has no words in, and no language at all.
    "xx",
    "",
    // Never a name of the object's own.
    "constructor",
    "__proto__",
    "toString",
  ])("%j reads the guide as written", async (language: string) => {
    expect(await loadSetupGuideWords({ language, translations })).toBeNull();
  });

  test("a language with spaces around it is still that language", async () => {
    expect(
      (await loadSetupGuideWords({ language: " de ", translations }))?.language,
    ).toBe("de");
  });
});

describe("the checks above (negative control)", () => {
  test("a translation whose code differs from the English's would not match: its spans are replaced, never trusted", () => {
    const way: SetupGuideWay =
      SETUP_GUIDE_DOCUMENTATION_PRODUCTS[0]!.ways()[0]!;
    const piece: string = getSetupGuideWordPieces(way.content).find(
      (candidate: string): boolean => {
        return candidate.includes("`");
      },
    )!;
    const words: SetupGuideWords = wordsIn("de", {
      [piece]: piece.replace(/`[^`]+`/, "`übersetzt`"),
    });

    // The translated span is not the English's, so it is kept as written.
    expect(translateSetupGuidePiece(piece, words)).toContain("`übersetzt`");
  });
});
