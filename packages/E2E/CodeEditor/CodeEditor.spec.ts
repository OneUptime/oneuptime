import {
  BrowserContext,
  Locator,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * CodeEditor in real browsers. The editor is a transparent textarea over a
 * highlighted copy of its text, so the one property everything rests on -
 * each glyph the textarea would draw lands exactly on the highlighted glyph
 * under it - is a layout fact, and jsdom has no layout. So are caret
 * scrolling, native undo (the editor's own edits go through execCommand to
 * land on it) and focus movement, which is what this suite covers.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/code-editor-ui",
);

// CODE_EDITOR_LINE_HEIGHT_PX and CODE_EDITOR_PADDING_Y_PX / _X_PX.
const LINE_HEIGHT: number = 20;
const PADDING_Y: number = 10;
const PADDING_X: number = 12;

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap<
  Page,
  Array<string>
>();

type EditorFunction = (page: Page, id: string) => Locator;

const editor: EditorFunction = (page: Page, id: string): Locator => {
  return page.getByTestId(`${id}-editor`);
};

const input: EditorFunction = (page: Page, id: string): Locator => {
  return editor(page, id).getByTestId("code-editor-input");
};

type ValueFunction = (page: Page, id: string) => Promise<string>;

// What the fixture last received through onChange.
const valueOf: ValueFunction = async (
  page: Page,
  id: string,
): Promise<string> => {
  return page.getByTestId(`${id}-value`).inputValue();
};

type SelectionFunction = (page: Page, id: string) => Promise<Array<number>>;

const selectionOf: SelectionFunction = async (
  page: Page,
  id: string,
): Promise<Array<number>> => {
  return input(page, id).evaluate(
    (element: HTMLTextAreaElement): Array<number> => {
      return [element.selectionStart, element.selectionEnd];
    },
  );
};

type ExpectValueFunction = (
  page: Page,
  id: string,
  expected: string,
) => Promise<void>;

const expectValue: ExpectValueFunction = async (
  page: Page,
  id: string,
  expected: string,
): Promise<void> => {
  await expect(page.getByTestId(`${id}-value`)).toHaveValue(expected);
  await expect(input(page, id)).toHaveValue(expected);
};

interface AlignmentScore {
  // Pixel difference with the two layers where they are.
  zero: number;
  // The smallest difference with either layer moved by 1 or 2 pixels.
  nearest: number;
}

type AlignmentFunction = (
  page: Page,
  target: Locator,
) => Promise<AlignmentScore>;

/*
 * Two screenshots of the same region: one of the highlighted layer alone,
 * one of the textarea's own text alone, both forced to plain black. If the
 * layers line up, the two are the same picture - antialiasing aside - and
 * shifting either by a single pixel makes them far more different.
 */
const alignment: AlignmentFunction = async (
  page: Page,
  target: Locator,
): Promise<AlignmentScore> => {
  await target.scrollIntoViewIfNeeded();

  // Black on white in either theme, with nothing else in the picture.
  const hideChrome: string =
    ".ou-code-editor__active-line { display: none !important; } .ou-code-editor__gutter { visibility: hidden !important; } .ou-code-editor__scroller { background: #fff !important; }";

  type ShotFunction = (css: string) => Promise<Buffer>;

  const shot: ShotFunction = async (css: string): Promise<Buffer> => {
    const style: Awaited<ReturnType<Page["addStyleTag"]>> =
      await page.addStyleTag({ content: css + hideChrome });
    const image: Buffer = await target.screenshot({
      animations: "disabled",
      caret: "hide",
    });
    await style.evaluate((node: Element) => {
      node.remove();
    });
    return image;
  };

  const highlighted: Buffer = await shot(
    ".ou-code-editor__highlight, .ou-code-editor__highlight * { color: #000 !important; opacity: 1 !important; background: transparent !important; } .ou-code-editor__input { visibility: hidden !important; }",
  );
  const typed: Buffer = await shot(
    ".ou-code-editor__highlight { visibility: hidden !important; } .ou-code-editor__input { color: #000 !important; -webkit-text-fill-color: #000 !important; caret-color: transparent !important; }",
  );

  return page.evaluate(
    async ([first, second]: Array<string>): Promise<AlignmentScore> => {
      type LoadFunction = (base64: string) => Promise<ImageData>;

      const load: LoadFunction = async (base64: string): Promise<ImageData> => {
        const image: HTMLImageElement = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas: HTMLCanvasElement = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context: CanvasRenderingContext2D = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };

      const a: ImageData = await load(first as string);
      const b: ImageData = await load(second as string);
      const width: number = a.width;
      const height: number = Math.min(a.height, b.height, 600);

      type ScoreFunction = (dx: number, dy: number) => number;

      const score: ScoreFunction = (dx: number, dy: number): number => {
        let total: number = 0;
        for (let y: number = 2; y < height - 2; y++) {
          for (let x: number = 2; x < width - 2; x++) {
            const i: number = (y * width + x) * 4;
            const j: number = ((y + dy) * width + (x + dx)) * 4;
            total += Math.abs((a.data[i] as number) - (b.data[j] as number));
          }
        }
        return total;
      };

      let nearest: number = Number.POSITIVE_INFINITY;
      for (let dy: number = -2; dy <= 2; dy++) {
        for (let dx: number = -2; dx <= 2; dx++) {
          if (dx !== 0 || dy !== 0) {
            nearest = Math.min(nearest, score(dx, dy));
          }
        }
      }

      return { zero: score(0, 0), nearest };
    },
    [highlighted.toString("base64"), typed.toString("base64")],
  );
};

type ExpectAlignedFunction = (page: Page, id: string) => Promise<void>;

const expectAligned: ExpectAlignedFunction = async (
  page: Page,
  id: string,
): Promise<void> => {
  const result: AlignmentScore = await alignment(
    page,
    editor(page, id).locator(".ou-code-editor__scroller"),
  );

  // Not vacuous: there is text, so moving it changes the picture a lot.
  expect(result.nearest, `${id}: the region has text`).toBeGreaterThan(20000);
  expect(
    result.zero * 8,
    `${id}: layers aligned (zero ${result.zero}, nearest ${result.nearest})`,
  ).toBeLessThan(result.nearest);
};

interface CaretPlacement {
  visible: boolean;
  detail: string;
}

type CaretPlacementFunction = (
  page: Page,
  id: string,
) => Promise<CaretPlacement>;

/*
 * Where the caret is, read off the highlighted glyphs (which the alignment
 * test ties to the textarea's), and whether that point is inside the part of
 * the scroller not covered by the sticky line numbers.
 */
const caretPlacement: CaretPlacementFunction = async (
  page: Page,
  id: string,
): Promise<CaretPlacement> => {
  return editor(page, id).evaluate(
    (
      root: HTMLElement,
      metrics: { lineHeight: number; paddingY: number; paddingX: number },
    ): CaretPlacement => {
      const textarea: HTMLTextAreaElement = root.querySelector("textarea")!;
      const scroller: HTMLElement = root.querySelector(
        ".ou-code-editor__scroller",
      )!;
      const gutter: HTMLElement | null = root.querySelector(
        ".ou-code-editor__gutter",
      );
      const layer: HTMLElement = root.querySelector(
        ".ou-code-editor__highlight",
      )!;
      const text: string = textarea.value;
      const index: number =
        textarea.selectionDirection === "backward"
          ? textarea.selectionStart
          : textarea.selectionEnd;

      type RectFunction = (at: number) => DOMRect | null;

      const characterRect: RectFunction = (at: number): DOMRect | null => {
        const walker: TreeWalker = document.createTreeWalker(
          layer,
          NodeFilter.SHOW_TEXT,
        );
        let remaining: number = at;
        let node: Node | null = walker.nextNode();
        while (node) {
          const length: number = (node as Text).data.length;
          if (remaining < length) {
            const range: Range = document.createRange();
            range.setStart(node, remaining);
            range.setEnd(node, remaining + 1);
            return range.getBoundingClientRect();
          }
          remaining -= length;
          node = walker.nextNode();
        }
        return null;
      };

      let x: number;
      let top: number;

      if (index < text.length && text[index] !== "\n") {
        const rect: DOMRect = characterRect(index)!;
        x = rect.left;
        top = rect.top;
      } else if (index > 0 && text[index - 1] !== "\n") {
        const rect: DOMRect = characterRect(index - 1)!;
        x = rect.right;
        top = rect.top;
      } else {
        const line: number = text.slice(0, index).split("\n").length;
        const bounds: DOMRect = layer.getBoundingClientRect();
        x = bounds.left + metrics.paddingX;
        top = bounds.top + metrics.paddingY + (line - 1) * metrics.lineHeight;
      }

      const view: DOMRect = scroller.getBoundingClientRect();
      const left: number = gutter
        ? gutter.getBoundingClientRect().right
        : view.left;
      const right: number = view.left + scroller.clientWidth;
      const bottom: number = view.top + scroller.clientHeight;
      const visible: boolean =
        x >= left - 0.5 &&
        x <= right + 0.5 &&
        top >= view.top - 0.5 &&
        top + metrics.lineHeight <= bottom + 0.5;

      return {
        visible,
        detail: `caret ${index} at (${x.toFixed(1)}, ${top.toFixed(1)}), visible x ${left.toFixed(1)}..${right.toFixed(1)}, y ${view.top.toFixed(1)}..${bottom.toFixed(1)}`,
      };
    },
    { lineHeight: LINE_HEIGHT, paddingY: PADDING_Y, paddingX: PADDING_X },
  );
};

type ExpectCaretVisibleFunction = (page: Page, id: string) => Promise<void>;

const expectCaretVisible: ExpectCaretVisibleFunction = async (
  page: Page,
  id: string,
): Promise<void> => {
  await expect
    .poll(async (): Promise<string> => {
      const placement: CaretPlacement = await caretPlacement(page, id);
      return placement.visible ? "visible" : placement.detail;
    })
    .toBe("visible");
};

type CharacterCenterFunction = (
  page: Page,
  id: string,
  index: number,
) => Promise<{ x: number; y: number }>;

// A point on the left third of the highlighted glyph at `index`.
const characterPoint: CharacterCenterFunction = async (
  page: Page,
  id: string,
  index: number,
): Promise<{ x: number; y: number }> => {
  return editor(page, id)
    .locator(".ou-code-editor__highlight")
    .evaluate((layer: HTMLElement, at: number): { x: number; y: number } => {
      const walker: TreeWalker = document.createTreeWalker(
        layer,
        NodeFilter.SHOW_TEXT,
      );
      let remaining: number = at;
      let node: Node | null = walker.nextNode();
      while (node) {
        const length: number = (node as Text).data.length;
        if (remaining < length) {
          const range: Range = document.createRange();
          range.setStart(node, remaining);
          range.setEnd(node, remaining + 1);
          const rect: DOMRect = range.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 3,
            y: rect.top + rect.height / 2,
          };
        }
        remaining -= length;
        node = walker.nextNode();
      }
      throw new Error(`no character ${at}`);
    }, index);
};

type ClearFunction = (page: Page, id: string) => Promise<void>;

const clearAndFocus: ClearFunction = async (
  page: Page,
  id: string,
): Promise<void> => {
  await input(page, id).fill("");
  await input(page, id).focus();
};

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto("/");
  await expect(editor(page, "json")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test.describe("the textarea and the highlighted text line up", () => {
  for (const id of [
    "json",
    "sigma",
    "sql",
    "bash",
    "readonly",
    "markdown",
    "error",
    "edge",
    "long",
  ]) {
    test(`${id}: glyph for glyph`, async ({ page }: { page: Page }) => {
      await expectAligned(page, id);
    });
  }

  test("in the dark theme too", async ({ page }: { page: Page }) => {
    await page.goto("/?theme=dark");
    await expect(editor(page, "json")).toBeVisible();

    for (const id of ["json", "sigma", "edge"]) {
      await expectAligned(page, id);
    }
  });

  test("still, when scrolled both ways", async ({ page }: { page: Page }) => {
    await editor(page, "long")
      .locator(".ou-code-editor__scroller")
      .evaluate((scroller: HTMLElement) => {
        scroller.scrollTop = 900;
        scroller.scrollLeft = 300;
      });

    await expectAligned(page, "long");
  });

  test("still, after typing into it", async ({ page }: { page: Page }) => {
    await input(page, "json").focus();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("\t<tag> & 'quotes' \\ { [ ( ");

    await expectAligned(page, "json");
  });

  test("a click on a glyph puts the caret on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const text: string = await valueOf(page, "json");

    for (const needle of ['"retries"', "api", "3"]) {
      const index: number = text.indexOf(needle);
      const point: { x: number; y: number } = await characterPoint(
        page,
        "json",
        index,
      );
      await page.mouse.click(point.x, point.y);
      expect(await selectionOf(page, "json"), needle).toEqual([index, index]);
    }
  });

  test("selected text is never drawn twice", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * With the highlighted layer hidden, a selection must paint no glyphs of
     * its own - Theme.css's dark ::selection sets white text, which here
     * would print every selected character a second time. Forcing the
     * selection text transparent must therefore change nothing.
     */
    for (const theme of ["light", "dark"]) {
      await page.goto(`/?theme=${theme}`);
      await input(page, "json").focus();
      await page.keyboard.press("ControlOrMeta+A");

      const target: Locator = editor(page, "json").locator(
        ".ou-code-editor__code",
      );
      const hide: Awaited<ReturnType<Page["addStyleTag"]>> =
        await page.addStyleTag({
          content:
            ".ou-code-editor__highlight { visibility: hidden !important; }",
        });
      const asShipped: Buffer = await target.screenshot({ caret: "hide" });
      const forced: Awaited<ReturnType<Page["addStyleTag"]>> =
        await page.addStyleTag({
          content:
            ".ou-code-editor__input::selection { color: transparent !important; -webkit-text-fill-color: transparent !important; }",
        });
      const transparent: Buffer = await target.screenshot({ caret: "hide" });
      await forced.evaluate((node: Element) => {
        node.remove();
      });
      await hide.evaluate((node: Element) => {
        node.remove();
      });

      expect(Buffer.compare(asShipped, transparent), theme).toBe(0);
    }
  });
});

test.describe("typing", () => {
  test("brackets and quotes pair, closers are typed over, Enter indents", async ({
    page,
  }: {
    page: Page;
  }) => {
    await clearAndFocus(page, "json");

    await page.keyboard.type("{");
    await expectValue(page, "json", "{}");
    expect(await selectionOf(page, "json")).toEqual([1, 1]);

    await page.keyboard.press("Enter");
    await expectValue(page, "json", "{\n  \n}");
    expect(await selectionOf(page, "json")).toEqual([4, 4]);

    await page.keyboard.type('"name": [1, 2');
    await expectValue(page, "json", '{\n  "name": [1, 2]\n}');

    // Typing the closers that are already there steps over them.
    await page.keyboard.type("]");
    await expectValue(page, "json", '{\n  "name": [1, 2]\n}');
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.type("}");
    await expectValue(page, "json", '{\n  "name": [1, 2]\n}');

    // An empty pair goes with one Backspace.
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("[");
    await expectValue(page, "json", '{\n  "name": [1, 2]\n}\n[]');
    await page.keyboard.press("Backspace");
    await expectValue(page, "json", '{\n  "name": [1, 2]\n}\n');
  });

  test("fill() sets exactly the text it is given", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * The E2E suites fill code fields this way. Monaco replayed inserted text
     * through its bracket interceptors and closed `["x"` for them; a plain
     * textarea must not.
     */
    await input(page, "json").fill('["https://app.example.com"');
    await expectValue(page, "json", '["https://app.example.com"');
  });

  test("undo and redo walk back through the editor's own edits", async ({
    page,
  }: {
    page: Page;
  }) => {
    const original: string = await valueOf(page, "json");
    const box: Locator = input(page, "json");

    await box.focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.type(",");
    await page.keyboard.press("Enter");
    await page.keyboard.type('"tags": [');
    await page.keyboard.press("Enter");
    await page.keyboard.type('"edge"');
    await page.keyboard.press("Tab");

    const typed: string = await valueOf(page, "json");
    expect(typed).toBe(
      '{\n  "name": "api",\n  "retries": 3,\n  "tags": [\n    "edge"  \n  ]\n}',
    );

    for (let step: number = 0; step < 40; step++) {
      await page.keyboard.press("ControlOrMeta+Z");
    }
    await expectValue(page, "json", original);

    for (let step: number = 0; step < 40; step++) {
      await page.keyboard.press("ControlOrMeta+Shift+Z");
    }
    await expectValue(page, "json", typed);
  });

  test("Tab and Shift+Tab indent every selected line; YAML never gets a tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    const original: string = await valueOf(page, "sigma");
    const lines: Array<string> = original.split("\n");
    const start: number = original.indexOf("detection:");
    const end: number = original.indexOf("  condition:");

    await input(page, "sigma").focus();
    await input(page, "sigma").evaluate(
      (element: HTMLTextAreaElement, range: Array<number>) => {
        element.setSelectionRange(range[0] as number, range[1] as number);
      },
      [start, end],
    );

    await page.keyboard.press("Tab");
    const indented: string = await valueOf(page, "sigma");
    expect(indented.split("\n")).toEqual(
      lines.map((line: string, index: number) => {
        return index >= 3 && index <= 6 ? `  ${line}` : line;
      }),
    );
    expect(indented).not.toContain("\t");

    await page.keyboard.press("Shift+Tab");
    await expectValue(page, "sigma", original);
  });

  test("Ctrl+/ comments lines out and back in", async ({
    page,
  }: {
    page: Page;
  }) => {
    const original: string = await valueOf(page, "bash");

    await input(page, "bash").focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    // Lines 2 and 3: a selection ending at column 1 of line 4 stops at 3.
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("ControlOrMeta+/");
    await expectValue(
      page,
      "bash",
      original
        .replace("set -euo", "# set -euo")
        .replace("for host", "# for host"),
    );

    await page.keyboard.press("ControlOrMeta+/");
    await expectValue(page, "bash", original);
  });

  test("a read-only editor takes no edits and does not hold on to Tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    const original: string = await valueOf(page, "readonly");

    await input(page, "readonly").focus();
    await page.keyboard.type("x{");
    await page.keyboard.press("Enter");
    await expect(input(page, "readonly")).toHaveValue(original);

    await page.keyboard.press("Tab");
    await expect(input(page, "readonly")).not.toBeFocused();
  });
});

test.describe("focus", () => {
  test("Tab indents; Escape then Tab moves on; Shift+Tab comes back", async ({
    page,
  }: {
    page: Page;
  }) => {
    const original: string = await valueOf(page, "json");
    const box: Locator = input(page, "json");

    await box.focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("Tab");
    await expect(box).toBeFocused();
    await expectValue(page, "json", `  ${original}`);

    await page.keyboard.press("Escape");
    await expect(
      editor(page, "json").getByTestId("code-editor-tab-released"),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("after")).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(box).toBeFocused();

    // Back in, Tab is the editor's again: Shift+Tab outdents.
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("Shift+Tab");
    await expect(box).toBeFocused();
    await expectValue(page, "json", original);
  });

  test("in a dialog, the first Escape frees Tab and the second closes it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.getByTestId("open-modal").click();
    const modalInput: Locator = page
      .getByTestId("modal-editor")
      .getByTestId("code-editor-input");
    await modalInput.click();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("modal-editor")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(modalInput).not.toBeFocused();
    await expect(page.getByTestId("modal-editor")).toBeVisible();

    await modalInput.click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("modal-editor")).toHaveCount(0);
    await expect(page.getByTestId("modal-closes")).toHaveText("1");
  });

  test("blur is reported when focus leaves, not on every keystroke", async ({
    page,
  }: {
    page: Page;
  }) => {
    await input(page, "json").focus();
    await page.keyboard.type("abc");
    await expect(page.getByTestId("json-blurs")).toHaveText("0");

    await page.getByTestId("after").focus();
    await expect(page.getByTestId("json-blurs")).toHaveText("1");
  });
});

test.describe("scrolling", () => {
  test("the caret stays in view, clear of the line numbers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await input(page, "long").focus();

    await page.keyboard.press("ControlOrMeta+End");
    await expectCaretVisible(page, "long");

    await page.keyboard.press("ControlOrMeta+Home");
    await expectCaretVisible(page, "long");
    await expect
      .poll(async (): Promise<number> => {
        return editor(page, "long")
          .locator(".ou-code-editor__scroller")
          .evaluate((scroller: HTMLElement): number => {
            return scroller.scrollTop;
          });
      })
      .toBe(0);

    for (let step: number = 0; step < 40; step++) {
      await page.keyboard.press("ArrowDown");
    }
    await expectCaretVisible(page, "long");

    // A URL line far wider than the editor.
    await page.keyboard.press("ControlOrMeta+Home");
    for (let step: number = 0; step < 4; step++) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("End");
    await expectCaretVisible(page, "long");

    await page.keyboard.type("typed-at-the-end");
    await expectCaretVisible(page, "long");

    await page.keyboard.press("Home");
    await expectCaretVisible(page, "long");
  });

  test("a short document grows the editor instead of scrolling it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const scroller: Locator = editor(page, "json").locator(
      ".ou-code-editor__scroller",
    );
    const before: number = (await scroller.boundingBox())!.height;

    await input(page, "json").focus();
    await page.keyboard.press("ControlOrMeta+End");
    for (let line: number = 0; line < 10; line++) {
      await page.keyboard.press("Enter");
    }

    const after: number = (await scroller.boundingBox())!.height;
    expect(after).toBeGreaterThan(before);
    expect(
      await scroller.evaluate((element: HTMLElement): number => {
        return element.scrollHeight - element.clientHeight;
      }),
    ).toBeLessThanOrEqual(1);
  });

  test("a fixed height scrolls instead of growing", async ({
    page,
  }: {
    page: Page;
  }) => {
    const scroller: Locator = editor(page, "sql").locator(
      ".ou-code-editor__scroller",
    );
    const before: number = (await scroller.boundingBox())!.height;

    await input(page, "sql").focus();
    await page.keyboard.press("ControlOrMeta+End");
    for (let line: number = 0; line < 20; line++) {
      await page.keyboard.press("Enter");
    }

    expect((await scroller.boundingBox())!.height).toBe(before);
    await expectCaretVisible(page, "sql");
  });
});

test.describe("status bar and gutter", () => {
  test("a JSON error is located, marked in the gutter, and cleared when fixed", async ({
    page,
  }: {
    page: Page;
  }) => {
    const status: Locator = editor(page, "json").getByTestId(
      "code-editor-status",
    );
    await expect(status).toHaveText("Valid JSON · 4 lines");

    await input(page, "json").fill('{\n  "name": "api",\n  "retries": 3,\n}');
    await expect(status).toHaveText(
      "Trailing comma: remove the ',' before '}' (line 3, column 15)",
    );
    await expect(
      editor(page, "json").locator(".ou-code-editor__gutter-error"),
    ).toHaveText("3");

    await input(page, "json").fill('{\n  "name": "api",\n  "retries": 3\n}');
    await expect(status).toHaveText("Valid JSON · 4 lines");
    await expect(
      editor(page, "json").locator(".ou-code-editor__gutter-error"),
    ).toHaveCount(0);
  });

  test("the cursor position follows the caret", async ({
    page,
  }: {
    page: Page;
  }) => {
    const cursor: Locator = editor(page, "json").getByTestId(
      "code-editor-cursor",
    );

    await input(page, "json").focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await expect(cursor).toHaveText("Ln 2, Col 17");

    await page.keyboard.press("Shift+Home");
    await expect(cursor).toContainText("selected");
  });

  test("a click on a line number selects that line", async ({
    page,
  }: {
    page: Page;
  }) => {
    const text: string = await valueOf(page, "sigma");
    const gutter: Locator = editor(page, "sigma").getByTestId(
      "code-editor-gutter",
    );
    const box: { x: number; y: number; width: number; height: number } =
      (await gutter.boundingBox())!;

    await page.mouse.click(
      box.x + box.width / 2,
      box.y + PADDING_Y + 2 * LINE_HEIGHT + LINE_HEIGHT / 2,
    );

    const start: number = text.indexOf("  category:");
    const end: number = text.indexOf("detection:");
    expect(await selectionOf(page, "sigma")).toEqual([start, end]);
    await expect(input(page, "sigma")).toBeFocused();
  });

  test("a placeholder is drawn, never typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    const layer: Locator = editor(page, "empty-json").getByTestId(
      "code-editor-highlight",
    );
    await expect(layer).toContainText('{ "Authorization": "Bearer ..." }');
    await expectValue(page, "empty-json", "");

    await input(page, "empty-json").focus();
    await page.keyboard.type("[");
    await expect(layer).not.toContainText("Authorization");
    await expectValue(page, "empty-json", "[]");
  });
});

test.describe("toolbar", () => {
  test("Format pretty-prints JSON without changing a single value, and undo restores it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const compact: string =
      '{"id":12345678901234567890,"price":1.0,"name":"caf\\u00e9","tags":["a","b"],"empty":{}}';
    await input(page, "json").fill(compact);

    const format: Locator = editor(page, "json").getByTestId(
      "code-editor-format-button",
    );
    await expect(format).toBeEnabled();
    await format.click();

    await expectValue(
      page,
      "json",
      '{\n  "id": 12345678901234567890,\n  "price": 1.0,\n  "name": "caf\\u00e9",\n  "tags": [\n    "a",\n    "b"\n  ],\n  "empty": {}\n}',
    );
    await expect(input(page, "json")).toBeFocused();

    await page.keyboard.press("ControlOrMeta+Z");
    await expectValue(page, "json", compact);
  });

  test("Format is unavailable while the JSON is invalid", async ({
    page,
  }: {
    page: Page;
  }) => {
    await input(page, "json").fill('{"a": 1,}');
    await expect(
      editor(page, "json").getByTestId("code-editor-format-button"),
    ).toBeDisabled();
  });

  test("Insert example fills an empty editor with the sample", async ({
    page,
  }: {
    page: Page;
  }) => {
    const button: Locator = editor(page, "javascript").getByTestId(
      "code-editor-example-button",
    );
    await button.click();

    const inserted: string = await valueOf(page, "javascript");
    expect(inserted.startsWith("// Objects available in the context")).toBe(
      true,
    );
    expect(inserted.endsWith("};")).toBe(true);
    await expect(button).toHaveCount(0);
    await expect(input(page, "javascript")).toBeFocused();
    expect(await selectionOf(page, "javascript")).toEqual([0, 0]);

    await page.keyboard.press("ControlOrMeta+Z");
    await expectValue(page, "javascript", "");
    await expect(button).toBeVisible();
  });

  test("Copy puts the document on the clipboard", async ({
    page,
    context,
    browserName,
  }: {
    page: Page;
    context: BrowserContext;
    browserName: string;
  }) => {
    test.skip(
      browserName !== "chromium",
      "Only Chromium lets a test read the clipboard back.",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const button: Locator = editor(page, "sigma").getByTestId(
      "code-editor-copy-button",
    );
    await button.click();
    await expect(button).toHaveText("Copied");

    const copied: string = await page.evaluate(async (): Promise<string> => {
      return navigator.clipboard.readText();
    });
    expect(copied).toBe(await valueOf(page, "sigma"));
  });
});

test.describe("layout", () => {
  test("a phone-width page does not scroll sideways", async ({
    page,
    browserName,
  }: {
    page: Page;
    browserName: string;
  }) => {
    test.skip(
      browserName !== "chromium",
      "Layout is not engine specific here.",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(editor(page, "long")).toBeVisible();

    const overflow: number = await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    for (const id of ["json", "javascript", "sigma"]) {
      const root: { x: number; width: number } = (await editor(
        page,
        id,
      ).boundingBox())!;
      const copy: { x: number; width: number } = (await editor(page, id)
        .getByTestId("code-editor-copy-button")
        .boundingBox())!;
      expect(copy.x + copy.width, id).toBeLessThanOrEqual(root.x + root.width);
    }
  });

  test("screenshots for review", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    fs.mkdirSync(SCREENSHOTS, { recursive: true });

    for (const theme of ["light", "dark"]) {
      await page.goto(`/?theme=${theme}`);
      await expect(editor(page, "json")).toBeVisible();
      await input(page, "json").fill('{\n  "name": "api",\n  "retries": 3,\n}');
      await expect(
        editor(page, "json").getByTestId("code-editor-status"),
      ).toContainText("Trailing comma");
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${testInfo.project.name}-${theme}.png`),
        fullPage: true,
      });
    }
  });
});
