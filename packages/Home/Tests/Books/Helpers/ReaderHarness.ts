import ejs from "ejs";
import fs from "fs";
import path from "path";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import { getPageSEO, PageSEOData } from "../../../Utils/PageSEO";
import { BackToMetal } from "../../../Utils/Books/BookCatalog";
import {
  BookSection,
  BookTocEntry,
  parseEpub,
  ParsedEpub,
} from "../../../Utils/Books/Epub";
import { buildEpub, EpubFixtureOptions } from "./EpubFixture";

/*
 * Runs the real /books page and its reader scripts in jsdom.
 *
 * The page is rendered from the real views, the book is a realistic payload
 * parsed from an EPUB fixture, and the scripts are the files the site serves.
 * jsdom has no layout engine, so pagination is supplied through the reader's
 * measureSection option wherever page counts matter.
 */

const HOME_ROOT: string = path.join(__dirname, "..", "..", "..");
const VIEWS_ROOT: string = path.join(HOME_ROOT, "Views");
const HOME_URL: string = "https://oneuptime.com";

const readScript: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(HOME_ROOT, "Static", "js", name), "utf-8");
};

const SCRIPTS: { core: string; reader: string; page: string } = {
  core: readScript("book-reader-core.js"),
  reader: readScript("book-reader.js"),
  page: readScript("books.js"),
};

export const POSITION_KEY: string = "oneuptime:books:back-to-metal:position";
export const SETTINGS_KEY: string = "oneuptime:books:reader-settings";
export const CONTENT_URL: string = BackToMetal.contentPath;

export interface BookPayload {
  version: number;
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  language: string;
  modified: string;
  coverUrl: string;
  siteUrl: string;
  epubUrl: string;
  pdfUrl: string;
  license: { name: string; url: string };
  sections: Array<BookSection>;
  toc: Array<BookTocEntry>;
}

/*
 * The payload the content endpoint serves, built the way buildBookPayload in
 * Utils/Books/BookStore.ts builds it. BookStore itself is not imported: its
 * logger pulls in the whole Common telemetry stack for no benefit here.
 */
export const buildPayload: (options?: EpubFixtureOptions) => BookPayload = (
  options: EpubFixtureOptions = {},
): BookPayload => {
  const parsed: ParsedEpub = parseEpub(buildEpub(options));

  return {
    version: 1,
    slug: BackToMetal.slug,
    title: parsed.metadata.title || BackToMetal.title,
    subtitle: parsed.metadata.description || BackToMetal.subtitle,
    author: parsed.metadata.creator || BackToMetal.author,
    publisher: parsed.metadata.publisher || BackToMetal.publisher,
    language: parsed.metadata.language || BackToMetal.language,
    modified: parsed.metadata.modified,
    coverUrl: BackToMetal.coverPath,
    siteUrl: BackToMetal.siteUrl,
    epubUrl: BackToMetal.epubUrl,
    pdfUrl: BackToMetal.pdfUrl,
    license: BackToMetal.license,
    sections: parsed.sections,
    toc: parsed.toc,
  };
};

let renderedPage: Promise<string> | null = null;

export const renderBooksPage: () => Promise<string> = (): Promise<string> => {
  if (!renderedPage) {
    const seo: PageSEOData = getPageSEO("/books");

    renderedPage = ejs.renderFile(
      path.join(VIEWS_ROOT, "books.ejs"),
      {
        enableGoogleTagManager: false,
        support: false,
        footerCards: false,
        cta: false,
        blackLogo: false,
        requestDemoCta: false,
        homeUrl: HOME_URL,
        book: BackToMetal,
        seo: { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` },
      },
      { views: [VIEWS_ROOT] },
    ) as Promise<string>;
  }

  return renderedPage;
};

let renderedReader: Promise<string> | null = null;

/*
 * Just the reader, as the page renders it, with one way in. Parsing the whole
 * marketing page costs jsdom most of a second, so the reader's own tests use
 * this and only the books.js tests pay for the full page.
 */
export const renderReaderOnly: () => Promise<string> = (): Promise<string> => {
  if (!renderedReader) {
    renderedReader = (
      ejs.renderFile(path.join(VIEWS_ROOT, "Partials", "books", "reader.ejs"), {
        book: BackToMetal,
      }) as Promise<string>
    ).then((reader: string): string => {
      return [
        "<!DOCTYPE html>",
        '<html lang="en"><head><title>Books</title></head><body>',
        '<main id="main-content"><div class="books-actions">',
        `<a href="${BackToMetal.siteUrl}" data-book-open>Read the book</a>`,
        "</div></main>",
        reader,
        "</body></html>",
      ].join("\n");
    });
  }

  return renderedReader;
};

// ------------------------------------------------------------------ types

export interface MeasuredSection {
  id: string;
  kind: string;
  title: string;
  label: string;
  number: string;
  part: string;
  template: HTMLElement;
  anchors: Record<string, number>;
}

export interface MeasuredLayout {
  mode: "spread" | "single";
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  contentHeight: number;
  columnGap: number;
  fontStep: number;
  fontSize: number;
  lineHeight: number;
}

export type Measurement =
  | number
  | { pages: number; anchors?: Record<string, number> };

export type MeasureSection = (
  section: MeasuredSection,
  layout: MeasuredLayout,
  index: number,
) => Measurement;

export interface ReaderOptions {
  reducedMotion?: boolean;
  viewport?: () => { width: number; height: number };
  measureSection?: MeasureSection;
  chromeTop?: number;
  chromeBottom?: number;
}

export interface ReaderOpenOptions {
  sectionId?: string | null;
  fromStart?: boolean;
  pushHistory?: boolean;
  returnFocus?: Element;
  source?: Element | null;
}

export interface ReaderState {
  open: boolean;
  loaded: boolean;
  view: number;
  views: number;
  pages: number;
  mode: "spread" | "single" | null;
  sectionId: string | null;
  turning: boolean;
  settings: { fontStep: number; theme: string };
}

export interface StoredPosition {
  sectionId: string;
  fraction: number;
  label: string;
  progress: number;
  updatedAt: number;
}

export interface ReaderApi {
  open: (options?: ReaderOpenOptions) => Promise<void>;
  close: (options?: { fromHistory?: boolean }) => void;
  next: () => void;
  prev: () => void;
  goToSection: (sectionId: string, anchorId?: string) => boolean;
  goToView: (view: number) => void;
  preload: () => void;
  isOpen: () => boolean;
  relayout: () => void;
  handleHistory: () => void;
  getState: () => ReaderState;
  savedPosition: () => StoredPosition | null;
}

export interface ReaderModule {
  create: (root: Element, options?: ReaderOptions) => ReaderApi;
  sanitizeFragment: (html: string) => DocumentFragment;
}

interface ReaderGlobals {
  OneUptimeBookReader?: ReaderModule;
  OneUptimeBooks?: { reader: ReaderApi };
  fetch?: unknown;
  matchMedia?: unknown;
}

export interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export interface FetchCall {
  url: string;
  init: { credentials?: string; headers?: Record<string, string> } | undefined;
}

export interface HarnessOptions {
  url?: string;
  payload?: unknown;
  // Replaces the default "200 with the payload" response; call counts from 1.
  respond?: (call: number) => Promise<FakeResponse>;
  storage?: Record<string, string>;
  // Answers prefers-reduced-motion media queries (jsdom has no matchMedia).
  reducedMotionMedia?: boolean;
  // Evaluates books.js as well, as the page does.
  loadPage?: boolean;
  // Runs after the reader scripts and before books.js.
  beforePage?: (window: DOMWindow) => void;
  // Removes the reader's root before any script runs.
  withoutReaderRoot?: boolean;
  // The whole /books page instead of the reader alone (loadPage implies it).
  fullPage?: boolean;
}

export interface Harness {
  dom: JSDOM;
  window: DOMWindow;
  document: Document;
  root: HTMLElement;
  fetchCalls: Array<FetchCall>;
  errors: Array<string>;
  module: ReaderModule;
  // Errors other than jsdom's "navigation is not implemented".
  unexpectedErrors: () => Array<string>;
  pageReader: () => ReaderApi;
  createReader: (options?: ReaderOptions) => ReaderApi;
  $: (selector: string) => HTMLElement;
  $$: (selector: string) => Array<HTMLElement>;
  close: () => void;
}

// ---------------------------------------------------------------- helpers

export const sleep: (ms: number) => Promise<void> = (
  ms: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
};

export const waitFor: (
  predicate: () => boolean,
  message: string,
  timeoutMs?: number,
) => Promise<void> = async (
  predicate: () => boolean,
  message: string,
  timeoutMs: number = 3000,
): Promise<void> => {
  const started: number = Date.now();

  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${message}`);
    }

    await sleep(5);
  }
};

export const okResponse: (payload: unknown) => FakeResponse = (
  payload: unknown,
): FakeResponse => {
  return {
    ok: true,
    status: 200,
    json: (): Promise<unknown> => {
      return Promise.resolve(JSON.parse(JSON.stringify(payload)));
    },
  };
};

export const errorResponse: (status: number) => FakeResponse = (
  status: number,
): FakeResponse => {
  return {
    ok: false,
    status,
    json: (): Promise<unknown> => {
      return Promise.resolve({ error: "unavailable" });
    },
  };
};

/*
 * Pages per section for the default fixture (see EpubFixture.ts). Page
 * starts: titlepage 0, copyright 1, contents 3, why 4, rollback 6, m01 7,
 * m02 10, m03 13, worksheets 15; 18 pages in all. On a spread, view v shows
 * pages 2v-1 and 2v, so Move 01 opens view 4, Move 02 starts on the right of
 * view 5, Move 03 opens view 7 and the worksheets view 8.
 */
export const FIXTURE_PAGES: Record<string, number> = {
  titlepage: 1,
  copyright: 2,
  contents: 1,
  why: 2,
  rollback: 1,
  m01: 3,
  m02: 3,
  m03: 2,
  worksheets: 3,
};

export const FIXTURE_ANCHORS: Record<string, Record<string, number>> = {
  m02: { "bk-m02--local-note": 2 },
  rollback: { "bk-rollback--first-rule": 0 },
  worksheets: {
    "bk-worksheets--rehearsal-record": 0,
    "bk-worksheets--restore-proof": 2,
  },
};

export const measureFixture: (
  record?: Array<MeasuredLayout>,
  pages?: Record<string, number>,
) => MeasureSection = (
  record?: Array<MeasuredLayout>,
  pages: Record<string, number> = FIXTURE_PAGES,
): MeasureSection => {
  return (
    section: MeasuredSection,
    layout: MeasuredLayout,
    index: number,
  ): Measurement => {
    if (record && index === 0) {
      record.push(layout);
    }

    return {
      pages: pages[section.id] ?? 1,
      anchors: FIXTURE_ANCHORS[section.id] ?? {},
    };
  };
};

export const keyDown: (
  target: Element,
  key: string,
  modifiers?: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  },
) => boolean = (
  target: Element,
  key: string,
  modifiers: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  } = {},
): boolean => {
  const view: DOMWindow = target.ownerDocument
    .defaultView as unknown as DOMWindow;

  // dispatchEvent returns false when a handler called preventDefault().
  return target.dispatchEvent(
    new view.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    }),
  );
};

export const click: (
  target: Element,
  init?: {
    button?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
) => boolean = (
  target: Element,
  init: {
    button?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  } = {},
): boolean => {
  const view: DOMWindow = target.ownerDocument
    .defaultView as unknown as DOMWindow;

  return target.dispatchEvent(
    new view.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    }),
  );
};

export const pointer: (
  target: Element,
  type: string,
  init: {
    clientX: number;
    clientY: number;
    pointerType?: string;
    pointerId?: number;
    button?: number;
  },
) => boolean = (
  target: Element,
  type: string,
  init: {
    clientX: number;
    clientY: number;
    pointerType?: string;
    pointerId?: number;
    button?: number;
  },
): boolean => {
  const view: DOMWindow = target.ownerDocument
    .defaultView as unknown as DOMWindow;
  // Installed by installPointerEvent() below; @types/jsdom does not list it.
  const PointerEventConstructor: typeof PointerEvent = view[
    "PointerEvent"
  ] as typeof PointerEvent;

  return target.dispatchEvent(
    new PointerEventConstructor(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: init.pointerId ?? 1,
      pointerType: init.pointerType ?? "mouse",
      button: init.button ?? 0,
      clientX: init.clientX,
      clientY: init.clientY,
    }),
  );
};

/*
 * jsdom 26 (the last release Jest 28 can load, see package.json) has no
 * PointerEvent. This is the part of it the reader reads: a MouseEvent that
 * also carries pointerId, pointerType and isPrimary.
 */
const POINTER_EVENT_POLYFILL: string = `
  if (typeof window.PointerEvent === "undefined") {
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type, init) {
        super(type, init);
        var options = init || {};
        Object.defineProperties(this, {
          pointerId: { value: options.pointerId === undefined ? 1 : options.pointerId },
          pointerType: { value: options.pointerType || "mouse" },
          isPrimary: { value: options.isPrimary === undefined ? true : options.isPrimary },
        });
      }
    };
  }
`;

// ---------------------------------------------------------------- harness

export const createHarness: (
  options?: HarnessOptions,
) => Promise<Harness> = async (
  options: HarnessOptions = {},
): Promise<Harness> => {
  const html: string =
    options.fullPage || options.loadPage
      ? await renderBooksPage()
      : await renderReaderOnly();
  const errors: Array<string> = [];
  const virtualConsole: VirtualConsole = new VirtualConsole();

  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(error.message);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: options.url || `${HOME_URL}/books`,
    pretendToBeVisual: true,
    runScripts: "outside-only",
    virtualConsole,
  });
  const window: DOMWindow = dom.window;
  const globals: ReaderGlobals = window as unknown as ReaderGlobals;

  window.eval(POINTER_EVENT_POLYFILL);
  const payload: unknown =
    options.payload === undefined ? buildPayload() : options.payload;
  const fetchCalls: Array<FetchCall> = [];

  for (const [key, value] of Object.entries(options.storage || {})) {
    window.localStorage.setItem(key, value);
  }

  if (options.reducedMotionMedia !== undefined) {
    const reduced: boolean = options.reducedMotionMedia;

    globals.matchMedia = (query: string): Record<string, unknown> => {
      return {
        matches: query.includes("prefers-reduced-motion") ? reduced : false,
        media: query,
        onchange: null,
        addListener: (): void => {},
        removeListener: (): void => {},
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
      };
    };
  }

  globals.fetch = (
    url: string,
    init?: FetchCall["init"],
  ): Promise<FakeResponse> => {
    fetchCalls.push({ url, init });

    if (options.respond) {
      return options.respond(fetchCalls.length);
    }

    return Promise.resolve(okResponse(payload));
  };

  if (options.withoutReaderRoot) {
    window.document.getElementById("book-reader")?.remove();
  }

  window.eval(SCRIPTS.core);
  window.eval(SCRIPTS.reader);

  if (options.beforePage) {
    options.beforePage(window);
  }

  if (options.loadPage) {
    window.eval(SCRIPTS.page);
  }

  const document: Document = window.document;
  const $: (selector: string) => HTMLElement = (
    selector: string,
  ): HTMLElement => {
    const element: HTMLElement | null =
      document.querySelector<HTMLElement>(selector);

    if (!element) {
      throw new Error(`No element matches ${selector}`);
    }

    return element;
  };

  return {
    dom,
    window,
    document,
    root: document.getElementById("book-reader") as HTMLElement,
    fetchCalls,
    errors,
    module: globals.OneUptimeBookReader as ReaderModule,
    unexpectedErrors: (): Array<string> => {
      return errors.filter((message: string): boolean => {
        return !message.includes("Not implemented: navigation");
      });
    },
    pageReader: (): ReaderApi => {
      const books: { reader: ReaderApi } | undefined = globals.OneUptimeBooks;

      if (!books) {
        throw new Error("books.js did not create a reader");
      }

      return books.reader;
    },
    createReader: (readerOptions: ReaderOptions = {}): ReaderApi => {
      return (globals.OneUptimeBookReader as ReaderModule).create(
        document.getElementById("book-reader") as HTMLElement,
        readerOptions,
      );
    },
    $,
    $$: (selector: string): Array<HTMLElement> => {
      return Array.from(document.querySelectorAll<HTMLElement>(selector));
    },
    close: (): void => {
      window.close();
    },
  };
};
