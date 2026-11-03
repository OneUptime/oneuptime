import type { Config } from "tailwindcss";
import path from "path";

/*
 * The docs' and the API reference's Tailwind, built rather than generated in
 * the reader's browser (issue #5615). Both sites loaded the Tailwind Play CDN
 * runtime, which reads the page and writes its CSS on every visit: on a phone
 * it blocked rendering for about three quarters of a second, and every long
 * task on a docs page over 100 ms was its own. The App image now builds each
 * site's stylesheet (scripts/build-docs-tailwind.ts) and the pages link it,
 * as the marketing site's do (packages/Home/Scripts/BuildTailwindCss.ts).
 *
 * Each site's config is the one its views gave the runtime - the inline
 * `tailwind.config` in Docs/Views/Partials/Head.ejs and in
 * APIReference/views/partials/head.ejs - which the runtime still uses where
 * the stylesheet is not built (`npm run dev`). DocsTailwind.test.ts holds the
 * two to the same values. Its content is every file whose words can become a
 * class on the site's pages: the views and the scripts in them, the
 * TypeScript that writes markup, the docs' Markdown and the shared partials
 * the views include.
 */
export interface DocsTailwindSite {
  name: string;
  // Where the build writes the site's stylesheet, inside its feature set.
  directory: string;
  // The address the site serves it under: <hrefPrefix>tailwind.<hash>.css.
  hrefPrefix: string;
  config: Config;
}

const APP_FOLDER: string = path.resolve(__dirname, "..");
const DOCS: string = path.join(APP_FOLDER, "FeatureSet", "Docs");
const REFERENCE: string = path.join(APP_FOLDER, "FeatureSet", "APIReference");
const SHARED_PARTIALS: string = path.resolve(
  APP_FOLDER,
  "..",
  "Common",
  "Server",
  "Views",
  "Partials",
);

/*
 * The views write an ampersand in a class as &amp; - the reference's
 * `[&amp;>:first-child]:mt-0` - which the browser reads as the class
 * `[&>:first-child]:mt-0`, the one the runtime built its rule for. Tailwind
 * reads the files themselves, so it is handed their markup as a browser reads
 * it, with those entities decoded; without this the build left the rule out
 * and the reference's error and model pages drew taller.
 */
const MARKUP_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

export const decodeMarkupEntities: (content: string) => string = (
  content: string,
): string => {
  return content.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_entity: string, name: string): string => {
      return MARKUP_ENTITIES[name] || "";
    },
  );
};

const MARKUP_TRANSFORM: Record<string, (content: string) => string> = {
  ejs: decodeMarkupEntities,
  md: decodeMarkupEntities,
};

// The reference's colours: CSS variables holding "R G B" (styles.ejs).
function referenceColor(variableName: string): string {
  return `rgb(var(--ou-${variableName}) / <alpha-value>)`;
}

const REFERENCE_COLORS: Array<string> = [
  "canvas",
  "surface",
  "surface-soft",
  "surface-raised",
  "line",
  "line-soft",
  "ink",
  "ink-muted",
  "ink-subtle",
  "ink-faint",
  "accent",
  "accent-strong",
  "accent-soft",
  "accent-contrast",
  "success",
  "success-soft",
  "warn",
  "warn-soft",
  "danger",
  "danger-soft",
  "info",
  "info-soft",
];

export const DocsTailwindSites: ReadonlyArray<DocsTailwindSite> = [
  {
    name: "docs",
    directory: path.join(DOCS, "build", "tailwind"),
    hrefPrefix: "/docs/tailwind/",
    config: {
      content: {
        files: [
          path.join(DOCS, "Views", "**", "*.ejs"),
          path.join(DOCS, "**", "*.ts"),
          path.join(DOCS, "Content", "**", "*.md"),
          path.join(SHARED_PARTIALS, "**", "*.ejs"),
        ],
        transform: MARKUP_TRANSFORM,
      },
      darkMode: "selector",
      theme: {
        extend: {
          fontFamily: {
            sans: [
              "Inter",
              "ui-sans-serif",
              "system-ui",
              "-apple-system",
              "BlinkMacSystemFont",
              '"Segoe UI"',
              "Roboto",
              '"Helvetica Neue"',
              "Arial",
              "sans-serif",
            ],
            display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
            mono: [
              '"JetBrains Mono"',
              "ui-monospace",
              "SFMono-Regular",
              "Menlo",
              "Monaco",
              "Consolas",
              "monospace",
            ],
          },
          maxWidth: {
            "8xl": "90rem",
          },
        },
      },
    },
  },
  {
    name: "reference",
    directory: path.join(REFERENCE, "build", "tailwind"),
    hrefPrefix: "/reference/tailwind/",
    config: {
      content: {
        files: [
          path.join(REFERENCE, "views", "**", "*.ejs"),
          path.join(REFERENCE, "**", "*.ts"),
          path.join(SHARED_PARTIALS, "**", "*.ejs"),
        ],
        transform: MARKUP_TRANSFORM,
      },
      darkMode: "class",
      theme: {
        extend: {
          colors: Object.fromEntries(
            REFERENCE_COLORS.map((name: string): [string, string] => {
              return [name, referenceColor(name)];
            }),
          ),
          fontFamily: {
            sans: [
              "Inter",
              "ui-sans-serif",
              "system-ui",
              "-apple-system",
              "BlinkMacSystemFont",
              '"Segoe UI"',
              "Roboto",
              "sans-serif",
            ],
            mono: [
              '"JetBrains Mono"',
              "ui-monospace",
              "SFMono-Regular",
              "Menlo",
              "Monaco",
              "Consolas",
              "monospace",
            ],
          },
          maxWidth: {
            "8xl": "90rem",
          },
        },
      },
    },
  },
];

export const getDocsTailwindSite: (name: string) => DocsTailwindSite = (
  name: string,
): DocsTailwindSite => {
  const site: DocsTailwindSite | undefined = DocsTailwindSites.find(
    (candidate: DocsTailwindSite): boolean => {
      return candidate.name === name;
    },
  );

  if (!site) {
    throw new Error(`No Tailwind site is named ${name}.`);
  }

  return site;
};
