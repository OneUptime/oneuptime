import fs from "fs";
import path from "path";
import {
  DOCS_SCREENS,
  DOCS_SCREEN_LANGUAGES,
  DocsScreen,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenList";
import {
  DocsScreenFingerprint,
  DocsScreenFingerprints,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenFingerprint";

/*
 * What a run of the docs screens is asked to do, and where it keeps what it
 * found (#6823). DocsScreens.spec.ts draws one language per test; the
 * teardown (DocsScreensFinish.ts) puts the languages together.
 *
 *   DOCS_SCREENS_MODE=check   draw and compare, write nothing in the
 *                             repository (the job on main)
 *   DOCS_SCREENS_FORCE=1      write every picture, current or not
 *   DOCS_SCREENS_ONLY=a,b     only these shots
 *   DOCS_SCREENS_LANGUAGES=en,de   only these languages
 */

export type DocsScreensMode = "write" | "check";

export const MODE: DocsScreensMode =
  process.env["DOCS_SCREENS_MODE"] === "check" ? "check" : "write";
export const FORCE: boolean = process.env["DOCS_SCREENS_FORCE"] === "1";

const listOf: (value: string | undefined) => Array<string> = (
  value: string | undefined,
): Array<string> => {
  return (value || "")
    .split(",")
    .map((item: string): string => {
      return item.trim();
    })
    .filter(Boolean);
};

export const ONLY: Array<string> = listOf(process.env["DOCS_SCREENS_ONLY"]);

export const LANGUAGES: Array<string> = listOf(
  process.env["DOCS_SCREENS_LANGUAGES"],
).length
  ? DOCS_SCREEN_LANGUAGES.filter((lang: string): boolean => {
      return listOf(process.env["DOCS_SCREENS_LANGUAGES"]).includes(lang);
    })
  : [...DOCS_SCREEN_LANGUAGES];

// The shots this run draws, in the list's order.
export const SHOTS: Array<DocsScreen> = DOCS_SCREENS.filter(
  (shot: DocsScreen): boolean => {
    return ONLY.length === 0 || ONLY.includes(shot.name);
  },
);

export const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..");
export const OUTPUT: string = path.join(
  REPOSITORY,
  "output",
  "playwright",
  "docs-screens",
);
export const RESULTS: string = path.join(OUTPUT, "results");
export const FINGERPRINTS: string = path.join(__dirname, "Fingerprints");

export type ShotStatus = "current" | "written" | "stale" | "failed";

export interface ShotResult {
  name: string;
  lang: string;
  status: ShotStatus;
  reasons: Array<string>;
  // The picture's bytes, when one was written.
  bytes?: number | undefined;
}

export interface LanguageResult {
  lang: string;
  mode: DocsScreensMode;
  shots: Array<ShotResult>;
}

export const fingerprintFile: (lang: string) => string = (
  lang: string,
): string => {
  return path.join(FINGERPRINTS, `${lang}.json`);
};

export const readFingerprints: (lang: string) => DocsScreenFingerprints = (
  lang: string,
): DocsScreenFingerprints => {
  const file: string = fingerprintFile(lang);

  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as DocsScreenFingerprints)
    : {};
};

/*
 * A language's fingerprints, written in the list's order: the shots drawn
 * now, the ones this run left alone as they were, and none the list no
 * longer has.
 */
export const writeFingerprints: (
  lang: string,
  updates: Record<string, DocsScreenFingerprint>,
) => void = (
  lang: string,
  updates: Record<string, DocsScreenFingerprint>,
): void => {
  const recorded: DocsScreenFingerprints = readFingerprints(lang);
  const written: DocsScreenFingerprints = {};

  for (const shot of DOCS_SCREENS) {
    const fingerprint: DocsScreenFingerprint | undefined =
      updates[shot.name] || recorded[shot.name];

    if (fingerprint) {
      written[shot.name] = fingerprint;
    }
  }

  fs.mkdirSync(FINGERPRINTS, { recursive: true });
  fs.writeFileSync(
    fingerprintFile(lang),
    `${JSON.stringify(written, null, 2)}\n`,
  );
};

/*
 * Every language's fingerprints, without the shots that have no picture in
 * it any more: a shot taken off the list, or a language its fixture no
 * longer draws. Run once every language has written its own.
 */
export const pruneFingerprints: (
  hasPicture: (lang: string, name: string) => boolean,
) => Array<string> = (
  hasPicture: (lang: string, name: string) => boolean,
): Array<string> => {
  const pruned: Array<string> = [];

  for (const lang of DOCS_SCREEN_LANGUAGES) {
    const file: string = fingerprintFile(lang);

    if (!fs.existsSync(file)) {
      continue;
    }

    const recorded: DocsScreenFingerprints = readFingerprints(lang);
    const kept: DocsScreenFingerprints = {};

    for (const shot of DOCS_SCREENS) {
      if (recorded[shot.name] && hasPicture(lang, shot.name)) {
        kept[shot.name] = recorded[shot.name]!;
      }
    }

    for (const name of Object.keys(recorded)) {
      if (!kept[name]) {
        pruned.push(`${lang}/${name}`);
      }
    }

    if (pruned.length > 0) {
      fs.writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
    }
  }

  return pruned;
};
