import AdminModelAPI from "../../Utils/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import API from "Common/UI/Utils/API/API";

export interface BulkAddUsersToProjectFailure {
  user: User;
  failedMessage: string;
}

/*
 * The running tally, emitted after every user so the bulk progress modal can
 * count down. `inProgressUsers` are the ones not attempted yet, which is what
 * the shared progress bar subtracts from.
 */
export interface BulkAddUsersToProjectProgress {
  totalUsers: Array<User>;
  inProgressUsers: Array<User>;
  succeededUsers: Array<User>;
  failedUsers: Array<BulkAddUsersToProjectFailure>;
}

export type BulkAddUsersToProjectResult = BulkAddUsersToProjectProgress;

export type OnBulkAddUsersToProjectProgress = (
  progress: BulkAddUsersToProjectProgress,
) => void;

export type CreateTeamMemberFunction = (
  teamMember: TeamMember,
) => Promise<void>;

export interface BulkAddUsersToProjectOptions {
  users: Array<User>;
  projectId: ObjectID;
  teamId: ObjectID;
  /*
   * Only a master admin may create a membership that is already accepted -
   * TeamMemberService.onBeforeCreate rejects it for everyone else. Left false,
   * each user is invited and accepts for themselves.
   */
  hasAcceptedInvitation?: boolean | undefined;
  onProgress?: OnBulkAddUsersToProjectProgress | undefined;
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

/**
 * Creates one team membership per selected user, in the order they were
 * selected.
 *
 * Sequential on purpose. Each create runs the project's seat accounting
 * (TeamMemberService.onBeforeCreate reads paymentProviderSubscriptionSeats
 * against seatLimit), so concurrent creates would race that check and could
 * take a project past its seat limit.
 *
 * One user failing does not stop the rest: the whole point of the bulk action
 * is that a project a few of the selected users are already on should not
 * block adding the others. Failures are collected per user and reported next
 * to the name they belong to.
 */
export const bulkAddUsersToProject: (
  options: BulkAddUsersToProjectOptions,
) => Promise<BulkAddUsersToProjectResult> = async (
  options: BulkAddUsersToProjectOptions,
): Promise<BulkAddUsersToProjectResult> => {
  const createTeamMember: CreateTeamMemberFunction =
    options.createTeamMember || createTeamMemberWithModelAPI;

  /*
   * The same user can only be counted once. A selection that somehow carries a
   * duplicate would otherwise report the second attempt as an "already invited"
   * failure that the admin did nothing to cause.
   */
  const users: Array<User> = [];
  const seenUserIds: Set<string> = new Set<string>();

  for (const user of options.users) {
    const userId: string | undefined = user.id?.toString();

    if (userId && seenUserIds.has(userId)) {
      continue;
    }

    if (userId) {
      seenUserIds.add(userId);
    }

    users.push(user);
  }

  const progress: BulkAddUsersToProjectProgress = {
    totalUsers: users,
    inProgressUsers: [...users],
    succeededUsers: [],
    failedUsers: [],
  };

  const emitProgress: () => void = (): void => {
    /*
     * Every array is copied. The receiver holds these across renders, and the
     * loop keeps mutating its own, so handing out a live reference would let
     * an earlier report change under a caller that had already read it.
     */
    options.onProgress?.({
      totalUsers: [...progress.totalUsers],
      inProgressUsers: [...progress.inProgressUsers],
      succeededUsers: [...progress.succeededUsers],
      failedUsers: [...progress.failedUsers],
    });
  };

  for (const user of users) {
    progress.inProgressUsers.shift();

    try {
      if (!user.id) {
        throw new Error("User ID not found.");
      }

      const teamMember: TeamMember = new TeamMember();
      teamMember.userId = user.id;
      teamMember.teamId = options.teamId;

      /*
       * projectId has to be set explicitly. A master admin sends no tenant
       * header, so nothing else on the way to the server can fill in the
       * project column - same reason the single-user form sets it by hand.
       */
      teamMember.projectId = options.projectId;
      teamMember.hasAcceptedInvitation = Boolean(options.hasAcceptedInvitation);

      await createTeamMember(teamMember);

      progress.succeededUsers.push(user);
    } catch (err) {
      progress.failedUsers.push({
        user: user,
        failedMessage: API.getFriendlyMessage(err),
      });
    }

    emitProgress();
  }

  return {
    totalUsers: [...progress.totalUsers],
    inProgressUsers: [...progress.inProgressUsers],
    succeededUsers: [...progress.succeededUsers],
    failedUsers: [...progress.failedUsers],
  };
};

export default bulkAddUsersToProject;
