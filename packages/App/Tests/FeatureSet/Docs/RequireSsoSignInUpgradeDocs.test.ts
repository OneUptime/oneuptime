import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import {
  MASTER_ADMIN_SIGN_IN_PATH,
  SSO_REQUIRED_SIGN_IN_MESSAGE,
} from "Common/Types/SSO/SignInMethods";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says what requiring SSO for the whole server now
 * does (#5193), held to the code that makes it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note on code repositories following the default Runner
 * (CodeRepositoryDefaultRunnerUpgradeDocs) and before the endpoint pointer,
 * and every translation carries it in the English note's place, with the
 * master admins' address as code and a link to the Global SSO page's
 * Enforcing SSO section in the reader's language. What it claims is what the
 * change does:
 *
 *   - while the server requires SSO, the sign-in, single sign-on and sign-up
 *     pages offer only the global providers (they read GET
 *     /identity/sign-in-methods first, and draw the SSO page in their
 *     place);
 *   - the server refuses a password, a passkey, a Microsoft sign-in and a
 *     sign-up from everyone but master admins (SsoRequiredSignIn), and
 *     master admins sign in at /accounts/admin-login;
 *   - the page a project that requires SSO sends people to lists the global
 *     providers that reach it (GET /identity/project-sign-in-methods);
 *   - the Admin Dashboard's Global SSO and Global OIDC lists are one Single
 *     Sign-On page, with Require SSO for Login under the providers, and the
 *     old list addresses open it.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LEAD: string =
  "While the whole server requires SSO, the sign-in pages offer only SSO, and its global providers have one page.";
const NOTE_LEAD: string = `**${LEAD}**`;
// The note before it (CodeRepositoryDefaultRunnerUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**A code repository that picks no Runner follows the project's default Runner.**";
const POINTER_START: string = "- See [API and endpoint changes]";

const GLOBAL_SSO_PAGE: string = "identity/global-sso";
const SECTION_HEADING: string = "## Enforcing SSO";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The anchor of the Global SSO page's Enforcing SSO section, per language.
function sectionAnchor(language: string): string {
  const headingsOf: (of: string) => Array<string> = (
    of: string,
  ): Array<string> => {
    return fs
      .readFileSync(path.join(CONTENT_DIR, of, `${GLOBAL_SSO_PAGE}.md`), "utf8")
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("#");
      });
  };
  const index: number = headingsOf("en").indexOf(SECTION_HEADING);

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = headingsOf(language)[index];

  expect(heading).toBeDefined();

  return slugifyMarkdownHeading(heading!.replace(/^#+\s+/, ""));
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on requiring SSO for the whole server", () => {
  it("is a note of the 14 changes, once, after the note on the default Runner and before the endpoint pointer", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(ENGLISH_ITEMS[NOTE_INDEX + 1]!.startsWith(POINTER_START)).toBe(true);
  });

  it("says what the sign-in pages offer, what the server refuses, where master admins sign in, and where the settings went", () => {
    for (const claim of [
      "With Require SSO for Login on for the whole server, the sign-in, single sign-on and sign-up pages show a button for each global SSO provider that is on, and no password, passkey, Microsoft sign-in or sign-up.",
      "The server refuses those too, a script that signs in with a password included, and only a master admin's password or passkey still signs them in, at `/accounts/admin-login`.",
      "Someone signed in with a password signs in with SSO to open a project, on a page that now also offers the global providers that sign people in to it.",
      "In the Admin Dashboard, the Global SSO and Global OIDC lists are one Single Sign-On page under Settings, with Require SSO for Login under the providers, and their old addresses open it.",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }

    expect(ENGLISH_NOTE).toContain(
      `[Global SSO](/docs/${GLOBAL_SSO_PAGE}#${sectionAnchor("en")})`,
    );
    expect(sectionAnchor("en")).toBe("enforcing-sso");
  });
});

describe("the note is true to the change", () => {
  it("names the master admins' address the Accounts app serves", () => {
    expect(MASTER_ADMIN_SIGN_IN_PATH).toBe("/accounts/admin-login");
    expect(ENGLISH_NOTE).toContain(`\`${MASTER_ADMIN_SIGN_IN_PATH}\``);
    expect(source("App/FeatureSet/Accounts/src/App.tsx")).toMatch(
      /path=\{MASTER_ADMIN_SIGN_IN_PATH\}\s*element=\{<LoginPage isMasterAdminSignIn=\{true\} \/>\}/,
    );
  });

  it("draws the single sign-on page in place of the sign-in and sign-up pages while SSO is required", () => {
    for (const page of [
      "App/FeatureSet/Accounts/src/Pages/Login.tsx",
      "App/FeatureSet/Accounts/src/Pages/Register.tsx",
    ]) {
      const code: string = source(page);

      expect({ page, reads: code.includes("useSignInMethods(") }).toEqual({
        page,
        reads: true,
      });
      expect({ page, draws: code.includes("<LoginWithSsoPage") }).toEqual({
        page,
        draws: true,
      });
    }
  });

  it("refuses the other ways in, on the server, with the message the docs quote", () => {
    const refusal: string = source("Common/Server/Utils/SsoRequiredSignIn.ts");
    const authentication: string = source(
      "App/FeatureSet/Identity/API/Authentication.ts",
    );

    expect(refusal).toContain("SSO_REQUIRED_SIGN_IN_MESSAGE");
    expect(refusal).toContain("SSO_REQUIRED_SIGN_UP_MESSAGE");
    expect(authentication).toContain("assertNonSsoSignInAllowed(");
    expect(authentication).toContain("assertSignUpAllowed(");
    /*
     * Sign in with Microsoft signs nobody in while SSO is required, master
     * admins included: only their password or passkey still works.
     */
    const microsoft: string = source(
      "App/FeatureSet/Identity/API/MicrosoftSignIn.ts",
    );

    expect(microsoft).toContain("await SsoRequiredSignIn.isSsoRequired()");
    expect(microsoft).not.toContain("isNonSsoSignInRefused(");
    expect(refusal).toContain("isMasterAdmin");
    expect(
      fs
        .readFileSync(
          path.join(CONTENT_DIR, "en", `${GLOBAL_SSO_PAGE}.md`),
          "utf8",
        )
        .includes(`"${SSO_REQUIRED_SIGN_IN_MESSAGE}"`),
    ).toBe(true);
  });

  it("lists the global providers that reach a project on its single sign-on page", () => {
    expect(
      source("App/FeatureSet/Dashboard/src/Pages/Onboarding/SSO.tsx"),
    ).toContain("/project-sign-in-methods/");
    expect(source("App/FeatureSet/Identity/API/SignInMethods.ts")).toContain(
      '"/project-sign-in-methods/:projectId"',
    );
  });

  it("forwards the old list addresses to the Single Sign-On page", () => {
    const app: string = source("App/FeatureSet/AdminDashboard/src/App.tsx");

    for (const pageKey of ["SETTINGS_GLOBAL_SSO", "SETTINGS_GLOBAL_OIDC"]) {
      expect({
        pageKey,
        forwards: new RegExp(
          `path=\\{RouteMap\\[PageMap\\.${pageKey}\\]\\?\\.toString\\(\\) \\|\\| ""\\}\\s*element=\\{\\s*<Navigate\\s+replace=\\{true\\}\\s+to=\\{RouteMap\\[PageMap\\.SETTINGS_SSO\\]`,
        ).test(app),
      }).toEqual({ pageKey, forwards: true });
    }
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, with the master admins' address and a link to its own Enforcing SSO section",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(language, LEAD),
      );

      expect(note).toContain(`\`${MASTER_ADMIN_SIGN_IN_PATH}\``);
      expect(note).toContain(
        `(/docs/${GLOBAL_SSO_PAGE}#${sectionAnchor(language)})`,
      );
      // The setting keeps its English name, as the other SSO notes write it.
      expect(note).toContain("Require SSO for Login");

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
    },
  );
});
