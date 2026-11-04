import AdminModelAPI from "../../Utils/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { BulkActionOnClickProps } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BulkActionRunResult,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";

export type CreateTeamMemberFunction = (
  teamMember: TeamMember,
) => Promise<void>;

export interface AddUserToProjectOptions {
  user: User;
  projectId: ObjectID;
  teamId: ObjectID;
  /*
   * Only a master admin may create a membership that is already accepted -
   * TeamMemberService.onBeforeCreate rejects it for everyone else. Left false,
   * each user is invited and accepts for themselves.
   */
  hasAcceptedInvitation?: boolean | undefined;
  createTeamMember?: CreateTeamMemberFunction | undefined;
}

export interface BulkAddUsersToProjectOptions {
  /*
   * The bulk action's click: the selected users, and the shared progress
   * dialog the run reports to - its counts, the time left and Stop.
   */
  actionProps: BulkActionOnClickProps<User>;
  projectId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation?: boolean | undefined;
  createTeamMember?: CreateTeamMemberFunction | undefined;
}

const createTeamMemberWithModelAPI: CreateTeamMemberFunction = async (
  teamMember: TeamMember,
): Promise<void> => {
  await AdminModelAPI.create<TeamMember>({
    model: teamMember,
    modelType: TeamMember,
  });
};

/*
 * The selection, each user once, in the order they were selected. A
 * selection that somehow carries a duplicate would otherwise report the
 * second attempt as an "already invited" failure the admin did nothing to
 * cause.
 */
export const getUsersToAdd: (users: Array<User>) => Array<User> = (
  users: Array<User>,
): Array<User> => {
  const usersToAdd: Array<User> = [];
  const seenUserIds: Set<string> = new Set<string>();

  for (const user of users) {
    const userId: string | undefined = user.id?.toString();

    if (userId && seenUserIds.has(userId)) {
      continue;
    }

    if (userId) {
      seenUserIds.add(userId);
    }

    usersToAdd.push(user);
  }

  return usersToAdd;
};

// One user's membership of the picked team. Throws when it is not created.
export const addUserToProject: (
  options: AddUserToProjectOptions,
) => Promise<void> = async (
  options: AddUserToProjectOptions,
): Promise<void> => {
  if (!options.user.id) {
    throw new Error("User ID not found.");
  }

  const teamMember: TeamMember = new TeamMember();
  teamMember.userId = options.user.id;
  teamMember.teamId = options.teamId;

  /*
   * projectId has to be set explicitly. A master admin sends no tenant
   * header, so nothing else on the way to the server can fill in the
   * project column - same reason the single-user form sets it by hand.
   */
  teamMember.projectId = options.projectId;
  teamMember.hasAcceptedInvitation = Boolean(options.hasAcceptedInvitation);

  await (options.createTeamMember || createTeamMemberWithModelAPI)(teamMember);
};

/**
 * Creates one team membership per selected user, in the order they were
 * selected, through the shared bulk runner (runBulkAction): the progress
 * dialog counts the users down, says how long is left, and Stop starts no
 * more of them.
 *
 * One user at a time, on purpose. Each create runs the project's seat
 * accounting (TeamMemberService.onBeforeCreate reads
 * paymentProviderSubscriptionSeats against seatLimit), so creates at once
 * would race that check and could take a project past its seat limit.
 *
 * One user failing does not stop the rest: the whole point of the bulk
 * action is that a project a few of the selected users are already on should
 * not block adding the others. The runner reports each failure next to the
 * name it belongs to.
 */
export const bulkAddUsersToProject: (
  options: BulkAddUsersToProjectOptions,
) => Promise<BulkActionRunResult<User>> = async (
  options: BulkAddUsersToProjectOptions,
): Promise<BulkActionRunResult<User>> => {
  return await runBulkAction<User>({
    actionProps: {
      ...options.actionProps,
      items: getUsersToAdd(options.actionProps.items),
    },
    concurrency: 1,
    step: async (user: User): Promise<void> => {
      await addUserToProject({
        user: user,
        projectId: options.projectId,
        teamId: options.teamId,
        hasAcceptedInvitation: options.hasAcceptedInvitation,
        createTeamMember: options.createTeamMember,
      });
    },
  });
};

export default bulkAddUsersToProject;
