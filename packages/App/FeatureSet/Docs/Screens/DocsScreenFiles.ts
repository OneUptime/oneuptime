import fs from "fs";
import path from "path";
import { DocsScreen, DocsScreenFixture } from "./DocsScreenList";

/*
 * Where the docs' screenshots live, and which one a page in a language
 * shows (#6823).
 *
 *   Static/images/screens/<language>/<shot>.webp   one picture per shot and
 *                                                  language it is drawn in
 *   Static/images/screens/manifest.json            each shot's size in each
 *                                                  of those languages
 *
 * A language a shot's fixture cannot draw has no file of its own: its pages
 * show the English picture (resolveScreen). The renderer
 * (packages/E2E/DocsScreens) writes both; the docs server only reads the
 * manifest, once.
 */

// The folder under the docs' Static/, and the address it is served at.
export const SCREENS_FOLDER: string = "images/screens";
export const SCREENS_URL: string = `/docs/static/${SCREENS_FOLDER}`;
export const SCREEN_EXTENSION: string = "webp";
export const MANIFEST_FILE: string = "manifest.json";
// The language every shot is drawn in, and the one a missing language shows.
export const FALLBACK_LANGUAGE: string = "en";
// How a docs page names a shot: the address of a Markdown image.
export const SCREEN_SCHEME: string = "screen:";
// A shot's name: lower-case words joined by hyphens.
export const SCREEN_NAME: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The ratio of image pixels to CSS pixels every shot is drawn at.
export const SCREEN_PIXEL_RATIO: number = 2;

export interface DocsScreenSize {
  // In CSS pixels: the image is SCREEN_PIXEL_RATIO times as many.
  width: number;
  height: number;
}

export interface DocsScreenManifest {
  // The ratio of image pixels to CSS pixels.
  pixelRatio: number;
  // Shot -> language -> its size, for every language drawn in its own words.
  shots: Record<string, Record<string, DocsScreenSize>>;
}

// A shot's file, from Static/: "images/screens/de/website-down-check.webp".
export const screenFile: (lang: string, name: string) => string = (
  lang: string,
  name: string,
): string => {
  return `${SCREENS_FOLDER}/${lang}/${name}.${SCREEN_EXTENSION}`;
};

// The address a docs page loads a shot's picture from.
export const screenUrl: (lang: string, name: string) => string = (
  lang: string,
  name: string,
): string => {
  return `/docs/static/${screenFile(lang, name)}`;
};

// The shot a Markdown image's address names ("screen:<name>"), or null.
export const screenNameOf: (address: string) => string | null = (
  address: string,
): string | null => {
  if (!address.startsWith(SCREEN_SCHEME)) {
    return null;
  }

  const name: string = address.slice(SCREEN_SCHEME.length);

  return SCREEN_NAME.test(name) ? name : null;
};

/*
 * Which of the docs' languages a shot is drawn in, and which show the
 * English picture instead because its fixture cannot draw them. English is
 * always drawn, and first.
 */
export interface DocsScreenLanguagePlan {
  drawn: Array<string>;
  english: Array<string>;
}

export const planLanguages: (
  fixture: DocsScreenFixture,
  docsLanguages: ReadonlyArray<string>,
) => DocsScreenLanguagePlan = (
  fixture: DocsScreenFixture,
  docsLanguages: ReadonlyArray<string>,
): DocsScreenLanguagePlan => {
  const drawn: Array<string> = [FALLBACK_LANGUAGE];
  const english: Array<string> = [];

  for (const lang of docsLanguages) {
    if (lang === FALLBACK_LANGUAGE) {
      continue;
    }

    if (fixture.languages === "every" || fixture.languages.includes(lang)) {
      drawn.push(lang);
    } else {
      english.push(lang);
    }
  }

  return { drawn, english };
};

/*
 * The address a shot opens, from its page's RouteMap pattern: the fixture's
 * project, the shot's own params, its query, and the language for a fixture
 * told by the address.
 */
export const screenAddress: (
  shot: DocsScreen,
  fixture: DocsScreenFixture,
  lang: string,
) => string = (
  shot: DocsScreen,
  fixture: DocsScreenFixture,
  lang: string,
): string => {
  let address: string = shot.path.replace(":projectId", fixture.projectId);

  for (const [name, value] of Object.entries(shot.params || {})) {
    address = address.replace(`:${name}`, value);
  }

  const query: URLSearchParams = new URLSearchParams(
    (shot.query || "").replace(/^\?/, ""),
  );

  if (fixture.languageBy === "query" && lang !== FALLBACK_LANGUAGE) {
    query.set("lang", lang);
  }

  const search: string = query.toString();

  return search ? `${address}?${search}` : address;
};

/*
 * Whether a shot goes on from the one before it rather than opening its page
 * again: the same fixture, address and window, and a state that starts with
 * all of the earlier one's.
 */
export const continuesFrom: (
  previous: DocsScreen | null,
  shot: DocsScreen,
) => boolean = (previous: DocsScreen | null, shot: DocsScreen): boolean => {
  if (
    !previous ||
    previous.fixture !== shot.fixture ||
    previous.path !== shot.path ||
    JSON.stringify(previous.params || {}) !==
      JSON.stringify(shot.params || {}) ||
    (previous.query || "") !== (shot.query || "") ||
    previous.width !== shot.width ||
    previous.height !== shot.height ||
    previous.state.length > shot.state.length
  ) {
    return false;
  }

  return previous.state.every((action: unknown, index: number): boolean => {
    return JSON.stringify(action) === JSON.stringify(shot.state[index]);
  });
};

/*
 * What the docs show for a shot on a page in a language: its own picture,
 * the English one when the shot is not drawn in that language, or null for
 * a shot with no picture at all.
 */
export interface ResolvedScreen {
  src: string;
  lang: string;
  width: number;
  height: number;
}

export const resolveScreen: (
  manifest: DocsScreenManifest,
  name: string,
  lang: string,
) => ResolvedScreen | null = (
  manifest: DocsScreenManifest,
  name: string,
  lang: string,
): ResolvedScreen | null => {
  const sizes: Record<string, DocsScreenSize> | undefined =
    manifest.shots[name];

  if (!sizes) {
    return null;
  }

  for (const candidate of [lang, FALLBACK_LANGUAGE]) {
    const size: DocsScreenSize | undefined = sizes[candidate];

    if (size) {
      return {
        src: screenUrl(candidate, name),
        lang: candidate,
        width: size.width,
        height: size.height,
      };
    }
  }

  return null;
};

// A screenshot's address as a page writes it: "](screen:<name>" ...
const SCREEN_ADDRESS: RegExp = /\]\(\s*screen:([a-z0-9]+(?:-[a-z0-9]+)*)/g;

/*
 * A page's Markdown as the docs hand it out as Markdown (/docs/as-markdown,
 * llms-full.txt): each screenshot's address made the picture's own, so a
 * reader of the Markdown gets an image that loads. A shot with no picture
 * keeps the address it has.
 */
export const withScreenAddresses: (
  markdown: string,
  lang: string,
  manifest: DocsScreenManifest,
) => string = (
  markdown: string,
  lang: string,
  manifest: DocsScreenManifest,
): string => {
  return markdown.replace(
    SCREEN_ADDRESS,
    (whole: string, name: string): string => {
      const screen: ResolvedScreen | null = resolveScreen(manifest, name, lang);

      return screen ? `](${screen.src}` : whole;
    },
  );
};

// The manifest as the renderer writes it: shots and languages in order.
export const sortedManifest: (
  manifest: DocsScreenManifest,
) => DocsScreenManifest = (
  manifest: DocsScreenManifest,
): DocsScreenManifest => {
  const shots: Record<string, Record<string, DocsScreenSize>> = {};

  for (const name of Object.keys(manifest.shots).sort()) {
    const languages: Record<string, DocsScreenSize> = {};
    const sizes: Record<string, DocsScreenSize> = manifest.shots[name]!;

    for (const lang of Object.keys(sizes).sort()) {
      languages[lang] = {
        width: sizes[lang]!.width,
        height: sizes[lang]!.height,
      };
    }

    shots[name] = languages;
  }

  return { pixelRatio: manifest.pixelRatio, shots };
};

/*
 * A WebP picture's size in pixels, from its header: the lossy ("VP8 "),
 * lossless ("VP8L") and extended ("VP8X") forms. Null for anything else.
 */
export const webpSize: (
  data: Buffer,
) => { width: number; height: number } | null = (
  data: Buffer,
): { width: number; height: number } | null => {
  if (
    data.length < 30 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunk: string = data.toString("ascii", 12, 16);

  if (chunk === "VP8 ") {
    // The key frame's start code, then 14 bits of width and of height.
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) {
      return null;
    }
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    if (data[20] !== 0x2f) {
      return null;
    }
    const bits: number = data.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (chunk === "VP8X") {
    return {
      width: data.readUIntLE(24, 3) + 1,
      height: data.readUIntLE(27, 3) + 1,
    };
  }

  return null;
};

/*
 * The manifest the pictures on disk make: each shot of the list, in each
 * language it has a picture in, at its size in CSS pixels. The renderer
 * writes it from the files, so the two never disagree.
 */
export const manifestOfFiles: (
  shots: ReadonlyArray<DocsScreen>,
  languages: ReadonlyArray<string>,
  staticFolder?: string,
) => DocsScreenManifest = (
  shots: ReadonlyArray<DocsScreen>,
  languages: ReadonlyArray<string>,
  staticFolder: string = STATIC_FOLDER,
): DocsScreenManifest => {
  const manifest: DocsScreenManifest = {
    pixelRatio: SCREEN_PIXEL_RATIO,
    shots: {},
  };

  for (const shot of shots) {
    for (const lang of languages) {
      const file: string = path.join(staticFolder, screenFile(lang, shot.name));

      if (!fs.existsSync(file)) {
        continue;
      }

      const size: { width: number; height: number } | null = webpSize(
        fs.readFileSync(file),
      );

      if (!size) {
        throw new Error(`${file} is not a WebP picture.`);
      }

      manifest.shots[shot.name] = {
        ...(manifest.shots[shot.name] || {}),
        [lang]: {
          width: Math.round(size.width / SCREEN_PIXEL_RATIO),
          height: Math.round(size.height / SCREEN_PIXEL_RATIO),
        },
      };
    }
  }

  return sortedManifest(manifest);
};

// The docs' Static/ folder, beside Utils/ and Screens/.
export const STATIC_FOLDER: string = path.resolve(__dirname, "..", "Static");

export const MANIFEST_PATH: string = path.join(
  STATIC_FOLDER,
  SCREENS_FOLDER,
  MANIFEST_FILE,
);

const EMPTY_MANIFEST: DocsScreenManifest = {
  pixelRatio: SCREEN_PIXEL_RATIO,
  shots: {},
};

// The manifest on disk; an empty one when there is none yet.
export const readManifest: (file?: string) => DocsScreenManifest = (
  file: string = MANIFEST_PATH,
): DocsScreenManifest => {
  if (!fs.existsSync(file)) {
    return EMPTY_MANIFEST;
  }

  return JSON.parse(fs.readFileSync(file, "utf8")) as DocsScreenManifest;
};

let cached: DocsScreenManifest | null = null;

// The manifest on disk, read once: the docs server's copy.
export const cachedManifest: () => DocsScreenManifest =
  (): DocsScreenManifest => {
    if (!cached) {
      cached = readManifest();
    }

    return cached;
  };
