import {
  CONNECT_LINK_INVALID,
  getConnectCallbackMessageKey,
} from "../../../FeatureSet/Dashboard/src/Utils/Workspace/ConnectCallbackMessage";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import { PermissionHelper } from "Common/Types/Permission";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
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
 * The English guide's troubleshooting quotes what Code Repositories says when
 * GitHub sends the browser back unconnected, word for word, read here from
 * the page's own sentences - and the start's permission refusal from the
 * server's constant.
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

// The link's lifetime, the app's own GitHub page, and a 'Step 10' heading, in any language's digits.
const FIFTEEN_MINUTES: RegExp = /15|۱۵/;
const GITHUB_APP_PAGE: RegExp = /github\.com\/apps\/[A-Z_]+/;
const STEP_TEN: RegExp = /(10|۱۰|十)/;

describe("the self-hosted GitHub guide, in every language", () => {
  test("every language has the guide", () => {
    expect(ALL_LANGUAGES.length).toBeGreaterThanOrEqual(17);

    for (const language of ALL_LANGUAGES) {
      expect([
        language,
        fs.existsSync(path.join(CONTENT_DIR, language, GUIDE)),
      ]).toEqual([language, true]);
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

      expect([language, FIFTEEN_MINUTES.test(guide)]).toEqual([language, true]);
    }
  });

  test("no longer sends readers to install from the app's page on GitHub", () => {
    for (const language of ALL_LANGUAGES) {
      const guide: string = readGuide(language);

      expect([language, GITHUB_APP_PAGE.test(guide)]).toEqual([
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
          return line.startsWith("### ") && STEP_TEN.test(line);
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
  /*
   * GitHub sends the browser back to Code Repositories with a code, and the
   * page says the sentence for it (ConnectCallbackMessage): the guide quotes
   * the first sentence of each, as the page words it.
   */
  test.each([
    ConnectCallbackError.LinkInvalid,
    ConnectCallbackError.GitHubNoAuthorization,
    ConnectCallbackError.GitHubNotVerified,
    ConnectCallbackError.GitHubNoInstallation,
    ConnectCallbackError.NotConfigured,
    ConnectCallbackError.CouldNotFinish,
  ])(
    "quotes what Code Repositories says for %s, as the page words it",
    (code: ConnectCallbackError) => {
      const message: string = getConnectCallbackMessageKey(
        ConnectProvider.GitHub,
        code,
      );
      const firstSentence: string = message.includes(". ")
        ? `${message.split(". ")[0]}.`
        : message;

      expect(readGuide("en")).toContain(`**"${firstSentence}`);
    },
  );

  test("quotes the whole sentence for a link that cannot be used", () => {
    expect(CONNECT_LINK_INVALID).toBe(
      "This connection link is invalid, has expired, or has already been used. Please start again.",
    );
    expect(readGuide("en")).toContain(`**"${CONNECT_LINK_INVALID}":**`);
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
