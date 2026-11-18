import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * RESEND INVITATION (#9519).
 *
 * A pending person whose invitation email never reached them - the mail
 * service refused it (Email Not Sent, #9511), it went to their spam, its
 * link ran out - had no way to be sent it again: inviting the same address
 * to the same team is refused while the invitation waits
 * (Errors.TeamMemberService.ALREADY_INVITED), so it took removing them and
 * inviting them again, two dialogs for one intent.
 *
 * Now a pending row offers Resend Invitation - on the Users list, a
 * person's Teams, a team's Members and the Admin Dashboard's lists of a
 * project's people - for whoever may invite to that team. It asks the
 * server (POST /team-member/:id/resend-invitation, the membership's id),
 * which sends the same InviteMember email a new invitation sends
 * (TeamMemberService.resendInvitation): a new sign-up link and token for
 * someone with no password yet, held to the same per-address limit, and
 * written to the project's Email Logs, so the row says Invitation Sent
 * again once it went. The server waits for the mail service, and answers
 * with the address it went to, or with why it did not go.
 *
 * This module is the route, its answer and its refusals, read the same way
 * on both sides. React-free and server-free.
 */

// The team member route's own path.
export const TEAM_MEMBER_ROUTE: string = "/team-member";

// What follows a membership's id in the route.
export const RESEND_INVITATION_ROUTE_END: string = "/resend-invitation";

// Where a row asks, under the API: /team-member/<membership's id>/resend-invitation.
export function getResendInvitationRoute(
  teamMemberId: ObjectID | string,
): string {
  return `${TEAM_MEMBER_ROUTE}/${teamMemberId.toString()}${RESEND_INVITATION_ROUTE_END}`;
}

/*
 * How long the server waits for the mail service to take the email: the
 * person who pressed Resend Invitation waits with it, so not for as long
 * as a mail server may take to time out by itself.
 */
export const RESEND_INVITATION_SEND_TIMEOUT_IN_MS: number = 30 * 1000;

/*
 * How long one resend of a person's invitation holds the others back: a
 * second press, in another tab or by somebody else, while the first is
 * still with the mail service, sends nothing more.
 */
export const RESEND_INVITATION_LOCK_TIMEOUT_IN_MS: number =
  RESEND_INVITATION_SEND_TIMEOUT_IN_MS + 30 * 1000;

// What the route answers once the email went.
export interface ResentInvitation {
  // The address it went to, as the person's account holds it.
  email: string;
}

/*
 * The refusals, in OneUptime's words. A sentence each, saying what
 * happened and what to do next (Docs/ux/README.md#errors). Every API
 * answer is English (Server/Locales/README.md).
 */
export const RESEND_INVITATION_REFUSALS: {
  notInvited: string;
  joined: string;
  emailNotSetUp: string;
  emailNotSetUpForMasterAdmin: string;
  alreadySending: string;
} = {
  /*
   * The membership is gone - the person was removed from the team, or
   * declined - or is another project's: said alike, so the route tells
   * nobody which ids another project has.
   */
  notInvited:
    "They are no longer invited to this team. Reload the page to see who is.",
  // They have joined: no invitation is waiting for them.
  joined:
    "They have joined the project already, so there is no invitation to send again.",
  // A server with no email set up sends nothing (ServerSendingStatus).
  emailNotSetUp:
    "This server cannot send email yet, so their invitation cannot be sent again. Ask your server's admin to set up email.",
  // ... and a master admin, who can set it up, is told where, and what else works.
  emailNotSetUpForMasterAdmin:
    "This server cannot send email yet, so their invitation cannot be sent again. Set up email in the Admin Dashboard, or send them their invitation link yourself.",
  // Pressed again - or by somebody else - while the first is being sent.
  alreadySending:
    "Their invitation is being sent again already. Wait a moment, then reload the page.",
};

/*
 * The mail service refused the email: in OneUptime's words first, then the
 * mail service's own (Docs/ux/README.md#errors).
 */
export function getInvitationNotResentMessage(data: {
  email: string;
  reason: string;
}): string {
  const reason: string = data.reason.trim();

  return reason
    ? `The invitation email to ${data.email} was not sent. ${reason}`
    : `The invitation email to ${data.email} was not sent. Check the Email tab of the project's Notification Logs to see why.`;
}

/*
 * The mail service did not answer in time: it may still send it, so
 * nobody is told it was not sent - and nobody is told it was.
 */
export function getInvitationMayNotBeResentMessage(data: {
  email: string;
}): string {
  return `The invitation email to ${data.email} may not have been sent: the mail service did not answer in time. Check the Email tab of the project's Notification Logs before you send it again.`;
}

// The membership a route's address names, or a refusal.
export function readResendInvitationTeamMemberId(value: unknown): ObjectID {
  const id: string = typeof value === "string" ? value.trim() : "";

  if (!id || !ObjectID.isValidUUID(id)) {
    throw new BadDataException("Name the invitation to send again by its ID.");
  }

  return new ObjectID(id);
}

// The answer, as the route sends it.
export function toResentInvitationJSON(resent: ResentInvitation): JSONObject {
  return {
    email: resent.email,
  };
}

// The answer, as a page reads it: null when it names no address.
export function readResentInvitation(data: unknown): ResentInvitation | null {
  const json: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : {};
  const email: unknown = json["email"];

  if (typeof email !== "string" || !email.trim()) {
    return null;
  }

  return {
    email: email.trim(),
  };
}
