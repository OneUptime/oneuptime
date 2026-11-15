import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  PageIdList,
  readPageIdList,
} from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import {
  MAX_OWNERS_ON_CREATE,
  OWNER_TEAMS_ARGUMENT_ID,
  OWNER_USERS_ARGUMENT_ID,
  getOwnersOnCreateArguments,
} from "../../../../../Types/Workflow/OwnersOnCreateSetting";
import TeamService from "../../../../Services/TeamService";
import UserService from "../../../../Services/UserService";
import ProjectMembership from "../../../../Utils/TeamMember/ProjectMembership";
import QueryHelper from "../../../Database/QueryHelper";

/*
 * THE OWNERS A CREATE ONE INCIDENT OR CREATE ONE ALERT STEP HANDS OVER WITH
 * ITS CREATE (#8198, Types/Workflow/OwnersOnCreateSetting).
 *
 * Owner Users and Owner Teams, read as the Page steps read whom to page
 * (readPageIdList): picked records, and values from earlier steps - an id,
 * several, a list, records, and for people an email address. What comes of
 * them is the create's misc data, ownerUsers and ownerTeams, exactly as the
 * REST create takes them: the record's service asks whether the step - a
 * Project Admin of the workflow's project, never root - may add them before
 * anything is saved, and refuses the create when it may not
 * (OwnerRuleAssignment.checkOwnersPickedOnCreate).
 *
 * People are held to the project's members, by id or by email address, and
 * teams to the project's teams, read as the step reads them: whether an id
 * or an address is somebody's outside this project is nobody's to learn
 * here. An entry that names nobody does not stop the step - the record is
 * still created, with the owners that were found - and the run log says
 * which entries were left out, and why.
 */

// What a create's misc data holds of them: only what was found.
export interface OwnersOnCreate {
  ownerUsers?: Array<ObjectID>;
  ownerTeams?: Array<ObjectID>;
}

function sameId(a: ObjectID | string | undefined, b: string): boolean {
  return Boolean(a) && a!.toString().toLowerCase() === b.toLowerCase();
}

// "x", "y" and "z" - as many as the log line shows, then how many more.
function quoted(entries: Array<string>): string {
  const shown: Array<string> = entries.slice(0, 3).map((entry: string) => {
    return `"${entry}"`;
  });
  const more: number = entries.length - shown.length;

  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

export default class OwnersOnCreateArgument {
  /*
   * The owners the step's settings name, as the create's misc data: nothing
   * for a table with no owner settings, or when they hold nobody. Says in
   * the run log what each setting held that was left out.
   */
  public static async read(data: {
    args: JSONObject;
    tableName: string | undefined;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    log: (message: string) => void;
  }): Promise<OwnersOnCreate> {
    if (getOwnersOnCreateArguments(data.tableName).length === 0) {
      return {};
    }

    const usersSetting: PageIdList = this.readSetting({
      value: data.args[OWNER_USERS_ARGUMENT_ID] as JSONValue | undefined,
      allowEmails: true,
      settingName: "Owner Users",
      log: data.log,
    });

    const teamsSetting: PageIdList = this.readSetting({
      value: data.args[OWNER_TEAMS_ARGUMENT_ID] as JSONValue | undefined,
      allowEmails: false,
      settingName: "Owner Teams",
      log: data.log,
    });

    const owners: OwnersOnCreate = {};

    if (usersSetting.ids.length > 0 || usersSetting.emails.length > 0) {
      const userIds: Array<ObjectID> = await this.findMembers({
        projectId: data.projectId,
        list: usersSetting,
        log: data.log,
      });

      if (userIds.length > 0) {
        owners.ownerUsers = userIds;
      }
    }

    if (teamsSetting.ids.length > 0) {
      const teamIds: Array<ObjectID> = await this.findTeams({
        projectId: data.projectId,
        ids: teamsSetting.ids,
        props: data.props,
        log: data.log,
      });

      if (teamIds.length > 0) {
        owners.ownerTeams = teamIds;
      }
    }

    return owners;
  }

  /*
   * One setting taken apart into ids (and, for people, addresses), each
   * once, at most MAX_OWNERS_ON_CREATE of them; what is neither is said in
   * the run log.
   */
  private static readSetting(data: {
    value: JSONValue | undefined;
    allowEmails: boolean;
    settingName: string;
    log: (message: string) => void;
  }): PageIdList {
    const list: PageIdList = readPageIdList(data.value, {
      allowEmails: data.allowEmails,
    });

    if (list.unreadable.length > 0) {
      data.log(
        `${data.settingName} also held ${quoted(list.unreadable)}, which ${list.unreadable.length === 1 ? "is" : "are"} not ${data.allowEmails ? "a user's ID or email address" : "a team's ID"}: left out.`,
      );
    }

    const named: number = list.ids.length + list.emails.length;

    if (named > MAX_OWNERS_ON_CREATE) {
      data.log(
        `${data.settingName} named ${named}: the first ${MAX_OWNERS_ON_CREATE} are owners, the rest left out.`,
      );

      const ids: Array<string> = list.ids.slice(0, MAX_OWNERS_ON_CREATE);

      return {
        ids: ids,
        emails: list.emails.slice(0, MAX_OWNERS_ON_CREATE - ids.length),
        unreadable: list.unreadable,
      };
    }

    return list;
  }

  // The members of the project among the people named, by id or address, each once.
  private static async findMembers(data: {
    projectId: ObjectID;
    list: PageIdList;
    log: (message: string) => void;
  }): Promise<Array<ObjectID>> {
    const usersById: Array<User> =
      data.list.ids.length > 0
        ? await UserService.findBy({
            query: {
              _id: QueryHelper.any(data.list.ids),
            },
            select: {
              _id: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          })
        : [];

    const usersByEmail: Array<User> =
      data.list.emails.length > 0
        ? await UserService.findBy({
            query: {
              email: QueryHelper.any(data.list.emails),
            },
            select: {
              _id: true,
              email: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          })
        : [];

    const memberIds: Set<string> =
      usersById.length + usersByEmail.length > 0
        ? await ProjectMembership.getMemberUserIds({
            projectId: data.projectId,
            userIds: [...usersById, ...usersByEmail].map(
              (user: User): ObjectID => {
                return user.id!;
              },
            ),
          })
        : new Set<string>();

    const isMember: (user: User | undefined) => user is User = (
      user: User | undefined,
    ): user is User => {
      return Boolean(
        user?.id && memberIds.has(user.id.toString().toLowerCase()),
      );
    };

    const found: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();
    const notFound: Array<string> = [];

    const add: (user: User) => void = (user: User): void => {
      const key: string = user.id!.toString().toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        found.push(user.id!);
      }
    };

    for (const id of data.list.ids) {
      const user: User | undefined = usersById.find(
        (candidate: User): boolean => {
          return sameId(candidate.id || undefined, id);
        },
      );

      if (!isMember(user)) {
        notFound.push(id);
        continue;
      }

      add(user);
    }

    for (const email of data.list.emails) {
      const user: User | undefined = usersByEmail.find(
        (candidate: User): boolean => {
          return candidate.email?.toString().toLowerCase() === email;
        },
      );

      if (!isMember(user)) {
        notFound.push(email);
        continue;
      }

      add(user);
    }

    if (notFound.length > 0) {
      data.log(
        `Owner Users: no member of this project has the ID or email address ${quoted(notFound)}: left out.`,
      );
    }

    return found;
  }

  // The project's teams among the ids named, read as the step reads them.
  private static async findTeams(data: {
    projectId: ObjectID;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
    log: (message: string) => void;
  }): Promise<Array<ObjectID>> {
    const teams: Array<Team> = await TeamService.findBy({
      query: {
        _id: QueryHelper.any(data.ids),
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: data.props,
    });

    const found: Array<ObjectID> = [];
    const notFound: Array<string> = [];

    for (const id of data.ids) {
      const team: Team | undefined = teams.find((candidate: Team): boolean => {
        return sameId(candidate.id || undefined, id);
      });

      if (!team?.id) {
        notFound.push(id);
        continue;
      }

      found.push(team.id);
    }

    if (notFound.length > 0) {
      data.log(
        `Owner Teams: no team of this project has the ID ${quoted(notFound)}: left out.`,
      );
    }

    return found;
  }
}
