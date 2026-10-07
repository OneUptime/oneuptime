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
}

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
  const html: string = await renderPost(htmlBody);
  const scrolledTo: Array<unknown> = [];
  const fetched: Array<string> = [];
  const copied: Array<string> = [];
  const errors: Array<string> = [];
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
    },
  });

  await settle();

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
