import {
  AA_TEXT_CONTRAST,
  PAGE_TEXT_CLASS,
  TAILWIND_COLOURS,
  WrittenWords,
  colourOfClass,
  contrastOf,
  contrastOfClasses,
  contrastRatio,
  groundClassOf,
  relativeLuminance,
  textClassOf,
  unreadableWords,
  wordsIn,
} from "./TailwindContrast";
import { describe, expect, test } from "@jest/globals";

/*
 * The helper other suites hold "these words can be read" with. Its numbers
 * are checked against the ones WCAG's own examples and a browser give, so a
 * suite that leans on it is not leaning on a sum nobody checked.
 */

type ElementFromFunction = (markup: string) => Element;

const elementFrom: ElementFromFunction = (markup: string): Element => {
  const holder: HTMLElement = document.createElement("div");

  holder.innerHTML = markup;

  return holder.querySelector("[data-words]") as Element;
};

describe("contrast, as WCAG counts it", () => {
  test("black on white is 21:1, and a colour on itself is 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#6b7280", "#6b7280")).toBeCloseTo(1, 5);
  });

  test("luminance runs from 0 for black to 1 for white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    // WCAG's own worked example: #808080 is 0.2159.
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  // As a browser draws them: measured in Chromium on the builder's fixture.
  test.each([
    ["text-gray-900", "bg-white", 17.74],
    ["text-gray-500", "bg-white", 4.83],
    ["text-gray-400", "bg-white", 2.54],
    ["text-gray-500", "bg-indigo-50", 4.32],
    ["text-gray-600", "bg-indigo-50", 6.78],
    ["text-amber-700", "bg-white", 5.02],
    ["text-amber-700", "bg-amber-50", 4.84],
    ["text-amber-600", "bg-amber-50", 3.07],
    ["text-indigo-500", "bg-indigo-50", 3.99],
    ["text-indigo-700", "bg-indigo-50", 7.07],
  ])("%s on %s is %s:1", (text: string, ground: string, ratio: number) => {
    expect(contrastOfClasses(text, ground)).toBeCloseTo(ratio, 1);
  });

  test("the order of the two colours does not matter", () => {
    expect(contrastOfClasses("text-gray-500", "bg-white")).toBeCloseTo(
      contrastRatio(TAILWIND_COLOURS["white"]!, TAILWIND_COLOURS["gray-500"]!),
      10,
    );
  });

  test("AA for small text is 4.5:1", () => {
    expect(AA_TEXT_CONTRAST).toBe(4.5);
    expect(contrastOfClasses("text-gray-500", "bg-white")).toBeGreaterThan(
      AA_TEXT_CONTRAST,
    );
    expect(contrastOfClasses("text-gray-400", "bg-white")).toBeLessThan(
      AA_TEXT_CONTRAST,
    );
  });
});

describe("a class's colour", () => {
  test("is read for a text class and for a ground class", () => {
    expect(colourOfClass("text-gray-500")).toBe("#6b7280");
    expect(colourOfClass("bg-indigo-50")).toBe("#eef2ff");
    expect(colourOfClass("bg-white")).toBe("#ffffff");
    expect(colourOfClass("text-black")).toBe("#000000");
  });

  test.each([
    // A shade that is not listed: an error, not a guess.
    "text-teal-500",
    // Not a colour at all.
    "text-sm",
    "text-[11px]",
    "truncate",
    // A variant's colour is not the element's own.
    "hover:text-gray-700",
    // Another kind of colour class.
    "border-gray-300",
    "",
  ])('"%s" is refused', (className: string) => {
    expect(() => {
      return colourOfClass(className);
    }).toThrow(/is not a text or ground colour/);
  });

  test("every listed colour is a six-digit hex", () => {
    const SIX_DIGIT_HEX: RegExp = /^#[0-9a-f]{6}$/;

    for (const [name, colour] of Object.entries(TAILWIND_COLOURS)) {
      expect({ name, isHex: SIX_DIGIT_HEX.test(colour) }).toEqual({
        name,
        isHex: true,
      });
    }
  });
});

describe("the colours an element is classed with", () => {
  test("its own text colour, among classes that are not colours", () => {
    expect(
      textClassOf(
        elementFrom(
          '<span data-words class="truncate text-[11px] text-xs text-gray-500 hover:text-gray-700">x</span>',
        ),
      ),
    ).toBe("text-gray-500");
  });

  test("the nearest text colour above it when it has none of its own", () => {
    expect(
      textClassOf(
        elementFrom(
          '<div class="text-gray-900"><div class="text-amber-800"><span data-words class="truncate">x</span></div></div>',
        ),
      ),
    ).toBe("text-amber-800");
  });

  test("two text colours on one element are refused: which wins is not the class list's to say", () => {
    expect(() => {
      return textClassOf(
        elementFrom(
          '<span data-words class="text-gray-500 text-gray-900">x</span>',
        ),
      );
    }).toThrow(/more than one text colour: text-gray-500, text-gray-900/);
  });

  test("words nothing colours are refused", () => {
    expect(() => {
      return textClassOf(
        elementFrom('<span data-words class="text-sm">x</span>'),
      );
    }).toThrow(/Nothing gives these words a colour/);
  });

  test("the ground is the element's own, then the nearest above it, then the page's white", () => {
    expect(
      groundClassOf(
        elementFrom('<span data-words class="bg-amber-50 text-xs">x</span>'),
      ),
    ).toBe("bg-amber-50");
    expect(
      groundClassOf(
        elementFrom(
          '<div class="bg-white"><div class="bg-indigo-50 hover:bg-gray-50"><span data-words>x</span></div></div>',
        ),
      ),
    ).toBe("bg-indigo-50");
    expect(groundClassOf(elementFrom("<p><span data-words>x</span></p>"))).toBe(
      "bg-white",
    );
  });

  test("a hover ground is not the ground", () => {
    expect(
      groundClassOf(
        elementFrom(
          '<div class="hover:bg-gray-50"><span data-words>x</span></div>',
        ),
      ),
    ).toBe("bg-white");
  });

  /*
   * Passing over a colour it cannot read would read the words as the colour
   * of whatever is above them - a guess that looks like an answer.
   */
  test("a see-through colour is refused, not read as what is behind it", () => {
    expect(() => {
      return groundClassOf(
        elementFrom(
          '<div class="bg-indigo-50"><div class="bg-white/90"><span data-words>x</span></div></div>',
        ),
      );
    }).toThrow(/"bg-white\/90" is see-through/);
    expect(() => {
      return textClassOf(
        elementFrom(
          '<div class="text-gray-700"><span data-words class="text-amber-700/80">x</span></div>',
        ),
      );
    }).toThrow(/"text-amber-700\/80" is see-through/);
  });

  test("a shade that is not listed is refused where it is met, not passed over for the one above", () => {
    expect(() => {
      return textClassOf(
        elementFrom(
          '<div class="text-gray-900"><span data-words class="text-teal-600">x</span></div>',
        ),
      );
    }).toThrow(/"text-teal-600" is not a text or ground colour/);
    expect(() => {
      return groundClassOf(
        elementFrom(
          '<div class="bg-white"><div class="bg-teal-50"><span data-words>x</span></div></div>',
        ),
      );
    }).toThrow(/"bg-teal-50" is not a text or ground colour/);
  });

  test("classes that only look like a colour's are not taken for one", () => {
    const words: Element = elementFrom(
      '<div class="bg-white text-gray-700"><span data-words class="text-xs text-center text-[11px] bg-clip-text hover:text-teal-600 focus:bg-teal-50 truncate">x</span></div>',
    );

    expect(textClassOf(words)).toBe("text-gray-700");
    expect(groundClassOf(words)).toBe("bg-white");
  });

  test("how an element's words read where they are", () => {
    // A row's description on the list's white, and on the row under the keys.
    expect(
      contrastOf(
        elementFrom(
          '<div class="bg-white"><div><span data-words class="text-gray-500">x</span></div></div>',
        ),
      ),
    ).toBeCloseTo(4.83, 1);
    expect(
      contrastOf(
        elementFrom(
          '<div class="bg-white"><div class="bg-indigo-50"><span data-words class="text-gray-500">x</span></div></div>',
        ),
      ),
    ).toBeCloseTo(4.32, 1);
  });
});

describe("the words under an element", () => {
  // A list of two rows, the first under the keys, as a picker draws one.
  const LIST: string = `
    <div data-words class="bg-white text-gray-900">
      <div class="text-[11px] font-semibold uppercase text-gray-500">Main fields
        <span class="text-gray-400">Open one to pick its fields</span>
      </div>
      <div class="bg-indigo-50">
        <div class="text-sm text-gray-900">Title</div>
        <div class="text-xs text-gray-500">Title of this incident</div>
        <span class="bg-gray-100 text-gray-600">Long text</span>
      </div>
      <div class="hover:bg-gray-50">
        <div class="text-sm">Declared At</div>
        <div class="text-xs text-gray-500">When it was declared</div>
      </div>
    </div>`;

  test("are each read with the colour they are written in and what is behind them", () => {
    expect(wordsIn(elementFrom(LIST))).toEqual([
      {
        words: "Main fields",
        textClass: "text-gray-500",
        groundClass: "bg-white",
        contrast: 4.8,
      },
      {
        words: "Open one to pick its fields",
        textClass: "text-gray-400",
        groundClass: "bg-white",
        contrast: 2.5,
      },
      {
        words: "Title",
        textClass: "text-gray-900",
        groundClass: "bg-indigo-50",
        contrast: 15.9,
      },
      {
        words: "Title of this incident",
        textClass: "text-gray-500",
        groundClass: "bg-indigo-50",
        contrast: 4.3,
      },
      {
        words: "Long text",
        textClass: "text-gray-600",
        groundClass: "bg-gray-100",
        contrast: 6.9,
      },
      // No colour of its own: the list's.
      {
        words: "Declared At",
        textClass: "text-gray-900",
        groundClass: "bg-white",
        contrast: 17.7,
      },
      {
        words: "When it was declared",
        textClass: "text-gray-500",
        groundClass: "bg-white",
        contrast: 4.8,
      },
    ]);
  });

  test("the ones that cannot be read are the ones under 4.5:1 - a hint in gray-400, and gray-500 on a tinted row", () => {
    expect(
      unreadableWords(elementFrom(LIST)).map((written: WrittenWords) => {
        return written.words;
      }),
    ).toEqual(["Open one to pick its fields", "Title of this incident"]);
  });

  test("a list whose words can all be read has none", () => {
    expect(
      unreadableWords(
        elementFrom(
          '<div data-words class="bg-white"><p class="text-gray-500">One</p><div class="bg-indigo-50"><p class="text-gray-600">Two</p></div></div>',
        ),
      ),
    ).toEqual([]);
  });

  test("words for a screen reader, for the eye only, or of something that cannot be used are not counted", () => {
    const words: Array<string> = wordsIn(
      elementFrom(`
        <div data-words class="bg-white text-gray-400">
          <button class="text-gray-400"><span class="sr-only">Close</span></button>
          <span aria-hidden="true">›</span>
          <div aria-disabled="true"><span>Response Body</span></div>
          <button disabled>Save</button>
          <p class="text-gray-900">Read me</p>
        </div>`),
    ).map((written: WrittenWords) => {
      return written.words;
    });

    expect(words).toEqual(["Read me"]);
  });

  test("space between words is not a word, and a run of it is one space", () => {
    expect(
      wordsIn(
        elementFrom(
          '<div data-words class="bg-white text-gray-900">  <p>  Two\n   words </p>   </div>',
        ),
      ),
    ).toEqual([
      {
        words: "Two words",
        textClass: "text-gray-900",
        groundClass: "bg-white",
        contrast: 17.7,
      },
    ]);
  });

  test("a colour the helper does not know stops the walk: nothing is guessed", () => {
    expect(() => {
      return wordsIn(
        elementFrom(
          '<div data-words class="bg-white"><p class="text-sm">No colour</p></div>',
        ),
      );
    }).toThrow(/Nothing gives these words a colour/);
  });

  /*
   * A test draws one part of a page, with no page above it: the words that
   * take the page's colour are read as the colour the test says the page has.
   */
  test("words nothing colours take the page's colour, when the test says what it is", () => {
    const part: Element = elementFrom(
      '<div data-words class="bg-white"><p class="text-sm">Plain</p><p class="text-gray-500">Quiet</p></div>',
    );

    expect(PAGE_TEXT_CLASS).toBe("text-gray-900");
    expect(wordsIn(part, PAGE_TEXT_CLASS)).toEqual([
      {
        words: "Plain",
        textClass: "text-gray-900",
        groundClass: "bg-white",
        contrast: 17.7,
      },
      // Its own colour comes first.
      {
        words: "Quiet",
        textClass: "text-gray-500",
        groundClass: "bg-white",
        contrast: 4.8,
      },
    ]);
    expect(unreadableWords(part, PAGE_TEXT_CLASS)).toEqual([]);
    // A faint page is found out like anything else.
    expect(
      unreadableWords(part, "text-gray-400").map((written: WrittenWords) => {
        return written.words;
      }),
    ).toEqual(["Plain"]);
    expect(
      textClassOf(part.querySelector("p") as Element, "text-gray-700"),
    ).toBe("text-gray-700");
  });

  test("a page colour the helper does not know is refused too", () => {
    expect(() => {
      return wordsIn(
        elementFrom("<div data-words><p>Plain</p></div>"),
        "text-teal-900",
      );
    }).toThrow(/"text-teal-900" is not a text or ground colour/);
  });
});
