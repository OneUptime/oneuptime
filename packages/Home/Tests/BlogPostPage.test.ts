import { afterEach, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import path from "path";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import type { BlogPost } from "../Utils/BlogPost";

/*
 * The blog post page (Views/Blog/Post.ejs), rendered from the real template
 * with the locals BlogAPI hands it, and its page script run in jsdom.
 *
 * The page script is a row of small features: code block headers, reading
 * time and progress, the table of contents, back to top, image hints,
 * heading anchors, the image lightbox, folding long code, time remaining,
 * copy-link buttons and the validation report. A post with no h2 heading has
 * no table of contents, and the table of contents used to return from the
 * whole script when it found none, so every feature after it was missing
 * from such a post. Each one is checked here on a post with no h2, and the
 * table of contents on one with several.
 *
 * The diagram module (the page's <script type="module">) runs here too, as a
 * classic script in its place and against a stand-in for the mermaid build:
 * jsdom runs no modules and lays nothing out, so mermaid itself draws only
 * in the offline Playwright suite (E2E/Diagrams). This pins what the page
 * does around it - how it asks mermaid to draw, and what a reader sees when
 * a diagram does not parse or mermaid cannot be loaded.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const POST_URL: string =
  "https://oneuptime.com/blog/post/2026-10-07-diagrams-everywhere/view";

const LONG_CODE: string = Array.from(
  { length: 120 },
  (_: unknown, index: number): string => {
    return `line_${index + 1}: true`;
  },
).join("\n");

// No h2: two smaller headings, two images and two code blocks.
const BODY_WITHOUT_H2: string = [
  "<p>A short post that never needs a second level heading.</p>",
  "<h3>Setting it up</h3>",
  "<p>Run the command below.</p>",
  '<pre><code class="language-bash">echo "hello"</code></pre>',
  '<img src="/blog/post/2026-10-07-diagrams-everywhere/one.png" alt="The first screen">',
  "<h4>Checking it worked</h4>",
  '<img src="/blog/post/2026-10-07-diagrams-everywhere/two.png" alt="The second screen">',
  `<pre><code class="language-yaml">${LONG_CODE}</code></pre>`,
  "<p>That is all.</p>",
].join("\n");

const BODY_WITH_H2: string = [
  "<p>A post with sections.</p>",
  "<h2>Why it matters</h2>",
  "<p>Some reasons.</p>",
  "<h3>A detail</h3>",
  '<img src="/blog/post/2026-10-07-diagrams-everywhere/one.png" alt="The first screen">',
  "<h2>How to do it</h2>",
  '<pre><code class="language-bash">echo "hello"</code></pre>',
  '<h2 id="already-named">What next</h2>',
  "<p>The end.</p>",
].join("\n");

const FLOWCHART: string = "graph LR\n  A[Start] --> B[Plain label]";
// Does not parse.
const BROKEN_DIAGRAM: string = "graph LR\n  A -->";

const escapeHtml: (text: string) => string = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

// What the blog's Markdown renderer writes for a ```mermaid fence.
const fencedDiagram: (definition: string) => string = (
  definition: string,
): string => {
  return `<pre><code class="language-mermaid">${escapeHtml(definition)}</code></pre>`;
};

// One diagram that does not parse, one that does, and a code block that is not a diagram.
const BODY_WITH_DIAGRAMS: string = [
  "<p>A post with diagrams.</p>",
  fencedDiagram(BROKEN_DIAGRAM),
  fencedDiagram(FLOWCHART),
  '<pre><code class="language-bash">echo "hello"</code></pre>',
  "<p>That is all.</p>",
].join("\n");

// A diagram the post writes as HTML rather than as a fenced block, ahead of a fenced one.
const BODY_WITH_HTML_DIAGRAM: string = [
  "<p>A post with a diagram written as HTML.</p>",
  `<div class="mermaid">${escapeHtml(BROKEN_DIAGRAM)}</div>`,
  fencedDiagram(FLOWCHART),
].join("\n");

const MERMAID_IMPORT: string =
  "await import('/oneuptime-assets/mermaid/mermaid.mjs')";

/*
 * The page with its diagram module as a classic script in the module's
 * place - after the page script, before DOMContentLoaded, where a module's
 * code up to its first await runs - importing the stand-in instead of the
 * build. window.__diagramsDone settles when the module is done.
 */
const withDiagramModuleAsScript: (html: string) => string = (
  html: string,
): string => {
  const modules: Array<string> = (
    html.match(/<script type="module">[\s\S]*?<\/script>/g) || []
  ).filter((script: string): boolean => {
    return script.includes("/oneuptime-assets/mermaid/");
  });

  expect(modules).toHaveLength(1);

  const moduleScript: string = modules[0] as string;
  const code: string = moduleScript
    .replace(/^<script type="module">/, "")
    .replace(/<\/script>$/, "");

  expect(code).toContain(MERMAID_IMPORT);

  const classicScript: string = `<script>window.__diagramsDone = (async () => {\n${code.replace(
    MERMAID_IMPORT,
    "await window.__loadMermaid()",
  )}\n})();</script>`;

  return html.replace(moduleScript, (): string => {
    return classicScript;
  });
};

const blogPostWith: (htmlBody: string) => BlogPost = (
  htmlBody: string,
): BlogPost => {
  return {
    title: "Diagrams everywhere",
    description: "Drawing diagrams in Markdown.",
    formattedPostDate: "October 07, 2026",
    fileName: "2026-10-07-diagrams-everywhere",
    tags: ["Observability"],
    postDate: "2026-10-07",
    blogUrl: POST_URL,
    contributors: [],
    htmlBody: htmlBody,
    markdownBody: "",
    socialMediaImageUrl:
      "https://oneuptime.com/blog/post/2026-10-07-diagrams-everywhere/social-media.png",
    author: {
      username: "someone",
      githubUrl: "https://github.com/someone",
      profileImageUrl: "https://github.com/someone.png",
      name: "Some One",
    },
    validationStatus: "validated",
    validationDate: "October 08, 2026",
  };
};

const renderPost: (htmlBody: string) => Promise<string> = async (
  htmlBody: string,
): Promise<string> => {
  // Exactly the locals BlogAPI hands the template, plus homeUrl.
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, "Blog", "Post.ejs"),
    {
      support: false,
      footerCards: true,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      blogPost: blogPostWith(htmlBody),
      enableGoogleTagManager: false,
      homeUrl: "https://oneuptime.com",
    },
    { views: [VIEWS_ROOT] },
  )) as string;
};

interface OpenedPost {
  window: DOMWindow;
  document: Document;
  scrolledTo: Array<unknown>;
  fetched: Array<string>;
  copied: Array<string>;
  errors: Array<string>;
  setScrollY: (value: number) => void;
  // How often the diagram module imported mermaid, and what it set it up with.
  mermaidLoads: () => number;
  mermaidConfigs: Array<Record<string, unknown>>;
}

interface MermaidStandIn {
  initialize: (config: Record<string, unknown>) => void;
  run: () => Promise<void>;
}

/*
 * What the page asks of mermaid: initialize(), then run() over every
 * .mermaid element - drawing each that parses and leaving one that does not
 * as it was, as mermaid does with suppressErrorRendering - throwing the
 * first error once it has been through them all.
 */
const mermaidStandIn: (
  window: DOMWindow,
  configs: Array<Record<string, unknown>>,
) => MermaidStandIn = (
  window: DOMWindow,
  configs: Array<Record<string, unknown>>,
): MermaidStandIn => {
  return {
    initialize: (config: Record<string, unknown>): void => {
      configs.push(config);
    },
    run: async (): Promise<void> => {
      const failures: Array<Error> = [];
      const elements: Array<HTMLElement> = Array.from(
        window.document.querySelectorAll<HTMLElement>(".mermaid"),
      );

      for (const element of elements) {
        if (element.getAttribute("data-processed")) {
          continue;
        }
        element.setAttribute("data-processed", "true");

        const definition: string = (element.textContent || "").trim();

        await Promise.resolve();

        if (definition === BROKEN_DIAGRAM) {
          failures.push(
            new Error("Parse error on line 2: Expecting 'NODE_STRING'"),
          );
          continue;
        }

        element.innerHTML = `<svg data-drawn="true"><text>${escapeHtml(definition)}</text></svg>`;
      }

      if (failures.length > 0) {
        throw failures[0];
      }
    },
  };
};

let opened: OpenedPost | null = null;

afterEach(() => {
  if (opened) {
    opened.window.close();
    opened = null;
  }
});

const settle: () => Promise<void> = (): Promise<void> => {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 20);
  });
};

interface OpenOptions {
  // window.addEventListener throws for "resize", as a broken browser might.
  failResizeListeners?: boolean;
  /*
   * Runs the diagram module too, importing the stand-in for mermaid
   * ("build"), or failing to import it, as on a server whose image has no
   * mermaid build ("missing").
   */
  mermaid?: "build" | "missing";
}

/*
 * The rendered page in jsdom with its scripts running. jsdom loads no
 * external script, so highlight.js is a stub; it lays nothing out and has no
 * clipboard, scrolling or network, so those are recorded instead.
 */
const openPost: (
  htmlBody: string,
  options?: OpenOptions,
) => Promise<OpenedPost> = async (
  htmlBody: string,
  options: OpenOptions = {},
): Promise<OpenedPost> => {
  const rendered: string = await renderPost(htmlBody);
  const html: string = options.mermaid
    ? withDiagramModuleAsScript(rendered)
    : rendered;
  const scrolledTo: Array<unknown> = [];
  const fetched: Array<string> = [];
  const copied: Array<string> = [];
  const errors: Array<string> = [];
  const mermaidConfigs: Array<Record<string, unknown>> = [];
  let mermaidLoads: number = 0;
  let scrollY: number = 0;

  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(`script error: ${error.message}`);
  });
  virtualConsole.on("error", (...args: Array<unknown>) => {
    errors.push(`console.error: ${args.map(String).join(" ")}`);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: POST_URL,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: (window: DOMWindow): void => {
      Object.defineProperty(window, "hljs", {
        configurable: true,
        value: {
          highlightAll: (): void => {},
          highlightElement: (): void => {},
          configure: (): void => {},
          getLanguage: (): null => {
            return null;
          },
        },
      });
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        get: (): number => {
          return scrollY;
        },
      });
      window.scrollTo = ((...args: Array<unknown>): void => {
        scrolledTo.push(args[0]);
      }) as typeof window.scrollTo;
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: (url: string): Promise<unknown> => {
          fetched.push(url);
          return Promise.resolve({
            ok: true,
            text: (): Promise<string> => {
              return Promise.resolve("<p>Every claim was checked.</p>");
            },
          });
        },
      });
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string): Promise<void> => {
            copied.push(text);
            return Promise.resolve();
          },
        },
      });
      if (options.failResizeListeners) {
        const addEventListener: typeof window.addEventListener =
          window.addEventListener.bind(window);
        window.addEventListener = ((
          type: string,
          ...rest: Array<unknown>
        ): void => {
          if (type === "resize") {
            throw new Error("resize listeners are broken here");
          }
          (addEventListener as (...args: Array<unknown>) => void)(
            type,
            ...rest,
          );
        }) as typeof window.addEventListener;
      }
      if (options.mermaid) {
        const missing: boolean = options.mermaid === "missing";
        Object.defineProperty(window, "__loadMermaid", {
          configurable: true,
          value: (): Promise<{ default: MermaidStandIn }> => {
            mermaidLoads++;
            if (missing) {
              return Promise.reject(
                new TypeError(
                  "Failed to fetch dynamically imported module: /oneuptime-assets/mermaid/mermaid.mjs",
                ),
              );
            }
            return Promise.resolve({
              default: mermaidStandIn(window, mermaidConfigs),
            });
          },
        });
      }
    },
  });

  await settle();
  await (dom.window["__diagramsDone"] as Promise<void> | undefined);

  opened = {
    window: dom.window,
    document: dom.window.document,
    scrolledTo,
    fetched,
    copied,
    errors,
    setScrollY: (value: number): void => {
      scrollY = value;
      dom.window.dispatchEvent(new dom.window.Event("scroll"));
    },
    mermaidLoads: (): number => {
      return mermaidLoads;
    },
    mermaidConfigs,
  };

  return opened;
};

const byId: (page: OpenedPost, id: string) => HTMLElement = (
  page: OpenedPost,
  id: string,
): HTMLElement => {
  const element: HTMLElement | null = page.document.getElementById(id);

  if (!element) {
    throw new Error(`#${id} is not on the page`);
  }

  return element;
};

const blogImages: (page: OpenedPost) => Array<HTMLImageElement> = (
  page: OpenedPost,
): Array<HTMLImageElement> => {
  return Array.from(
    page.document.querySelectorAll<HTMLImageElement>(".blog-body img"),
  );
};

const click: (page: OpenedPost, element: Element) => void = (
  page: OpenedPost,
  element: Element,
): void => {
  element.dispatchEvent(
    new page.window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
};

describe("a blog post without an h2 heading", () => {
  test("the page script runs to the end without an error", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);

    expect(page.errors).toEqual([]);
  });

  test("leaves out the empty 'On this page' panel", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);

    expect(page.document.getElementById("floating-toc")).toBeNull();
    expect(page.document.querySelectorAll("#toc a")).toHaveLength(0);
  });

  test("takes out the panel the server wrote when its h2 is not a heading on the page", async () => {
    // An h2 left in a comment: the server's check sees it, the page has none.
    const body: string = `<!-- <h2>An old section</h2> -->\n${BODY_WITHOUT_H2}`;

    expect(await renderPost(body)).toContain('id="floating-toc"');

    const page: OpenedPost = await openPost(body);

    expect(page.errors).toEqual([]);
    expect(page.document.getElementById("floating-toc")).toBeNull();
  });

  test("labels each code block and gives it a copy button", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);

    const labels: Array<string> = Array.from(
      page.document.querySelectorAll(".blog-body pre .code-lang-label"),
    ).map((label: Element): string => {
      return label.textContent || "";
    });

    expect(labels).toEqual(["Bash", "YAML"]);
    expect(
      page.document.querySelectorAll(".blog-body pre .code-copy-btn"),
    ).toHaveLength(2);
  });

  test("shows the reading time", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);

    expect(byId(page, "reading-time").textContent).toContain("min read");
    expect(byId(page, "reading-time-inline").textContent).toMatch(
      /^\d+ min read$/,
    );
  });

  test("shows the back to top button once the reader scrolls down, and it goes back to the top", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);
    const button: HTMLElement = byId(page, "back-to-top");

    expect(button.classList.contains("visible")).toBe(false);

    page.setScrollY(900);
    expect(button.classList.contains("visible")).toBe(true);

    click(page, button);
    expect(page.scrolledTo).toEqual([{ top: 0, behavior: "smooth" }]);

    page.setScrollY(0);
    expect(button.classList.contains("visible")).toBe(false);
  });

  test("gives the images their loading hints, lazy after the first", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);
    const images: Array<HTMLImageElement> = blogImages(page);

    expect(images).toHaveLength(2);
    expect(
      images.map((image: HTMLImageElement): Array<string | null> => {
        return [image.getAttribute("decoding"), image.getAttribute("loading")];
      }),
    ).toEqual([
      ["async", null],
      ["async", "lazy"],
    ]);
    for (const image of images) {
      expect(image.classList.contains("block")).toBe(true);
    }
  });

  test("puts a link on every heading, to the heading itself", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);
    const headings: Array<HTMLElement> = Array.from(
      page.document.querySelectorAll<HTMLElement>(
        ".blog-body h3, .blog-body h4",
      ),
    );

    expect(
      headings.map((heading: HTMLElement): Array<string | null> => {
        return [
          heading.id,
          heading.querySelector("a.heading-anchor")?.getAttribute("href") ||
            null,
        ];
      }),
    ).toEqual([
      ["setting-it-up", "#setting-it-up"],
      ["checking-it-worked", "#checking-it-worked"],
    ]);
  });

  test("opens an image in the lightbox, and Escape closes it", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);
    const overlay: HTMLElement = byId(page, "lightbox-overlay");
    const second: HTMLImageElement = blogImages(page)[1] as HTMLImageElement;

    click(page, second);

    expect(overlay.classList.contains("active")).toBe(true);
    expect((byId(page, "lightbox-img") as HTMLImageElement).alt).toBe(
      "The second screen",
    );

    page.document.dispatchEvent(
      new page.window.KeyboardEvent("keydown", { key: "Escape" }),
    );

    expect(overlay.classList.contains("active")).toBe(false);
  });

  test("folds a code block longer than 100 lines behind a 'Show all' button", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);
    const buttons: Array<Element> = Array.from(
      page.document.querySelectorAll(".blog-body .code-expand-btn"),
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("Show all 120 lines");

    const folded: Element | null = page.document.querySelector(
      ".blog-body pre.collapsible-code",
    );

    expect(folded?.classList.contains("collapsed")).toBe(true);

    click(page, buttons[0] as Element);

    expect(folded?.classList.contains("collapsed")).toBe(false);
  });

  test("copies the post's link from the share buttons", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);
    const buttons: Array<Element> = Array.from(
      page.document.querySelectorAll(".copy-link-btn"),
    );

    expect(buttons.length).toBeGreaterThan(0);

    click(page, buttons[0] as Element);

    expect(page.copied).toEqual([POST_URL]);
  });

  test("opens the validation report and loads it once", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2);
    const modal: HTMLElement = byId(page, "validation-modal");

    expect(modal.classList.contains("hidden")).toBe(true);

    click(page, byId(page, "validation-open"));
    await settle();

    expect(modal.classList.contains("hidden")).toBe(false);
    expect(page.fetched).toEqual([
      "/blog/post/2026-10-07-diagrams-everywhere/validation-summary",
    ]);
    expect(byId(page, "validation-modal-content").textContent).toContain(
      "Every claim was checked.",
    );
  });
});

describe("a feature that fails", () => {
  test("is reported, and every feature after it still runs", async () => {
    /*
     * Reading progress and the table of contents listen for resize; with
     * that broken, both fail. The features after them must not care.
     */
    const page: OpenedPost = await openPost(BODY_WITH_H2, {
      failResizeListeners: true,
    });

    const reported: Array<string> = page.errors.filter(
      (error: string): boolean => {
        return error.includes("Blog page:");
      },
    );

    expect(reported).toEqual([
      expect.stringContaining("Blog page: readingProgress did not run"),
      expect.stringContaining("Blog page: tableOfContents did not run"),
    ]);

    // After them: back to top, image hints, heading links, the lightbox...
    page.setScrollY(900);
    expect(byId(page, "back-to-top").classList.contains("visible")).toBe(true);
    expect(blogImages(page)[0]?.getAttribute("decoding")).toBe("async");
    expect(
      page.document.querySelectorAll(".blog-body .heading-anchor"),
    ).toHaveLength(4);

    click(page, blogImages(page)[0] as HTMLImageElement);
    expect(byId(page, "lightbox-overlay").classList.contains("active")).toBe(
      true,
    );

    // ...and the validation report, the last of them.
    click(page, byId(page, "validation-open"));
    await settle();
    expect(page.fetched).toEqual([
      "/blog/post/2026-10-07-diagrams-everywhere/validation-summary",
    ]);
  });
});

describe("a blog post with h2 headings", () => {
  test("lists each h2 in the table of contents, in order, linking to it", async () => {
    const page: OpenedPost = await openPost(BODY_WITH_H2);
    const links: Array<HTMLAnchorElement> = Array.from(
      page.document.querySelectorAll<HTMLAnchorElement>("#toc a"),
    );

    expect(
      links.map((link: HTMLAnchorElement): Array<string | null> => {
        return [link.textContent, link.getAttribute("href")];
      }),
    ).toEqual([
      ["Why it matters", "#why-it-matters"],
      ["How to do it", "#how-to-do-it"],
      ["What next", "#already-named"],
    ]);
    expect(page.document.getElementById("floating-toc")).not.toBeNull();
  });

  test("marks the section being read as the reader scrolls", async () => {
    const page: OpenedPost = await openPost(BODY_WITH_H2);
    const headings: Array<HTMLElement> = Array.from(
      page.document.querySelectorAll<HTMLElement>(".blog-body h2"),
    );

    /*
     * jsdom lays nothing out: put the three sections 1000px apart, measured
     * from wherever the reader has scrolled to, the way a browser would.
     */
    headings.forEach((heading: HTMLElement, index: number) => {
      heading.getBoundingClientRect = (): DOMRect => {
        const top: number = 1000 * (index + 1) - page.window.scrollY;
        return { top, bottom: top + 30 } as DOMRect;
      };
    });

    const active: () => Array<string | null> = (): Array<string | null> => {
      return Array.from(
        page.document.querySelectorAll("#toc a.toc-active"),
      ).map((link: Element): string | null => {
        return link.getAttribute("href");
      });
    };

    page.setScrollY(0);
    expect(active()).toEqual(["#why-it-matters"]);

    page.setScrollY(2100);
    expect(active()).toEqual(["#how-to-do-it"]);

    page.setScrollY(5000);
    expect(active()).toEqual(["#already-named"]);
  });

  test("runs every other feature as well", async () => {
    const page: OpenedPost = await openPost(BODY_WITH_H2);

    expect(page.errors).toEqual([]);
    expect(
      page.document.querySelectorAll(".blog-body .heading-anchor"),
    ).toHaveLength(4);
    expect(blogImages(page)[0]?.getAttribute("decoding")).toBe("async");

    page.setScrollY(900);
    expect(byId(page, "back-to-top").classList.contains("visible")).toBe(true);

    click(page, blogImages(page)[0] as HTMLImageElement);
    expect(byId(page, "lightbox-overlay").classList.contains("active")).toBe(
      true,
    );
  });
});

describe("the 'On this page' panel, as the server writes the page", () => {
  test.each([
    ["left out", "no h2 heading", BODY_WITHOUT_H2],
    ["written", "h2 headings", BODY_WITH_H2],
    ["written", "one h2 with attributes", '<h2 class="lead">Only one</h2>'],
    ["left out", "a header element", "<header>Not a heading</header>"],
    [
      "left out",
      "an h2 shown as code",
      "<pre><code>&lt;h2&gt;Not a heading&lt;/h2&gt;</code></pre>",
    ],
  ])(
    "is %s for a post with %s",
    async (outcome: string, _: string, htmlBody: string) => {
      const html: string = await renderPost(htmlBody);
      const written: boolean = outcome === "written";

      expect(html.includes('id="floating-toc"')).toBe(written);
      expect(html.includes('id="toc"')).toBe(written);
    },
  );
});

type BodyLayoutFunction = (page: OpenedPost) => Array<string>;

// The post body's elements in order: notes, code blocks, diagrams and the rest by tag.
const bodyLayout: BodyLayoutFunction = (page: OpenedPost): Array<string> => {
  const body: Element | null = page.document.querySelector(".blog-body");

  return Array.from(body ? body.children : []).map((child: Element): string => {
    if (child.classList.contains("blog-diagram-note")) {
      return "note";
    }
    if (child.classList.contains("mermaid")) {
      if (child.querySelector("svg")) {
        return "diagram";
      }
      return child.getAttribute("data-diagram") === "source"
        ? "diagram source"
        : "undrawn diagram";
    }
    return child.tagName.toLowerCase();
  });
};

const NOT_DRAWN: string = "This diagram could not be drawn.";

describe("a blog post's diagrams", () => {
  test("are drawn by mermaid in strict mode, asked to draw no error graphic, each in its block's place", async () => {
    const page: OpenedPost = await openPost(
      BODY_WITH_H2 + fencedDiagram(FLOWCHART),
      {
        mermaid: "build",
      },
    );

    expect(page.errors).toEqual([]);
    expect(page.mermaidLoads()).toBe(1);
    expect(page.mermaidConfigs).toEqual([
      {
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "default",
      },
    ]);

    const diagram: Element | null = page.document.querySelector(
      ".blog-body .mermaid",
    );

    expect(diagram?.querySelector("svg")?.textContent).toBe(FLOWCHART);
    expect(bodyLayout(page).slice(-1)).toEqual(["diagram"]);
    // The code block that is not a diagram is still code.
    expect(
      Array.from(
        page.document.querySelectorAll(".blog-body pre .code-lang-label"),
      ).map((label: Element): string | null => {
        return label.textContent;
      }),
    ).toEqual(["Bash"]);
    expect(
      page.document.querySelectorAll(".blog-body .blog-diagram-note"),
    ).toHaveLength(0);
  });

  test("put one that does not parse back as its code block - label, copy button and all - under a short note", async () => {
    const page: OpenedPost = await openPost(BODY_WITH_DIAGRAMS, {
      mermaid: "build",
    });

    expect(bodyLayout(page)).toEqual([
      "p",
      "note",
      "pre",
      "diagram",
      "pre",
      "p",
    ]);

    const note: Element | null = page.document.querySelector(
      ".blog-body .blog-diagram-note",
    );

    expect(note?.textContent).toBe(NOT_DRAWN);

    const codeBlock: Element | null = note ? note.nextElementSibling : null;

    expect(codeBlock?.querySelector("code")?.textContent).toBe(BROKEN_DIAGRAM);
    expect(codeBlock?.querySelector(".code-lang-label")?.textContent).toBe(
      "Mermaid",
    );

    // Its copy button still copies the diagram's source.
    click(page, codeBlock?.querySelector(".code-copy-btn") as Element);
    await settle();
    expect(page.copied).toEqual([BROKEN_DIAGRAM]);

    expect(page.errors).toEqual([
      expect.stringContaining(
        "Mermaid could not render the diagrams in this post",
      ),
    ]);
  });

  test("show the source of one the post writes as HTML when it does not parse, under the note", async () => {
    const page: OpenedPost = await openPost(BODY_WITH_HTML_DIAGRAM, {
      mermaid: "build",
    });

    expect(bodyLayout(page)).toEqual([
      "p",
      "note",
      "diagram source",
      "diagram",
    ]);

    const source: Element | null = page.document.querySelector(
      '.blog-body .mermaid[data-diagram="source"]',
    );

    expect(source?.textContent).toBe(BROKEN_DIAGRAM);
    expect(source?.previousElementSibling?.textContent).toBe(NOT_DRAWN);
    expect(page.errors).toEqual([
      expect.stringContaining(
        "Mermaid could not render the diagrams in this post",
      ),
    ]);
  });

  test("stay code, each under the note, when mermaid cannot be loaded - said once", async () => {
    const page: OpenedPost = await openPost(
      BODY_WITH_DIAGRAMS + BODY_WITH_HTML_DIAGRAM,
      { mermaid: "missing" },
    );

    expect(page.mermaidLoads()).toBe(1);
    expect(page.mermaidConfigs).toEqual([]);
    expect(bodyLayout(page)).toEqual([
      "p",
      "note",
      "pre",
      "note",
      "pre",
      "pre",
      "p",
      "p",
      "note",
      "diagram source",
      "note",
      "pre",
    ]);

    // Each fenced block is the code block it was, with its header.
    const mermaidBlocks: Array<Element> = Array.from(
      page.document.querySelectorAll(".blog-body pre"),
    ).filter((pre: Element): boolean => {
      return pre.querySelector(".code-lang-label")?.textContent === "Mermaid";
    });

    expect(
      mermaidBlocks.map((pre: Element): string | null => {
        return pre.querySelector("code")?.textContent || null;
      }),
    ).toEqual([BROKEN_DIAGRAM, FLOWCHART, FLOWCHART]);
    expect(page.errors).toEqual([
      expect.stringContaining(
        "Mermaid could not be loaded, so the diagrams in this post are shown as code",
      ),
    ]);
  });

  test("do not load mermaid for a post with no fenced diagram", async () => {
    const page: OpenedPost = await openPost(BODY_WITHOUT_H2, {
      mermaid: "build",
    });

    expect(page.mermaidLoads()).toBe(0);
    expect(page.errors).toEqual([]);
  });
});
