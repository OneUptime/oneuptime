import Reviews from "../../Utils/Reviews";
import Pricing from "../../Utils/Pricing";
import ProductCompare, {
  getProductCompareSlugs,
} from "../../Utils/ProductCompare";
import { getSelfHostedContent } from "../../Utils/SelfHosted";
import { getResellersPageContent } from "../../Utils/Resellers";
import { getAirGappedContent } from "../../Utils/AirGapped";
import { getCloudMarketplacesContent } from "../../Utils/CloudMarketplaces";
import { getGuidePageContent } from "../../Utils/Integrations/OpenTelemetry/GuidePage";
import {
  getFrameworkGuideCards,
  getIntegrationsIndexContent,
} from "../../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import { getPageSEO, PageSEOData } from "../../Utils/PageSEO";
import type { BlogPost, BlogPostContributor } from "../../Utils/BlogPost";
import BlogTag from "../../Utils/BlogTag";
import {
  RuntimeBrowsers,
  TailwindInputCss,
  collapseCssWhitespace,
} from "../../Scripts/BuildTailwindCss";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import autoprefixer from "autoprefixer";
import ejs from "ejs";
import fs from "fs";
import { JSDOM, VirtualConsole } from "jsdom";
import path from "path";
import postcss, {
  AtRule,
  ChildNode,
  Container,
  Declaration,
  Document,
  Result,
  Root,
  Rule,
} from "postcss";
import tailwindcss from "tailwindcss";

/*
 * Pages of the marketing site rendered from the real templates with the
 * locals Routes.ts and API/BlogAPI.ts hand them, and the CSS arithmetic the
 * Tailwind tests compare them with.
 */

export const VIEWS_ROOT: string = path.join(__dirname, "..", "..", "Views");
export const HOME_URL: string = "https://oneuptime.com";

export const renderView: (
  template: string,
  locals: Record<string, unknown>,
) => Promise<string> = async (
  template: string,
  locals: Record<string, unknown>,
): Promise<string> => {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, template),
    { homeUrl: HOME_URL, ...locals },
    { views: [VIEWS_ROOT] },
  )) as string;
};

export const seoFor: (
  pagePath: string,
) => PageSEOData & { fullCanonicalUrl: string } = (
  pagePath: string,
): PageSEOData & { fullCanonicalUrl: string } => {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
};

/*
 * A post that uses every block and inline element the blog's renderer has a
 * class for: headings of every level, paragraphs, emphasis, lists (one
 * starting past 1), a quote, code (with and without a language), a table
 * with every alignment, an image, every kind of link, and a rule.
 */
export const KITCHEN_SINK_MARKDOWN: string = [
  "# Heading one",
  "",
  "A paragraph with **strong**, _emphasis_, ~~struck~~ and `inline code` text.",
  "",
  "## Heading two",
  "",
  "### Heading three",
  "",
  "#### Heading four",
  "",
  "##### Heading five",
  "",
  "###### Heading six",
  "",
  "- One",
  "- Two",
  "",
  "1. First",
  "2. Second",
  "",
  "3. Third, starting at three",
  "4. Fourth",
  "",
  "> A quote, with a [link inside](https://example.com/quoted).",
  "",
  "```bash",
  'echo "hello"',
  "```",
  "",
  "```",
  "no language",
  "```",
  "",
  "| Left | Center | Right | Plain |",
  "|:-----|:------:|------:|-------|",
  "| a | b | c | d |",
  "",
  "![An image](/blog/post/example/image.png)",
  "",
  "Links: [internal](/pricing), [external](https://example.com),",
  "[hash](#heading-two), [mail](mailto:hello@oneuptime.com) and [phone](tel:+15555550100).",
  "",
  "---",
  "",
  "The end.",
].join("\n");

export const blogPostWith: (htmlBody: string) => BlogPost = (
  htmlBody: string,
): BlogPost => {
  const fileName: string = "2026-10-13-every-block";
  const contributor: (username: string) => BlogPostContributor = (
    username: string,
  ): BlogPostContributor => {
    return {
      username: username,
      name: username,
      githubUrl: `https://github.com/${username}`,
      profileImageUrl: `https://avatars.githubusercontent.com/${username}`,
    };
  };

  return {
    title: "Every block the blog renders",
    description: "A post that uses every element.",
    formattedPostDate: "October 13, 2026",
    fileName: fileName,
    tags: ["Observability", "Monitoring"],
    postDate: "2026-10-13",
    blogUrl: `${HOME_URL}/blog/post/${fileName}/view`,
    contributors: [contributor("someone"), contributor("someone-else")],
    htmlBody: htmlBody,
    markdownBody: KITCHEN_SINK_MARKDOWN,
    socialMediaImageUrl: `${HOME_URL}/blog/post/${fileName}/social-media.png`,
    author: {
      username: "someone",
      githubUrl: "https://github.com/someone",
      profileImageUrl: "https://avatars.githubusercontent.com/someone",
      name: "Some One",
    },
    validationStatus: "validated",
    validationDate: "October 13, 2026",
  };
};

export interface MarketingPage {
  name: string;
  template: string;
  locals: () => Promise<Record<string, unknown>>;
}

// The first comparison page with the most competitor pricing tiers.
const compareProduct: () => string = (): string => {
  const slugs: Array<string> = getProductCompareSlugs();
  let best: string = slugs[0]!;

  for (const slug of slugs) {
    const tiers: number = (ProductCompare(slug).competitorPricingTiers || [])
      .length;
    const bestTiers: number = (
      ProductCompare(best).competitorPricingTiers || []
    ).length;

    if (tiers > bestTiers) {
      best = slug;
    }
  }

  return best;
};

export const MARKETING_PAGES: Array<MarketingPage> = [
  {
    name: "the homepage",
    template: "index.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        ...Reviews,
        seo: seoFor("/"),
        githubStars: "7.4k",
        githubContributors: "120",
        githubCommits: "25k",
        airGapped: getAirGappedContent(),
      };
    },
  },
  {
    name: "pricing",
    template: "pricing.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      // The locals Routes.ts hands the page.
      return {
        pricing: Pricing,
        enableGoogleTagManager: false,
        seo: seoFor("/pricing"),
        cloudMarketplaces: getCloudMarketplacesContent(),
      };
    },
  },
  {
    name: "a product page (monitoring)",
    template: "monitoring.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        enableGoogleTagManager: false,
        seo: seoFor("/product/monitoring"),
      };
    },
  },
  {
    name: "a comparison page",
    template: "product-compare.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      const slug: string = compareProduct();
      return {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        productConfig: ProductCompare(slug),
        onlyShowCompareTable: false,
        seo: seoFor(`/compare/${slug}`),
      };
    },
  },
  {
    name: "the demo page",
    template: "demo.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        support: false,
        enableGoogleTagManager: false,
        footerCards: false,
        cta: false,
        blackLogo: true,
        requestDemoCta: false,
        seo: seoFor("/enterprise/demo"),
        ...Reviews,
      };
    },
  },
  {
    name: "a legal page (terms)",
    template: "legal.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "terms",
        requestDemoCta: false,
        seo: seoFor("/legal/terms"),
      };
    },
  },
  {
    name: "the 404 page",
    template: "not-found.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      // NotFoundUtil.renderNotFound's locals.
      return {
        footerCards: false,
        support: false,
        cta: false,
        blackLogo: false,
        requestDemoCta: false,
      };
    },
  },
  {
    name: "a blog post",
    template: path.join("Blog", "Post.ejs"),
    locals: async (): Promise<Record<string, unknown>> => {
      // Through the real renderer, as BlogPostUtil.getBlogPostFromFile does.
      const htmlBody: string = await Markdown.convertToHTML(
        KITCHEN_SINK_MARKDOWN,
        MarkdownContentType.Blog,
      );
      const blogPost: BlogPost = blogPostWith(htmlBody);
      return {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPost: blogPost,
        blogTagPath: BlogTag.getPagePathOfTag,
        enableGoogleTagManager: false,
        seo: { fullCanonicalUrl: blogPost.blogUrl },
      };
    },
  },
  {
    name: "the self-hosted page",
    template: "self-hosted.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: false,
        blackLogo: false,
        requestDemoCta: true,
        selfHosted: getSelfHostedContent(),
        seo: seoFor("/enterprise/self-hosted"),
      };
    },
  },
  {
    name: "the resellers page",
    template: "resellers.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      // The locals Routes.ts hands the page.
      return {
        enableGoogleTagManager: false,
        seo: seoFor("/resellers"),
        resellers: getResellersPageContent({
          inquiryInbox: "sales@oneuptime.com",
        }),
      };
    },
  },
  {
    name: "the air-gapped page",
    template: "air-gapped.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      // The locals Routes.ts hands the page.
      return {
        enableGoogleTagManager: false,
        seo: seoFor("/enterprise/air-gapped"),
        airGapped: getAirGappedContent(),
      };
    },
  },
  {
    name: "the integrations index",
    template: "integrations/index.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      // The locals Routes.ts hands the page.
      return {
        enableGoogleTagManager: false,
        seo: seoFor("/integrations"),
        integrations: getIntegrationsIndexContent(HOME_URL),
        integrationsScript: "/js/integrations.js",
      };
    },
  },
  {
    name: "an OpenTelemetry guide (Express)",
    template: "integrations/opentelemetry-guide.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        enableGoogleTagManager: false,
        seo: seoFor("/integrations/opentelemetry/express"),
        guide: getGuidePageContent("express", HOME_URL),
        integrationsScript: "/js/integrations.js",
      };
    },
  },
  {
    name: "a browser OpenTelemetry guide (React)",
    template: "integrations/opentelemetry-guide.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        enableGoogleTagManager: false,
        seo: seoFor("/integrations/opentelemetry/react"),
        guide: getGuidePageContent("react", HOME_URL),
        integrationsScript: "/js/integrations.js",
      };
    },
  },
  {
    name: "a product page with its framework guides (traces)",
    template: "traces.ejs",
    locals: async (): Promise<Record<string, unknown>> => {
      return {
        enableGoogleTagManager: false,
        seo: seoFor("/product/traces"),
        frameworkGuides: getFrameworkGuideCards(),
      };
    },
  },
];

export const renderMarketingPage: (
  page: MarketingPage,
  extraLocals?: Record<string, unknown>,
) => Promise<string> = async (
  page: MarketingPage,
  extraLocals: Record<string, unknown> = {},
): Promise<string> => {
  return renderView(page.template, {
    ...(await page.locals()),
    ...extraLocals,
  });
};

/*
 * Every class on the page, in document order, read the way the Play CDN
 * runtime read them: the classList of every element with a class attribute.
 */
export const classesOnPage: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const dom: JSDOM = new JSDOM(html);
  const classes: Set<string> = new Set<string>();

  for (const element of Array.from(
    dom.window.document.querySelectorAll("[class]"),
  )) {
    for (const token of Array.from(element.classList)) {
      classes.add(token);
    }
  }

  dom.window.close();
  return Array.from(classes);
};

/*
 * The CSS Tailwind's own JIT generates for exactly these classes - what the
 * runtime did on a page carrying them: the default config, the classes
 * split on spaces as the runtime split them, and the runtime's Autoprefixer
 * pass.
 */
export const tailwindCssFor: (
  classes: Array<string>,
) => Promise<string> = async (classes: Array<string>): Promise<string> => {
  const result: Result = await postcss([
    tailwindcss({
      content: {
        files: [{ raw: classes.join(" "), extension: "html" }],
        extract: {
          html: (content: string): Array<string> => {
            return content.split(" ");
          },
        },
      },
      theme: {},
      plugins: [],
    }),
    autoprefixer({ overrideBrowserslist: RuntimeBrowsers, remove: false }),
  ]).process(TailwindInputCss, { from: undefined });

  return result.css;
};

const EJS_TAG: RegExp = /<%[\s\S]*?%>/g;
const CLASS_ATTRIBUTE_START: RegExp = /(?<![\w:.-])class\s*=\s*(["'])/g;
const STRING_LITERAL: RegExp = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
// include('icon', { iconClass: 'h-4 w-4' }), avatarSize: 'h-8 w-8', ...
const CLASS_NAMED_VALUE: RegExp =
  /\b\w*(?:class|size)\w*\s*[:=]\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gi;
// classList.add('a', 'b'), .toggle('a', on), .replace('a', 'b')
const CLASS_LIST_CALL: RegExp =
  /\.classList\.(?:add|remove|toggle|replace)\(([^)]*)\)/g;
// el.className = 'a b' + (on ? 'c' : 'd'), el.setAttribute('class', 'a b')
const CLASS_NAME_ASSIGNMENT: RegExp =
  /\.className\s*\+?=\s*([^;\n]*)|setAttribute\(\s*['"]class['"]\s*,([^)]*)\)/g;
// Where an EJS tag stood, so the text glued to it is not read as a class.
const EJS_PLACEHOLDER: string = "\u0000";
// An EJS tag's place in a class attribute, numbered: \uE000<n>\uE001.
const TAG_PLACEHOLDER: RegExp = /\uE000\d+\uE001/g;
// <%= and <%- write text into the page; <% ... %> does not.
const WRITES_TEXT: RegExp = /^<%[=-]/;
// A character a class name holds unescaped.
const CLASS_NAME_CHARACTER: RegExp = /[\w-]/;

const tokensOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return text.split(/\s+/).filter((token: string): boolean => {
    return Boolean(token) && !token.includes(EJS_PLACEHOLDER);
  });
};

const literalsIn: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return Array.from(
    code.matchAll(STRING_LITERAL),
    (match: RegExpMatchArray) => {
      return match[2] || "";
    },
  );
};

/*
 * Every class a template can put on an element, read from its source so that
 * every branch counts, not only the one a render takes: the static text of
 * each class attribute and the string literals in its EJS tags, class text
 * handed to an include, and the classes its scripts add, toggle or assign.
 * A class assembled from a variable is not here - DynamicClasses in
 * tailwind.config.ts lists those.
 */
export const classTokensInSource: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const tokens: Set<string> = new Set<string>();
  const add: (text: string) => void = (text: string): void => {
    for (const token of tokensOf(text)) {
      tokens.add(token);
    }
  };

  const attributeStart: RegExp = new RegExp(CLASS_ATTRIBUTE_START.source, "g");

  for (
    let match: RegExpExecArray | null = attributeStart.exec(source);
    match !== null;
    match = attributeStart.exec(source)
  ) {
    const quote: string = match[1]!;
    let index: number = attributeStart.lastIndex;
    let value: string = "";

    while (index < source.length && source[index] !== quote) {
      if (source.startsWith("<%", index)) {
        const tagEnd: number = source.indexOf("%>", index + 2);
        const stop: number = tagEnd === -1 ? source.length : tagEnd + 2;
        value += source.slice(index, stop);
        index = stop;
        continue;
      }

      value += source[index];
      index++;
    }

    attributeStart.lastIndex = index + 1;
    add(value.replace(EJS_TAG, EJS_PLACEHOLDER));

    for (const tag of value.match(EJS_TAG) || []) {
      for (const literal of literalsIn(tag)) {
        add(literal);
      }
    }
  }

  for (const tag of source.match(EJS_TAG) || []) {
    for (const match of tag.matchAll(CLASS_NAMED_VALUE)) {
      add(match[2] || "");
    }
  }

  for (const match of source.matchAll(CLASS_LIST_CALL)) {
    for (const literal of literalsIn(match[1] || "")) {
      add(literal);
    }
  }

  for (const match of source.matchAll(CLASS_NAME_ASSIGNMENT)) {
    for (const literal of literalsIn(match[1] || match[2] || "")) {
      add(literal);
    }
  }

  return Array.from(tokens);
};

/*
 * The pieces of class attributes where an EJS tag's output is glued to class
 * text - `bg-<%= tier.accent %>-50`. Tailwind cannot find such a class in
 * any file; each has to be in DynamicClasses.
 */
export const gluedClassText: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const found: Array<string> = [];
  const attributeStart: RegExp = new RegExp(CLASS_ATTRIBUTE_START.source, "g");

  for (
    let match: RegExpExecArray | null = attributeStart.exec(source);
    match !== null;
    match = attributeStart.exec(source)
  ) {
    const quote: string = match[1]!;
    const tags: Array<string> = [];
    let index: number = attributeStart.lastIndex;
    let value: string = "";

    while (index < source.length && source[index] !== quote) {
      if (source.startsWith("<%", index)) {
        const tagEnd: number = source.indexOf("%>", index + 2);
        const stop: number = tagEnd === -1 ? source.length : tagEnd + 2;
        tags.push(source.slice(index, stop));
        value += `\uE000${tags.length - 1}\uE001`;
        index = stop;
        continue;
      }

      value += source[index];
      index++;
    }

    attributeStart.lastIndex = index + 1;

    const tagAt: (placeholder: string) => string = (
      placeholder: string,
    ): string => {
      return tags[Number(placeholder.slice(1, -1))] || "";
    };

    for (const token of value.split(/\s+/)) {
      const placeholders: Array<string> = token.match(TAG_PLACEHOLDER) || [];
      // <%= and <%- write text; <% if (...) { %> around a class does not.
      const writesText: boolean = placeholders.some(
        (placeholder: string): boolean => {
          return WRITES_TEXT.test(tagAt(placeholder));
        },
      );
      const classText: string = token.replace(TAG_PLACEHOLDER, "");

      if (writesText && classText.length > 0) {
        found.push(
          token.replace(TAG_PLACEHOLDER, (placeholder: string): string => {
            return tagAt(placeholder).replace(/\s+/g, " ");
          }),
        );
      }
    }
  }

  return found;
};

export const listFiles: (
  directory: string,
  extension: string,
) => Array<string> = (directory: string, extension: string): Array<string> => {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listFiles(entryPath, extension);
      }

      return entry.name.endsWith(extension) ? [entryPath] : [];
    })
    .sort();
};

export const TAILWIND_RUNTIME_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Server",
  "Static",
  "Vendor",
  "tailwind",
  "tailwind-3.4.5.js",
);

/*
 * The CSS the Play CDN runtime itself generates for a page: the vendored
 * tailwind-3.4.5.js the site used to load, run in jsdom over the page. It
 * waits for the body, generates the CSS for every class in the document,
 * and appends it to <head> as a <style>; this returns that <style>'s text.
 */
export const runtimeCssFor: (html: string) => Promise<string> = async (
  html: string,
): Promise<string> => {
  // The page's own scripts are not run; nothing but the runtime is.
  const dom: JSDOM = new JSDOM(html, {
    runScripts: "outside-only",
    virtualConsole: new VirtualConsole(),
  });
  const head: HTMLHeadElement = dom.window.document.head;
  const stylesBefore: number = head.querySelectorAll("style").length;

  dom.window.eval(fs.readFileSync(TAILWIND_RUNTIME_PATH, "utf8"));
  // The runtime generates from a MutationObserver; give it a mutation.
  dom.window.document.body.appendChild(dom.window.document.createElement("i"));

  for (let attempt: number = 0; attempt < 6000; attempt++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });

    const styles: Array<HTMLStyleElement> = Array.from(
      head.querySelectorAll("style"),
    );

    if (styles.length > stylesBefore) {
      const generated: string = styles[styles.length - 1]!.textContent || "";

      if (generated.includes("tailwindcss")) {
        /*
         * The window is left open: closing it fires the runtime's observer
         * against a document that is gone.
         */
        return generated;
      }
    }
  }

  throw new Error("The Tailwind runtime generated no CSS in five minutes");
};

/*
 * Every class name a stylesheet's selectors name, unescaped: `.hover\:bg-gray-50:hover`
 * names "hover:bg-gray-50". A token Tailwind turned into a rule is in here;
 * one it does not know (a page's own class, `language-bash`) is not.
 */
export const classesSelectedBy: (css: string) => Set<string> = (
  css: string,
): Set<string> => {
  const names: Set<string> = new Set<string>();

  postcss.parse(css).walkRules((rule: Rule): void => {
    const selector: string = rule.selector;

    for (let index: number = 0; index < selector.length; index++) {
      if (selector[index] !== ".") {
        continue;
      }

      let name: string = "";
      let cursor: number = index + 1;

      while (cursor < selector.length) {
        const character: string = selector.charAt(cursor);

        if (character === "\\") {
          // A hex escape (\32 ) or one escaped character (\:).
          const hex: RegExpMatchArray | null = selector
            .slice(cursor + 1)
            .match(/^([0-9a-fA-F]{1,6})\s?/);

          if (hex) {
            name += String.fromCodePoint(parseInt(hex[1]!, 16));
            cursor += 1 + hex[0].length;
          } else {
            name += selector.charAt(cursor + 1);
            cursor += 2;
          }

          continue;
        }

        if (
          CLASS_NAME_CHARACTER.test(character) ||
          character.charCodeAt(0) > 127
        ) {
          name += character;
          cursor++;
          continue;
        }

        break;
      }

      if (name) {
        names.add(name);
      }

      index = cursor - 1;
    }
  });

  return names;
};

/*
 * A stylesheet as the blocks that hold declarations - rules, and at-rules
 * such as @font-face - in document order. A block's key is where it sits
 * (its enclosing at-rules) and what it selects; its atoms are one
 * "context | selector | property:value" for each selector and declaration,
 * so two stylesheets compare whatever their whitespace or how their
 * selectors are grouped.
 */
export interface CssBlock {
  key: string;
  atoms: Array<string>;
}

export interface CssNormalization {
  selector?: (selector: string) => string;
  declaration?: (property: string, value: string) => string | null;
}

const contextOf: (node: ChildNode) => string = (node: ChildNode): string => {
  const chain: Array<string> = [];
  let parent: Container | Document | undefined = node.parent;

  while (parent && parent.type !== "root" && parent.type !== "document") {
    if (parent.type === "atrule") {
      const atRule: AtRule = parent as AtRule;
      chain.unshift(`@${atRule.name} ${collapseCssWhitespace(atRule.params)}`);
    }
    parent = (parent as ChildNode).parent;
  }

  return chain.join(" ");
};

export const cssBlocks: (
  css: string,
  normalization?: CssNormalization,
) => Array<CssBlock> = (
  css: string,
  normalization: CssNormalization = {},
): Array<CssBlock> => {
  const root: Root = postcss.parse(css);
  const blocks: Array<CssBlock> = [];
  const normalizeSelector: (selector: string) => string =
    normalization.selector ||
    ((selector: string): string => {
      return selector;
    });

  const visit: (container: Container) => void = (
    container: Container,
  ): void => {
    const declarations: Array<Declaration> = (container.nodes || []).filter(
      (node: ChildNode): boolean => {
        return node.type === "decl";
      },
    ) as Array<Declaration>;

    if (declarations.length > 0 && container.type !== "root") {
      const node: ChildNode = container as unknown as ChildNode;
      const context: string = contextOf(node);
      const selectors: Array<string> =
        node.type === "rule"
          ? node.selectors.map((selector: string): string => {
              return normalizeSelector(collapseCssWhitespace(selector));
            })
          : [
              `@${(node as AtRule).name} ${collapseCssWhitespace((node as AtRule).params)}`,
            ];
      const atoms: Array<string> = [];

      for (const declaration of declarations) {
        const value: string = collapseCssWhitespace(declaration.value);
        const written: string | null = normalization.declaration
          ? normalization.declaration(declaration.prop, value)
          : `${declaration.prop}:${value}`;

        if (written === null) {
          continue;
        }

        for (const selector of selectors) {
          atoms.push(
            `${context} | ${selector} | ${written}${declaration.important ? " !important" : ""}`,
          );
        }
      }

      blocks.push({
        key: `${context} | ${selectors.slice().sort().join(",")}`,
        atoms: atoms,
      });
    }

    for (const node of container.nodes || []) {
      if (node.type === "rule" || node.type === "atrule") {
        if ((node as Container).nodes) {
          visit(node as Container);
        }
      }
    }
  };

  visit(root);
  return blocks;
};

export const cssAtoms: (
  css: string,
  normalization?: CssNormalization,
) => Set<string> = (
  css: string,
  normalization: CssNormalization = {},
): Set<string> => {
  return new Set<string>(
    cssBlocks(css, normalization).flatMap((block: CssBlock): Array<string> => {
      return block.atoms;
    }),
  );
};

/*
 * The atoms of `part` that `whole` does not have, and the blocks of `part`
 * that `whole` has in another order. Empty both ways means that wherever
 * `part`'s rules applied, `whole` applies the same declarations with the
 * same precedence between them.
 */
export interface CssCoverage {
  missing: Array<string>;
  outOfOrder: Array<string>;
}

export const cssCoverage: (
  part: string,
  whole: string,
  normalization?: CssNormalization,
) => CssCoverage = (
  part: string,
  whole: string,
  normalization: CssNormalization = {},
): CssCoverage => {
  const partBlocks: Array<CssBlock> = cssBlocks(part, normalization);
  const wholeBlocks: Array<CssBlock> = cssBlocks(whole, normalization);
  const wholeAtoms: Set<string> = new Set<string>(
    wholeBlocks.flatMap((block: CssBlock): Array<string> => {
      return block.atoms;
    }),
  );

  const missing: Array<string> = partBlocks
    .flatMap((block: CssBlock): Array<string> => {
      return block.atoms;
    })
    .filter((atom: string): boolean => {
      return !wholeAtoms.has(atom);
    });

  /*
   * The n-th block with a key in `part` is the n-th with that key in
   * `whole`; their positions in `whole` have to rise as they do in `part`.
   */
  const positions: Map<string, Array<number>> = new Map<
    string,
    Array<number>
  >();

  wholeBlocks.forEach((block: CssBlock, index: number): void => {
    const list: Array<number> = positions.get(block.key) || [];
    list.push(index);
    positions.set(block.key, list);
  });

  const seen: Map<string, number> = new Map<string, number>();
  const outOfOrder: Array<string> = [];
  let previous: number = -1;
  let previousKey: string = "(start)";

  for (const block of partBlocks) {
    const occurrence: number = seen.get(block.key) || 0;
    seen.set(block.key, occurrence + 1);

    const position: number | undefined = (positions.get(block.key) || [])[
      occurrence
    ];

    if (position === undefined) {
      // Reported as missing atoms already, unless it holds none.
      continue;
    }

    if (position <= previous) {
      outOfOrder.push(`${block.key} (after ${previousKey})`);
    }

    previous = position;
    previousKey = block.key;
  }

  return { missing: missing, outOfOrder: outOfOrder };
};
