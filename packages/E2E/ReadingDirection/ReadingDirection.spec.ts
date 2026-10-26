import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The reading direction, in real Chromium. A Persian page sets <html
 * lang="fa" dir="rtl"> through the production helper (Common/UI/Utils/
 * PageLanguage), Tailwind's left and right utilities follow it (Common/UI/
 * Styles/TailwindReadingDirection.js), and the shared components that
 * place things themselves turn with it: the switch's knob, the status dot,
 * the table's stuck Actions column, a dialog's words, a note in the reader's
 * way or its own, chevrons and arrows. A German or English page is laid
 * out exactly as before.
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

const styleOf: (locator: Locator, property: string) => Promise<string> =
  async (locator: Locator, property: string): Promise<string> => {
    return locator.evaluate((element: Element, name: string): string => {
      return window.getComputedStyle(element).getPropertyValue(name);
    }, property);
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

const LANGUAGES: Array<{ lang: string; dir: "ltr" | "rtl" }> = [
  { lang: "en", dir: "ltr" },
  { lang: "de", dir: "ltr" },
  { lang: "fa", dir: "rtl" },
];

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
    for (const language of ["en", "fa"]) {
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
  for (const language of ["en", "fa"]) {
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
        expect(isAtRight).toBe(language === "fa" ? !isOn : isOn);
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

test.describe("the status dot", () => {
  for (const language of ["en", "fa"]) {
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
    for (const language of ["en", "fa"]) {
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
  for (const language of ["en", "fa"]) {
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
        expect(close.left - panelBox.left).toBeGreaterThan(
          panelBox.width / 2,
        );
      } else {
        expect(Math.round(panelBox.right - textBox.right)).toBeLessThan(30);
        expect(panelBox.right - close.right).toBeGreaterThan(
          panelBox.width / 2,
        );
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
    const persian: Locator = page
      .getByTestId("note-persian")
      .locator("[dir]")
      .first();

    expect(await english.getAttribute("dir")).toBe("ltr");
    expect(await persian.getAttribute("dir")).toBe("rtl");

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
    expect(await styleOf(paragraphs.last(), "unicode-bidi")).toBe("plaintext");
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

    expect(
      await page
        .getByTestId("note-persian")
        .locator("[dir]")
        .first()
        .getAttribute("dir"),
    ).toBe("rtl");
    expect(
      await page
        .getByTestId("note-english")
        .locator("[dir]")
        .first()
        .getAttribute("dir"),
    ).toBe("ltr");
  });
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
    await page.waitForTimeout(300);

    // Turned down (90deg), then mirrored: still pointing down.
    expect(await styleOf(chevron, "transform")).toBe(
      "matrix(0, 1, -1, 0, 0, 0)",
    );
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

      // ChevronDown turned -90deg points right; +90deg points left.
      expect(await styleOf(collapsed, "transform")).toBe(
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

  test("fa: nothing runs past the page's edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A phone draws a table's rows as cards: no cells to wait for.
    await open(page, "lang=fa&width=340", false);

    const overflow: number = await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });

    expect(overflow).toBeLessThanOrEqual(0);

    // The switch's knob stays in its track at this width too.
    const track: Box = await boxOf(page.getByTestId("toggle-on"));
    const knob: Box = await boxOf(
      page.getByTestId("toggle-on").locator("[data-ou-toggle-knob]"),
    );

    expect(knob.left).toBeGreaterThanOrEqual(track.left);
    expect(knob.right).toBeLessThanOrEqual(track.right);
  });
});
