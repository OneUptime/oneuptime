import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * The reading direction, in real Chromium. A Persian page sets <html
 * lang="fa" dir="rtl"> through the production helper (Common/UI/Utils/
 * PageLanguage), and an Arabic one <html lang="ar" dir="rtl">; Tailwind's
 * left and right utilities follow it (Common/UI/Styles/
 * TailwindReadingDirection.js), and the shared components that place
 * things themselves turn with it: the switch's knob, the status dot, the
 * table's stuck Actions column, a dialog's words, a note in the reader's
 * way or its own, chevrons and arrows. An Arabic page also writes its
 * dates, its pages and its calendar in Latin digits, and draws its letters
 * in Vazirmatn. A German or English page is laid out exactly as before.
 *
 * Every box is measured against the box it sits in, in both directions.
 */

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const boxOf: (locator: Locator) => Promise<Box> = async (
  locator: Locator,
): Promise<Box> => {
  return locator.evaluate((element: Element): Box => {
    const rect: DOMRect = element.getBoundingClientRect();

    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  });
};

const styleOf: (locator: Locator, property: string) => Promise<string> = async (
  locator: Locator,
  property: string,
): Promise<string> => {
  return locator.evaluate((element: Element, name: string): string => {
    return window.getComputedStyle(element).getPropertyValue(name);
  }, property);
};

/*
 * The box of the first run of `text` in the element's words: where a
 * character or a word was drawn, whichever way its line reads.
 */
const boxOfText: (locator: Locator, text: string) => Promise<Box> = async (
  locator: Locator,
  text: string,
): Promise<Box> => {
  return locator.evaluate((element: Element, needle: string): Box => {
    const walker: TreeWalker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null = walker.nextNode();

    while (node) {
      const index: number = (node.textContent || "").indexOf(needle);

      if (index >= 0) {
        const range: Range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);

        const rect: DOMRect = range.getBoundingClientRect();

        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }

      node = walker.nextNode();
    }

    throw new Error(`"${needle}" is not in the element's words`);
  }, text);
};

const open: (
  page: Page,
  query: string,
  hasTableRows?: boolean,
) => Promise<void> = async (
  page: Page,
  query: string,
  hasTableRows: boolean = true,
): Promise<void> => {
  // Nothing leaves the fixture's own server.
  await page.route(
    (url: URL): boolean => {
      return url.hostname !== "127.0.0.1";
    },
    async (route: { abort: () => Promise<void> }) => {
      await route.abort();
    },
  );
  await page.goto(`/reading-direction?${query}`);
  await expect(page.getByTestId("section-dates")).toBeVisible();

  // The table measures whether it overflows its card once it is drawn.
  if (hasTableRows) {
    await expect(
      page.locator("[data-testid=section-table] td").first(),
    ).toBeVisible();
  }
};

// Where the screens for review are kept (CI uploads them).
const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/reading-direction",
);

const LANGUAGES: Array<{ lang: string; dir: "ltr" | "rtl" }> = [
  { lang: "en", dir: "ltr" },
  { lang: "de", dir: "ltr" },
  { lang: "fa", dir: "rtl" },
  { lang: "ar", dir: "rtl" },
];

// The languages that read right to left, each laid out the same way.
const RIGHT_TO_LEFT: Array<string> = LANGUAGES.filter(
  (language: { lang: string; dir: "ltr" | "rtl" }): boolean => {
    return language.dir === "rtl";
  },
).map((language: { lang: string; dir: "ltr" | "rtl" }): string => {
  return language.lang;
});

test.describe("the page says its language and which way it reads", () => {
  for (const language of LANGUAGES) {
    test(`${language.lang}: <html lang="${language.lang}" dir="${language.dir}">`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language.lang}`);

      expect(
        await page.evaluate((): { lang: string; dir: string } => {
          return {
            lang: document.documentElement.getAttribute("lang") || "",
            dir: document.documentElement.getAttribute("dir") || "",
          };
        }),
      ).toEqual({ lang: language.lang, dir: language.dir });
      expect(await styleOf(page.locator("body"), "direction")).toBe(
        language.dir,
      );
    });
  }
});

test.describe("left and right utilities follow the reading direction", () => {
  test("a box's ml-6 mr-2 pl-4 pr-1 mirror, and right-0 pins to the end", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of ["en", ...RIGHT_TO_LEFT]) {
      await open(page, `lang=${language}`);

      const box: Locator = page.getByTestId("spacing-box");
      const sides: Record<string, string> = await box.evaluate(
        (element: Element): Record<string, string> => {
          const style: CSSStyleDeclaration = window.getComputedStyle(element);

          return {
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
            paddingLeft: style.paddingLeft,
            paddingRight: style.paddingRight,
            textAlign: style.textAlign,
          };
        },
      );

      if (language === "en") {
        expect(sides).toEqual({
          marginLeft: "24px",
          marginRight: "8px",
          paddingLeft: "16px",
          paddingRight: "4px",
          textAlign: "start",
        });
      } else {
        expect(sides).toEqual({
          marginLeft: "8px",
          marginRight: "24px",
          paddingLeft: "4px",
          paddingRight: "16px",
          textAlign: "start",
        });
      }

      const frame: Box = await boxOf(box.locator(".."));
      const mark: Box = await boxOf(page.getByTestId("spacing-end-mark"));
      const text: Box = await boxOf(page.getByTestId("spacing-text"));

      if (language === "en") {
        expect(Math.round(frame.right - mark.right)).toBeLessThanOrEqual(1);
        // The words start 24 + 16 = 40px in from the box's start (its left).
        expect(Math.round(text.left - frame.left)).toBe(41);
      } else {
        expect(Math.round(mark.left - frame.left)).toBeLessThanOrEqual(1);
        expect(Math.round(frame.right - text.right)).toBe(41);
      }
    }
  });
});

test.describe("the switch", () => {
  for (const language of ["en", ...RIGHT_TO_LEFT]) {
    test(`${language}: the knob stays inside its track, at the start when off and the end when on`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}`);

      for (const id of ["toggle-on", "toggle-off"]) {
        const track: Locator = page.getByTestId(id);
        const knob: Locator = track.locator("[data-ou-toggle-knob]");

        // Let the 200ms slide finish.
        await page.waitForTimeout(300);

        const trackBox: Box = await boxOf(track);
        const knobBox: Box = await boxOf(knob);

        // Inside the track, past its 2px clear border on both sides.
        expect(knobBox.left).toBeGreaterThanOrEqual(trackBox.left + 1.5);
        expect(knobBox.right).toBeLessThanOrEqual(trackBox.right - 1.5);

        const isOn: boolean = id === "toggle-on";
        const isAtRight: boolean =
          knobBox.left - trackBox.left > trackBox.right - knobBox.right;
        // On sits at the end: the right left to right, the left right to left.
        expect(isAtRight).toBe(language === "en" ? isOn : !isOn);
      }
    });
  }

  test("fa: switching it on slides the knob from the right to the left of its track", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const track: Locator = page.getByTestId("toggle-on");
    const knob: Locator = track.locator("[data-ou-toggle-knob]");

    await track.click();
    await page.waitForTimeout(300);

    const off: Box = await boxOf(knob);

    await track.click();
    await page.waitForTimeout(300);

    const on: Box = await boxOf(knob);

    // 20px across, inside the 44px track.
    expect(Math.round(off.left - on.left)).toBe(20);
    expect(await track.getAttribute("aria-checked")).toBe("true");
  });
});

/*
 * "In Persian the product bar's home icon touches its label" - the
 * maintainer, of the Dashboard's bar before left and right followed the
 * reading direction. Every link and button of the bar starts with its icon
 * and keeps it 6px from its words, at the words' side, in every language.
 */
test.describe("the product bar", () => {
  const PARTS: Array<{ name: string; selector: string }> = [
    {
      name: "Home",
      selector: "[data-testid=product-bar-home-only] #home-nav-bar-item",
    },
    {
      name: "the products menu",
      selector: "[data-testid=product-bar-home-only] button",
    },
    {
      name: "the open product",
      selector: "[data-testid=product-bar-product-open] button",
    },
  ];

  for (const language of LANGUAGES) {
    test(`${language.lang}: every part starts with its icon, 6px from its words`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `lang=${language.lang}`);

      for (const part of PARTS) {
        const link: Locator = page.locator(part.selector);

        await expect(link).toBeVisible();

        const icon: Box = await boxOf(link.locator("svg").first());
        const words: Box = await boxOf(link.locator("span").first());

        const gap: number =
          language.dir === "rtl"
            ? icon.left - words.right
            : words.left - icon.right;

        expect({ part: part.name, gap: Math.round(gap) }).toEqual({
          part: part.name,
          gap: 6,
        });

        // On one line, the icon centred on the words.
        expect(
          Math.abs(icon.top + icon.height / 2 - (words.top + words.height / 2)),
        ).toBeLessThanOrEqual(1.5);
      }

      // Home opens the bar, at the start of the line.
      const home: Box = await boxOf(page.locator(PARTS[0]!.selector));
      const products: Box = await boxOf(page.locator(PARTS[1]!.selector));

      if (language.dir === "rtl") {
        expect(home.left).toBeGreaterThan(products.right);
      } else {
        expect(home.right).toBeLessThan(products.left);
      }
    });
  }
});

test.describe("the status dot", () => {
  for (const language of ["en", ...RIGHT_TO_LEFT]) {
    test(`${language}: the dot starts the line and keeps 10px from the words`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}`);

      const row: Locator = page.getByRole("status").first();
      const dot: Box = await boxOf(page.getByTestId("status-bubble-dot"));
      const words: Box = await boxOf(row.locator("div").last());
      const frame: Box = await boxOf(row);

      expect(dot.width).toBe(14);
      expect(dot.height).toBe(14);

      if (language === "en") {
        expect(Math.round(dot.left - frame.left)).toBe(2);
        expect(Math.round(words.left - dot.right)).toBe(10);
      } else {
        expect(Math.round(frame.right - dot.right)).toBe(2);
        expect(Math.round(dot.left - words.right)).toBe(10);
      }

      // Centred on the words' 24px line.
      expect(
        Math.abs(dot.top + dot.height / 2 - (words.top + words.height / 2)),
      ).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("a table whose rows scroll sideways", () => {
  for (const theme of ["light", "dark"]) {
    for (const language of ["en", ...RIGHT_TO_LEFT]) {
      test(`${language}, ${theme}: the Actions column sticks at the table's end, ruled and shadowed on its start side`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await open(page, `lang=${language}&theme=${theme}`);

        const table: Locator = page.locator(
          "[data-testid=section-table] table",
        );
        const scroller: Locator = table.locator("..");
        const actions: Locator = page
          .locator("[data-testid=section-table] tbody tr")
          .first()
          .locator("td")
          .last();

        await expect(actions.getByRole("button").first()).toBeVisible();

        const box: Box = await boxOf(scroller);
        const cell: Box = await boxOf(actions);

        if (language === "en") {
          expect(Math.abs(box.right - cell.right)).toBeLessThanOrEqual(1);
          expect(await styleOf(actions, "border-left-width")).toBe("1px");
          expect(await styleOf(actions, "border-right-width")).toBe("0px");
        } else {
          expect(Math.abs(cell.left - box.left)).toBeLessThanOrEqual(1);
          expect(await styleOf(actions, "border-right-width")).toBe("1px");
          expect(await styleOf(actions, "border-left-width")).toBe("0px");
        }

        /*
         * The soft shadow falls over the cells passing under it: to the
         * column's left, or to its right when it stands at the left.
         */
        const shadow: string = await styleOf(actions, "box-shadow");

        expect(shadow).toContain(
          language === "en" ? " -8px 0px 12px -10px" : " 8px 0px 12px -10px",
        );

        // The row's first value starts 24px in from the row's start.
        const firstCell: Locator = page
          .locator("[data-testid=section-table] tbody tr")
          .first()
          .locator("td")
          .first();

        if (language === "en") {
          expect(await styleOf(firstCell, "padding-left")).toBe("24px");
        } else {
          expect(await styleOf(firstCell, "padding-right")).toBe("24px");
        }
      });
    }
  }

  test("fa: scrolled to its far end, the stuck column still covers the cells under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const scroller: Locator = page
      .locator("[data-testid=section-table] table")
      .locator("..");

    // Right to left, the far end is the most negative scrollLeft.
    await scroller.evaluate((element: Element): void => {
      element.scrollLeft = -element.scrollWidth;
    });

    const box: Box = await boxOf(scroller);
    const cell: Box = await boxOf(
      page
        .locator("[data-testid=section-table] tbody tr")
        .first()
        .locator("td")
        .last(),
    );

    expect(Math.abs(cell.left - box.left)).toBeLessThanOrEqual(1);
  });
});

test.describe("a dialog", () => {
  for (const language of ["en", ...RIGHT_TO_LEFT]) {
    test(`${language}: its words start where the page's do, and the close button sits at the end`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}&dialog=open`);

      const panel: Locator = page.getByTestId("modal");
      const text: Locator = page.getByTestId("dialog-text");

      expect(await styleOf(panel, "text-align")).toBe("start");

      const panelBox: Box = await boxOf(panel);
      const textBox: Box = await boxOf(text);
      const close: Box = await boxOf(panel.getByRole("button").first());

      if (language === "en") {
        expect(Math.round(textBox.left - panelBox.left)).toBeLessThan(30);
        expect(close.left - panelBox.left).toBeGreaterThan(panelBox.width / 2);
      } else {
        expect(Math.round(panelBox.right - textBox.right)).toBeLessThan(30);
        expect(panelBox.right - close.right).toBeGreaterThan(
          panelBox.width / 2,
        );
      }
    });
  }
});

test.describe("a side panel", () => {
  for (const language of ["en", ...RIGHT_TO_LEFT]) {
    test(`${language}: it stands at the end of the page, its words at its start and its close button at its end`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}&drawer=open`);

      const layer: Locator = page.getByTestId("side-over-layer");
      const text: Locator = page.getByTestId("drawer-text");
      const close: Locator = page.getByTestId("close-button");

      await expect(text).toBeVisible();

      // Settled: no transform left once it has slid in.
      await expect
        .poll(async () => {
          return styleOf(layer.locator(":scope > div").first(), "transform");
        })
        .toBe("none");

      const layerBox: Box = await boxOf(layer);
      const panelBox: Box = await boxOf(layer.locator(":scope > div").first());
      const textBox: Box = await boxOf(text);
      const closeBox: Box = await boxOf(close);

      if (language === "en") {
        // At the right edge, its words from its left, the close at its right.
        expect(Math.round(layerBox.right - panelBox.right)).toBe(0);
        expect(textBox.left - panelBox.left).toBeLessThan(40);
        expect(panelBox.right - closeBox.right).toBeLessThan(40);
      } else {
        // Mirrored: at the left edge, its words from its right, the close at its left.
        expect(Math.round(panelBox.left - layerBox.left)).toBe(0);
        expect(panelBox.right - textBox.right).toBeLessThan(40);
        expect(closeBox.left - panelBox.left).toBeLessThan(40);
      }
    });
  }
});

test.describe("notes read the way they are written", () => {
  test("fa: an English note reads left to right, a Persian one right to left with its English paragraph left to right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const english: Locator = page
      .getByTestId("note-english")
      .locator("[dir]")
      .first();
    // Half Persian, half English: each of its paragraphs reads its own way.
    const persian: Locator = page.getByTestId("note-persian");

    expect(await english.getAttribute("dir")).toBe("ltr");
    expect(await persian.locator("p").first().getAttribute("dir")).toBe("rtl");

    // The English note's list is indented from its left, where its bullets sit.
    const list: Locator = english.locator("ul").first();

    expect(await styleOf(list, "direction")).toBe("ltr");
    expect(await styleOf(list, "padding-left")).toBe("24px");
    expect(await styleOf(list, "padding-right")).toBe("0px");

    // In the Persian note, its English paragraph starts at the left.
    const paragraphs: Locator = persian.locator("p");
    const persianLine: Box = await boxOf(
      paragraphs.first().locator("xpath=.."),
    );
    const englishText: Box = await paragraphs
      .last()
      .evaluate((element: Element): Box => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);
        const rect: DOMRect = range.getBoundingClientRect();

        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      });

    expect(englishText.left - persianLine.left).toBeLessThan(
      persianLine.right - englishText.right,
    );
    // Each paragraph says which way it reads (rehypeBlocksReadTheirOwnWay).
    expect(await paragraphs.first().getAttribute("dir")).toBe("rtl");
    expect(await paragraphs.last().getAttribute("dir")).toBe("ltr");
    expect(await styleOf(paragraphs.last(), "direction")).toBe("ltr");
  });

  test("fa: an incident's feed note - its Persian title right to left, its English list left to right with its bullets beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const note: Locator = page.getByTestId("note-feed");
    const paragraphs: Locator = note.locator("p");

    expect(
      await paragraphs.evaluateAll(
        (elements: Array<Element>): Array<string> => {
          return elements.map((element: Element): string => {
            return element.getAttribute("dir") || "";
          });
        },
      ),
    ).toEqual(["rtl", "ltr", "ltr"]);

    const list: Locator = note.locator("ul");

    expect(await list.getAttribute("dir")).toBe("ltr");
    expect(await styleOf(list, "direction")).toBe("ltr");
    expect(await styleOf(list, "padding-left")).toBe("24px");
    // Its items read the list's way: no isolate needed.
    expect(await list.locator("bdi").count()).toBe(0);

    // Each item's words start at its bullet's side, the left, not across the card.
    const listBox: Box = await boxOf(list);

    for (const item of await list.locator("li a").all()) {
      const itemBox: Box = await boxOf(item);

      expect(itemBox.left - listBox.left).toBeLessThanOrEqual(25);
      expect(listBox.right - itemBox.right).toBeGreaterThan(100);
    }
  });

  test("fa: a Persian list with one English item - every bullet on the list's side, the English item's full stop at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const list: Locator = page.getByTestId("note-mixed-list").locator("ul");

    expect(await list.getAttribute("dir")).toBe("rtl");

    const items: Array<Locator> = await list.locator("li").all();

    expect(items).toHaveLength(3);

    const english: Locator = items[2]!.locator("bdi");

    expect(await english.getAttribute("dir")).toBe("ltr");
    expect(await english.textContent()).toBe("Restart the checkout service.");

    // The English item starts where the Persian ones do: at the list's right, beside its bullet.
    const persianRight: number = (await boxOf(items[0]!)).right;
    const englishBox: Box = await boxOf(english);

    expect(
      Math.abs((await boxOf(items[2]!)).right - persianRight),
    ).toBeLessThan(1);
    expect(persianRight - englishBox.right).toBeLessThan(2);

    // Its full stop is drawn at its end - the right - not before its first word.
    const fullStop: Box = await english.evaluate((element: Element): Box => {
      const text: Text = element.firstChild as Text;
      const range: Range = document.createRange();
      range.setStart(text, text.length - 1);
      range.setEnd(text, text.length);
      const rect: DOMRect = range.getBoundingClientRect();

      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });

    expect(englishBox.right - fullStop.right).toBeLessThan(1);
  });

  test("fa: a Persian sentence that starts with an English word reads right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const paragraph: Locator = page
      .getByTestId("note-persian-from-english")
      .locator("p");

    expect(await paragraph.getAttribute("dir")).toBe("rtl");

    // Its first word, the code, stands at the right, where the sentence starts.
    const paragraphBox: Box = await boxOf(paragraph);
    const code: Box = await boxOf(paragraph.locator("code"));

    expect(paragraphBox.right - code.right).toBeLessThan(2);
  });

  test("fa: an empty editor follows the page, and an English note in it reads left to right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const empty: Locator = page
      .getByTestId("editor-empty")
      .getByRole("textbox");
    const english: Locator = page
      .getByTestId("editor-english")
      .getByRole("textbox");

    expect(await styleOf(empty, "direction")).toBe("rtl");
    expect(await styleOf(english, "direction")).toBe("ltr");

    // Typing English into the empty one turns it left to right.
    await empty.click();
    await page.keyboard.type("Rolled back the deploy.");

    await expect
      .poll(async (): Promise<string> => {
        return styleOf(empty, "direction");
      })
      .toBe("ltr");
  });

  test("en: a Persian note on an English page reads right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const persian: Locator = page.getByTestId("note-persian").locator("p");

    expect(await persian.first().getAttribute("dir")).toBe("rtl");
    expect(await styleOf(persian.first(), "direction")).toBe("rtl");
    expect(await persian.last().getAttribute("dir")).toBe("ltr");
    expect(
      await page
        .getByTestId("note-english")
        .locator("[dir]")
        .first()
        .getAttribute("dir"),
    ).toBe("ltr");
    // A Persian sentence that starts with an English word, on an English page too.
    expect(
      await page
        .getByTestId("note-persian-from-english")
        .locator("p")
        .getAttribute("dir"),
    ).toBe("rtl");
  });
});

test.describe("values someone wrote, shown and typed", () => {
  test("fa: an English value keeps its full stop at its end, under its name at the right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const section: Locator = page.getByTestId("section-written");
    const values: Array<Locator> = await section
      .getByTestId("detail-value")
      .all();

    expect(values).toHaveLength(2);

    const english: Locator = values[0]!.locator("bdi");
    const persian: Locator = values[1]!.locator("bdi");

    expect(await english.getAttribute("dir")).toBe("ltr");
    expect(await persian.getAttribute("dir")).toBe("rtl");

    // The value starts where its name does: at the right of a Persian card.
    const label: Box = await boxOf(
      section.getByTestId("detail-label").first().locator("span").first(),
    );
    const englishBox: Box = await boxOf(english);

    expect(Math.abs(label.right - englishBox.right)).toBeLessThan(2);
    expect(await english.textContent()).toBe(
      "Watches the checkout endpoint every minute.",
    );
  });

  test("fa: what is typed reads its own way, an empty field shows its placeholder the page's way, and a number keeps its minus sign", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const typed: Locator = page.getByTestId("field-english").locator("input");
    const empty: Locator = page.getByTestId("field-empty").locator("input");
    const area: Locator = page
      .getByTestId("textarea-english")
      .locator("textarea");

    expect(await styleOf(typed, "unicode-bidi")).toBe("plaintext");
    expect(await styleOf(area, "unicode-bidi")).toBe("plaintext");
    // Firefox laid a right-to-left placeholder out of sight with plaintext.
    expect(await styleOf(empty, "unicode-bidi")).toBe("normal");
    expect(await styleOf(empty, "direction")).toBe("rtl");

    await empty.fill("Payments gateway");
    expect(await styleOf(empty, "unicode-bidi")).toBe("plaintext");

    /*
     * A number - a site's longitude, -71.0589 - laid out the page's way had
     * its minus sign drawn after its digits ("71.0589-"), and so had the
     * field's example. It reads left to right, at the field's right where
     * it always was, in a field that keeps the page's direction.
     */
    const number: Locator = page.getByTestId("field-number").locator("input");
    const emptyNumber: Locator = page
      .getByTestId("field-number-empty")
      .locator("input");

    await expect(number).toHaveValue("-71.0589");
    expect(await styleOf(number, "unicode-bidi")).toBe("plaintext");
    expect(await styleOf(number, "text-align")).toBe("right");
    expect(await styleOf(number, "direction")).toBe("rtl");
    expect(await styleOf(emptyNumber, "direction")).toBe("rtl");
    expect(await styleOf(emptyNumber, "text-align")).toBe("right");
    expect(
      await emptyNumber.evaluate((element: Element): string => {
        return window.getComputedStyle(element, "::placeholder").unicodeBidi;
      }),
    ).toBe("plaintext");
  });

  test("en: a Persian value on an English page reads right to left, and a number field is drawn as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const values: Array<Locator> = await page
      .getByTestId("section-written")
      .getByTestId("detail-value")
      .all();

    expect(await values[0]!.locator("bdi").getAttribute("dir")).toBe("ltr");
    expect(await values[1]!.locator("bdi").getAttribute("dir")).toBe("rtl");

    // A number field is drawn as it always was.
    const number: Locator = page.getByTestId("field-number").locator("input");

    await expect(number).toHaveValue("-71.0589");
    expect(await styleOf(number, "unicode-bidi")).toBe("normal");
    expect(await styleOf(number, "text-align")).toBe("start");
  });
});

/*
 * What a page says back. A check the product makes is in the reader's
 * words; an answer from the server is English - "Promo code is invalid." -
 * and on a Persian page it put its full stop first. Under a field
 * (FieldError) and above a form (Alert) it now reads the way it is
 * written, and still starts where the field does.
 */
test.describe("what a page says back", () => {
  test("fa: a server's English answer reads left to right under its field, its full stop at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const field: Locator = page.getByTestId("error-server-field");
    const words: Locator = field.getByTestId("error-message").locator("bdi");

    expect(await words.getAttribute("dir")).toBe("ltr");
    expect(await words.textContent()).toBe("Promo code is invalid.");

    // Under the field, starting at its right as the page's lines do.
    const input: Box = await boxOf(field.locator("input"));
    const line: Box = await boxOf(words);

    expect(Math.abs(input.right - line.right)).toBeLessThan(2);

    // The full stop is drawn after the words, at their right.
    const first: Box = await boxOfText(words, "P");
    const stop: Box = await boxOfText(words, ".");

    expect(stop.left).toBeGreaterThan(first.right);
    expect(Math.abs(stop.right - line.right)).toBeLessThan(2);
  });

  test("fa: a check in the page's own words is drawn as it always was, right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const field: Locator = page.getByTestId("error-check-field");
    const line: Locator = field.getByTestId("error-message");

    // The page's own words need no isolate: the line reads the page's way.
    await expect(line).toHaveText("توضیحات الزامی است");
    await expect(line.locator("bdi")).toHaveCount(0);
    expect(await styleOf(line, "direction")).toBe("rtl");

    // Under the field, starting at its right as the page's lines do.
    const input: Box = await boxOf(field.locator("input"));
    const first: Box = await boxOfText(line, "توضیحات");

    expect(Math.abs(input.right - first.right)).toBeLessThan(2);
  });

  test("fa: a form's English error reads left to right, its full stop at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const words: Locator = page.getByTestId("error-form").locator("bdi");

    expect(await words.getAttribute("dir")).toBe("ltr");

    const first: Box = await boxOfText(words, "P");
    const stop: Box = await boxOfText(words, ".");

    expect(stop.left).toBeGreaterThan(first.right);
  });

  test("fa: a note editor's English error reads left to right under it, its full stop at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const field: Locator = page.getByTestId("error-note-field");
    const words: Locator = field.getByTestId("error-message").locator("bdi");

    expect(await words.getAttribute("dir")).toBe("ltr");
    expect(await words.textContent()).toBe("Notes cannot be empty.");

    const first: Box = await boxOfText(words, "N");
    const stop: Box = await boxOfText(words, ".");

    expect(stop.left).toBeGreaterThan(first.right);
    // Under the editor, starting at its right as the page's lines do.
    expect(
      Math.abs((await boxOf(field)).right - (await boxOf(words)).right),
    ).toBeLessThan(2);
  });

  test("a value typed into a field in error starts clear of the error's icon", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of ["en", ...RIGHT_TO_LEFT]) {
      await open(page, `lang=${language}`);

      const field: Locator = page.getByTestId("error-server-field");
      const input: Locator = field.locator("input");
      const box: Box = await boxOf(input);
      const icon: Box = await boxOf(field.locator("svg").first());
      const paddings: { left: number; right: number } = await input.evaluate(
        (element: Element): { left: number; right: number } => {
          const style: CSSStyleDeclaration = window.getComputedStyle(element);

          return {
            left: parseFloat(style.paddingLeft),
            right: parseFloat(style.paddingRight),
          };
        },
      );

      // The icon sits at the field's end; the field keeps it clear of what is typed.
      if (language !== "en") {
        expect(icon.left - box.left).toBeLessThan(box.right - icon.right);
        expect(box.left + paddings.left).toBeGreaterThanOrEqual(icon.right);
      } else {
        expect(icon.right).toBeGreaterThan(box.right - 48);
        expect(box.right - paddings.right).toBeLessThanOrEqual(icon.left);
      }
    }
  });

  test("en: an error is drawn as it always was, from the field's left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const field: Locator = page.getByTestId("error-server-field");
    const line: Locator = field.getByTestId("error-message");

    // English on an English page: no isolate, the same line as before.
    await expect(line).toHaveText("Promo code is invalid.");
    await expect(line.locator("bdi")).toHaveCount(0);
    expect(await styleOf(line, "direction")).toBe("ltr");

    const input: Box = await boxOf(field.locator("input"));
    const first: Box = await boxOfText(line, "Promo");
    const stop: Box = await boxOfText(line, ".");

    expect(Math.abs(input.left - first.left)).toBeLessThan(2);
    expect(stop.left).toBeGreaterThan(first.right);
  });
});

/*
 * A value longer than its column is cut short with "..." at the end of its
 * line, and on a Persian page a line ends at the left: an English summary
 * and an English name lost their start. Each now reads its own way, cut at
 * its own end, its first letter in view.
 */
test.describe("values cut short to their column", () => {
  test("fa: an English summary, name and address are cut at their own end, their first letters in view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const table: Locator = page.getByTestId("section-people");
    const summary: Locator = table
      .locator("td")
      .filter({ hasText: "Polled 4,812" })
      .locator(":scope > div");

    expect(await styleOf(summary, "direction")).toBe("ltr");
    /*
     * Its end is the page's start: a value that fits starts at the right.
     * A later column's value gives way, so its box is lined up by its last
     * line (text-align-last), which a one-line value always is: cut short to
     * one clamped line, it keeps its whole "..."
     * (LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME). The next test
     * holds a short value there, at the right.
     */
    expect(await styleOf(summary, "text-align-last")).toBe("end");

    const summaryBox: Box = await boxOf(summary);
    const summaryStart: Box = await boxOfText(summary, "Polled");

    expect(summaryStart.left).toBeGreaterThanOrEqual(summaryBox.left - 0.5);
    // Cut short: the whole sentence is wider than its box.
    expect(
      await summary.evaluate((element: Element): boolean => {
        return element.scrollWidth > element.clientWidth;
      }),
    ).toBe(true);

    for (const testId of ["user-name-line", "user-email"]) {
      const first: string = testId === "user-email" ? "jose" : "José";
      const line: Locator = table
        .getByTestId(testId)
        .filter({ hasText: first });
      const lineBox: Box = await boxOf(line);
      const start: Box = await boxOfText(line, first);

      expect({ testId, direction: await styleOf(line, "direction") }).toEqual({
        testId,
        direction: "ltr",
      });
      expect({
        testId,
        isStartInView: start.left >= lineBox.left - 0.5,
      }).toEqual({ testId, isStartInView: true });
    }
  });

  test("fa: a short English value starts where its column does, at the right, its full stop at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const table: Locator = page.getByTestId("section-people");
    const short: Locator = table
      .locator("td")
      .filter({ hasText: "Up to date." })
      .locator(":scope > div");
    const header: Box = await boxOf(
      table.locator("th").filter({ hasText: "خلاصه آخرین فراخوانی" }),
    );
    const words: Box = await boxOfText(short, "Up to date.");
    const stop: Box = await boxOfText(short, ".");

    expect(Math.abs((await boxOf(short)).right - words.right)).toBeLessThan(1);
    // Under its column's name, which starts at the column's right.
    expect(words.right).toBeGreaterThan(header.right - 32);
    expect(Math.abs(stop.right - words.right)).toBeLessThan(1);

    // A Persian name reads as the page does, with no direction of its own.
    const persianName: Locator = table
      .getByTestId("user-name-line")
      .filter({ hasText: "سارا احمدی" });

    expect(await persianName.getAttribute("dir")).toBeNull();
    expect(await styleOf(persianName, "direction")).toBe("rtl");
  });

  test("en: the same values are cut short as they always were", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const summary: Locator = page
      .getByTestId("section-people")
      .locator("td")
      .filter({ hasText: "Polled 4,812" })
      .locator(":scope > div");

    expect(await summary.getAttribute("dir")).toBeNull();
    expect(await styleOf(summary, "direction")).toBe("ltr");

    const summaryBox: Box = await boxOf(summary);
    const summaryStart: Box = await boxOfText(summary, "Polled");

    expect(Math.abs(summaryStart.left - summaryBox.left)).toBeLessThan(1);
  });
});

/*
 * A month's events in a narrow calendar, each cut short to its block. On a
 * Persian page an English title lost its start ("...cluster"), and every
 * title started at its block's left (react-big-calendar's own text-align:
 * left). A title now reads its own way where it reads the other way from
 * the page, cut at its own end, and starts where the page's lines do.
 */
test.describe("a narrow month's events", () => {
  const eventContent: (page: Page, text: string) => Locator = (
    page: Page,
    text: string,
  ): Locator => {
    return page
      .getByTestId("section-calendar")
      .locator(".rbc-event", { hasText: text })
      .locator(".rbc-event-content");
  };

  const isCutShort: (locator: Locator) => Promise<boolean> = async (
    locator: Locator,
  ): Promise<boolean> => {
    return locator.evaluate((element: Element): boolean => {
      return element.scrollWidth > element.clientWidth;
    });
  };

  test("fa: an English title is cut at its own end, its first letters in view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const english: Locator = eventContent(page, "Database upgrade");

    await expect(english).toBeVisible();
    expect(await styleOf(english, "direction")).toBe("ltr");
    expect(await isCutShort(english)).toBe(true);

    const box: Box = await boxOf(english);
    const start: Box = await boxOfText(english, "Database");

    expect(start.left).toBeGreaterThanOrEqual(box.left - 0.5);
  });

  test("fa: a Persian title starts at its block's right, cut short or whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    for (const [title, firstWord] of [
      ["به‌روزرسانی سرور", "به‌روزرسانی"],
      ["ارتقا", "ارتقا"],
    ]) {
      const persian: Locator = eventContent(page, title!);

      await expect(persian).toBeVisible();
      expect(await styleOf(persian, "direction")).toBe("rtl");

      const box: Box = await boxOf(persian);
      const first: Box = await boxOfText(persian, firstWord!);

      expect({
        title,
        startsAtTheRight: box.right - first.right < 1.5,
      }).toEqual({ title, startsAtTheRight: true });
    }

    expect(await isCutShort(eventContent(page, "به‌روزرسانی سرور"))).toBe(true);
  });

  test("en: an English title starts at its block's left as before; a Persian one is cut at its own end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const english: Locator = eventContent(page, "Database upgrade");

    await expect(english).toBeVisible();
    expect(await styleOf(english, "direction")).toBe("ltr");

    const englishBox: Box = await boxOf(english);
    const englishStart: Box = await boxOfText(english, "Database");

    expect(Math.abs(englishStart.left - englishBox.left)).toBeLessThan(1.5);

    const persian: Locator = eventContent(page, "به‌روزرسانی سرور");

    expect(await styleOf(persian, "direction")).toBe("rtl");
    expect(await isCutShort(persian)).toBe(true);

    const persianBox: Box = await boxOf(persian);
    const persianStart: Box = await boxOfText(persian, "به‌روزرسانی");

    expect(persianBox.right - persianStart.right).toBeLessThan(1.5);
  });
});

/*
 * A calendar on a Persian page. Persian has no short names for its days, so
 * a narrow month cut its full names to "چها…": a narrow column now shows a
 * day's one-letter name ("چ"), a wide one its full name. The current-time
 * line's dot, the lines between the days and a block's stripe sit on the
 * start side - the right - where the dot sat at the far end of today's
 * column, the lines one day off and the stripes on the blocks' trailing
 * edges. An English calendar is drawn as it always was.
 */
test.describe("a calendar read right to left", () => {
  interface DayName {
    // The name a reader sees above the column.
    shown: string;
    isCutShort: boolean;
  }

  const dayNamesOf: (
    page: Page,
    section: string,
  ) => Promise<Array<DayName>> = async (
    page: Page,
    section: string,
  ): Promise<Array<DayName>> => {
    const headers: Locator = page
      .getByTestId(section)
      .locator(
        ".rbc-month-header .rbc-header, .rbc-time-header-content .rbc-header",
      );

    await expect(headers.first()).toBeVisible();

    return headers.evaluateAll((elements: Array<Element>): Array<DayName> => {
      return elements.map((header: Element): DayName => {
        const forms: Array<Element> = Array.from(
          header.querySelectorAll(
            ".oneuptime-calendar-day-name__full, .oneuptime-calendar-day-name__narrow",
          ),
        );
        const shown: Element | undefined = forms.find(
          (form: Element): boolean => {
            return window.getComputedStyle(form).display !== "none";
          },
        );

        return {
          shown: ((shown || header).textContent || "").trim(),
          isCutShort: header.scrollWidth > header.clientWidth,
        };
      });
    });
  };

  const shownNames: (names: Array<DayName>) => Array<string> = (
    names: Array<DayName>,
  ): Array<string> => {
    return names.map((name: DayName): string => {
      return name.shown;
    });
  };

  const cutNames: (names: Array<DayName>) => Array<string> = (
    names: Array<DayName>,
  ): Array<string> => {
    return names
      .filter((name: DayName): boolean => {
        return name.isCutShort;
      })
      .map((name: DayName): string => {
        return name.shown;
      });
  };

  test("fa: a narrow month names each day in one letter, none cut short", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const names: Array<DayName> = await dayNamesOf(page, "section-calendar");

    expect(shownNames(names)).toEqual(["ی", "د", "س", "چ", "پ", "ج", "ش"]);
    expect(cutNames(names)).toEqual([]);
    // A screen reader still reads the whole name.
    await expect(
      page
        .getByTestId("section-calendar")
        .locator(".rbc-month-header .sr-only")
        .nth(3),
    ).toHaveText("چهارشنبه");
  });

  test("fa: a wide month names each day in full, none cut short", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const names: Array<DayName> = await dayNamesOf(
      page,
      "section-calendar-wide",
    );

    expect(shownNames(names)).toEqual([
      "یکشنبه",
      "دوشنبه",
      "سه‌شنبه",
      "چهارشنبه",
      "پنجشنبه",
      "جمعه",
      "شنبه",
    ]);
    expect(cutNames(names)).toEqual([]);
  });

  test("fa: a phone's week names each day in one letter with its date", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * A phone's week: its columns about 45px wide, its day names with a
     * phone's narrow padding. A table that narrow is drawn as cards.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "lang=fa&width=390", false);

    const names: Array<DayName> = await dayNamesOf(
      page,
      "section-calendar-week",
    );

    expect(shownNames(names)).toEqual([
      "ی ۲۵",
      "د ۲۶",
      "س ۲۷",
      "چ ۲۸",
      "پ ۲۹",
      "ج ۳۰",
      "ش ۳۱",
    ]);
    expect(cutNames(names)).toEqual([]);
  });

  test("en: a narrow month's day names are the ones it always drew", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const names: Array<DayName> = await dayNamesOf(page, "section-calendar");

    expect(shownNames(names)).toEqual([
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
    ]);
    await expect(
      page
        .getByTestId("section-calendar")
        .locator(".oneuptime-calendar-day-name"),
    ).toHaveCount(0);
  });

  /*
   * A positioned box's left and right are read as the places they come to
   * (CSSOM's resolved values), so each side is a length: the start side's
   * is the one the stylesheet set.
   */
  interface WeekSides {
    // The current-time dot's inset from the line's left and right ends.
    dotLeft: string;
    dotRight: string;
    // Whether the hours' column is on today's right.
    hoursOnTheRight: boolean;
    // The width of each day column's left and right lines, past the hours.
    dayLines: Array<string>;
    // The same, of each day's name above it but the first.
    headerLines: Array<string>;
    // The gap a day's blocks leave, left and right.
    blocksGap: string;
    // A soft block's inline shadow, its stripe first.
    softStripe: string;
    // Where an override block's stripe is placed, from its left and right.
    overrideLeft: string;
    overrideRight: string;
  }

  const weekSidesOf: (page: Page) => Promise<WeekSides> = async (
    page: Page,
  ): Promise<WeekSides> => {
    const week: Locator = page.getByTestId("section-calendar-week");

    await expect(week.locator(".rbc-current-time-indicator")).toBeVisible();

    return week.evaluate((section: Element): WeekSides => {
      const style: (
        element: Element,
        pseudo?: string,
      ) => CSSStyleDeclaration = (
        element: Element,
        pseudo?: string,
      ): CSSStyleDeclaration => {
        return window.getComputedStyle(element, pseudo || null);
      };
      const indicator: Element = section.querySelector(
        ".rbc-current-time-indicator",
      )!;
      const today: Element = indicator.closest(".rbc-day-slot")!;
      const gutter: Element = section.querySelector(
        ".rbc-time-content > .rbc-time-gutter",
      )!;
      const soft: Element = section.querySelector(
        ".rbc-event.oneuptime-calendar-event--soft",
      )!;
      const override: Element = section.querySelector(
        ".rbc-event.oneuptime-calendar-event--override",
      )!;
      const events: Element = section.querySelector(
        ".rbc-day-slot .rbc-events-container",
      )!;

      return {
        dotLeft: style(indicator, "::before").left,
        dotRight: style(indicator, "::before").right,
        hoursOnTheRight:
          gutter.getBoundingClientRect().left >=
          today.getBoundingClientRect().right - 1,
        dayLines: Array.from(
          section.querySelectorAll(
            ".rbc-time-content > .rbc-day-slot > .rbc-timeslot-group:first-child",
          ),
        ).map((group: Element): string => {
          return `${style(group).borderLeftWidth} ${style(group).borderRightWidth}`;
        }),
        headerLines: Array.from(
          section.querySelectorAll(
            ".rbc-time-header-content .rbc-header + .rbc-header",
          ),
        ).map((header: Element): string => {
          return `${style(header).borderLeftWidth} ${style(header).borderRightWidth}`;
        }),
        blocksGap: `${style(events).marginLeft} ${style(events).marginRight}`,
        softStripe: style(soft).boxShadow,
        overrideLeft: style(override, "::before").left,
        overrideRight: style(override, "::before").right,
      };
    });
  };

  test("fa: a week's dot, its lines and its stripes are on the start side, the right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const sides: WeekSides = await weekSidesOf(page);

    // The dot at the line's start, beside the hours on today's right.
    expect(sides.hoursOnTheRight).toBe(true);
    expect(sides.dotRight).toBe("-5px");
    expect(sides.dotLeft).not.toBe("-5px");
    // Every day's line on its right side, where the day before it ends.
    expect(sides.dayLines).toHaveLength(7);
    expect(new Set(sides.dayLines)).toEqual(new Set(["0px 1px"]));
    expect(new Set(sides.headerLines)).toEqual(new Set(["0px 1px"]));
    // The blocks' gap at the day's end, the left.
    expect(sides.blocksGap).toBe("10px 0px");
    // The stripes down the blocks' right edges.
    expect(sides.softStripe).toContain("-3px 0px 0px 0px inset");
    expect(sides.overrideRight).toBe("0px");
    expect(sides.overrideLeft).not.toBe("0px");
  });

  test("en: a week's dot, its lines and its stripes are where they always were, on the left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const sides: WeekSides = await weekSidesOf(page);

    expect(sides.hoursOnTheRight).toBe(false);
    expect(sides.dotLeft).toBe("-5px");
    expect(sides.dotRight).not.toBe("-5px");
    expect(new Set(sides.dayLines)).toEqual(new Set(["1px 0px"]));
    expect(new Set(sides.headerLines)).toEqual(new Set(["1px 0px"]));
    expect(sides.blocksGap).toBe("0px 10px");
    expect(sides.softStripe).toContain(" 3px 0px 0px 0px inset");
    expect(sides.overrideLeft).toBe("0px");
    expect(sides.overrideRight).not.toBe("0px");
  });

  test("fa: each line between two days of a month lies on a day's edge, one per edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const edges: { lines: Array<number>; days: Array<number> } = await page
      .getByTestId("section-calendar-wide")
      .evaluate((section: Element) => {
        const row: Element = section.querySelector(".rbc-month-row")!;
        const days: Array<Element> = Array.from(
          row.querySelectorAll(".rbc-day-bg"),
        );

        return {
          // Where each drawn line is: the side of its day it is on.
          lines: days
            .filter((day: Element): boolean => {
              return window.getComputedStyle(day).borderRightWidth === "1px";
            })
            .map((day: Element): number => {
              return Math.round(day.getBoundingClientRect().right);
            })
            .sort((a: number, b: number): number => {
              return a - b;
            }),
          // Where one day meets the next.
          days: days
            .slice(0, -1)
            .map((day: Element): number => {
              return Math.round(day.getBoundingClientRect().left);
            })
            .sort((a: number, b: number): number => {
              return a - b;
            }),
        };
      });

    // Six lines, one where each day meets the next: none at the month's far edge.
    expect(edges.lines).toHaveLength(6);
    expect(edges.lines).toEqual(edges.days);
  });

  /*
   * Two blocks at once on a day: the first, earlier one lies on the day's
   * start side and the second beside it - from the day's right edge on a
   * Persian page, where react-big-calendar, placing each block by its own
   * left edge, put the first at the day's far end and the gap beside it.
   */
  interface TwoBlocks {
    dayLeft: number;
    dayRight: number;
    first: Box;
    second: Box;
  }

  const twoBlocksOf: (page: Page) => Promise<TwoBlocks> = async (
    page: Page,
  ): Promise<TwoBlocks> => {
    const week: Locator = page.getByTestId("section-calendar-week");

    await expect(
      week.locator(".rbc-event", { hasText: "Cache flush" }),
    ).toBeVisible();

    // Every box in one frame.
    return week.evaluate((section: Element): TwoBlocks => {
      const blocks: Array<Element> = Array.from(
        section.querySelectorAll(".rbc-event"),
      );
      const blockOf: (title: string) => Element = (title: string): Element => {
        return blocks.find((block: Element): boolean => {
          return (block.textContent || "").includes(title);
        })!;
      };
      const boxIn: (element: Element) => Box = (element: Element): Box => {
        const rect: DOMRect = element.getBoundingClientRect();

        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const first: Element = blockOf("Database upgrade");
      const day: DOMRect = first
        .closest(".rbc-day-slot")!
        .getBoundingClientRect();

      return {
        dayLeft: day.left,
        dayRight: day.right,
        first: boxIn(first),
        second: boxIn(blockOf("Cache flush")),
      };
    });
  };

  test("fa: two blocks at once lie from the day's right edge, the first at its start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const blocks: TwoBlocks = await twoBlocksOf(page);

    // The first block at the day's start side, the right.
    expect(Math.abs(blocks.dayRight - blocks.first.right)).toBeLessThan(2);
    // The second beside it, towards the day's end, the left.
    expect(blocks.second.right).toBeLessThanOrEqual(blocks.first.left + 1);
    // The day's gap at its end: the left, clear of the first block.
    expect(blocks.second.left - blocks.dayLeft).toBeGreaterThan(5);
  });

  test("en: two blocks at once lie from the day's left edge, as they always did", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const blocks: TwoBlocks = await twoBlocksOf(page);

    expect(Math.abs(blocks.first.left - blocks.dayLeft)).toBeLessThan(2);
    expect(blocks.second.left).toBeGreaterThanOrEqual(blocks.first.right - 1);
    expect(blocks.dayRight - blocks.second.right).toBeGreaterThan(5);
  });
});

/*
 * A chart's time axis reads left to right in every language: time runs that
 * way along it. But each label along it is a phrase of the page's language
 * - "۱ نوامبر، ۰۶:۰۰" - and reads the way its own words do (Theme.css): laid
 * out left to right, a Persian label put its day at the far end of its hour
 * ("۱ ۰۶:۰۰ نوامبر،").
 */
test.describe("a chart's time axis", () => {
  interface AxisLabel {
    words: string;
    // Where the label's day and its hour are drawn, along the axis.
    dayX: number;
    hourX: number;
    // Its middle against its tick's, which the label is centred on.
    offCentre: number;
  }

  const firstAxisLabelOf: (page: Page) => Promise<AxisLabel> = async (
    page: Page,
  ): Promise<AxisLabel> => {
    const label: Locator = page
      .getByTestId("chart")
      .locator(
        ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
      )
      .first();

    await expect(label).toBeVisible();

    return label.evaluate((element: Element): AxisLabel => {
      const text: SVGTextElement = element as SVGTextElement;
      const words: string = text.textContent || "";
      // The hour's first digit, two before its colon: "06:00".
      const hourAt: number = words.indexOf(":") - 2;
      const box: DOMRect = text.getBoundingClientRect();
      const anchor: number = Number(text.getAttribute("x") || "0");
      const surface: DOMRect = text.closest("svg")!.getBoundingClientRect();

      return {
        words,
        dayX: text.getStartPositionOfChar(0).x,
        hourX: text.getStartPositionOfChar(hourAt).x,
        offCentre: Math.abs(box.left + box.width / 2 - (surface.left + anchor)),
      };
    });
  };

  for (const language of LANGUAGES) {
    test(`${language.lang}: a label reads ${language.dir === "rtl" ? "from the right" : "from the left"}, its day before its hour, centred on its tick`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language.lang}`);

      const label: AxisLabel = await firstAxisLabelOf(page);

      expect(label.words).toContain(":");

      if (language.dir === "rtl") {
        // The day on the right, the hour at the label's left end.
        expect(label.dayX).toBeGreaterThan(label.hourX + 20);
      } else {
        expect(label.dayX).toBeLessThan(label.hourX - 20);
      }

      expect(label.offCentre).toBeLessThan(2);
    });
  }
});

test.describe("lists and sentences in the reader's way", () => {
  test("fa: a folded products category lists its products with the Persian comma, its chevron pointing left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const category: Locator = page.getByTestId("section-products-menu");

    await expect(category).toContainText("حوادث، هشدارها، مانیتورها");

    const chevron: Locator = category.locator("svg").last();

    expect(await styleOf(chevron, "scale")).toBe("-1 1");
  });

  test("en: a folded products category keeps the English comma, its chevron pointing right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const category: Locator = page.getByTestId("section-products-menu");

    await expect(category).toContainText("Incidents, Alerts, Monitors");
    expect(await styleOf(category.locator("svg").last(), "scale")).toBe("none");
  });

  /*
   * "خوانده‌شده از داشبورد Meraki (Acme Retail)، ۴ دقیقه پیش." - the time
   * follows the connection's name in Latin letters. Its digit joined the
   * name's left-to-right run and was drawn beside the name, before the words
   * it belongs with. Set apart, it reads after the name, with its words.
   */
  test("fa: a time after a name in Latin letters stays with its words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const sentence: Locator = page.getByTestId("sentence-meraki");
    const name: Box = await boxOfText(sentence, "Acme Retail");
    const digit: Box = await boxOfText(sentence, "۴");
    const words: Box = await boxOfText(sentence, "دقیقه");

    // Read from the right: the name, then the digit, then its words.
    expect(digit.right).toBeLessThanOrEqual(name.left);
    expect(words.right).toBeLessThanOrEqual(digit.left + 0.5);
  });

  test("en: the same sentence reads as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    const sentence: Locator = page.getByTestId("sentence-meraki");

    await expect(sentence).toHaveText(
      "Read from the Meraki dashboard (Acme Retail), 4 minutes ago.",
    );

    const name: Box = await boxOfText(sentence, "Acme Retail");
    const time: Box = await boxOfText(sentence, "minutes");

    expect(time.left).toBeGreaterThan(name.right);
  });
});

/*
 * A field's popup opens from its start edge: its left on a page read left
 * to right, its right on a Persian page, where it opens leftward over what
 * comes after the field - not rightward over the side menu.
 */
test.describe("a field's popup", () => {
  for (const language of LANGUAGES) {
    test(`${language.lang}: opens from the field's start edge`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language.lang}`);

      const trigger: Locator = page
        .getByTestId("section-popup")
        .getByTestId("color-picker-trigger");

      await trigger.click();

      const popup: Locator = page.getByTestId("color-picker-popup");

      await expect(popup).toBeVisible();

      const anchor: Box = await boxOf(trigger);
      const opened: Box = await boxOf(popup);

      if (language.dir === "rtl") {
        expect(Math.abs(opened.right - anchor.right)).toBeLessThan(1.5);
      } else {
        expect(Math.abs(opened.left - anchor.left)).toBeLessThan(1.5);
      }
    });
  }
});

/*
 * A note's diagrams are laid out left to right, and each label reads the
 * way it is written: a Persian message on a sequence diagram's arrow drew
 * its full stop at its right, where a Persian sentence starts.
 */
test.describe("a diagram in a note", () => {
  for (const language of ["en", "fa"]) {
    test(`${language}: a Persian label ends in its full stop at its left; an English one reads as written`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}`);

      const note: Locator = page.getByTestId("note-diagram");

      await expect(note.locator("svg")).toHaveCount(2);

      const persian: Locator = note
        .locator("text")
        .filter({ hasText: "پرداخت انجام شد." });
      const english: Locator = note
        .locator("text")
        .filter({ hasText: "Charge the card" });

      expect(await persian.getAttribute("direction")).toBe("rtl");
      expect(await english.getAttribute("direction")).toBe("ltr");

      const stop: Box = await boxOfText(persian, ".");
      const word: Box = await boxOfText(persian, "پرداخت");

      expect(stop.right).toBeLessThanOrEqual(word.left + 0.5);

      // A box's label reads its own way too, the diagram left to right.
      const box: Locator = note
        .locator("foreignObject")
        .filter({ hasText: "درگاه پرداخت" });

      expect(await styleOf(box, "direction")).toBe("rtl");

      const first: Box = await boxOf(
        note.locator("foreignObject").filter({ hasText: "Checkout API" }),
      );
      const second: Box = await boxOf(box);

      expect(first.right).toBeLessThan(second.left);
    });
  }
});

/*
 * A React Flow canvas is laid out left to right in every language: a node's
 * place is its x and y. A node is a card of what it names - a workflow
 * step from the step catalogue is English - and each of its lines reads the
 * way its own words do: an English step's description keeps its full stop
 * at its end on a Persian page, a Persian node's sentence reads from the
 * right, its full stop at its left.
 */
test.describe("a canvas", () => {
  for (const language of LANGUAGES) {
    test(`${language.lang}: the canvas keeps its places; each node reads the way its own words do`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language.lang}`);

      const canvas: Locator = page.getByTestId("canvas");
      const flow: Locator = canvas.locator(".react-flow");
      const node: Locator = canvas.locator(
        '.react-flow__node[data-id="payments"]',
      );
      const step: Locator = canvas.locator(
        '.react-flow__node[data-id="checkout"]',
      );

      await expect(node).toBeVisible();

      expect(await styleOf(flow, "direction")).toBe("ltr");
      /*
       * Laid out as the canvas is; on a page read right to left its lines
       * read their own way, and a page read left to right is as it was.
       */
      expect(await styleOf(node, "direction")).toBe("ltr");
      expect((await styleOf(node, "unicode-bidi")) === "plaintext").toBe(
        language.dir === "rtl",
      );

      // An English sentence keeps its full stop at its end, in every language.
      const stepWord: Box = await boxOfText(step, "Charges");
      const stepStop: Box = await boxOfText(step, ".");

      expect(stepStop.left).toBeGreaterThan(stepWord.right);

      if (language.dir === "rtl") {
        // A Persian or Arabic one reads from the right: its full stop is at its left.
        const word: Box = await boxOfText(
          node,
          language.lang === "ar" ? "بوابة" : "درگاه",
        );
        const stop: Box = await boxOfText(node, ".");

        expect(stop.right).toBeLessThanOrEqual(word.left + 0.5);
      }

      // 40px in from the canvas's left, whatever the language.
      const canvasBox: Box = await boxOf(canvas);
      const nodeBox: Box = await boxOf(node);

      expect(Math.abs(nodeBox.left - (canvasBox.left + 40))).toBeLessThan(1);
    });
  }

  test("fa: the panels over the canvas read the page's way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const panel: Locator = page
      .getByTestId("canvas")
      .locator(".react-flow__panel")
      .first();

    expect(await styleOf(panel, "direction")).toBe("rtl");
  });

  /*
   * The zoom buttons sit where a line starts: at the canvas's bottom left
   * on a page read left to right, and - mirrored with every panel - at its
   * bottom right on a Persian page, where they stayed at the far end.
   */
  for (const language of LANGUAGES) {
    test(`${language.lang}: the zoom buttons sit at the canvas's bottom ${language.dir === "rtl" ? "right" : "left"}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language.lang}`);

      const canvas: Locator = page.getByTestId("canvas");
      const controls: Locator = canvas.locator(".react-flow__controls");

      await expect(controls).toBeVisible();

      const canvasBox: Box = await boxOf(canvas);
      const controlsBox: Box = await boxOf(controls);

      // At the bottom, its margin below it.
      expect(canvasBox.bottom - controlsBox.bottom).toBeLessThan(20);

      if (language.dir === "rtl") {
        expect(canvasBox.right - controlsBox.right).toBeLessThan(20);
        expect(controlsBox.left).toBeGreaterThan(
          canvasBox.left + canvasBox.width / 2,
        );
      } else {
        expect(controlsBox.left - canvasBox.left).toBeLessThan(20);
        expect(controlsBox.right).toBeLessThan(
          canvasBox.left + canvasBox.width / 2,
        );
      }
    });
  }
});

test.describe("chevrons and arrows point the way the line reads", () => {
  for (const language of ["en", "fa"]) {
    test(`${language}: mirrored right to left, kept as drawn left to right, in a left-to-right box, and when they point up`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}`);

      const scale: (testId: string) => Promise<string> = async (
        testId: string,
      ): Promise<string> => {
        return styleOf(page.getByTestId(testId).locator("svg"), "scale");
      };

      const mirrored: string = language === "fa" ? "-1 1" : "none";

      expect(await scale("arrow-next")).toBe(mirrored);
      expect(await scale("arrow-fixed")).toBe("none");
      expect(await scale("arrow-up")).toBe("none");
      expect(await scale("arrow-in-ltr-box")).toBe("none");

      // The breadcrumbs' and pagination's chevrons too.
      const crumbChevron: Locator = page
        .getByTestId("section-breadcrumbs")
        .locator("svg")
        .first();

      expect(await styleOf(crumbChevron, "scale")).toBe(mirrored);
    });
  }

  test("fa: a folded section's chevron points left, and down once it is open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const chevron: Locator = page
      .getByTestId("folded-section-chevron")
      .locator("svg");

    expect(await styleOf(chevron, "scale")).toBe("-1 1");
    expect(await styleOf(chevron, "transform")).toBe("none");

    await page.getByTestId("folded-section-header").click();

    // Turned down (90deg), then mirrored: still pointing down.
    await expect
      .poll(async () => {
        return styleOf(chevron, "transform");
      })
      .toBe("matrix(0, 1, -1, 0, 0, 0)");
    expect(await styleOf(chevron, "scale")).toBe("-1 1");
  });

  test("a side menu's collapsed section points along the line in both directions", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of ["en", "fa"]) {
      await open(page, `lang=${language}`);

      const collapsed: Locator = page
        .getByTestId("section-menu")
        .getByRole("button", { expanded: false })
        .locator("svg");

      /*
       * ChevronDown turned -90deg points right; +90deg points left. Read
       * once the turn has run: the chevron eases into it (duration-200).
       */
      await expect
        .poll(async () => {
          return styleOf(collapsed, "transform");
        })
        .toBe(
          language === "fa"
            ? "matrix(0, 1, -1, 0, 0, 0)"
            : "matrix(0, -1, 1, 0, 0, 0)",
        );
    }
  });
});

test.describe("what reads left to right in every language", () => {
  test("fa: a keyboard shortcut reads Ctrl then K", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const keys: Locator = page.getByTestId("section-shortcut").locator("kbd");

    await expect(keys).toHaveCount(2);

    const ctrl: Box = await boxOf(keys.nth(0));
    const k: Box = await boxOf(keys.nth(1));

    expect(await keys.nth(0).textContent()).toBe("Ctrl");
    expect(ctrl.right).toBeLessThanOrEqual(k.left);
  });

  test("fa: code reads left to right, a block from the left and a variable in a sentence as an island", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const block: Locator = page.getByTestId("code-block");

    expect(await styleOf(block, "direction")).toBe("ltr");
    expect(await styleOf(block, "text-align")).toBe("left");

    const inline: Locator = page.getByTestId("code-inline");

    expect(await styleOf(inline, "direction")).toBe("ltr");
    expect(await styleOf(inline, "unicode-bidi")).toBe("isolate");
    expect(await inline.textContent()).toBe("{{alertname}}");
  });

  test("en: nothing about code changes on a left-to-right page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=en");

    expect(await styleOf(page.getByTestId("code-inline"), "unicode-bidi")).toBe(
      "normal",
    );
    expect(await styleOf(page.getByTestId("code-block"), "text-align")).toBe(
      "start",
    );
  });
});

interface KoreanWordLines {
  word: string;
  // The lines the word's letters are drawn on.
  lines: number;
}

interface KoreanWordsLayout {
  wordBreak: string;
  words: Array<KoreanWordLines>;
}

/*
 * How the narrow box draws its Korean words: each word and the lines it is
 * drawn on, read in one evaluate. The box is first made three and a half
 * syllables wide, measured in the font the runner draws Hangul in, so every
 * word (three syllables at most) fits a line of its own, while a line that
 * breaks between any two syllables splits a two-syllable word after
 * another one ("로드 시" / "간").
 */
const koreanWordsLayout: (page: Page) => Promise<KoreanWordsLayout> = async (
  page: Page,
): Promise<KoreanWordsLayout> => {
  return page
    .getByTestId("korean-words")
    .evaluate((element: Element): KoreanWordsLayout => {
      const text: Text = element.firstChild as Text;
      const content: string = text.data;
      const syllable: Range = document.createRange();
      syllable.setStart(text, 0);
      syllable.setEnd(text, 1);
      const syllableWidth: number = syllable.getBoundingClientRect().width;
      const box: HTMLElement = element.parentElement as HTMLElement;
      box.style.padding = "0";
      box.style.width = `${syllableWidth * 3.5}px`;

      const words: Array<KoreanWordLines> = [];
      let from: number = 0;

      for (const word of content.split(" ")) {
        const start: number = content.indexOf(word, from);
        const range: Range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + word.length);
        const tops: Set<number> = new Set<number>(
          Array.from(range.getClientRects()).map((rect: DOMRect): number => {
            return Math.round(rect.top);
          }),
        );
        words.push({ word: word, lines: tops.size });
        from = start + word.length;
      }

      return {
        wordBreak: window.getComputedStyle(element).wordBreak,
        words: words,
      };
    });
};

test.describe("Korean keeps its words whole", () => {
  test('ko: <html lang="ko">, and every word stays on one line in a narrow box', async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=ko");

    expect(
      await page.evaluate((): string => {
        return document.documentElement.getAttribute("lang") || "";
      }),
    ).toBe("ko");

    const layout: KoreanWordsLayout = await koreanWordsLayout(page);

    // Inherited from <html> (Theme.css, html:lang(ko)).
    expect(layout.wordBreak).toBe("keep-all");
    expect(layout.words.length).toBe(7);

    for (const word of layout.words) {
      expect(word, word.word).toEqual({ word: word.word, lines: 1 });
    }
  });

  for (const language of ["en", "de"]) {
    test(`${language}: a page in another language breaks Korean anywhere, as before`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}`);

      const layout: KoreanWordsLayout = await koreanWordsLayout(page);

      expect(layout.wordBreak).toBe("normal");
      // The check sees a broken word when there is one.
      expect(
        layout.words.some((word: KoreanWordLines): boolean => {
          return word.lines > 1;
        }),
      ).toBe(true);
    });
  }
});

// ٠-٩ and the Persian ۰-۹: an Arabic page writes neither (Locales/ARABIC.md).
const ARABIC_INDIC_DIGIT: RegExp = /[٠-٩۰-۹]/;
const EVERY_ARABIC_INDIC_DIGIT: RegExp = /[٠-٩۰-۹]/g;
const LATIN_DIGIT: RegExp = /[0-9]/;

test.describe("dates in the reader's digits", () => {
  test("fa: a date is written in Persian digits on the Gregorian calendar", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa");

    const text: string =
      (await page.getByTestId("date-text").textContent()) || "";

    expect(text).toContain("۲۰۲۶");
    expect(text).toContain("اکتبر");
    expect(text).not.toMatch(/[0-9]/);
  });

  test("ar: a date is written in Arabic on the Gregorian calendar, in Latin digits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=ar");

    const text: string =
      (await page.getByTestId("date-text").textContent()) || "";

    expect(text).toContain("2026");
    expect(text).toContain("أكتوبر");
    expect(text).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  test("de and en: Latin digits, as ever", async ({ page }: { page: Page }) => {
    for (const language of ["de", "en"]) {
      await open(page, `lang=${language}`);

      expect(await page.getByTestId("date-text").textContent()).toContain(
        "2026",
      );
    }
  });
});

test.describe("a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const language of RIGHT_TO_LEFT) {
    test(`${language}: nothing runs past the page's edge`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // A phone draws a table's rows as cards: no cells to wait for.
      await open(page, `lang=${language}&width=340`, false);

      await expectNoSidewaysScroll(page);

      // The switch's knob stays in its track at this width too.
      const track: Box = await boxOf(page.getByTestId("toggle-on"));
      const knob: Box = await boxOf(
        page.getByTestId("toggle-on").locator("[data-ou-toggle-knob]"),
      );

      expect(knob.left).toBeGreaterThanOrEqual(track.left);
      expect(knob.right).toBeLessThanOrEqual(track.right);
    });
  }
});

/*
 * An Arabic page: the Dashboard's own Arabic words, its letters in the
 * product's Arabic font, and Latin digits wherever the product writes a
 * number - a date, a page of a list, a month's days, a chart's axis.
 */
test.describe("an Arabic page", () => {
  test("ar: the product bar names Home in the Dashboard's Arabic", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=ar");

    await expect(
      page.locator("[data-testid=product-bar-home-only] #home-nav-bar-item"),
    ).toContainText("الرئيسية");
  });

  test("ar: its Arabic letters are drawn in Vazirmatn, Inter's face for them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=ar");

    const faces: Array<{ family: string; unicodeRange: string }> =
      await page.evaluate(
        async (): Promise<Array<{ family: string; unicodeRange: string }>> => {
          await document.fonts.ready;

          return Array.from(document.fonts)
            .filter((face: FontFace): boolean => {
              return face.status === "loaded";
            })
            .map((face: FontFace): { family: string; unicodeRange: string } => {
              return {
                family: face.family.replace(/["']/g, ""),
                unicodeRange: face.unicodeRange,
              };
            });
        },
      );

    expect(faces).toContainEqual({
      family: "Inter",
      unicodeRange: expect.stringContaining("U+600-6FF"),
    });
  });

  test("ar: the product writes Latin digits - a date, a page of a list, a month's days, a chart's axis", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=ar");

    for (const testId of [
      "section-dates",
      "section-pagination",
      "section-calendar",
      "section-chart",
    ]) {
      const text: string = await page.getByTestId(testId).innerText();

      expect({ testId, hasLatinDigit: LATIN_DIGIT.test(text) }).toEqual({
        testId,
        hasLatinDigit: true,
      });
      expect({
        testId,
        arabicIndic: text.match(EVERY_ARABIC_INDIC_DIGIT) || [],
      }).toEqual({
        testId,
        arabicIndic: [],
      });
    }
  });
});

/*
 * Code in an Arabic or Persian help text - a path, a flag, a function, a
 * cron line, a file, an address a value fills in - is drawn as it is
 * written: each of its characters right of the one before it on its line.
 * Every frontend's i18next sets the code apart as it hands a sentence of a
 * language read from the right to the page (Common/UI/Utils/
 * CodeReadsAsWritten). With code=raw the page draws the sentences as the
 * locale files hold them, and code read backwards: the negative control.
 */
test.describe("code in a sentence read from the right", () => {
  const CODE_IN_HELP: Array<{ testId: string; codes: Array<string> }> = [
    { testId: "code-path", codes: ["/var/lib/docker/containers"] },
    { testId: "code-flag-help", codes: ["--help"] },
    {
      testId: "code-flag-metric",
      codes: ["--disable-metric=neutron-quota_network"],
    },
    { testId: "code-function", codes: ["grantConsent()"] },
    { testId: "code-cron", codes: ["0 9 * * 1-5"] },
    { testId: "code-file", codes: [".env"] },
    { testId: "code-call", codes: ["OneUptimeReplay.grantConsent()"] },
    { testId: "code-template", codes: ["https://oneuptime.example.com/otlp"] },
  ];

  const CODE_HELP_IDS: Array<string> = CODE_IN_HELP.map(
    (item: { testId: string }): string => {
      return item.testId;
    },
  );

  // Help texts that name more products in Latin letters than they have words.
  const NAMES_HELP_IDS: Array<string> = [
    "names-smtp",
    "names-authenticator",
    "names-provider",
  ];

  interface CharacterBox {
    left: number;
    right: number;
    top: number;
  }

  /*
   * Where each character of `code` is drawn, where the element's words
   * first name it - the isolates' marks, which draw nothing, left out.
   * Null when the words do not name it (Persian leaves a few sentences in
   * English).
   */
  const characterBoxesOf: (
    locator: Locator,
    code: string,
  ) => Promise<Array<CharacterBox> | null> = async (
    locator: Locator,
    code: string,
  ): Promise<Array<CharacterBox> | null> => {
    return locator.evaluate(
      (element: Element, needle: string): Array<CharacterBox> | null => {
        const MARK: RegExp = /[\u{2066}-\u{2069}]/u;
        const units: Array<{ node: Node; offset: number; unit: string }> = [];
        const walker: TreeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
        );

        for (
          let node: Node | null = walker.nextNode();
          node;
          node = walker.nextNode()
        ) {
          const text: string = node.textContent || "";

          for (let offset: number = 0; offset < text.length; offset++) {
            if (!MARK.test(text[offset] as string)) {
              units.push({ node, offset, unit: text[offset] as string });
            }
          }
        }

        const written: string = units
          .map((unit: { unit: string }): string => {
            return unit.unit;
          })
          .join("");
        const start: number = written.indexOf(needle);

        if (start < 0) {
          return null;
        }

        return units
          .slice(start, start + needle.length)
          .map((unit: { node: Node; offset: number }): CharacterBox => {
            const range: Range = document.createRange();

            range.setStart(unit.node, unit.offset);
            range.setEnd(unit.node, unit.offset + 1);

            const rect: DOMRect = range.getBoundingClientRect();

            return { left: rect.left, right: rect.right, top: rect.top };
          });
      },
      code,
    );
  };

  // Each two characters on one line: whether the second is drawn right of the first.
  const readsForward: (boxes: Array<CharacterBox>) => Array<boolean> = (
    boxes: Array<CharacterBox>,
  ): Array<boolean> => {
    const steps: Array<boolean> = [];

    for (let index: number = 1; index < boxes.length; index++) {
      const before: CharacterBox = boxes[index - 1] as CharacterBox;
      const after: CharacterBox = boxes[index] as CharacterBox;

      if (Math.abs(after.top - before.top) > 3) {
        continue;
      }

      steps.push(after.left + after.right > before.left + before.right + 0.5);
    }

    return steps;
  };

  interface Drawn {
    code: string;
    steps: Array<boolean>;
  }

  const drawnCode: (page: Page) => Promise<Array<Drawn>> = async (
    page: Page,
  ): Promise<Array<Drawn>> => {
    const drawn: Array<Drawn> = [];

    for (const item of CODE_IN_HELP) {
      for (const code of item.codes) {
        const boxes: Array<CharacterBox> | null = await characterBoxesOf(
          page.getByTestId(item.testId),
          code,
        );

        if (boxes) {
          drawn.push({ code, steps: readsForward(boxes) });
        }
      }
    }

    return drawn;
  };

  interface SentenceStart {
    testId: string;
    // Whether the help is drawn in a box of its own read from the left.
    readFromTheLeft: boolean;
    // Whether its first character is drawn at the right end of its first line.
    startsAtTheRight: boolean;
  }

  /*
   * Where each help's sentence starts, for the helps worded in the page's
   * own letters (Persian leaves a few in English, which read from the left).
   */
  const sentenceStarts: (
    page: Page,
    testIds: Array<string>,
  ) => Promise<Array<SentenceStart>> = async (
    page: Page,
    testIds: Array<string>,
  ): Promise<Array<SentenceStart>> => {
    const starts: Array<SentenceStart> = [];

    for (const testId of testIds) {
      const start: Omit<SentenceStart, "testId"> | null = await page
        .locator(`#${testId}-help`)
        .evaluate((element: Element): Omit<SentenceStart, "testId"> | null => {
          const ARABIC_LETTER: RegExp = /\p{Script=Arabic}/u;
          // A space, or a mark that draws nothing: LRM, RLM, an isolate's.
          const UNDRAWN: RegExp = /[\s\u{200E}\u{200F}\u{2066}-\u{2069}]/u;

          if (!ARABIC_LETTER.test(element.textContent || "")) {
            return null;
          }

          const boxes: Array<{ left: number; right: number; top: number }> = [];
          const walker: TreeWalker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );

          for (
            let node: Node | null = walker.nextNode();
            node;
            node = walker.nextNode()
          ) {
            const text: string = node.textContent || "";

            for (let offset: number = 0; offset < text.length; offset++) {
              if (UNDRAWN.test(text[offset] as string)) {
                continue;
              }

              const range: Range = document.createRange();

              range.setStart(node, offset);
              range.setEnd(node, offset + 1);

              const rect: DOMRect = range.getBoundingClientRect();

              if (rect.width > 0) {
                boxes.push({
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                });
              }
            }
          }

          const first: { left: number; right: number; top: number } =
            boxes[0] as { left: number; right: number; top: number };
          const rightEnd: number = Math.max(
            ...boxes
              .filter((box: { top: number }): boolean => {
                return Math.abs(box.top - first.top) <= 3;
              })
              .map((box: { right: number }): number => {
                return box.right;
              }),
          );

          return {
            readFromTheLeft: element.querySelector('bdi[dir="ltr"]') !== null,
            startsAtTheRight: first.right >= rightEnd - 1,
          };
        });

      if (start) {
        starts.push({ testId, ...start });
      }
    }

    return starts;
  };

  // The Dashboard's locale file for `language`, as the page is handed it.
  const localeOf: (
    language: string,
  ) => Promise<Record<string, string>> = async (
    language: string,
  ): Promise<Record<string, string>> => {
    return JSON.parse(
      await fs.readFile(
        path.resolve(
          __dirname,
          `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
        ),
        "utf8",
      ),
    ) as Record<string, string>;
  };

  for (const language of RIGHT_TO_LEFT) {
    /*
     * Each piece of code, each character right of the one before it; the
     * sentence round it still read from the right. The code an Arabic
     * sentence names is in Latin letters, and they may outnumber its
     * Arabic ones: counted, the code laid the whole sentence out from the
     * left, its words in the wrong order. Set apart, it is not counted, and
     * a help text in the page's language reads as the page does
     * (readAsWritten). Copied, a sentence is the locale file's again.
     */
    test(`${language}: code reads as written, the sentence round it from the right, and a copy pastes as written`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const drawn: Array<Drawn> = await drawnCode(page);

      // A path, a flag, a function, a cron line, an address: at least five.
      expect(drawn.length).toBeGreaterThanOrEqual(5);

      for (const piece of drawn) {
        expect({ code: piece.code, steps: piece.steps.length > 0 }).toEqual({
          code: piece.code,
          steps: true,
        });
        expect({
          code: piece.code,
          backwards: piece.steps.filter((step: boolean): boolean => {
            return !step;
          }).length,
        }).toEqual({ code: piece.code, backwards: 0 });
      }

      const starts: Array<SentenceStart> = await sentenceStarts(
        page,
        CODE_HELP_IDS,
      );

      // Arabic words all eight; Persian leaves two in English.
      expect(starts.length).toBeGreaterThanOrEqual(6);
      expect(starts).toEqual(
        starts.map((start: SentenceStart): SentenceStart => {
          return {
            testId: start.testId,
            readFromTheLeft: false,
            startsAtTheRight: true,
          };
        }),
      );

      const copy: { shown: string; copied: string; prevented: boolean } =
        await page.evaluate(
          (): { shown: string; copied: string; prevented: boolean } => {
            const help: HTMLElement = document.getElementById(
              "code-path-help",
            ) as HTMLElement;
            const range: Range = document.createRange();

            range.selectNodeContents(help);

            const selection: Selection = window.getSelection() as Selection;

            selection.removeAllRanges();
            selection.addRange(range);

            const clipboard: DataTransfer = new DataTransfer();
            const event: ClipboardEvent = new ClipboardEvent("copy", {
              clipboardData: clipboard,
              bubbles: true,
              cancelable: true,
            });

            help.dispatchEvent(event);

            return {
              shown: help.textContent || "",
              copied: clipboard.getData("text/plain"),
              prevented: event.defaultPrevented,
            };
          },
        );
      const locale: Record<string, string> = await localeOf(language);

      // The page holds the marks; the copy is the locale file's sentence.
      expect(copy.shown).toMatch(/[\u{2066}-\u{2069}]/u);
      expect(copy.prevented).toBe(true);
      expect(copy.copied).toBe(
        locale[
          "Make sure the Docker agent's filelog receiver is collecting logs from /var/lib/docker/containers."
        ],
      );
    });

    /*
     * A help text worded in the page's language that names more products
     * in Latin letters than it has words of its own: read by most of its
     * letters, it was drawn in an isolate read from the left, its words in
     * the wrong order - the SMTP server's help on both pages, and Arabic's
     * authenticator and provider ones. It reads as the page does.
     */
    test(`${language}: a help text that names more products in Latin letters than it has words reads from the right`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const starts: Array<SentenceStart> = await sentenceStarts(
        page,
        NAMES_HELP_IDS,
      );

      // Arabic words all three; Persian leaves the authenticator in English.
      expect(
        starts.map((start: SentenceStart): string => {
          return start.testId;
        }),
      ).toEqual(
        language === "fa" ? ["names-smtp", "names-provider"] : NAMES_HELP_IDS,
      );
      expect(starts).toEqual(
        starts.map((start: SentenceStart): SentenceStart => {
          return {
            testId: start.testId,
            readFromTheLeft: false,
            startsAtTheRight: true,
          };
        }),
      );
    });

    /*
     * The negative control, with the sentences as the locale files hold
     * them (code=raw): code read backwards. (A sentence with more code than
     * words still reads from the right: a help text in the page's language
     * reads as the page does, whatever it names.)
     */
    test(`${language}: as the locale file holds the sentences, code reads backwards`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `lang=${language}&code=raw`);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const backwards: Array<string> = (await drawnCode(page))
        .filter((piece: Drawn): boolean => {
          return piece.steps.includes(false);
        })
        .map((piece: Drawn): string => {
          return piece.code;
        });

      // Persian's --help read help--; Arabic's flag and file their sign last.
      expect(backwards).toEqual(
        expect.arrayContaining(
          language === "fa"
            ? ["--help"]
            : ["--disable-metric=neutron-quota_network", ".env"],
        ),
      );
    });
  }

  /*
   * For a person to look at: the help texts in Arabic and Persian, light
   * and dark (one page, its dark class turned on), on a laptop and a
   * phone, and as the locale files held them.
   */
  const SHOTS: Array<{
    name: string;
    query: string;
    width: number;
    alsoDark: boolean;
  }> = RIGHT_TO_LEFT.flatMap(
    (
      language: string,
    ): Array<{
      name: string;
      query: string;
      width: number;
      alsoDark: boolean;
    }> => {
      return [
        {
          name: language,
          query: `lang=${language}`,
          width: 1280,
          alsoDark: true,
        },
        {
          name: language,
          query: `lang=${language}&width=340`,
          width: 390,
          alsoDark: true,
        },
        {
          name: `${language}-as-the-file-holds-it`,
          query: `lang=${language}&code=raw`,
          width: 1280,
          alsoDark: false,
        },
      ];
    },
  );

  for (const shot of SHOTS) {
    test(`screen: ${shot.name} at ${shot.width} pixels${shot.alsoDark ? ", light and dark" : ""}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: shot.width, height: 900 });
      await open(page, shot.query, shot.width > 640);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const section: Locator = page.getByTestId("section-code-in-sentences");

      await expect(section).toBeVisible();
      await expectNoSidewaysScroll(page);
      await fs.mkdir(SCREENSHOTS, { recursive: true });
      await section.screenshot({
        path: path.join(
          SCREENSHOTS,
          `code-in-sentences-${shot.name}-${shot.width}.png`,
        ),
        animations: "disabled",
      });

      if (!shot.alsoDark) {
        return;
      }

      // The Dashboard's dark mode: the class ?theme=dark puts on <html>.
      await page.evaluate(() => {
        document.documentElement.classList.add("dark");
      });
      await expect(page.locator("html.dark")).toHaveCount(1);
      await expect
        .poll(async (): Promise<string> => {
          return section.evaluate((element: Element): string => {
            return getComputedStyle(element.querySelector("div") as Element)
              .backgroundColor;
          });
        })
        .not.toBe("rgb(255, 255, 255)");
      await expectNoSidewaysScroll(page);
      await section.screenshot({
        path: path.join(
          SCREENSHOTS,
          `code-in-sentences-${shot.name}-dark-${shot.width}.png`,
        ),
        animations: "disabled",
      });
    });
  }
});

/*
 * The whole fixture, for a person to look at: Persian and Arabic beside
 * English and German, light and dark, a laptop and a phone, and the dialog
 * and the side panel over it.
 */
test.describe("screens for review", () => {
  const SCREENS: Array<{ name: string; query: string; width: number }> = [
    { name: "en", query: "lang=en", width: 1280 },
    { name: "de", query: "lang=de", width: 1280 },
    { name: "fa", query: "lang=fa", width: 1280 },
    { name: "fa-dark", query: "lang=fa&theme=dark", width: 1280 },
    { name: "fa-dialog", query: "lang=fa&dialog=open", width: 1280 },
    { name: "fa-drawer", query: "lang=fa&drawer=open", width: 1280 },
    { name: "fa-phone", query: "lang=fa&width=340", width: 390 },
    {
      name: "fa-phone-dark",
      query: "lang=fa&width=340&theme=dark",
      width: 390,
    },
    { name: "ar", query: "lang=ar", width: 1280 },
    { name: "ar-dark", query: "lang=ar&theme=dark", width: 1280 },
    { name: "ar-dialog", query: "lang=ar&dialog=open", width: 1280 },
    { name: "ar-drawer", query: "lang=ar&drawer=open", width: 1280 },
    { name: "ar-phone", query: "lang=ar&width=340", width: 390 },
    {
      name: "ar-phone-dark",
      query: "lang=ar&width=340&theme=dark",
      width: 390,
    },
  ];

  for (const screen of SCREENS) {
    test(`${screen.name} at ${screen.width} pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: screen.width, height: 900 });
      await open(page, screen.query, screen.width > 640);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      await fs.mkdir(SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${screen.name}-${screen.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
});
