import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import {
  OAuthVideoCallProviders,
  VideoCallProviderDefinition,
  getVideoCallProviderDefinition,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A one-click provider's one-line description - Zoom's, Google Meet's,
 * Microsoft Teams' - is drawn on its tile in Project Settings > Workspace >
 * Video Calls and under the title of its connect dialogs, each of which
 * looks it up in the Dashboard locale files by its English text. The
 * provider catalog that holds it is in Common, which npm run i18n:extract
 * does not read, so its keys are kept by hand: a description reworded there
 * without them stays English in every language. This pins:
 *
 *   - en.json maps each description to itself, and all sixteen other
 *     locales carry a real translation that keeps the brand of the account
 *     it names;
 *   - the service-account wording the descriptions had before one-click
 *     connect is in no locale.
 *
 * VideoCallProviderDescriptionLocales (Common's tests) draws them from the
 * shipped locales.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Each description, and the brand of the account it names ("Google").
const DESCRIPTIONS: Array<[string, string]> = OAuthVideoCallProviders.map(
  (provider: VideoCallProvider): [string, string] => {
    const definition: VideoCallProviderDefinition =
      getVideoCallProviderDefinition(provider)!;

    return [definition.description, definition.oauth!.signInWith];
  },
);

// What they said while a service identity was the only way to connect.
const RETIRED_DESCRIPTIONS: Array<string> = [
  "Start a dedicated Zoom meeting for every incident and alert, hosted by a Zoom service account.",
  "Create a dedicated Google Meet for every incident and alert, owned by a Google Workspace service user.",
  "Create a dedicated Microsoft Teams meeting for every incident and alert, organized by a Microsoft 365 service account.",
];

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("video call provider descriptions in the Dashboard locales", () => {
  test.each(DESCRIPTIONS)(
    "en.json maps %j to itself",
    (description: string) => {
      expect(readLocale("en")[description]).toBe(description);
    },
  );

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(DESCRIPTIONS)(
      "translates %j, keeping %s",
      (description: string, brand: string) => {
        const value: unknown = translations[description];

        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect(value).not.toBe(description);
        expect(value as string).toContain(brand);
        expect(value as string).not.toMatch(/{{|}}/);
      },
    );
  });

  test.each(["en", ...OTHER_LOCALES])(
    "%s carries none of the service-account descriptions",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const description of RETIRED_DESCRIPTIONS) {
        expect({
          locale: locale,
          description: description,
          kept: description in translations,
        }).toEqual({ locale: locale, description: description, kept: false });
      }
    },
  );
});
