import TeamMemberService from "../../Services/TeamMemberService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import { escapeLikePattern } from "../../Types/Database/JSONColumnQuery";
import QueryPermission from "../../Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../Types/Database/Permissions/SelectPermission";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  ProjectMemberSearchMatch,
  rankProjectMemberMatches,
} from "../../../Types/Team/ProjectMemberSearch";

/*
 * THE SERVER'S HALF OF SEARCH'S PEOPLE (#7036,
 * Types/Team/ProjectMemberSearch).
 *
 * A project's people are its team memberships, so a person is found through
 * their membership, by their name or their email - read exactly as the Users
 * page reads the project's members (POST /team-member/get-list, selecting
 * each membership's user): through TeamMemberService, with the caller's own
 * props. Whatever narrows or refuses that list narrows or refuses this -
 * the table's read permission and its blocks, the user column's read, the
 * project the request is in - so Search never shows a person, a name or an
 * email the Users page would not show the same reader:
 *
 *   - A reader who may not see the project's people (their user, on each
 *     membership) is refused before anything is read.
 *   - Emails are searched and answered only where the Users page's own read
 *     of them would pass for this reader. Where it would not, a match on an
 *     address would say what the address is, so it is never searched.
 *   - Only memberships of the request's own project are read: someone who is
 *     only in another project, and an address nobody has, give the same
 *     empty answer.
 *   - What was typed is matched literally: a % or _ is not a wildcard.
 *
 * Two reads, by name and by email, each of a bounded page of memberships in
 * the order of what it searched; one person on several teams is one person;
 * the best few are answered (rankProjectMemberMatches).
 */

/*
 * Memberships read per search, by name and by email: a person is on a few
 * teams at most, so this holds the best few people of a large project.
 */
export const PROJECT_MEMBER_SEARCH_READ_LIMIT: number = 50;

export default class ProjectMemberSearch {
  /*
   * Whether `props` may read the project's members with these columns of
   * each one's user, by the very checks the Users page's list passes: the
   * table's read and its blocks, the user column's read, and the read of
   * each column through it. False where the list would be refused.
   */
  public static mayReadMembers(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    userColumns: Array<"name" | "email">;
  }): boolean {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return true;
    }

    const userSelect: Record<string, boolean> = { _id: true };

    for (const column of data.userColumns) {
      userSelect[column] = true;
    }

    const select: Select<TeamMember> = {
      user: userSelect,
    } as Select<TeamMember>;

    try {
      TablePermission.checkTableLevelPermissions(
        TeamMember,
        data.props,
        DatabaseRequestType.Read,
      );
      TablePermission.checkTableLevelBlockPermissions(
        TeamMember,
        data.props,
        DatabaseRequestType.Read,
      );
      SelectPermission.checkSelectPermission(TeamMember, select, data.props);
      QueryPermission.checkRelationQueryPermission(
        TeamMember,
        { projectId: data.projectId } as Query<TeamMember>,
        select,
        data.props,
      );
    } catch (error) {
      /*
       * Refused: not theirs to read, or a column no read through a
       * membership may name at all (the user's columns are fixed here, so
       * that is never a malformed request of the caller's).
       */
      if (
        error instanceof NotAuthorizedException ||
        error instanceof BadDataException
      ) {
        return false;
      }

      throw error;
    }

    return true;
  }

  // Whether `props` may see the project's people at all, as the Users page lists them.
  public static canSeeMembers(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): boolean {
    return ProjectMemberSearch.mayReadMembers({
      projectId: data.projectId,
      props: data.props,
      userColumns: ["name"],
    });
  }

  // Whether `props` may see their emails there too.
  public static canSeeEmails(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): boolean {
    return ProjectMemberSearch.mayReadMembers({
      projectId: data.projectId,
      props: data.props,
      userColumns: ["name", "email"],
    });
  }

  /*
   * The project's people whose name - or email, for a reader who may see
   * emails - holds `text`, best match first, at most
   * PROJECT_MEMBER_SEARCH_LIMIT of them. `text` is what
   * readProjectMemberSearchText took: trimmed, cut, long enough.
   */
  public static async search(data: {
    projectId: ObjectID;
    text: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ProjectMemberSearchMatch>> {
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

    const searchesEmails: boolean = ProjectMemberSearch.canSeeEmails({
      projectId: data.projectId,
      props: data.props,
    });

    const userSelect: Record<string, boolean> = { _id: true, name: true };

    if (searchesEmails) {
      userSelect["email"] = true;
    }

    const select: Select<TeamMember> = {
      _id: true,
      userId: true,
      user: userSelect,
    } as Select<TeamMember>;

    // Literal: "%" and "_" typed are matched as written.
    const pattern: string = escapeLikePattern(data.text);

    const read: (column: "name" | "email") => Promise<Array<TeamMember>> = (
      column: "name" | "email",
    ): Promise<Array<TeamMember>> => {
      return TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          user: { [column]: new Search(pattern) },
        } as unknown as Query<TeamMember>,
        select: select,
        sort: {
          user: { [column]: SortOrder.Ascending },
        } as unknown as Sort<TeamMember>,
        limit: PROJECT_MEMBER_SEARCH_READ_LIMIT,
        skip: 0,
        props: data.props,
      });
    };

    /*
     * Someone only invited is not found by their account's own name, which
     * the project does not see until they join (#9823, PendingInviteeProfiles
     * narrows the reads above), but by the name typed for them.
     */
    const readInvitedByTypedName: () => Promise<
      Array<TeamMember>
    > = (): Promise<Array<TeamMember>> => {
      return TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          hasAcceptedInvitation: false,
          inviteeName: new Search(pattern),
        } as unknown as Query<TeamMember>,
        select: select,
        sort: {
          inviteeName: SortOrder.Ascending,
        } as unknown as Sort<TeamMember>,
        limit: PROJECT_MEMBER_SEARCH_READ_LIMIT,
        skip: 0,
        props: data.props,
      });
    };

    const memberships: Array<TeamMember> = (
      await Promise.all(
        searchesEmails
          ? [read("name"), read("email"), readInvitedByTypedName()]
          : [read("name"), readInvitedByTypedName()],
      )
    ).flat();

    const matches: Array<ProjectMemberSearchMatch> = [];

    for (const membership of memberships) {
      const userId: string =
        membership.user?._id?.toString() || membership.userId?.toString() || "";
      const name: string = membership.user?.name?.toString().trim() || "";
      const email: string = searchesEmails
        ? membership.user?.email?.toString().trim() || ""
        : "";

      if (!userId) {
        continue;
      }

      matches.push({ userId, name, ...(email ? { email } : {}) });
    }

    return rankProjectMemberMatches(matches, data.text);
  }
}
