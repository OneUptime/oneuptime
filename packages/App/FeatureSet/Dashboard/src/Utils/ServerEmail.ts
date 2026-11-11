import { ADMIN_DASHBOARD_URL } from "Common/UI/Config";
import { useServerCanSendEmail } from "Common/UI/Utils/ServerSending";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import URL from "Common/Types/API/URL";

/*
 * WHAT THE DASHBOARD SAYS WHEN THE SERVER CANNOT SEND EMAIL.
 *
 * A fresh self-hosted server cannot send email until its admin sets it up
 * (Types/ServerSending/ServerSendingStatus). The pages that promise an email
 * - Create Monitor's card, Home's on-call step, the invite dialogs - say the
 * truth instead, and the fix: a master admin, who can set email up, is sent
 * to the Admin Dashboard; anybody else is told to ask the server's admin.
 *
 * On a server that can send email - OneUptime Cloud, and every server once
 * email works - nothing here changes a word (useServerEmail's canSendEmail
 * is true, or null while it is read: the page says what it always said).
 */

// The Admin Dashboard's Settings > Emails and Settings > Probes, under ADMIN_DASHBOARD_URL.
export const ADMIN_EMAIL_SETTINGS_ROUTE: string = "/settings/smtp";
export const ADMIN_GLOBAL_PROBES_ROUTE: string = "/settings/probes";

export const getAdminEmailSettingsUrl: () => URL = (): URL => {
  return URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
    ADMIN_EMAIL_SETTINGS_ROUTE,
  );
};

export const SERVER_EMAIL_COPY: {
  createMonitorDescription: string;
  createMonitorDescriptionForAdmin: string;
  onCallStepDescription: string;
  onCallStepDescriptionForAdmin: string;
  inviteEmailDescription: string;
  inviteEmailDescriptionForAdmin: string;
  invitedPill: string;
  invitationLinkTitle: string;
  invitationLinkDescription: string;
  invitationLinkRegisteredDescription: string;
  invitationLinkFailed: string;
  done: string;
} = {
  createMonitorDescription: translationKey(
    "Pick what to monitor and give it a name. Everything else starts with defaults you can change. When something goes wrong, OneUptime opens an incident or alert. This server cannot send email yet, so nobody is emailed: ask your server's admin to set up email.",
  ),
  createMonitorDescriptionForAdmin: translationKey(
    "Pick what to monitor and give it a name. Everything else starts with defaults you can change. When something goes wrong, OneUptime opens an incident or alert. This server cannot send email yet, so nobody is emailed until you set up email in the Admin Dashboard.",
  ),
  onCallStepDescription: translationKey(
    "Page the right person when an incident or alert opens. This server cannot send email yet, so until then nobody is told: ask your server's admin to set up email.",
  ),
  onCallStepDescriptionForAdmin: translationKey(
    "Page the right person when an incident or alert opens. This server cannot send email yet, so until then nobody is told: set up email in the Admin Dashboard.",
  ),
  inviteEmailDescription: translationKey(
    "This server cannot send email yet, so they will not get an invitation email. The invitation is still created: ask your server's admin to set up email, or to send them their invitation link.",
  ),
  inviteEmailDescriptionForAdmin: translationKey(
    "This server cannot send email yet, so they will not get an invitation email. The invitation is still created, and you get a link to send them yourself.",
  ),
  invitedPill: translationKey("Invited"),
  invitationLinkTitle: translationKey("Send them their invitation link"),
  invitationLinkDescription: translationKey(
    "This server cannot send email, so {{email}} was not emailed. Copy this link and send it to them yourself. It works once, only for this address, for 7 days.",
  ),
  invitationLinkRegisteredDescription: translationKey(
    "This server cannot send email, so {{email}} was not emailed. They already have an account: send them this link to sign in, and they accept the invitation from there.",
  ),
  invitationLinkFailed: translationKey(
    "The invitation was created, but its link could not be read. Open the Admin Dashboard to set their password instead.",
  ),
  done: translationKey("Done"),
};

export interface ServerEmail {
  // False only while the server is known not to be able to send email; null while read.
  canSendEmail: boolean | null;
  // A master admin can set email up, and is handed invitation links.
  isMasterAdmin: boolean;
}

export const useServerEmail: () => ServerEmail = (): ServerEmail => {
  const canSendEmail: boolean | null = useServerCanSendEmail();

  return {
    canSendEmail: canSendEmail,
    isMasterAdmin: Boolean(UserUtil.isMasterAdmin()),
  };
};

// Whether a page should say the server cannot send email: only once it knows.
export const cannotSendEmail: (serverEmail: ServerEmail) => boolean = (
  serverEmail: ServerEmail,
): boolean => {
  return serverEmail.canSendEmail === false;
};
