import { INVITATION_LINK_COPY } from "Common/UI/Components/InvitationLink/InvitationLinkModal";
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

/*
 * The Admin Dashboard's Server setup page: what the server still needs
 * (#6824). The card on Welcome and Home opens it; so can the Welcome
 * checklist (#6803).
 */
export const ADMIN_SERVER_SETUP_ROUTE: string = "/setup";

export const getAdminServerSetupUrl: () => URL = (): URL => {
  return URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
    ADMIN_SERVER_SETUP_ROUTE,
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
  notSignedUpPill: string;
  invitationLinkTitle: string;
  invitationLinkDescription: string;
  invitationLinkRegisteredDescription: string;
  invitationLinkMemberDescription: string;
  invitationLinkFailed: string;
  done: string;
  getInvitationLink: string;
} = {
  createMonitorDescription: translationKey(
    "Pick what to monitor and give it a name. When something goes wrong, OneUptime opens an incident or alert. This server cannot send email yet, so nobody is emailed: ask your server's admin to set up email.",
  ),
  createMonitorDescriptionForAdmin: translationKey(
    "Pick what to monitor and give it a name. When something goes wrong, OneUptime opens an incident or alert. This server cannot send email yet, so nobody is emailed until you set up email in the Admin Dashboard.",
  ),
  onCallStepDescription: translationKey(
    "Page the right person when an incident or alert opens. This server cannot send email yet, so until then nobody is told: ask your server's admin to set up email.",
  ),
  onCallStepDescriptionForAdmin: translationKey(
    "Page the right person when an incident or alert opens. This server cannot send email yet, so until then nobody is told: set up email in the Admin Dashboard.",
  ),
  inviteEmailDescription: translationKey(
    "This server cannot send email yet, so they get no invitation email. The invitation is still created: ask your server's admin to set up email.",
  ),
  inviteEmailDescriptionForAdmin:
    INVITATION_LINK_COPY.inviteDescriptionForAdmin,
  invitedPill: INVITATION_LINK_COPY.invitedPill,
  // Beside Member, for someone who has not signed up yet (#8191).
  notSignedUpPill: INVITATION_LINK_COPY.notSignedUpPill,
  // The invitation link's dialog, which the Admin Dashboard draws too.
  invitationLinkTitle: INVITATION_LINK_COPY.title,
  invitationLinkDescription: INVITATION_LINK_COPY.description,
  invitationLinkRegisteredDescription:
    INVITATION_LINK_COPY.registeredDescription,
  invitationLinkMemberDescription: INVITATION_LINK_COPY.memberDescription,
  invitationLinkFailed: INVITATION_LINK_COPY.failed,
  done: INVITATION_LINK_COPY.done,
  // A pending person's row action, which opens the invitation link's dialog.
  getInvitationLink: INVITATION_LINK_COPY.getLink,
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

/*
 * Whether a pending person's row offers Get Invitation Link (#7168): to a
 * master admin, on a server known not to send email, where nobody was
 * emailed the link. The server hands it to master admins only, whatever a
 * page shows. The same holds for a member's row whose person has not signed
 * up yet (useMembersNotSignedUp, #8191).
 */
export const canGetInvitationLinks: (serverEmail: ServerEmail) => boolean = (
  serverEmail: ServerEmail,
): boolean => {
  return cannotSendEmail(serverEmail) && serverEmail.isMasterAdmin;
};
