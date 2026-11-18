import DatabaseConfig from "../DatabaseConfig";
import TeamMemberService from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
import CaptureSpan from "./Telemetry/CaptureSpan";
import UserRegistrationToken from "./UserRegistrationToken";
import QueryHelper from "../Types/Database/QueryHelper";
import { AccountsRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Email from "../../Types/Email";
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
 *
 * A master admin reads it right after their own Invite, and again whenever
 * they like - Get Invitation Link on a pending person's row (#7168), for an
 * invitation somebody else made or whose link ran out. Each read mints a new
 * token, as each invitation email does; the ones minted before keep working
 * until they are used or expire.
 *
 * The link is the account's, not the membership's: whether the invitation
 * was accepted does not change it. Someone whose invitation a master admin
 * accepted for them (the Admin Dashboard's "Accept the invitation
 * automatically") still has no account, and still needs the sign-up link.
 * Someone with an account is only ever given the sign-in page, which is no
 * secret, so nothing is minted for an account that cannot be claimed.
 *
 * So a list cannot tell, from whether an invitation was accepted, whether
 * its person has signed up: a membership accepted for someone with no
 * account read "Member", and no row offered their link (#8191). The lists
 * ask, for the rows on their page, which of them have not signed up
 * (getMembershipsNotSignedUp, POST /team-member/not-signed-up): master
 * admins only, as for the link itself, and only ever the memberships - never
 * a password, nor anything about it but that there is none.
 */

export interface InvitationLinkAnswer {
  link: string;
  // The person already has an account: the link signs them in.
  isRegistered: boolean;
  /*
   * The membership is accepted already - accepted for them by a master
   * admin, or added to another team of a project they are in - so there is
   * nothing left for them to accept (#8191).
   */
  isAccepted: boolean;
  email: string;
}

/*
 * The most memberships one ask about signing up may name: a list's largest
 * page (PaginationUtil's DefaultItemsOnPageOptions).
 */
export const MAX_MEMBERSHIPS_PER_SIGN_UP_READ: number = 100;

// A person named by project and address who is no longer invited there.
export const INVITATION_NOT_IN_PROJECT_MESSAGE: string =
  "This person is not invited to this project any more, so there is no invitation link to send. Invite them again from the project's Users page.";

export default class InvitationLink {
  @CaptureSpan()
  public static async getForTeamMember(
    teamMemberId: ObjectID,
  ): Promise<InvitationLinkAnswer> {
    const teamMember: TeamMember | null = await TeamMemberService.findOneById({
      id: teamMemberId,
      select: {
        userId: true,
        hasAcceptedInvitation: true,
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

    const isAccepted: boolean = teamMember.hasAcceptedInvitation === true;

    // An account with a password signs in, and accepts from the Dashboard.
    if (user.password) {
      return {
        link: await InvitationLink.getSignInLink(),
        isRegistered: true,
        isAccepted: isAccepted,
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
      isAccepted: isAccepted,
      email: user.email.toString(),
    };
  }

  /*
   * The link of a person's invitation to a project, named by the project and
   * the address it went to: what the server's email log knows of an
   * invitation email it failed to send (#7169, Types/Email/ServerEmailLog),
   * whose row offers Get Invitation Link. The person's membership in the
   * project - one still waiting for them first, else one accepted for them -
   * is read as getForTeamMember reads one. An address with no account, or
   * an account no longer in the project, is told so: there is no
   * invitation to send.
   */
  @CaptureSpan()
  public static async getForProjectInvitee(data: {
    projectId: ObjectID;
    email: Email;
  }): Promise<InvitationLinkAnswer> {
    const user: User | null = await UserService.findOneBy({
      query: {
        email: data.email,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user || !user.id) {
      throw new BadDataException(INVITATION_NOT_IN_PROJECT_MESSAGE);
    }

    const findMembership: (
      hasAcceptedInvitation: boolean,
    ) => Promise<TeamMember | null> = (
      hasAcceptedInvitation: boolean,
    ): Promise<TeamMember | null> => {
      return TeamMemberService.findOneBy({
        query: {
          userId: user.id!,
          projectId: data.projectId,
          hasAcceptedInvitation: hasAcceptedInvitation,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });
    };

    const membership: TeamMember | null =
      (await findMembership(false)) || (await findMembership(true));

    if (!membership || !membership.id) {
      throw new BadDataException(INVITATION_NOT_IN_PROJECT_MESSAGE);
    }

    return await InvitationLink.getForTeamMember(membership.id);
  }

  /*
   * Of these memberships, the ones whose person has not signed up yet: their
   * account has no password (#8191). A list shows them as Member once the
   * invitation is accepted for them, and offers their sign-up link only if
   * it knows. A membership that is not there, or whose account is not, is
   * left out, as is one whose person has signed up; nothing else is said
   * about anybody. Read as OneUptime: the route that calls this lets only a
   * master admin ask.
   */
  @CaptureSpan()
  public static async getMembershipsNotSignedUp(
    teamMemberIds: Array<ObjectID>,
  ): Promise<Array<ObjectID>> {
    if (teamMemberIds.length === 0) {
      return [];
    }

    if (teamMemberIds.length > MAX_MEMBERSHIPS_PER_SIGN_UP_READ) {
      throw new BadDataException(
        `Ask about at most ${MAX_MEMBERSHIPS_PER_SIGN_UP_READ} memberships at a time.`,
      );
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        _id: QueryHelper.any(teamMemberIds),
      },
      select: {
        _id: true,
        userId: true,
      },
      limit: teamMemberIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const userIds: Array<ObjectID> = [];
    const seenUserIds: Set<string> = new Set<string>();

    for (const membership of memberships) {
      const userId: string | undefined = membership.userId?.toString();

      if (userId && !seenUserIds.has(userId)) {
        seenUserIds.add(userId);
        userIds.push(membership.userId!);
      }
    }

    if (userIds.length === 0) {
      return [];
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(userIds),
      },
      select: {
        _id: true,
        password: true,
      },
      limit: userIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const notSignedUpUserIds: Set<string> = new Set<string>(
      users
        .filter((user: User): boolean => {
          return Boolean(user.id) && !user.password;
        })
        .map((user: User): string => {
          return user.id!.toString();
        }),
    );

    return memberships
      .filter((membership: TeamMember): boolean => {
        return Boolean(
          membership.id &&
            membership.userId &&
            notSignedUpUserIds.has(membership.userId.toString()),
        );
      })
      .map((membership: TeamMember): ObjectID => {
        return membership.id!;
      });
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
