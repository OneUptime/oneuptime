import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import HyphenatedWords from "../../../UI/Components/HyphenatedWords/HyphenatedWords";
import {
  DrawnWords,
  getDrawnWords,
  LongWordHyphenation,
  WORDS_BREAK_CLASS_NAME,
  WordRun,
} from "../../../UI/Components/HyphenatedWords/LongWords";
import Route from "../../../Types/API/Route";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import {
  SIDE_MENU_ITEM_BADGES_TEST_ID,
  SIDE_MENU_ITEM_CONTENT_TEST_ID,
} from "../../../UI/Components/SideMenu/SideMenuEntryState";

/*
 * Only a long word may be hyphenated (HyphenatedWords, LongWords).
 *
 * Firefox and Safari hyphenate whatever word ends a line, where Chrome moves
 * it whole to the next: "Richtlinien für einge- / hende Anrufe". The side
 * menu and the telemetry tiles kept that to their long words with
 * `hyphenate-limit-chars` on the whole title, which Safari does not read -
 * so in Safari every word of a title that held one long word could be
 * hyphenated. The long words alone carry `hyphens: auto` now, each in a
 * span of its own when shorter words are beside them, so every engine
 * hyphenates nothing else.
 */

const RULE: LongWordHyphenation = {
  minimumWordLength: 14,
  longWordClassName: "hyphens-auto test-long-word",
};

function runsOf(
  text: string | undefined,
  lang: string | undefined,
): Array<WordRun> {
  return getDrawnWords({ text, lang, rule: RULE }).runs;
}

function hyphenated(text: string, lang: string = "de"): Array<string> {
  return runsOf(text, lang)
    .filter((run: WordRun): boolean => {
      return run.mayHyphenate;
    })
    .map((run: WordRun): string => {
      return run.text;
    });
}

afterEach(() => {
  cleanup();
});

describe("how words break (getDrawnWords)", () => {
  test("words left in English break between words only: their titles were written to fit", () => {
    expect(
      getDrawnWords({ text: "Recommendations", lang: undefined, rule: RULE }),
    ).toEqual({
      className: WORDS_BREAK_CLASS_NAME,
      runs: [{ text: "Recommendations", mayHyphenate: false }],
    });
  });

  test("no text, no runs", () => {
    for (const text of ["", undefined]) {
      expect(getDrawnWords({ text, lang: "de", rule: RULE })).toEqual({
        className: WORDS_BREAK_CLASS_NAME,
        runs: [],
      });
    }
  });

  test("a title of words that fit a line each is never hyphenated", () => {
    for (const text of [
      "Richtlinien für eingehende Anrufe",
      "Règles de taux de consommation",
      "Abonnenten-Einstellungen",
      "Microsoft Teams-Abonnenten",
    ]) {
      expect(getDrawnWords({ text, lang: "de", rule: RULE })).toEqual({
        className: WORDS_BREAK_CLASS_NAME,
        runs: [{ text, mayHyphenate: false }],
      });
    }
  });

  test("a title of one long word may be hyphenated as it is: no span inside it", () => {
    const drawn: DrawnWords = getDrawnWords({
      text: "Benachrichtigungsprotokolle",
      lang: "de",
      rule: RULE,
    });

    expect(drawn.className).toBe(
      `${WORDS_BREAK_CLASS_NAME} ${RULE.longWordClassName}`,
    );
    expect(drawn.runs).toEqual([
      { text: "Benachrichtigungsprotokolle", mayHyphenate: false },
    ]);
  });

  test("punctuation is no word: a long word and a slash are drawn as one long word", () => {
    expect(
      getDrawnWords({
        text: "Benachrichtigungsprotokolle /",
        lang: "de",
        rule: RULE,
      }).className,
    ).toContain(RULE.longWordClassName);
    expect(hyphenated("Benachrichtigungsprotokolle /")).toEqual([]);
  });

  test("beside shorter words, each long word is a run of its own, and nothing else is", () => {
    expect(runsOf("Zeitachse der Bereitschaftspläne", "de")).toEqual([
      { text: "Zeitachse der ", mayHyphenate: false },
      { text: "Bereitschaftspläne", mayHyphenate: true },
    ]);
    expect(runsOf("Benutzerdefinierte Felder", "de")).toEqual([
      { text: "Benutzerdefinierte", mayHyphenate: true },
      { text: " Felder", mayHyphenate: false },
    ]);
    expect(
      hyphenated("Benachrichtigungsprotokolle für Bereitschaftspläne"),
    ).toEqual(["Benachrichtigungsprotokolle", "Bereitschaftspläne"]);
    expect(
      getDrawnWords({
        text: "Zeitachse der Bereitschaftspläne",
        lang: "de",
        rule: RULE,
      }).className,
    ).toBe(WORDS_BREAK_CLASS_NAME);
  });

  test("a compound's own hyphen ends a word, and stays where it was", () => {
    expect(runsOf("Abonnenten-Benachrichtigungsprotokolle", "de")).toEqual([
      { text: "Abonnenten-", mayHyphenate: false },
      { text: "Benachrichtigungsprotokolle", mayHyphenate: true },
    ]);
    // U+2010, the hyphen proper.
    expect(hyphenated("Kurz\u{2010}Benachrichtigungsprotokolle")).toEqual([
      "Benachrichtigungsprotokolle",
    ]);
  });

  test("the runs are the text, every character in its place", () => {
    for (const text of [
      "Zeitachse  der   Bereitschaftspläne",
      " Benutzerdefinierte Felder ",
      "Benachrichtigungsprotokolle der Bereitschaftspläne (p95)",
      "Пользовательские домены",
    ]) {
      expect(
        runsOf(text, "de")
          .map((run: WordRun): string => {
            return run.text;
          })
          .join(""),
      ).toBe(text);
    }
  });

  test("counts letters, whatever their script and however many UTF-16 units", () => {
    expect(hyphenated("ab " + "a".repeat(14))).toEqual(["a".repeat(14)]);
    expect(hyphenated("ab " + "a".repeat(13))).toEqual([]);
    // Thirteen letters each written in two UTF-16 units: still thirteen.
    expect(hyphenated("ab " + "\u{1D400}".repeat(13))).toEqual([]);
    expect(hyphenated("ab " + "\u{1D400}".repeat(14))).toEqual([
      "\u{1D400}".repeat(14),
    ]);
    // Cyrillic: Пользовательские is sixteen letters.
    expect(hyphenated("Пользовательские домены", "ru")).toEqual([
      "Пользовательские",
    ]);
  });

  test("the rule's own length decides", () => {
    const tile: LongWordHyphenation = {
      minimumWordLength: 10,
      longWordClassName: "hyphens-auto tile",
    };

    expect(
      getDrawnWords({ text: "Carregamentos de página", lang: "pt", rule: tile })
        .runs,
    ).toEqual([
      { text: "Carregamentos", mayHyphenate: true },
      { text: " de página", mayHyphenate: false },
    ]);
    expect(
      getDrawnWords({ text: "Consultas de página", lang: "pt", rule: tile })
        .runs,
    ).toEqual([{ text: "Consultas de página", mayHyphenate: false }]);
  });
});

describe("drawn (HyphenatedWords)", () => {
  function draw(text: string | undefined, lang: string | undefined): Element {
    const rendered: RenderResult = render(
      <span data-testid="title" lang={lang}>
        <HyphenatedWords text={text} lang={lang} rule={RULE} />
      </span>,
    );

    return rendered.getByTestId("title");
  }

  test("a long word beside short ones is a span with the rule's classes; the rest is text", () => {
    const title: Element = draw("Zeitachse der Bereitschaftspläne", "de");
    const spans: Array<Element> = Array.from(title.querySelectorAll("span"));

    expect(title).toHaveTextContent("Zeitachse der Bereitschaftspläne");
    expect(
      spans.map((span: Element): string => {
        return span.textContent || "";
      }),
    ).toEqual(["Bereitschaftspläne"]);
    expect(spans[0]).toHaveClass("hyphens-auto", "test-long-word");
    expect(title.textContent).toBe("Zeitachse der Bereitschaftspläne");
  });

  test("English, short words and one long word are drawn as plain text", () => {
    for (const [text, lang] of [
      ["Recommendations", undefined],
      ["Richtlinien für eingehende Anrufe", "de"],
      ["Benachrichtigungsprotokolle", "de"],
    ] as Array<[string, string | undefined]>) {
      const title: Element = draw(text, lang);

      expect(title.querySelectorAll("span")).toHaveLength(0);
      expect(title.textContent).toBe(text);
      cleanup();
    }
  });

  test("no text draws nothing", () => {
    expect(draw(undefined, "de").textContent).toBe("");
  });
});

/*
 * Beside a 224 pixel menu a count leaves a title some 120 pixels, and
 * "Recommendations" (131) broke there as "Recommendatio / ns", without a
 * hyphen. A row lays its title out at its narrowest and wraps the badge
 * onto the line below, at the row's end, when even that does not fit
 * beside it; the browser suite (RulesMenuSection/SideMenuWordBreaks)
 * measures it. Here, the classes it rests on.
 */
describe("a menu row's badge moves under a title it cannot share a line with", () => {
  test("the row wraps, its title is laid out at its narrowest, and the badge keeps to the row's end", () => {
    const rendered: RenderResult = render(
      <SideMenuItem
        link={{ title: "Recommendations", to: new Route("/k8s/1/recs") }}
        badge={12}
      />,
    );

    const content: HTMLElement = rendered.getByTestId(
      SIDE_MENU_ITEM_CONTENT_TEST_ID,
    );
    const badges: HTMLElement = rendered.getByTestId(
      SIDE_MENU_ITEM_BADGES_TEST_ID,
    );
    const row: HTMLElement = content.closest("a")!;

    expect(row).toHaveClass("flex", "flex-wrap", "gap-x-2", "justify-between");
    expect(content).toHaveClass("w-min", "min-w-0", "grow");
    expect(badges).toHaveClass("ml-auto", "flex-shrink-0", "h-5");
    // The gap between title and badge is the row's: no margin of its own.
    expect(badges).not.toHaveClass("ml-2");
    expect(badges).toHaveTextContent("12");
  });

  test("a row without a badge draws no badge container", () => {
    const rendered: RenderResult = render(
      <SideMenuItem link={{ title: "Overview", to: new Route("/k8s/1") }} />,
    );

    expect(
      rendered.queryByTestId(SIDE_MENU_ITEM_BADGES_TEST_ID),
    ).not.toBeInTheDocument();
    expect(rendered.getByTestId(SIDE_MENU_ITEM_CONTENT_TEST_ID)).toHaveClass(
      "grow",
    );
  });

  /*
   * A count of none draws no badge. Its empty container took the row's gap
   * beside the title, and beside a title whose longest word filled the line
   * it would have wrapped onto a blank line of its own.
   */
  test("a count of none draws no badge container either; an alert beside it still does", () => {
    const rendered: RenderResult = render(
      <>
        <SideMenuItem
          link={{
            title: "Scheduled Maintenance",
            to: new Route("/k8s/1/maintenance"),
          }}
          badge={0}
        />
        <SideMenuItem
          link={{ title: "Incidents", to: new Route("/k8s/1/incidents") }}
          badge={0}
          showAlert={true}
        />
      </>,
    );

    const containers: Array<HTMLElement> = rendered.queryAllByTestId(
      SIDE_MENU_ITEM_BADGES_TEST_ID,
    );

    expect(containers).toHaveLength(1);
    expect(containers[0]!.closest("a")).toHaveTextContent("Incidents");
    // The alert, and no digit.
    expect(containers[0]!.querySelector("svg")).not.toBeNull();
    expect(containers[0]).not.toHaveTextContent("0");
  });
});
