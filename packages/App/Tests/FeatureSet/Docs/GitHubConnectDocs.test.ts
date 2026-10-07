import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Connecting a GitHub App installation, as the self-hosted GitHub guide
 * tells it in every language:
 *
 *  - it starts from Code Repositories in OneUptime, not from the app's page
 *    on GitHub, and the old Step 10 (pick repositories from a list after
 *    installing) is gone - repositories are imported;
 *  - it needs permission to add code repositories: the guide names every
 *    permission the Code Repositories create list grants it with, read here
 *    from the model;
 *  - the link works once, for 15 minutes, in the browser that started it.
 *
 * The English guide's troubleshooting quotes the two refusals word for word,
 * read here from the server's own constants.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const GUIDE: string = "self-hosted/github-integration.md";

const ALL_LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

function readGuide(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, GUIDE), "utf8");
}

// A string constant of the server's GitHub connection rule, read from source.
function serverMessage(name: string): string {
  const source: string = fs.readFileSync(
    path.join(REPO_ROOT, "Common/Server/API/GitHubConnectAccess.ts"),
    "utf8",
  );
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${name}: string =\\s*"([^"]+)"`),
  );

  expect(match).not.toBeNull();

  return match![1]!;
}

describe("the self-hosted GitHub guide, in every language", () => {
  test("every language has the guide", () => {
    expect(ALL_LANGUAGES.length).toBeGreaterThanOrEqual(17);

    for (const language of ALL_LANGUAGES) {
      expect([language, fs.existsSync(path.join(CONTENT_DIR, language, GUIDE))]).toEqual([
        language,
        true,
      ]);
    }
  });

  test("names every permission that may connect, in bold, as the server's create list has them", () => {
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      new CodeRepository().getCreatePermissions(),
    );

    expect(titles).toEqual(
      expect.arrayContaining(["Project Owner", "Create Code Repository"]),
    );

    for (const language of ALL_LANGUAGES) {
      const guide: string = readGuide(language);

      for (const title of titles) {
        expect([language, title, guide.includes(`**${title}**`)]).toEqual([
          language,
          title,
          true,
        ]);
      }
    }
  });

  test("says the link lasts 15 minutes", () => {
    for (const language of ALL_LANGUAGES) {
      const guide: string = readGuide(language);

      expect([language, /15|۱۵/.test(guide)]).toEqual([language, true]);
    }
  });

  test("no longer sends readers to install from the app's page on GitHub", () => {
    for (const language of ALL_LANGUAGES) {
      const guide: string = readGuide(language);

      expect([language, /github\.com\/apps\/[A-Z_]+/.test(guide)]).toEqual([
        language,
        false,
      ]);
    }
  });

  test("has no Step 10 left: repositories are imported, not picked from a list", () => {
    for (const language of ALL_LANGUAGES) {
      const stepTenHeadings: Array<string> = readGuide(language)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("### ") && /(10|۱۰|十)/.test(line);
        });

      expect([language, stepTenHeadings]).toEqual([language, []]);
    }
  });

  test("the connect step names the Code Repositories card's button", () => {
    const english: string = readGuide("en");

    expect(english).toContain(
      "Navigate to **Products** > **Tasks** > **Code Repositories**",
    );
    expect(english).toContain("Click **Connect with GitHub App**");
    expect(english).not.toContain(
      "Select the repositories you want to connect from the list",
    );
  });
});

describe("the English guide's troubleshooting", () => {
  test("quotes the refusal of a link that cannot be used, as the server words it", () => {
    const message: string = serverMessage("GITHUB_CONNECT_LINK_MESSAGE");
    const quoted: string =
      "This GitHub connection link is invalid, has expired, or has already been used";

    expect(message.startsWith(quoted)).toBe(true);
    expect(readGuide("en")).toContain(`**"${quoted}":**`);
  });

  test("quotes the refusal of someone who may not connect, as the server words it", () => {
    const message: string = serverMessage("GITHUB_CONNECT_PERMISSION_MESSAGE");
    const quoted: string = message.replace(/\.$/, "");

    expect(quoted).toBe(
      "You do not have permission to add code repositories to this project",
    );
    expect(readGuide("en")).toContain(`**"${quoted}":**`);
  });
});
