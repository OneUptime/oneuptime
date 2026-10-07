import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";

/*
 * Whether people a page names - an owner, someone in an on-call layer, the
 * user an incoming call rule rings, either side of an override - are still
 * members of the project. Somebody who left is never notified any more
 * (the server's ProjectMembership check), and the page says so next to
 * their name, so whoever looks after the setup knows to replace them.
 *
 * A member holds an accepted invitation to at least one team of the project,
 * the server's rule. Asks made while a page renders are collected for one
 * tick and answered with ONE read of those people's accepted memberships,
 * and answers are kept for a minute, so a table of fifty rows asks once.
 *
 * The answer is null - "don't know, say nothing" - whenever the read could
 * not prove somebody is NOT a member: before the permission snapshot has
 * landed, for a reader who may only see their own memberships (the read
 * would come back without everybody else's), and when the read fails.
 * Marking a member as gone would be worse than not marking anybody.
 */
export type ProjectMembershipAnswer = boolean | null;

export type ProjectMemberReader = (data: {
  projectId: ObjectID;
  userIds: Array<string>;
}) => Promise<Set<string>>;

/*
 * TeamMember's read permissions, less CurrentUser: a reader holding one of
 * these sees every membership of the project, so a person missing from the
 * answer really is not a member.
 */
export const PROJECT_MEMBERSHIP_READ_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ProjectUser,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadProjectTeam,
];

const ANSWER_TTL_IN_MS: number = 60 * 1000;

export const readProjectMembers: ProjectMemberReader = async (data: {
  projectId: ObjectID;
  userIds: Array<string>;
}): Promise<Set<string>> => {
  const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
    modelType: TeamMember,
    query: {
      projectId: data.projectId,
      userId: new Includes(
        data.userIds.map((userId: string): ObjectID => {
          return new ObjectID(userId);
        }),
      ),
      hasAcceptedInvitation: true,
    },
    select: {
      userId: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {},
  });

  return new Set<string>(
    result.data
      .map((member: TeamMember): string => {
        return member.userId?.toString().toLowerCase() || "";
      })
      .filter(Boolean),
  );
};

interface CachedAnswer {
  answer: Promise<ProjectMembershipAnswer>;
  expiresAt: number;
}

interface PendingAsk {
  userId: string;
  resolve: (answer: ProjectMembershipAnswer) => void;
}

export class ProjectMembershipLoader {
  private readonly cache: Map<string, CachedAnswer> = new Map<
    string,
    CachedAnswer
  >();

  private readonly pendingByProject: Map<string, Array<PendingAsk>> = new Map<
    string,
    Array<PendingAsk>
  >();

  private isFlushScheduled: boolean = false;

  public constructor(
    private readonly readMembers: ProjectMemberReader = readProjectMembers,
    private readonly canReadEveryMembership: () => boolean = (): boolean => {
      /*
       * Only a grant that reaches the whole project, with no block on it,
       * reads every membership: a grant limited to labels or owned records
       * could leave members out of the answer.
       */
      return (
        PermissionGate.hasPermissionSnapshot() &&
        PermissionGate.holdsAnyOf(PROJECT_MEMBERSHIP_READ_PERMISSIONS, {
          projectWideOnly: true,
          labelledBlocksRefuse: true,
        })
      );
    },
    private readonly now: () => number = (): number => {
      return Date.now();
    },
  ) {}

  public isMember(data: {
    projectId: ObjectID | string | null | undefined;
    userId: ObjectID | string | null | undefined;
  }): Promise<ProjectMembershipAnswer> {
    const projectId: string = data.projectId?.toString().toLowerCase() || "";
    const userId: string = data.userId?.toString().toLowerCase() || "";

    if (
      !projectId ||
      !userId ||
      !ObjectID.isValidUUID(projectId) ||
      !ObjectID.isValidUUID(userId) ||
      !this.canReadEveryMembership()
    ) {
      return Promise.resolve(null);
    }

    const key: string = `${projectId}:${userId}`;
    const cached: CachedAnswer | undefined = this.cache.get(key);

    if (cached && cached.expiresAt > this.now()) {
      return cached.answer;
    }

    const answer: Promise<ProjectMembershipAnswer> =
      new Promise<ProjectMembershipAnswer>(
        (resolve: (answer: ProjectMembershipAnswer) => void): void => {
          const pending: Array<PendingAsk> =
            this.pendingByProject.get(projectId) || [];

          pending.push({ userId: userId, resolve: resolve });
          this.pendingByProject.set(projectId, pending);
          this.scheduleFlush();
        },
      );

    this.cache.set(key, {
      answer: answer,
      expiresAt: this.now() + ANSWER_TTL_IN_MS,
    });

    return answer;
  }

  // Forget every answer: after the people on a page changed, ask again.
  public clear(): void {
    this.cache.clear();
  }

  private scheduleFlush(): void {
    if (this.isFlushScheduled) {
      return;
    }

    this.isFlushScheduled = true;

    setTimeout((): void => {
      this.isFlushScheduled = false;
      void this.flush();
    }, 0);
  }

  private async flush(): Promise<void> {
    const batches: Array<[string, Array<PendingAsk>]> = Array.from(
      this.pendingByProject.entries(),
    );

    this.pendingByProject.clear();

    for (const [projectId, asks] of batches) {
      const userIds: Array<string> = Array.from(
        new Set<string>(
          asks.map((ask: PendingAsk): string => {
            return ask.userId;
          }),
        ),
      );

      let memberIds: Set<string> | null = null;

      try {
        memberIds = await this.readMembers({
          projectId: new ObjectID(projectId),
          userIds: userIds,
        });
      } catch {
        memberIds = null;
      }

      for (const ask of asks) {
        if (!memberIds) {
          // Unknown, and not kept: the next render may ask again.
          this.cache.delete(`${projectId}:${ask.userId}`);
          ask.resolve(null);
          continue;
        }

        ask.resolve(memberIds.has(ask.userId));
      }
    }
  }
}

export default new ProjectMembershipLoader();
