import { IsBillingEnabled } from "../../EnvironmentConfig";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import UserService from "../../Services/UserService";
import { escapeLikePattern } from "../../Types/Database/JSONColumnQuery";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Sort from "../../Types/Database/Sort";
import ProjectMemberSearch from "./ProjectMemberSearch";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  INVITE_SUGGESTIONS_LIMIT,
  INVITE_SUGGESTIONS_SERVER_LIMIT,
  InviteSuggestion,
  InviteSuggestionsRequest,
  getInviteSuggestionStanding,
} from "../../../Types/Team/InviteSuggestions";
import { ProjectMemberSearchMatch } from "../../../Types/Team/ProjectMemberSearch";

/*
 * THE SERVER'S HALF OF AN INVITATION'S SUGGESTIONS (#9701,
 * Types/Team/InviteSuggestions).
 *
 * Who is suggested, and to whom:
 *
 *   - The project's people, found as Search finds them (ProjectMemberSearch,
 *     #7036): by name or email, with the reader's own props, in the
 *     request's project only - so nobody of another project, on Cloud or
 *     on a server somebody runs, and only for a reader who may see the
 *     project's people (anyone else is refused, as Search refuses them).
 *     Only those whose email the reader may see: an invitation goes to an
 *     address, and one the reader may not see is not theirs to fill in.
 *   - On a server somebody runs (billing off), for its master admin, the
 *     server's other accounts too, by name or email. A master admin sees
 *     every account in the Admin Dashboard already, and adds any of them to
 *     a project there, so this shows them nothing new. Never on OneUptime
 *     Cloud, whatever the reader: its accounts are its customers'.
 *
 * Where each stands is read from their memberships of the project, with
 * the reader's own props, as the team's Members page reads them: in the
 * team being invited to (accepted, or invited and not yet), invited to the
 * project only, a member, or - an account of the server's - not in this
 * project yet. Nothing is written or cached.
 */
export default class InviteSuggestions {
  public static async suggest(data: {
    projectId: ObjectID;
    request: InviteSuggestionsRequest;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<InviteSuggestion>> {
    if (
      !ProjectMemberSearch.canSeeMembers({
        projectId: data.projectId,
        props: data.props,
      })
    ) {
      throw new NotAuthorizedException(
        "You do not have permission to see this project's members.",
      );
    }

    const teamId: ObjectID | null = await InviteSuggestions.readTeamId(data);

    // The project's people the reader may see, with an address to invite.
    const projectPeople: Array<ProjectMemberSearchMatch> = (
      await ProjectMemberSearch.search({
        projectId: data.projectId,
        text: data.request.text,
        props: data.props,
      })
    ).filter((match: ProjectMemberSearchMatch): boolean => {
      return Boolean(match.email);
    });

    const serverPeople: Array<ProjectMemberSearchMatch> =
      InviteSuggestions.mayFindServerAccounts(data.props)
        ? await InviteSuggestions.findServerAccounts({
            text: data.request.text,
            except: projectPeople,
          })
        : [];

    const people: Array<ProjectMemberSearchMatch> = [
      ...projectPeople,
      ...serverPeople,
    ].slice(0, INVITE_SUGGESTIONS_LIMIT);

    if (people.length === 0) {
      return [];
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(
          people.map((person: ProjectMemberSearchMatch): ObjectID => {
            return new ObjectID(person.userId);
          }),
        ),
      } as Query<TeamMember>,
      select: {
        _id: true,
        userId: true,
        teamId: true,
        hasAcceptedInvitation: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: data.props,
    });

    return people.map((person: ProjectMemberSearchMatch): InviteSuggestion => {
      return {
        userId: person.userId,
        name: person.name,
        email: person.email || "",
        standing: getInviteSuggestionStanding({
          memberships: memberships
            .filter((membership: TeamMember): boolean => {
              return (
                membership.userId?.toString().toLowerCase() ===
                person.userId.toLowerCase()
              );
            })
            .map(
              (
                membership: TeamMember,
              ): { teamId: string; hasAcceptedInvitation: boolean } => {
                return {
                  teamId: membership.teamId?.toString() || "",
                  hasAcceptedInvitation: Boolean(
                    membership.hasAcceptedInvitation,
                  ),
                };
              },
            ),
          teamId: teamId ? teamId.toString() : null,
        }),
      };
    });
  }

  /*
   * Whether the server's other accounts may be suggested to `props`: to a
   * master admin of a server somebody runs, and to nobody on Cloud.
   */
  public static mayFindServerAccounts(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return !IsBillingEnabled && Boolean(props.isMasterAdmin);
  }

  /*
   * The team the invitation is for, when the request names one: a team of
   * the request's project, or refused.
   */
  private static async readTeamId(data: {
    projectId: ObjectID;
    request: InviteSuggestionsRequest;
  }): Promise<ObjectID | null> {
    if (!data.request.teamId) {
      return null;
    }

    const team: Team | null = await TeamService.findOneBy({
      query: {
        _id: data.request.teamId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!team) {
      throw new BadDataException(
        "This team no longer exists in this project. Reload the page and pick another team.",
      );
    }

    return data.request.teamId;
  }

  /*
   * The server's accounts whose name or email holds `text`, matched
   * literally, by what each read searched, besides the project's people
   * already found: at most INVITE_SUGGESTIONS_SERVER_LIMIT of them.
   */
  private static async findServerAccounts(data: {
    text: string;
    except: ReadonlyArray<ProjectMemberSearchMatch>;
  }): Promise<Array<ProjectMemberSearchMatch>> {
    const pattern: string = escapeLikePattern(data.text);

    const read: (column: "name" | "email") => Promise<Array<User>> = (
      column: "name" | "email",
    ): Promise<Array<User>> => {
      return UserService.findBy({
        query: {
          [column]: new Search(pattern),
        } as unknown as Query<User>,
        select: {
          _id: true,
          name: true,
          email: true,
        },
        sort: {
          [column]: SortOrder.Ascending,
        } as unknown as Sort<User>,
        skip: 0,
        limit: INVITE_SUGGESTIONS_SERVER_LIMIT,
        props: {
          isRoot: true,
        },
      });
    };

    const found: Array<User> = (
      await Promise.all([read("name"), read("email")])
    ).flat();

    const seen: Set<string> = new Set<string>(
      data.except.map((person: ProjectMemberSearchMatch): string => {
        return person.userId.toLowerCase();
      }),
    );
    const accounts: Array<ProjectMemberSearchMatch> = [];

    for (const user of found) {
      const userId: string = user._id?.toString() || "";
      const email: string = user.email?.toString().trim() || "";

      if (!userId || !email || seen.has(userId.toLowerCase())) {
        continue;
      }

      seen.add(userId.toLowerCase());
      accounts.push({
        userId: userId,
        name: user.name?.toString().trim() || "",
        email: email,
      });

      if (accounts.length >= INVITE_SUGGESTIONS_SERVER_LIMIT) {
        break;
      }
    }

    return accounts;
  }
}
