import { afterEach, describe, expect, test } from "@jest/globals";
import { BackToMetal } from "../../Utils/Books/BookCatalog";
import {
  BookPayload,
  buildPayload,
  click,
  CONTENT_URL,
  createHarness,
  errorResponse,
  FakeResponse,
  FIXTURE_PAGES,
  Harness,
  HarnessOptions,
  keyDown,
  MeasuredLayout,
  MeasuredSection,
  measureFixture,
  Measurement,
  okResponse,
  pointer,
  POSITION_KEY,
  ReaderApi,
  ReaderOptions,
  SETTINGS_KEY,
  sleep,
  waitFor,
} from "./Helpers/ReaderHarness";

/*
 * The in-page reader (Static/js/book-reader.js) and the page glue
 * (Static/js/books.js), run in jsdom against the real rendered /books page.
 *
 * Pagination comes from measureSection (jsdom has no layout); see
 * FIXTURE_PAGES in Helpers/ReaderHarness.ts for the page map most tests use:
 * 18 pages, and on a 1440x900 spread Move 01 opens view 4, Move 02 starts on
 * the right of view 5, Move 03 opens view 7 and the worksheets view 8.
 */

const SPREAD: { width: number; height: number } = { width: 1440, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

let harness: Harness | null = null;

afterEach(() => {
  if (harness) {
    expect(harness.unexpectedErrors()).toEqual([]);
    harness.close();
    harness = null;
  }
});

const setup: (options?: HarnessOptions) => Promise<Harness> = async (
  options: HarnessOptions = {},
): Promise<Harness> => {
  harness = await createHarness(options);
  return harness;
};

interface OpenedReader {
  h: Harness;
  reader: ReaderApi;
  options: ReaderOptions;
  layouts: Array<MeasuredLayout>;
}

/*
 * A reader over the fixture book, opened and settled. Motion starts reduced
 * so opening is instant; tests that exercise animation switch it on
 * afterwards (the reader reads the option each time it needs it).
 */
const openReader: (
  readerOptions?: ReaderOptions,
  harnessOptions?: HarnessOptions,
  openOptions?: Parameters<ReaderApi["open"]>[0],
) => Promise<OpenedReader> = async (
  readerOptions: ReaderOptions = {},
  harnessOptions: HarnessOptions = {},
  openOptions?: Parameters<ReaderApi["open"]>[0],
): Promise<OpenedReader> => {
  const h: Harness = await setup(harnessOptions);
  const layouts: Array<MeasuredLayout> = [];
  const options: ReaderOptions = {
    reducedMotion: true,
    viewport: (): { width: number; height: number } => {
      return SPREAD;
    },
    measureSection: measureFixture(layouts),
    ...readerOptions,
  };
  const reader: ReaderApi = h.createReader(options);

  await reader.open(openOptions);

  return { h, reader, options, layouts };
};

const currentLayout: (layouts: Array<MeasuredLayout>) => MeasuredLayout = (
  layouts: Array<MeasuredLayout>,
): MeasuredLayout => {
  return layouts[layouts.length - 1]!;
};

const text: (element: Element | null | undefined) => string = (
  element: Element | null | undefined,
): string => {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
};

const slotPage: (h: Harness, side: "left" | "right") => HTMLElement | null = (
  h: Harness,
  side: "left" | "right",
): HTMLElement | null => {
  return h.root.querySelector<HTMLElement>(`.bk-slot--${side} > .bk-page`);
};

const countCalls: (target: unknown, method: string) => () => number = (
  target: unknown,
  method: string,
): (() => number) => {
  const record: Record<string, unknown> = target as Record<string, unknown>;
  const original: (...args: Array<unknown>) => unknown = record[method] as (
    ...args: Array<unknown>
  ) => unknown;
  let calls: number = 0;

  record[method] = function (this: unknown, ...args: Array<unknown>): unknown {
    calls++;
    return original.apply(this, args);
  };

  return (): number => {
    return calls;
  };
};

const deferred: () => {
  promise: Promise<FakeResponse>;
  resolve: (response: FakeResponse) => void;
} = (): {
  promise: Promise<FakeResponse>;
  resolve: (response: FakeResponse) => void;
} => {
  let resolve: (response: FakeResponse) => void = (): void => {};
  const promise: Promise<FakeResponse> = new Promise<FakeResponse>(
    (done: (response: FakeResponse) => void) => {
      resolve = done;
    },
  );

  return { promise, resolve };
};

const READ_HASH: RegExp = /^#read/;

const hasReadHash: (h: Harness) => boolean = (h: Harness): boolean => {
  return READ_HASH.test(h.window.location.hash);
};

/*
 * Closing pops the history entry the reader pushed, and the browser does that
 * asynchronously; reopening before it lands would have that pop close the new
 * session. A person cannot click that fast, so tests wait for it.
 */
const closeAndSettle: (h: Harness, reader: ReaderApi) => Promise<void> = async (
  h: Harness,
  reader: ReaderApi,
): Promise<void> => {
  reader.close();
  await waitFor((): boolean => {
    return !hasReadHash(h);
  }, "the reader's history entry to be popped");
  await sleep(10);
};

const storedPosition: () => Record<string, unknown> | null = (): Record<
  string,
  unknown
> | null => {
  const raw: string | null = harness!.window.localStorage.getItem(POSITION_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

describe("opening the reader", () => {
  test("opens as a modal dialog, locks the page and pushes a #read history entry", async () => {
    const h: Harness = await setup();
    const reader: ReaderApi = h.createReader({
      reducedMotion: true,
      viewport: (): { width: number; height: number } => {
        return SPREAD;
      },
      measureSection: measureFixture(),
    });
    const historyLength: number = h.window.history.length;

    expect(h.root.hidden).toBe(true);
    expect(h.root.getAttribute("role")).toBe("dialog");
    expect(h.root.getAttribute("aria-modal")).toBe("true");

    const opening: Promise<void> = reader.open();

    // Synchronously: visible, locked, in the history, focused and loading.
    expect(h.root.hidden).toBe(false);
    expect(
      h.document.documentElement.classList.contains("bk-reader-lock"),
    ).toBe(true);
    expect(h.window.location.hash).toBe("#read");
    expect(h.window.history.length).toBe(historyLength + 1);
    expect(h.window.history.state).toEqual({ bookReader: "back-to-metal" });
    expect(h.document.activeElement).toBe(h.$('[data-reader-action="close"]'));
    expect(h.$(".bk-reader-status").hidden).toBe(false);
    expect(h.$(".bk-reader-status").getAttribute("data-kind")).toBe("loading");
    expect(text(h.$(".bk-reader-message"))).toContain("Opening Back to Metal");
    expect(h.root.getAttribute("aria-busy")).toBe("true");

    await opening;

    expect(h.$(".bk-reader-status").hidden).toBe(true);
    expect(h.root.hasAttribute("aria-busy")).toBe(false);
    expect(reader.isOpen()).toBe(true);
    expect(reader.getState()).toMatchObject({
      open: true,
      loaded: true,
      view: 0,
      views: 10,
      pages: 18,
      mode: "spread",
      sectionId: "titlepage",
      turning: false,
    });
    expect(h.$(".bk-book").getAttribute("aria-hidden")).toBe("true");
    expect(text(h.$(".bk-reader-live"))).toBe("Page 1 of 18. Title page");
    expect(h.$(".bk-reader-live").getAttribute("aria-live")).toBe("polite");
    // Reading replaces the entry it pushed rather than adding more.
    expect(h.window.location.hash).toBe("#read/titlepage");
    expect(h.window.history.length).toBe(historyLength + 1);

    await waitFor((): boolean => {
      return h.root.classList.contains("is-visible");
    }, "the fade-in class");
  });

  test("fetches the book once, from the content URL, and keeps it across close and reopen", async () => {
    const { h, reader }: OpenedReader = await openReader();

    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]!.url).toBe(CONTENT_URL);
    expect(CONTENT_URL).toBe("/books/back-to-metal/content.json");
    expect(h.fetchCalls[0]!.init).toMatchObject({
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    await closeAndSettle(h, reader);
    expect(reader.isOpen()).toBe(false);
    await reader.open();

    expect(h.fetchCalls).toHaveLength(1);
    expect(reader.getState().view).toBe(0);
  });

  test("opens on the title page, facing the inside of the front cover", async () => {
    const { h }: OpenedReader = await openReader();
    const left: HTMLElement = slotPage(h, "left")!;
    const right: HTMLElement = slotPage(h, "right")!;

    expect(left.classList.contains("bk-page--endpaper")).toBe(true);
    expect(text(left)).toContain("Ex libris");
    expect(text(left)).toContain("The OneUptime Library");
    expect(right.classList.contains("bk-page--title")).toBe(true);
    expect(right.getAttribute("data-section")).toBe("titlepage");
    expect(right.getAttribute("data-page")).toBe("1");
    expect(text(right.querySelector(".bk-section-title"))).toBe(
      "Back to Metal",
    );
    expect(h.$(".bk-book").getAttribute("data-state")).toBe("open");
  });

  test("animates the closed cover open when motion is allowed", async () => {
    const h: Harness = await setup();
    const reader: ReaderApi = h.createReader({
      reducedMotion: false,
      viewport: (): { width: number; height: number } => {
        return SPREAD;
      },
      measureSection: measureFixture(),
    });
    const states: Array<string> = [];
    const book: HTMLElement = h.$(".bk-book");
    const observer: MutationObserver = new h.window.MutationObserver(() => {
      const state: string = book.getAttribute("data-state") || "";

      if (states[states.length - 1] !== state) {
        states.push(state);
      }
    });

    observer.observe(book, {
      attributes: true,
      attributeFilter: ["data-state"],
    });

    await reader.open();
    await sleep(10);
    observer.disconnect();

    expect(states).toEqual(["closed", "opening", "open"]);
    expect(reader.getState().view).toBe(0);
    expect(book.hasAttribute("data-cover")).toBe(false);
  });

  test("opens at a requested section and puts it in the URL", async () => {
    const { h, reader }: OpenedReader = await openReader(
      {},
      {},
      {
        sectionId: "m02",
      },
    );

    expect(reader.getState()).toMatchObject({ view: 5, sectionId: "m02" });
    expect(h.window.location.hash).toBe("#read/m02");
    expect(slotPage(h, "right")!.getAttribute("data-section")).toBe("m02");
    expect(slotPage(h, "right")!.classList.contains("bk-page--opener")).toBe(
      true,
    );
  });

  test("an unknown or unsafe section id opens at the start", async () => {
    const { h, reader }: OpenedReader = await openReader(
      {},
      {},
      {
        sectionId: "../../etc",
      },
    );

    expect(reader.getState().view).toBe(0);
    expect(h.window.location.hash).toBe("#read/titlepage");
  });

  test("opening again while open navigates instead of reopening", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const historyLength: number = h.window.history.length;

    await reader.open({ sectionId: "m03" });

    expect(reader.getState()).toMatchObject({ view: 7, sectionId: "m03" });
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.window.history.length).toBe(historyLength);
  });

  test("a single page is shown on a phone", async () => {
    const { h, reader }: OpenedReader = await openReader({
      viewport: (): { width: number; height: number } => {
        return PHONE;
      },
    });

    expect(reader.getState()).toMatchObject({
      mode: "single",
      views: 18,
      pages: 18,
    });
    expect(h.$(".bk-book").getAttribute("data-mode")).toBe("single");
    expect(h.root.querySelector(".bk-slot--left")!.children).toHaveLength(0);

    reader.goToView(7);

    const page: HTMLElement = slotPage(h, "right")!;

    expect(page.classList.contains("bk-page--single")).toBe(true);
    expect(page.getAttribute("data-page")).toBe("8");
    expect(page.getAttribute("data-section")).toBe("m01");
    expect(text(page.querySelector(".bk-page-head"))).toBe("Stage 1 · Decide");
    expect(text(h.$(".bk-reader-pages"))).toBe("Page 8 of 18");
  });
});

describe("turning pages", () => {
  test("next and prev move a spread at a time, and prev on the title page closes the book", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.next();
    expect(reader.getState().view).toBe(1);
    expect(text(h.$(".bk-reader-pages"))).toBe("Pages 2–3 of 18");
    reader.next();
    reader.prev();
    expect(reader.getState().view).toBe(1);
    reader.prev();
    expect(reader.getState().view).toBe(0);

    reader.prev();
    await waitFor((): boolean => {
      return reader.getState().view === -1;
    }, "the book to close");

    expect(h.$(".bk-book").getAttribute("data-state")).toBe("closed");
    expect(
      (h.$('[data-reader-action="prev"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (h.$('[data-reader-action="next"]') as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(text(h.$(".bk-reader-pages"))).toBe("Closed · 18 pages");
    expect(text(h.$(".bk-reader-live"))).toBe("Back to Metal is closed.");
    expect(h.root.querySelectorAll(".bk-slot .bk-page")).toHaveLength(0);

    reader.next();
    await waitFor((): boolean => {
      return reader.getState().view === 0;
    }, "the book to open again");
    expect(h.$(".bk-book").getAttribute("data-state")).toBe("open");
  });

  test("the toolbar buttons turn pages and stop at the last spread", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const next: HTMLButtonElement = h.$(
      '[data-reader-action="next"]',
    ) as HTMLButtonElement;

    for (let press: number = 0; press < 20; press++) {
      next.click();
    }

    expect(reader.getState().view).toBe(9);
    expect(next.disabled).toBe(true);

    (h.$('[data-reader-action="prev"]') as HTMLButtonElement).click();
    expect(reader.getState().view).toBe(8);
    expect(next.disabled).toBe(false);
  });

  test("the keyboard turns pages", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const steps: Array<[string, boolean, number]> = [
      ["ArrowRight", false, 1],
      ["PageDown", false, 2],
      ["ArrowLeft", false, 1],
      ["PageUp", false, 0],
      [" ", false, 1],
      [" ", true, 0],
      ["End", false, 9],
      ["Home", false, 0],
    ];

    for (const [key, shiftKey, view] of steps) {
      const notPrevented: boolean = keyDown(h.root, key, { shiftKey });

      expect(notPrevented).toBe(false);
      expect(reader.getState().view).toBe(view);
    }
  });

  test("keys with modifiers, keys typed into the scrubber and Space on a button are left alone", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToView(3);

    for (const modifiers of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      expect(keyDown(h.root, "ArrowRight", modifiers)).toBe(true);
    }
    expect(keyDown(h.$(".bk-reader-scrubber"), "ArrowRight")).toBe(true);
    expect(keyDown(h.$(".bk-reader-scrubber"), "Home")).toBe(true);
    expect(keyDown(h.$('[data-reader-action="contents"]'), " ")).toBe(true);
    expect(keyDown(h.root, "q")).toBe(true);
    expect(reader.getState().view).toBe(3);
  });

  test("the scrubber previews a page while dragging and goes there on release", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const scrubber: HTMLInputElement = h.$(
      ".bk-reader-scrubber",
    ) as HTMLInputElement;

    expect(scrubber.max).toBe("9");
    expect(scrubber.value).toBe("0");
    expect(scrubber.getAttribute("aria-valuetext")).toBe(
      "Page 1 of 18, Title page",
    );

    scrubber.value = "5";
    scrubber.dispatchEvent(new h.window.Event("input", { bubbles: true }));

    expect(text(h.$(".bk-reader-pages"))).toBe("Pages 10–11 of 18");
    expect(text(h.$(".bk-reader-location"))).toBe(
      "Stage 1 · Decide — 02 · What you actually run",
    );
    expect(reader.getState().view).toBe(0);

    scrubber.dispatchEvent(new h.window.Event("change", { bubbles: true }));

    expect(reader.getState()).toMatchObject({ view: 5, sectionId: "m02" });
    expect(scrubber.getAttribute("aria-valuetext")).toBe(
      "Pages 10–11 of 18, Stage 1 · Decide — 02 · What you actually run",
    );
    expect(h.$(".bk-reader-progress-bar").style.transform).toBe(
      `scaleX(${5 / 9})`,
    );
  });

  test("goToView clamps to the book", async () => {
    const { reader }: OpenedReader = await openReader();

    reader.goToView(99);
    expect(reader.getState().view).toBe(9);
    reader.goToView(-5);
    expect(reader.getState().view).toBe(0);
    reader.goToView(4.4);
    expect(reader.getState().view).toBe(4);
  });

  test("goToSection opens a chapter, or the page an anchor inside it is on", async () => {
    const { reader }: OpenedReader = await openReader();

    expect(reader.goToSection("m01")).toBe(true);
    expect(reader.getState()).toMatchObject({ view: 4, sectionId: "m01" });
    expect(reader.goToSection("worksheets")).toBe(true);
    expect(reader.getState().view).toBe(8);
    expect(
      reader.goToSection("worksheets", "bk-worksheets--restore-proof"),
    ).toBe(true);
    expect(reader.getState()).toMatchObject({
      view: 9,
      sectionId: "worksheets",
    });
    expect(reader.goToSection("m02", "bk-m02--local-note")).toBe(true);
    expect(reader.getState()).toMatchObject({ view: 6, sectionId: "m02" });
    expect(reader.goToSection("m02", "no-such-anchor")).toBe(true);
    expect(reader.getState().view).toBe(5);
    expect(reader.goToSection("nope")).toBe(false);
    expect(reader.getState().view).toBe(5);
  });

  test("the toolbar names the chapter being read", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToView(4);
    expect(text(h.$(".bk-reader-location"))).toBe(
      "Stage 1 · Decide — 01 · The bill, and the three lines that are most of it",
    );
    // Move 01 ends on the left and Move 02 starts on the right: Move 02 is next.
    reader.goToView(5);
    expect(reader.getState().sectionId).toBe("m02");
    reader.goToView(8);
    expect(text(h.$(".bk-reader-location"))).toBe("Operator worksheets");
  });

  test("the page-edge stacks show how much has been read", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const book: HTMLElement = h.$(".bk-book");

    expect(book.style.getPropertyValue("--bk-read")).toBe("0");
    expect(book.style.getPropertyValue("--bk-unread")).toBe("1");
    reader.goToView(9);
    expect(book.style.getPropertyValue("--bk-read")).toBe("1");
    expect(book.style.getPropertyValue("--bk-unread")).toBe("0");
  });

  test("the book follows the window between a spread and a single page, keeping the place", async () => {
    let viewport: { width: number; height: number } = SPREAD;
    const { h, reader }: OpenedReader = await openReader({
      viewport: (): { width: number; height: number } => {
        return viewport;
      },
    });

    reader.goToSection("m03");
    viewport = PHONE;
    h.window.dispatchEvent(new h.window.Event("resize"));
    await waitFor((): boolean => {
      return reader.getState().mode === "single";
    }, "the phone layout");

    expect(reader.getState()).toMatchObject({ view: 13, sectionId: "m03" });

    viewport = SPREAD;
    h.window.dispatchEvent(new h.window.Event("resize"));
    await waitFor((): boolean => {
      return reader.getState().mode === "spread";
    }, "the spread layout");

    expect(reader.getState()).toMatchObject({ view: 7, sectionId: "m03" });
  });
});

describe("rendering pages", () => {
  test("a spread has running heads, folios and a chapter opener", async () => {
    const { h, reader, layouts }: OpenedReader = await openReader();

    reader.goToView(4);

    const left: HTMLElement = slotPage(h, "left")!;
    const right: HTMLElement = slotPage(h, "right")!;
    const layout: MeasuredLayout = currentLayout(layouts);
    const stride: number = layout.contentWidth + layout.columnGap;

    expect(left.classList.contains("bk-page--left")).toBe(true);
    expect(left.classList.contains("bk-page--opener")).toBe(true);
    expect(left.getAttribute("data-page")).toBe("8");
    expect(left.getAttribute("data-section")).toBe("m01");
    expect(text(left.querySelector(".bk-page-head"))).toBe("Back to Metal");
    expect(text(left.querySelector(".bk-folio"))).toBe("8");
    expect(text(left.querySelector(".bk-opener-part"))).toBe(
      "Stage 1 · Decide",
    );
    expect(text(left.querySelector(".bk-opener-number"))).toBe("01");
    // The chapter number is shown once, by the opener, not again in the title.
    expect(text(left.querySelector("h1.bk-section-title"))).toBe(
      "The bill, and the three lines that are most of it",
    );
    expect(
      (left.querySelector(".bk-flow") as HTMLElement).style.transform,
    ).toBe("translate3d(0px, 0, 0)");

    expect(right.classList.contains("bk-page--right")).toBe(true);
    expect(right.classList.contains("bk-page--opener")).toBe(false);
    expect(right.getAttribute("data-page")).toBe("9");
    expect(text(right.querySelector(".bk-page-head"))).toBe("Stage 1 · Decide");
    expect(text(right.querySelector(".bk-folio"))).toBe("9");
    expect(
      (right.querySelector(".bk-flow") as HTMLElement).style.transform,
    ).toBe(`translate3d(${-stride}px, 0, 0)`);
    expect(text(h.$(".bk-reader-pages"))).toBe("Pages 8–9 of 18");
  });

  test("chapters without a part use their own title as the running head", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToView(8);
    expect(text(slotPage(h, "right")!.querySelector(".bk-page-head"))).toBe(
      "Operator worksheets",
    );
  });

  test("the last spread ends on the back endpaper", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToView(9);

    const left: HTMLElement = slotPage(h, "left")!;
    const right: HTMLElement = slotPage(h, "right")!;
    const contentsLink: HTMLElement = right.querySelector<HTMLElement>(
      'a[data-book-section="contents"]',
    )!;
    const websiteLink: HTMLElement = right.querySelector<HTMLElement>(
      `a[href="${BackToMetal.siteUrl}"]`,
    )!;

    expect(left.getAttribute("data-page")).toBe("18");
    expect(right.classList.contains("bk-page--endpaper")).toBe(true);
    expect(text(right)).toContain("The end.");
    expect(text(contentsLink)).toBe("Back to the contents");
    expect(websiteLink.getAttribute("target")).toBe("_blank");
    expect(websiteLink.getAttribute("rel")).toBe("noopener noreferrer");

    click(contentsLink);
    expect(reader.getState()).toMatchObject({ view: 2, sectionId: "contents" });
  });

  test("the contents page lists every chapter with its page number and groups the parts", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToSection("contents");

    const page: HTMLElement = slotPage(h, "left")!;
    const numbers: Record<string, string> = {};

    expect(page.getAttribute("data-section")).toBe("contents");
    expect(text(page.querySelector(".bk-section-title"))).toBe("Contents");
    expect(
      Array.from(page.querySelectorAll(".bk-contents-part-label")).map(text),
    ).toEqual(["Stage 1 · Decide", "Stage 2 · Buy"]);

    for (const link of Array.from(
      page.querySelectorAll<HTMLElement>(".bk-contents-link"),
    )) {
      numbers[text(link.querySelector(".bk-contents-label"))] = text(
        link.querySelector(".bk-contents-page"),
      );
    }

    expect(numbers).toEqual({
      "Why this book exists": "5",
      "Before you touch anything": "7",
      "01 · The bill, and the three lines that are most of it": "8",
      "02 · What you actually run": "11",
      "03 · From rented vCPUs to cores you own": "14",
      "Operator worksheets": "16",
    });
    // The title page is not listed, and anchors stay in the drawer.
    expect(text(page)).not.toContain("Title page");
    expect(text(page)).not.toContain("Rehearsal record");
  });

  test("ids become data attributes, so the copies of a chapter on every page never clash", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToView(8);

    expect(
      h.root.querySelectorAll(".bk-book [id], .bk-reader-text [id]"),
    ).toHaveLength(0);
    expect(
      h.root.querySelectorAll(
        '.bk-book [data-bk-id="bk-worksheets--restore-proof"]',
      ).length,
    ).toBeGreaterThan(0);
    expect(h.document.querySelectorAll('[id="book-reader"]')).toHaveLength(1);
  });

  test("the current chapter is available as text to screen readers, out of the tab order", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToView(4);

    const readable: HTMLElement = h.$(".bk-reader-text");
    const links: Array<HTMLElement> = Array.from(
      readable.querySelectorAll<HTMLElement>("a[href]"),
    );

    expect(readable.getAttribute("aria-label")).toBe(
      "Text of the current chapter",
    );
    expect(text(readable.querySelector("h1"))).toBe(
      "The bill, and the three lines that are most of it",
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("tabindex")).toBe("-1");
    }

    const pageLinks: Array<HTMLElement> = Array.from(
      h.root.querySelectorAll<HTMLElement>(".bk-book a[href]"),
    );

    expect(pageLinks.length).toBeGreaterThan(0);
    for (const link of pageLinks) {
      expect(link.getAttribute("tabindex")).toBe("-1");
    }
  });

  test("links inside the pages turn to their target", async () => {
    const { h, reader }: OpenedReader = await openReader();

    reader.goToView(4);

    const next: HTMLElement = slotPage(h, "left")!.querySelector<HTMLElement>(
      'a[data-book-section="m02"]',
    )!;

    expect(next.getAttribute("href")).toBe("#read/m02");
    expect(click(next)).toBe(false);
    expect(reader.getState()).toMatchObject({ view: 5, sectionId: "m02" });

    reader.goToView(4);

    const proof: HTMLElement = slotPage(h, "left")!.querySelector<HTMLElement>(
      'a[data-book-anchor="bk-worksheets--restore-proof"]',
    )!;

    expect(click(proof)).toBe(false);
    expect(reader.getState().view).toBe(9);
  });
});

describe("the contents drawer", () => {
  test("lists the whole book with page numbers, parts and anchors", async () => {
    const { h }: OpenedReader = await openReader();
    const entries: Array<[string, string]> = Array.from(
      h.root.querySelectorAll<HTMLElement>(".bk-drawer-link"),
    ).map((link: HTMLElement): [string, string] => {
      return [
        text(link.querySelector(".bk-drawer-label")),
        text(link.querySelector(".bk-drawer-page")),
      ];
    });

    expect(entries).toEqual([
      ["Contents", "4"],
      ["Title page", "1"],
      ["Why this book exists", "5"],
      ["Before you touch anything", "7"],
      ["01 · The bill, and the three lines that are most of it", "8"],
      ["02 · What you actually run", "11"],
      ["03 · From rented vCPUs to cores you own", "14"],
      ["Operator worksheets", "16"],
      ["Rehearsal record", "16"],
      ["Restore proof", "18"],
    ]);
    expect(
      Array.from(h.root.querySelectorAll(".bk-drawer-group-label")).map(text),
    ).toEqual(["Stage 1 · Decide", "Stage 2 · Buy"]);
  });

  test("opens from the toolbar with focus on the current chapter", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const button: HTMLElement = h.$('[data-reader-action="contents"]');
    const drawer: HTMLElement = h.$(".bk-drawer");

    reader.goToSection("m02");
    button.click();

    expect(drawer.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(h.root.classList.contains("has-contents-open")).toBe(true);
    expect(h.document.activeElement).toBe(
      drawer.querySelector(
        'a[data-book-section="m02"]:not([data-book-anchor])',
      ),
    );
    expect(
      drawer
        .querySelector('a[data-book-section="m02"]')!
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(drawer.querySelectorAll('[aria-current="true"]')).toHaveLength(1);

    button.click();
    expect(drawer.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  test("Escape closes the drawer before it closes the book", async () => {
    const { h, reader }: OpenedReader = await openReader();

    h.$('[data-reader-action="contents"]').click();
    keyDown(h.document.activeElement!, "Escape");

    expect(h.$(".bk-drawer").hidden).toBe(true);
    expect(reader.isOpen()).toBe(true);
    expect(h.document.activeElement).toBe(
      h.$('[data-reader-action="contents"]'),
    );

    keyDown(h.document.activeElement!, "Escape");
    expect(reader.isOpen()).toBe(false);
  });

  test("choosing an entry goes there and closes the drawer", async () => {
    const { h, reader }: OpenedReader = await openReader();

    h.$('[data-reader-action="contents"]').click();

    const entry: HTMLElement = h.$('.bk-drawer a[data-book-section="m03"]');

    expect(click(entry)).toBe(false);
    expect(reader.getState()).toMatchObject({ view: 7, sectionId: "m03" });
    expect(h.$(".bk-drawer").hidden).toBe(true);
    expect(entry.getAttribute("aria-current")).toBe("true");

    h.$('[data-reader-action="contents"]').click();
    click(h.$('.bk-drawer a[data-book-anchor="bk-worksheets--restore-proof"]'));
    expect(reader.getState().view).toBe(9);
  });

  test("the close button and the backdrop close the panels, not the book", async () => {
    const { h, reader }: OpenedReader = await openReader();

    h.$('[data-reader-action="contents"]').click();
    h.$('.bk-drawer [data-reader-action="contents"]').click();
    expect(h.$(".bk-drawer").hidden).toBe(true);

    h.$('[data-reader-action="settings"]').click();
    expect(h.$(".bk-settings").hidden).toBe(false);
    h.$(".bk-reader-backdrop").click();
    expect(h.$(".bk-settings").hidden).toBe(true);
    expect(reader.isOpen()).toBe(true);
  });

  test("only one panel is open at a time", async () => {
    const { h }: OpenedReader = await openReader();

    h.$('[data-reader-action="contents"]').click();
    h.$('.bk-reader-bar [data-reader-action="settings"]').click();

    expect(h.$(".bk-drawer").hidden).toBe(true);
    expect(h.$(".bk-settings").hidden).toBe(false);
    expect(
      h.$('[data-reader-action="contents"]').getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      h.$('[data-reader-action="settings"]').getAttribute("aria-expanded"),
    ).toBe("true");
  });
});

describe("reading settings", () => {
  test("larger text re-lays out the book and keeps the reader in the same chapter", async () => {
    const layouts: Array<MeasuredLayout> = [];
    const { h, reader }: OpenedReader = await openReader({
      measureSection: (
        section: MeasuredSection,
        layout: MeasuredLayout,
        index: number,
      ): Measurement => {
        if (index === 0) {
          layouts.push(layout);
        }

        return (
          (FIXTURE_PAGES[section.id] ?? 1) * (layout.fontStep >= 3 ? 2 : 1)
        );
      },
    });

    reader.goToSection("m02");
    expect(reader.getState().view).toBe(5);

    h.$('[data-reader-action="settings"]').click();
    h.$('[data-reader-action="font-larger"]').click();

    expect(layouts).toHaveLength(2);
    expect(layouts[1]!.fontSize).toBeGreaterThan(layouts[0]!.fontSize);
    expect(reader.getState()).toMatchObject({
      pages: 36,
      view: 10,
      sectionId: "m02",
      settings: { fontStep: 3, theme: "paper" },
    });

    h.$('[data-reader-action="font-smaller"]').click();
    expect(layouts[2]!.fontSize).toBe(layouts[0]!.fontSize);
    expect(reader.getState()).toMatchObject({ view: 5, sectionId: "m02" });
  });

  test("the size buttons stop at the smallest and largest sizes", async () => {
    const { h, reader, layouts }: OpenedReader = await openReader();
    const smaller: HTMLButtonElement = h.$(
      '[data-reader-action="font-smaller"]',
    ) as HTMLButtonElement;
    const larger: HTMLButtonElement = h.$(
      '[data-reader-action="font-larger"]',
    ) as HTMLButtonElement;

    for (let press: number = 0; press < 4; press++) {
      smaller.click();
    }

    expect(reader.getState().settings.fontStep).toBe(0);
    expect(smaller.disabled).toBe(true);
    expect(larger.disabled).toBe(false);
    // Two real changes (2 -> 1 -> 0) plus the first layout.
    expect(layouts).toHaveLength(3);

    for (let press: number = 0; press < 9; press++) {
      larger.click();
    }

    expect(reader.getState().settings.fontStep).toBe(5);
    expect(larger.disabled).toBe(true);
    expect(smaller.disabled).toBe(false);
    expect(layouts).toHaveLength(8);
  });

  test("themes are radio buttons that recolour the reader and are remembered", async () => {
    const { h, reader }: OpenedReader = await openReader();

    expect(h.root.getAttribute("data-theme")).toBe("paper");
    click(h.$('[data-reader-theme="night"]'));

    expect(h.root.getAttribute("data-theme")).toBe("night");
    expect(
      h
        .$$("[data-reader-theme]")
        .map((button: HTMLElement): [string, string] => {
          return [
            button.getAttribute("data-reader-theme") || "",
            button.getAttribute("aria-checked") || "",
          ];
        }),
    ).toEqual([
      ["paper", "false"],
      ["sepia", "false"],
      ["night", "true"],
    ]);
    expect(reader.getState().settings.theme).toBe("night");
    expect(
      JSON.parse(h.window.localStorage.getItem(SETTINGS_KEY) || "{}"),
    ).toEqual({ fontStep: 2, theme: "night" });
  });

  test("a returning reader gets their theme and text size back", async () => {
    const { h, reader, layouts }: OpenedReader = await openReader(
      {},
      {
        storage: {
          [SETTINGS_KEY]: JSON.stringify({ fontStep: 0, theme: "sepia" }),
        },
      },
    );

    expect(h.root.getAttribute("data-theme")).toBe("sepia");
    expect(
      h.$('[data-reader-theme="sepia"]').getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      (h.$('[data-reader-action="font-smaller"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(layouts[0]!.fontStep).toBe(0);
    expect(reader.getState().settings).toEqual({
      fontStep: 0,
      theme: "sepia",
    });
  });

  test("broken stored settings fall back to the defaults", async () => {
    const { h, reader }: OpenedReader = await openReader(
      {},
      { storage: { [SETTINGS_KEY]: "{not json" } },
    );

    expect(reader.getState().settings).toEqual({
      fontStep: 2,
      theme: "paper",
    });
    expect(h.root.getAttribute("data-theme")).toBe("paper");
  });

  test("the full-screen button is hidden where full screen is not available", async () => {
    const { h }: OpenedReader = await openReader();

    expect(h.$('[data-reader-action="fullscreen"]').hidden).toBe(true);
  });
});

describe("remembering the place", () => {
  test("the position is saved as the reader turns pages", async () => {
    const { reader }: OpenedReader = await openReader();

    expect(storedPosition()).toMatchObject({
      sectionId: "titlepage",
      fraction: 0,
      progress: 0,
    });

    reader.goToSection("m02");

    const saved: Record<string, unknown> = storedPosition()!;

    expect(saved).toMatchObject({
      sectionId: "m02",
      fraction: 0,
      label: "Move 02 · What you actually run",
      progress: 0.556,
    });
    expect(typeof saved["updatedAt"]).toBe("number");

    reader.goToView(9);
    expect(storedPosition()).toMatchObject({
      sectionId: "worksheets",
      fraction: 0.6667,
      label: "Operator worksheets",
      progress: 1,
    });
  });

  test("a returning reader opens where they left off", async () => {
    const { reader }: OpenedReader = await openReader(
      {},
      {
        storage: {
          [POSITION_KEY]: JSON.stringify({
            sectionId: "worksheets",
            fraction: 0.6667,
          }),
        },
      },
    );

    expect(reader.getState()).toMatchObject({
      view: 9,
      sectionId: "worksheets",
    });
    expect(reader.savedPosition()).toMatchObject({ sectionId: "worksheets" });
  });

  test("fromStart opens at the beginning even with a saved place", async () => {
    const { reader }: OpenedReader = await openReader(
      {},
      {
        storage: {
          [POSITION_KEY]: JSON.stringify({ sectionId: "m03", fraction: 0 }),
        },
      },
      { fromStart: true },
    );

    expect(reader.getState().view).toBe(0);
  });

  test("an explicit section wins over the saved place", async () => {
    const { reader }: OpenedReader = await openReader(
      {},
      {
        storage: {
          [POSITION_KEY]: JSON.stringify({ sectionId: "m03", fraction: 0 }),
        },
      },
      { sectionId: "m01" },
    );

    expect(reader.getState()).toMatchObject({ view: 4, sectionId: "m01" });
  });

  test.each([
    JSON.stringify({ sectionId: "gone-in-a-new-edition", fraction: 0.5 }),
    "{broken",
    JSON.stringify({ sectionId: "<script>", fraction: 0.5 }),
  ])(
    "a saved place that no longer exists (%s) opens at the start",
    async (raw: string) => {
      const { reader }: OpenedReader = await openReader(
        {},
        { storage: { [POSITION_KEY]: raw } },
      );

      expect(reader.getState().view).toBe(0);
    },
  );
});

describe("history and deep links", () => {
  test("the URL follows the chapter being read, without adding history entries", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const length: number = h.window.history.length;

    reader.goToSection("m03");
    expect(h.window.location.hash).toBe("#read/m03");
    reader.goToSection("worksheets");
    expect(h.window.location.hash).toBe("#read/worksheets");
    expect(h.window.history.length).toBe(length);
  });

  test("the browser's back button closes the book", async () => {
    const { h, reader }: OpenedReader = await openReader();

    h.window.history.back();
    await waitFor((): boolean => {
      return !reader.isOpen();
    }, "the reader to close");

    expect(h.root.hidden).toBe(true);
    expect(
      h.document.documentElement.classList.contains("bk-reader-lock"),
    ).toBe(false);
    expect(h.window.location.hash).toBe("");
  });

  test("navigating to #read/m01 opens the book there without a new history entry", async () => {
    const h: Harness = await setup();
    const reader: ReaderApi = h.createReader({
      reducedMotion: true,
      viewport: (): { width: number; height: number } => {
        return SPREAD;
      },
      measureSection: measureFixture(),
    });
    const pushes: () => number = countCalls(h.window.history, "pushState");

    h.window.location.hash = "#read/m01";
    await waitFor((): boolean => {
      return reader.getState().sectionId === "m01";
    }, "the reader to open at Move 01");

    expect(reader.getState().view).toBe(4);
    expect(pushes()).toBe(0);
  });

  test("other hashes on the page do not open the book", async () => {
    const h: Harness = await setup();
    const reader: ReaderApi = h.createReader({
      reducedMotion: true,
      measureSection: measureFixture(),
    });

    h.window.location.hash = "#inside-the-book";
    await sleep(30);

    expect(reader.isOpen()).toBe(false);
    expect(h.fetchCalls).toHaveLength(0);
  });
});

describe("closing", () => {
  test("Escape closes the book, returns focus and pops the history entry it pushed", async () => {
    const h: Harness = await setup();
    const reader: ReaderApi = h.createReader({
      reducedMotion: true,
      measureSection: measureFixture(),
    });
    const trigger: HTMLElement = h.$(".books-actions a[data-book-open]");
    const backs: () => number = countCalls(h.window.history, "back");

    trigger.focus();
    await reader.open();
    expect(h.document.activeElement).not.toBe(trigger);

    expect(keyDown(h.root, "Escape")).toBe(false);

    expect(reader.isOpen()).toBe(false);
    expect(h.root.hidden).toBe(true);
    expect(h.root.classList.contains("is-visible")).toBe(false);
    expect(
      h.document.documentElement.classList.contains("bk-reader-lock"),
    ).toBe(false);
    expect(h.document.activeElement).toBe(trigger);
    expect(backs()).toBe(1);

    await waitFor((): boolean => {
      return h.window.location.hash === "";
    }, "the history entry to be popped");
    // The popstate that follows must not reopen or re-close anything.
    await sleep(20);
    expect(reader.isOpen()).toBe(false);
  });

  test("the close button closes the book", async () => {
    const { h, reader }: OpenedReader = await openReader();

    h.$('[data-reader-action="close"]').click();
    expect(reader.isOpen()).toBe(false);
  });

  test("a book opened from a deep link removes its hash when closed", async () => {
    const h: Harness = await setup({
      url: "https://oneuptime.com/books#read/m02",
    });
    const reader: ReaderApi = h.createReader({
      reducedMotion: true,
      measureSection: measureFixture(),
    });
    const backs: () => number = countCalls(h.window.history, "back");

    await reader.open({ sectionId: "m02", pushHistory: false });
    reader.close();

    expect(backs()).toBe(0);
    expect(h.window.location.hash).toBe("");
    expect(h.window.location.pathname).toBe("/books");
  });

  test("with motion, the dialog fades out before it is hidden", async () => {
    const { h, reader, options }: OpenedReader = await openReader();

    options.reducedMotion = false;
    reader.close();

    expect(h.root.classList.contains("is-visible")).toBe(false);
    expect(h.root.hidden).toBe(false);
    await waitFor((): boolean => {
      return h.root.hidden;
    }, "the dialog to hide");
  });

  test("closing twice is harmless", async () => {
    const { reader }: OpenedReader = await openReader();

    reader.close();
    reader.close();
    expect(reader.isOpen()).toBe(false);
  });
});

describe("focus", () => {
  test("Tab and Shift+Tab stay inside the dialog", async () => {
    const { h }: OpenedReader = await openReader();
    const close: HTMLElement = h.$('[data-reader-action="close"]');
    const scrubber: HTMLElement = h.$(".bk-reader-scrubber");

    scrubber.focus();
    expect(keyDown(scrubber, "Tab")).toBe(false);
    expect(h.document.activeElement).toBe(close);

    expect(keyDown(close, "Tab", { shiftKey: true })).toBe(false);
    expect(h.document.activeElement).toBe(scrubber);

    // In the middle of the dialog, Tab is left to the browser.
    const contents: HTMLElement = h.$('[data-reader-action="contents"]');

    contents.focus();
    expect(keyDown(contents, "Tab")).toBe(true);
  });

  test("an open drawer joins the tab cycle", async () => {
    const { h }: OpenedReader = await openReader();

    h.$('[data-reader-action="contents"]').click();

    const links: Array<HTMLElement> = h.$$(".bk-drawer a[href]");
    const last: HTMLElement = links[links.length - 1]!;

    last.focus();
    expect(keyDown(last, "Tab")).toBe(false);
    expect(h.document.activeElement).toBe(h.$('[data-reader-action="close"]'));
  });
});

describe("when the book cannot be loaded", () => {
  test("a network failure offers a retry and the book's own website", async () => {
    const { h, reader }: OpenedReader = await openReader(
      {},
      {
        respond: (): Promise<FakeResponse> => {
          return Promise.reject(new Error("network down"));
        },
      },
    );
    const status: HTMLElement = h.$(".bk-reader-status");
    const website: HTMLElement = h.$(".bk-reader-message-link");

    expect(status.hidden).toBe(false);
    expect(status.getAttribute("data-kind")).toBe("error");
    expect(text(h.$(".bk-reader-message-text"))).toBe(
      "The book could not be opened here right now. network down",
    );
    expect(text(h.$(".bk-reader-message-button"))).toBe("Try again");
    expect(website.getAttribute("href")).toBe(BackToMetal.siteUrl);
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.getAttribute("rel")).toBe("noopener noreferrer");
    expect(h.root.hasAttribute("aria-busy")).toBe(false);
    expect(reader.getState()).toMatchObject({
      open: true,
      loaded: false,
      view: -1,
    });
  });

  test("an HTTP error says so", async () => {
    const { h }: OpenedReader = await openReader(
      {},
      {
        respond: (): Promise<FakeResponse> => {
          return Promise.resolve(errorResponse(503));
        },
      },
    );

    expect(text(h.$(".bk-reader-message-text"))).toContain(
      "The book could not be loaded (503).",
    );
  });

  test.each([
    ["an empty book", { sections: [] }],
    ["no book at all", null],
    ["a book without sections", { title: "Back to Metal" }],
  ])("%s is an error", async (_name: string, payload: unknown) => {
    const { h, reader }: OpenedReader = await openReader({}, { payload });

    expect(h.$(".bk-reader-status").getAttribute("data-kind")).toBe("error");
    expect(text(h.$(".bk-reader-message-text"))).toContain(
      "The book arrived empty.",
    );
    expect(reader.getState().loaded).toBe(false);
  });

  test("Try again loads the book when the server recovers", async () => {
    const payload: BookPayload = buildPayload();
    const { h, reader }: OpenedReader = await openReader(
      {},
      {
        respond: (call: number): Promise<FakeResponse> => {
          return call === 1
            ? Promise.reject(new Error("network down"))
            : Promise.resolve(okResponse(payload));
        },
      },
    );

    h.$(".bk-reader-message-button").click();
    await waitFor((): boolean => {
      return reader.getState().view === 0;
    }, "the retry to open the book");

    expect(h.fetchCalls).toHaveLength(2);
    expect(h.$(".bk-reader-status").hidden).toBe(true);
    expect(reader.getState().loaded).toBe(true);
  });

  test("a load that finishes after the reader was closed does not reopen it", async () => {
    const pending: {
      promise: Promise<FakeResponse>;
      resolve: (response: FakeResponse) => void;
    } = deferred();
    const h: Harness = await setup({
      respond: (): Promise<FakeResponse> => {
        return pending.promise;
      },
    });
    const reader: ReaderApi = h.createReader({
      reducedMotion: true,
      measureSection: measureFixture(),
    });

    const opening: Promise<void> = reader.open();

    reader.close();
    pending.resolve(okResponse(buildPayload()));
    await opening;

    expect(reader.isOpen()).toBe(false);
    expect(h.root.hidden).toBe(true);
    expect(reader.getState().view).toBe(-1);

    await waitFor((): boolean => {
      return !hasReadHash(h);
    }, "the reader's history entry to be popped");
    await sleep(10);

    // The book arrived all the same, so reopening needs no second download.
    await reader.open();
    expect(h.fetchCalls).toHaveLength(1);
    expect(reader.getState().view).toBe(0);
  });
});

describe("untrusted book content", () => {
  const MALICIOUS: string = [
    "<script>window.__pwned = 1;</script>",
    '<img src="x" onerror="window.__pwned = 2">',
    '<a href="javascript:window.__pwned = 3" class="evil">run</a>',
    '<a href=" JaVaScRiPt:window.__pwned = 4">run</a>',
    '<a href="data:text/html,<script>alert(1)</script>">data</a>',
    '<a href="vbscript:msgbox(1)">vb</a>',
    '<p style="position:fixed;inset:0" onclick="window.__pwned = 5" onmouseover="window.__pwned = 6">styled</p>',
    '<iframe src="https://evil.example/"></iframe>',
    '<svg onload="window.__pwned = 7"><script>window.__pwned = 8</script></svg>',
    '<object data="https://evil.example/x.swf"></object>',
    '<form action="https://evil.example/"><input name="password"></form>',
    '<a href="https://example.com/" target="_blank">external</a>',
  ].join("");

  test("sanitizeFragment keeps book markup and removes everything else", async () => {
    const h: Harness = await setup();
    const fragment: DocumentFragment = h.module.sanitizeFragment(
      '<h2 class="bk-sect">Why</h2><p class="bk-hook">A <strong>bold</strong> <a href="#read/m01" data-book-section="m01" data-book-anchor="bk-m01--x">link</a> and <a href="mailto:hello@example.com">mail</a>.</p><table><tbody><tr><th scope="row" colspan="2">Cloud</th></tr></tbody></table>' +
        MALICIOUS,
    );
    const container: HTMLElement = h.document.createElement("div");

    container.appendChild(fragment);

    expect(container.querySelector("h2.bk-sect")).not.toBeNull();
    expect(
      container
        .querySelector('a[data-book-section="m01"]')!
        .getAttribute("data-book-anchor"),
    ).toBe("bk-m01--x");
    expect(
      container.querySelector('a[href="mailto:hello@example.com"]'),
    ).not.toBeNull();
    expect(container.querySelector("th")!.getAttribute("scope")).toBe("row");
    expect(container.querySelector("th")!.getAttribute("colspan")).toBe("2");
    expect(
      container.querySelectorAll(
        "script, img, iframe, svg, object, form, input, style",
      ),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll(
        "[style], [onclick], [onmouseover], [onerror], [onload]",
      ),
    ).toHaveLength(0);
    for (const link of Array.from(container.querySelectorAll("a[href]"))) {
      expect(link.getAttribute("href")).toMatch(
        /^(#read\/m01|mailto:hello@example\.com|https:\/\/example\.com\/)$/,
      );
    }
    expect(
      container
        .querySelector('a[href="https://example.com/"]')!
        .getAttribute("rel"),
    ).toBe("noopener noreferrer");
    // Links that lost their href keep their text.
    expect(text(container)).toContain("run");
  });

  test("hostile markup in the book never reaches the page", async () => {
    const payload: BookPayload = buildPayload();

    payload.sections = payload.sections.map(
      (section: BookPayload["sections"][number]) => {
        return {
          ...section,
          title: `${section.title}<img src=x onerror="window.__pwned = 9">`,
          html: section.html + MALICIOUS,
        };
      },
    );
    payload.toc = payload.toc.map((entry: BookPayload["toc"][number]) => {
      return {
        ...entry,
        label: `${entry.label}<script>window.__pwned = 10</script>`,
      };
    });

    const { h, reader }: OpenedReader = await openReader({}, { payload });
    // The reader's own chrome (icons, the scrubber) is not book content.
    const bookContent: () => Array<HTMLElement> = (): Array<HTMLElement> => {
      return h.$$(".bk-book, .bk-reader-text, .bk-drawer-list");
    };

    for (let view: number = 0; view < reader.getState().views; view++) {
      reader.goToView(view);

      for (const scope of bookContent()) {
        expect(
          scope.querySelectorAll(
            "script, img:not(.bk-cover-image), iframe, svg, object, form, input, style",
          ),
        ).toHaveLength(0);
        expect(scope.querySelectorAll(".bk-section [style]")).toHaveLength(0);
      }

      expect(
        h.root.querySelectorAll(
          "[onclick], [onmouseover], [onerror], [onload]",
        ),
      ).toHaveLength(0);

      for (const link of Array.from(h.root.querySelectorAll("a[href]"))) {
        expect(link.getAttribute("href")!.trim().toLowerCase()).not.toMatch(
          /^(javascript|data|vbscript):/,
        );
      }
    }

    h.$('[data-reader-action="contents"]').click();
    for (const evil of h.$$(".bk-section a.bk-evil, .bk-section a.evil")) {
      click(evil);
    }

    expect(h.root.querySelectorAll("a.evil")).not.toHaveLength(0);
    expect(
      (h.window as unknown as { __pwned?: number }).__pwned,
    ).toBeUndefined();
    // Labels and titles are text, never markup.
    expect(text(h.$(".bk-drawer"))).toContain(
      "<script>window.__pwned = 10</script>",
    );
  });
});

describe("animated page turns", () => {
  const DEGENERATE: string = "polygon(0 0, 0 0, 0 0)";

  test("a page turn draws a fold that moves across the book, then settles", async () => {
    const { h, reader, options }: OpenedReader = await openReader();

    options.reducedMotion = false;
    reader.next();

    const turn: HTMLElement = h.$(".bk-book > .bk-turn");
    const front: HTMLElement = h.$(".bk-turn-front");
    const flap: HTMLElement = h.$(".bk-turn-flap");
    const flapInner: HTMLElement = h.$(".bk-turn-flap-inner");

    expect(reader.getState().turning).toBe(true);
    expect(h.$(".bk-book").classList.contains("is-turning")).toBe(true);
    expect(turn.querySelectorAll(".bk-page--turning")).toHaveLength(2);
    expect(front.style.clipPath).toMatch(/^polygon\(/);
    expect(front.style.clipPath).not.toBe(DEGENERATE);
    expect(flap.style.clipPath).toBe(DEGENERATE);
    expect(flapInner.style.transform).toMatch(/^matrix\(/);
    // The page being turned is the right page of the current spread.
    expect(
      front.querySelector(".bk-page--turning")!.getAttribute("data-page"),
    ).toBe("1");

    await waitFor((): boolean => {
      return flap.style.clipPath !== DEGENERATE;
    }, "the flap to fold over");

    expect(flapInner.style.transform).not.toBe("matrix(1,0,0,1,0,0)");
    expect(turn.style.getPropertyValue("--bk-lift")).not.toBe("");

    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the turn to finish",
      3000,
    );

    expect(h.root.querySelector(".bk-turn")).toBeNull();
    expect(h.$(".bk-book").classList.contains("is-turning")).toBe(false);
    expect(reader.getState().view).toBe(1);
  });

  test("turning back runs the same fold in reverse", async () => {
    const { h, reader, options }: OpenedReader = await openReader();

    reader.goToView(3);
    options.reducedMotion = false;
    reader.prev();

    expect(h.$(".bk-turn-flap").style.clipPath).not.toBe(DEGENERATE);
    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the turn to finish",
      3000,
    );

    expect(reader.getState().view).toBe(2);
  });

  test("pressing next twice quickly turns two pages", async () => {
    const { reader, options }: OpenedReader = await openReader();

    reader.goToView(2);
    options.reducedMotion = false;
    reader.next();
    reader.next();

    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the turns to finish",
      4000,
    );

    expect(reader.getState().view).toBe(4);
  });

  test("pressing prev twice quickly turns back two pages", async () => {
    const { reader, options }: OpenedReader = await openReader();

    reader.goToView(5);
    options.reducedMotion = false;
    reader.prev();
    reader.prev();

    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the turns to finish",
      4000,
    );

    expect(reader.getState().view).toBe(3);
  });

  test("with reduced motion the page simply changes", async () => {
    const { h, reader }: OpenedReader = await openReader();
    const added: Array<string> = [];
    const observer: MutationObserver = new h.window.MutationObserver(
      (records: Array<MutationRecord>) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            added.push((node as Element).className || "");
          }
        }
      },
    );

    observer.observe(h.$(".bk-book"), { childList: true, subtree: true });

    reader.next();
    reader.next();
    reader.prev();
    reader.goToSection("m03");
    reader.goToView(0);
    keyDown(h.root, "End");
    await sleep(10);
    observer.disconnect();

    expect(added.length).toBeGreaterThan(0);
    expect(
      added.filter((className: string): boolean => {
        return className.includes("bk-turn");
      }),
    ).toEqual([]);
    expect(reader.getState().turning).toBe(false);
  });
});

describe("turning with a pointer", () => {
  interface Geometry {
    w: number;
    h: number;
  }

  const geometryOf: (layouts: Array<MeasuredLayout>) => Geometry = (
    layouts: Array<MeasuredLayout>,
  ): Geometry => {
    const layout: MeasuredLayout = currentLayout(layouts);
    return { w: layout.pageWidth, h: layout.pageHeight };
  };

  /*
   * jsdom reports every element at (0, 0), so on a spread the spine is at
   * clientX = page width: the left page spans [0, w] and the right [w, 2w].
   */
  test("dragging the right page's corner past the spine turns the page", async () => {
    const {
      h: dom,
      reader,
      options,
      layouts,
    }: OpenedReader = await openReader();
    const { w, h }: Geometry = geometryOf(layouts);
    const book: HTMLElement = dom.$(".bk-book");

    reader.goToView(2);
    options.reducedMotion = false;

    pointer(book, "pointerdown", { clientX: 2 * w - 6, clientY: h - 6 });
    pointer(book, "pointermove", { clientX: 2 * w - 40, clientY: h - 10 });

    expect(reader.getState().turning).toBe(true);
    expect(dom.$(".bk-turn-flap").style.clipPath).not.toBe(
      "polygon(0 0, 0 0, 0 0)",
    );

    pointer(book, "pointermove", { clientX: w - 120, clientY: h - 40 });
    pointer(book, "pointerup", { clientX: w - 120, clientY: h - 40 });

    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the turn to finish",
      3000,
    );

    expect(reader.getState().view).toBe(3);
  });

  test("a short, slow drag lets the page fall back", async () => {
    const {
      h: dom,
      reader,
      options,
      layouts,
    }: OpenedReader = await openReader();
    const { w, h }: Geometry = geometryOf(layouts);
    const book: HTMLElement = dom.$(".bk-book");

    reader.goToView(2);
    options.reducedMotion = false;

    pointer(book, "pointerdown", { clientX: 2 * w - 6, clientY: h - 6 });
    pointer(book, "pointermove", { clientX: 2 * w - 40, clientY: h - 8 });

    // Hold still until the flick velocity has decayed.
    for (let hold: number = 0; hold < 8; hold++) {
      await sleep(20);
      pointer(book, "pointermove", { clientX: 2 * w - 40, clientY: h - 8 });
    }

    pointer(book, "pointerup", { clientX: 2 * w - 40, clientY: h - 8 });

    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the page to fall back",
      3000,
    );

    expect(reader.getState().view).toBe(2);
  });

  test("dragging the left page's corner past the spine turns back", async () => {
    const {
      h: dom,
      reader,
      options,
      layouts,
    }: OpenedReader = await openReader();
    const { w, h }: Geometry = geometryOf(layouts);
    const book: HTMLElement = dom.$(".bk-book");

    reader.goToView(4);
    options.reducedMotion = false;

    pointer(book, "pointerdown", { clientX: 6, clientY: h - 6 });
    pointer(book, "pointermove", { clientX: 40, clientY: h - 10 });
    expect(reader.getState().turning).toBe(true);
    pointer(book, "pointermove", { clientX: w + 120, clientY: h - 40 });
    pointer(book, "pointerup", { clientX: w + 120, clientY: h - 40 });

    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the turn to finish",
      3000,
    );

    expect(reader.getState().view).toBe(3);
  });

  test("a mouse drag from the middle of a page selects text instead of turning", async () => {
    const {
      h: dom,
      reader,
      options,
      layouts,
    }: OpenedReader = await openReader();
    const { w, h }: Geometry = geometryOf(layouts);
    const book: HTMLElement = dom.$(".bk-book");

    reader.goToView(2);
    options.reducedMotion = false;

    pointer(book, "pointerdown", { clientX: w + w / 2, clientY: h / 2 });
    pointer(book, "pointermove", { clientX: w + w / 2 - 120, clientY: h / 2 });
    pointer(book, "pointerup", { clientX: w + w / 2 - 120, clientY: h / 2 });
    await sleep(20);

    expect(reader.getState()).toMatchObject({ view: 2, turning: false });
  });

  test("a touch anywhere on the page can drag it", async () => {
    const {
      h: dom,
      reader,
      options,
      layouts,
    }: OpenedReader = await openReader();
    const { w, h }: Geometry = geometryOf(layouts);
    const book: HTMLElement = dom.$(".bk-book");
    const touch: { pointerType: string; pointerId: number } = {
      pointerType: "touch",
      pointerId: 7,
    };

    reader.goToView(2);
    options.reducedMotion = false;

    pointer(book, "pointerdown", {
      clientX: w + w / 2,
      clientY: h / 2,
      ...touch,
    });
    pointer(book, "pointermove", {
      clientX: w + w / 2 - 40,
      clientY: h / 2,
      ...touch,
    });
    expect(reader.getState().turning).toBe(true);
    pointer(book, "pointermove", { clientX: w / 2, clientY: h / 2, ...touch });
    pointer(book, "pointerup", { clientX: w / 2, clientY: h / 2, ...touch });

    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the turn to finish",
      3000,
    );

    expect(reader.getState().view).toBe(3);
  });

  test("tapping the outer edge of a page turns it", async () => {
    const { h: dom, reader, layouts }: OpenedReader = await openReader();
    const { w, h }: Geometry = geometryOf(layouts);
    const book: HTMLElement = dom.$(".bk-book");
    const tap: (clientX: number) => void = (clientX: number): void => {
      pointer(book, "pointerdown", {
        clientX,
        clientY: h / 2,
        pointerType: "touch",
      });
      pointer(book, "pointerup", {
        clientX,
        clientY: h / 2,
        pointerType: "touch",
      });
    };

    reader.goToView(2);
    tap(2 * w - 10);
    expect(reader.getState().view).toBe(3);
    tap(10);
    expect(reader.getState().view).toBe(2);
    // The middle of a page is for reading, not turning.
    tap(w + w / 2);
    expect(reader.getState().view).toBe(2);
  });

  test("a press on the closed book opens it", async () => {
    const { h: dom, reader }: OpenedReader = await openReader();

    reader.prev();
    await waitFor((): boolean => {
      return reader.getState().view === -1;
    }, "the book to close");

    pointer(dom.$(".bk-book"), "pointerdown", { clientX: 10, clientY: 10 });
    await waitFor((): boolean => {
      return reader.getState().view === 0;
    }, "the book to open");
  });

  test("resting the mouse on a corner lifts it, and moving away lets it fall", async () => {
    const {
      h: dom,
      reader,
      options,
      layouts,
    }: OpenedReader = await openReader();
    const { w, h }: Geometry = geometryOf(layouts);
    const book: HTMLElement = dom.$(".bk-book");

    reader.goToView(2);
    options.reducedMotion = false;

    pointer(book, "pointermove", { clientX: 2 * w - 20, clientY: h - 20 });

    expect(reader.getState().turning).toBe(true);
    await waitFor((): boolean => {
      return dom.$(".bk-turn-flap").style.clipPath !== "polygon(0 0, 0 0, 0 0)";
    }, "the corner to lift");

    pointer(book, "pointermove", { clientX: w + w / 2, clientY: h / 2 });
    await waitFor((): boolean => {
      return !reader.getState().turning;
    }, "the corner to fall back");

    expect(reader.getState().view).toBe(2);

    // A peeking corner completes when the reader asks for the next page.
    pointer(book, "pointermove", { clientX: 2 * w - 20, clientY: h - 20 });
    expect(reader.getState().turning).toBe(true);
    reader.next();
    await waitFor(
      (): boolean => {
        return !reader.getState().turning;
      },
      "the peeked page to turn",
      3000,
    );
    expect(reader.getState().view).toBe(3);
  });
});

describe("books.js on the page", () => {
  const openPage: (options?: HarnessOptions) => Promise<Harness> = (
    options: HarnessOptions = {},
  ): Promise<Harness> => {
    return setup({ loadPage: true, reducedMotionMedia: true, ...options });
  };

  test("a plain click on a chapter opens the reader there instead of leaving the page", async () => {
    const h: Harness = await openPage();
    const link: HTMLElement = h.$(
      '.books-contents a[data-book-open][data-book-section="m03"]',
    );

    expect(link.getAttribute("href")).toMatch(
      /^https:\/\/backtometal\.oneuptime\.com\/m\/03-/,
    );
    expect(click(link)).toBe(false);

    const reader: ReaderApi = h.pageReader();

    await waitFor((): boolean => {
      return reader.getState().sectionId === "m03";
    }, "the reader to open at Move 03");

    expect(h.root.hidden).toBe(false);
    expect(h.window.location.hash).toBe("#read/m03");

    reader.close();
    expect(h.document.activeElement).toBe(link);
  });

  test.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle-button", { button: 1 }],
  ])(
    "a %s click follows the link as the visitor asked",
    async (
      _name: string,
      init: {
        ctrlKey?: boolean;
        metaKey?: boolean;
        shiftKey?: boolean;
        altKey?: boolean;
        button?: number;
      },
    ) => {
      const h: Harness = await openPage();

      expect(click(h.$(".books-actions a[data-book-open]"), init)).toBe(true);
      await sleep(10);
      expect(h.pageReader().isOpen()).toBe(false);
      expect(h.fetchCalls).toHaveLength(0);
    },
  );

  test("a deep link opens the reader on arrival without adding history", async () => {
    let pushes: () => number = (): number => {
      return -1;
    };
    const h: Harness = await openPage({
      url: "https://oneuptime.com/books#read/m02",
      beforePage: (window: Harness["window"]): void => {
        pushes = countCalls(window.history, "pushState");
      },
    });
    const reader: ReaderApi = h.pageReader();

    await waitFor((): boolean => {
      return reader.getState().view >= 0;
    }, "the reader to open");

    expect(pushes()).toBe(0);
    expect(h.root.hidden).toBe(false);
    // Without layout every chapter is one page: Move 02 is page 7 of 9.
    expect(
      h.root
        .querySelector('.bk-slot [data-section="m02"]')!
        .getAttribute("data-page"),
    ).toBe("7");
  });

  test("the continue-reading prompt stays hidden for new readers", async () => {
    const h: Harness = await openPage();

    expect(h.$("[data-book-resume]").hidden).toBe(true);
  });

  test("the continue-reading prompt stays hidden until there is real progress", async () => {
    const h: Harness = await openPage({
      storage: {
        [POSITION_KEY]: JSON.stringify({
          sectionId: "titlepage",
          fraction: 0,
          label: "Title page",
          progress: 0.001,
        }),
      },
    });

    expect(h.$("[data-book-resume]").hidden).toBe(true);
  });

  test("a returning reader is offered their place, and can start over", async () => {
    const h: Harness = await openPage({
      storage: {
        [POSITION_KEY]: JSON.stringify({
          sectionId: "m03",
          fraction: 0,
          label: "Move 03 · From rented vCPUs to cores you own",
          progress: 0.4,
        }),
      },
    });
    const resume: HTMLElement = h.$("[data-book-resume]");
    const bar: HTMLElement = h.$("[data-book-resume-progress]");

    expect(resume.hidden).toBe(false);
    expect(text(h.$("[data-book-resume-label]"))).toBe(
      "Move 03 · From rented vCPUs to cores you own",
    );
    expect(bar.style.transform).toBe("scaleX(0.4)");
    expect(bar.parentElement!.getAttribute("title")).toBe("40% read");

    const reader: ReaderApi = h.pageReader();

    expect(click(h.$(".books-resume-link"))).toBe(false);
    await waitFor((): boolean => {
      return reader.getState().sectionId === "m03";
    }, "the reader to open at Move 03");
    await closeAndSettle(h, reader);

    expect(click(h.$(".books-resume-restart"))).toBe(false);
    await waitFor((): boolean => {
      return reader.isOpen() && reader.getState().view === 0;
    }, "the reader to reopen at the start");
  });

  test("the book starts downloading as soon as a reader points at a way in", async () => {
    const h: Harness = await openPage();
    const triggers: Array<HTMLElement> = h.$$("[data-book-open]");

    expect(triggers.length).toBeGreaterThan(20);
    triggers[0]!.dispatchEvent(new h.window.Event("pointerenter"));
    await sleep(10);
    expect(h.fetchCalls).toHaveLength(1);

    triggers[1]!.dispatchEvent(new h.window.Event("pointerenter"));
    triggers[2]!.dispatchEvent(new h.window.Event("focus"));
    click(triggers[0]!);

    await waitFor((): boolean => {
      return h.pageReader().getState().view >= 0;
    }, "the reader to open");
    expect(h.fetchCalls).toHaveLength(1);
  });

  test("every way into the book is a real link to the book's website", async () => {
    const h: Harness = await openPage();

    for (const trigger of h.$$("[data-book-open]")) {
      expect(trigger.tagName).toBe("A");
      expect(trigger.getAttribute("href")).toMatch(
        /^https:\/\/backtometal\.oneuptime\.com\//,
      );
    }
  });

  test("without the reader on the page the links are left alone", async () => {
    const h: Harness = await openPage({ withoutReaderRoot: true });

    expect(
      (h.window as unknown as { OneUptimeBooks?: unknown }).OneUptimeBooks,
    ).toBeUndefined();
    expect(click(h.$(".books-actions a[data-book-open]"))).toBe(true);
  });
});
