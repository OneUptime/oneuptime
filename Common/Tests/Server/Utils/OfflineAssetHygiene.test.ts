import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  VendorAssetsPath,
  VendorAssetsRoute,
  getMermaidDistPath,
} from "../../../Server/Utils/VendorAssets";

/*
 * Every server-rendered page must be able to render with no route off the box.
 *
 * A CDN <script> in a view does not degrade on an air-gapped install; it
 * blocks the parser until the connect times out, which is what
 * https://github.com/OneUptime/oneuptime/issues/2570 reported as pages stuck
 * on "Loading..." forever. One file added to a views directory with a
 * copy-pasted CDN tag puts it back, and nothing else in the build would
 * notice - so this scans the directories rather than the handful of files the
 * fix happened to touch.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface ViewFile {
  /** Repo-relative, so a failure message names something greppable. */
  name: string;
  absolutePath: string;
  contents: string;
}

interface ViewRoot {
  label: string;
  directories: Array<string>;
  /*
   * Hosts a view under this root may still reference. Anything not listed is
   * a failure.
   */
  allowedHosts: Array<string>;
}

/*
 * Prose explains these rules at length - including, in a couple of places, by
 * naming the exact CDN host that is no longer allowed. Scanning the raw text
 * would fail on the comment that documents the rule.
 *
 * Line comments are only stripped when they START a line: `//cdnjs.cloudflare.com`
 * in an href is a protocol-relative URL, not a comment, and it is precisely
 * the form this test has to keep catching.
 */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<%#[\s\S]*?%>/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function collectViewFiles(directory: string): Array<ViewFile> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<ViewFile> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectViewFiles(absolutePath));
      continue;
    }

    if (!entry.name.endsWith(".ejs")) {
      continue;
    }

    files.push({
      name: path.relative(REPOSITORY_ROOT, absolutePath),
      absolutePath,
      contents: stripComments(fs.readFileSync(absolutePath, "utf8")),
    });
  }

  return files;
}

function featureSetViewDirectories(): Array<string> {
  const featureSetRoot: string = path.join(
    REPOSITORY_ROOT,
    "App",
    "FeatureSet",
  );

  if (!fs.existsSync(featureSetRoot)) {
    return [];
  }

  const directories: Array<string> = [];

  for (const featureSet of fs.readdirSync(featureSetRoot)) {
    /* Docs and Identity capitalise it, the API reference does not. */
    for (const viewsDirectory of ["Views", "views"]) {
      const candidate: string = path.join(
        featureSetRoot,
        featureSet,
        viewsDirectory,
      );

      if (fs.existsSync(candidate)) {
        directories.push(candidate);
      }
    }
  }

  return directories;
}

/*
 * Analytics is the one third-party host a view may still name. It is loaded
 * async, it never blocks a render, and every occurrence is required to sit
 * behind the enableGoogleTagManager flag - which Response.render and the
 * frontend index pages both default to "only when this is the hosted
 * product". The dedicated test below enforces the guard.
 */
const ANALYTICS_HOST: string = "www.googletagmanager.com";

const RENDER_BLOCKING_CDN_HOSTS: Array<string> = [
  "cdn.tailwindcss.com",
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "ajax.googleapis.com",
  "code.jquery.com",
  "js.stripe.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

const VIEW_ROOTS: Array<ViewRoot> = [
  {
    /*
     * On-call acknowledge / message pages. Rendered by the API service, which
     * every install has, and reached from a notification at the worst possible
     * moment - these are the pages that must not need the internet.
     */
    label: "Common server views",
    directories: [path.join(REPOSITORY_ROOT, "Common", "Server", "Views")],
    allowedHosts: [ANALYTICS_HOST],
  },
  {
    /*
     * Docs, the API reference, and the SSO/OIDC message pages. All served out
     * of the App container, which is what nginx routes "/" to whenever billing
     * is off - i.e. on every self-hosted install.
     */
    label: "App feature set views",
    directories: featureSetViewDirectories(),
    allowedHosts: [ANALYTICS_HOST],
  },
  {
    /*
     * The marketing site and blog. nginx only routes to Home when billing is
     * on, so this is never part of a self-hosted deployment and Google Fonts
     * stays. The libraries a page cannot render without do not: those are
     * shared with Docs and the reference, and one CDN copy drifting from the
     * vendored one is its own bug.
     */
    label: "Home views",
    directories: [path.join(REPOSITORY_ROOT, "Home", "Views")],
    allowedHosts: [ANALYTICS_HOST, "fonts.googleapis.com", "fonts.gstatic.com"],
  },
];

describe("server-rendered views load no third-party assets", () => {
  for (const root of VIEW_ROOTS) {
    describe(root.label, () => {
      const views: Array<ViewFile> = root.directories.flatMap(collectViewFiles);

      test("has views to scan", () => {
        /*
         * A rename that empties a root would otherwise turn every check below
         * into a vacuous pass.
         */
        expect(views.length).toBeGreaterThan(0);
      });

      const bannedHosts: Array<string> = RENDER_BLOCKING_CDN_HOSTS.filter(
        (host: string): boolean => {
          return !root.allowedHosts.includes(host);
        },
      );

      test.each(
        bannedHosts.map((host: string) => {
          return [host];
        }),
      )("never references %s", (host: string) => {
        const offenders: Array<string> = views
          .filter((view: ViewFile): boolean => {
            return view.contents.includes(host);
          })
          .map((view: ViewFile): string => {
            return view.name;
          });

        expect(offenders).toEqual([]);
      });
    });
  }

  test("keeps analytics behind the enableGoogleTagManager flag", () => {
    /*
     * Not because googletagmanager.com hangs a render - it is injected async -
     * but because a self-hosted install has no business phoning Google, and an
     * air-gapped one just accumulates failed requests.
     */
    const offenders: Array<string> = VIEW_ROOTS.flatMap((root: ViewRoot) => {
      return root.directories.flatMap(collectViewFiles);
    })
      .filter((view: ViewFile): boolean => {
        return (
          view.contents.includes(ANALYTICS_HOST) &&
          !view.contents.includes("enableGoogleTagManager")
        );
      })
      .map((view: ViewFile): string => {
        return view.name;
      });

    expect(offenders).toEqual([]);
  });
});

describe("every /oneuptime-assets URL a view uses resolves to a real file", () => {
  const allViews: Array<ViewFile> = VIEW_ROOTS.flatMap((root: ViewRoot) => {
    return root.directories.flatMap(collectViewFiles);
  });

  /*
   * Static references only. The two dynamic ones - the lazy highlight.js
   * language loaders - are built by string concatenation and are covered by
   * the langMap test below.
   */
  function referencedAssetPaths(): Array<{ view: string; urlPath: string }> {
    const references: Array<{ view: string; urlPath: string }> = [];

    for (const view of allViews) {
      const matches: Array<string> =
        view.contents.match(
          new RegExp(`${VendorAssetsRoute}/[A-Za-z0-9._/-]+`, "g"),
        ) || [];

      for (const match of matches) {
        references.push({ view: view.name, urlPath: match });
      }
    }

    return references;
  }

  function resolveOnDisk(urlPath: string): string | null {
    const relative: string = urlPath.slice(VendorAssetsRoute.length + 1);

    if (relative.startsWith("mermaid/")) {
      const mermaidDistPath: string | null = getMermaidDistPath();

      if (!mermaidDistPath) {
        return null;
      }

      return path.join(mermaidDistPath, relative.slice("mermaid/".length));
    }

    return path.join(VendorAssetsPath, relative);
  }

  test("finds the references at all", () => {
    expect(referencedAssetPaths().length).toBeGreaterThan(0);
  });

  test("resolves every one of them", () => {
    const missing: Array<string> = referencedAssetPaths()
      .filter((reference: { urlPath: string }): boolean => {
        const onDisk: string | null = resolveOnDisk(reference.urlPath);

        return !onDisk || !fs.existsSync(onDisk);
      })
      .map((reference: { view: string; urlPath: string }): string => {
        return `${reference.view}: ${reference.urlPath}`;
      });

    expect(missing).toEqual([]);
  });

  test("covers the assets the fix was actually about", () => {
    /*
     * The scan above proves whatever is referenced exists; it would also pass
     * on a view that had quietly dropped the reference. These are the three
     * things the issue named.
     */
    const expectations: Array<[string, Array<string>]> = [
      [
        path.join("App", "FeatureSet", "Docs", "Views", "Partials", "Head.ejs"),
        [
          "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
          "/oneuptime-assets/highlight/highlight.min.js",
          "/oneuptime-assets/highlight/styles/vs2015.min.css",
          "/oneuptime-assets/mermaid/mermaid.esm.min.mjs",
        ],
      ],
      [
        path.join(
          "App",
          "FeatureSet",
          "APIReference",
          "views",
          "partials",
          "head.ejs",
        ),
        [
          "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
          "/oneuptime-assets/highlight/highlight.min.js",
          "/oneuptime-assets/highlight/styles/github-dark.min.css",
        ],
      ],
      [
        path.join(
          "App",
          "FeatureSet",
          "Identity",
          "Views",
          "Partials",
          "Head.ejs",
        ),
        ["/oneuptime-assets/tailwind/tailwind-3.4.5.js"],
      ],
      [
        path.join("Common", "Server", "Views", "Partials", "Head.ejs"),
        [
          "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
          "/oneuptime-assets/fonts/InterVariable.woff2",
        ],
      ],
      [
        path.join("Home", "Views", "head-basic.ejs"),
        ["/oneuptime-assets/tailwind/tailwind-3.4.5.js"],
      ],
      [
        path.join("Home", "Views", "Blog", "Post.ejs"),
        [
          "/oneuptime-assets/highlight/highlight.min.js",
          "/oneuptime-assets/mermaid/mermaid.min.js",
        ],
      ],
    ];

    for (const [viewName, expectedUrls] of expectations) {
      const view: ViewFile | undefined = allViews.find(
        (candidate: ViewFile): boolean => {
          return candidate.name === viewName;
        },
      );

      expect([viewName, Boolean(view)]).toEqual([viewName, true]);

      for (const expectedUrl of expectedUrls) {
        expect([
          viewName,
          expectedUrl,
          view?.contents.includes(expectedUrl),
        ]).toEqual([viewName, expectedUrl, true]);
      }
    }
  });
});

describe("lazily-loaded highlight.js grammars", () => {
  /*
   * The docs and the blog build their script URL by concatenation:
   *
   *   s.src = '/oneuptime-assets/highlight/languages/' + lang + '.min.js';
   *
   * so nothing in the URL scan above can tell whether the grammar exists.
   * Adding a language to one of these maps without vendoring the file leaves
   * that language silently unhighlighted on an offline install - the same
   * class of failure, just quieter.
   */
  const viewsWithLanguageMaps: Array<string> = [
    path.join(
      REPOSITORY_ROOT,
      "App",
      "FeatureSet",
      "Docs",
      "Views",
      "Partials",
      "Head.ejs",
    ),
    path.join(REPOSITORY_ROOT, "Home", "Views", "Blog", "Post.ejs"),
  ];

  function grammarsUsedBy(viewPath: string): Array<string> {
    const contents: string = fs.readFileSync(viewPath, "utf8");
    const map: RegExpMatchArray | null = contents.match(
      /var langMap = \{([\s\S]*?)\};/,
    );

    if (!map || !map[1]) {
      return [];
    }

    const values: Array<string> = map[1].match(/:\s*'([a-z0-9]+)'/g) || [];

    return Array.from(
      new Set(
        values.map((value: string): string => {
          return value.replace(/^:\s*'|'$/g, "");
        }),
      ),
    ).sort();
  }

  test.each(
    viewsWithLanguageMaps.map((viewPath: string) => {
      return [viewPath];
    }),
  )("%s only maps grammars that are vendored", (viewPath: string) => {
    const grammars: Array<string> = grammarsUsedBy(viewPath);

    expect(grammars.length).toBeGreaterThan(0);

    const missing: Array<string> = grammars.filter(
      (grammar: string): boolean => {
        return !fs.existsSync(
          path.join(
            VendorAssetsPath,
            "highlight",
            "languages",
            `${grammar}.min.js`,
          ),
        );
      },
    );

    expect(missing).toEqual([]);
  });

  test("vendors no grammar no view asks for", () => {
    /*
     * Not a correctness rule - a maintenance one. Every file here has to be
     * re-downloaded on a highlight.js bump, so the set should stay the set
     * something actually loads.
     */
    const requested: Set<string> = new Set<string>();

    for (const viewPath of viewsWithLanguageMaps) {
      for (const grammar of grammarsUsedBy(viewPath)) {
        requested.add(grammar);
      }
    }

    /* The API reference loads these with plain <script> tags. */
    for (const eager of [
      "python",
      "go",
      "java",
      "csharp",
      "php",
      "ruby",
      "rust",
      "powershell",
      "bash",
      "json",
      "javascript",
      "typescript",
    ]) {
      requested.add(eager);
    }

    const vendored: Array<string> = fs
      .readdirSync(path.join(VendorAssetsPath, "highlight", "languages"))
      .map((file: string): string => {
        return file.replace(/\.min\.js$/, "");
      });

    const unused: Array<string> = vendored.filter(
      (grammar: string): boolean => {
        return !requested.has(grammar);
      },
    );

    expect(unused).toEqual([]);
  });
});
