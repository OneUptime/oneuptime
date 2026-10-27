import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
} from "../../../../Types/ProviderLogo/ProviderLogo";
import {
  PROVIDER_LOGO_FILE_LOADERS,
  WIDE_PROVIDER_LOGOS,
  getLoadedProviderLogoFile,
  getProviderLogoFileName,
  hasDarkProviderLogoMark,
  isWideProviderLogo,
  loadProviderLogoFile,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoAssets";

/*
 * The official logos are files of the installation (official logos audit):
 * every logo the product names has its file, every file is one the product
 * names and the README says where it comes from, and no file reaches for
 * anything outside itself - an installation without the internet draws
 * every logo, and no brand learns who opened a page.
 */

const COMMON: string = path.join(__dirname, "..", "..", "..", "..");
const LOGOS_DIRECTORY: string = path.join(COMMON, "UI", "Images", "ProviderLogos");
const ASSETS_SOURCE: string = path.join(
  COMMON,
  "UI",
  "Components",
  "ProviderLogo",
  "ProviderLogoAssets.ts",
);
const README: string = fs.readFileSync(
  path.join(LOGOS_DIRECTORY, "README.md"),
  "utf8",
);

const SVG_FILE: RegExp = /\.svg$/;
const DARK_FILE: RegExp = /-dark\.svg$/;
const ROOT_TAG: RegExp = /<svg\b[^>]*>/;
const VIEW_BOX: RegExp = /\sviewBox="([^"]+)"/;
const VIEW_BOX_SEPARATOR: RegExp = /[\s,]+/;
const SVG_NAMESPACE: RegExp = /\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/;
const ANY_URL: RegExp = /[a-z][a-z0-9+.-]*:\/\/[^\s"')<>]+/gi;
const HREF_VALUE: RegExp = /(?:^|[\s:])href\s*=\s*["']([^"']*)["']/g;
const CSS_URL: RegExp = /url\(\s*['"]?([^'")]*)/g;
const EVENT_ATTRIBUTE: RegExp = /\son[a-z]+\s*=/i;
const FORBIDDEN_ELEMENT: RegExp =
  /<(?:script|image|foreignObject|iframe|object|embed|audio|video)\b/i;
const CSS_IMPORT: RegExp = /@import\b/i;
const DATA_URL: RegExp = /\bdata:/i;
const LOADER_ENTRY: RegExp =
  /"([^"]+)": \(\) => \{\s*return import\("\.\.\/\.\.\/Images\/ProviderLogos\/([^"]+)"\);\s*\}/g;
const README_FILE: RegExp = /`([a-z0-9-]+\.svg)`/g;

// The namespaces an SVG declares are names, not addresses anything loads.
const NAMESPACES: ReadonlyArray<string> = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
];

// Small enough that a page of twenty logos weighs less than one photo.
const MAX_FILE_BYTES: number = 12 * 1024;

const FILES_ON_DISK: Array<string> = fs
  .readdirSync(LOGOS_DIRECTORY)
  .filter((name: string): boolean => {
    return SVG_FILE.test(name);
  })
  .sort();

function readLogo(fileName: string): string {
  return fs.readFileSync(path.join(LOGOS_DIRECTORY, fileName), "utf8");
}

function viewBoxOf(svg: string): Array<number> {
  const root: string = (svg.match(ROOT_TAG) || [""])[0];
  const viewBox: string = (root.match(VIEW_BOX) || ["", ""])[1] || "";

  return viewBox
    .trim()
    .split(VIEW_BOX_SEPARATOR)
    .map((part: string): number => {
      return Number(part);
    });
}

function registeredFileNames(): Array<string> {
  const names: Array<string> = [];

  for (const logo of ALL_PROVIDER_LOGOS) {
    names.push(getProviderLogoFileName(logo, false));

    if (hasDarkProviderLogoMark(logo)) {
      names.push(getProviderLogoFileName(logo, true));
    }
  }

  return names.sort();
}

describe("every logo has its file", () => {
  test.each(ALL_PROVIDER_LOGOS)(
    "%s.svg is in Common/UI/Images/ProviderLogos and has a loader",
    (logo: ProviderLogo) => {
      const fileName: string = getProviderLogoFileName(logo, false);

      expect(fileName).toBe(`${logo}.svg`);
      expect(FILES_ON_DISK).toContain(fileName);
      expect(typeof PROVIDER_LOGO_FILE_LOADERS[fileName]).toBe("function");
    },
  );

  test("a logo's mark for dark backgrounds is its file name with -dark", () => {
    expect(getProviderLogoFileName(ProviderLogo.OpenAI, true)).toBe(
      "openai-dark.svg",
    );
    expect(getProviderLogoFileName(ProviderLogo.OpenAI, false)).toBe(
      "openai.svg",
    );
  });

  test("a dark mark is there exactly when its file is", () => {
    for (const logo of ALL_PROVIDER_LOGOS) {
      expect({
        logo,
        hasDarkMark: hasDarkProviderLogoMark(logo),
      }).toEqual({
        logo,
        hasDarkMark: FILES_ON_DISK.includes(`${logo}-dark.svg`),
      });
    }
  });

  test("the brands whose mark disappears on the dark theme have a dark mark", () => {
    // Black or dark-navy marks, on the dark theme's #172033 surface.
    for (const logo of [
      ProviderLogo.Aws,
      ProviderLogo.OpenAI,
      ProviderLogo.Anthropic,
      ProviderLogo.Okta,
      ProviderLogo.Ollama,
      ProviderLogo.Splunk,
      ProviderLogo.CrowdStrike,
      ProviderLogo.BetterStack,
      ProviderLogo.Rust,
      ProviderLogo.Mattermost,
      ProviderLogo.MicrosoftCopilot,
      // Zoom's thin blue wordmark: white on dark, as Zoom shows it there.
      ProviderLogo.Zoom,
    ]) {
      expect({ logo, hasDarkMark: hasDarkProviderLogoMark(logo) }).toEqual({
        logo,
        hasDarkMark: true,
      });
    }

    // A colour mark that reads on dark keeps it: no needless second file.
    for (const logo of [
      ProviderLogo.Slack,
      ProviderLogo.MicrosoftTeams,
      ProviderLogo.GoogleCloud,
      ProviderLogo.PagerDuty,
    ]) {
      expect({ logo, hasDarkMark: hasDarkProviderLogoMark(logo) }).toEqual({
        logo,
        hasDarkMark: false,
      });
    }
  });
});

describe("every file is one a logo uses", () => {
  test("the folder holds exactly the registered files: no stray, no missing", () => {
    expect(FILES_ON_DISK).toEqual(registeredFileNames());
  });

  test("the loaders are exactly the files on disk", () => {
    expect(Object.keys(PROVIDER_LOGO_FILE_LOADERS).sort()).toEqual(
      FILES_ON_DISK,
    );
  });

  test("each loader imports the file it is named after", () => {
    const source: string = fs.readFileSync(ASSETS_SOURCE, "utf8");
    const entries: Array<[string, string]> = Array.from(
      source.matchAll(LOADER_ENTRY),
    ).map((match: RegExpMatchArray): [string, string] => {
      return [match[1] || "", match[2] || ""];
    });

    // The bundler splits out only an image whose full name it can read.
    expect(entries.length).toBe(Object.keys(PROVIDER_LOGO_FILE_LOADERS).length);

    for (const [key, importedFile] of entries) {
      expect({ key, importedFile }).toEqual({ key, importedFile: key });
    }
  });

  test("every dark mark belongs to a logo", () => {
    for (const fileName of FILES_ON_DISK.filter((name: string): boolean => {
      return DARK_FILE.test(name);
    })) {
      const logo: string = fileName.replace(DARK_FILE, "");

      expect(ALL_PROVIDER_LOGOS as ReadonlyArray<string>).toContain(logo);
    }
  });

  test("a dark mark is not a copy of its light one", () => {
    for (const logo of ALL_PROVIDER_LOGOS.filter(hasDarkProviderLogoMark)) {
      expect(readLogo(getProviderLogoFileName(logo, true))).not.toBe(
        readLogo(getProviderLogoFileName(logo, false)),
      );
    }
  });
});

describe("every file says where it comes from", () => {
  test("the README lists every file, and every file it lists exists", () => {
    const listed: Array<string> = Array.from(README.matchAll(README_FILE))
      .map((match: RegExpMatchArray): string => {
        return match[1] || "";
      })
      .sort();

    expect(Array.from(new Set(listed)).sort()).toEqual(FILES_ON_DISK);
  });

  test("the README names the rules: official, unaltered, local, named", () => {
    for (const rule of [
      "**Official.**",
      "**Unaltered.**",
      "**Local.**",
      "**Named.**",
    ]) {
      expect(README).toContain(rule);
    }
  });
});

describe.each(FILES_ON_DISK)("%s", (fileName: string) => {
  const svg: string = readLogo(fileName);

  test("is a small SVG document an <img> can draw", () => {
    expect(Buffer.byteLength(svg, "utf8")).toBeLessThanOrEqual(MAX_FILE_BYTES);
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).toMatch(SVG_NAMESPACE);
  });

  test("has a viewBox, so it scales to any tile without losing its shape", () => {
    const viewBox: Array<number> = viewBoxOf(svg);

    expect(viewBox.length).toBe(4);

    for (const value of viewBox) {
      expect(Number.isFinite(value)).toBe(true);
    }

    expect(viewBox[2]).toBeGreaterThan(0);
    expect(viewBox[3]).toBeGreaterThan(0);
  });

  test("loads nothing from anywhere: no address, no script, no embedded image", () => {
    const addresses: Array<string> = Array.from(svg.matchAll(ANY_URL)).map(
      (match: RegExpMatchArray): string => {
        return match[0];
      },
    );

    for (const address of addresses) {
      expect(NAMESPACES).toContain(address);
    }

    for (const match of svg.matchAll(HREF_VALUE)) {
      // Only a reference inside the file itself (a gradient's #id).
      expect((match[1] || "").startsWith("#")).toBe(true);
    }

    for (const match of svg.matchAll(CSS_URL)) {
      expect((match[1] || "").startsWith("#")).toBe(true);
    }

    expect(svg).not.toMatch(FORBIDDEN_ELEMENT);
    expect(svg).not.toMatch(EVENT_ATTRIBUTE);
    expect(svg).not.toMatch(CSS_IMPORT);
    expect(svg).not.toMatch(DATA_URL);
  });
});

describe("wide logos", () => {
  test("the wide logos are the ones wider than they are tall, and only they", () => {
    for (const logo of ALL_PROVIDER_LOGOS) {
      const viewBox: Array<number> = viewBoxOf(
        readLogo(getProviderLogoFileName(logo, false)),
      );
      const ratio: number = (viewBox[2] || 1) / (viewBox[3] || 1);

      expect({ logo, isWide: isWideProviderLogo(logo) }).toEqual({
        logo,
        isWide: ratio > 1.3,
      });
    }
  });

  test("every wide logo is a logo", () => {
    for (const logo of WIDE_PROVIDER_LOGOS) {
      expect(ALL_PROVIDER_LOGOS).toContain(logo);
    }
  });
});

describe("loading a file", () => {
  const loaders: Record<string, () => Promise<{ default: unknown }>> =
    PROVIDER_LOGO_FILE_LOADERS as Record<
      string,
      () => Promise<{ default: unknown }>
    >;
  const added: Array<string> = [];

  function addLoader(
    fileName: string,
    loader: () => Promise<{ default: unknown }>,
  ): void {
    loaders[fileName] = loader;
    added.push(fileName);
  }

  afterEach(() => {
    for (const fileName of added.splice(0)) {
      delete loaders[fileName];
    }
  });

  test("a file no logo has is no address", async () => {
    expect(await loadProviderLogoFile("no-such-logo.svg")).toBeUndefined();
    expect(getLoadedProviderLogoFile("no-such-logo.svg")).toBeUndefined();
  });

  test("the test run's stand-in for images is no address: the tile is drawn without a mark", async () => {
    expect(await loadProviderLogoFile("amazon-s3.svg")).toBeUndefined();
    expect(getLoadedProviderLogoFile("amazon-s3.svg")).toBeUndefined();
  });

  test("a file is loaded once, however many logos ask for it at once, and kept", async () => {
    let calls: number = 0;

    addLoader("test-once.svg", async () => {
      calls++;
      return { default: "data:image/svg+xml;base64,b25jZQ==" };
    });

    const [first, second] = await Promise.all([
      loadProviderLogoFile("test-once.svg"),
      loadProviderLogoFile("test-once.svg"),
    ]);

    expect(first).toBe("data:image/svg+xml;base64,b25jZQ==");
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(getLoadedProviderLogoFile("test-once.svg")).toBe(first);

    // Asked again later, it is drawn from what was kept.
    expect(await loadProviderLogoFile("test-once.svg")).toBe(first);
    expect(calls).toBe(1);
  });

  test("a file that fails to load is asked for again the next time", async () => {
    let calls: number = 0;

    addLoader("test-retry.svg", async () => {
      calls++;

      if (calls === 1) {
        throw new Error("The connection dropped");
      }

      return { default: "data:image/svg+xml;base64,cmV0cnk=" };
    });

    expect(await loadProviderLogoFile("test-retry.svg")).toBeUndefined();
    expect(getLoadedProviderLogoFile("test-retry.svg")).toBeUndefined();
    expect(await loadProviderLogoFile("test-retry.svg")).toBe(
      "data:image/svg+xml;base64,cmV0cnk=",
    );
    expect(calls).toBe(2);
  });

  test("an empty or non-text module is no address", async () => {
    addLoader("test-empty.svg", async () => {
      return { default: "" };
    });
    addLoader("test-object.svg", async () => {
      return { default: {} };
    });

    expect(await loadProviderLogoFile("test-empty.svg")).toBeUndefined();
    expect(await loadProviderLogoFile("test-object.svg")).toBeUndefined();
  });
});
