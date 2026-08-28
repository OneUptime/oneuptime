import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Tests for the two diagnostic message builders an admin actually reads when a
 * Microsoft Teams notification fails: getBotNotInTeamMessage and
 * getRosterRejectionMessage.
 *
 * The failure these messages exist to end is a self-hosted deployment whose
 * admin installed the "OneUptime" app from the Microsoft Teams store. That
 * package's bot belongs to OneUptime Cloud, so Teams installs it happily, shows
 * a OneUptime tile under Manage team > Apps, and then refuses every proactive
 * post from this deployment with "The bot is not part of the conversation
 * roster." An admin looking straight at that tile reads "the OneUptime app is
 * not installed" as nonsense and goes round the loop again, which is how this
 * turns into a multi-day investigation.
 *
 * So both builders now carry the wrong-package note, and getRosterRejectionMessage
 * distinguishes the four install states:
 *
 * - Installed: Graph confirmed a package with THIS deployment's app id is in
 *   the team, so the package stops leading and the message must NOT send the
 *   admin back to re-verify it. The wording stays hedged ("probably"), because
 *   the check matches the manifest id rather than the bot id directly. This is
 *   a behaviour change from the previous wording and is pinned below.
 * - NotInstalled / Unknown: the package is still a live suspect, so the
 *   "different package whose bot id is not this deployment's
 *   MICROSOFT_TEAMS_APP_CLIENT_ID" wording stays.
 * - PermissionDenied: Graph refused the installed-apps read, so OneUptime is
 *   guessing only because it was not allowed to know. This — and only this —
 *   state names TeamsAppInstallation.ReadForTeam.All and tells the admin that
 *   granting it turns the guess into an answer.
 *
 * Message-shape coverage that already lives in MicrosoftTeamsChannelSend.test.ts
 * (branch selection by membershipType, the basic "names the channel" case,
 * quoting Microsoft's error) is not repeated here; this file covers the new
 * behaviour and the branches that file misses.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

import MicrosoftTeamsUtil, {
  MICROSOFT_TEAMS_INSTALL_READ_PERMISSION,
  MicrosoftTeamsAppInstallState,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";

/*
 * The note that must appear in BOTH branches of getBotNotInTeamMessage. Asserted
 * as three separate claims rather than one long literal, so a rewording that
 * keeps the substance does not fail, but dropping any of the three does.
 */
const WRONG_PACKAGE_IS_DIFFERENT: string = "it is a different package";
const WRONG_PACKAGE_POINTS_AT_CLOUD: string =
  "the app from the Teams store points at OneUptime Cloud's bot";
const WRONG_PACKAGE_FIX: string =
  "upload the manifest from Project Settings > Workspace > Microsoft Teams";

/*
 * The instruction the Installed branch used to carry and must not carry any
 * more: Graph has already confirmed the package, so sending the admin back to
 * check it is the thing that made this message feel unread.
 */
const OLD_RE_VERIFY_PACKAGE_INSTRUCTION: string =
  "check that the Teams app package was built from this deployment";

const AZURE_BOT_CAUSE: string =
  "the Azure Bot resource for this deployment does not have the Microsoft Teams channel enabled";

const MICROSOFT_QUOTE_PREFIX: string = "Microsoft's response was";

const ALL_INSTALL_STATES: Array<MicrosoftTeamsAppInstallState> = [
  MicrosoftTeamsAppInstallState.Installed,
  MicrosoftTeamsAppInstallState.NotInstalled,
  MicrosoftTeamsAppInstallState.PermissionDenied,
  MicrosoftTeamsAppInstallState.Unknown,
];

function expectWrongPackageNote(message: string): void {
  expect(message).toContain(WRONG_PACKAGE_IS_DIFFERENT);
  expect(message).toContain(WRONG_PACKAGE_POINTS_AT_CLOUD);
  expect(message).toContain(WRONG_PACKAGE_FIX);
}

describe("MicrosoftTeamsAppInstallState", () => {
  test("PermissionDenied is a distinct state, not an alias of Unknown", () => {
    /*
     * The whole point of splitting it out: a tenant that answers "I won't tell
     * you" is fixable in a minute, and a transport failure is not. Collapsing
     * the two back together silently removes the one actionable hint.
     */
    expect(MicrosoftTeamsAppInstallState.PermissionDenied).toBe(
      "PermissionDenied",
    );
    expect(MicrosoftTeamsAppInstallState.PermissionDenied).not.toBe(
      MicrosoftTeamsAppInstallState.Unknown,
    );
  });

  test("the permission the error names is the one the setup docs tell you to grant", () => {
    /*
     * A real cross-file check rather than asserting the constant equals its own
     * literal. The error string builds off the constant while the setup guide
     * and the docs site spell it out in prose, so a rename here silently leaves
     * an admin hunting for a permission the documentation never mentions.
     */
    const docSources: Array<string> = [
      "../../../../../App/FeatureSet/Docs/Content/en/self-hosted/microsoft-teams-integration.md",
      "../../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation.tsx",
    ].map((relativePath: string) => {
      return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    });

    for (const source of docSources) {
      expect(source).toContain(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION);
    }
  });
});

describe("MicrosoftTeamsUtil.getBotNotInTeamMessage - wrong-package note", () => {
  test("the standard-channel branch keeps its install path AND names the wrong-package case", () => {
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "General",
      membershipType: "standard",
    });

    expect(message).toContain('team that owns "General"');
    expect(message).toContain('"..."');
    expect(message).toContain("Manage team > Apps > More apps");
    expectWrongPackageNote(message);
  });

  test("the private-channel branch keeps its install path and deliberately omits the wrong-package note", () => {
    /*
     * The note must NOT appear here. The install check reads
     * /teams/{id}/installedApps — team scope — while a private channel needs its
     * own channel-scope install, so a perfectly correct channel install still
     * comes back NotInstalled. Telling that admin their package is the wrong one
     * and to "remove it" would talk them into destroying a working install to
     * fix a problem they do not have.
     */
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "Ops War Room",
      membershipType: "private",
    });

    expect(message).toContain('private channel "Ops War Room"');
    expect(message).toContain("Manage channel > Apps > Add an app");
    expect(message).toContain(
      "Installing OneUptime in the parent team does not cover private channels.",
    );
    expect(message).not.toContain(WRONG_PACKAGE_IS_DIFFERENT);
    expect(message).not.toContain("Remove it");
  });

  test("an undefined membershipType takes the standard branch and still carries the note", () => {
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "General",
    });

    expect(message).toContain("Manage team > Apps > More apps");
    expect(message).not.toContain("Manage channel");
    expectWrongPackageNote(message);
  });

  test("the note explains why a OneUptime tile is not proof of anything", () => {
    /*
     * "Remove it, then upload ours" is the actionable half. Without it the note
     * only tells the admin that what they are looking at is wrong, which is
     * where they already were.
     */
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "General",
    });

    expect(message).toContain("If a tile named OneUptime is already listed");
    expect(message).toContain("Remove it");
    expect(message).toContain("MICROSOFT_TEAMS_APP_CLIENT_ID");
  });

  test("the note is appended to, not substituted for, the install instructions", () => {
    const standard: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "General",
      membershipType: "standard",
    });

    expect(standard.indexOf("Manage team > Apps > More apps")).toBeLessThan(
      standard.indexOf(WRONG_PACKAGE_IS_DIFFERENT),
    );
  });

  test("a channel name containing quotes is interpolated verbatim in both branches", () => {
    /*
     * Teams allows quotes in channel names, and the message wraps the name in
     * quotes of its own. Nothing escapes or strips it, and nothing should
     * silently truncate at the inner quote.
     */
    const channelName: string = 'The "Real" Ops Channel';

    const standard: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: channelName,
      membershipType: "standard",
    });
    const privateChannel: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: channelName,
      membershipType: "private",
    });

    expect(standard).toContain(`team that owns "${channelName}"`);
    expect(privateChannel).toContain(`private channel "${channelName}"`);
  });

  test("a unicode channel name is interpolated verbatim in both branches", () => {
    const channelName: string = "運用 – アラート 🚨";

    const standard: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: channelName,
      membershipType: "standard",
    });
    const privateChannel: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: channelName,
      membershipType: "private",
    });

    expect(standard).toContain(`team that owns "${channelName}"`);
    expect(privateChannel).toContain(`private channel "${channelName}"`);
  });

  test("an empty channel name still produces the instructions rather than an empty message", () => {
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "",
    });

    expect(message).toContain("Manage team > Apps > More apps");
    expectWrongPackageNote(message);
  });
});

describe("MicrosoftTeamsUtil.getRosterRejectionMessage - invariants across every install state", () => {
  test.each(ALL_INSTALL_STATES)(
    "%s names the refused channel and blames the roster",
    (installState: MicrosoftTeamsAppInstallState) => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "test public channel",
        installState: installState,
      });

      expect(message).toContain(
        'Microsoft Teams refused the message to "test public channel"',
      );
      expect(message).toContain(
        "the OneUptime bot is not a member of that conversation",
      );
    },
  );

  test.each(ALL_INSTALL_STATES)(
    "%s always lists the Azure Bot Microsoft Teams channel as a cause",
    (installState: MicrosoftTeamsAppInstallState) => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
      });

      expect(message).toContain(AZURE_BOT_CAUSE);
    },
  );

  /*
   * Removed: a test asserting getRosterRejectionMessage never contains "The
   * OneUptime app is not installed in the Microsoft Teams team". That sentence
   * only ever lived in getBotNotInTeamMessage, so the assertion could not fail
   * before or after this change. The property it was reaching for — that a
   * refusal to answer never reaches the admin as a statement that the app is
   * missing — is real, but it belongs on the send path where the two builders
   * are actually selected between. It is covered in
   * MicrosoftTeamsChannelSend.test.ts ("a Graph permission refusal reaches the
   * admin as a named grant, end to end").
   */
  test.each(ALL_INSTALL_STATES)(
    "%s names the channel it is talking about",
    (installState: MicrosoftTeamsAppInstallState) => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
      });

      expect(message).toContain('"General"');
    },
  );

  test.each(ALL_INSTALL_STATES)(
    "%s produces a single sentence-terminated message with no dangling separators",
    (installState: MicrosoftTeamsAppInstallState) => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
      });

      expect(message.endsWith(".")).toBe(true);
      expect(message).not.toContain(";.");
      expect(message).not.toContain("  ");
    },
  );
});

describe("MicrosoftTeamsUtil.getRosterRejectionMessage - the PermissionDenied hint", () => {
  test("PermissionDenied names the permission, the grant, and the retry", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.PermissionDenied,
    });

    expect(message).toContain(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION);
    expect(message).toContain(
      "Microsoft Graph denied the installed-apps check",
    );
    expect(message).toContain("application permission");
    expect(message).toContain("re-grant admin consent");
    expect(message).toContain("try again");
  });

  test.each([
    MicrosoftTeamsAppInstallState.Installed,
    MicrosoftTeamsAppInstallState.NotInstalled,
    MicrosoftTeamsAppInstallState.Unknown,
  ])(
    "%s does NOT carry the grant-this-permission hint",
    (installState: MicrosoftTeamsAppInstallState) => {
      /*
       * The hint is only true when Graph refused. Attaching it to a transport
       * failure or to a successful read sends an admin to change a permission
       * that was never the problem.
       */
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
      });

      expect(message).not.toContain(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION);
      expect(message).not.toContain(
        "Microsoft Graph denied the installed-apps check",
      );
    },
  );

  test("the hint survives a private channel, which takes a different causes branch", () => {
    /*
     * membershipType decides the FIRST cause; installState decides the hint.
     * They are independent, and a private channel in a tenant that refused the
     * Graph read needs both.
     */
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "Ops War Room",
      membershipType: "private",
      installState: MicrosoftTeamsAppInstallState.PermissionDenied,
    });

    expect(message).toContain("Manage channel > Apps");
    expect(message).toContain(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION);
  });
});

describe("MicrosoftTeamsUtil.getRosterRejectionMessage - the Installed branch no longer re-litigates the package", () => {
  test("Installed states that the package is ruled out", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Installed,
    });

    /*
     * "Probably", not "definitely". The check matches teamsApp.externalId, which
     * is the manifest id; only OneUptime's own generator guarantees that equals
     * the bot id, so a hand-edited manifest can satisfy it and still carry a
     * foreign bot. The wording must not promise more than the evidence supports.
     */
    expect(message).toContain(
      "already matches this deployment's MICROSOFT_TEAMS_APP_CLIENT_ID",
    );
    expect(message).toContain("probably not the problem");
    expect(message).not.toContain("the package is not the problem");
  });

  test("Installed points at the Azure Bot resource as the remaining cause", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Installed,
    });

    expect(message).toContain(
      "the most likely remaining cause is the Azure Bot resource",
    );
    expect(message).toContain(AZURE_BOT_CAUSE);
  });

  test("Installed no longer tells the admin to go and re-verify the package", () => {
    /*
     * Behaviour change, pinned deliberately. Graph already compared the
     * installed package's externalId against this deployment's client id — that
     * is the entire reason the state is Installed. Asking the admin to redo the
     * check by eye is worse than saying nothing, because it reads as a message
     * that did not take its own evidence into account.
     */
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Installed,
    });

    expect(message).not.toContain(OLD_RE_VERIFY_PACKAGE_INSTRUCTION);
    expect(message).not.toContain("Manage team > Apps");
    /*
     * The identifier itself stays. It is the value an admin compares against the
     * installed app's bot id, so naming it is useful; what had to go was the
     * instruction to go and redo a check OneUptime had already done for them.
     */
    expect(message).toContain("MICROSOFT_TEAMS_APP_CLIENT_ID");
  });

  test.each([
    MicrosoftTeamsAppInstallState.NotInstalled,
    MicrosoftTeamsAppInstallState.Unknown,
  ])(
    "%s still warns that the added app may be somebody else's package",
    (installState: MicrosoftTeamsAppInstallState) => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
      });

      expect(message).toContain("Manage team > Apps > More apps");
      expect(message).toContain(
        "the app that was added is a different package whose bot id is not this deployment's MICROSOFT_TEAMS_APP_CLIENT_ID",
      );
    },
  );

  test("PermissionDenied shares the not-installed causes, because we could not rule them out", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.PermissionDenied,
    });

    expect(message).toContain("Manage team > Apps > More apps");
    expect(message).toContain(
      "the app that was added is a different package whose bot id is not this deployment's MICROSOFT_TEAMS_APP_CLIENT_ID",
    );
  });

  test.each(ALL_INSTALL_STATES)(
    "a private channel takes the private branch regardless of installState (%s)",
    (installState: MicrosoftTeamsAppInstallState) => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "Ops War Room",
        membershipType: "private",
        installState: installState,
      });

      expect(message).toContain(
        '"Ops War Room" is a private channel, which needs the app installed into the channel itself',
      );
      expect(message).toContain("Manage channel > Apps > Add an app");
      expect(message).toContain("a team-level install does not cover it");
      expect(message).not.toContain("Manage team > Apps");
    },
  );

  test("only the exact string 'private' selects the private-channel cause", () => {
    /*
     * Graph returns membershipType lowercase, so the comparison is exact. Pin
     * it here too: a loosened comparison would silently change which cause an
     * admin is shown first.
     */
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      membershipType: "Private",
      installState: MicrosoftTeamsAppInstallState.Unknown,
    });

    expect(message).toContain("Manage team > Apps > More apps");
    expect(message).not.toContain("Manage channel");
  });
});

describe("MicrosoftTeamsUtil.getRosterRejectionMessage - Microsoft's raw response", () => {
  test("an Error has its message appended in quotes", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: new Error(
        "The bot is not part of the conversation roster.",
      ),
    });

    expect(message).toContain(
      `${MICROSOFT_QUOTE_PREFIX}: "The bot is not part of the conversation roster."`,
    );
  });

  test("a subclassed Error is treated the same as a plain Error", () => {
    class GraphError extends Error {}

    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: new GraphError("BotNotInConversationRoster"),
    });

    expect(message).toContain(
      `${MICROSOFT_QUOTE_PREFIX}: "BotNotInConversationRoster"`,
    );
  });

  test("a plain string is appended as-is", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: "Forbidden: bot is not in roster",
    });

    expect(message).toContain(
      `${MICROSOFT_QUOTE_PREFIX}: "Forbidden: bot is not in roster"`,
    );
  });

  test.each(ALL_INSTALL_STATES)(
    "an undefined microsoftError appends nothing (%s)",
    (installState: MicrosoftTeamsAppInstallState) => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
        microsoftError: undefined,
      });

      expect(message).not.toContain(MICROSOFT_QUOTE_PREFIX);
    },
  );

  test("a null microsoftError appends nothing rather than the word null", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: null,
    });

    expect(message).not.toContain(MICROSOFT_QUOTE_PREFIX);
    expect(message).not.toContain("null");
  });

  test("an empty-string microsoftError appends nothing rather than an empty quote", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: "",
    });

    expect(message).not.toContain(MICROSOFT_QUOTE_PREFIX);
    expect(message).not.toContain('""');
  });

  test("an Error with an empty message appends nothing", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: new Error(""),
    });

    expect(message).not.toContain(MICROSOFT_QUOTE_PREFIX);
  });
});

describe("MicrosoftTeamsUtil.getRosterRejectionMessage - ordering when both suffixes apply", () => {
  test("PermissionDenied plus a Microsoft error yields both, hint first", () => {
    /*
     * The hint is the thing the admin can act on; Microsoft's raw wording is
     * evidence. Evidence last, so the message does not trail off into the same
     * opaque sentence that sent them here.
     */
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.PermissionDenied,
      microsoftError: new Error(
        "The bot is not part of the conversation roster.",
      ),
    });

    const hintIndex: number = message.indexOf(
      MICROSOFT_TEAMS_INSTALL_READ_PERMISSION,
    );
    const quoteIndex: number = message.indexOf(MICROSOFT_QUOTE_PREFIX);

    expect(hintIndex).toBeGreaterThan(-1);
    expect(quoteIndex).toBeGreaterThan(-1);
    expect(hintIndex).toBeLessThan(quoteIndex);
  });

  test("both suffixes come after the list of likely causes", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.PermissionDenied,
      microsoftError: "Forbidden",
    });

    const causesIndex: number = message.indexOf(AZURE_BOT_CAUSE);

    expect(causesIndex).toBeGreaterThan(-1);
    expect(causesIndex).toBeLessThan(
      message.indexOf(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION),
    );
    expect(causesIndex).toBeLessThan(message.indexOf(MICROSOFT_QUOTE_PREFIX));
  });

  test("a non-PermissionDenied state with a Microsoft error yields only the quote", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: "Forbidden",
    });

    expect(message).toContain(MICROSOFT_QUOTE_PREFIX);
    expect(message).not.toContain(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION);
  });

  test("PermissionDenied without a Microsoft error yields only the hint", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.PermissionDenied,
    });

    expect(message).toContain(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION);
    expect(message).not.toContain(MICROSOFT_QUOTE_PREFIX);
  });
});
