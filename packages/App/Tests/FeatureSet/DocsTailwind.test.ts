import {
  DocsTailwindSite,
  DocsTailwindSites,
  decodeMarkupEntities,
  getDocsTailwindSite,
} from "../../Utils/DocsTailwind";
import {
  findTailwindStylesheet,
  getTailwindStylesheetFileName,
  isTailwindStylesheetAddress,
} from "../../Utils/TailwindStylesheet";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";

/*
 * The docs' and the API reference's Tailwind, built with the App image rather
 * than generated in the reader's browser (issue #5615): the sites' build
 * configs (Utils/DocsTailwind.ts) and how a build is named and found
 * (Utils/TailwindStylesheet.ts). DocsTailwindPages.test.ts holds the pages to
 * linking it.
 *
 * The runtime still styles the pages where nothing is built, with the config
 * each site's view gives it, so the build's config must stay the one in the
 * view: this file reads the view's own script and holds the two equal.
 */

const FEATURE_SETS: string = path.resolve(__dirname, "..", "..", "FeatureSet");

const RUNTIME_CONFIG_VIEWS: Record<string, string> = {
  docs: path.join(FEATURE_SETS, "Docs", "Views", "Partials", "Head.ejs"),
  reference: path.join(
    FEATURE_SETS,
    "APIReference",
    "views",
    "partials",
    "head.ejs",
  ),
};

/*
 * The config a view gives the runtime: the inline script after the runtime's
 * own, run as the browser runs it.
 */
function runtimeConfigIn(view: string): Record<string, unknown> {
  const source: string = fs.readFileSync(view, "utf8");
  const runtime: number = source.indexOf(
    '<script src="/oneuptime-assets/tailwind/tailwind-3.4.5.js"></script>',
  );

  expect(runtime).toBeGreaterThan(-1);

  const start: number = source.indexOf("<script>", runtime) + "<script>".length;
  const end: number = source.indexOf("</script>", start);
  const sandbox: { tailwind: { config?: Record<string, unknown> } } = {
    tailwind: {},
  };

  vm.runInNewContext(source.slice(start, end), sandbox);

  return sandbox.tailwind.config as Record<string, unknown>;
}

// The files under a folder whose names end with one of `extensions`.
function filesUnder(folder: string, extensions: Array<string>): Array<string> {
  if (!fs.existsSync(folder)) {
    return [];
  }

  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "node_modules"
          ? []
          : filesUnder(full, extensions);
      }

      return extensions.some((extension: string): boolean => {
        return entry.name.endsWith(extension);
      })
        ? [full]
        : [];
    });
}

function contentFiles(site: DocsTailwindSite): Array<string> {
  const content: unknown = site.config.content;

  return (content as { files: Array<string> }).files;
}

describe.each(
  DocsTailwindSites.map(
    (site: DocsTailwindSite): [string, DocsTailwindSite] => {
      return [site.name, site];
    },
  ),
)("the %s site's build", (name: string, site: DocsTailwindSite) => {
  it("is configured as its view configures the runtime", () => {
    const runtime: Record<string, unknown> = runtimeConfigIn(
      RUNTIME_CONFIG_VIEWS[name]!,
    );

    expect({
      darkMode: site.config.darkMode,
      theme: site.config.theme,
    }).toEqual(runtime);
  });

  it("reads every kind of file its pages' classes come from, and each finds files", () => {
    for (const pattern of contentFiles(site)) {
      const folder: string = pattern.slice(0, pattern.indexOf("*") - 1);
      const extension: string = pattern.slice(pattern.lastIndexOf("."));

      expect([pattern, filesUnder(folder, [extension]).length > 0]).toEqual([
        pattern,
        true,
      ]);
    }

    expect(
      contentFiles(site).some((pattern: string): boolean => {
        return (
          pattern.endsWith(".ejs") &&
          pattern.includes(site.name === "docs" ? "Views" : "views")
        );
      }),
    ).toBe(true);
  });

  it("is written inside its feature set, which the image's pruning keeps, and served under the site's path", () => {
    expect(site.directory).toBe(
      path.join(
        FEATURE_SETS,
        site.name === "docs" ? "Docs" : "APIReference",
        "build",
        "tailwind",
      ),
    );
    expect(site.hrefPrefix).toBe(
      site.name === "docs" ? "/docs/tailwind/" : "/reference/tailwind/",
    );
  });
});

describe("a site by its name", () => {
  it("is the docs or the reference, and nothing else", () => {
    expect(getDocsTailwindSite("docs").hrefPrefix).toBe("/docs/tailwind/");
    expect(getDocsTailwindSite("reference").hrefPrefix).toBe(
      "/reference/tailwind/",
    );
    expect(() => {
      return getDocsTailwindSite("blog");
    }).toThrow("No Tailwind site is named blog.");
  });
});

describe("the markup Tailwind reads", () => {
  it("has its entities decoded, as a browser reads a class", () => {
    expect(
      decodeMarkupEntities(
        '<div class="[&amp;>:first-child]:mt-0 [&amp;&gt;p]:m-0">&quot;&#39;&lt;</div>',
      ),
    ).toBe(`<div class="[&>:first-child]:mt-0 [&>p]:m-0">"'<</div>`);
    expect(decodeMarkupEntities("&nbsp; &copy; & plain")).toBe(
      "&nbsp; &copy; & plain",
    );
  });

  it("is decoded in the views and the Markdown, the files that are markup", () => {
    for (const site of DocsTailwindSites) {
      const transform: Record<string, unknown> = (
        site.config.content as { transform: Record<string, unknown> }
      ).transform;

      expect(Object.keys(transform).sort()).toEqual(["ejs", "md"]);
      expect(transform["ejs"]).toBe(decodeMarkupEntities);
    }
  });
});

describe("a site's built stylesheet", () => {
  it("is named for its content", () => {
    const name: string = getTailwindStylesheetFileName(".flex{display:flex}");

    expect(name).toMatch(/^tailwind\.[0-9a-f]{12}\.css$/);
    expect(getTailwindStylesheetFileName(".flex{display:flex}")).toBe(name);
    expect(getTailwindStylesheetFileName(".block{display:block}")).not.toBe(
      name,
    );
  });

  it("is found when the directory holds one build, under the site's path", () => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "docs-tailwind-"),
    );
    const fileName: string = getTailwindStylesheetFileName("a{}");

    expect(
      findTailwindStylesheet({ directory, hrefPrefix: "/docs/tailwind/" }),
    ).toBeNull();

    fs.writeFileSync(path.join(directory, fileName), "a{}");
    fs.writeFileSync(path.join(directory, "notes.txt"), "not a build");

    expect(
      findTailwindStylesheet({ directory, hrefPrefix: "/docs/tailwind/" }),
    ).toEqual({
      fileName,
      filePath: path.join(directory, fileName),
      href: `/docs/tailwind/${fileName}`,
    });

    // Two builds were put there by hand: the pages fall back to the runtime.
    fs.writeFileSync(
      path.join(directory, getTailwindStylesheetFileName("b{}")),
      "b{}",
    );

    expect(
      findTailwindStylesheet({ directory, hrefPrefix: "/docs/tailwind/" }),
    ).toBeNull();
    expect(
      findTailwindStylesheet({
        directory: path.join(directory, "missing"),
        hrefPrefix: "/docs/tailwind/",
      }),
    ).toBeNull();

    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("is served at the addresses a build of it can have, and no others", () => {
    const isAddress: (path: string) => boolean = (path: string): boolean => {
      return isTailwindStylesheetAddress({
        hrefPrefix: "/reference/tailwind/",
        path,
      });
    };

    expect(isAddress("/reference/tailwind/tailwind.0123456789ab.css")).toBe(
      true,
    );
    expect(isAddress("/reference/tailwind/tailwind.0123456789a.css")).toBe(
      false,
    );
    expect(isAddress("/docs/tailwind/tailwind.0123456789ab.css")).toBe(false);
    expect(isAddress("/referenceXtailwind/tailwind.0123456789ab.css")).toBe(
      false,
    );
    expect(isAddress("/reference/tailwind/tailwind.0123456789ab.css.map")).toBe(
      false,
    );
    // The prefix is read as it is written: nothing in it is a pattern.
    expect(
      isTailwindStylesheetAddress({
        hrefPrefix: "/a.b/",
        path: "/aXb/tailwind.0123456789ab.css",
      }),
    ).toBe(false);
    expect(
      isTailwindStylesheetAddress({
        hrefPrefix: "/a.b/",
        path: "/a.b/tailwind.0123456789ab.css",
      }),
    ).toBe(true);
  });
});
