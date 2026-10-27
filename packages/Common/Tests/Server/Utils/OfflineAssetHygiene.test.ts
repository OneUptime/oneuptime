import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  BrandAssetsPath,
  BrandAssetsRouteSegment,
  MermaidEntryUrl,
  MermaidRouteSegment,
  OneUptimeLogoUrl,
  VendorAssetsPath,
  VendorAssetsRoute,
} from "../../../Server/Utils/VendorAssets";
import { EMAIL_LOGO_PATH } from "../../../Server/Utils/Mail/EmailLogo";
import {
  MarkupReference,
  addressHost,
  describeReference,
  emailTemplateProblems,
  pageLoadProblems,
  readMarkupReferences,
  withoutTemplateComments,
} from "../../Helpers/MarkupReferences";

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
 *
 * Every email, too (issue #5124). The header of every email loaded its logo
 * from res.cloudinary.com: a broken image on a network without the internet,
 * and, everywhere else, a request to a third party each time an email was
 * opened. This guard read only .ejs views, and only for a list of CDN hosts,
 * so it saw neither the .hbs partial nor the host. Emails are now read in
 * every template format, against the one rule an email can keep everywhere:
 * it loads nothing it does not carry itself or is not handed by the
 * installation - whatever the host - and the self-hosted views load nothing
 * from any host but the ones named below.
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
  /*
   * Served by every self-hosted install: then a view may load nothing from
   * any host but allowedHosts, not only none of the CDNs listed below.
   */
  selfHosted: boolean;
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
const COMMENT_SYNTAXES: Array<RegExp> = [
  /<!--[\s\S]*?-->/g,
  /<%#[\s\S]*?%>/g,
  /\/\*[\s\S]*?\*\//g,
  /^[ \t]*\/\/.*$/gm,
];

function stripComments(source: string): string {
  /*
   * Repeated until the text stops changing, rather than one pass per syntax.
   * A single pass leaves the opener behind on overlapping comments
   * ("<!--<!-- x -->" keeps a "<!--"), and removing a block comment can
   * uncover a line comment that was inside it. Cheap here - these files are a
   * few KB and it converges in two passes.
   */
  let previous: string = "";
  let current: string = source;

  while (current !== previous) {
    previous = current;

    for (const syntax of COMMENT_SYNTAXES) {
      current = current.replace(syntax, "");
    }
  }

  return current;
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

const EJS_INCLUDE_PATTERN: RegExp = /include\(\s*['"]([^'"]+)['"]/g;

/*
 * A view's own text and the text of every partial it includes, followed down:
 * what the page it renders is made of. A view that moved its logo or its
 * scripts into a shared partial still loads them.
 */
function contentsWithIncludes(
  absolutePath: string,
  seen: Set<string> = new Set<string>(),
): string {
  if (seen.has(absolutePath)) {
    return "";
  }

  seen.add(absolutePath);

  const contents: string = stripComments(fs.readFileSync(absolutePath, "utf8"));
  const parts: Array<string> = [contents];

  for (const match of contents.matchAll(EJS_INCLUDE_PATTERN)) {
    const includedName: string = match[1]!;
    const includedPath: string = path.resolve(
      path.dirname(absolutePath),
      path.extname(includedName) ? includedName : `${includedName}.ejs`,
    );

    parts.push(contentsWithIncludes(includedPath, seen));
  }

  return parts.join("\n");
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

  for (const featureSet of fs.readdirSync(featureSetRoot, {
    withFileTypes: true,
  })) {
    if (!featureSet.isDirectory()) {
      continue;
    }

    /*
     * Matched against the names actually on disk. On a case-insensitive one
     * (macOS by default) "views" also finds "Views", and every view in it
     * would be scanned twice.
     */
    const entries: Array<string> = fs.readdirSync(
      path.join(featureSetRoot, featureSet.name),
    );

    /* Docs and Identity capitalise it, the API reference does not. */
    for (const viewsDirectory of ["Views", "views"]) {
      if (entries.includes(viewsDirectory)) {
        directories.push(
          path.join(featureSetRoot, featureSet.name, viewsDirectory),
        );
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

/*
 * Matched as a pattern rather than with includes(), so that reading a view's
 * source is not mistaken for validating a URL - it is neither given a URL nor
 * deciding whether to fetch one.
 */
const ANALYTICS_HOST_PATTERN: RegExp = /www\.googletagmanager\.com/;

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
    selfHosted: true,
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
    selfHosted: true,
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
    selfHosted: false,
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

      if (root.selfHosted) {
        /*
         * Not only the CDNs above: no host at all. The list above could not
         * see a host nobody had thought to put on it - res.cloudinary.com,
         * in issue #5124 - and a view an install serves to its own people
         * has nothing to load from anyone else.
         */
        test("loads nothing from any host but the ones named for it", () => {
          const problems: Array<string> = views.flatMap(
            (view: ViewFile): Array<string> => {
              return pageLoadProblems(
                fs.readFileSync(view.absolutePath, "utf8"),
                root.allowedHosts,
              ).map((problem: string): string => {
                return `${view.name}: ${problem}`;
              });
            },
          );

          expect(problems).toEqual([]);
        });
      }
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
          ANALYTICS_HOST_PATTERN.test(view.contents) &&
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

    /*
     * OneUptime's own images are not third-party, so they live outside
     * Static/Vendor and are mounted separately under the same prefix.
     */
    if (relative.startsWith(`${BrandAssetsRouteSegment}/`)) {
      return path.join(
        BrandAssetsPath,
        relative.slice(BrandAssetsRouteSegment.length + 1),
      );
    }

    return path.join(VendorAssetsPath, relative);
  }

  test("finds the references at all", () => {
    expect(referencedAssetPaths().length).toBeGreaterThan(0);
  });

  /*
   * mermaid is a build the images make (Common/Scripts/
   * build-mermaid-browser.js), not a file in the repository. A view may name
   * its entry and nothing else: the entry names its own content-hashed
   * chunks, and VendorAssets.test.ts fetches every one.
   */
  function isServed(urlPath: string): boolean {
    if (urlPath.startsWith(`${VendorAssetsRoute}/${MermaidRouteSegment}/`)) {
      return urlPath === MermaidEntryUrl;
    }

    const onDisk: string | null = resolveOnDisk(urlPath);

    return Boolean(onDisk) && fs.existsSync(onDisk as string);
  }

  test("resolves every one of them", () => {
    const missing: Array<string> = referencedAssetPaths()
      .filter((reference: { urlPath: string }): boolean => {
        return !isServed(reference.urlPath);
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
          MermaidEntryUrl,
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
        /*
         * The single sign-on pages draw their words in Inter, as the
         * sign-in pages they are reached from do.
         */
        [
          "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
          "/oneuptime-assets/fonts/InterVariable.woff2",
        ],
      ],
      [
        path.join("Common", "Server", "Views", "Partials", "Head.ejs"),
        [
          "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
          "/oneuptime-assets/fonts/InterVariable.woff2",
        ],
      ],
      /*
       * The logo on the pages the App container renders. It used to point at
       * /img/3-transparent.svg, which only Home serves - issue 3457.
       */
      [
        path.join(
          "Common",
          "Server",
          "Views",
          "AcknowledgeUserOnCallNotification.ejs",
        ),
        [OneUptimeLogoUrl],
      ],
      [
        path.join("Common", "Server", "Views", "ViewMessage.ejs"),
        [OneUptimeLogoUrl],
      ],
      [
        path.join("App", "FeatureSet", "Identity", "Views", "Message.ejs"),
        [OneUptimeLogoUrl],
      ],
      [
        path.join("Home", "Views", "head-basic.ejs"),
        ["/oneuptime-assets/tailwind/tailwind-3.4.5.js"],
      ],
      [
        path.join("Home", "Views", "Blog", "Post.ejs"),
        ["/oneuptime-assets/highlight/highlight.min.js", MermaidEntryUrl],
      ],
    ];

    for (const [viewName, expectedUrls] of expectations) {
      const view: ViewFile | undefined = allViews.find(
        (candidate: ViewFile): boolean => {
          return candidate.name === viewName;
        },
      );

      expect([viewName, Boolean(view)]).toEqual([viewName, true]);

      // The page as it is built: the view and every partial it includes.
      const page: string = view ? contentsWithIncludes(view.absolutePath) : "";

      for (const expectedUrl of expectedUrls) {
        expect([viewName, expectedUrl, page.includes(expectedUrl)]).toEqual([
          viewName,
          expectedUrl,
          true,
        ]);
      }
    }
  });
});

describe("diagrams load mermaid from the build made from its source", () => {
  /*
   * mermaid's prebuilt bundles (dist/mermaid.min.js, mermaid.js,
   * mermaid.esm(.min).mjs, mermaid.core.mjs straight off disk) each carry
   * their own copies of mermaid's dependencies, or import them by a bare name
   * no browser can resolve. A page loads /oneuptime-assets/mermaid/mermaid.mjs,
   * built with the dependencies npm installed - and nothing else.
   */
  const PREBUILT_MERMAID_FILE: RegExp =
    /mermaid(?:\.(?:esm|min|core))+\.m?js\b|\bmermaid\.js\b/;

  const allViews: Array<ViewFile> = VIEW_ROOTS.flatMap((root: ViewRoot) => {
    return root.directories.flatMap(collectViewFiles);
  });

  test("the pattern catches every prebuilt name and not the entry", () => {
    for (const prebuilt of [
      "mermaid.min.js",
      "mermaid.js",
      "mermaid.esm.mjs",
      "mermaid.esm.min.mjs",
      "mermaid.core.mjs",
      "/npm/mermaid@11/dist/mermaid.min.js",
    ]) {
      expect([prebuilt, PREBUILT_MERMAID_FILE.test(prebuilt)]).toEqual([
        prebuilt,
        true,
      ]);
    }

    expect(PREBUILT_MERMAID_FILE.test(MermaidEntryUrl)).toBe(false);
  });

  test("no view names one of mermaid's prebuilt bundles", () => {
    const offenders: Array<string> = allViews
      .filter((view: ViewFile): boolean => {
        return PREBUILT_MERMAID_FILE.test(view.contents);
      })
      .map((view: ViewFile): string => {
        return view.name;
      });

    expect(offenders).toEqual([]);
  });

  test("every view that draws diagrams imports the entry, and only the entry", () => {
    const drawing: Array<ViewFile> = allViews.filter(
      (view: ViewFile): boolean => {
        return view.contents.includes(`${VendorAssetsRoute}/mermaid`);
      },
    );

    // The docs' head and the blog post.
    expect(
      drawing
        .map((view: ViewFile): string => {
          return view.name;
        })
        .sort(),
    ).toEqual(
      [
        path.join("App", "FeatureSet", "Docs", "Views", "Partials", "Head.ejs"),
        path.join("Home", "Views", "Blog", "Post.ejs"),
      ].sort(),
    );

    for (const view of drawing) {
      const references: Array<string> =
        view.contents.match(
          new RegExp(`${VendorAssetsRoute}/mermaid[A-Za-z0-9._/-]*`, "g"),
        ) || [];

      expect([view.name, [...new Set(references)]]).toEqual([
        view.name,
        [MermaidEntryUrl],
      ]);
      // As an ES module: dynamic import(), never a classic <script src>.
      expect([
        view.name,
        view.contents.includes(`import('${MermaidEntryUrl}')`),
      ]).toEqual([view.name, true]);
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

/*
 * EMAILS LOAD NOTHING FROM ANYWHERE (issue #5124).
 *
 * A mail client reads an email wherever its reader is - on a network
 * without the internet, behind a mail gateway that flags remote images - and
 * every image it fetches tells whoever serves it who opened the email, and
 * when. So an email's own markup loads nothing at all: an image is either
 * carried inside the email (cid:, data: - OneUptime's logo, a screenshot)
 * or an address the installation hands the template, built on its own host
 * (a logo its operator uploaded). And it names no host but OneUptime's own
 * site, in the one link of an installation that is not renamed.
 */

const EMAIL_TEMPLATES_ROOT: string = path.join(
  REPOSITORY_ROOT,
  "App",
  "FeatureSet",
  "Notification",
  "Templates",
);

/*
 * Every format an email template could be written in. A file of any other
 * kind under the templates fails "is a format this guard reads", so a new
 * format is read here before it can ship an image.
 */
const EMAIL_TEMPLATE_FORMATS: ReadonlyArray<string> = [
  ".hbs",
  ".handlebars",
  ".ejs",
  ".html",
  ".htm",
  ".mjml",
];

/*
 * The one host an email's own markup may name, and only in a link the
 * reader may follow: the footer's "Powered by OneUptime", which only an
 * installation that is not renamed shows. A renamed one links to the
 * website its operator set (brandWebsiteUrl), or nowhere.
 */
const EMAIL_LINK_HOSTS: ReadonlyArray<string> = ["oneuptime.com"];

/*
 * Every image an email template loads, and where its address comes from.
 * Each is carried inside the email or built by the installation on its own
 * host. A template that loads anything else fails "the images the
 * templates load": add it here only with a source that is one of those.
 */
const EMAIL_IMAGE_SOURCES: Record<string, string> = {
  "{{{@root.oneUptimeLogoUrl}}}":
    "OneUptime's logo, carried inside the email (Server/Utils/Mail/EmailLogo.ts)",
  "{{@root.brandLogoUrl}}":
    "the installation's own logo, on its own host (App FeatureSet/Notification/Utils/EmailBranding.ts, toAbsoluteUrl)",
  "{{logoUrl}}":
    "a status page's logo, on the installation's own host (Server/Utils/StatusPage/StatusPageEmailLogo.ts)",
};

interface SourceFile {
  // Repo-relative, so a failure message names something greppable.
  name: string;
  absolutePath: string;
  source: string;
}

// Every file under `directory`, at any depth.
function collectFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const absolutePath: string = path.join(directory, entry.name);

      return entry.isDirectory() ? collectFiles(absolutePath) : [absolutePath];
    });
}

function readSourceFile(absolutePath: string): SourceFile {
  return {
    name: path.relative(REPOSITORY_ROOT, absolutePath),
    absolutePath: absolutePath,
    source: fs.readFileSync(absolutePath, "utf8"),
  };
}

function emailTemplateFiles(): Array<SourceFile> {
  return collectFiles(EMAIL_TEMPLATES_ROOT)
    .filter((file: string): boolean => {
      return EMAIL_TEMPLATE_FORMATS.includes(path.extname(file).toLowerCase());
    })
    .map(readSourceFile);
}

describe("emails load nothing from anywhere", () => {
  const templates: Array<SourceFile> = emailTemplateFiles();

  test("finds every template, and every partial", () => {
    expect(templates.length).toBeGreaterThan(100);
    expect(
      templates.some((template: SourceFile): boolean => {
        return (
          template.name ===
          path.join(
            "App",
            "FeatureSet",
            "Notification",
            "Templates",
            "Partials",
            "Logo.hbs",
          )
        );
      }),
    ).toBe(true);
  });

  test("every file under the templates is a format this guard reads", () => {
    const unread: Array<string> = collectFiles(EMAIL_TEMPLATES_ROOT)
      .filter((file: string): boolean => {
        return !EMAIL_TEMPLATE_FORMATS.includes(
          path.extname(file).toLowerCase(),
        );
      })
      .map((file: string): string => {
        return path.relative(REPOSITORY_ROOT, file);
      });

    expect(unread).toEqual([]);
  });

  test.each(
    templates.map((template: SourceFile) => {
      return [template.name, template.source];
    }),
  )(
    "%s loads only what the email carries or is handed, and links nowhere else",
    (_name: string, source: string) => {
      expect(emailTemplateProblems(source, EMAIL_LINK_HOSTS)).toEqual([]);
    },
  );

  test("the images the templates load are the ones the installation builds or carries", () => {
    const loaded: Set<string> = new Set<string>();

    for (const template of templates) {
      for (const reference of readMarkupReferences(
        withoutTemplateComments(template.source),
      )) {
        if (reference.loads) {
          loaded.add(reference.value.trim());
        }
      }
    }

    expect([...loaded].sort()).toEqual(Object.keys(EMAIL_IMAGE_SOURCES).sort());
  });

  test("the header that loaded its logo from res.cloudinary.com carries it now", () => {
    const logo: SourceFile = readSourceFile(
      path.join(EMAIL_TEMPLATES_ROOT, "Partials", "Logo.hbs"),
    );

    expect(logo.source).toContain('src="{{{@root.oneUptimeLogoUrl}}}"');
    // No address of its own anywhere in it, a link's included.
    expect(
      readMarkupReferences(withoutTemplateComments(logo.source))
        .filter((reference: MarkupReference): boolean => {
          return addressHost(reference.value) !== null;
        })
        .map(describeReference),
    ).toEqual([]);
    // And the logo it carries ships with OneUptime.
    expect(fs.existsSync(EMAIL_LOGO_PATH)).toBe(true);
  });
});

/*
 * The code that writes an email's markup itself - the detail card's rows,
 * the episode member list, the Markdown renderer, the notes that say an
 * image or a text was left out, the status page starter templates - holds
 * no address to load either. Its strings are read through the TypeScript
 * compiler, so a comment is never read as one, and a template literal's
 * values read as values ({{value}}): only an address the code writes itself
 * can fail.
 */

const EMAIL_CODE_DIRECTORIES: ReadonlyArray<string> = [
  path.join(REPOSITORY_ROOT, "App", "FeatureSet", "Notification"),
  path.join(REPOSITORY_ROOT, "Common", "Server", "Utils", "Mail"),
  path.join(REPOSITORY_ROOT, "Common", "Server", "Utils", "EmailRollup"),
  path.join(REPOSITORY_ROOT, "Common", "Server", "Utils", "StatusPage"),
];

const EMAIL_CODE_FILES: ReadonlyArray<string> = [
  path.join(REPOSITORY_ROOT, "Common", "Server", "Types", "Markdown.ts"),
  path.join(
    REPOSITORY_ROOT,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Utils",
    "SubscriberNotificationTemplateDefaults.ts",
  ),
];

const TEMPLATE_VALUE: string = "{{value}}";

/*
 * Every string a TypeScript source writes: string literals, and template
 * literals with each ${...} read as a value.
 */
function stringsWritten(source: string, fileName: string): Array<string> {
  const file: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const strings: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      strings.push(node.text);
      return;
    }

    if (ts.isTemplateExpression(node)) {
      strings.push(
        node.head.text +
          node.templateSpans
            .map((span: ts.TemplateSpan): string => {
              return TEMPLATE_VALUE + span.literal.text;
            })
            .join(""),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return strings;
}

// What the strings of `source` load from a host.
function codeLoadProblems(source: string, fileName: string): Array<string> {
  return stringsWritten(source, fileName).flatMap(
    (text: string): Array<string> => {
      return readMarkupReferences(text)
        .filter((reference: MarkupReference): boolean => {
          return reference.loads && addressHost(reference.value) !== null;
        })
        .map(describeReference);
    },
  );
}

describe("code that writes an email's markup loads nothing from anywhere", () => {
  const files: Array<string> = [
    ...EMAIL_CODE_DIRECTORIES.flatMap(collectFiles).filter(
      (file: string): boolean => {
        return file.endsWith(".ts") && !file.endsWith(".d.ts");
      },
    ),
    ...EMAIL_CODE_FILES,
  ];

  test("finds the code", () => {
    const names: Array<string> = files.map((file: string): string => {
      return path.basename(file);
    });

    for (const expected of [
      "EmailLogo.ts",
      "EmailInlineImages.ts",
      "EmailSize.ts",
      "EmailDetailCard.ts",
      "EmailBranding.ts",
      "MailService.ts",
      "Markdown.ts",
      "SubscriberNotificationTemplateDefaults.ts",
    ]) {
      expect([expected, names.includes(expected)]).toEqual([expected, true]);
    }

    for (const file of files) {
      expect([file, fs.existsSync(file)]).toEqual([file, true]);
    }
  });

  test("no string it writes loads an address from a host", () => {
    const problems: Array<string> = files.flatMap(
      (file: string): Array<string> => {
        return codeLoadProblems(fs.readFileSync(file, "utf8"), file).map(
          (problem: string): string => {
            return `${path.relative(REPOSITORY_ROOT, file)}: ${problem}`;
          },
        );
      },
    );

    expect(problems).toEqual([]);
  });

  test("reads what code writes, and not what it says in a comment", () => {
    const source: string = [
      '// <img src="https://comment.example/a.png">',
      '/* <img src="https://comment.example/b.png"> */',
      "const logo: string = '<img src=\"https://cdn.example/logo.png\">';",
      'const own: string = `<img src="${logoUrl}" alt="Logo">`;',
      'const pixel: string = `<td style="background: url(https://cdn.example/${name}.png)">`;',
      'const api: string = "https://graph.microsoft.com/v1.0/me/sendMail";',
    ].join("\n");

    expect(codeLoadProblems(source, "Example.ts")).toEqual([
      'img src "https://cdn.example/logo.png"',
      'td url() "https://cdn.example/{{value}}.png"',
    ]);
  });
});
