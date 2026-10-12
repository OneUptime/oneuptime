import {
  DocsLanguageDirection,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DOCS_LANGUAGES,
  DocsFence,
  listPages,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  CssRule,
  DOCS_STYLESHEET,
  declaredIn,
  readCssRules,
} from "./DocsStylesheet";
import {
  DrawnDiagramLine,
  drawnDiagramLines,
  drawnOrder,
  firstLetterDirection,
  linesLaidOutBackwards,
  meantDirection,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * EVERY LINE OF EVERY DIAGRAM READS IN THE ORDER IT WAS WRITTEN, ON EVERY
 * DOCS PAGE, IN EVERY LANGUAGE.
 *
 * Mermaid lays a diagram out left to right on every page, and the docs keep
 * its box that way (.docs-diagram). The words in it are translated, though,
 * and a line of text is laid out in one direction or the other. Since #4688
 * each line took the direction of its first letter (unicode-bidi:
 * plaintext), so a Persian line that opened with a Latin word ("OneUptime
 * حساب", the OneUptime account) was laid out left to right and read back to
 * front, and a sequence diagram's text, which that rule never reached, was
 * laid out left to right whatever it said (#4694 counted 88 such label lines
 * on 51 pages; a browser found 171 lines on 80 Persian pages). Now a
 * right-to-left page lays every line of a diagram out right to left, as its
 * paragraphs are, and a left-to-right page keeps each line's first letter.
 *
 * linesLaidOutBackwards (DocsTranslationChecks) models that, line by line,
 * with the Unicode Bidirectional Algorithm, and this suite holds every page
 * to it: a line reads in the direction of its script, and on a right-to-left
 * page a line of Latin words only ("200 OK", "~/.codex/config.toml") must
 * read the same laid out right to left: start with a letter, and end with a
 * letter or a digit. Its first part checks the stylesheet still lays
 * the lines out the way the model says; the model's layouts below were each
 * checked against Chromium's, pixel for pixel.
 */

// The rules a right-to-left page lays a diagram's lines out with.
const RIGHT_TO_LEFT_SELECTORS: Array<string> = [
  ".docs-diagram:dir(rtl) .mermaid foreignObject div",
  ".docs-diagram:dir(rtl) .mermaid foreignObject p",
  ".docs-diagram:dir(rtl) .mermaid text",
  ".docs-diagram:dir(rtl) .docs-diagram__caption",
];

// The rules a left-to-right page lays a label's lines and the caption out with.
const FIRST_LETTER_SELECTORS: Array<string> = [
  ".docs-diagram .mermaid foreignObject div",
  ".docs-diagram .mermaid foreignObject p",
  ".docs-diagram .docs-diagram__caption",
];

const RULES: Array<CssRule> = readCssRules(DOCS_STYLESHEET);
const MERMAID_FENCE: string = "```mermaid";

function diagramsOf(markdown: string): Array<DocsFence> {
  return scanMarkdown(markdown).fences.filter((fence: DocsFence): boolean => {
    return fence.lang === "mermaid";
  });
}

// The pages of a language that draw a diagram.
function pagesWithDiagrams(language: string): Array<string> {
  return listPages(language).filter((page: string): boolean => {
    return readPage(language, page).includes(MERMAID_FENCE);
  });
}

function fence(code: string, title?: string): DocsFence {
  return {
    info: title === undefined ? "mermaid" : `mermaid title="${title}"`,
    lang: "mermaid",
    code: code,
    line: 1,
  };
}

function textsOf(lines: Array<DrawnDiagramLine>): Array<string> {
  return lines.map((line: DrawnDiagramLine): string => {
    return line.text;
  });
}

function page(code: string, title?: string): string {
  return [
    "# A page",
    "",
    `${MERMAID_FENCE}${title === undefined ? "" : ` title="${title}"`}`,
    code,
    "```",
    "",
  ].join("\n");
}

describe("the stylesheet lays a diagram's lines out as the checks model them", () => {
  it.each(RIGHT_TO_LEFT_SELECTORS)(
    "a right-to-left page lays every line of %s out right to left",
    (selector: string) => {
      expect(declaredIn(RULES, selector, "direction")).toBe("rtl");
      expect(declaredIn(RULES, selector, "unicode-bidi")).toBe("isolate");
    },
  );

  it.each(FIRST_LETTER_SELECTORS)(
    "a left-to-right page lays each line of %s out in the direction of its first letter",
    (selector: string) => {
      expect(declaredIn(RULES, selector, "unicode-bidi")).toBe("plaintext");
      expect(declaredIn(RULES, selector, "direction")).toBeUndefined();
    },
  );

  it("a left-to-right page leaves a sequence diagram's text left to right, like the diagram", () => {
    expect(declaredIn(RULES, ".docs-diagram", "direction")).toBe("ltr");

    // Only the right-to-left rule names a diagram's SVG text.
    expect(
      RULES.flatMap((rule: CssRule): Array<string> => {
        return rule.selectors;
      }).filter((selector: string): boolean => {
        return selector.includes(".mermaid text");
      }),
    ).toEqual([".docs-diagram:dir(rtl) .mermaid text"]);
  });
});

describe("every docs page", () => {
  it("is checked in at least one right-to-left language, so the check bites", () => {
    const rightToLeft: Array<string> = DOCS_LANGUAGES.filter(
      (language: string): boolean => {
        return getDocsLanguageDirection(language) === "rtl";
      },
    );

    expect(rightToLeft).toContain("fa");

    for (const language of rightToLeft) {
      expect(pagesWithDiagrams(language).length).toBeGreaterThan(100);
    }
  });

  describe.each(DOCS_LANGUAGES)("in %s", (language: string) => {
    const direction: DocsLanguageDirection = getDocsLanguageDirection(language);

    it.each(pagesWithDiagrams(language))(
      "%s lays out every line of its diagrams in the order it reads",
      (pagePath: string) => {
        expect(
          linesLaidOutBackwards(readPage(language, pagePath), direction),
        ).toEqual([]);
      },
    );
  });

  it("would read the Persian lines that open with a Latin word back to front, laid out by their first letter", () => {
    /*
     * The lines the right-to-left rule is there for, on the Persian pages as
     * they are: laid out by their first letter, as before it, each would
     * read back to front.
     */
    const openWithALatinWord: Array<string> = pagesWithDiagrams("fa")
      .flatMap((pagePath: string): Array<DocsFence> => {
        return diagramsOf(readPage("fa", pagePath));
      })
      .flatMap(drawnDiagramLines)
      .map((line: DrawnDiagramLine): string => {
        return line.text;
      })
      .filter((line: string): boolean => {
        return (
          meantDirection(line) === "rtl" &&
          firstLetterDirection(line) === "ltr" &&
          drawnOrder(line, "ltr") !== drawnOrder(line, "rtl")
        );
      });

    expect(openWithALatinWord.length).toBeGreaterThan(88);
    expect(openWithALatinWord).toContain("OneUptime حساب");
  });
});

describe("drawnOrder lays a line out as a browser does", () => {
  /*
   * Each line with the order Chromium draws it in right to left, read from
   * left to right: the visual string drawn left to right matched the line
   * drawn right to left, pixel for pixel. Left to right, a line of Latin
   * words only is drawn as written.
   */
  it.each([
    ["Rule 1:", ":Rule 1"],
    ["200 OK", "OK 200"],
    ["404: Status Page", "Status Page :404"],
    ["oneuptime.slo.*", "*.oneuptime.slo"],
    ["(v2c) SNMP", "SNMP (v2c)"],
    ["5 / 10", "10 / 5"],
    ["1.5 GB", "GB 1.5"],
    ["~/.codex/config.toml", "codex/config.toml./~"],
    ["Proxmox VE 9+", "+Proxmox VE 9"],
    ["Team Settings →", "→ Team Settings"],
    ["OTEL_RESOURCE_", "_OTEL_RESOURCE"],
    ["otelcol-contrib:", ":otelcol-contrib"],
    [
      "POST /notification/incoming-call/dial-status/...",
      ".../POST /notification/incoming-call/dial-status",
    ],
    ["#1 on call", "on call #1"],
    ["-5", "5-"],
  ])("draws %j right to left as %j", (line: string, rightToLeft: string) => {
    expect(drawnOrder(line, "rtl")).toBe(rightToLeft);
    expect(drawnOrder(line, "ltr")).toBe(line);
  });

  it.each([
    "HTTP 200 OK",
    "oneuptime.slo",
    "404",
    "(beta)",
    "<beta>",
    "[Every 10 seconds]",
    "SNMP (v2c)",
    "CPU 80%",
    "4xx",
    "x2",
    "config.toml (~/.codex)",
    "a → b",
    "→",
    "OTEL_RESOURCE_ATTRIBUTES",
    "receivers, resourcedetection",
    "localhost:4318",
    "POST /notification/incoming-call/dial-status",
  ])("draws %j the same either way", (line: string) => {
    expect(drawnOrder(line, "rtl")).toBe(line);
    expect(drawnOrder(line, "ltr")).toBe(line);
  });

  it("draws the first word of a right-to-left line rightmost, a Latin one too", () => {
    expect(drawnOrder("OneUptime حساب", "rtl")?.endsWith("OneUptime")).toBe(
      true,
    );
    // Left to right, the Latin word comes first, and a Persian reader meets it last.
    expect(drawnOrder("OneUptime حساب", "ltr")?.startsWith("OneUptime")).toBe(
      true,
    );
    expect(drawnOrder("OTLP به localhost:4318", "rtl")).toBe(
      "localhost:4318 هب OTLP",
    );
  });

  it("draws the comma that ends a right-to-left line at its left end", () => {
    const line: string = "امضا و صادرکننده را بررسی می‌کند،";

    expect(drawnOrder(line, "rtl")?.startsWith("،")).toBe(true);
    // Left to right, the comma is drawn at the right end: the first thing a Persian reader meets.
    expect(drawnOrder(line, "ltr")?.endsWith("،")).toBe(true);
  });

  it("reads Persian digits, and Latin ones after Persian words, in a right-to-left line's order", () => {
    // "۷ روز" (7 days): the number first, so rightmost.
    expect(drawnOrder("۷ روز", "rtl")).toBe("زور ۷");
    // A Latin number after Persian words stays whole, at their left.
    expect(drawnOrder("نسخه 12", "rtl")).toBe("12 هخسن");
  });

  it("leaves out the zero-width characters it never draws: joiners and direction marks", () => {
    expect(drawnOrder("می‌کند", "rtl")).toBe("دنکیم");
    expect(drawnOrder("‏GET یا POST", "rtl")).toBe("POST ای GET");
    expect(drawnOrder("a‎b", "ltr")).toBe("ab");
  });

  it("refuses a line with an explicit embedding, override or isolate", () => {
    expect(drawnOrder("a‫b", "rtl")).toBeNull();
    expect(drawnOrder("a⁧b⁩", "ltr")).toBeNull();
  });
});

describe("firstLetterDirection and meantDirection", () => {
  it("find the direction of a line's first letter, as unicode-bidi: plaintext does", () => {
    expect(firstLetterDirection("OneUptime حساب")).toBe("ltr");
    expect(firstLetterDirection("حساب OneUptime")).toBe("rtl");
    expect(firstLetterDirection("2xx یا 3xx")).toBe("ltr");
    expect(firstLetterDirection("۲۰۰ OK")).toBe("ltr");
    expect(firstLetterDirection("(200)")).toBeNull();
  });

  it("mean a line holding a right-to-left letter, digit or comma to read right to left", () => {
    expect(meantDirection("OneUptime حساب")).toBe("rtl");
    expect(meantDirection("HTTP، TCP، ping،")).toBe("rtl");
    expect(meantDirection("۷")).toBe("rtl");
    expect(meantDirection("Elastic Beanstalk")).toBe("ltr");
    expect(meantDirection("~/.codex/config.toml")).toBe("ltr");
  });
});

describe("drawnDiagramLines reads every line a diagram draws", () => {
  // Line by line: its quoted labels, then its links' labels, then its nodes'.
  it("reads a flowchart's labels, quoted or not, in every shape, broken at each <br/>", () => {
    const code: string = [
      "flowchart LR",
      '    a["Quoted<br/>label"] -->|"Quoted link"| b[Square]',
      "    b --> c(Round) --> d{Decision} --> e((Circle))",
      "    e --> f([Stadium]) --> g[[Subroutine]] --> h[(Database)]",
      "    h --> i{{Hexagon}} --> j>Asymmetric] --> k[/Slanted/]",
      "    k --> l[\\Back\\] -->|Bare link| m[Line one<br>Line two<br />Line three]",
      "    m -- Inline link --> n",
      '    subgraph s["A subgraph"]',
      "        n",
      "    end",
      "    classDef hot fill:#f96",
      "    class a hot",
      "    style b fill:#9cf",
      '    click a "https://example.com" "A tooltip"',
      "    linkStyle 0 stroke:#f00",
    ].join("\n");

    expect(textsOf(drawnDiagramLines(fence(code, "A title")))).toEqual([
      "A title",
      "Quoted",
      "label",
      "Quoted link",
      "Square",
      "Round",
      "Decision",
      "Circle",
      "Stadium",
      "Subroutine",
      "Database",
      "Hexagon",
      "Asymmetric",
      "Slanted",
      "Bare link",
      "Back",
      "Line one",
      "Line two",
      "Line three",
      "Inline link",
      "A subgraph",
    ]);
  });

  it("never reads the > of an arrow as a node's shape", () => {
    const code: string = [
      "flowchart TB",
      "    A[Agent emits<br/>gen_ai.* spans] --> B[OneUptime]",
      "    B -->|Alert created| C[Workflow<br/>Alert On Create]",
      "    C ==> D[Done]",
    ].join("\n");

    expect(textsOf(drawnDiagramLines(fence(code)))).toEqual([
      "Agent emits",
      "gen_ai.* spans",
      "OneUptime",
      "Alert created",
      "Workflow",
      "Alert On Create",
      "Done",
    ]);
  });

  it("leaves comments out, and never reads the node between two open links as a link's label", () => {
    const flowchart: string = [
      "flowchart LR",
      '    %% A comment: a["Not drawn"]',
      "    A --- B --- C",
      "    C -- A label --- D",
    ].join("\n");
    const sequence: string = [
      "sequenceDiagram",
      "    %% Alice->>Bob: Not drawn",
      "    Alice->>Bob: Drawn",
    ].join("\n");
    const state: string = [
      "stateDiagram-v2",
      "    %% Ready : Not drawn",
      '    Ready --> Done: say "hi"',
    ].join("\n");

    expect(textsOf(drawnDiagramLines(fence(flowchart)))).toEqual(["A label"]);
    expect(textsOf(drawnDiagramLines(fence(sequence)))).toEqual([
      "Alice",
      "Bob",
      "Drawn",
    ]);
    // A transition's label is read whole, quotes and all.
    expect(textsOf(drawnDiagramLines(fence(state)))).toEqual([
      'say "hi"',
      "Ready",
      "Done",
    ]);
  });

  it("collapses a label's spaces as the label draws them", () => {
    expect(
      textsOf(
        drawnDiagramLines(fence('flowchart LR\n  a["  Two   spaces <br/>  "]')),
      ),
    ).toEqual(["Two spaces"]);
  });

  it("reads a sequence diagram's names, messages, notes and block labels, as SVG text", () => {
    const code: string = [
      "sequenceDiagram",
      "    actor U as Person",
      "    participant OneUptime",
      "    participant T as Twilio",
      "    U->>OneUptime: Sign in<br/>with SSO",
      "    OneUptime-->>T: POST /voice",
      "    OneUptime-xIdP: A failed call",
      "    Note over U,OneUptime: Checks the signature",
      "    Note right of T: A note",
      "    loop Every 10 seconds",
      "        T-)OneUptime: Heartbeat",
      "    end",
      "    alt The step failed",
      "        OneUptime->>U: Error",
      "    else",
      "        OneUptime->>U: Done",
      "    end",
    ].join("\n");
    const lines: Array<DrawnDiagramLine> = drawnDiagramLines(fence(code));

    expect(textsOf(lines)).toEqual([
      "Person",
      "OneUptime",
      "Twilio",
      "Sign in",
      "with SSO",
      "POST /voice",
      // A participant no line declares is drawn under its name.
      "IdP",
      "A failed call",
      "Checks the signature",
      "A note",
      // mermaid draws a block's label in brackets.
      "[Every 10 seconds]",
      "Heartbeat",
      "[The step failed]",
      "Error",
      "Done",
    ]);
    expect(
      lines.every((line: DrawnDiagramLine): boolean => {
        return line.svg;
      }),
    ).toBe(true);
  });

  it("reads a state diagram's states, descriptions and transition labels", () => {
    const code: string = [
      "stateDiagram-v2",
      "    direction LR",
      '    state "Reporting" as Reporting',
      "    Archived : Kept for 7 days",
      "    [*] --> Reporting: First metric",
      "    Reporting --> Archived: 7 days<br/>without data",
      "    Archived --> Deleted",
      "    Deleted --> [*]",
    ].join("\n");

    expect(textsOf(drawnDiagramLines(fence(code, "A state")))).toEqual([
      "A state",
      "Reporting",
      "Kept for 7 days",
      "First metric",
      "7 days",
      "without data",
      // A state with no description is drawn under its name.
      "Deleted",
    ]);
  });

  it("reads a title written in single quotes, and draws it as the caption, as HTML", () => {
    const lines: Array<DrawnDiagramLine> = drawnDiagramLines({
      info: "mermaid title='A caption'",
      lang: "mermaid",
      code: "sequenceDiagram\n    A->>B: Hi",
      line: 1,
    });

    expect(lines[0]).toEqual({ text: "A caption", svg: false });
  });
});

describe("linesLaidOutBackwards", () => {
  const persianFlowchart: string = [
    "flowchart TB",
    '    a["OneUptime حساب<br/>Opsgenie شما"] -->|"OTLP به<br/>localhost:4318"| b["OneUptime"]',
    '    b --> c["ارسال، که همراه<br/>فرم نگه داشته می‌شود"]',
  ].join("\n");

  it("finds nothing on a right-to-left page whose Persian lines open with Latin words", () => {
    expect(linesLaidOutBackwards(page(persianFlowchart), "rtl")).toEqual([]);
  });

  it("finds, on a right-to-left page, a line of Latin words only that punctuation or a number starts or ends", () => {
    const flowchart: string = [
      "flowchart TB",
      '    a["Rule 1:<br/>هر قاعده"] --> b["200 OK"]',
      '    b --> c["HTTP 200 OK"] --> d["~/.codex/config.toml"]',
      '    d --> e["config.toml (~/.codex)"] --> f["SNMP (v2c)"]',
    ].join("\n");

    expect(linesLaidOutBackwards(page(flowchart), "rtl")).toEqual([
      "Rule 1:",
      "200 OK",
      "~/.codex/config.toml",
    ]);
    // Left to right, each of them reads as written.
    expect(linesLaidOutBackwards(page(flowchart), "ltr")).toEqual([]);
  });

  it("finds, on a left-to-right page, a Persian label line that opens with a Latin word, as its first letter lays it out", () => {
    expect(linesLaidOutBackwards(page(persianFlowchart), "ltr")).toEqual([
      "OneUptime حساب",
      "Opsgenie شما",
      "OTLP به",
    ]);
  });

  it("finds a sequence diagram's Persian line on a left-to-right page, where its SVG text is left to right", () => {
    const sequence: string = [
      "sequenceDiagram",
      "    participant P as پراب",
      "    P->>P: امضا را بررسی می‌کند،",
    ].join("\n");

    expect(linesLaidOutBackwards(page(sequence), "ltr")).toEqual([
      "امضا را بررسی می‌کند،",
    ]);
    expect(linesLaidOutBackwards(page(sequence), "rtl")).toEqual([]);
  });

  it("checks a diagram's title, which the page draws as its caption", () => {
    expect(
      linesLaidOutBackwards(page("flowchart LR\n  a --> b", "Rule 1:"), "rtl"),
    ).toEqual(["Rule 1:"]);
    expect(
      linesLaidOutBackwards(
        page("flowchart LR\n  a --> b", "OneUptime چگونه وارد می‌شود"),
        "rtl",
      ),
    ).toEqual([]);
  });

  it("finds a line with an explicit embedding or isolate, which no diagram needs", () => {
    expect(
      linesLaidOutBackwards(page('flowchart LR\n  a["a⁧b⁩"]'), "rtl"),
    ).toEqual(["a⁧b⁩"]);
  });

  it("reads only the page's diagrams, not its prose or other code", () => {
    const markdown: string = [
      "# Rule 1:",
      "",
      "200 OK",
      "",
      "```text",
      "Rule 1:",
      "```",
      "",
    ].join("\n");

    expect(linesLaidOutBackwards(markdown, "rtl")).toEqual([]);
  });
});
