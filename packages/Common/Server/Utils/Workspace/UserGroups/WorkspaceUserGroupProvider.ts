import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceUserGroupLeftOut,
  WorkspaceUserGroupMember,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupSyncState,
} from "../../../../Types/Workspace/WorkspaceUserGroup";

/*
 * What keeping one on-call user group in step asks of a workspace - Slack's
 * user groups (SlackUserGroups), Microsoft Teams' tags (MicrosoftTeamsTags) -
 * and what it tells back. WorkspaceUserGroupSync decides who should be in
 * the group; a provider finds those people in the workspace and makes the
 * group hold exactly them.
 */

// Somebody on call, as the workspace is asked to find them.
export interface WorkspaceUserGroupPerson {
  userId: ObjectID;
  // Their OneUptime email address, to find them by in the workspace.
  email: string;
  /*
   * The workspace account they connected to OneUptime (WorkspaceUserAuthToken):
   * a Slack user id, a Microsoft Entra object id. Null when they have not.
   */
  connectedWorkspaceUserId: string | null;
}

// The group as the provider is handed it.
export interface WorkspaceUserGroupTarget {
  projectId: ObjectID;
  // The project's connection to the workspace.
  authToken: string;
  // Slack: the workspace (team) id. Microsoft Teams: the tenant id.
  workspaceProjectId: string;
  workspaceGroupId: string;
  // Microsoft Teams: the team the tag is in.
  workspaceTeamId: string | null;
  // The group's name as OneUptime knows it (a Teams tag is made again by it).
  name: string;
}

// What making a group hold `people` came to.
export interface WorkspaceUserGroupProviderResult {
  members: Array<WorkspaceUserGroupMember>;
  leftOut: Array<WorkspaceUserGroupLeftOut>;
  isTurnedOff: boolean;
  /*
   * A problem the sync still went through with: the group holds the right
   * people, but somebody turned it off in Slack. Anything worse is thrown as
   * a WorkspaceUserGroupError.
   */
  problem: WorkspaceUserGroupProblem | null;
  // The group as the workspace names it now, when it said.
  name?: string | undefined;
  handle?: string | null | undefined;
  // Microsoft Teams: the id of a tag OneUptime had to make again.
  workspaceGroupId?: string | undefined;
}

/*
 * What a provider is asked to do: make `target` hold `people` - nobody,
 * when nobody is on call - knowing what the last sync left it as.
 */
export interface WorkspaceUserGroupSyncRequest {
  target: WorkspaceUserGroupTarget;
  people: Array<WorkspaceUserGroupPerson>;
  previous: WorkspaceUserGroupSyncState | null;
  /*
   * What one round of syncs read once and shares: the workspace's groups,
   * a team's roster. Keyed by the provider.
   */
  cache: Map<string, unknown>;
}

export interface WorkspaceUserGroupProvider {
  sync(
    request: WorkspaceUserGroupSyncRequest,
  ): Promise<WorkspaceUserGroupProviderResult>;
}

/*
 * A workspace refused, or did not answer: the problem the card says, what
 * the workspace said (an error code), and how long it asked OneUptime to
 * wait before trying again.
 */
export class WorkspaceUserGroupError extends Error {
  public readonly problem: WorkspaceUserGroupProblem;
  public readonly detail: string | undefined;
  public readonly retryAfterSeconds: number | undefined;

  public constructor(data: {
    problem: WorkspaceUserGroupProblem;
    detail?: string | undefined;
    retryAfterSeconds?: number | undefined;
  }) {
    super(
      data.detail ? `${data.problem}: ${data.detail}` : String(data.problem),
    );
    this.name = "WorkspaceUserGroupError";
    this.problem = data.problem;
    this.detail = data.detail;
    this.retryAfterSeconds = data.retryAfterSeconds;
  }

  // Duck-typed: an error from another realm is read by its fields too.
  public static read(error: unknown): WorkspaceUserGroupError | null {
    if (error instanceof WorkspaceUserGroupError) {
      return error;
    }

    const candidate: {
      name?: unknown;
      problem?: unknown;
      detail?: unknown;
      retryAfterSeconds?: unknown;
    } | null =
      error && typeof error === "object"
        ? (error as {
            name?: unknown;
            problem?: unknown;
            detail?: unknown;
            retryAfterSeconds?: unknown;
          })
        : null;

    if (
      candidate &&
      candidate.name === "WorkspaceUserGroupError" &&
      Object.values(WorkspaceUserGroupProblem).includes(
        candidate.problem as WorkspaceUserGroupProblem,
      )
    ) {
      return new WorkspaceUserGroupError({
        problem: candidate.problem as WorkspaceUserGroupProblem,
        detail:
          typeof candidate.detail === "string" ? candidate.detail : undefined,
        retryAfterSeconds:
          typeof candidate.retryAfterSeconds === "number"
            ? candidate.retryAfterSeconds
            : undefined,
      });
    }

    return null;
  }
}
