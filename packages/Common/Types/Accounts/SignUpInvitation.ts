import { JSONObject } from "../JSON";

/*
 * THE INVITATION A SIGN-UP LINK IS FOR (#7471).
 *
 * An invitation's Create Your Account opens the sign-up page with the
 * invited address and a registration token
 * (/accounts/register?email=...&token=..., UserRegistrationToken). The page
 * was the plain sign-up page: it filled in the address and nothing else,
 * said nothing of the invitation - am I joining Walk Co, or making an
 * account somewhere else? - and, once the account was made, asked the
 * person to accept the invitation they had just followed.
 *
 * Now it asks the server (POST /identity/sign-up-invitation, with the
 * address and the token) what the invitation already knows, and says it:
 * which project, who invited them, the name the inviter typed for them -
 * filled in, for them to change - and creating the account joins that
 * project, so nothing is asked twice. The token is the proof that whoever
 * asks holds the invited mailbox, as it is when the sign-up spends it, so
 * an invitation's details reach nobody but the invited address: a token
 * that is wrong, spent, expired or minted for another address, an account
 * that has signed up already, and a person with no invitation all get the
 * same answer, which is none. The token is only read, never spent.
 *
 * This module is the request and the answer, read the same way by the
 * Identity service and the Accounts page. React-free and server-free.
 */

// Where the sign-up page asks, under the Identity service.
export const SIGN_UP_INVITATION_ROUTE: string = "/sign-up-invitation";

/*
 * Where the sign-up sends the project the page showed, in its
 * miscDataProps: the invitation creating the account accepts.
 */
export const SIGN_UP_INVITATION_PROJECT_KEY: string = "invitationProjectId";

export interface SignUpInvitation {
  // The project the invitation is to, which creating the account joins.
  projectId: string;
  projectName: string;
  // Who invited them, by name (or address, for an account with no name).
  inviterName: string | null;
  // The name the inviter typed for them, for the form to start with.
  name: string | null;
  /*
   * The invitation was accepted for them already (a master admin's
   * "Accept the invitation automatically"): they were added, and there is
   * nothing left to accept.
   */
  isAccepted: boolean;
}

const readText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

// The answer, as the route sends it: the invitation, or none.
export function toSignUpInvitationAnswerJSON(
  invitation: SignUpInvitation | null,
): JSONObject {
  if (!invitation) {
    return { invitation: null };
  }

  return {
    invitation: {
      projectId: invitation.projectId,
      projectName: invitation.projectName,
      inviterName: invitation.inviterName,
      name: invitation.name,
      isAccepted: invitation.isAccepted,
    },
  };
}

/*
 * The answer, as the page reads it: an invitation with no project, or no
 * project name to say, is none - the page is then the plain sign-up page,
 * as it always was.
 */
export function readSignUpInvitationAnswer(
  data: unknown,
): SignUpInvitation | null {
  const json: JSONObject | null =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : null;
  const invitation: unknown = json?.["invitation"];

  if (
    !invitation ||
    typeof invitation !== "object" ||
    Array.isArray(invitation)
  ) {
    return null;
  }

  const fields: JSONObject = invitation as JSONObject;
  const projectId: string | null = readText(fields["projectId"]);
  const projectName: string | null = readText(fields["projectName"]);

  if (!projectId || !projectName) {
    return null;
  }

  return {
    projectId: projectId,
    projectName: projectName,
    inviterName: readText(fields["inviterName"]),
    name: readText(fields["name"]),
    isAccepted: fields["isAccepted"] === true,
  };
}
