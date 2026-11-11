import DatabaseConfig from "../DatabaseConfig";
import TeamMemberService from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
import CaptureSpan from "./Telemetry/CaptureSpan";
import UserRegistrationToken from "./UserRegistrationToken";
import { AccountsRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";

/*
 * THE INVITATION LINK, FOR AN INVITER TO SEND THEMSELVES.
 *
 * A server that cannot send email still creates every invitation (#6825);
 * the person invited just never hears of it. So a master admin who invites
 * someone is handed the link the invitation email would have carried, to
 * send by chat or however they like:
 *
 *   - for someone who has no account yet, /accounts/register with a
 *     registration token - minted the way the email's is
 *     (UserRegistrationToken: single use, for this address only, a week);
 *   - for someone who already has one, the sign-in page: they accept the
 *     invitation once signed in, as the email says.
 *
 * Master admins only (TeamMemberAPI's POST /team-member/invitation-link). A
 * registration token claims the account at that address, together with
 * every invitation it holds - another project's included - which is exactly
 * what GHSA-qg84-6hrg-mr5g made it the only key to. A master admin can
 * already set any account's password from the Admin Dashboard, so the link
 * hands them nothing new; any other inviter is never given one.
 */

export interface InvitationLinkAnswer {
  link: string;
  // The person already has an account: the link signs them in.
  isRegistered: boolean;
  email: string;
}

export default class InvitationLink {
  @CaptureSpan()
  public static async getForTeamMember(
    teamMemberId: ObjectID,
  ): Promise<InvitationLinkAnswer> {
    const teamMember: TeamMember | null = await TeamMemberService.findOneById({
      id: teamMemberId,
      select: {
        userId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!teamMember || !teamMember.userId) {
      throw new BadDataException("This invitation was not found.");
    }

    const user: User | null = await UserService.findOneById({
      id: teamMember.userId,
      select: {
        _id: true,
        email: true,
        password: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user || !user.id || !user.email) {
      throw new BadDataException("This invitation was not found.");
    }

    // An account with a password signs in, and accepts from the Dashboard.
    if (user.password) {
      return {
        link: await InvitationLink.getSignInLink(),
        isRegistered: true,
        email: user.email.toString(),
      };
    }

    const registrationLink: URL =
      await UserRegistrationToken.generateRegistrationLink({
        userId: user.id,
        email: user.email,
      });

    return {
      link: registrationLink.toString(),
      isRegistered: false,
      email: user.email.toString(),
    };
  }

  // The sign-in page, as the invitation email links it.
  public static async getSignInLink(): Promise<string> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return URL.fromString(
      new URL(
        httpProtocol,
        host,
        new Route(AccountsRoute.toString()),
      ).toString(),
    ).toString();
  }
}
