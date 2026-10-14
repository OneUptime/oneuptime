/*
 * Compiles the marketing site's Tailwind CSS into one content-hashed file.
 *
 *   npm run build:css                     (from packages/Home)
 *   npm run build:css -- --require-blog   (the image build: fail without the blog)
 *
 * The output is build/tailwind/tailwind.<hash>.css (Utils/TailwindStylesheet.ts
 * finds it, Routes.ts serves it, every page links it). TAILWIND_BLOG_ROOT
 * points the build at a clone of the blog other than /usr/src/blog.
 *
 * It reproduces what the Tailwind Play CDN runtime generated in the browser,
 * for every class any page can carry rather than for the one page in front of
 * it: the same Tailwind (3.4.5, default theme, no plugins - tailwind.config.ts)
 * over the same input, then the same Autoprefixer pass the runtime made, for
 * the browsers it made it for. The only other step is taking out whitespace
 * and comments; values and selectors are left exactly as Tailwind wrote them.
 */
import { BlogRootPath } from "../Utils/Config";
import {
  TailwindStylesheet,
  TailwindStylesheetDirectory,
  getTailwindStylesheetFileName,
} from "../Utils/TailwindStylesheet";
import { createMarketingTailwindConfig } from "../tailwind.config";
import autoprefixer from "autoprefixer";
import fs from "fs";
import path from "path";
import postcss, { ChildNode, Result, Root } from "postcss";
import tailwindcss from "tailwindcss";
import zlib from "zlib";

// The runtime's input: Tailwind's three layers, nothing else.
export const TailwindInputCss: string =
  "@tailwind base;@tailwind components;@tailwind utilities;";

/*
 * The browsers the runtime prefixed for. It ran Autoprefixer with
 * `{ remove: false }` and no browserslist, so Autoprefixer's `defaults` -
 * which its bundled caniuse data resolved to these. Pinned rather than left
 * to `defaults`, so the prefixes a page has carried do not change with the
 * caniuse data installed: newer releases of these browsers need no prefix
 * these do not.
 */
export const RuntimeBrowsers: Array<string> = [
  "and_chr 114",
  "and_uc 15.5",
  "chrome 114",
  "chrome 113",
  "chrome 109",
  "edge 114",
  "firefox 114",
  "ios_saf 16.5",
  "ios_saf 16.4",
  "ios_saf 16.3",
  "ios_saf 16.1",
  "opera 99",
  "safari 16.5",
  "samsung 21",
];

export interface MarketingTailwindBuildOptions {
  // Where the blog repository is cloned; defaults to /usr/src/blog.
  blogRoot?: string | undefined;
}

// Tailwind and Autoprefixer, before whitespace comes out.
export const compileMarketingTailwindCss: (
  options?: MarketingTailwindBuildOptions,
) => Promise<string> = async (
  options: MarketingTailwindBuildOptions = {},
): Promise<string> => {
  /*
   * The browsers are named above, so how old the installed caniuse data is
   * does not matter here; without this Browserslist warns that it is old.
   */
  process.env["BROWSERSLIST_IGNORE_OLD_DATA"] = "true";

  const result: Result = await postcss([
    tailwindcss(createMarketingTailwindConfig({ blogRoot: options.blogRoot })),
    autoprefixer({ overrideBrowserslist: RuntimeBrowsers, remove: false }),
  ]).process(TailwindInputCss, { from: undefined });

  return result.css;
};

const WHITESPACE: RegExp = /\s/;

/*
 * `text` with every run of whitespace outside quotes and escapes made one
 * space, and none at either end. CSS reads any run of whitespace between
 * tokens as one, so this changes no value or selector.
 */
export const collapseCssWhitespace: (text: string) => string = (
  text: string,
): string => {
  let collapsed: string = "";
  let quote: string | null = null;
  let pendingSpace: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);

    if (quote) {
      collapsed += character;

      if (character === "\\" && index + 1 < text.length) {
        index++;
        collapsed += text.charAt(index);
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (WHITESPACE.test(character)) {
      pendingSpace = collapsed.length > 0;
      continue;
    }

    if (pendingSpace) {
      collapsed += " ";
      pendingSpace = false;
    }

    // An escaped character, whitespace included, is kept as written.
    if (character === "\\" && index + 1 < text.length) {
      index++;
      collapsed += character + text.charAt(index);
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    }

    collapsed += character;
  }

  return collapsed;
};

/*
 * The stylesheet without comments and without the whitespace between rules
 * and declarations. Tailwind's license comment (`/*! ... *\/`) stays. A full
 * minifier would also rewrite values (0.5rem to .5rem, colours, selector
 * order); compressed, that saves nothing over this, so it is left out.
 */
export const minifyCssWhitespace: (css: string) => string = (
  css: string,
): string => {
  const root: Root = postcss.parse(css);

  root.walk((node: ChildNode): void => {
    if (node.type === "comment") {
      if (!node.text.startsWith("!")) {
        node.remove();
        return;
      }

      node.raws.before = "";
      node.raws.left = "";
      node.raws.right = "";
      return;
    }

    node.raws.before = "";
    node.raws.after = "";

    if (node.type === "decl") {
      node.value = collapseCssWhitespace(node.value);
      delete node.raws.value;
      node.raws.between = ":";

      if (node.important) {
        node.raws.important = "!important";
      }

      return;
    }

    if (node.type === "rule") {
      node.selector = node.selectors
        .map((selector: string): string => {
          return collapseCssWhitespace(selector);
        })
        .join(",");
      node.raws.between = "";
      node.raws.semicolon = false;
      return;
    }

    if (node.type === "atrule") {
      node.params = collapseCssWhitespace(node.params);
      node.raws.afterName = node.params ? " " : "";
      node.raws.between = "";
      node.raws.semicolon = false;
    }
  });

  root.raws.after = "";
  root.raws.semicolon = false;

  return root.toString();
};

export const buildMarketingTailwindCss: (
  options?: MarketingTailwindBuildOptions,
) => Promise<string> = async (
  options: MarketingTailwindBuildOptions = {},
): Promise<string> => {
  return minifyCssWhitespace(await compileMarketingTailwindCss(options));
};

/*
 * Replaces `directory` with one holding just this stylesheet. It is written
 * beside the directory and moved into place, so a server looking at the
 * directory never finds half a build, or two.
 */
export const writeTailwindStylesheet: (
  css: string,
  directory?: string,
) => TailwindStylesheet = (
  css: string,
  directory: string = TailwindStylesheetDirectory,
): TailwindStylesheet => {
  const fileName: string = getTailwindStylesheetFileName(css);
  const staging: string = `${directory}.partial-${process.pid}`;

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, fileName), css);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.renameSync(staging, directory);

  return {
    fileName: fileName,
    filePath: path.join(directory, fileName),
    href: `/css/${fileName}`,
  };
};

// How many posts the blog clone at `blogRoot` holds, or null without one.
export const countBlogPosts: (blogRoot: string) => number | null = (
  blogRoot: string,
): number | null => {
  try {
    return fs
      .readdirSync(path.join(blogRoot, "posts"), { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return entry.isDirectory();
      }).length;
  } catch {
    return null;
  }
};

/*
 * What the build says about the blog it reads. With `required` (the image
 * build's --require-blog) a missing blog is an error: the image clones it
 * just before, so its absence means the Dockerfile's steps were reordered.
 */
export const describeBlog: (blogRoot: string, required: boolean) => string = (
  blogRoot: string,
  required: boolean,
): string => {
  const posts: number | null = countBlogPosts(blogRoot);

  if (posts === null) {
    if (required) {
      throw new Error(
        `No blog at ${blogRoot}: its posts are read into the stylesheet, so the blog has to be cloned before the stylesheet is built.`,
      );
    }

    return `Building Tailwind CSS without the blog (nothing at ${blogRoot}).`;
  }

  return `Building Tailwind CSS with ${posts} blog posts from ${blogRoot}.`;
};

const main: () => Promise<void> = async (): Promise<void> => {
  const blogRoot: string = process.env["TAILWIND_BLOG_ROOT"] || BlogRootPath;

  process.stdout.write(
    `${describeBlog(blogRoot, process.argv.includes("--require-blog"))}\n`,
  );

  const css: string = await buildMarketingTailwindCss({ blogRoot: blogRoot });
  const stylesheet: TailwindStylesheet = writeTailwindStylesheet(css);

  process.stdout.write(
    `Wrote ${stylesheet.filePath}: ${Buffer.byteLength(css)} bytes, ${zlib.gzipSync(css).length} gzipped.\n`,
  );
};

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
