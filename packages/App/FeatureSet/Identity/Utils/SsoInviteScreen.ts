import HelpAndSupportServerSettings from "Common/Server/Utils/HelpAndSupport/HelpAndSupportServerSettings";
import {
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_NO_PROJECT_MESSAGE,
  HelpAndSupportSettings,
  getInviteMessage,
  hasOwnInviteMessage,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import {
  InviteMessageParagraph,
  toInviteMessageParagraphs,
} from "Common/Types/HelpAndSupport/InviteMessage";

/*
 * WHAT THE SERVER'S SINGLE SIGN-ON SAYS TO SOMEONE WHO NEEDS AN INVITATION
 * (#10865).
 *
 * The server's own SAML and OpenID Connect providers (Global SSO and Global
 * OIDC) turn two kinds of person away with "contact your administrator":
 *
 *   InvitationRequired  someone with no account, while the provider creates
 *                       none: "You need to be invited.";
 *   NoProject           someone with an account who is a member of no
 *                       project: "No project access.".
 *
 * Both need the same thing - an invitation from whoever runs the server - so
 * both say the message a master admin wrote on Admin Dashboard > Settings >
 * Help and Support, with whom to ask, in place of the default sentence. The
 * screen's title stays as it is. With no message of the server's own, each
 * says exactly what it always said, drawn exactly as it always was.
 *
 * The mobile app is handed the same words, as plain text (errorDescription):
 * they are the server's own and never hold markup (getInviteMessageProblem).
 */

export enum SsoInviteScreenKind {
  InvitationRequired = "invitation_required",
  NoProject = "no_project",
}

export interface SsoInviteScreen {
  message: string;
  /*
   * The server's own message as the screen draws it - a paragraph a line,
   * links and addresses linked (InviteMessage) - or undefined on the
   * default, which Message.ejs draws as the one sentence it always was.
   */
  messageParagraphs?: Array<InviteMessageParagraph> | undefined;
}

const DEFAULT_MESSAGES: Readonly<Record<SsoInviteScreenKind, string>> = {
  [SsoInviteScreenKind.InvitationRequired]: DEFAULT_INVITE_MESSAGE,
  [SsoInviteScreenKind.NoProject]: DEFAULT_NO_PROJECT_MESSAGE,
};

// The screen, from settings already read.
export const toSsoInviteScreen: (
  settings: HelpAndSupportSettings,
  kind: SsoInviteScreenKind,
) => SsoInviteScreen = (
  settings: HelpAndSupportSettings,
  kind: SsoInviteScreenKind,
): SsoInviteScreen => {
  const message: string = getInviteMessage(settings, DEFAULT_MESSAGES[kind]);

  if (!hasOwnInviteMessage(settings) || message === DEFAULT_MESSAGES[kind]) {
    return { message: message };
  }

  return {
    message: message,
    messageParagraphs: toInviteMessageParagraphs(message),
  };
};

// The screen, read from the server's settings (kept a moment, never failing).
export const getSsoInviteScreen: (
  kind: SsoInviteScreenKind,
) => Promise<SsoInviteScreen> = async (
  kind: SsoInviteScreenKind,
): Promise<SsoInviteScreen> => {
  return toSsoInviteScreen(
    await HelpAndSupportServerSettings.getSettings(),
    kind,
  );
};

// What the view is handed: the title, and the message as it is drawn.
export const toSsoInviteViewVariables: (
  title: string,
  screen: SsoInviteScreen,
) => {
  title: string;
  message: string;
  messageParagraphs?: Array<InviteMessageParagraph> | undefined;
} = (
  title: string,
  screen: SsoInviteScreen,
): {
  title: string;
  message: string;
  messageParagraphs?: Array<InviteMessageParagraph> | undefined;
} => {
  return {
    title: title,
    message: screen.message,
    ...(screen.messageParagraphs
      ? { messageParagraphs: screen.messageParagraphs }
      : {}),
  };
};
