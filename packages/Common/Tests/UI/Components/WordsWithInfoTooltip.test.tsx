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
  WORDS_KEEP_INFO_ROOM_CLASS_NAME,
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
 * after its last word - after it, and on its left in a language read from
 * the right - and the words keep the (i)'s room free at the end of every
 * line, so the (i) always fits after the last word and is never drawn alone
 * at the start of a line.
 *
 * jsdom lays nothing out, so what is pinned is the structure that decides
 * the layout: the (i) is a descendant of the element holding the words,
 * right after the last word, and the room the words keep is the room the
 * (i) takes back. (Chromium and Firefox drew German and Arabic tile titles
 * at 90-140px with no (i) alone or past its tile, and the words hyphenated
 * where German does; a word joiner gluing the (i) to the word stopped that
 * hyphenation, so there is none.)
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

// The box that holds the (i) after the last word.
function glueOf(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[${INFO_GLUE_ATTRIBUTE}]`);
}

// The (i)'s box holds the (i) alone - no space, nothing else.
function expectGlued(glue: HTMLElement | null, info: HTMLElement): void {
  expect(glue).not.toBeNull();
  expect(glue).toHaveClass("whitespace-nowrap");
  expect(glue!.childNodes).toHaveLength(1);
  expect(glue!.firstChild).toBe(info);
}

// The words' element keeps the (i)'s room free at the end of every line.
function expectKeepsInfoRoom(words: HTMLElement): void {
  for (const name of WORDS_KEEP_INFO_ROOM_CLASS_NAME.split(" ")) {
    expect(words).toHaveClass(name);
  }
}

// A Tailwind length class's value in rem ("pe-[1.125rem]", "ms-1").
function remOf(className: string, prefix: string): number {
  const arbitrary: RegExpMatchArray | null = className.match(
    new RegExp(`^${prefix}-\\[(\\d+(?:\\.\\d+)?)rem\\]$`),
  );
  if (arbitrary) {
    return Number(arbitrary[1]);
  }
  // Tailwind's spacing scale: 1 is 0.25rem.
  const scale: RegExpMatchArray | null = className.match(
    new RegExp(`^${prefix}-(\\d+(?:\\.\\d+)?)$`),
  );
  expect(scale).not.toBeNull();
  return Number(scale![1]) * 0.25;
}

function classStartingWith(classNames: string, prefix: string): string {
  const found: string | undefined = classNames
    .split(" ")
    .find((name: string): boolean => {
      return name.startsWith(`${prefix}-`);
    });
  expect(found).toBeDefined();
  return found!;
}

describe("the (i)'s room (WordsBeforeInfo)", () => {
  test("the words keep, at the end of every line, the room the (i) takes back: its gap and its icon", () => {
    // An inline block no wider than its column, padded at its end.
    expect(WORDS_KEEP_INFO_ROOM_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["inline-block", "max-w-full"]),
    );
    const room: number = remOf(
      classStartingWith(WORDS_KEEP_INFO_ROOM_CLASS_NAME, "pe"),
      "pe",
    );

    // The (i): a gap after the word, then a margin that gives the room back.
    const gap: number = remOf(
      classStartingWith(INFO_AFTER_WORDS_CLASS_NAME, "ms"),
      "ms",
    );
    const takenBack: number = remOf(
      classStartingWith(INFO_AFTER_WORDS_CLASS_NAME, "-me"),
      "-me",
    );
    expect(INFO_AFTER_WORDS_CLASS_NAME.split(" ")).toContain("align-middle");

    // The (i)'s icon, as InfoTooltip draws it: h-3.5 w-3.5, 0.875rem.
    const infoTooltip: string = fs.readFileSync(
      path.join(TOOLTIP_DIR, "InfoTooltip.tsx"),
      "utf8",
    );
    expect(infoTooltip).toContain('props.iconClassName || "h-3.5 w-3.5"');
    const icon: number = 0.875;

    expect(takenBack).toBe(room);
    expect(room).toBe(gap + icon);
  });

  test("a logical room and margin: at the end of the line in either reading direction", () => {
    const classes: Array<string> = [
      ...WORDS_KEEP_INFO_ROOM_CLASS_NAME.split(" "),
      ...INFO_AFTER_WORDS_CLASS_NAME.split(" "),
    ];
    for (const name of classes) {
      expect(name).not.toMatch(/^-?(pr|pl|mr|ml)-/);
    }
  });

  test("the (i)'s box breaks no line inside, and nothing is glued to the word: it may still hyphenate", () => {
    expect(INFO_GLUE_CLASS_NAME.split(" ")).toEqual(["whitespace-nowrap"]);

    // No stylesheet that puts a character before the (i).
    expect(
      fs.existsSync(path.join(TOOLTIP_DIR, "WordsWithInfoTooltip.css")),
    ).toBe(false);
    expect(
      fs.readFileSync(
        path.join(TOOLTIP_DIR, "WordsWithInfoTooltip.tsx"),
        "utf8",
      ),
    ).not.toMatch(/import\s+"[^"]*\.css";/);
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
  test("the (i) is inside the element holding the words, right after the last word, in the room they keep for it", () => {
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
    expectKeepsInfoRoom(title);
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
    // Nothing hidden in it: no joiner, no mark, only the words.
    expect(screen.getByTestId("title").textContent).toBe("Hardware uptime");
    expect(document.body.innerHTML).not.toContain(String.fromCharCode(0x2060));
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
    // And the room kept at the end of the line - its left, here.
    expectKeepsInfoRoom(title);
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
    // No (i), no room kept for one: the words reach the end of the line.
    expect(title.className).toBe(WORDS_BREAK_CLASS_NAME);
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
     * line may break around): the (i) is inside that box, after it, and
     * the room it takes back is kept by the title around it.
     */
    const longWord: HTMLElement | null =
      title.querySelector<HTMLElement>(".test-long-word");
    expect(longWord).not.toBeNull();
    expect(longWord!.firstChild?.textContent).toBe("Netzwerkschnittstellen");
    const glue: HTMLElement | null = glueOf(title);
    expect(glue!.parentElement).toBe(longWord);
    expectGlued(glue, screen.getByTestId("title-info"));
    expectKeepsInfoRoom(title);
    expect(longWord!.className).toBe(RULE.longWordClassName);
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
