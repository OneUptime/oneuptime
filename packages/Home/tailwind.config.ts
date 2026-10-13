import type { Config } from "tailwindcss";
import path from "path";
import { BlogRootPath } from "./Utils/Config";
import { ArchitectureTier, ArchitectureTiers } from "./Utils/SelfHosted";

/*
 * Tailwind for the marketing site, compiled when the image is built
 * (Scripts/BuildTailwindCss.ts, `npm run build:css`).
 *
 * The site used to build this CSS in every visitor's browser: head-basic.ejs
 * loaded the Tailwind Play CDN runtime (tailwind-3.4.5.js, ~684 KB) as a
 * render-blocking script, and it generated the rules for the classes it found
 * on the page. That runtime was given no configuration - no `tailwind.config`
 * on any page, no `?plugins=` - so it ran Tailwind 3.4.5's default theme with
 * no plugins, and this config does the same: `tailwindcss` is pinned to 3.4.5
 * in package.json, and there is no `theme` or `plugins` here on purpose.
 *
 * What changes is where the class names come from. The runtime read them
 * from the page in front of it; a build has to find every class any page can
 * carry, ahead of time, in the files that write them - `content` below. A
 * class assembled from pieces (`bg-<%= accent %>-50`) is in no file, so each
 * one is listed in `safelist`, next to the template that builds it.
 * Tests/TailwindBuild.test.ts renders the pages and holds the build to every
 * class on them.
 */

const HOME_ROOT: string = __dirname;
const COMMON_ROOT: string = path.join(HOME_ROOT, "..", "Common");

// Everything in this package that writes class names.
export const HomeContentFiles: Array<string> = [
  // Every page, partial and inline <script>.
  path.join(HOME_ROOT, "Views", "**", "*.ejs"),
  // Client scripts that add and remove classes after the page has loaded.
  path.join(HOME_ROOT, "Static", "js", "**", "*.js"),
  // Data and helpers the templates read class names from.
  path.join(HOME_ROOT, "Utils", "**", "*.ts"),
  path.join(HOME_ROOT, "API", "**", "*.ts"),
  path.join(HOME_ROOT, "Routes.ts"),
];

// Files outside this package whose markup ends up on its pages.
export const CommonContentFiles: Array<string> = [
  // The blog's Markdown renderer (getBlogRenderer, getBlogValidationRenderer).
  path.join(COMMON_ROOT, "Server", "Types", "Markdown.ts"),
  // Included by head-basic.ejs on every page.
  path.join(COMMON_ROOT, "Server", "Views", "Partials", "AnalyticsConsent.ejs"),
];

/*
 * The blog's posts are Markdown in a separate repository, cloned into the
 * image (Dockerfile.tpl) before this CSS is built, and turned into HTML when a
 * post is requested. The renderer's own classes come from Markdown.ts above.
 * A post could only add classes of its own through raw HTML, and today the
 * renderer escapes raw HTML (Markdown.convertToHTML sets `renderer.html` to
 * escapeHtml), so none reaches a page. The posts are read anyway, in case
 * that ever changes - only their class attributes, not their prose, which
 * would add a rule for every word that happens to be a utility name ("block",
 * "table", "hidden", ...).
 */
export const getBlogContentFiles: (blogRoot: string) => Array<string> = (
  blogRoot: string,
): Array<string> => {
  return [path.join(blogRoot, "posts", "*", "*.md")];
};

const CLASS_ATTRIBUTE: RegExp = /\bclass(?:Name)?\s*=\s*(["'])([^"'<>]*)\1/g;

/*
 * Every class token in the class attributes of a Markdown file, wherever
 * they are - fenced code included. Over-reading only costs bytes: a class in
 * a code sample adds a rule nothing uses. Under-reading would leave a post
 * unstyled.
 */
export const extractMarkdownClassAttributes: (
  markdown: string,
) => Array<string> = (markdown: string): Array<string> => {
  if (!markdown.includes("class")) {
    return [];
  }

  const tokens: Set<string> = new Set<string>();

  for (const match of markdown.matchAll(CLASS_ATTRIBUTE)) {
    for (const token of (match[2] || "").split(/\s+/)) {
      if (token) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens);
};

// Views/Partials/reviews.ejs hands each review one of these as glowColor.
export const ReviewGlowColors: Array<string> = [
  "emerald",
  "blue",
  "purple",
  "amber",
  "rose",
  "indigo",
];

/*
 * Classes no file spells out whole, each built by the template named beside
 * it. Keep this next to the template: a new piece of class text assembled
 * from a variable needs its own entry here.
 */
export const DynamicClasses: Array<string> = [
  /*
   * Views/self-hosted.ejs: bg-<%= tier.accent %>-50, text-<%= tier.accent %>-600,
   * ring-<%= tier.accent %>-100, for every accent in Utils/SelfHosted.ts.
   */
  ...ArchitectureTiers.flatMap((tier: ArchitectureTier): Array<string> => {
    return [
      `bg-${tier.accent}-50`,
      `text-${tier.accent}-600`,
      `ring-${tier.accent}-100`,
    ];
  }),
  // Views/Partials/review.ejs: hover:ring-<%= color %>-200.
  ...ReviewGlowColors.map((color: string): string => {
    return `hover:ring-${color}-200`;
  }),
  /*
   * Views/product-compare.ejs: lg:grid-cols-<%= tiers >= 4 ? '4' : tiers %>,
   * one column per competitor pricing tier, at most four.
   */
  "lg:grid-cols-1",
  "lg:grid-cols-2",
  "lg:grid-cols-3",
  "lg:grid-cols-4",
];

/*
 * Every class the blog's Markdown renderers put on a post and its validation
 * summary (Common/Server/Types/Markdown.ts: getBlogRenderer,
 * getBlogValidationRenderer). Markdown.ts is in `content` as well; this list
 * keeps a post styled even if the renderer moves, and covers the one class it
 * assembles: ` text-${flags.align}` on aligned table cells.
 * Tests/TailwindBuild.test.ts renders every kind of block through the real
 * renderers and fails on a class missing here.
 */
export const BlogMarkdownClasses: Array<string> = [
  // Aligned table cells, both renderers: text-${flags.align}.
  "text-left",
  "text-center",
  "text-right",
  // getBlogRenderer
  "mt-5",
  "mb-2",
  "leading-8",
  "text-gray-600",
  "text-lg",
  "p-4",
  "pt-1",
  "pb-1",
  "my-4",
  "border-s-4",
  "border-indigo-500",
  "rounded-md",
  "my-5",
  "mt-8",
  "text-4xl",
  "font-bold",
  "tracking-tight",
  "text-gray-800",
  "text-3xl",
  "text-2xl",
  "text-xl",
  "list-decimal",
  "list-disc",
  "pl-6",
  "my-6",
  "space-y-2",
  "text-gray-700",
  "leading-7",
  "overflow-x-auto",
  "my-8",
  "min-w-full",
  "border",
  "border-gray-200",
  "text-sm",
  "border-b",
  "last:border-b-0",
  "px-4",
  "py-2",
  "border-r",
  "last:border-r-0",
  "font-semibold",
  "bg-gray-50",
  "bg-gray-100",
  "px-1.5",
  "py-0.5",
  "text-pink-600",
  "my-12",
  "border-t",
  "italic",
  "line-through",
  "text-gray-400",
  "rounded-xl",
  "shadow-sm",
  "mt-2",
  "text-gray-500",
  "text-indigo-600",
  "underline",
  "underline-offset-2",
  "decoration-indigo-300",
  "hover:decoration-indigo-500",
  "hover:text-indigo-500",
  "transition-colors",
  // getBlogValidationRenderer
  "mt-7",
  "mb-3",
  "pt-6",
  "border-gray-100",
  "first:mt-0",
  "first:pt-0",
  "first:border-t-0",
  "text-[0.7rem]",
  "uppercase",
  "tracking-wider",
  "text-emerald-700",
  "mb-1.5",
  "text-gray-900",
  "mt-4",
  "mb-1",
  "my-2.5",
  "leading-relaxed",
  "pl-5",
  "my-2",
  "space-y-1.5",
  "marker:text-gray-400",
  "marker:text-gray-300",
  "pl-1",
  "my-3",
  "border-s-2",
  "border-emerald-200",
  "ps-3",
  "rounded",
  "text-[0.8125rem]",
  "font-mono",
  "break-words",
  "rounded-lg",
  "p-3",
  "text-xs",
  "px-3",
  "font-medium",
  "decoration-emerald-200",
  "hover:decoration-emerald-400",
];

export interface MarketingTailwindConfigOptions {
  // Where the blog repository is cloned; defaults to the image's location.
  blogRoot?: string | undefined;
}

export const createMarketingTailwindConfig: (
  options?: MarketingTailwindConfigOptions,
) => Config = (options: MarketingTailwindConfigOptions = {}): Config => {
  const blogRoot: string = options.blogRoot || BlogRootPath;

  return {
    content: {
      files: [
        ...HomeContentFiles,
        ...CommonContentFiles,
        ...getBlogContentFiles(blogRoot),
      ],
      transform: {
        md: (markdown: string): string => {
          return extractMarkdownClassAttributes(markdown).join(" ");
        },
      },
    },
    safelist: [...DynamicClasses, ...BlogMarkdownClasses],
    // Tailwind's defaults, as the Play CDN runtime ran them.
    theme: {},
    plugins: [],
  };
};

export default createMarketingTailwindConfig();
