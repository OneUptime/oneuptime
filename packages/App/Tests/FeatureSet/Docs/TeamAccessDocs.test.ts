import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Creating a team now asks for its Access - Project Admin, Project Member,
 * Viewer or Choose permissions later - with the description under More fields,
 * and a team's Block Permissions moved from a page of their own onto its
 * Permissions page, folded under More settings. Markdown is not compiled, so
 * these pin the guides to the dashboard:
 *
 *   - Users & Permissions (English) names every Access choice the form
 *     offers, with Choose permissions later as the one picked, says only
 *     the roles you hold are offered, where a new team opens, and that the
 *     team is kept if its role is refused;
 *   - in every docs language, "where to find it" no longer lists Block
 *     Permissions as a team page beside Members and Permissions, but says
 *     it is under More settings on the Permissions page;
 *   - the MCP server guide (English and Persian) says where to add
 *     Authorize MCP Client as a block.
 *
 * The choices are read from the form's own source (the Access question
 * Create Team shares with Create API Key), so a renamed card fails here
 * rather than leaving the docs behind.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const ACCESS_SOURCE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess.ts",
);

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

function languages(): Array<string> {
  return fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return (
        entry.isDirectory() &&
        fs.existsSync(
          path.join(CONTENT_DIR, entry.name, "permissions/index.md"),
        )
      );
    })
    .map((entry: fs.Dirent): string => {
      return entry.name;
    })
    .sort();
}

/*
 * "**Members**, **Permissions** and **Block Permissions**", in any of the
 * languages' list separators (and "، " / "、" / "و" / "和" between them).
 */
const THREE_TEAM_PAGES: RegExp =
  /\*\*Members\*\*[,、،]\s*\*\*Permissions\*\*[,、،]?\s*[^*\n]{0,12}\*\*Block Permissions\*\*/;

// The Access card titles, each once, as the form's source writes them.
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

// The Teams section of Users & Permissions: from "## Teams" to the next "## ".
function teamsSection(): string {
  const page: string = readPage("en", "permissions/index");
  const start: number = page.indexOf("\n## Teams\n");
  const end: number = page.indexOf("\n## ", start + 1);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return page.slice(start, end);
}

describe("Users & Permissions on creating a team", () => {
  it("reads the Access choices from the form", () => {
    expect(accessTitles()).toEqual([
      "Project Admin",
      "Project Member",
      "Viewer",
      "Choose permissions later",
    ]);
  });

  it("names every Access choice in the Teams section, one table row each", () => {
    const section: string = teamsSection();

    expect(section).toContain(
      "**Creating a team** asks for a name and its **Access**",
    );

    for (const title of accessTitles()) {
      expect(section).toContain(`| ${title} |`);
    }

    expect(section).toContain(
      "| Choose permissions later | Nothing yet. Picked to start with. |",
    );
  });

  it("says the role is added for every resource, as Add Role does, and only roles you hold are offered", () => {
    const section: string = teamsSection();

    expect(section).toContain(
      "The role you pick becomes the team's first permission, for all resources in the project, as soon as the team exists",
    );
    expect(section).toContain("**Add Role** on the team's Permissions page");
    expect(section).toContain(
      "You are offered only the roles you hold yourself",
    );
    expect(section).toContain(
      "someone who may create teams but not change what they can do is not asked",
    );
  });

  it("says where the description went and where a new team opens", () => {
    const section: string = teamsSection();

    expect(section).toContain("The description is under **More fields**.");
    expect(section).toContain(
      "A team with a role opens on its **Members** page",
    );
    expect(section).toContain(
      "with **Choose permissions later** it opens on its **Permissions** page",
    );
    expect(section).toContain(
      "If the role cannot be added, the team is still created and a notice above the list links to it.",
    );
  });

  it("the watching recipe starts from Viewer under Access", () => {
    expect(readPage("en", "permissions/index")).toContain(
      "**A team that only watches.** Create the team with **Viewer** under **Access**.",
    );
  });
});

describe("where a team's Block Permissions are", () => {
  it("covers all 17 docs languages", () => {
    expect(languages()).toHaveLength(17);
  });

  it.each(languages())(
    "%s: not a team page beside Members and Permissions, but under More settings",
    (language: string) => {
      const page: string = readPage(language, "permissions/index");

      // The sentence that sends the reader into a team.
      const line: string | undefined = page
        .split("\n")
        .find((candidate: string): boolean => {
          return (
            candidate.includes("**Members**") &&
            candidate.includes("**Permissions**") &&
            candidate.includes("**Block Permissions**")
          );
        });

      expect(line).toBeDefined();
      expect(line).toContain("**More settings**");

      // Never three team pages in a row, as every language used to say.
      expect(page).not.toMatch(THREE_TEAM_PAGES);
    },
  );

  it("English: the allow and block lists are both on the Permissions page", () => {
    expect(readPage("en", "permissions/index")).toContain(
      "Both are on the team's **Permissions** page. Few teams need a block, so block permissions are folded under **More settings** at the bottom of the page.",
    );
  });
});

describe("the MCP server guide", () => {
  it.each(["en", "fa"])(
    "%s: adds Authorize MCP Client as a block under More settings on the team's Permissions page",
    (language: string) => {
      const page: string = readPage(language, "ai/mcp-server");
      const line: string | undefined = page
        .split("\n")
        .find((candidate: string): boolean => {
          return candidate.includes("**Authorize MCP Client**");
        });

      expect(line).toBeDefined();
      expect(line).toContain("**Permissions**");
      expect(line).toContain("**More settings**");
      expect(line).toContain("**Block Permissions**");
    },
  );

  it("English no longer sends the reader to a Block Permissions page", () => {
    expect(readPage("en", "ai/mcp-server")).not.toContain(
      "go to **Block Permissions**",
    );
  });
});
