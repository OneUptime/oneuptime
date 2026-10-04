import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Where a person sets how they are paged, in the docs.
 *
 * A person's on-call notification rules are one On-Call Rules page with a
 * tab per kind (incidents, incident episodes, alerts, alert episodes): under
 * User Settings for your own, and under Users > (a member) > On-Call for an
 * admin. They used to be four pages in two side-menu sections of their own.
 *
 * The Escalation Rules page says who a level pages; it also says, in every
 * docs language, where each of those people sets how they are reached - with
 * the words that language's dashboard shows. Markdown is not compiled, so
 * these checks read the menus and the locales the words come from.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const PAGE_RELATIVE_PATH: string = "on-call/escalation-rules";

const USER_SETTINGS_MENU: string =
  "App/FeatureSet/Dashboard/src/Pages/UserSettings/SideMenu.tsx";
const USER_VIEW_MENU: string =
  "App/FeatureSet/Dashboard/src/Pages/Users/View/SideMenu.tsx";

// The four pages the tabs replaced, as their addresses ended.
const RETIRED_RULE_PAGE_PATHS: Array<string> = [
  "incident-on-call-rules",
  "incident-episode-on-call-rules",
  "alert-on-call-rules",
  "alert-episode-on-call-rules",
];

interface DashboardWords {
  userSettings: string;
  users: string;
  onCallRules: string;
}

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
    "utf8",
  );
}

/*
 * The words a language's dashboard shows for the path: the navbar's User
 * Settings item, the Users product and the On-Call Rules menu entry.
 */
function readDashboardWords(lang: string): DashboardWords {
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  );

  const navbar: Record<string, string> = locale["navbar"] as Record<
    string,
    string
  >;

  return {
    userSettings: navbar["userSettings"] || "User Settings",
    users: (locale["Users"] as string) || "Users",
    onCallRules: (locale["On-Call Rules"] as string) || "On-Call Rules",
  };
}

// Every Markdown file under the docs content, in every language.
function allDocsFiles(directory: string = CONTENT_DIR): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...allDocsFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }

  return files;
}

describe("the docs send people to the one On-Call Rules page", () => {
  it("names the menu entries the dashboard really has", () => {
    expect(readRepoFile(USER_SETTINGS_MENU)).toContain(
      'title: "On-Call Rules"',
    );
    expect(readRepoFile(USER_VIEW_MENU)).toContain('title: "On-Call Rules"');
    expect(readPage("en")).toContain("**User Settings** > **On-Call Rules**");
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names your own page and a member's with its dashboard's words",
    (lang: string) => {
      const page: string = readPage(lang);
      const words: DashboardWords = readDashboardWords(lang);

      expect({
        lang,
        found: page.includes(
          `**${words.userSettings}** > **${words.onCallRules}**`,
        ),
      }).toEqual({ lang, found: true });

      expect({
        lang,
        found:
          page.includes(`**${words.users}** > `) &&
          page.split(`**${words.onCallRules}**`).length - 1 >= 2,
      }).toEqual({ lang, found: true });
    },
  );

  it("no docs page, in any language, links one of the four retired pages", () => {
    const offenders: Array<string> = [];

    for (const file of allDocsFiles()) {
      const text: string = fs.readFileSync(file, "utf8");

      for (const retiredPath of RETIRED_RULE_PAGE_PATHS) {
        if (
          text.includes(`user-settings/${retiredPath}`) ||
          text.includes(`/${retiredPath})`)
        ) {
          offenders.push(`${path.relative(CONTENT_DIR, file)}: ${retiredPath}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no docs page names the old User Settings sections", () => {
    const offenders: Array<string> = [];

    for (const file of allDocsFiles()) {
      const text: string = fs.readFileSync(file, "utf8");

      for (const oldSection of [
        "**Incident On-Call**",
        "**Alert On-Call**",
        "**User Settings** > **Incident On-Call Rules**",
        "**User Settings** > **Alert On-Call Rules**",
      ]) {
        if (text.includes(oldSection)) {
          offenders.push(`${path.relative(CONTENT_DIR, file)}: ${oldSection}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
