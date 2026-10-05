import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Creating an API key now asks for its Access - Project Admin, Project
 * Member, Viewer or Choose permissions later - with the expiry date folded
 * under More fields, and Invite User starts on the members team. The guides
 * that walk someone through making a key used to say "give it a name and an
 * expiry" and "grant permissions", which no longer matches the form.
 * Markdown is not compiled, so these pin the guides to the form:
 *
 *   - Users & Permissions names every Access choice the form offers, with
 *     Choose permissions later as the one picked to start with, and says
 *     where block permissions and the expiry date went;
 *   - the Terraform quick start, in every docs language (its steps are
 *     English in all of them, Persian aside), picks Project Admin under
 *     Access and no longer asks for an expiry;
 *   - the MCP server guide picks Viewer or Project Admin under Access.
 *
 * The choices are read from the form's own source - the Access question
 * Create API Key shares with Create Team (Components/Permission/RoleAccess)
 * - so a renamed card fails here rather than leaving the docs behind.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const ACCESS_SOURCE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess.ts",
);

const LANGUAGES: ReadonlyArray<string> = [
  "en",
  "fa",
  "da",
  "de",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

/*
 * The titles of the Access cards, as the form's source writes them: each
 * once (Choose permissions later is written for keys and for teams), and
 * not the question's own title, Access.
 */
function accessTitles(): Array<string> {
  const source: string = fs.readFileSync(ACCESS_SOURCE, "utf8");
  const titles: Array<string> = [];
  const titlePattern: RegExp = /title:\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = titlePattern.exec(source);

  while (match) {
    if (match[1] !== "Access" && !titles.includes(match[1]!)) {
      titles.push(match[1]!);
    }

    match = titlePattern.exec(source);
  }

  return titles;
}

describe("the Access choices the docs describe", () => {
  it("are read from the form", () => {
    expect(accessTitles()).toEqual([
      "Project Admin",
      "Project Member",
      "Viewer",
      "Choose permissions later",
    ]);
  });

  it("are all in Users & Permissions, one table row each", () => {
    const page: string = readPage("en", "permissions/index");

    for (const title of accessTitles()) {
      expect(page).toContain(`| ${title} |`);
    }

    expect(page).toContain(
      "| Choose permissions later | Nothing yet. Picked to start with. |",
    );
  });

  it("come with where the rest of a key went", () => {
    const page: string = readPage("en", "permissions/index");

    expect(page).toContain(
      "**Creating a key** asks for a name and its **Access**",
    );
    expect(page).toContain(
      "The description and the expiry date are under **More fields**",
    );
    expect(page).toContain("a key expires a year from the day it is created");
    // The folded section says when the key expires (ApiKeyCreateForm).
    expect(page).toContain("and the folded section says so");
    expect(page).toContain(
      "**Block Permissions** are under **More settings** at the bottom of the page",
    );
    expect(page).toContain("**Add Role**");
  });

  it("say a key is never given more than the person giving it has", () => {
    expect(readPage("en", "permissions/index")).toContain(
      "You are offered only the roles you hold yourself",
    );
  });
});

describe("Users & Permissions on inviting someone", () => {
  it("says Invite User starts on the members team, and when it picks nothing", () => {
    const page: string = readPage("en", "permissions/index");

    expect(page).toContain(
      "**Invite User** starts on the project's members team: the team that holds `ProjectMember` for the whole project",
    );
    expect(page).toContain(
      "Nothing is picked when you could not invite to that team yourself",
    );
  });
});

describe("the Terraform quick start", () => {
  it("covers all 17 docs languages", () => {
    const languages: Array<string> = fs
      .readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return (
          entry.isDirectory() &&
          fs.existsSync(
            path.join(CONTENT_DIR, entry.name, "terraform/quick-start.md"),
          )
        );
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      })
      .sort();

    expect(languages).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)(
    "%s: picks Project Admin under Access and asks for no expiry",
    (language: string) => {
      const page: string = readPage(language, "terraform/quick-start");

      expect(page).toContain("**Access**");
      expect(page).toContain("**Project Admin**");
      expect(page).toContain("**Choose permissions later**");
      expect(page).toContain("**More fields**");

      // The step the form no longer has.
      expect(page).not.toContain("and an expiry.");
      expect(page).not.toContain("و یک تاریخ انقضا بگذارید");
    },
  );
});

describe("the MCP server guide", () => {
  it("picks Viewer or Project Admin under Access", () => {
    const page: string = readPage("en", "ai/mcp-server");

    expect(page).toContain(
      "Under **Access**, pick **Viewer** for an agent that only reads, or **Project Admin** for one that also creates, updates and deletes",
    );
    expect(page).not.toContain(
      "Select the appropriate permissions for your use case",
    );
  });
});
