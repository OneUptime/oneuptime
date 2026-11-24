import crypto from "crypto";
import { AccountsRoute } from "../../../ServiceRoute";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import {
  INVITATION_SSO_SIGNATURE_PARAMETER,
  INVITATION_SSO_TOKEN_PARAMETER,
} from "../../../Types/Accounts/InvitationSsoSignIn";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import EmailVerificationTokenService from "../../Services/EmailVerificationTokenService";
import TokenSigningKey from "../TokenSigningKey";
import { REGISTRATION_TOKEN_EXPIRY_IN_DAYS } from "../UserRegistrationToken";

/*
 * THE SINGLE-USE LINK AN INVITATION GIVES SOMEONE WHO HAS SIGNED UP, TO ITS
 * PROJECT'S SINGLE SIGN-ON (#10178, Types/Accounts/InvitationSsoSignIn).
 *
 * Minted when the invitation email is built - after the invitation's
 * request, with the email (TeamMemberService.sendPlannedInvitation, #10180)
 * - for someone who has signed up already, invited on OneUptime Cloud into a
 * project whose single sign-on manages their sign-in. It is the shape of
 * the link a stopped sign-in's confirmation email carries
 * (ProjectSsoSignInConfirmation.requestConfirmation):
 *
 *   - a token - an EmailVerificationToken for the account and the invited
 *     address, the claim every such row makes: "whoever holds this controls
 *     that mailbox" - valid as long as an invitation's sign-up link, and
 *     spent the first time it is used;
 *   - a signature over the token, this purpose and the project, with the
 *     server's token signing key, so the link opens nothing else: not
 *     another project's single sign-on (the project is in what is signed),
 *     and no other link's token - a registration link's, a confirmation
 *     email's - can be passed off as this one, for nothing but the server
 *     signs a token for this purpose.
 *
 * It goes into the invitation email to the invited address and nowhere
 * else: never into an answer, a log or the project's email log, which keeps
 * the email's subject and template only - the same whether or not the
 * invitation carried a link. Spending it is the Identity service's
 * (InvitationSsoSignIn), with the checks the sign-up page's link is held to.
 */

// What the link's signature is for: nothing else is signed with it.
export const INVITATION_SSO_SIGN_IN_PURPOSE: string =
  "invitation-project-sso-sign-in";

// How long the link lives: as long as an invitation's sign-up link.
export const INVITATION_SSO_SIGN_IN_EXPIRY_IN_DAYS: number =
  REGISTRATION_TOKEN_EXPIRY_IN_DAYS;

export default class InvitationSsoSignInLink {
  // The signature that binds a token to this purpose and the project.
  public static getSignature(data: {
    token: string;
    projectId: string;
  }): string {
    return crypto
      .createHmac("sha256", TokenSigningKey.get())
      .update(
        [
          INVITATION_SSO_SIGN_IN_PURPOSE,
          data.token.toLowerCase(),
          data.projectId.toLowerCase(),
        ].join(":"),
      )
      .digest("hex");
  }

  // Whether a link's signature is the server's, for this token and project.
  public static isSignatureValid(data: {
    token: string;
    signature: string;
    projectId: string;
  }): boolean {
    const expected: Buffer = Buffer.from(
      InvitationSsoSignInLink.getSignature({
        token: data.token,
        projectId: data.projectId,
      }),
      "utf8",
    );
    const supplied: Buffer = Buffer.from(data.signature || "", "utf8");

    return (
      expected.length === supplied.length &&
      crypto.timingSafeEqual(expected, supplied)
    );
  }

  /*
   * The project's SSO page (/accounts/sso/<project id>, #9918), which lists
   * the providers that sign people in to it - with the link, when one is
   * given.
   */
  public static getPageUrl(data: {
    host: Hostname;
    httpProtocol: Protocol;
    projectId: ObjectID;
    link?: { token: string; signature: string } | undefined;
  }): string {
    const page: URL = URL.fromString(
      new URL(
        data.httpProtocol,
        data.host,
        new Route(AccountsRoute.toString()),
      ).toString(),
    ).addRoute(`/sso/${data.projectId.toString()}`);

    if (data.link) {
      page
        .addQueryParam(INVITATION_SSO_TOKEN_PARAMETER, data.link.token)
        .addQueryParam(INVITATION_SSO_SIGNATURE_PARAMETER, data.link.signature);
    }

    return page.toString();
  }

  /*
   * Mints a link for the account and the invited address, into the project,
   * and gives back the project's SSO page with it. The caller puts it in the
   * invitation email to that address, and nowhere else.
   */
  public static async mint(data: {
    userId: ObjectID;
    email: Email;
    projectId: ObjectID;
    host: Hostname;
    httpProtocol: Protocol;
  }): Promise<string> {
    const token: ObjectID = ObjectID.generate();

    const row: EmailVerificationToken = new EmailVerificationToken();
    row.userId = data.userId;
    row.email = data.email;
    row.token = token;
    row.expires = OneUptimeDate.getSomeDaysAfter(
      INVITATION_SSO_SIGN_IN_EXPIRY_IN_DAYS,
    );

    await EmailVerificationTokenService.create({
      data: row,
      props: {
        isRoot: true,
      },
    });

    return InvitationSsoSignInLink.getPageUrl({
      host: data.host,
      httpProtocol: data.httpProtocol,
      projectId: data.projectId,
      link: {
        token: token.toString(),
        signature: InvitationSsoSignInLink.getSignature({
          token: token.toString(),
          projectId: data.projectId.toString(),
        }),
      },
    });
  }
}
