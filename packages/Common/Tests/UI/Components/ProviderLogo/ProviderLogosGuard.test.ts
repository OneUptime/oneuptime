import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
} from "../../../../Types/ProviderLogo/ProviderLogo";

/*
 * Icons as one-colour SVGs, product-wide (icons-svg-one-color, doc 8 block
 * 44): "We don't need images. We need SVGs, and we need official logos in
 * SVGs as well. It should match with the rest of our uptime branding."
 *
 *  - every mark the registry ships is drawn somewhere, so none sits in the
 *    installation for nothing;
 *  - the marks are reached only through their loader (one small file per
 *    mark, loaded when a page draws it), the icon set and the code pages;
 *    no frontend imports every mark at once;
 *  - no frontend draws an icon as an image: no raster file, no SVG file
 *    shown as a picture, no SVG data URL - except OneUptime's own logo, the
 *    blank profile picture and the content a page shows (a screenshot, a
 *    replayed page), each listed below with its reason;
 *  - no frontend draws a mark in several colours, except the ones kept so
 *    on purpose, each listed with its reason;
 *  - no email draws an SVG (mail clients drop or do not render it);
 *  - nothing in the frontends loads a picture from another address.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..", "..", "..");
const REPOSITORY: string = path.join(PACKAGES, "..");
const EE: string = path.join(REPOSITORY, "ee");

// The product's code that can name a logo: Common's types and UI, the App's frontends.
const PRODUCT_SOURCES: Array<string> = [
  path.join(PACKAGES, "Common", "Types"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "StatusPage", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "Accounts", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "PublicDashboard", "src"),
];

// The website names logos too: its guides and its comparisons.
const WEBSITE_SOURCES: Array<string> = [
  path.join(PACKAGES, "Home", "Utils"),
  path.join(PACKAGES, "Home", "Views"),
];

// The Enterprise Edition's frontends, where ee/ is present (CI removes it for Common Test).
const EE_SOURCES: Array<string> = fs.existsSync(EE)
  ? [path.join(EE, "Dashboard"), path.join(EE, "AdminDashboard")]
  : [];

const EMAIL_TEMPLATES: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Notification",
  "Templates",
);

// The registry and its generated tables name every logo: they are not uses.
const REGISTRY_FILES: ReadonlyArray<string> = [
  path.join(PACKAGES, "Common", "Types", "ProviderLogo", "ProviderLogo.ts"),
  path.join(PACKAGES, "Common", "Types", "ProviderLogo", "ProviderLogoMarks.ts"),
  path.join(
    PACKAGES,
    "Common",
    "Types",
    "ProviderLogo",
    "AllProviderLogoMarks.ts",
  ),
  path.join(
    PACKAGES,
    "Common",
    "UI",
    "Components",
    "ProviderLogo",
    "ProviderLogoMarkLoader.ts",
  ),
];

const LOADER: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Components",
  "ProviderLogo",
  "ProviderLogoMarkLoader.ts",
);

/*
 * The files that draw a mark they always show, and so import its shapes
 * directly: the icon set's brand glyphs and the code hosts' marks.
 */
const MARK_IMPORTERS: ReadonlyArray<string> = [
  path.join(PACKAGES, "Common", "UI", "Components", "Icon", "Icon.tsx"),
  path.join(
    PACKAGES,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "Code",
    "CodeHostMark.tsx",
  ),
  path.join(
    PACKAGES,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "Code",
    "GitHubConnect.tsx",
  ),
];

const SOURCE_FILE: RegExp = /\.(ts|tsx|ejs)$/;
const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

// A quoted address: the quote right before it, so prose in a comment is not one.
const QUOTED_ADDRESS: RegExp = /["'`](https?:\/\/[^"'`\s]+)["'`]/g;
const PICTURE_PATH: RegExp = /\.(svg|png|jpe?g|gif|webp|ico|avif)$/i;
const MARKS_FOLDER: string = path.join(
  PACKAGES,
  "Common",
  "Types",
  "ProviderLogo",
  "Marks",
);
const ALL_MARKS_MODULE: string = path.join(
  PACKAGES,
  "Common",
  "Types",
  "ProviderLogo",
  "AllProviderLogoMarks",
);
// A module a source imports: `from "x"` or `import("x")`.
const IMPORT_SPECIFIER: RegExp = /(?:from\s+|import\(\s*)["']([^"'\n]+)["']/g;

// An image file a module imports: `from "x.png"`, `import("x.png")`, `require("x.png")`.
const IMPORTED_RASTER: RegExp =
  /(?:from\s+|import\(\s*|require\(\s*)["']([^"'\n]+\.(?:png|jpe?g|gif|webp|ico|bmp|avif))["']/gi;
const IMPORTED_SVG_FILE: RegExp =
  /(?:from\s+|import\(\s*|require\(\s*)["']([^"'\n]+\.svg)["']/gi;
const SVG_DATA_URL: string = "data:image/svg+xml";

// A colour written into a drawing: fill="#E01E5A", stopColor={"rgb(1, 2, 3)"}.
const LITERAL_COLOUR: RegExp =
  /\b(?:fill|stroke|stopColor|stop-color)=(?:\{)?["'`](#[0-9a-fA-F]{3,8}|rgba?\([^)\n]{0,60}\)|hsla?\([^)\n]{0,60}\)|white|black)["'`]/gi;

// Services that hand out other companies' logos by address.
const LOGO_SERVICE_HOSTS: ReadonlyArray<string> = [
  "logo.clearbit.com",
  "cdn.simpleicons.org",
  "img.logo.dev",
  "cdn.brandfetch.io",
  "icons.duckduckgo.com",
  "www.google.com",
  "t1.gstatic.com",
  "upload.wikimedia.org",
  "platform.slack-edge.com",
  "a.slack-edge.com",
];

/*
 * The domains kept for examples (RFC 2606): a placeholder such as
 * https://example.com/oneuptime.png shows the shape of an answer, and
 * nothing loads it.
 */
const EXAMPLE_DOMAINS: ReadonlyArray<string> = [
  "example.com",
  "example.org",
  "example.net",
];

interface KeptOnPurpose {
  // The file, from the repository's root.
  file: string;
  why: string;
}

/*
 * Pictures a frontend imports on purpose. Anything else a frontend draws as
 * an icon is an inline SVG in the current colour.
 */
const PICTURES_KEPT: ReadonlyArray<KeptOnPurpose> = [
  {
    file: "packages/Common/UI/Components/ProductLogo/ProductLogo.tsx",
    why: "OneUptime's own logo: the product's brand, which a licence can replace with its own",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Settings/MobileApps.tsx",
    why: "OneUptime's own logo, on the page that offers its mobile app",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/FormBrandingSection.tsx",
    why: "the form's browser-tab preview shows OneUptime's own favicon, the picture a browser draws in its tab",
  },
  {
    file: "packages/Common/UI/Components/Feed/FeedItem.tsx",
    why: "the blank profile picture: a person's picture slot, where a picture they upload is shown",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/User/User.tsx",
    why: "the blank profile picture, as above",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Header/UserProfile.tsx",
    why: "the blank profile picture, as above",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Users/View/Index.tsx",
    why: "the blank profile picture, as above",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules.tsx",
    why: "the blank profile picture, as above",
  },
  {
    file: "packages/App/FeatureSet/AdminDashboard/src/Components/Header/UserProfile.tsx",
    why: "the blank profile picture, as above",
  },
];

// SVG data URLs a frontend builds on purpose: content, never an icon.
const SVG_DATA_URLS_KEPT: ReadonlyArray<KeptOnPurpose> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayFrameCapture.ts",
    why: "a replayed page's own SVG images, drawn as the recorded page drew them",
  },
];

// Drawings a frontend keeps in several colours on purpose.
const MULTICOLOUR_KEPT: ReadonlyArray<KeptOnPurpose> = [
  {
    file: "packages/App/FeatureSet/Accounts/src/Components/MicrosoftSignInButton/MicrosoftSignInButton.tsx",
    why: "Sign in with Microsoft: Microsoft's sign-in branding asks for its four-colour logo on the button",
  },
  {
    file: "packages/App/FeatureSet/Accounts/src/Components/GoogleSignInButton/GoogleSignInButton.tsx",
    why: "Continue with Google: Google's sign-in branding asks for its standard full-colour G, unchanged, on the button",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Settings/MobileApps.tsx",
    why: "the Google Play store badge: Google's badge guidelines ask for its mark in its colours",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView.tsx",
    why: "a value widget's sparkline: two tints of a chart's fill, not a mark",
  },
];

function isExampleHost(hostname: string): boolean {
  return EXAMPLE_DOMAINS.some((domain: string): boolean => {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...sourceFiles(path.join(directory, entry.name)));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function read(files: Array<string>): Map<string, string> {
  return new Map(
    files.map((file: string): [string, string] => {
      return [file, fs.readFileSync(file, "utf8")];
    }),
  );
}

const FRONTEND_SOURCES: Map<string, string> = read(
  [...PRODUCT_SOURCES, ...EE_SOURCES].flatMap(sourceFiles),
);
const WEBSITE: Map<string, string> = read(WEBSITE_SOURCES.flatMap(sourceFiles));

function relative(file: string): string {
  return path.relative(REPOSITORY, file).split(path.sep).join("/");
}

/*
 * Where each module a source imports is, without its extension: a relative
 * specifier from the source's folder, "Common/..." from packages/Common.
 * Anything else (a package from node_modules) is left out.
 */
function importedPaths(file: string, source: string): Array<string> {
  const paths: Array<string> = [];

  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier: string = match[1] || "";

    if (specifier.startsWith(".")) {
      paths.push(path.resolve(path.dirname(file), specifier));
    } else if (specifier.startsWith("Common/")) {
      paths.push(path.join(PACKAGES, specifier));
    }
  }

  return paths;
}

function isKept(
  kept: ReadonlyArray<KeptOnPurpose>,
  file: string,
): boolean {
  return kept.some((entry: KeptOnPurpose): boolean => {
    return entry.file === relative(file);
  });
}

// A remote address of a picture, or of a service that hands out logos.
function isRemotePicture(address: string): boolean {
  let url: URL;

  try {
    url = new URL(address);
  } catch {
    return false;
  }

  if (isExampleHost(url.hostname)) {
    return false;
  }

  return (
    PICTURE_PATH.test(url.pathname) || LOGO_SERVICE_HOSTS.includes(url.hostname)
  );
}

// Every <svg>...</svg> in a source, read with indexOf.
function svgBlocks(source: string): Array<string> {
  const blocks: Array<string> = [];
  let start: number = source.indexOf("<svg");

  while (start !== -1) {
    const end: number = source.indexOf("</svg>", start);

    if (end === -1) {
      break;
    }

    blocks.push(source.slice(start, end + "</svg>".length));
    start = source.indexOf("<svg", end);
  }

  return blocks;
}

// The colours written into a drawing, in lower case, each once.
function literalColours(block: string): Array<string> {
  const colours: Set<string> = new Set<string>();

  for (const match of block.matchAll(LITERAL_COLOUR)) {
    colours.add((match[1] || "").toLowerCase().split(" ").join(""));
  }

  return Array.from(colours).sort();
}

describe("the marks the product ships", () => {
  test("the walk reads the product's frontends and the website, so the rules below are not vacuous", () => {
    expect(FRONTEND_SOURCES.size).toBeGreaterThan(1000);
    expect(FRONTEND_SOURCES.has(LOADER)).toBe(true);
    expect(WEBSITE.size).toBeGreaterThan(50);
  });

  test.each(ALL_PROVIDER_LOGOS)(
    "%s is drawn somewhere in the product or on the website",
    (logo: ProviderLogo) => {
      const member: string | undefined = Object.keys(ProviderLogo).find(
        (key: string): boolean => {
          return (ProviderLogo as Record<string, string>)[key] === logo;
        },
      );

      expect(member).toBeDefined();

      const reference: string = `ProviderLogo.${member}`;
      const users: Array<string> = [];

      for (const [file, source] of [...FRONTEND_SOURCES, ...WEBSITE]) {
        if (REGISTRY_FILES.includes(file)) {
          continue;
        }

        if (source.includes(reference)) {
          users.push(relative(file));
        }
      }

      expect({ logo, drawnBy: users.length > 0 }).toEqual({
        logo,
        drawnBy: true,
      });
    },
  );

  test("only the loader, the icon set and the code pages reach into the marks' folder", () => {
    const readers: Array<string> = [];

    for (const [file, source] of FRONTEND_SOURCES) {
      const reachesMarks: boolean = importedPaths(file, source).some(
        (imported: string): boolean => {
          return imported.startsWith(`${MARKS_FOLDER}${path.sep}`);
        },
      );

      if (reachesMarks) {
        readers.push(relative(file));
      }
    }

    expect(readers.sort()).toEqual(
      [
        LOADER,
        ...MARK_IMPORTERS,
        // The table of every mark, for the server and the tests: no frontend imports it.
        REGISTRY_FILES[2]!,
      ]
        .map(relative)
        .sort(),
    );
  });

  test("no frontend imports every mark at once: a page carries only the marks it draws", () => {
    const importers: Array<string> = [];

    for (const [file, source] of FRONTEND_SOURCES) {
      if (importedPaths(file, source).includes(ALL_MARKS_MODULE)) {
        importers.push(relative(file));
      }
    }

    expect(importers).toEqual([]);
  });
});

describe("no icon is drawn as an image", () => {
  test("no frontend imports a raster image, but the pictures kept on purpose", () => {
    const found: Array<string> = [];

    for (const [file, source] of FRONTEND_SOURCES) {
      for (const match of source.matchAll(IMPORTED_RASTER)) {
        if (!isKept(PICTURES_KEPT, file)) {
          found.push(`${relative(file)}: ${match[1]}`);
        }
      }
    }

    expect(found).toEqual([]);
  });

  test("no frontend shows an SVG file as a picture, but the pictures kept on purpose", () => {
    const found: Array<string> = [];

    for (const [file, source] of FRONTEND_SOURCES) {
      for (const match of source.matchAll(IMPORTED_SVG_FILE)) {
        if (!isKept(PICTURES_KEPT, file)) {
          found.push(`${relative(file)}: ${match[1]}`);
        }
      }
    }

    expect(found).toEqual([]);
  });

  test("no frontend draws an icon as an SVG data URL", () => {
    const found: Array<string> = [];

    for (const [file, source] of FRONTEND_SOURCES) {
      if (source.includes(SVG_DATA_URL) && !isKept(SVG_DATA_URLS_KEPT, file)) {
        found.push(relative(file));
      }
    }

    expect(found).toEqual([]);
  });

  test("every picture kept on purpose is still there, and says why", () => {
    for (const entry of [
      ...PICTURES_KEPT,
      ...SVG_DATA_URLS_KEPT,
      ...MULTICOLOUR_KEPT,
    ]) {
      expect({
        file: entry.file,
        exists: fs.existsSync(path.join(REPOSITORY, entry.file)),
      }).toEqual({ file: entry.file, exists: true });
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  test("the logo images of other companies are gone from the frontends' images", () => {
    expect(
      fs.existsSync(
        path.join(PACKAGES, "Common", "UI", "Images", "ProviderLogos"),
      ),
    ).toBe(false);
  });
});

describe("no mark is drawn in several colours", () => {
  test("no frontend drawing paints with two or more colours, but those kept on purpose", () => {
    const found: Array<string> = [];

    for (const [file, source] of FRONTEND_SOURCES) {
      if (!file.endsWith(".tsx") || isKept(MULTICOLOUR_KEPT, file)) {
        continue;
      }

      for (const block of svgBlocks(source)) {
        const colours: Array<string> = literalColours(block);

        if (colours.length >= 2) {
          found.push(`${relative(file)}: ${colours.join(" ")}`);
        }
      }
    }

    expect(found).toEqual([]);
  });

  test("each drawing kept in colour on purpose still is one", () => {
    for (const entry of MULTICOLOUR_KEPT) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY, entry.file),
        "utf8",
      );
      const multicoloured: boolean = svgBlocks(source).some(
        (block: string): boolean => {
          return literalColours(block).length >= 2;
        },
      );

      expect({ file: entry.file, multicoloured }).toEqual({
        file: entry.file,
        multicoloured: true,
      });
    }
  });

  test("the guard reads a drawing's colours, and leaves one colour alone", () => {
    expect(
      literalColours(
        '<svg><rect fill="#f25022" /><rect fill="#7FBA00" /><path stroke="currentColor" /></svg>',
      ),
    ).toEqual(["#7fba00", "#f25022"]);
    expect(
      literalColours('<svg fill="currentColor"><path d="M0 0" /></svg>'),
    ).toEqual([]);
    expect(
      literalColours('<svg><stop stopColor={"rgb(1, 2, 3)"} /></svg>'),
    ).toEqual(["rgb(1,2,3)"]);
    expect(
      svgBlocks("a <svg>one</svg> b <svg x>two</svg> <svg unterminated"),
    ).toEqual(["<svg>one</svg>", "<svg x>two</svg>"]);
  });
});

describe("emails", () => {
  /*
   * Mail clients do not draw inline SVG (Gmail drops it, Outlook does not
   * render it): an email's only image of its own is OneUptime's logo, a PNG
   * it carries as an attachment (OfflineAssetHygiene holds that).
   */
  test("no email template draws an SVG", () => {
    const templates: Array<string> = [];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else {
          templates.push(full);
        }
      }
    };

    walk(EMAIL_TEMPLATES);

    const found: Array<string> = templates
      .filter((file: string): boolean => {
        return fs.readFileSync(file, "utf8").toLowerCase().includes("<svg");
      })
      .map(relative);

    expect(templates.length).toBeGreaterThan(50);
    expect(found).toEqual([]);
  });
});

describe("no logo is fetched from another address", () => {
  test("no frontend source names a remote picture or a logo service", () => {
    const remote: Array<string> = [];

    for (const [file, source] of FRONTEND_SOURCES) {
      for (const match of source.matchAll(QUOTED_ADDRESS)) {
        const address: string = match[1] || "";

        if (isRemotePicture(address)) {
          remote.push(`${relative(file)}: ${address}`);
        }
      }
    }

    expect(remote).toEqual([]);
  });

  test("the guard tells a remote picture from an address that is not one", () => {
    expect(isRemotePicture("https://brand.test/logo.svg")).toBe(true);
    expect(isRemotePicture("https://brand.test/a/b/mark.PNG")).toBe(true);
    expect(isRemotePicture("https://logo.clearbit.com/slack.com")).toBe(true);
    expect(isRemotePicture("https://cdn.simpleicons.org/slack")).toBe(true);
    expect(isRemotePicture("https://brand.test/docs/slack")).toBe(false);
    expect(isRemotePicture("https://slack.com/apps")).toBe(false);
    // A script of OneUptime's own is not a picture.
    expect(
      isRemotePicture(
        "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/x.sh",
      ),
    ).toBe(false);
    // An example domain's placeholder loads nothing.
    expect(isRemotePicture("https://example.com/oneuptime.png")).toBe(false);
    expect(isRemotePicture("https://cdn.example.org/logo.svg")).toBe(false);
    expect(isRemotePicture("https://example.company.test/logo.svg")).toBe(
      true,
    );
    expect(isRemotePicture("/dashboard/logo.svg")).toBe(false);
    expect(isRemotePicture("not an address")).toBe(false);
    // A host that only looks like a logo service is not one.
    expect(isRemotePicture("https://logo.clearbit.com.example.org/x")).toBe(
      false,
    );
  });

  test("the guard finds a quoted address, and leaves prose alone", () => {
    const found: Array<string> = Array.from(
      'src="https://cdn.simpleicons.org/slack" // see https://x.test/a.png'.matchAll(
        QUOTED_ADDRESS,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] || "";
    });

    expect(found).toEqual(["https://cdn.simpleicons.org/slack"]);
  });
});
