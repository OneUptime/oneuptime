/*
 * AN INVITATION'S SINGLE-USE LINK TO ITS PROJECT'S SINGLE SIGN-ON, FOR
 * SOMEONE WHO HAS SIGNED UP ALREADY (#10178).
 *
 * On OneUptime Cloud a project's SAML or OIDC provider signs someone in only
 * once they have confirmed, from their mailbox, that it may: the project's
 * admins configure it, and could assert any address. Someone invited into a
 * project whose people sign in with SSO, who had no account yet, confirms by
 * picking a provider on the sign-up page their invitation opens - its
 * registration token proves the mailbox (#9898, SignUpInvitation). Someone
 * who had signed up already was sent to sign in with SSO instead, and their
 * first trip through the provider stopped at "Check your email": a second
 * email, Confirm Sign-In, and a second trip.
 *
 * Their invitation now carries a link of its own: a token minted for their
 * account and the invited address, as long-lived as an invitation's
 * sign-up link, and signed by the server for this purpose and the project.
 * It opens the project's SSO page (/accounts/sso/<project id>), which lists
 * its providers; picking one first sends the link here, and the server
 * takes it as that confirmation, once, so the provider signs them in the
 * first time. Only the invited mailbox is sent the link, and whatever the
 * server finds, every ask is answered alike.
 *
 * This module is the route and the link's query parameters, read the same
 * way by the Identity service, the invitation email and the Accounts page.
 * React-free and server-free.
 */

// Where the page sends the link, under the Identity service.
export const INVITATION_SSO_SIGN_IN_ROUTE: string = "/invitation-sso-sign-in";

// The query parameters of the project's SSO page that carry the link.
export const INVITATION_SSO_TOKEN_PARAMETER: string = "invitation";
export const INVITATION_SSO_SIGNATURE_PARAMETER: string = "signature";

// The link, as the page was opened with it.
export interface InvitationSsoSignInLink {
  token: string;
  signature: string;
}

/*
 * The link a page was opened with (its query string), or null when it was
 * opened without one: both parameters, trimmed, or none.
 */
export function readInvitationSsoSignInLink(
  search: string,
): InvitationSsoSignInLink | null {
  let parameters: URLSearchParams;

  try {
    parameters = new URLSearchParams(search);
  } catch {
    return null;
  }

  const token: string = (
    parameters.get(INVITATION_SSO_TOKEN_PARAMETER) || ""
  ).trim();
  const signature: string = (
    parameters.get(INVITATION_SSO_SIGNATURE_PARAMETER) || ""
  ).trim();

  if (!token || !signature) {
    return null;
  }

  return { token: token, signature: signature };
}
