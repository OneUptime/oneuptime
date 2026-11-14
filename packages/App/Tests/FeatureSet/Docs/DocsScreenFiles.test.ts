import {
  DOCS_SCREENS,
  DOCS_SCREEN_FIXTURES,
  DOCS_SCREEN_LANGUAGES,
  DocsScreen,
  DocsScreenFixture,
} from "../../../FeatureSet/Docs/Screens/DocsScreenList";
import {
  continuesFrom,
  DocsScreenManifest,
  FALLBACK_LANGUAGE,
  MANIFEST_PATH,
  manifestOfFiles,
  planLanguages,
  readManifest,
  resolveScreen,
  SCREEN_PIXEL_RATIO,
  screenAddress,
  screenFile,
  screenNameOf,
  SCREENS_FOLDER,
  screenUrl,
  sortedManifest,
  STATIC_FOLDER,
  webpSize,
  withScreenAddresses,
  cachedManifest,
} from "../../../FeatureSet/Docs/Screens/DocsScreenFiles";
import { DocsScreenFingerprints } from "../../../FeatureSet/Docs/Screens/DocsScreenFingerprint";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Where the docs' screenshots live and which one a page shows (#6823,
 * Docs/Screens/DocsScreenFiles.ts): the file names the regenerate command
 * writes, the English fallback for a language a fixture cannot draw, the
 * manifest the docs read, and - on the real files - that every shot has its
 * pictures, at its size, within the weight measured for them.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const FINGERPRINTS: string = path.join(
  REPO_ROOT,
  "packages/E2E/DocsScreens/Fingerprints",
);

/*
 * What the pictures may weigh, from what they weighed when they were first
 * drawn (packages/E2E/DocsScreens/README.md has the numbers): a picture
 * that outgrows these was cropped too loosely.
 */
const MAX_PICTURE_BYTES: number = 200 * 1024;
const MAX_TOTAL_BYTES: number = 24 * 1024 * 1024;

const FIXTURE: DocsScreenFixture = {
  folder: "Somewhere",
  server: "Somewhere/Fixture/server.js",
  portVariable: "SOMEWHERE_PORT",
  port: 1,
  languageBy: "storage",
  languages: "every",
  projectId: "10000000-0000-4000-8000-000000000001",
  now: "2026-11-11T10:00:00.000Z",
};

const SHOT: DocsScreen = {
  name: "a-shot",
  shows: "Something worth a picture",
  fixture: "Somewhere",
  page: "MONITOR_VIEW",
  path: "/dashboard/:projectId/monitors/:id",
  params: { id: "50000000-0000-4000-8000-000000000001" },
  query: "?seed=monitor",
  width: 1280,
  height: 900,
  state: [{ press: "Continue" }],
  crop: "main",
  padding: 0,
};

// The first bytes of a WebP picture of each kind, with a given size.
function lossy(width: number, height: number): Buffer {
  const data: Buffer = Buffer.alloc(40);
  data.write("RIFF", 0, "ascii");
  data.write("WEBP", 8, "ascii");
  data.write("VP8 ", 12, "ascii");
  data[23] = 0x9d;
  data[24] = 0x01;
  data[25] = 0x2a;
  data.writeUInt16LE(width, 26);
  data.writeUInt16LE(height, 28);
  return data;
}

function lossless(width: number, height: number): Buffer {
  const data: Buffer = Buffer.alloc(40);
  data.write("RIFF", 0, "ascii");
  data.write("WEBP", 8, "ascii");
  data.write("VP8L", 12, "ascii");
  data[20] = 0x2f;
  data.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  return data;
}

function extended(width: number, height: number): Buffer {
  const data: Buffer = Buffer.alloc(40);
  data.write("RIFF", 0, "ascii");
  data.write("WEBP", 8, "ascii");
  data.write("VP8X", 12, "ascii");
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}

describe("a shot's files and address", () => {
  it("names a picture by language and shot, under the docs' static files", () => {
    expect(SCREENS_FOLDER).toBe("images/screens");
    expect(screenFile("de", "website-down-who")).toBe(
      "images/screens/de/website-down-who.webp",
    );
    expect(screenUrl("zh-TW", "paging-test")).toBe(
      "/docs/static/images/screens/zh-TW/paging-test.webp",
    );
    expect(MANIFEST_PATH).toBe(
      path.join(STATIC_FOLDER, "images", "screens", "manifest.json"),
    );
    expect(STATIC_FOLDER).toBe(
      path.join(REPO_ROOT, "packages/App/FeatureSet/Docs/Static"),
    );
  });

  it("reads a shot's name from a docs page's address, and nothing else", () => {
    expect(screenNameOf("screen:website-down-who")).toBe("website-down-who");
    expect(screenNameOf("screen:a1")).toBe("a1");
    expect(screenNameOf("screen:")).toBeNull();
    expect(screenNameOf("screen:Website")).toBeNull();
    expect(screenNameOf("screen:../manifest")).toBeNull();
    expect(screenNameOf("screen:a--b")).toBeNull();
    expect(screenNameOf("screen:a-")).toBeNull();
    expect(screenNameOf("/docs/static/images/x.png")).toBeNull();
  });

  it("opens the page's address in the fixture's project, with the shot's own parts", () => {
    expect(screenAddress(SHOT, FIXTURE, "en")).toBe(
      "/dashboard/10000000-0000-4000-8000-000000000001/monitors/50000000-0000-4000-8000-000000000001?seed=monitor",
    );
    // A fixture told by the language key: the address stays the same.
    expect(screenAddress(SHOT, FIXTURE, "de")).toBe(
      screenAddress(SHOT, FIXTURE, "en"),
    );
  });

  it("tells a fixture that reads the address the language, beside the shot's query", () => {
    const byQuery: DocsScreenFixture = { ...FIXTURE, languageBy: "query" };

    expect(screenAddress(SHOT, byQuery, "de")).toBe(
      "/dashboard/10000000-0000-4000-8000-000000000001/monitors/50000000-0000-4000-8000-000000000001?seed=monitor&lang=de",
    );
    // English is the fixture's own: no ?lang=.
    expect(screenAddress(SHOT, byQuery, "en")).not.toContain("lang=");
    expect(
      screenAddress({ ...SHOT, query: undefined }, byQuery, "zh-CN"),
    ).toMatch(/\?lang=zh-CN$/);
  });
});

describe("the languages a shot is drawn in", () => {
  it("draws every language a fixture with the Dashboard's own locales draws, English first", () => {
    expect(planLanguages(FIXTURE, DOCS_SCREEN_LANGUAGES)).toEqual({
      drawn: [...DOCS_SCREEN_LANGUAGES],
      english: [],
    });
  });

  it("shows the English picture in a language its fixture cannot draw", () => {
    const twoLanguages: DocsScreenFixture = {
      ...FIXTURE,
      languages: ["de", "fa"],
    };

    expect(planLanguages(twoLanguages, ["en", "de", "fr", "fa", "ja"])).toEqual(
      { drawn: ["en", "de", "fa"], english: ["fr", "ja"] },
    );
    // English is drawn even when a fixture does not list it.
    expect(planLanguages({ ...FIXTURE, languages: [] }, ["en", "de"])).toEqual({
      drawn: ["en"],
      english: ["de"],
    });
  });
});

describe("going on from the shot before", () => {
  it("goes on when the earlier shot's steps are where this one's start", () => {
    const next: DocsScreen = {
      ...SHOT,
      name: "next",
      state: [...SHOT.state, { press: "Save and continue" }],
    };

    expect(continuesFrom(SHOT, next)).toBe(true);
    expect(continuesFrom(SHOT, { ...SHOT, name: "same-state" })).toBe(true);
  });

  it("opens the page again for another page, window, query, or steps that part ways", () => {
    const next: DocsScreen = {
      ...SHOT,
      name: "next",
      state: [...SHOT.state, { press: "Save and continue" }],
    };

    expect(continuesFrom(null, next)).toBe(false);
    expect(continuesFrom(next, SHOT)).toBe(false);
    expect(continuesFrom(SHOT, { ...next, fixture: "Elsewhere" })).toBe(false);
    expect(
      continuesFrom(SHOT, { ...next, path: "/dashboard/:projectId/home/" }),
    ).toBe(false);
    expect(continuesFrom(SHOT, { ...next, params: { id: "another" } })).toBe(
      false,
    );
    expect(continuesFrom(SHOT, { ...next, query: "?billing=on" })).toBe(false);
    expect(continuesFrom(SHOT, { ...next, width: 390 })).toBe(false);
    expect(continuesFrom(SHOT, { ...next, height: 700 })).toBe(false);
    expect(
      continuesFrom(SHOT, {
        ...next,
        state: [{ press: "Skip" }, { press: "Continue" }],
      }),
    ).toBe(false);
  });
});

describe("which picture a page shows", () => {
  const manifest: DocsScreenManifest = {
    pixelRatio: 2,
    shots: {
      "both-languages": {
        en: { width: 780, height: 314 },
        de: { width: 780, height: 340 },
      },
      "english-only": { en: { width: 500, height: 200 } },
      "no-english": { de: { width: 500, height: 200 } },
    },
  };

  it("shows the page language's own picture, at its own size", () => {
    expect(resolveScreen(manifest, "both-languages", "de")).toEqual({
      src: "/docs/static/images/screens/de/both-languages.webp",
      lang: "de",
      width: 780,
      height: 340,
    });
    expect(resolveScreen(manifest, "both-languages", "en")?.height).toBe(314);
  });

  it("shows the English picture where the shot is not drawn in the page's language", () => {
    expect(resolveScreen(manifest, "english-only", "ja")).toEqual({
      src: "/docs/static/images/screens/en/english-only.webp",
      lang: FALLBACK_LANGUAGE,
      width: 500,
      height: 200,
    });
    expect(resolveScreen(manifest, "both-languages", "fr")?.lang).toBe("en");
  });

  it("shows nothing for a shot with no picture to fall back to", () => {
    expect(resolveScreen(manifest, "nowhere", "en")).toBeNull();
    expect(resolveScreen(manifest, "no-english", "fr")).toBeNull();
    expect(resolveScreen(manifest, "no-english", "de")?.lang).toBe("de");
  });
});

describe("a page handed out as Markdown", () => {
  const manifest: DocsScreenManifest = {
    pixelRatio: 2,
    shots: {
      "website-down-who": {
        en: { width: 780, height: 314 },
        de: { width: 780, height: 340 },
      },
    },
  };

  it("gets the picture's own address in place of the shot's, in the page's language or English", () => {
    const markdown: string =
      "### Step\n\n![Der Schritt](screen:website-down-who)\n\nText.";

    expect(withScreenAddresses(markdown, "de", manifest)).toBe(
      "### Step\n\n![Der Schritt](/docs/static/images/screens/de/website-down-who.webp)\n\nText.",
    );
    expect(withScreenAddresses(markdown, "ja", manifest)).toContain(
      "](/docs/static/images/screens/en/website-down-who.webp)",
    );
  });

  it("leaves a shot with no picture, and every other address, as written", () => {
    const markdown: string =
      "![x](screen:no-such-shot) [a link](/docs/guides/paging) ![y](/docs/static/images/monitors.png)";

    expect(withScreenAddresses(markdown, "en", manifest)).toBe(markdown);
  });

  it("reads the manifest on disk once, for the docs server", () => {
    expect(cachedManifest()).toBe(cachedManifest());
    expect(cachedManifest()).toEqual(readManifest());
  });
});

describe("the manifest", () => {
  it("reads a WebP picture's size from each kind of header, and nothing else", () => {
    expect(webpSize(lossy(1560, 628))).toEqual({ width: 1560, height: 628 });
    expect(webpSize(lossless(300, 200))).toEqual({ width: 300, height: 200 });
    expect(webpSize(extended(2400, 1200))).toEqual({
      width: 2400,
      height: 1200,
    });
    expect(
      webpSize(Buffer.from("not a picture at all, not at all")),
    ).toBeNull();
    const png: Buffer = Buffer.alloc(40);
    png.write("\u0089PNG", 0, "latin1");
    expect(webpSize(png)).toBeNull();
    const broken: Buffer = lossy(10, 10);
    broken[23] = 0;
    expect(webpSize(broken)).toBeNull();
  });

  it("is made from the pictures on disk: each shot's languages, at their size in CSS pixels", () => {
    const folder: string = fs.mkdtempSync(path.join(os.tmpdir(), "screens-"));
    const write: (file: string, data: Buffer) => void = (
      file: string,
      data: Buffer,
    ): void => {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(path.join(folder, file), data);
    };

    try {
      write(screenFile("en", "a-shot"), lossy(1560, 628));
      write(screenFile("de", "a-shot"), lossy(1560, 680));
      write(screenFile("en", "b-shot"), lossless(600, 400));
      // A picture of a shot the list does not have is not in the manifest.
      write(screenFile("en", "gone"), lossy(100, 100));

      const manifest: DocsScreenManifest = manifestOfFiles(
        [SHOT, { ...SHOT, name: "b-shot" }],
        ["en", "de", "fr"],
        folder,
      );

      expect(manifest).toEqual({
        pixelRatio: SCREEN_PIXEL_RATIO,
        shots: {
          "a-shot": {
            de: { width: 780, height: 340 },
            en: { width: 780, height: 314 },
          },
          "b-shot": { en: { width: 300, height: 200 } },
        },
      });

      write(screenFile("fr", "b-shot"), Buffer.from("not a webp, really not"));
      expect(() => {
        return manifestOfFiles([{ ...SHOT, name: "b-shot" }], ["fr"], folder);
      }).toThrow("is not a WebP picture");
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("is written in order, whatever order it was built in", () => {
    expect(
      JSON.stringify(
        sortedManifest({
          pixelRatio: 2,
          shots: {
            b: { fr: { width: 1, height: 2 }, de: { width: 3, height: 4 } },
            a: { en: { width: 5, height: 6 } },
          },
        }),
      ),
    ).toBe(
      JSON.stringify({
        pixelRatio: 2,
        shots: {
          a: { en: { width: 5, height: 6 } },
          b: { de: { width: 3, height: 4 }, fr: { width: 1, height: 2 } },
        },
      }),
    );
  });

  it("reads as empty where there is none yet", () => {
    expect(
      readManifest(path.join(os.tmpdir(), "no-such-manifest.json")),
    ).toEqual({ pixelRatio: SCREEN_PIXEL_RATIO, shots: {} });
  });
});

describe("the screenshots on disk", () => {
  const manifest: DocsScreenManifest = readManifest();

  it("agree with the manifest the docs read", () => {
    expect(manifest).toEqual(
      manifestOfFiles(DOCS_SCREENS, DOCS_SCREEN_LANGUAGES),
    );
  });

  it("have a picture of every shot in every language its fixture draws, and no other", () => {
    const expected: Array<string> = DOCS_SCREENS.flatMap((shot: DocsScreen) => {
      return planLanguages(
        DOCS_SCREEN_FIXTURES[shot.fixture]!,
        DOCS_SCREEN_LANGUAGES,
      ).drawn.map((lang: string): string => {
        return screenFile(lang, shot.name);
      });
    }).sort();
    const folder: string = path.join(STATIC_FOLDER, SCREENS_FOLDER);
    const onDisk: Array<string> = fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return entry.isDirectory();
      })
      .flatMap((entry: fs.Dirent): Array<string> => {
        return fs
          .readdirSync(path.join(folder, entry.name))
          .map((file: string): string => {
            return `${SCREENS_FOLDER}/${entry.name}/${file}`;
          });
      })
      .sort();

    expect(onDisk).toEqual(expected);
  });

  it("were drawn at twice their size in CSS pixels, each light enough to send", () => {
    let total: number = 0;

    for (const shot of DOCS_SCREENS) {
      for (const [lang, size] of Object.entries(
        manifest.shots[shot.name] || {},
      )) {
        const data: Buffer = fs.readFileSync(
          path.join(STATIC_FOLDER, screenFile(lang, shot.name)),
        );
        const pixels: { width: number; height: number } | null = webpSize(data);

        expect(pixels).not.toBeNull();
        expect(
          Math.abs(pixels!.width - size.width * SCREEN_PIXEL_RATIO),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(pixels!.height - size.height * SCREEN_PIXEL_RATIO),
        ).toBeLessThanOrEqual(1);
        expect({
          file: screenFile(lang, shot.name),
          light: data.length <= MAX_PICTURE_BYTES,
        }).toEqual({ file: screenFile(lang, shot.name), light: true });
        // Narrow enough to read in the docs' column, shrunk to it.
        expect(size.width).toBeLessThanOrEqual(1100);
        total += data.length;
      }
    }

    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it("each have the fingerprint the staleness check compares, and no shot that is gone keeps one", () => {
    const names: Set<string> = new Set(
      DOCS_SCREENS.map((shot: DocsScreen) => {
        return shot.name;
      }),
    );

    for (const lang of DOCS_SCREEN_LANGUAGES) {
      const file: string = path.join(FINGERPRINTS, `${lang}.json`);
      const fingerprints: DocsScreenFingerprints = fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf8")) as DocsScreenFingerprints)
        : {};

      for (const name of Object.keys(fingerprints)) {
        expect({ lang, name, listed: names.has(name) }).toEqual({
          lang,
          name,
          listed: true,
        });
      }

      for (const [name, sizes] of Object.entries(manifest.shots)) {
        if (sizes[lang]) {
          expect({
            lang,
            name,
            fingerprint: Boolean(fingerprints[name]),
          }).toEqual({
            lang,
            name,
            fingerprint: true,
          });
          expect(fingerprints[name]!.text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
