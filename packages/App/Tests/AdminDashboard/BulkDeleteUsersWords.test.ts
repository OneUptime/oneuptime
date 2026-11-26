import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * THE USERS LIST'S BULK DELETE SAYS WHAT A DELETE DOES (#10330).
 *
 * Its dialog said, in English in every language, "Are you sure you want to
 * permanently delete 3 user(s)? This will remove the user(s) from every
 * project and cannot be undone." The server does the opposite: an account
 * still in a project is not deleted, and its delete is refused with what to
 * do (UserService.onBeforeDelete). Now the dialog says that, in the
 * Admin Dashboard's own words in each of its languages, as its bulk 2FA
 * actions are worded (pages.users.*, with the count as userCount - never
 * count, which i18next reads as a plural lookup: BulkTwoFactorAuthWiring).
 *
 * Source text rather than imports: the page renders React and pulls in the
 * whole Admin Dashboard.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

const usersPage: string = fs.readFileSync(
  nodePath.join(ADMIN_DASHBOARD_SRC, "Pages", "Users", "Index.tsx"),
  "utf8",
);

// The bulk Delete's definition, from its function to the users list it serves.
const deleteAction: string = usersPage.slice(
  usersPage.indexOf("const getBulkDeleteAction"),
  usersPage.indexOf("return (", usersPage.indexOf("const getBulkDeleteAction")),
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json");
  })
  .map((fileName: string): string => {
    return fileName.replace(/\.json$/, "");
  })
  .sort();

function usersWords(language: string): Record<string, unknown> {
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  return (locale["pages"] as Record<string, Record<string, unknown>>)[
    "users"
  ] as Record<string, unknown>;
}

const KEYS: Array<string> = ["bulkDeleteTitle", "bulkDeleteDescription"];

describe("the Users list's bulk Delete", () => {
  test("asks in the Admin Dashboard's words, with the count as userCount", () => {
    expect(deleteAction).toContain('t("pages.users.bulkDeleteTitle", {');
    expect(deleteAction).toContain('t("pages.users.bulkDeleteDescription", {');
    expect(deleteAction.split("userCount: items.length").length - 1).toBe(2);
    expect(deleteAction).not.toMatch(/\{\s*count:/);
  });

  test("no longer says a delete takes users out of their projects, in any words", () => {
    expect(usersPage).not.toContain("remove the user(s) from every project");
    expect(deleteAction).not.toMatch(/`[^`]*\$\{items\.length\}[^`]*`/);
  });

  test("says in English that a user still in a project is not deleted, and that it cannot be undone", () => {
    const english: Record<string, unknown> = usersWords("en");

    expect(english["bulkDeleteTitle"]).toBe("Delete {{userCount}} User(s)");
    expect(english["bulkDeleteDescription"]).toBe(
      "{{userCount}} selected user(s) will be deleted for good, which cannot be undone. A user who is still a member of a project is not deleted: remove them from their projects first.",
    );
  });

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s: both are worded, with the count in them, and neither is the English",
    (language: string) => {
      const words: Record<string, unknown> = usersWords(language);
      const english: Record<string, unknown> = usersWords("en");

      for (const key of KEYS) {
        const value: unknown = words[key];

        expect({ language, key, isText: typeof value === "string" }).toEqual({
          language,
          key,
          isText: true,
        });
        expect({ language, key, english: value === english[key] }).toEqual({
          language,
          key,
          english: false,
        });
        expect({
          language,
          key,
          hasCount: String(value).includes("{{userCount}}"),
          hasPluralCount: String(value).includes("{{count}}"),
        }).toEqual({ language, key, hasCount: true, hasPluralCount: false });
      }
    },
  );

  test("every Admin Dashboard language has them", () => {
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES.length).toBe(18);
  });
});
