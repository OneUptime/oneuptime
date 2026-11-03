/*
 * Builds the docs' and the API reference's Tailwind stylesheets (issue
 * #5615), so their pages link one file instead of generating their CSS in
 * the reader's browser with the Tailwind Play CDN runtime:
 *
 *   npm run build-docs-css             (from packages/App; the image runs it)
 *
 * Each site's stylesheet is what the runtime generated in the browser, for
 * every class any of the site's pages can carry rather than for the one page
 * in front of it: the same Tailwind (3.4.5) with the site's own config
 * (Utils/DocsTailwind.ts) over the same input, then the same Autoprefixer
 * pass the runtime made, for the browsers it made it for - the recipe of the
 * marketing site's build (packages/Home/Scripts/BuildTailwindCss.ts).
 *
 * The output is FeatureSet/<site>/build/tailwind/tailwind.<hash>.css, found
 * by Utils/TailwindStylesheet.ts when the App starts.
 */
import { DocsTailwindSite, DocsTailwindSites } from "../Utils/DocsTailwind";
import { getTailwindStylesheetFileName } from "../Utils/TailwindStylesheet";
import autoprefixer from "autoprefixer";
import fs from "fs";
import path from "path";
import postcss, { Result } from "postcss";
import tailwindcss from "tailwindcss";
import zlib from "zlib";

// The runtime's input: Tailwind's three layers, nothing else.
export const TailwindInputCss: string =
  "@tailwind base;@tailwind components;@tailwind utilities;";

/*
 * The browsers the runtime prefixed for: Autoprefixer's `defaults` as its
 * bundled caniuse data resolved them, pinned as the marketing site's build
 * pins them (RuntimeBrowsers in packages/Home/Scripts/BuildTailwindCss.ts).
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

export const compileSiteTailwindCss: (
  site: DocsTailwindSite,
) => Promise<string> = async (site: DocsTailwindSite): Promise<string> => {
  // The browsers are named above, so how old caniuse's data is does not matter.
  process.env["BROWSERSLIST_IGNORE_OLD_DATA"] = "true";

  const result: Result = await postcss([
    tailwindcss(site.config),
    autoprefixer({ overrideBrowserslist: RuntimeBrowsers, remove: false }),
  ]).process(TailwindInputCss, { from: undefined });

  return result.css;
};

/*
 * Replaces `directory` with one holding just this stylesheet, written beside
 * it and moved into place, so a server looking at the directory never finds
 * half a build, or two.
 */
export const writeSiteStylesheet: (data: {
  css: string;
  directory: string;
}) => string = (data: { css: string; directory: string }): string => {
  const fileName: string = getTailwindStylesheetFileName(data.css);
  const staging: string = `${data.directory}.partial-${process.pid}`;

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, fileName), data.css);
  fs.rmSync(data.directory, { recursive: true, force: true });
  fs.renameSync(staging, data.directory);

  return path.join(data.directory, fileName);
};

const main: () => Promise<void> = async (): Promise<void> => {
  for (const site of DocsTailwindSites) {
    const css: string = await compileSiteTailwindCss(site);
    const file: string = writeSiteStylesheet({
      css,
      directory: site.directory,
    });

    process.stdout.write(
      `Wrote ${file}: ${css.length} bytes, ${zlib.gzipSync(css).length} gzipped.\n`,
    );
  }
};

if (require.main === module) {
  main().catch((error: Error): void => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
