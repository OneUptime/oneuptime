import {
  BlogMarkdownClasses,
  CommonContentFiles,
  DynamicClasses,
} from "../tailwind.config";
import { buildMarketingTailwindCss } from "../Scripts/BuildTailwindCss";
import {
  CssCoverage,
  CssNormalization,
  KITCHEN_SINK_MARKDOWN,
  MARKETING_PAGES,
  MarketingPage,
  VIEWS_ROOT,
  classTokensInSource,
  classesOnPage,
  classesSelectedBy,
  cssCoverage,
  listFiles,
  renderMarketingPage,
  runtimeCssFor,
  tailwindCssFor,
} from "./Helpers/TailwindPages";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The compiled Tailwind stylesheet against the pages it replaces the Play CDN
 * runtime on.
 *
 * The runtime generated, in the visitor's browser, the rules for exactly the
 * classes on the page in front of it. The build has to have found every one
 * of them ahead of time, in the files that write them (tailwind.config.ts);
 * a class it missed is an element that silently loses its styles. So each
 * page here is rendered from its real template with the locals its route
 * hands it, Tailwind's own JIT generates the rules for exactly the classes
 * on it - what the runtime did - and every one of those rules has to be in
 * the built stylesheet, in the same order (the order decides which of two
 * rules for one element wins). Two pages also go through the runtime itself,
 * run in jsdom, to show the build reproduces what visitors were sent.
 *
 * Building the stylesheet takes a while (every view, the Utils, the blog
 * renderer), and so does the runtime; the timeouts are generous because the
 * test machines can be busy.
 */

const BUILD_TIMEOUT_MS: number = 20 * 60 * 1000;
const PAGE_TIMEOUT_MS: number = 10 * 60 * 1000;

/*
 * A class that sizes or spaces with a numbered step of Tailwind's spacing
 * scale, with any variants in front: "h-4", "sm:gap-2.5", "-mt-1".
 */
const SPACING_STEP: RegExp =
  /^(?:[a-z0-9-]+:)*-?(?:size|min-w|min-h|max-w|max-h|w|h|p|px|py|ps|pe|pt|pr|pb|pl|m|mx|my|ms|me|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|start|end|translate-x|translate-y|scroll-m|scroll-mt|scroll-mb|scroll-p)-\d+(?:\.\d+)?$/;

// Classes that only the fixture blog's posts carry.
const BLOG_ONLY_CLASSES: Array<string> = [
  "tracking-[0.4242em]",
  "skew-x-[13.37deg]",
  "bg-[#0a0b0c]",
];

let blogRoot: string;
let builtCss: string;
let builtClasses: Set<string>;

beforeAll(async () => {
  blogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "home-tailwind-blog-"));
  const post: string = path.join(blogRoot, "posts", "2026-10-13-raw-html");
  fs.mkdirSync(post, { recursive: true });
  fs.writeFileSync(
    path.join(post, "README.md"),
    [
      "# A post with raw HTML",
      "",
      `<div class="${BLOG_ONLY_CLASSES[0]} ${BLOG_ONLY_CLASSES[1]}">Raw HTML</div>`,
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(post, "validation-summary.md"),
    `Checked: <span class='${BLOG_ONLY_CLASSES[2]}'>yes</span>`,
  );

  builtCss = await buildMarketingTailwindCss({ blogRoot: blogRoot });
  builtClasses = classesSelectedBy(builtCss);
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(blogRoot, { recursive: true, force: true });
});

describe("the built stylesheet", () => {
  test("is Tailwind 3.4.5 with its preflight", () => {
    expect(builtCss.startsWith("/*! tailwindcss v3.4.5 | MIT License")).toBe(
      true,
    );
    // The preflight's first rule.
    expect(builtCss).toContain(
      "*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}",
    );
  });

  test("carries the classes the blog's posts write", () => {
    // Read from the fixture blog only: no file in the content has them.
    for (const className of BLOG_ONLY_CLASSES) {
      expect([className, builtClasses.has(className)]).toEqual([
        className,
        true,
      ]);
    }
  });

  test(
    "control: a class no file writes is reported missing",
    async () => {
      // What the page checks below would say about an element the build missed.
      const absent: Array<string> = ["bg-[#123457]", "hover:skew-y-[7.7deg]"];
      const coverage: CssCoverage = cssCoverage(
        await tailwindCssFor(absent),
        builtCss,
      );

      expect(coverage.missing).toEqual(
        expect.arrayContaining([
          " | .bg-\\[\\#123457\\] | background-color:rgb(18 52 87 / var(--tw-bg-opacity))",
          " | .hover\\:skew-y-\\[7\\.7deg\\]:hover | --tw-skew-y:7.7deg",
        ]),
      );
      // Nothing else: the preflight and the rest are in the build.
      expect(
        coverage.missing.filter((atom: string): boolean => {
          return !atom.includes("123457") && !atom.includes("7\\.7deg");
        }),
      ).toEqual([]);

      for (const className of absent) {
        expect(builtClasses.has(className)).toBe(false);
      }
    },
    PAGE_TIMEOUT_MS,
  );

  test("and no file but the fixture blog writes those classes", () => {
    const sources: Array<string> = [
      ...listFiles(VIEWS_ROOT, ".ejs"),
      ...listFiles(path.join(__dirname, "..", "Utils"), ".ts"),
      ...listFiles(path.join(__dirname, "..", "Static", "js"), ".js"),
      ...CommonContentFiles,
    ];

    for (const source of sources) {
      const text: string = fs.readFileSync(source, "utf8");

      for (const className of BLOG_ONLY_CLASSES) {
        expect([source, className, text.includes(className)]).toEqual([
          source,
          className,
          false,
        ]);
      }
    }
  });
});

describe.each(MARKETING_PAGES)("$name", (page: MarketingPage) => {
  let classes: Array<string>;
  let pageCss: string;
  let pageUtilities: Set<string>;
  let coverage: CssCoverage;

  beforeAll(async () => {
    classes = classesOnPage(await renderMarketingPage(page));
    pageCss = await tailwindCssFor(classes);
    pageUtilities = classesSelectedBy(pageCss);
    coverage = cssCoverage(pageCss, builtCss);
  }, PAGE_TIMEOUT_MS);

  test("carries Tailwind classes to check", () => {
    const utilities: Array<string> = classes.filter(
      (className: string): boolean => {
        return pageUtilities.has(className);
      },
    );

    expect(utilities.length).toBeGreaterThan(40);
  });

  test("every Tailwind class on the page has its rules in the built stylesheet", () => {
    const unstyled: Array<string> = classes.filter(
      (className: string): boolean => {
        return pageUtilities.has(className) && !builtClasses.has(className);
      },
    );

    expect(unstyled).toEqual([]);
  });

  test("every declaration Tailwind generates for the page is in the built stylesheet", () => {
    expect(coverage.missing).toEqual([]);
  });

  test("and in the same order, so the same rule wins", () => {
    expect(coverage.outOfOrder).toEqual([]);
  });
});

/*
 * The runtime's output was minified and prefixed with the caniuse data it
 * was bundled with (2023); the build writes Tailwind's own spelling and
 * prefixes with today's data for the same browsers. The differences, and
 * nothing else, are written out of both sides here:
 * - quotes around attribute values in selectors ([type='button'] / [type=button]);
 * - a leading zero (-0.25em / -.25em);
 * - -webkit-text-decoration-*, which the old data still asked for in Safari
 *   16 and today's knows Safari has not needed since 12.1 - in its own
 *   declarations and inside transition-property lists, whose order is
 *   immaterial (one duration and easing apply to every property).
 */
const RUNTIME_SPELLING: CssNormalization = {
  selector: (selector: string): string => {
    return selector.replace(
      /\[([\w-]+)([~|^$*]?=)(["'])([\w-]+)\3\]/g,
      "[$1$2$4]",
    );
  },
  declaration: (property: string, value: string): string | null => {
    if (property.startsWith("-webkit-text-decoration")) {
      return null;
    }

    let written: string = value.replace(/(^|[\s(,/-])0\.(\d)/g, "$1.$2");

    if (property === "transition-property") {
      written = Array.from(
        new Set(
          written.split(",").map((name: string): string => {
            const trimmed: string = name.trim();
            return trimmed === "-webkit-text-decoration-color"
              ? "text-decoration-color"
              : trimmed;
          }),
        ),
      )
        .sort()
        .join(",");
    }

    return `${property}:${written}`;
  },
};

describe.each(
  MARKETING_PAGES.filter((page: MarketingPage): boolean => {
    return page.template === "index.ejs" || page.template.includes("Post.ejs");
  }),
)("$name, against the Play CDN runtime itself", (page: MarketingPage) => {
  test(
    "every declaration the runtime generated on the page is in the built stylesheet",
    async () => {
      const runtimeCss: string = await runtimeCssFor(
        await renderMarketingPage(page),
      );

      // It did run, and generated the page's utilities.
      expect(runtimeCss).toContain("tailwindcss v3.4.5");
      expect(classesSelectedBy(runtimeCss).size).toBeGreaterThan(100);

      expect(
        cssCoverage(runtimeCss, builtCss, RUNTIME_SPELLING).missing,
      ).toEqual([]);
    },
    PAGE_TIMEOUT_MS,
  );
});

describe("every class written in a template or a script", () => {
  let tokens: Array<string>;
  let tokensCss: string;

  beforeAll(async () => {
    const files: Array<string> = [
      ...listFiles(VIEWS_ROOT, ".ejs"),
      ...listFiles(path.join(__dirname, "..", "Static", "js"), ".js"),
      ...CommonContentFiles,
    ];

    tokens = Array.from(
      new Set(
        files.flatMap((file: string): Array<string> => {
          return classTokensInSource(fs.readFileSync(file, "utf8"));
        }),
      ),
    );
    tokensCss = await tailwindCssFor(tokens);
  }, PAGE_TIMEOUT_MS);

  test("reads thousands of them", () => {
    expect(tokens.length).toBeGreaterThan(2000);
  });

  test("has its rules in the built stylesheet, whichever branch writes it", () => {
    /*
     * Pages render one branch of each conditional, and most templates are
     * not rendered above at all; this reads every class attribute, every
     * string an EJS tag can put in one, and every class a script adds.
     */
    const utilities: Set<string> = classesSelectedBy(tokensCss);
    const unstyled: Array<string> = tokens.filter((token: string): boolean => {
      return utilities.has(token) && !builtClasses.has(token);
    });

    expect(unstyled).toEqual([]);
    expect(cssCoverage(tokensCss, builtCss).missing).toEqual([]);
  });

  test("in the same order", () => {
    expect(cssCoverage(tokensCss, builtCss).outOfOrder).toEqual([]);
  });

  test(
    "sizes and spaces only in steps Tailwind has: a class such as h-4.5 draws nothing",
    async () => {
      /*
       * Tailwind 3.4.5's spacing scale has the half steps 0.5 to 3.5 and
       * then whole steps, so h-4.5 generates no rule at all: the menus'
       * featured icons were drawn at the size of their box instead of 18px.
       * A size the scale lacks is written as an arbitrary value, such as
       * h-[18px]. Each step is checked without its variants ("sm:", "hover:"),
       * so this reads the step, whatever variant is in front of it.
       */
      const steps: Array<string> = Array.from(
        new Set(
          tokens
            .filter((token: string): boolean => {
              return SPACING_STEP.test(token);
            })
            .map((token: string): string => {
              return token.slice(token.lastIndexOf(":") + 1);
            }),
        ),
      );
      const generated: Set<string> = classesSelectedBy(
        await tailwindCssFor(steps),
      );

      expect(steps.length).toBeGreaterThan(100);
      expect(
        steps.filter((step: string): boolean => {
          return !generated.has(step);
        }),
      ).toEqual([]);
    },
    PAGE_TIMEOUT_MS,
  );

  test("the step check reads a class the scale lacks, and passes the ones it has", () => {
    for (const token of ["h-4.5", "sm:w-4.5", "-mt-4.5", "gap-x-2.5", "h-4"]) {
      expect([token, SPACING_STEP.test(token)]).toEqual([token, true]);
    }

    for (const token of ["h-[18px]", "max-w-3xl", "w-full", "ag-card"]) {
      expect([token, SPACING_STEP.test(token)]).toEqual([token, false]);
    }
  });
});

describe("the safelist", () => {
  test(
    "names only real Tailwind classes, and the build has them all",
    async () => {
      const listed: Array<string> = [...DynamicClasses, ...BlogMarkdownClasses];
      const generated: Set<string> = classesSelectedBy(
        await tailwindCssFor(listed),
      );

      expect(
        listed.filter((className: string): boolean => {
          return !generated.has(className);
        }),
      ).toEqual([]);
      expect(
        listed.filter((className: string): boolean => {
          return !builtClasses.has(className);
        }),
      ).toEqual([]);
    },
    PAGE_TIMEOUT_MS,
  );

  test.each([
    ["the blog", MarkdownContentType.Blog],
    ["the blog's validation summary", MarkdownContentType.BlogValidation],
  ])(
    "covers every class %s renderer writes",
    async (_name: string, contentType: MarkdownContentType) => {
      /*
       * Each kind of block once, through the real renderer: its classes,
       * table alignment's text-left/center/right among them, have to be in
       * BlogMarkdownClasses (language-* and the like are not Tailwind's).
       */
      const classes: Array<string> = classesOnPage(
        await Markdown.convertToHTML(KITCHEN_SINK_MARKDOWN, contentType),
      );
      const utilities: Set<string> = classesSelectedBy(
        await tailwindCssFor(classes),
      );

      expect(classes).toEqual(
        expect.arrayContaining(["text-left", "text-center", "text-right"]),
      );
      expect(
        classes.filter((className: string): boolean => {
          return (
            utilities.has(className) && !BlogMarkdownClasses.includes(className)
          );
        }),
      ).toEqual([]);
    },
    PAGE_TIMEOUT_MS,
  );

  test("a post's own HTML reaches no page: the renderer escapes it", async () => {
    /*
     * Why reading the blog's class attributes into the build is a
     * precaution rather than a necessity today.
     */
    const html: string = await Markdown.convertToHTML(
      '<div class="rounded-3xl p-7">Block</div>\n\nInline <span class="text-fuchsia-700">span</span>.',
      MarkdownContentType.Blog,
    );

    expect(classesOnPage(html)).not.toContain("rounded-3xl");
    expect(classesOnPage(html)).not.toContain("text-fuchsia-700");
    expect(html).toContain("&lt;div class=&quot;rounded-3xl p-7&quot;&gt;");
  });
});
