import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * "Accept the invitation automatically" - the checkbox on the Admin Dashboard's
 * invite forms.
 *
 * Four separate hand-written forms create a TeamMember from the Admin
 * Dashboard, and a master admin can reach a project's users through any of
 * them. A checkbox added to one and forgotten on the others is not a visible
 * failure - the form simply invites, and the admin is left wondering why the
 * member is still pending on one page and not another.
 *
 * The other half of the contract is where the checkbox must NOT be. The service
 * only honours the flag for a master admin (TeamMemberService.onBeforeCreate
 * forces it back to false for everybody else), so a copy of the field in the
 * project-settings invite forms would render a control that silently does
 * nothing.
 *
 * Assertions are on source text: these forms are React element trees that
 * render nothing without a browser, and the registrations they hold are
 * invariants no runtime value exposes.
 */

const APP_SRC: string = nodePath.join(__dirname, "../../FeatureSet");

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  APP_SRC,
  "AdminDashboard/src",
);

/*
 * Comments are stripped first so a file that explains the checkbox in prose
 * cannot satisfy an assertion about the code that renders it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(APP_SRC, relativePath), "utf8"),
  );
}

/* Every Admin Dashboard form that creates a TeamMember. */
const ADMIN_INVITE_FORMS: Array<{ name: string; path: string }> = [
  {
    name: "Project > Users (Invite User)",
    path: "AdminDashboard/src/Pages/Projects/View/Users.tsx",
  },
  {
    name: "Project > Team (Invite member)",
    path: "AdminDashboard/src/Pages/Projects/View/TeamView.tsx",
  },
  {
    name: "Project > User (Add to Team)",
    path: "AdminDashboard/src/Pages/Projects/View/UserView.tsx",
  },
  {
    name: "User > Projects (Add to Project)",
    path: "AdminDashboard/src/Pages/Users/View/Projects.tsx",
  },
];

/*
 * The same action in the project's own settings, where the person doing it is a
 * project owner or admin rather than a master admin.
 */
const PROJECT_INVITE_FORMS: Array<{ name: string; path: string }> = [
  {
    name: "Dashboard > Team > Members",
    path: "Dashboard/src/Pages/Teams/View/Members.tsx",
  },
  {
    name: "Dashboard > Users",
    path: "Dashboard/src/Pages/Users/Index.tsx",
  },
];

/*
 * The field declaration, as ModelForm reads it: a form field is a `field: { x:
 * true }` object, so the checkbox is only wired to the column when the two sit
 * in the same object literal.
 */
const CHECKBOX_FIELD: RegExp =
  /field:\s*\{\s*hasAcceptedInvitation:\s*true,?\s*\}[\s\S]{0,600}?fieldType:\s*FormFieldSchemaType\.Checkbox/;

const englishLocale: Record<string, unknown> = JSON.parse(
  fs.readFileSync(
    nodePath.join(ADMIN_DASHBOARD_SRC, "Locales/en.json"),
    "utf8",
  ),
);

function lookUpLocaleKey(
  locale: Record<string, unknown>,
  key: string,
): unknown {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

describe("the checkbox is on every Admin Dashboard invite form", () => {
  test.each(ADMIN_INVITE_FORMS)(
    "$name offers it",
    ({ path }: { path: string }) => {
      expect(readSource(path)).toMatch(CHECKBOX_FIELD);
    },
  );

  test.each(ADMIN_INVITE_FORMS)(
    "$name renders it as a checkbox, not a free-text field",
    ({ path }: { path: string }) => {
      /*
       * FormFieldSchemaType.Toggle would also write the boolean, but the field
       * is a one-off choice made while filling the form in, not a setting.
       */
      expect(readSource(path)).toContain(
        "fieldType: FormFieldSchemaType.Checkbox",
      );
    },
  );

  test.each(ADMIN_INVITE_FORMS)(
    "$name defaults it to off, so inviting stays the default",
    ({ path }: { path: string }) => {
      /*
       * Without an explicit default the checkbox still renders unchecked, but
       * the default is what the form promises - an invite that silently
       * auto-accepts would add people to projects without asking them.
       */
      const source: string = readSource(path);
      const declaration: RegExpMatchArray | null = source.match(CHECKBOX_FIELD);

      expect(declaration).not.toBeNull();

      const tail: string = source.slice(
        source.indexOf(declaration![0]),
        source.indexOf(declaration![0]) + declaration![0].length + 200,
      );

      expect(tail).toContain("defaultValue: false");
    },
  );

  test.each(ADMIN_INVITE_FORMS)(
    "$name does not mark it required - an unticked box is a valid answer",
    ({ path }: { path: string }) => {
      const source: string = readSource(path);
      const declaration: RegExpMatchArray | null = source.match(CHECKBOX_FIELD);

      const tail: string = source.slice(
        source.indexOf(declaration![0]),
        source.indexOf(declaration![0]) + declaration![0].length + 200,
      );

      expect(tail).toContain("required: false");
      expect(tail).not.toContain("required: true");
    },
  );
});

describe("the checkbox is not offered where the server would ignore it", () => {
  test.each(PROJECT_INVITE_FORMS)(
    "$name does not offer it",
    ({ path }: { path: string }) => {
      /*
       * TeamMemberService.onBeforeCreate forces hasAcceptedInvitation back to
       * false for any create that is not root or master admin, so a checkbox
       * here would be a control that does nothing.
       */
      expect(readSource(path)).not.toMatch(CHECKBOX_FIELD);
    },
  );

  test.each(PROJECT_INVITE_FORMS)(
    "$name still reads the column for its status pill",
    ({ path }: { path: string }) => {
      /*
       * A guard on the assertion above: if these pages stopped mentioning the
       * column at all, "does not offer it" would pass for the wrong reason.
       */
      expect(readSource(path)).toContain("hasAcceptedInvitation");
    },
  );
});

describe("User > Projects - the stepped form", () => {
  const source: string = readSource(
    "AdminDashboard/src/Pages/Users/View/Projects.tsx",
  );

  test("the checkbox is assigned to a step", () => {
    /*
     * This form has steps. BasicForm filters fields by the current step id, so
     * a field with no stepId is never rendered at all - the checkbox would be
     * invisible rather than misplaced.
     */
    const declaration: RegExpMatchArray | null = source.match(CHECKBOX_FIELD);

    expect(declaration).not.toBeNull();

    const tail: string = source.slice(
      source.indexOf(declaration![0]) - 200,
      source.indexOf(declaration![0]) + declaration![0].length + 200,
    );

    expect(tail).toContain('stepId: "team"');
  });

  test("the step it is on is one the form declares", () => {
    expect(source).toMatch(/id:\s*"team",/);
  });

  test("it asks for its labels through i18n, like the fields around it", () => {
    // Tolerant of the line breaks Prettier puts inside a long t(...) call.
    expect(source).toMatch(
      /t\(\s*"pages\.userProjects\.fieldAutoAccept",?\s*\)/,
    );
    expect(source).toMatch(
      /t\(\s*"pages\.userProjects\.fieldAutoAcceptDescription",?\s*\)/,
    );
  });
});

describe("the new translations", () => {
  const NEW_KEYS: Array<string> = [
    "pages.userProjects.fieldAutoAccept",
    "pages.userProjects.fieldAutoAcceptDescription",
  ];

  test.each(NEW_KEYS)("%s exists in en.json", (key: string) => {
    expect(lookUpLocaleKey(englishLocale, key)).toEqual(expect.any(String));
  });

  test("every locale carries them, so no language falls back to a raw key", () => {
    /*
     * i18n:validate proves the locale files agree with each other. This proves
     * they agree about these two keys specifically, which is the pair a
     * half-finished translation pass would drop.
     */
    const localesDir: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");
    const localeFiles: Array<string> = fs
      .readdirSync(localesDir)
      .filter((name: string) => {
        return name.endsWith(".json");
      });

    expect(localeFiles.length).toBeGreaterThan(10);

    const missing: Array<string> = [];

    for (const file of localeFiles) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(nodePath.join(localesDir, file), "utf8"),
      );

      for (const key of NEW_KEYS) {
        if (typeof lookUpLocaleKey(locale, key) !== "string") {
          missing.push(`${file}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("the add-to-project blurb no longer promises the membership is always pending", () => {
    /*
     * It used to end "as a pending member until they accept", which the
     * checkbox makes conditionally untrue.
     */
    const description: unknown = lookUpLocaleKey(
      englishLocale,
      "pages.userProjects.addToProjectDescription",
    );

    expect(description).toEqual(expect.any(String));
    expect(description as string).toContain("unless you accept the invitation");
  });
});
