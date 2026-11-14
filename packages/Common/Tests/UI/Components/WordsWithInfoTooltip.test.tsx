import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import WordsWithInfoTooltip, {
  INFO_GLUE_ATTRIBUTE,
} from "../../../UI/Components/Tooltip/WordsWithInfoTooltip";
import {
  getWordsBeforeInfo,
  INFO_AFTER_WORDS_CLASS_NAME,
  INFO_GLUE_CLASS_NAME,
  WordsBeforeInfo,
} from "../../../UI/Components/HyphenatedWords/WordsBeforeInfo";
import {
  LongWordHyphenation,
  WORDS_BREAK_CLASS_NAME,
} from "../../../UI/Components/HyphenatedWords/LongWords";

/*
 * A TITLE'S (i) FOLLOWS ITS LAST WORD (issue #7348).
 *
 * The (i) that explains a tile's title used to be the title's flex sibling.
 * A title too long for its column wraps, and a wrapped flex item takes all
 * the width it is offered: the (i) was drawn at the far edge of the tile,
 * between the two lines, as if it belonged to the next tile (German
 * "Hardware-Betriebszeit", Arabic "وقت تشغيل الجهاز المادي" on a network
 * device's hero). Now the (i) is drawn inside the title's own text, right
 * after its last word, glued to it by a word joiner in a box no line breaks
 * inside - so it moves with that word, after it, and on its left in a
 * language read from the right.
 *
 * jsdom lays nothing out, so what is pinned is the structure that decides
 * the layout: the (i) is a descendant of the element holding the words,
 * right after the last word, with nothing between them a line may break at.
 */

const RULE: LongWordHyphenation = {
  minimumWordLength: 10,
  longWordClassName: "inline-block max-w-full hyphens-auto test-long-word",
};

const TOOLTIP_DIR: string = path.resolve(
  __dirname,
  "../../../UI/Components/Tooltip",
);

afterEach(() => {
  cleanup();
});

// The box that glues the (i) to the word before it.
function glueOf(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[${INFO_GLUE_ATTRIBUTE}]`);
}

/*
 * The glue box holds the (i) alone - no space, nothing else a line could
 * break at - and is the box its stylesheet starts with a word joiner.
 */
function expectGlued(glue: HTMLElement | null, info: HTMLElement): void {
  expect(glue).not.toBeNull();
  expect(glue).toHaveClass("info-glue", "whitespace-nowrap");
  expect(glue!.childNodes).toHaveLength(1);
  expect(glue!.firstChild).toBe(info);
}

describe("the glue (WordsBeforeInfo, WordsWithInfoTooltip.css)", () => {
  test("is a box no line breaks inside, that a word joiner starts", () => {
    expect(INFO_GLUE_CLASS_NAME.split(" ")).toEqual([
      "info-glue",
      "whitespace-nowrap",
    ]);

    const css: string = fs.readFileSync(
      path.join(TOOLTIP_DIR, "WordsWithInfoTooltip.css"),
      "utf8",
    );
    const rule: RegExpMatchArray | null = css.match(
      /\.info-glue::before\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    // The CSS escape of U+2060 WORD JOINER, and nothing else.
    expect(rule![1]!.trim()).toBe(`content: "${String.fromCharCode(92)}2060";`);
  });

  test("the component brings the stylesheet with it", () => {
    expect(
      fs.readFileSync(
        path.join(TOOLTIP_DIR, "WordsWithInfoTooltip.tsx"),
        "utf8",
      ),
    ).toContain('import "./WordsWithInfoTooltip.css";');
  });
});

describe("the words before the (i) (getWordsBeforeInfo)", () => {
  test("without a rule: the words as one run, breaking between words, the (i) after them", () => {
    const words: WordsBeforeInfo = getWordsBeforeInfo({
      text: "Hardware uptime",
    });

    expect(words.className).toBe(WORDS_BREAK_CLASS_NAME);
    expect(words.runs).toEqual([
      { text: "Hardware uptime", mayHyphenate: false },
    ]);
    expect(words.isInfoInLastRun).toBe(false);
  });

  test("no words: no runs", () => {
    for (const text of ["", undefined]) {
      const words: WordsBeforeInfo = getWordsBeforeInfo({ text });
      expect(words.runs).toEqual([]);
      expect(words.isInfoInLastRun).toBe(false);
    }
  });

  describe("with a rule for long words (a telemetry tile's title)", () => {
    test("a long last word among short ones holds the (i) in its own box", () => {
      const words: WordsBeforeInfo = getWordsBeforeInfo({
        text: "Anzahl der Netzwerkschnittstellen",
        lang: "de",
        rule: RULE,
      });

      expect(words.className).toBe(WORDS_BREAK_CLASS_NAME);
      expect(words.runs).toEqual([
        { text: "Anzahl der ", mayHyphenate: false },
        { text: "Netzwerkschnittstellen", mayHyphenate: true },
      ]);
      expect(words.isInfoInLastRun).toBe(true);
    });

    test("a long word before a short last one: the (i) after the short one", () => {
      const words: WordsBeforeInfo = getWordsBeforeInfo({
        text: "Netzwerkschnittstellen aktiv",
        lang: "de",
        rule: RULE,
      });

      expect(words.runs).toEqual([
        { text: "Netzwerkschnittstellen", mayHyphenate: true },
        { text: " aktiv", mayHyphenate: false },
      ]);
      expect(words.isInfoInLastRun).toBe(false);
    });

    test("every word long: the element may be hyphenated, the (i) after its words", () => {
      const words: WordsBeforeInfo = getWordsBeforeInfo({
        text: "KNOTENVERFÜGBARKEIT",
        lang: "de",
        rule: RULE,
      });

      expect(words.className).toBe(
        `${WORDS_BREAK_CLASS_NAME} ${RULE.longWordClassName}`,
      );
      expect(words.runs).toEqual([
        { text: "KNOTENVERFÜGBARKEIT", mayHyphenate: false },
      ]);
      expect(words.isInfoInLastRun).toBe(false);
    });

    test("left in English (no lang), the rule hyphenates nothing", () => {
      const words: WordsBeforeInfo = getWordsBeforeInfo({
        text: "Interface utilization",
        rule: RULE,
      });

      expect(words.className).toBe(WORDS_BREAK_CLASS_NAME);
      expect(words.runs).toEqual([
        { text: "Interface utilization", mayHyphenate: false },
      ]);
      expect(words.isInfoInLastRun).toBe(false);
    });
  });
});

describe("WordsWithInfoTooltip, rendered", () => {
  test("the (i) is inside the element holding the words, right after the last word, glued to it", () => {
    render(
      <WordsWithInfoTooltip
        text="Hardware uptime"
        label="Hardware uptime"
        description="How long the device has run since its last restart."
        dataTestId="title"
        infoDataTestId="title-info"
      />,
    );

    const title: HTMLElement = screen.getByTestId("title");
    const info: HTMLElement = screen.getByTestId("title-info");
    const glue: HTMLElement | null = glueOf(title);

    expect(title).toContainElement(info);
    expect(title).toHaveClass(WORDS_BREAK_CLASS_NAME);
    expectGlued(glue, info);
    // The words, then the glue: the last thing in the title.
    expect(glue!.parentElement).toBe(title);
    expect(title.lastChild).toBe(glue);
    expect(glue!.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(glue!.previousSibling?.textContent).toBe("Hardware uptime");
  });

  test("the words stay one text, read and found as the title they are", () => {
    render(
      <WordsWithInfoTooltip
        text="Hardware uptime"
        label="Hardware uptime"
        description="How long the device has run since its last restart."
        dataTestId="title"
      />,
    );

    expect(screen.getByText("Hardware uptime")).toBe(
      screen.getByTestId("title"),
    );
    // Nothing hidden in it: the joiner is the stylesheet's, not the text's.
    expect(screen.getByTestId("title").textContent).toBe("Hardware uptime");
  });

  test("the (i) keeps its own label and focus ring, whatever words it follows", () => {
    render(
      <WordsWithInfoTooltip
        text="Hardware-Betriebszeit"
        label="Hardware uptime"
        description="How long the device has run since its last restart."
        infoDataTestId="title-info"
      />,
    );

    const info: HTMLElement = screen.getByTestId("title-info");
    expect(info.tagName).toBe("BUTTON");
    expect(screen.getByRole("button", { name: "About Hardware uptime" })).toBe(
      info,
    );
    expect(info).toHaveClass("focus-visible:ring-2");
    // After the word, at the middle of its letters, on the side it follows.
    for (const name of INFO_AFTER_WORDS_CLASS_NAME.split(" ")) {
      expect(info).toHaveClass(name);
    }
    expect(info).toHaveClass("ms-1");
    expect(info).not.toHaveClass("ml-1");
  });

  test("the (i)'s own classes join the ones that put it after the words", () => {
    render(
      <WordsWithInfoTooltip
        text="Clients"
        label="Clients"
        description="Platforms the app was used on."
        infoClassName="relative z-10"
        infoDataTestId="title-info"
      />,
    );

    const info: HTMLElement = screen.getByTestId("title-info");

    // A linked tile lifts it above the link laid over the tile.
    expect(info).toHaveClass("relative", "z-10", "ms-1", "align-middle");
    expectGlued(glueOf(document.body), info);
    cleanup();

    // Without any, only the ones that put it after the words.
    render(
      <WordsWithInfoTooltip
        text="Clients"
        label="Clients"
        description="Platforms the app was used on."
        infoDataTestId="title-info"
      />,
    );

    expect(screen.getByTestId("title-info")).not.toHaveClass("relative");
    expect(screen.getByTestId("title-info").className).not.toContain(
      "undefined",
    );
  });

  test("Arabic: the (i) follows the last word read, which a right-to-left line draws on its left", () => {
    render(
      <div dir="rtl">
        <WordsWithInfoTooltip
          text="وقت تشغيل الجهاز المادي"
          label="Hardware uptime"
          description="منذ آخر إعادة تشغيل."
          lang="ar"
          dataTestId="title"
          infoDataTestId="title-info"
        />
      </div>,
    );

    const title: HTMLElement = screen.getByTestId("title");
    const glue: HTMLElement | null = glueOf(title);
    expectGlued(glue, screen.getByTestId("title-info"));
    expect(glue!.previousSibling?.textContent).toBe("وقت تشغيل الجهاز المادي");
    // A logical margin: after the word, which is its left in Arabic.
    expect(screen.getByTestId("title-info")).toHaveClass("ms-1");
    expect(title).toHaveAttribute("lang", "ar");
  });

  test("Japanese: the words stay as they are, so the title still breaks between characters", () => {
    render(
      <WordsWithInfoTooltip
        text="ハードウェアの稼働時間"
        label="Hardware uptime"
        description="前回の再起動からの時間。"
        lang="ja"
        dataTestId="title"
        infoDataTestId="title-info"
      />,
    );

    const title: HTMLElement = screen.getByTestId("title");
    expect(title.firstChild?.textContent).toBe("ハードウェアの稼働時間");
    expectGlued(glueOf(title), screen.getByTestId("title-info"));
  });

  test("with no description: the words alone, no (i), no glue", () => {
    render(
      <WordsWithInfoTooltip
        text="Hardware uptime"
        label="Hardware uptime"
        description="   "
        dataTestId="title"
      />,
    );

    const title: HTMLElement = screen.getByTestId("title");
    expect(title.textContent).toBe("Hardware uptime");
    expect(screen.queryByRole("button")).toBeNull();
    expect(glueOf(title)).toBeNull();
  });

  test("the caller's classes and the rule's sit on the element holding the words", () => {
    render(
      <WordsWithInfoTooltip
        text="Anzahl der Netzwerkschnittstellen"
        label="Interface count"
        description="Wie viele Schnittstellen."
        lang="de"
        rule={RULE}
        className="min-w-0 uppercase"
        dataTestId="title"
        infoDataTestId="title-info"
      />,
    );

    const title: HTMLElement = screen.getByTestId("title");
    expect(title).toHaveClass("min-w-0", "uppercase", WORDS_BREAK_CLASS_NAME);
    expect(title).toHaveAttribute("lang", "de");

    /*
     * A long last word is drawn in its own box (an inline block, which a
     * line may break around): the (i) is glued inside that box, after it.
     */
    const longWord: HTMLElement | null =
      title.querySelector<HTMLElement>(".test-long-word");
    expect(longWord).not.toBeNull();
    expect(longWord!.firstChild?.textContent).toBe("Netzwerkschnittstellen");
    const glue: HTMLElement | null = glueOf(title);
    expect(glue!.parentElement).toBe(longWord);
    expectGlued(glue, screen.getByTestId("title-info"));
  });

  test("a long word that does not end the title keeps its box, and the (i) follows the last word outside it", () => {
    render(
      <WordsWithInfoTooltip
        text="Netzwerkschnittstellen aktiv"
        label="Interfaces up"
        description="Wie viele aktiv sind."
        lang="de"
        rule={RULE}
        dataTestId="title"
        infoDataTestId="title-info"
      />,
    );

    const title: HTMLElement = screen.getByTestId("title");
    const longWord: HTMLElement | null =
      title.querySelector<HTMLElement>(".test-long-word");
    expect(longWord!.textContent).toBe("Netzwerkschnittstellen");
    expect(glueOf(longWord!)).toBeNull();

    const glue: HTMLElement | null = glueOf(title);
    expect(glue!.parentElement).toBe(title);
    expect(glue!.previousSibling?.textContent).toBe(" aktiv");
    expectGlued(glue, screen.getByTestId("title-info"));
  });
});
