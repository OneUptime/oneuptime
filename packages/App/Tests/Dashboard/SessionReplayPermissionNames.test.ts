import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { createTranslator, Translator } from "Common/Types/Translator";
import { getSessionReplayPermissionTitle } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPermissionTitle";
import { describeHealthError } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayHealthError";
import { describeSessionReplayListError } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayEmptyReason";

/*
 * SESSION REPLAY NAMES THE PERMISSION THE ROLES SCREEN SHOWS (#6635).
 *
 * Its copy asked a reader to get "the Read Session Replay permission",
 * which no role has ever offered (the roles screen calls it "List Session
 * Replays"), and "the session replay identity permission" (the roles
 * screen's "Watch Session Replays"). Languages translated "Edit RUM
 * Application" in some sentences and kept it in English in others. Each
 * sentence now has a {{permission}} placeholder, filled with the title
 * Common/Types/Permission.ts gives the permission the route asks for, so a
 * project admin finds exactly that name on the roles screen, in every
 * language.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const LOCALES_DIR: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

// The sentences that ask a reader for a permission, by the title they fill in.
const ASKING_SENTENCES: ReadonlyArray<string> = [
  'A recording of this error may exist, but your role cannot list session replays. Ask a project admin for the "{{permission}}" permission.',
  'Arming a recording of a named person is a capture-policy change, so it needs the "{{permission}}" permission (project owners, admins and telemetry admins have it). Ask a project admin to arm the target for you.',
  'Reading recording health needs the "{{permission}}" permission (project owners, admins and telemetry admins have it). Ask a project admin to grant it, or to run this check for you.',
  'Your role cannot read end-user identity, so the server dropped the user filter "{{user}}" and this list is NOT narrowed to that user. Ask a project admin for the "{{permission}}" permission, or filter by URL, tag or device instead.',
  'Your role cannot read end-user identity, so this filter is ignored by the server. Ask a project admin for the "{{permission}}" permission.',
  'Your role lacks the "{{permission}}" permission. Ask a project admin for it.',
];

// What the copy used to call permissions no roles screen lists.
const NAMES_NO_SCREEN_SHOWS: RegExp =
  /Read Session Replay permission|session replay identity permission|session replay read permission|Edit RUM Application permission/i;

describe("the permission a sentence names", () => {
  test("is the roles screen's title for it", () => {
    expect(
      getSessionReplayPermissionTitle(Permission.ReadRumSessionReplay),
    ).toBe("List Session Replays");
    expect(
      getSessionReplayPermissionTitle(Permission.ReadRumSessionReplayPayload),
    ).toBe("Watch Session Replays");
    expect(getSessionReplayPermissionTitle(Permission.EditRumApplication)).toBe(
      "Edit RUM Application",
    );

    for (const permission of [
      Permission.ReadRumSessionReplay,
      Permission.ReadRumSessionReplayPayload,
      Permission.EditRumApplication,
    ]) {
      expect(getSessionReplayPermissionTitle(permission)).toBe(
        PermissionHelper.getTitle(permission),
      );
    }
  });

  test("a permission without a title still names itself", () => {
    expect(
      getSessionReplayPermissionTitle("NoSuchPermission" as Permission),
    ).toBe("NoSuchPermission");
  });

  test("recording health and the session list ask for List Session Replays", () => {
    expect(
      describeHealthError({ kind: "permission", message: "" }).detail,
    ).toBe(
      'Reading recording health needs the "List Session Replays" permission (project owners, admins and telemetry admins have it). Ask a project admin to grant it, or to run this check for you.',
    );
    expect(describeSessionReplayListError("", 403).detail).toBe(
      'Your role lacks the "List Session Replays" permission. Ask a project admin for it.',
    );
  });

  test.each([
    ["German", "de", "„List Session Replays“"],
    ["French", "fr", "« List Session Replays »"],
    ["Japanese", "ja", "「List Session Replays」"],
    ["Chinese", "zh-CN", "“List Session Replays”"],
    ["Arabic", "ar", "«List Session Replays»"],
    ["Persian", "fa", "«List Session Replays»"],
  ])(
    "%s: the title as the roles screen writes it, in the language's quotes",
    (_name: string, language: string, quoted: string) => {
      const translator: Translator = translatorFor(language);
      const health: string = describeHealthError(
        { kind: "permission", message: "" },
        translator,
      ).detail;
      const list: string = describeSessionReplayListError(
        "",
        403,
        translator,
      ).detail;

      for (const detail of [health, list]) {
        expect(detail).toContain(quoted);
        expect(detail).not.toContain("{{permission}}");
      }
    },
  );
});

describe("the locales", () => {
  test("no key names a permission the roles screen does not show", () => {
    const english: Record<string, string> = readLocale("en");

    expect(
      Object.keys(english).filter((key: string): boolean => {
        return NAMES_NO_SCREEN_SHOWS.test(key);
      }),
    ).toEqual([]);

    // The check finds the old wording.
    expect(
      NAMES_NO_SCREEN_SHOWS.test(
        "Ask a project admin for the Read Session Replay permission.",
      ),
    ).toBe(true);
  });

  test("every language asks for the permission by its placeholder, never in its own words", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const sentence of ASKING_SENTENCES) {
        const worded: string = locale[sentence] as string;

        expect({
          language,
          sentence,
          worded: Boolean(worded) && worded !== sentence,
          namesItByPlaceholder: (worded || "").includes("{{permission}}"),
        }).toEqual({
          language,
          sentence,
          worded: true,
          namesItByPlaceholder: true,
        });
      }
    }
  });
});
