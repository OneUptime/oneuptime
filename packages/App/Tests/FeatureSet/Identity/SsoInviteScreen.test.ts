import ejs from "ejs";
import fs from "fs";
import nodePath from "path";
import { describe, expect, test } from "@jest/globals";
import {
  SsoInviteScreen,
  SsoInviteScreenKind,
  toSsoInviteScreen,
  toSsoInviteViewVariables,
} from "../../../FeatureSet/Identity/Utils/SsoInviteScreen";
import {
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_NO_PROJECT_MESSAGE,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  SSO_INVITE_SCREEN_TITLE,
  SSO_NO_PROJECT_SCREEN_TITLE,
  getDefaultHelpAndSupportSettings,
} from "Common/Types/HelpAndSupport/HelpAndSupport";

/*
 * WHAT THE SERVER'S SINGLE SIGN-ON SAYS TO SOMEONE WHO NEEDS AN INVITATION
 * (#10865).
 *
 * Global SAML and Global OIDC turn away someone with no account while the
 * provider creates none ("You need to be invited.") and someone whose
 * account is in no project ("No project access."). Both screens say the
 * message a master admin wrote on Admin Dashboard > Settings > Help and
 * Support - its lines as paragraphs, its links and addresses as links,
 * everything escaped - and the mobile app is handed the same words. With
 * no message of the server's own, each screen says, and is drawn, exactly
 * as it always was.
 */

const VIEW: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "Views",
  "Message.ejs",
);

const IDENTITY_API: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "API",
);

async function renderView(vars: Record<string, unknown>): Promise<string> {
  return await ejs.renderFile(VIEW, {
    enableGoogleTagManager: false,
    ...vars,
  });
}

const withMessage: (message: string) => HelpAndSupportSettings = (
  message: string,
): HelpAndSupportSettings => {
  const settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();
  settings[HelpItem.InviteMessage] = { choice: HelpChoice.Text, value: message };
  return settings;
};

const OWN_MESSAGE: string =
  "Ask the IT service desk to invite you:\nit-help@example.com or https://help.example.com/oneuptime";

describe("the screen's words", () => {
  test("by default, each screen says the sentence it always said, as one sentence", () => {
    expect(
      toSsoInviteScreen(
        getDefaultHelpAndSupportSettings(),
        SsoInviteScreenKind.InvitationRequired,
      ),
    ).toEqual({ message: DEFAULT_INVITE_MESSAGE });
    expect(
      toSsoInviteScreen(
        getDefaultHelpAndSupportSettings(),
        SsoInviteScreenKind.NoProject,
      ),
    ).toEqual({ message: DEFAULT_NO_PROJECT_MESSAGE });
  });

  test("with the server's own message, both screens say it, drawn in paragraphs with links", () => {
    for (const kind of [
      SsoInviteScreenKind.InvitationRequired,
      SsoInviteScreenKind.NoProject,
    ]) {
      const screen: SsoInviteScreen = toSsoInviteScreen(
        withMessage(OWN_MESSAGE),
        kind,
      );

      expect(screen.message).toBe(OWN_MESSAGE);
      expect(screen.messageParagraphs).toHaveLength(2);
    }
  });

  test("the view is handed the title, the message and, only for the server's own, its paragraphs", () => {
    expect(
      toSsoInviteViewVariables(SSO_INVITE_SCREEN_TITLE, {
        message: DEFAULT_INVITE_MESSAGE,
      }),
    ).toEqual({
      title: "You need to be invited.",
      message: DEFAULT_INVITE_MESSAGE,
    });
    expect(SSO_NO_PROJECT_SCREEN_TITLE).toBe("No project access.");
  });
});

describe("Message.ejs", () => {
  test("draws the default exactly as it always was: one escaped sentence", async () => {
    const html: string = await renderView(
      toSsoInviteViewVariables(
        SSO_INVITE_SCREEN_TITLE,
        toSsoInviteScreen(
          getDefaultHelpAndSupportSettings(),
          SsoInviteScreenKind.InvitationRequired,
        ),
      ),
    );

    expect(html).toContain(
      `<p class="mt-2 text-sm text-gray-600 dark:text-slate-300">${DEFAULT_INVITE_MESSAGE}</p>`,
    );
    expect(html).not.toContain('data-testid="sso-message-own-words"');
    expect(html).toContain("You need to be invited.");
  });

  test("draws the server's own message: a paragraph a line, the address as a mailto link, the link opening a tab", async () => {
    const html: string = await renderView(
      toSsoInviteViewVariables(
        SSO_INVITE_SCREEN_TITLE,
        toSsoInviteScreen(
          withMessage(OWN_MESSAGE),
          SsoInviteScreenKind.InvitationRequired,
        ),
      ),
    );

    expect(html).toContain('data-testid="sso-message-own-words"');
    expect(html).toContain("Ask the IT service desk to invite you:");
    expect(html).toMatch(
      /<a href="mailto:it-help@example\.com"[^>]*>it-help@example\.com<\/a>/,
    );
    expect(html).toMatch(
      /<a href="https:\/\/help\.example\.com\/oneuptime"[^>]*target="_blank" rel="noopener noreferrer">https:\/\/help\.example\.com\/oneuptime<\/a>/,
    );
    // A mailto: link opens no tab.
    expect(html).not.toMatch(/href="mailto:[^"]*"[^>]*target="_blank"/);
    expect(
      (html.match(/<p class="break-words">/g) || []).length,
    ).toBe(2);
    // The default sentence is not said beside it.
    expect(html).not.toContain(DEFAULT_INVITE_MESSAGE);
  });

  test("never writes a message's text into the page as markup", async () => {
    // A message the page refuses never reaches the screen; this proves the view escapes anyway.
    const html: string = await renderView({
      title: SSO_INVITE_SCREEN_TITLE,
      message: "unused",
      messageParagraphs: [
        [
          { text: "<script>alert(1)</script> & " },
          {
            text: "<b>x</b>",
            href: 'https://help.example.com/"onmouseover="alert(1)',
            isWebLink: true,
          },
        ],
      ],
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; ");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain("&#34;onmouseover=&#34;");
  });

  test("the No project access screen draws the server's own message too", async () => {
    const html: string = await renderView(
      toSsoInviteViewVariables(
        SSO_NO_PROJECT_SCREEN_TITLE,
        toSsoInviteScreen(
          withMessage("Ask IT for a project."),
          SsoInviteScreenKind.NoProject,
        ),
      ),
    );

    expect(html).toContain("No project access.");
    expect(html).toContain("Ask IT for a project.");
    expect(html).not.toContain(DEFAULT_NO_PROJECT_MESSAGE);
  });
});

describe("the server's own SAML and OIDC providers", () => {
  test.each(["GlobalSSO.ts", "GlobalOIDC.ts"])(
    "%s says the server's own words on both invitation screens, and hands them to the mobile app",
    (file: string) => {
      const source: string = fs.readFileSync(
        nodePath.join(IDENTITY_API, file),
        "utf8",
      );

      expect(source).toContain(
        "getSsoInviteScreen(\n          SsoInviteScreenKind.InvitationRequired,",
      );
      expect(source).toContain(
        "getSsoInviteScreen(\n        SsoInviteScreenKind.NoProject,",
      );
      expect(source).toContain("errorDescription: inviteScreen.message");
      expect(source).toContain("errorDescription: noProjectScreen.message");
      expect(source).toContain("SSO_INVITE_SCREEN_TITLE,");
      expect(source).toContain("SSO_NO_PROJECT_SCREEN_TITLE,");
      // No invitation sentence is written out in the route any more.
      expect(source).not.toContain(
        '"You must be invited to a project on this OneUptime instance',
      );
      expect(source).not.toContain(
        '"You are not a member of any project on this OneUptime instance',
      );
    },
  );
});
