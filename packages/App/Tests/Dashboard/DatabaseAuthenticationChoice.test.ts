import {
  DATABASE_AUTHENTICATION_OPTIONS,
  DATABASE_AUTHENTICATION_TEST_ID,
  DATABASE_AUTHENTICATION_TITLE,
  DatabaseAuthentication,
  DatabaseAuthenticationOption,
  getDatabaseAuthentication,
  isDatabaseAuthenticationOffered,
  toDatabaseAuthentication,
  usesWindowsIntegratedAuthentication,
} from "../../FeatureSet/Dashboard/src/Utils/Form/Monitor/DatabaseAuthenticationChoice";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SQL Query and Database Health monitors sign in to SQL Server with a
 * username and a password, or with Windows Integrated Authentication. That
 * was a switch, "Use Windows Integrated Authentication", whose help
 * explained the other mode as well ("... Username and password are
 * ignored.") - the kind of switch the maintainer asked to see as two plain
 * choices, the simpler one first. It is one "Authentication" choice now,
 * each answer with one line saying what it means.
 *
 * Nothing stored changed: the choice reads and writes the step's
 * useWindowsIntegratedAuthentication boolean. These hold the rule, the
 * words, their translations and the two forms' wiring; the forms themselves
 * are rendered in Common/Tests/App/Dashboard (DatabaseMonitorStepForm,
 * SqlMonitorStepForm).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

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

const FORMS: Array<string> = [
  "Components/Form/Monitor/SqlMonitor/SqlMonitorStepForm.tsx",
  "Components/Form/Monitor/DatabaseMonitor/DatabaseMonitorStepForm.tsx",
];

// The switch the choice replaced, and the help that explained both modes.
const RETIRED_SWITCH_TITLE: string = "Use Windows Integrated Authentication";
const RETIRED_SWITCH_HELP: string =
  "Authenticate as the account running the probe (SSPI on Windows or Kerberos on Linux/macOS). Username and password are ignored.";

function readDashboard(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const WORDS: Array<string> = [
  DATABASE_AUTHENTICATION_TITLE,
  ...DATABASE_AUTHENTICATION_OPTIONS.flatMap(
    (option: DatabaseAuthenticationOption): Array<string> => {
      return [option.title, option.description];
    },
  ),
];

describe("the Authentication choice", () => {
  test("offers two plain answers, the simpler one - a username and a password - first", () => {
    expect(
      DATABASE_AUTHENTICATION_OPTIONS.map(
        (option: DatabaseAuthenticationOption) => {
          return option.value;
        },
      ),
    ).toEqual([
      DatabaseAuthentication.UsernameAndPassword,
      DatabaseAuthentication.WindowsIntegrated,
    ]);

    expect(
      DATABASE_AUTHENTICATION_OPTIONS.map(
        (option: DatabaseAuthenticationOption) => {
          return option.title;
        },
      ),
    ).toEqual(["Username and password", "Windows Integrated Authentication"]);
    expect(DATABASE_AUTHENTICATION_TITLE).toBe("Authentication");
  });

  test("says in one short line what each answer means", () => {
    expect(
      DATABASE_AUTHENTICATION_OPTIONS.map(
        (option: DatabaseAuthenticationOption) => {
          return option.description;
        },
      ),
    ).toEqual([
      "Sign in with a SQL Server login.",
      "Sign in as the account the probe runs as. No password needed.",
    ]);

    for (const option of DATABASE_AUTHENTICATION_OPTIONS) {
      expect(option.description.length).toBeLessThanOrEqual(80);
    }
  });

  test("is offered for Microsoft SQL Server only", () => {
    expect(
      isDatabaseAuthenticationOffered(SqlDatabaseType.MicrosoftSqlServer),
    ).toBe(true);
    expect(isDatabaseAuthenticationOffered(SqlDatabaseType.PostgreSQL)).toBe(
      false,
    );
    expect(isDatabaseAuthenticationOffered(SqlDatabaseType.MySQL)).toBe(false);
    expect(isDatabaseAuthenticationOffered(undefined)).toBe(false);
  });
});

describe("the choice reads and writes the stored boolean, unchanged", () => {
  test("a SQL Server step whose boolean is on reads as Windows Integrated Authentication", () => {
    expect(
      getDatabaseAuthentication({
        databaseType: SqlDatabaseType.MicrosoftSqlServer,
        useWindowsIntegratedAuthentication: true,
      }),
    ).toBe(DatabaseAuthentication.WindowsIntegrated);
  });

  test("off, or never set (a new monitor), it reads as a username and a password", () => {
    for (const value of [false, undefined]) {
      expect(
        getDatabaseAuthentication({
          databaseType: SqlDatabaseType.MicrosoftSqlServer,
          useWindowsIntegratedAuthentication: value,
        }),
      ).toBe(DatabaseAuthentication.UsernameAndPassword);
    }
  });

  test("another engine always signs in with a username and a password, whatever the boolean holds", () => {
    for (const databaseType of [
      SqlDatabaseType.PostgreSQL,
      SqlDatabaseType.MySQL,
    ]) {
      expect(
        getDatabaseAuthentication({
          databaseType: databaseType,
          useWindowsIntegratedAuthentication: true,
        }),
      ).toBe(DatabaseAuthentication.UsernameAndPassword);
    }
  });

  test("each answer writes the boolean the probe and the API read", () => {
    expect(
      usesWindowsIntegratedAuthentication(
        DatabaseAuthentication.WindowsIntegrated,
      ),
    ).toBe(true);
    expect(
      usesWindowsIntegratedAuthentication(
        DatabaseAuthentication.UsernameAndPassword,
      ),
    ).toBe(false);
  });

  test("a round trip keeps what was stored", () => {
    for (const stored of [true, false]) {
      expect(
        usesWindowsIntegratedAuthentication(
          getDatabaseAuthentication({
            databaseType: SqlDatabaseType.MicrosoftSqlServer,
            useWindowsIntegratedAuthentication: stored,
          }),
        ),
      ).toBe(stored);
    }
  });

  test("a value the choice does not know never turns Windows authentication on", () => {
    for (const stray of [null, undefined, "", "windows", 1, true]) {
      expect(toDatabaseAuthentication(stray)).toBe(
        DatabaseAuthentication.UsernameAndPassword,
      );
    }
    expect(toDatabaseAuthentication("windows-integrated")).toBe(
      DatabaseAuthentication.WindowsIntegrated,
    );
  });
});

describe("the two forms draw the choice, not the switch", () => {
  test.each(FORMS)("%s draws DatabaseAuthenticationField", (form: string) => {
    const source: string = readDashboard(form);

    expect(source).toContain("<DatabaseAuthenticationField");
    expect(source).toContain("isDatabaseAuthenticationOffered(");
    expect(source).toContain("usesWindowsIntegratedAuthentication(value)");
  });

  test.each(FORMS)(
    "%s has no switch explaining both modes any more",
    (form: string) => {
      const source: string = readDashboard(form);

      expect(source).not.toContain(RETIRED_SWITCH_TITLE);
      expect(source).not.toContain(RETIRED_SWITCH_HELP);
    },
  );

  test.each(FORMS)(
    "%s asks for the username and the password only when they are used",
    (form: string) => {
      const source: string = readDashboard(form);

      // Both credentials sit behind the one test, and the Password field is the shared one.
      expect(
        source.split("{!useWindowsIntegratedAuthentication && (").length - 1,
      ).toBe(2);
      expect(source).toContain("<DatabasePasswordField");
    },
  );

  test("the field is one radio group, with the test id the browser tests find it by", () => {
    const field: string = readDashboard(
      "Components/Form/Monitor/DatabaseAuthenticationField.tsx",
    );

    expect(field).toContain("<Radio");
    expect(field).toContain("dataTestId={DATABASE_AUTHENTICATION_TEST_ID}");
    expect(field).toContain("ariaLabelledby={labelId}");
    expect(DATABASE_AUTHENTICATION_TEST_ID).toBe("database-authentication");
  });
});

describe("translations", () => {
  test("en.json carries every word as itself", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const word of WORDS) {
      expect(en[word]).toBe(word);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s.json translates every word of the choice",
    (locale: string) => {
      const json: Record<string, unknown> = readLocale(locale);

      for (const word of WORDS) {
        const translated: unknown = json[word];

        expect(typeof translated).toBe("string");
        expect((translated as string).trim().length).toBeGreaterThan(0);
        // "Windows" may stay as the product name, but the sentence around it may not.
        if (word !== "Windows Integrated Authentication") {
          expect(translated).not.toBe(word);
        }
      }
    },
  );
});
