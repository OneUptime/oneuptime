import { ADMIN_DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE ADMIN DASHBOARD'S INVITATION FORMS SUGGEST PEOPLE AS AN ADDRESS IS
 * TYPED (#9826): Projects > a project > Users > Invite New User, and a
 * team's members. Each draws its email row with the box the Dashboard's
 * forms draw (Common/UI/Components/InviteeEmailField), naming the project
 * its page is about - the Admin Dashboard works in no project - and hides
 * the Name row for the person picked, as the Dashboard's do.
 *
 * Common/Tests/App/AdminDashboard/AdminInviteSuggestions.test.tsx draws the
 * two forms; this holds what they are written with, and the box's words in
 * every Admin Dashboard language, worded as the Dashboard words them, so
 * the two dashboards say a person's standing alike.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const FEATURE_SET: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet",
);
const ADMIN_LOCALES: string = path.join(
  FEATURE_SET,
  "AdminDashboard/src/Locales",
);
const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SET,
  "Dashboard/src/Locales",
);

const BOX: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/UI/Components/InviteeEmailField/InviteeEmailField.tsx",
);

const FORMS: Array<{ name: string; file: string; teamId: string }> = [
  {
    name: "Invite New User",
    file: "AdminDashboard/src/Pages/Projects/View/Users.tsx",
    // The Team the form has picked.
    teamId: 'teamId: readFormTeamId((values as JSONObject)["team"]),',
  },
  {
    name: "a team's members",
    file: "AdminDashboard/src/Pages/Projects/View/TeamView.tsx",
    // The team the page is about.
    teamId: "teamId: teamId.toString(),",
  },
];

// The words the box draws beside a person, and the list's name.
const BOX_WORDS: Array<string> = [
  "Already in this team",
  "Already invited to this team",
  "Invited",
  "Not in this project yet",
  "People you can invite",
];

type Locale = Record<string, unknown>;

function readLocale(folder: string, language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(folder, `${language}.json`), "utf8"),
  ) as Locale;
}

// Comments stripped, so prose that explains the code cannot pass for it.
function readCode(file: string): string {
  return fs
    .readFileSync(path.join(FEATURE_SET, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe.each(FORMS)(
  "the Admin Dashboard's $name",
  ({ file, teamId }: { name: string; file: string; teamId: string }) => {
    const code: string = readCode(file);

    test("draws its email row with the box that suggests people, checked as an email row", () => {
      expect(code).toContain(
        'from "Common/UI/Components/InviteeEmailField/InviteeEmailFormField";',
      );
      expect(code).toMatch(
        /overrideFieldKey: "email",\s*customValidation: getInviteeEmailError,\s*getCustomElement:/,
      );
      expect(code).toContain("fieldType: FormFieldSchemaType.CustomComponent,");
      // No plain email box is left beside it.
      expect(code).not.toContain("fieldType: FormFieldSchemaType.Email,");
    });

    test("names its project, and the team the invitation is for", () => {
      const drawn: string = code.slice(
        code.indexOf("drawInviteeEmailField({"),
        code.indexOf("});", code.indexOf("drawInviteeEmailField({")),
      );

      expect(drawn).toContain("projectId: projectId.toString(),");
      expect(drawn).toContain(teamId);
      expect(drawn).toContain("setPickedInviteeEmail(suggestion.email);");
    });

    test("asks no name for the person picked, and asks again once the address changes", () => {
      expect(code).toMatch(
        /shouldAskForInviteeName\(\{\s*email: \(values as JSONObject\)\["email"\],\s*pickedEmail: pickedInviteeEmail,\s*\}\)/,
      );
    });
  },
);

describe("the box's words", () => {
  test("are the words the box draws", () => {
    const box: string = fs.readFileSync(BOX, "utf8");

    for (const word of BOX_WORDS) {
      expect({
        word,
        // As written, however the line is broken: translationKey("...").
        inBox: new RegExp(`translationKey\\(\\s*"${word}"\\s*,?\\s*\\)`).test(
          box,
        ),
      }).toEqual({ word, inBox: true });
    }
  });

  test("are entries of the Admin Dashboard's English, as written", () => {
    const english: Locale = readLocale(ADMIN_LOCALES, "en");

    for (const word of BOX_WORDS) {
      expect({ word, english: english[word] }).toEqual({
        word,
        english: word,
      });
    }
  });

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s words each as the Dashboard words it",
    (language: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, language);
      const dashboard: Locale = readLocale(DASHBOARD_LOCALES, language);

      for (const word of BOX_WORDS) {
        expect(typeof dashboard[word]).toBe("string");
        expect({ language, word, worded: admin[word] }).toEqual({
          language,
          word,
          worded: dashboard[word],
        });
      }
    },
  );

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s leaves none of them in English",
    (language: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, language);

      expect(
        BOX_WORDS.filter((word: string): boolean => {
          return admin[word] === word;
        }),
      ).toEqual([]);
    },
  );
});
