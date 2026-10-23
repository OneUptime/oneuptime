import { JSONObject } from "../JSON";
import WorkspaceType from "./WorkspaceType";

/*
 * ASKING EVERY MEMBER TO CONNECT THEIR SLACK OR MICROSOFT TEAMS ACCOUNT.
 *
 * Each member connects their own chat account by signing in to it - only a
 * sign-in writes that link (WorkspaceUserAuthToken) - so nobody connects
 * somebody else's, an admin included. What an admin bringing in hundreds of
 * people can do is ask them all at once: OneUptime finds each member who has
 * not connected in the workspace by their email address, and its bot sends
 * them a direct message whose Connect button connects their account in one
 * click (WorkspaceAskToConnect).
 *
 * What the settings page and the server say to each other, in one place:
 * the route, the answer's shape, and how it is read back - only well-formed
 * values.
 *
 * React-free and server-free, so both sides and plain tests can import it.
 */

// GET and POST <api>/workspace-ask-to-connect/<workspace type>
export const WORKSPACE_ASK_TO_CONNECT_ROUTE: string =
  "/workspace-ask-to-connect";

// Somebody asked within this many hours is not asked again yet.
export const WORKSPACE_ASK_TO_CONNECT_AGAIN_AFTER_HOURS: number = 24;

// How many of the people it could not find an answer names.
export const WORKSPACE_ASK_TO_CONNECT_MAX_NAMED: number = 50;

export enum WorkspaceAskToConnectState {
  // Sending the messages.
  Asking = "asking",
  Done = "done",
  /*
   * The server that was asking stopped before it was done, as on a restart:
   * asking again goes on with whoever it had not asked yet.
   */
  Stopped = "stopped",
}

// The last time an admin asked everybody, and how far it got.
export interface WorkspaceAskToConnectRun {
  state: WorkspaceAskToConnectState;
  // ISO dates.
  startedAt: string;
  finishedAt?: string | undefined;
  askedByName: string;
  // Members it set out to ask: not connected, and not asked lately.
  toAskCount: number;
  // Sent a message.
  askedCount: number;
  // Nobody in the workspace has their email address.
  notFoundCount: number;
  // The workspace refused the message.
  failedCount: number;
  // The first of the people it could not find, by name.
  notFoundNames: Array<string>;
}

export interface WorkspaceAskToConnectStatus {
  // Members of the project.
  memberCount: number;
  // Of them, those whose account in the workspace is connected.
  connectedCount: number;
  run: WorkspaceAskToConnectRun | null;
}

export default class WorkspaceAskToConnectUtil {
  public static isWorkspaceType(value: unknown): value is WorkspaceType {
    return (
      value === WorkspaceType.Slack || value === WorkspaceType.MicrosoftTeams
    );
  }

  public static statusToJSON(status: WorkspaceAskToConnectStatus): JSONObject {
    return {
      memberCount: status.memberCount,
      connectedCount: status.connectedCount,
      run: status.run ? WorkspaceAskToConnectUtil.runToJSON(status.run) : null,
    };
  }

  public static runToJSON(run: WorkspaceAskToConnectRun): JSONObject {
    return {
      state: run.state,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt || null,
      askedByName: run.askedByName,
      toAskCount: run.toAskCount,
      askedCount: run.askedCount,
      notFoundCount: run.notFoundCount,
      failedCount: run.failedCount,
      notFoundNames: run.notFoundNames,
    };
  }

  // A status from an answer, or null when the answer is not one.
  public static statusFromJSON(
    value: unknown,
  ): WorkspaceAskToConnectStatus | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;

    return {
      memberCount: WorkspaceAskToConnectUtil.readCount(json["memberCount"]),
      connectedCount: WorkspaceAskToConnectUtil.readCount(
        json["connectedCount"],
      ),
      run: WorkspaceAskToConnectUtil.runFromJSON(json["run"]),
    };
  }

  // A run from an answer or the cache, or null when it is not one.
  public static runFromJSON(value: unknown): WorkspaceAskToConnectRun | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;
    const state: unknown = json["state"];

    if (
      !Object.values(WorkspaceAskToConnectState).includes(
        state as WorkspaceAskToConnectState,
      ) ||
      typeof json["startedAt"] !== "string"
    ) {
      return null;
    }

    const names: unknown = json["notFoundNames"];

    return {
      state: state as WorkspaceAskToConnectState,
      startedAt: json["startedAt"] as string,
      finishedAt:
        typeof json["finishedAt"] === "string"
          ? (json["finishedAt"] as string)
          : undefined,
      askedByName:
        typeof json["askedByName"] === "string"
          ? (json["askedByName"] as string)
          : "",
      toAskCount: WorkspaceAskToConnectUtil.readCount(json["toAskCount"]),
      askedCount: WorkspaceAskToConnectUtil.readCount(json["askedCount"]),
      notFoundCount: WorkspaceAskToConnectUtil.readCount(json["notFoundCount"]),
      failedCount: WorkspaceAskToConnectUtil.readCount(json["failedCount"]),
      notFoundNames: Array.isArray(names)
        ? names
            .filter((name: unknown): name is string => {
              return typeof name === "string" && name.length > 0;
            })
            .slice(0, WORKSPACE_ASK_TO_CONNECT_MAX_NAMED)
        : [],
    };
  }

  // A whole number of at least zero; zero for anything else.
  private static readCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  }
}
