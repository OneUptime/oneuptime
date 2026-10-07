import { afterEach, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";

/*
 * The docs' diagram script - the <script type="module"> in
 * App/FeatureSet/Docs/Views/Partials/Head.ejs - run in jsdom against a
 * stand-in for mermaid. jsdom lays nothing out, so mermaid itself cannot
 * draw here; the offline Playwright suite (E2E/Diagrams) draws with the real
 * one. This pins what the page does around it: where mermaid draws, what a
 * reader sees when a diagram does not parse or mermaid cannot be loaded, and
 * what a redraw keeps.
 */

const DOCS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
);
const HEAD_TEMPLATE: string = path.join(
  DOCS_ROOT,
  "Views",
  "Partials",
  "Head.ejs",
);
const MERMAID_IMPORT: string =
  "await import('/oneuptime-assets/mermaid/mermaid.mjs')";
const NOTE_META: RegExp =
  /<meta name="oneuptime-docs-diagram-not-drawn" content="[^"]*">/;

const FLOWCHART: string = "graph LR\n  A[Start] --> B[Plain label]";
const SEQUENCE: string = "sequenceDiagram\n  Alice->>Bob: Hello Bob";
// Does not parse.
const BROKEN: string = "graph LR\n  A -->";
const ENGLISH_NOTE: string = "This diagram could not be drawn.";

type LocaleStrings = Record<string, Record<string, unknown>>;

const stringsIn: (lang: string) => LocaleStrings = (
  lang: string,
): LocaleStrings => {
  return JSON.parse(
    fs.readFileSync(path.join(DOCS_ROOT, "Locales", `${lang}.json`), "utf8"),
  ) as LocaleStrings;
};

// The docs' <head> as a page in that language gets it.
const renderHead: (lang: string) => string = (lang: string): string => {
  const strings: LocaleStrings = stringsIn(lang);

  return ejs.render(
    fs.readFileSync(HEAD_TEMPLATE, "utf8"),
    {
      t: (key: string): string => {
        const [section, name] = key.split(".");
        const value: unknown =
          section && name ? strings[section]?.[name] : undefined;
        return typeof value === "string" ? value : key;
      },
      lang,
      enableGoogleTagManager: false,
    },
    { filename: HEAD_TEMPLATE },
  );
};

/*
 * The diagram module's code, with its import of the mermaid build pointed at
 * the stand-in, as the body of an async function: a module may await at its
 * top level, and the test waits for it to finish.
 */
const diagramScriptOf: (head: string) => string = (head: string): string => {
  const modules: Array<string> = (
    head.match(/<script type="module">[\s\S]*?<\/script>/g) || []
  ).filter((script: string): boolean => {
    return script.includes("/oneuptime-assets/mermaid/");
  });

  expect(modules).toHaveLength(1);

  const code: string = (modules[0] as string)
    .replace(/^<script type="module">/, "")
    .replace(/<\/script>$/, "");

  expect(code).toContain(MERMAID_IMPORT);

  return `(async () => {\n${code.replace(
    MERMAID_IMPORT,
    "await window.__loadMermaid()",
  )}\n})()`;
};

const escapeHtml: (text: string) => string = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

// What Common/Server/Types/Markdown.ts writes for a ```mermaid fence.
const pageWith: (head: string, definitions: Array<string>) => string = (
  head: string,
  definitions: Array<string>,
): string => {
  const diagrams: string = definitions
    .map((definition: string): string => {
      return `<div class="docs-diagram"><div class="mermaid">${escapeHtml(definition)}</div></div>`;
    })
    .join("\n");

  return `<!doctype html><html lang="en"><head>${head}</head><body><article class="docs-article"><h1>Diagrams</h1>${diagrams}<p>Text after them.</p></article></body></html>`;
};

interface RenderCall {
  id: string;
  definition: string;
  // Where mermaid was asked to draw, and how that element looked then.
  container: HTMLElement | undefined;
  containerOnPage: boolean;
  containerHidden: string | null;
  containerVisibility: string;
  containerPosition: string;
  theme: string;
}

interface RenderResult {
  svg: string;
}

type RenderBehaviour = (
  call: RenderCall,
  window: DOMWindow,
) => Promise<RenderResult>;

// What mermaid answers: an SVG naming its id and theme, or a parse error.
const drawsWhatParses: RenderBehaviour = async (
  call: RenderCall,
): Promise<RenderResult> => {
  if (call.definition === BROKEN) {
    throw new Error("Parse error on line 2: Expecting 'NODE_STRING'");
  }

  return {
    svg: `<svg id="${call.id}" data-theme="${call.theme}" viewBox="0 0 640 120"><text>${escapeHtml(call.definition)}</text></svg>`,
  };
};

interface DocsPage {
  window: DOMWindow;
  document: Document;
  errors: Array<string>;
  initialized: Array<Record<string, unknown>>;
  renders: Array<RenderCall>;
  loads: () => number;
  bodyChildren: () => number;
  diagrams: () => Array<HTMLElement>;
  notes: () => Array<HTMLElement>;
  switchTheme: (dark: boolean) => void;
}

interface OpenOptions {
  lang?: string;
  withoutNoteText?: boolean;
  mermaidMissing?: boolean;
  render?: RenderBehaviour;
}

let opened: DocsPage | null = null;

afterEach(() => {
  if (opened) {
    opened.window.close();
    opened = null;
  }
});

const settle: () => Promise<void> = (): Promise<void> => {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 10);
  });
};

// A docs page with these diagrams, its diagram script run to the end.
const openDocsPage: (
  definitions: Array<string>,
  options?: OpenOptions,
) => Promise<DocsPage> = async (
  definitions: Array<string>,
  options: OpenOptions = {},
): Promise<DocsPage> => {
  let head: string = renderHead(options.lang || "en");

  if (options.withoutNoteText) {
    expect(head).toMatch(NOTE_META);
    head = head.replace(NOTE_META, "");
  }

  const errors: Array<string> = [];
  const initialized: Array<Record<string, unknown>> = [];
  const renders: Array<RenderCall> = [];
  let loads: number = 0;
  let theme: string = "";

  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("error", (...args: Array<unknown>) => {
    errors.push(args.map(String).join(" "));
  });
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(`script error: ${error.message}`);
  });

  const dom: JSDOM = new JSDOM(pageWith(head, definitions), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const window: DOMWindow = dom.window;
  const render: RenderBehaviour = options.render || drawsWhatParses;

  const mermaid: {
    initialize: (config: Record<string, unknown>) => void;
    render: (
      id: string,
      definition: string,
      container?: HTMLElement,
    ) => Promise<RenderResult>;
  } = {
    initialize: (config: Record<string, unknown>): void => {
      initialized.push(config);
      theme = String(config["theme"]);
    },
    render: (
      id: string,
      definition: string,
      container?: HTMLElement,
    ): Promise<RenderResult> => {
      const call: RenderCall = {
        id,
        definition,
        container,
        containerOnPage: Boolean(
          container && container.parentElement === window.document.body,
        ),
        containerHidden: container
          ? container.getAttribute("aria-hidden")
          : null,
        containerVisibility: container ? container.style.visibility : "",
        containerPosition: container ? container.style.position : "",
        theme,
      };
      renders.push(call);
      return render(call, window);
    },
  };

  Object.defineProperty(window, "__loadMermaid", {
    configurable: true,
    value: (): Promise<{ default: typeof mermaid }> => {
      loads++;
      if (options.mermaidMissing) {
        return Promise.reject(
          new TypeError(
            "Failed to fetch dynamically imported module: /oneuptime-assets/mermaid/mermaid.mjs",
          ),
        );
      }
      return Promise.resolve({ default: mermaid });
    },
  });

  await (window.eval(diagramScriptOf(head)) as Promise<void>);

  opened = {
    window,
    document: window.document,
    errors,
    initialized,
    renders,
    loads: (): number => {
      return loads;
    },
    bodyChildren: (): number => {
      return window.document.body.children.length;
    },
    diagrams: (): Array<HTMLElement> => {
      return Array.from(
        window.document.querySelectorAll<HTMLElement>(".docs-diagram .mermaid"),
      );
    },
    notes: (): Array<HTMLElement> => {
      return Array.from(
        window.document.querySelectorAll<HTMLElement>(".docs-diagram__note"),
      );
    },
    // What the docs' theme switch does (Docs/Views/Partials/Scripts.ejs).
    switchTheme: (dark: boolean): void => {
      window.document.documentElement.classList.toggle("dark", dark);
      window.dispatchEvent(new window.Event("docs:themechange"));
    },
  };

  return opened;
};

const noteAbove: (diagram: HTMLElement) => HTMLElement | null = (
  diagram: HTMLElement,
): HTMLElement | null => {
  const previous: Element | null = diagram.previousElementSibling;

  return previous && previous.classList.contains("docs-diagram__note")
    ? (previous as HTMLElement)
    : null;
};

const reported: (page: DocsPage, text: string) => Array<string> = (
  page: DocsPage,
  text: string,
): Array<string> => {
  return page.errors.filter((error: string): boolean => {
    return error.includes(text);
  });
};

describe("the docs' diagram script", () => {
  test("draws each diagram in a hidden container of its own, gone once it is drawn", async () => {
    const page: DocsPage = await openDocsPage([FLOWCHART, SEQUENCE]);

    expect(page.errors).toEqual([]);
    expect(
      page.renders.map((call: RenderCall): Array<string> => {
        return [call.id, call.definition];
      }),
    ).toEqual([
      ["docs-diagram-1-0", FLOWCHART],
      ["docs-diagram-1-1", SEQUENCE],
    ]);

    // On the page while mermaid measured in it, never seen, then removed.
    for (const call of page.renders) {
      expect(call.containerOnPage).toBe(true);
      expect(call.containerHidden).toBe("true");
      expect(call.containerVisibility).toBe("hidden");
      expect(call.containerPosition).toBe("absolute");
      expect(call.container?.isConnected).toBe(false);
    }
    expect(page.bodyChildren()).toBe(1);

    // Each diagram holds its drawing, filling the column but never narrower than drawn.
    for (const [index, diagram] of page.diagrams().entries()) {
      expect(diagram.getAttribute("data-diagram")).toBe("drawn");

      const svg: SVGElement | null = diagram.querySelector("svg");

      expect(svg?.getAttribute("id")).toBe(`docs-diagram-1-${index}`);
      expect(svg?.style.minWidth).toBe("640px");
      expect(svg?.style.width).toBe("100%");
      expect(svg?.style.maxWidth).toBe("none");
    }
    expect(page.notes()).toEqual([]);
  });

  test("asks mermaid to draw no error graphic, in the page's theme", async () => {
    const page: DocsPage = await openDocsPage([FLOWCHART]);

    expect(page.initialized).toEqual([
      {
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: "default",
      },
    ]);
  });

  test("shows a diagram that does not parse as its source, under one short note, and draws the rest", async () => {
    const page: DocsPage = await openDocsPage([BROKEN, FLOWCHART, SEQUENCE]);
    const [broken, flowchart, sequence] = page.diagrams() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(broken.getAttribute("data-diagram")).toBe("source");
    expect(broken.textContent).toBe(BROKEN);
    expect(broken.querySelector("svg")).toBeNull();

    const note: HTMLElement | null = noteAbove(broken);

    expect(note?.textContent).toBe(ENGLISH_NOTE);
    // Read in its own language's direction, inside a box that is always left to right.
    expect(note?.getAttribute("dir")).toBe("auto");
    expect(page.notes()).toHaveLength(1);

    expect(flowchart.getAttribute("data-diagram")).toBe("drawn");
    expect(sequence.getAttribute("data-diagram")).toBe("drawn");
    expect(page.bodyChildren()).toBe(1);

    expect(page.errors).toEqual([
      expect.stringContaining(
        "Mermaid could not render a diagram on this page",
      ),
    ]);
  });

  test("redraws in the new theme with new ids, leaving one that did not parse as it is", async () => {
    const page: DocsPage = await openDocsPage([BROKEN, FLOWCHART]);

    page.switchTheme(true);
    await settle();

    expect(
      page.renders.map((call: RenderCall): Array<string> => {
        return [call.id, call.theme];
      }),
    ).toEqual([
      ["docs-diagram-1-0", "default"],
      ["docs-diagram-1-1", "default"],
      // The second draw does not try the one that did not parse again.
      ["docs-diagram-2-1", "dark"],
    ]);

    const [broken, flowchart] = page.diagrams() as [HTMLElement, HTMLElement];

    expect(flowchart.querySelector("svg")?.getAttribute("data-theme")).toBe(
      "dark",
    );
    expect(broken.textContent).toBe(BROKEN);
    expect(page.notes()).toHaveLength(1);
    // Reported once, when the page was drawn.
    expect(
      reported(page, "Mermaid could not render a diagram on this page"),
    ).toHaveLength(1);
    expect(page.bodyChildren()).toBe(1);
  });

  test("keeps the last drawing of a diagram whose redraw fails", async () => {
    const page: DocsPage = await openDocsPage([FLOWCHART, SEQUENCE], {
      render: async (call: RenderCall): Promise<RenderResult> => {
        if (call.id === "docs-diagram-2-0") {
          throw new Error("Could not measure the label");
        }
        return drawsWhatParses(call, {} as DOMWindow);
      },
    });

    page.switchTheme(true);
    await settle();

    const [flowchart, sequence] = page.diagrams() as [HTMLElement, HTMLElement];

    // Still the first drawing, not its source and no note.
    expect(flowchart.getAttribute("data-diagram")).toBe("drawn");
    expect(flowchart.querySelector("svg")?.getAttribute("id")).toBe(
      "docs-diagram-1-0",
    );
    expect(page.notes()).toEqual([]);
    // The one after it is still redrawn.
    expect(sequence.querySelector("svg")?.getAttribute("id")).toBe(
      "docs-diagram-2-1",
    );
    expect(
      reported(page, "Mermaid could not render a diagram on this page"),
    ).toHaveLength(1);
  });

  test("stops a draw a newer one overtook, so the newest drawing is what stays", async () => {
    const releases: Array<() => void> = [];

    const page: DocsPage = await openDocsPage([FLOWCHART, SEQUENCE], {
      render: (call: RenderCall): Promise<RenderResult> => {
        if (!call.id.startsWith("docs-diagram-2-")) {
          return drawsWhatParses(call, {} as DOMWindow);
        }
        // The second draw is slow to come back.
        return new Promise((resolve: (result: RenderResult) => void): void => {
          releases.push((): void => {
            resolve({
              svg: `<svg id="${call.id}" viewBox="0 0 640 120"></svg>`,
            });
          });
        });
      },
    });

    // The theme switched twice in a row: the second draw is still waiting when the third starts.
    page.switchTheme(true);
    page.switchTheme(false);
    await settle();

    expect(releases).toHaveLength(1);
    releases.forEach((release: () => void) => {
      release();
    });
    await settle();

    // The overtaken draw neither placed its drawing nor went on to the next diagram.
    expect(
      page.renders.map((call: RenderCall): string => {
        return call.id;
      }),
    ).toEqual([
      "docs-diagram-1-0",
      "docs-diagram-1-1",
      "docs-diagram-2-0",
      "docs-diagram-3-0",
      "docs-diagram-3-1",
    ]);
    expect(
      page.diagrams().map((diagram: HTMLElement): string | null => {
        return diagram.querySelector("svg")?.getAttribute("id") || null;
      }),
    ).toEqual(["docs-diagram-3-0", "docs-diagram-3-1"]);
    expect(page.errors).toEqual([]);
  });

  test("removes mermaid's working container even when it throws something unexpected", async () => {
    const page: DocsPage = await openDocsPage([FLOWCHART], {
      render: async (
        call: RenderCall,
        window: DOMWindow,
      ): Promise<RenderResult> => {
        // What mermaid leaves when it gives up part way: its working element and error graphic.
        const working: HTMLElement = window.document.createElement("div");
        working.id = `d${call.id}`;
        working.innerHTML = "<svg><text>Syntax error in text</text></svg>";
        call.container?.appendChild(working);
        throw new TypeError(
          "Cannot read properties of undefined (reading 'getBBox')",
        );
      },
    });

    expect(page.bodyChildren()).toBe(1);
    expect(
      page.document.querySelectorAll('[id^="ddocs-diagram-"]'),
    ).toHaveLength(0);
    expect(page.document.body.textContent).not.toContain(
      "Syntax error in text",
    );

    const [flowchart] = page.diagrams() as [HTMLElement];

    expect(flowchart.getAttribute("data-diagram")).toBe("source");
    expect(noteAbove(flowchart)?.textContent).toBe(ENGLISH_NOTE);
    expect(
      reported(page, "Mermaid could not render a diagram on this page"),
    ).toHaveLength(1);
  });

  test("shows every diagram's source under the note when mermaid cannot be loaded, and says so once", async () => {
    const page: DocsPage = await openDocsPage([FLOWCHART, SEQUENCE], {
      mermaidMissing: true,
    });

    expect(page.loads()).toBe(1);
    expect(
      page.diagrams().map((diagram: HTMLElement): Array<string | null> => {
        return [
          diagram.getAttribute("data-diagram"),
          diagram.textContent,
          noteAbove(diagram)?.textContent || null,
        ];
      }),
    ).toEqual([
      ["source", FLOWCHART, ENGLISH_NOTE],
      ["source", SEQUENCE, ENGLISH_NOTE],
    ]);
    expect(page.errors).toEqual([
      expect.stringContaining(
        "Mermaid could not be loaded, so the diagrams on this page are shown as text",
      ),
    ]);

    // Nothing to redraw with, and nothing more to say.
    page.switchTheme(true);
    await settle();
    expect(page.notes()).toHaveLength(2);
    expect(page.errors).toHaveLength(1);
  });

  test("does not load mermaid on a page without a diagram", async () => {
    const page: DocsPage = await openDocsPage([]);

    expect(page.loads()).toBe(0);
    expect(page.renders).toEqual([]);
    expect(page.errors).toEqual([]);
  });

  test("says it in the page's language", async () => {
    const persian: string = stringsIn("fa")["ui"]?.[
      "diagramNotDrawn"
    ] as string;
    const page: DocsPage = await openDocsPage([BROKEN], { lang: "fa" });

    expect(persian).toBeTruthy();
    expect(persian).not.toBe(ENGLISH_NOTE);
    expect(
      page.notes().map((note: HTMLElement): string | null => {
        return note.textContent;
      }),
    ).toEqual([persian]);
  });

  test("falls back to English when the page carries no note text", async () => {
    const page: DocsPage = await openDocsPage([BROKEN], {
      lang: "de",
      withoutNoteText: true,
    });

    expect(
      page.notes().map((note: HTMLElement): string | null => {
        return note.textContent;
      }),
    ).toEqual([ENGLISH_NOTE]);
  });
});
