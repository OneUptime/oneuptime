import {
  DOCS_SCREENS,
  DOCS_SCREEN_LANGUAGES,
  DocsScreen,
} from "../../../FeatureSet/Docs/Screens/DocsScreenList";
import {
  DocsScreenManifest,
  readManifest,
  screenFile,
  STATIC_FOLDER,
} from "../../../FeatureSet/Docs/Screens/DocsScreenFiles";
import {
  DocsScreenFingerprint,
  DocsScreenFingerprints,
} from "../../../FeatureSet/Docs/Screens/DocsScreenFingerprint";
import { CONTENT_DIR, DOCS_LANGUAGES } from "./DocsContentSupport";
import { drawnCreateButton, drawnDashboardLabel } from "./DocsDashboardLabels";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE INGESTION KEYS PICTURE, DRAWN BY THE DOCS SCREENSHOTS (#7579).
 *
 * Six telemetry guides, in all 17 languages, show the Ingestion Keys list
 * under the step that opens it. The picture was a screenshot taken by hand,
 * so nothing redrew it when the page's words changed, and it went on showing
 * three retired names: the card's "Telemetry Ingestion Keys", the pager's
 * "telemetry ingestion keys" and the side menu's "Notification Settings".
 *
 * It is now the docs screenshot "ingestion-keys" (Docs/Screens/
 * DocsScreenList.ts): drawn from the Dashboard of this branch by the journeys
 * fixture, over four keys of ?seed=ingestion-keys, in each reader's
 * language, and checked against the page every night. Held here:
 *
 *   - the shot: the Ingestion Keys page in Project Settings, cropped to the
 *     keys' card, with the button the next step presses ringed;
 *   - what was drawn, from its fingerprints: today's names in every
 *     language, the four keys, and none of the retired names;
 *   - each language has its own picture, in the manifest the docs read;
 *   - the six pages show it on the line the English does, with alt text
 *     naming the list and the button as that language's Dashboard draws
 *     them; the hand-taken PNG is gone, and nothing links to it.
 */

const SHOT_NAME: string = "ingestion-keys";

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const FINGERPRINTS: string = path.join(
  REPO_ROOT,
  "packages/E2E/DocsScreens/Fingerprints",
);
const OLD_PICTURE: string = "images/TelemetryIngestionKeys.png";

// The pages that show the list, under the step that opens it.
const PAGES: ReadonlyArray<string> = [
  "rum/browser-setup",
  "telemetry/fluentbit",
  "telemetry/fluentd",
  "telemetry/open-telemetry",
  "telemetry/profiles",
  "telemetry/serilog",
];

// The keys ?seed=ingestion-keys puts in the list: data, never translated.
const SEEDED_KEYS: ReadonlyArray<string> = [
  "Production collectors",
  "Storefront web",
  "Checkout beta",
  "Marketing site",
];

// What the hand-taken picture showed, and the Dashboard no longer says.
const RETIRED_WORDS: ReadonlyArray<RegExp> = [
  /telemetry ingestion key/i,
  /notification settings/i,
];

const SCREENSHOT: RegExp = /^!\[((?:\\.|[^\]\\])*)\]\(screen:([^)\s]+)\)$/;

interface ShownScreen {
  line: number;
  alt: string;
}

const shot: DocsScreen | undefined = DOCS_SCREENS.find(
  (candidate: DocsScreen): boolean => {
    return candidate.name === SHOT_NAME;
  },
);

const readPage: (lang: string, page: string) => string = (
  lang: string,
  page: string,
): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, `${page}.md`), "utf8");
};

// Every line of a page that shows this shot.
const shownOn: (lang: string, page: string) => Array<ShownScreen> = (
  lang: string,
  page: string,
): Array<ShownScreen> => {
  const shown: Array<ShownScreen> = [];

  readPage(lang, page)
    .split("\n")
    .forEach((text: string, index: number): void => {
      const match: RegExpMatchArray | null = text.trim().match(SCREENSHOT);

      if (match && match[2] === SHOT_NAME) {
        shown.push({ line: index + 1, alt: match[1] as string });
      }
    });

  return shown;
};

const fingerprintIn: (lang: string) => DocsScreenFingerprint = (
  lang: string,
): DocsScreenFingerprint => {
  const fingerprints: DocsScreenFingerprints = JSON.parse(
    fs.readFileSync(path.join(FINGERPRINTS, `${lang}.json`), "utf8"),
  ) as DocsScreenFingerprints;

  const fingerprint: DocsScreenFingerprint | undefined =
    fingerprints[SHOT_NAME];

  expect({ lang, drawn: Boolean(fingerprint) }).toEqual({
    lang,
    drawn: true,
  });

  return fingerprint as DocsScreenFingerprint;
};

describe("the Ingestion Keys shot", () => {
  it("is on the docs' shot list", () => {
    expect(shot).toBeDefined();
  });

  it("opens Project Settings' Ingestion Keys page in the journeys fixture, with keys in it", () => {
    expect(shot).toMatchObject({
      fixture: "Journeys",
      page: "SETTINGS_TELEMETRY_INGESTION_KEYS",
      path: "/dashboard/:projectId/settings/telemetry-ingestion-keys",
      query: "?seed=ingestion-keys",
    });
  });

  it("is cropped to the keys' card, with Create Ingestion Key, the next step, ringed", () => {
    expect(shot?.crop).toBe('[data-testid="card"]:has(#api-keys-table-body)');
    expect(shot?.highlight).toBe("Create Ingestion Key");
  });

  it("is seeded by the journeys fixture with the four keys the guides show", () => {
    const fixture: string = fs.readFileSync(
      path.join(REPO_ROOT, "packages/E2E/Journeys/Fixture/NewProject.js"),
      "utf8",
    );

    expect(fixture).toContain('options.seeds.includes("ingestion-keys")');
    for (const name of SEEDED_KEYS) {
      expect(fixture).toContain(`name: ${JSON.stringify(name)},`);
    }
  });
});

describe("what the shot shows, as it was drawn", () => {
  it("is drawn in every docs language", () => {
    expect([...DOCS_SCREEN_LANGUAGES].sort()).toEqual(
      [...DOCS_LANGUAGES].sort(),
    );
  });

  it.each([...DOCS_SCREEN_LANGUAGES])(
    "in %s: the list's title and its create button as the Dashboard draws them, and the four keys",
    (lang: string) => {
      const fingerprint: DocsScreenFingerprint = fingerprintIn(lang);

      expect(fingerprint.text[0]).toBe(
        drawnDashboardLabel(lang, "Ingestion Keys"),
      );
      expect(fingerprint.outline).toContain(
        `heading: ${drawnDashboardLabel(lang, "Ingestion Keys")}`,
      );
      expect(fingerprint.outline).toContain(
        `button: ${drawnCreateButton(lang, "Create Ingestion Key")}`,
      );

      for (const name of SEEDED_KEYS) {
        expect(fingerprint.text).toContain(name);
      }
    },
  );

  it.each([...DOCS_SCREEN_LANGUAGES])(
    "in %s: none of the names the hand-taken picture showed",
    (lang: string) => {
      const fingerprint: DocsScreenFingerprint = fingerprintIn(lang);
      const words: string = [...fingerprint.text, ...fingerprint.outline].join(
        "\n",
      );

      for (const retired of RETIRED_WORDS) {
        expect({ lang, retired: retired.test(words) }).toEqual({
          lang,
          retired: false,
        });
      }
    },
  );

  it("in English, the pager counts ingestion keys, by the model's plural name", () => {
    expect(fingerprintIn("en").text).toContain(
      "Showing 1-4 of 4 ingestion keys",
    );
  });
});

describe("the pictures", () => {
  it.each([...DOCS_SCREEN_LANGUAGES])(
    "in %s: a picture of its own, in the manifest the docs read",
    (lang: string) => {
      const manifest: DocsScreenManifest = readManifest();

      expect(
        fs.existsSync(path.join(STATIC_FOLDER, screenFile(lang, SHOT_NAME))),
      ).toBe(true);
      expect(manifest.shots[SHOT_NAME]?.[lang]).toBeDefined();
    },
  );

  it("the hand-taken PNG is gone", () => {
    expect(fs.existsSync(path.join(STATIC_FOLDER, OLD_PICTURE))).toBe(false);
  });
});

describe.each([...PAGES])("the %s page", (page: string) => {
  const english: Array<ShownScreen> = shownOn("en", page);

  it("shows the shot once in English, with alt text naming the list and the ringed button", () => {
    expect(english).toEqual([
      {
        line: expect.any(Number),
        alt: 'The "Ingestion Keys" list, with "Create Ingestion Key" ringed',
      },
    ]);
  });

  it.each([...DOCS_LANGUAGES])(
    "in %s, shows it on the English page's line, and links the hand-taken PNG nowhere",
    (lang: string) => {
      const shown: Array<ShownScreen> = shownOn(lang, page);

      expect({
        lang,
        lines: shown.map((screen: ShownScreen) => {
          return screen.line;
        }),
      }).toEqual({
        lang,
        lines: english.map((screen: ShownScreen) => {
          return screen.line;
        }),
      });
      expect(readPage(lang, page)).not.toContain(OLD_PICTURE);
    },
  );

  it.each([...DOCS_LANGUAGES])(
    "in %s, names the list and the ringed button as that language's Dashboard draws them",
    (lang: string) => {
      const [screen] = shownOn(lang, page);
      const alt: string = (screen as ShownScreen).alt;

      expect(alt).toContain(drawnDashboardLabel(lang, "Ingestion Keys"));
      expect(alt).toContain(drawnCreateButton(lang, "Create Ingestion Key"));

      if (lang !== "en") {
        expect(alt).not.toBe(english[0]?.alt);
      }
    },
  );
});

describe("one alt text per language", () => {
  it.each([...DOCS_LANGUAGES])(
    "in %s, the six pages describe the picture alike",
    (lang: string) => {
      const alts: Set<string> = new Set(
        PAGES.map((page: string): string => {
          return (shownOn(lang, page)[0] as ShownScreen).alt;
        }),
      );

      expect({ lang, alts: alts.size }).toEqual({ lang, alts: 1 });
    },
  );
});
