import { getConnectCallbackMessageKey } from "../../../FeatureSet/Dashboard/src/Utils/Workspace/ConnectCallbackMessage";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * When Slack, Microsoft or GitHub sends the browser back and the connection
 * was not made, the page it started from says why in one sentence
 * (Dashboard Utils/Workspace/ConnectCallbackMessage). Each self-hosted guide's
 * troubleshooting quotes the first sentence of every one its callbacks can
 * answer with, as the page words it, says what to do about it, and says that
 * what the provider itself answered is in the server log, not on the page.
 */

const GUIDES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en/self-hosted",
);

interface Guide {
  file: string;
  provider: ConnectProvider;
  codes: Array<ConnectCallbackError>;
}

const COMMON_CODES: Array<ConnectCallbackError> = [
  ConnectCallbackError.LinkInvalid,
  ConnectCallbackError.NoPermission,
  ConnectCallbackError.NotConfigured,
  ConnectCallbackError.CouldNotFinish,
];

const GUIDES: Array<Guide> = [
  {
    file: "slack-integration.md",
    provider: ConnectProvider.Slack,
    codes: [
      ...COMMON_CODES,
      ConnectCallbackError.NotAMember,
      ConnectCallbackError.Cancelled,
      ConnectCallbackError.SlackNotInstalled,
      ConnectCallbackError.SlackOtherWorkspace,
    ],
  },
  {
    file: "microsoft-teams-integration.md",
    provider: ConnectProvider.MicrosoftTeams,
    codes: [
      ...COMMON_CODES,
      ConnectCallbackError.NotAMember,
      ConnectCallbackError.Cancelled,
      ConnectCallbackError.TeamsOtherTenant,
      ConnectCallbackError.TeamsNoTeams,
    ],
  },
  {
    file: "github-integration.md",
    provider: ConnectProvider.GitHub,
    codes: [
      ConnectCallbackError.LinkInvalid,
      ConnectCallbackError.NotConfigured,
      ConnectCallbackError.CouldNotFinish,
      ConnectCallbackError.GitHubNoAuthorization,
      ConnectCallbackError.GitHubNotVerified,
      ConnectCallbackError.GitHubNoInstallation,
    ],
  },
];

function firstSentence(message: string): string {
  return message.includes(". ") ? `${message.split(". ")[0]}.` : message;
}

describe("each self-hosted connect guide quotes what its page says", () => {
  test.each(GUIDES)(
    "$file quotes every sentence its page can show",
    (guide: Guide) => {
      const text: string = fs.readFileSync(
        path.join(GUIDES_DIR, guide.file),
        "utf8",
      );

      for (const code of guide.codes) {
        const quoted: string = firstSentence(
          getConnectCallbackMessageKey(guide.provider, code),
        );

        expect([code, text.includes(`**"${quoted}`)]).toEqual([code, true]);
      }
    },
  );

  test.each(GUIDES)(
    "$file says the provider's own answer is in the server log, not on the page",
    (guide: Guide) => {
      const text: string = fs.readFileSync(
        path.join(GUIDES_DIR, guide.file),
        "utf8",
      );

      expect(text).toContain("in the OneUptime server log");
    },
  );
});
