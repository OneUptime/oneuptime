import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ARABIC SCRIPT IN ONEUPTIME'S OWN FONT.
 *
 * Inter has no Arabic letters, so an Arabic or Persian page used to draw its
 * words in whatever font the reader's system had: a different face, height
 * and weight on every machine, and on some no medium or semibold at all.
 * Every page now declares a second 'Inter' face, Vazirmatn's Arabic subset,
 * with an Arabic unicode-range: a font list that names Inter draws Arabic
 * script in it, and only a page that shows an Arabic letter downloads it.
 * Served from the install itself, never a font CDN.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..");
const FONT_NAME: string = "VazirmatnArabicVariable.woff2";

type Page = {
  file: string;
  fontPrefix: string;
  fontDirectory: string;
};

const PAGES: Array<Page> = [
  {
    file: "App/FeatureSet/Dashboard/views/index.ejs",
    fontPrefix: "/dashboard/assets/fonts/",
    fontDirectory: "App/FeatureSet/Dashboard/public/assets/fonts",
  },
  {
    file: "App/FeatureSet/Accounts/views/index.ejs",
    fontPrefix: "/accounts/assets/fonts/",
    fontDirectory: "App/FeatureSet/Accounts/public/assets/fonts",
  },
  {
    file: "App/FeatureSet/AdminDashboard/views/index.ejs",
    fontPrefix: "/admin/assets/fonts/",
    fontDirectory: "App/FeatureSet/AdminDashboard/public/assets/fonts",
  },
  {
    file: "App/FeatureSet/PublicDashboard/views/index.ejs",
    fontPrefix: "/public-dashboard/assets/fonts/",
    fontDirectory: "App/FeatureSet/PublicDashboard/public/assets/fonts",
  },
  {
    file: "App/FeatureSet/StatusPage/views/index.ejs",
    fontPrefix: "/status-page/assets/fonts/",
    fontDirectory: "App/FeatureSet/StatusPage/public/assets/fonts",
  },
  {
    file: "Common/Server/Views/Partials/Head.ejs",
    fontPrefix: "/oneuptime-assets/fonts/",
    fontDirectory: "Common/Server/Static/Vendor/fonts",
  },
  {
    file: "App/FeatureSet/Identity/Views/Partials/Head.ejs",
    fontPrefix: "/oneuptime-assets/fonts/",
    fontDirectory: "Common/Server/Static/Vendor/fonts",
  },
];

const LOCALE_DIRECTORIES: Array<string> = [
  "App/FeatureSet/Dashboard/src/Locales",
  "App/FeatureSet/StatusPage/src/Locales",
  "App/FeatureSet/Accounts/src/Locales",
  "App/FeatureSet/AdminDashboard/src/Locales",
  "App/FeatureSet/PublicDashboard/src/Locales",
  "Common/Server/Locales",
];

const RIGHT_TO_LEFT_LOCALES: Array<string> = ["ar", "fa"];

const read: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(path.join(PACKAGES, relative), "utf8");
};

// Every @font-face block of a page, as its body text.
const fontFaces: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const faces: Array<string> = [];
  const pattern: RegExp = /@font-face\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    faces.push(match[1]!);
    match = pattern.exec(source);
  }

  return faces;
};

type CodePointRange = [number, number];

const parseUnicodeRange: (face: string) => Array<CodePointRange> = (
  face: string,
): Array<CodePointRange> => {
  const declaration: RegExpMatchArray | null = face.match(
    /unicode-range:\s*([^;]+);/,
  );

  if (!declaration) {
    return [];
  }

  return declaration[1]!.split(",").map((part: string): CodePointRange => {
    const [start, end] = part.trim().replace(/^U\+/i, "").split("-") as [
      string,
      string | undefined,
    ];

    return [parseInt(start, 16), parseInt(end || start, 16)];
  });
};

const isCovered: (
  codePoint: number,
  ranges: Array<CodePointRange>,
) => boolean = (codePoint: number, ranges: Array<CodePointRange>): boolean => {
  return ranges.some((range: CodePointRange): boolean => {
    return codePoint >= range[0] && codePoint <= range[1];
  });
};

const arabicFace: (source: string) => string | undefined = (
  source: string,
): string | undefined => {
  return fontFaces(source).find((face: string): boolean => {
    return face.includes(FONT_NAME);
  });
};

// Every string of a locale tree.
const leaves: (tree: unknown) => Array<string> = (
  tree: unknown,
): Array<string> => {
  if (typeof tree === "string") {
    return [tree];
  }

  if (tree && typeof tree === "object") {
    return Object.values(tree as Record<string, unknown>).flatMap(leaves);
  }

  return [];
};

// Arabic-script letters and marks: the blocks a font has to draw them from.
const ARABIC_SCRIPT: RegExp =
  /[\u0600-\u06FF\u0750-\u077F\u0870-\u089F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;

describe("Arabic script in OneUptime's own font", () => {
  const ranges: Array<CodePointRange> = parseUnicodeRange(
    arabicFace(read(PAGES[0]!.file)) || "",
  );

  test.each(PAGES)(
    "$file declares Vazirmatn as an Arabic-script face of Inter, after Inter's own",
    (page: Page) => {
      const source: string = read(page.file);
      const faces: Array<string> = fontFaces(source);
      const interIndex: number = faces.findIndex((face: string): boolean => {
        return face.includes("InterVariable.woff2");
      });
      const arabicIndex: number = faces.findIndex((face: string): boolean => {
        return face.includes(FONT_NAME);
      });

      expect(interIndex).toBeGreaterThanOrEqual(0);
      // Later faces are tried first for a letter both could draw.
      expect(arabicIndex).toBeGreaterThan(interIndex);

      const face: string = faces[arabicIndex]!;

      expect(face).toMatch(/font-family:\s*'Inter';/);
      expect(face).toMatch(/font-weight:\s*100 900;/);
      expect(face).toMatch(/font-display:\s*swap;/);
      expect(face).toContain(
        `url('${page.fontPrefix}${FONT_NAME}') format('woff2') tech('variations')`,
      );
      expect(face).toContain(
        `url('${page.fontPrefix}${FONT_NAME}') format('woff2-variations')`,
      );
      // The same letters on every page.
      expect(parseUnicodeRange(face)).toEqual(ranges);
      // Inter's own face draws every other letter: it has no range.
      expect(faces[interIndex]).not.toContain("unicode-range");
    },
  );

  test("only Arabic script is in the range: an English page never downloads it", () => {
    expect(ranges.length).toBeGreaterThan(0);

    // Latin, digits, punctuation, the isolates and marks the product writes.
    const english: Array<number> = [
      ...Array.from({ length: 0x250 }, (_value: unknown, index: number) => {
        return index;
      }),
      0x2010,
      0x2011,
      0x2013,
      0x2014,
      0x2018,
      0x2019,
      0x201c,
      0x201d,
      0x2026,
      0x200e,
      0x200f,
      0x2066,
      0x2067,
      0x2068,
      0x2069,
      0x00b7,
      0x20ac,
    ];

    expect(
      english.filter((codePoint: number): boolean => {
        return isCovered(codePoint, ranges);
      }),
    ).toEqual([]);
  });

  test("the range covers every Arabic-script letter the Arabic and Persian locale files write", () => {
    const uncovered: Set<string> = new Set<string>();
    let letters: number = 0;

    for (const directory of LOCALE_DIRECTORIES) {
      for (const code of RIGHT_TO_LEFT_LOCALES) {
        const file: string = path.join(directory, `${code}.json`);

        for (const text of leaves(JSON.parse(read(file)))) {
          for (const character of text) {
            if (!ARABIC_SCRIPT.test(character)) {
              continue;
            }

            letters++;

            if (!isCovered(character.codePointAt(0)!, ranges)) {
              uncovered.add(
                `U+${character.codePointAt(0)!.toString(16).toUpperCase()} in ${file}`,
              );
            }
          }
        }
      }
    }

    expect(letters).toBeGreaterThan(1000);
    expect([...uncovered]).toEqual([]);
  });

  test("the range keeps the joiners Persian words are written with inside the face", () => {
    /*
     * ZWNJ (U+200C) splits a Persian word without a space; drawn by another
     * font it would break the word's shaping.
     */
    expect(isCovered(0x200c, ranges)).toBe(true);
    expect(isCovered(0x200d, ranges)).toBe(true);
  });

  test("every page's font file is there, a woff2, small, and the same file everywhere", () => {
    const directories: Array<string> = Array.from(
      new Set<string>(
        PAGES.map((page: Page): string => {
          return page.fontDirectory;
        }),
      ),
    );
    const copies: Array<Buffer> = directories.map(
      (directory: string): Buffer => {
        return fs.readFileSync(path.join(PACKAGES, directory, FONT_NAME));
      },
    );

    expect(directories).toHaveLength(6);

    for (const copy of copies) {
      expect(copy.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(copy.byteLength).toBeGreaterThan(10_000);
      expect(copy.byteLength).toBeLessThan(64 * 1024);
      expect(copy.equals(copies[0]!)).toBe(true);
    }
  });

  test("the vendored assets README lists the font and its licence", () => {
    const readme: string = read("Common/Server/Static/Vendor/README.md");

    expect(readme).toContain(`fonts/${FONT_NAME}`);
    expect(readme).toContain("SIL Open Font License 1.1");
  });

  test("no page loads it from a font CDN", () => {
    for (const page of PAGES) {
      const face: string = arabicFace(read(page.file)) || "";

      expect(face).not.toMatch(/https?:\/\//);
    }
  });
});
