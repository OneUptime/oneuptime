import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
} from "../../../../Types/ProviderLogo/ProviderLogo";

/*
 * Official logos audit, product-wide rules:
 *
 *  - every logo the registry ships is drawn somewhere: a catalog, a page or
 *    a component names it, so no file sits in the installation for nothing;
 *  - the logo files are reached through one loader table
 *    (ProviderLogoAssets), so every logo loads on its own, only when a page
 *    draws it, and is held to the files' tests;
 *  - nothing in the product's frontends loads a picture from another
 *    address: a logo is part of the installation, so an installation
 *    without the internet draws every one, and no brand learns who opened
 *    a page (#5127 made the email logo an inline attachment for the same
 *    reason).
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

// The Enterprise Edition's frontends, where ee/ is present (CI removes it for Common Test).
const EE_SOURCES: Array<string> = fs.existsSync(EE)
  ? [path.join(EE, "Dashboard"), path.join(EE, "AdminDashboard")]
  : [];

const REGISTRY: string = path.join(
  PACKAGES,
  "Common",
  "Types",
  "ProviderLogo",
  "ProviderLogo.ts",
);

const LOADER_TABLE: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Components",
  "ProviderLogo",
  "ProviderLogoAssets.ts",
);

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
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
const LOGO_FOLDER_IMPORT: string = "Images/ProviderLogos/";

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

const FILES: Array<string> = [...PRODUCT_SOURCES, ...EE_SOURCES].flatMap(
  sourceFiles,
);

const SOURCES: Map<string, string> = new Map(
  FILES.map((file: string): [string, string] => {
    return [file, fs.readFileSync(file, "utf8")];
  }),
);

function relative(file: string): string {
  return path.relative(REPOSITORY, file);
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

describe("the logos the product ships", () => {
  test("the walk reads the product's frontends, so the rules below are not vacuous", () => {
    expect(FILES.length).toBeGreaterThan(1000);
    expect(SOURCES.has(LOADER_TABLE)).toBe(true);
  });

  test.each(ALL_PROVIDER_LOGOS)("%s is drawn somewhere in the product", (logo: ProviderLogo) => {
    const member: string | undefined = Object.keys(ProviderLogo).find(
      (key: string): boolean => {
        return (ProviderLogo as Record<string, string>)[key] === logo;
      },
    );

    expect(member).toBeDefined();

    const reference: string = `ProviderLogo.${member}`;
    const users: Array<string> = [];

    for (const [file, source] of SOURCES) {
      if (file === REGISTRY || file === LOADER_TABLE) {
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
  });

  test("only the loader table reaches into the logos' folder", () => {
    const readers: Array<string> = [];

    for (const [file, source] of SOURCES) {
      if (source.includes(LOGO_FOLDER_IMPORT)) {
        readers.push(relative(file));
      }
    }

    expect(readers).toEqual([relative(LOADER_TABLE)]);
  });
});

describe("no logo is fetched from another address", () => {
  test("no frontend source names a remote picture or a logo service", () => {
    const remote: Array<string> = [];

    for (const [file, source] of SOURCES) {
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
