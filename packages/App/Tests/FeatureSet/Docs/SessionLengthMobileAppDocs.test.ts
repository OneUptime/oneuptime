import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { englishSection, readRepoFile } from "./InventoryAndApiDocsSupport";
import {
  MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
} from "Common/Types/UserSession/SessionLength";
import { describe, expect, it } from "@jest/globals";

/*
 * SELF HOSTED > SESSION LENGTH NAMES THE APP VERSION THE 15-MINUTE IDLE
 * TIMEOUT NEEDS (issues #8383, #8187).
 *
 * Under the shortest idle timeout the mobile app was signed out at every
 * renewal, however much it was used: it said nothing of its person's use.
 * The app after 1.6.0 says it with every renewal (#8187), and the server
 * was deliberately left as it was, so every copy of 1.6.0 and earlier
 * keeps being signed out every 15 minutes until it is updated. 1.6.0 was
 * the latest store release when the app changed (packages/MobileApp/
 * app.json carries the latest release's version, RELEASING.md), so the
 * page names the version as "newer than 1.6.0" - true whatever number the
 * next release takes. The same release says on its sign-in screen why the
 * server signed the person out (#8381), and the page says that too.
 */

const PAGE: string = "self-hosted/session-length";

const SEMVER: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;

// The last store release without the fix.
const LAST_RELEASE_WITHOUT_THE_FIX: string = "1.6.0";

function versionNumber(version: string): number {
  const match: RegExpMatchArray | null = version.match(SEMVER);

  if (!match) {
    throw new Error(`Not a version: ${version}`);
  }

  return (
    Number(match[1]) * 1000000 + Number(match[2]) * 1000 + Number(match[3])
  );
}

function appVersion(): string {
  return (
    JSON.parse(readRepoFile("MobileApp/app.json")) as {
      expo: { version: string };
    }
  ).expo.version;
}

describe("Session Length: the mobile app and the 15-minute idle timeout", () => {
  const section: string = englishSection(PAGE, "## How a Session Ends");

  it("says which version of the app the shortest idle timeout needs, and what happens to earlier ones", () => {
    expect(MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES).toBe(15);
    expect(section).toContain(
      `Under the ${MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES}-minute idle timeout, the app needs a version newer than ${LAST_RELEASE_WITHOUT_THE_FIX}: version ${LAST_RELEASE_WITHOUT_THE_FIX} and earlier are signed out every ${MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES} minutes, however much they are used.`,
    );
  });

  it("says the same versions say on their sign-in screen why the server signed the person out", () => {
    expect(section).toContain(
      `Versions newer than ${LAST_RELEASE_WITHOUT_THE_FIX} also say on their sign-in screen why the server signed the person out.`,
    );

    const loginScreen: string = readRepoFile(
      "MobileApp/src/screens/auth/LoginScreen.tsx",
    );

    expect(loginScreen).toContain(
      "message={SESSION_ENDED_NOTICES[sessionEndReason]}",
    );
  });

  it("names a release that already shipped: the app's version is that one or later, never earlier", () => {
    expect(versionNumber(appVersion())).toBeGreaterThanOrEqual(
      versionNumber(LAST_RELEASE_WITHOUT_THE_FIX),
    );
  });

  it("is so because the app reports its person's use with every renewal", () => {
    const client: string = readRepoFile("MobileApp/src/api/client.ts");
    const activity: string = readRepoFile("MobileApp/src/auth/userActivity.ts");

    expect(client).toContain("...report,");
    expect(client).toContain("[REPORTS_ACTIVITY_WHILE_IN_USE_FIELD]: true,");
    expect(activity).toContain(
      'export const INACTIVE_FOR_IN_SECONDS_FIELD: string = "inactiveForInSeconds";',
    );
    expect(activity).toContain(`"${REPORTS_ACTIVITY_WHILE_IN_USE_FIELD}"`);
  });

  it.each(TRANSLATED_LANGUAGES)(
    "in %s, the page names the same version and the same 15 minutes",
    (language: string) => {
      const page: string = readPage(language, PAGE);
      const english: string = readPage("en", PAGE);

      const count: (text: string, needle: string) => number = (
        text: string,
        needle: string,
      ): number => {
        return text.split(needle).length - 1;
      };

      expect(count(page, LAST_RELEASE_WITHOUT_THE_FIX)).toBe(
        count(english, LAST_RELEASE_WITHOUT_THE_FIX),
      );
      expect(count(page, LAST_RELEASE_WITHOUT_THE_FIX)).toBe(3);
    },
  );
});

describe("Audit Logs: when the mobile app's idle timeout is recorded", () => {
  it.each(["en", ...TRANSLATED_LANGUAGES])(
    "in %s, names the version the sweep needs, twice",
    (language: string) => {
      const page: string = readPage(language, "configuration/audit-logs");

      expect(page.split(LAST_RELEASE_WITHOUT_THE_FIX).length - 1).toBe(2);
    },
  );
});
