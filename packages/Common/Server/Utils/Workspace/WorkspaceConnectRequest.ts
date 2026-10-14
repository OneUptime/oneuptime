import crypto from "crypto";
import GlobalCache from "../../Infrastructure/GlobalCache";
import DatabaseConfig from "../../DatabaseConfig";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ConnectCallbackUtil, {
  CONNECT_REQUEST_QUERY_PARAM,
  ConnectProvider,
  ConnectStartPage,
} from "../../../Types/Workspace/ConnectCallback";
import { WorkspaceEventType } from "./WorkspaceMemberActions";

/*
 * SOMEBODY PRESSED A BUTTON IN SLACK OR MICROSOFT TEAMS BEFORE CONNECTING
 * THEIR ACCOUNT.
 *
 * A button acts as the OneUptime member the chat account is connected to, so
 * somebody whose account is not connected yet cannot act. They used to be
 * told so in a direct message from the app - away from the channel they were
 * looking at, so they missed it, pressed again, and missed that answer too.
 *
 * Now they are answered where they pressed, with a Connect button. Behind it
 * is a connect request, recorded here: who pressed (the chat account), in
 * which project, what they pressed, and where to answer them. The button
 * opens their own settings page for that workspace with the request's token
 * (`?connect=`); the page signs them in to the workspace at once, the token
 * going with the sign-in; and the callback, once it has connected the
 * account, finishes what they pressed - acknowledging, say - as the member
 * the account is now connected to, and answers them where they pressed
 * (WorkspaceConnectCompletion).
 *
 * WHAT THE TOKEN IS, AND IS NOT
 *
 * An opaque random token. What it stands for lives only here, on the server,
 * keyed by the token's SHA-256, so a read of the cache yields no usable
 * token. It is not a credential: the sign-in still needs the person's own
 * OneUptime session in the project, and the chat account the workspace says
 * signed in must be the one that pressed (else nothing is connected - a
 * connect link opened in a browser signed in to somebody else's Slack would
 * otherwise connect that person's account to yours). Spent once, by the
 * callback that finishes it; it lasts as long as Slack lets an answer go
 * back to where the press was (EXPIRES_IN_SECONDS).
 */

// What a press does that OneUptime can finish once the account is connected.
export enum WorkspacePendingActionKind {
  Acknowledge = "Acknowledge",
  Resolve = "Resolve",
  MarkAsOngoing = "MarkAsOngoing",
  MarkAsComplete = "MarkAsComplete",
  // A message pinned, or given a note emoji: saved as a note on the record.
  SavePrivateNote = "SavePrivateNote",
  SavePublicNote = "SavePublicNote",
}

// The message a pin or a note emoji is on, to save it once connected.
export interface WorkspacePendingMessage {
  // The channel it is in: a Slack channel id, a Microsoft Teams channel id.
  channelId: string;
  // The message: its ts in Slack, its id in Microsoft Teams.
  messageId: string;
  // Microsoft Teams: the team the channel is in (its Graph id).
  teamId?: string | undefined;
}

export interface WorkspacePendingAction {
  kind: WorkspacePendingActionKind;
  eventType: WorkspaceEventType;
  eventId: ObjectID;
  // For a note: the message to save.
  message?: WorkspacePendingMessage | undefined;
}

// The longest id a pending message keeps: generous next to any chat's.
const MAX_PENDING_MESSAGE_ID_LENGTH: number = 512;

// Whether a pending press saves a message as a note.
export const isSaveNoteKind: (kind: WorkspacePendingActionKind) => boolean = (
  kind: WorkspacePendingActionKind,
): boolean => {
  return (
    kind === WorkspacePendingActionKind.SavePrivateNote ||
    kind === WorkspacePendingActionKind.SavePublicNote
  );
};

/*
 * What to press again, for a press OneUptime cannot finish for them later: a
 * button that opens a form (the form opens only on a fresh press), a command,
 * or a question to OneUptime AI.
 */
export enum WorkspaceConnectRequestAgainKind {
  Button = "Button",
  Command = "Command",
  Question = "Question",
}

export interface WorkspaceConnectRequestAgain {
  kind: WorkspaceConnectRequestAgainKind;
  // The button's title, or the command: "Add Note", "/oneuptime incident".
  label?: string | undefined;
}

/*
 * What a press asks to be connected for, worked out from the press alone:
 * nothing about its record is read, since the person may not read it yet.
 */
export interface WorkspacePressDescription {
  // Completes "Connect your Slack account to ...": "acknowledge this incident".
  purpose: string;
  pendingAction?: WorkspacePendingAction | undefined;
  again?: WorkspaceConnectRequestAgain | undefined;
}

// Where Slack answers the press: the channel, its thread, the press's response_url.
export interface WorkspaceConnectRequestSlackPlace {
  teamId?: string | undefined;
  channelId?: string | undefined;
  threadTs?: string | undefined;
  responseUrl?: string | undefined;
  /*
   * The person's direct messages with the app, when that is where they
   * wrote: where the settings page's "Back to Slack" takes them. Never
   * where to answer - they are answered there by the app's own message,
   * which needs no channel (SlackActionAnswer).
   */
  directMessageChannelId?: string | undefined;
}

/*
 * Where Microsoft Teams answers the press: the conversation it was made in
 * (a channel's thread is "<channel>;messageid=<post>"), and the person, by
 * their Teams id, to mention.
 */
export interface WorkspaceConnectRequestTeamsPlace {
  serviceUrl: string;
  conversationId: string;
  conversationType?: string | undefined;
  tenantId?: string | undefined;
  userTeamsId?: string | undefined;
  userName?: string | undefined;
}

export interface WorkspaceConnectRequestData {
  workspaceType: WorkspaceType;
  projectId: ObjectID;
  /*
   * The chat account that pressed: a Slack user id ("U0123ABC"), or the
   * Microsoft Entra object id Microsoft Teams names its user by.
   */
  workspaceUserId: string;
  /*
   * What they were doing, completing "Connect your Slack account to ...":
   * "acknowledge this incident". OneUptime's own words, never the chat's.
   */
  purpose: string;
  // What OneUptime finishes for them once they are connected, if anything.
  pendingAction?: WorkspacePendingAction | undefined;
  // What to press again instead, when OneUptime cannot finish it.
  again?: WorkspaceConnectRequestAgain | undefined;
  slack?: WorkspaceConnectRequestSlackPlace | undefined;
  teams?: WorkspaceConnectRequestTeamsPlace | undefined;
}

export interface WorkspaceConnectRequestRecord
  extends WorkspaceConnectRequestData {
  expiresAt: Date;
}

/*
 * What the Connect button that answers a press opens (getConnectLink,
 * WorkspaceActionAnswers.getConnectPrompt).
 */
export enum WorkspaceConnectButton {
  // The settings page, carrying the press: connecting finishes it.
  OneClick = "OneClick",
  // The settings page alone: the press could not be kept to finish later.
  SettingsPage = "SettingsPage",
  // No button: the server knows no address of its own to link to.
  None = "None",
}

export interface WorkspaceConnectLink {
  button: WorkspaceConnectButton;
  // Where the button goes; none for WorkspaceConnectButton.None.
  url?: URL | undefined;
}

const NAMESPACE: string = "workspace-connect-request";

const KNOWN_WORKSPACE_TYPES: Array<WorkspaceType> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
];

export default class WorkspaceConnectRequest {
  /*
   * Thirty minutes: as long as Slack takes answers to a press's
   * response_url, and long enough to sign in to OneUptime, and to Slack or
   * Microsoft, with two-factor on both.
   */
  public static readonly EXPIRES_IN_SECONDS: number = 30 * 60;

  // Records a press to finish once the account is connected; its token.
  @CaptureSpan()
  public static async create(data: WorkspaceConnectRequestData): Promise<{
    token: string;
  }> {
    const token: string = crypto.randomBytes(32).toString("base64url");

    const record: JSONObject = {
      workspaceType: data.workspaceType,
      projectId: data.projectId.toString(),
      workspaceUserId: data.workspaceUserId,
      purpose: data.purpose,
      expiresAt: new Date(
        Date.now() + WorkspaceConnectRequest.EXPIRES_IN_SECONDS * 1000,
      ).toISOString(),
    };

    if (data.pendingAction) {
      record["pendingAction"] = {
        kind: data.pendingAction.kind,
        eventType: data.pendingAction.eventType,
        eventId: data.pendingAction.eventId.toString(),
      };

      if (data.pendingAction.message) {
        (record["pendingAction"] as JSONObject)["message"] =
          WorkspaceConnectRequest.compact({
            channelId: data.pendingAction.message.channelId,
            messageId: data.pendingAction.message.messageId,
            teamId: data.pendingAction.message.teamId,
          });
      }
    }

    if (data.again) {
      record["again"] = WorkspaceConnectRequest.compact({
        kind: data.again.kind,
        label: data.again.label,
      });
    }

    if (data.slack) {
      record["slack"] = WorkspaceConnectRequest.compact({
        teamId: data.slack.teamId,
        channelId: data.slack.channelId,
        threadTs: data.slack.threadTs,
        responseUrl: data.slack.responseUrl,
        directMessageChannelId: data.slack.directMessageChannelId,
      });
    }

    if (data.teams) {
      record["teams"] = WorkspaceConnectRequest.compact({
        serviceUrl: data.teams.serviceUrl,
        conversationId: data.teams.conversationId,
        conversationType: data.teams.conversationType,
        tenantId: data.teams.tenantId,
        userTeamsId: data.teams.userTeamsId,
        userName: data.teams.userName,
      });
    }

    await GlobalCache.setString(
      NAMESPACE,
      WorkspaceConnectRequest.hash(token),
      JSON.stringify(record),
      {
        expiresInSeconds: WorkspaceConnectRequest.EXPIRES_IN_SECONDS,
      },
    );

    return { token };
  }

  /*
   * The request behind a token, left in place: for the start of a sign-in,
   * which may be abandoned and started again from the same button. Null for
   * a token that is not one, unknown, expired or spent.
   */
  @CaptureSpan()
  public static async peek(
    token: unknown,
  ): Promise<WorkspaceConnectRequestRecord | null> {
    const wellFormedToken: string | null =
      ConnectCallbackUtil.readConnectRequestToken(token);

    if (!wellFormedToken) {
      return null;
    }

    return WorkspaceConnectRequest.parse(
      await GlobalCache.getString(
        NAMESPACE,
        WorkspaceConnectRequest.hash(wellFormedToken),
      ),
    );
  }

  /*
   * Spends a token: the request behind it, removed in the same atomic step,
   * so a press is finished once however many times its sign-in comes back.
   * Null as for peek.
   */
  @CaptureSpan()
  public static async take(
    token: unknown,
  ): Promise<WorkspaceConnectRequestRecord | null> {
    const wellFormedToken: string | null =
      ConnectCallbackUtil.readConnectRequestToken(token);

    if (!wellFormedToken) {
      return null;
    }

    return WorkspaceConnectRequest.parse(
      await GlobalCache.getAndDeleteString(
        NAMESPACE,
        WorkspaceConnectRequest.hash(wellFormedToken),
      ),
    );
  }

  /*
   * The Connect button for a press: the press recorded, and the link that
   * carries it (OneClick). A press that cannot be recorded - the cache is
   * down - gets a link to the settings page alone (SettingsPage), and the
   * person presses again once connected; with no address of the server's
   * own to link to, there is no button (None), and nothing is recorded.
   * Never throws.
   */
  @CaptureSpan()
  public static async getConnectLink(
    data: WorkspaceConnectRequestData,
  ): Promise<WorkspaceConnectLink> {
    let settingsUrl: URL;

    try {
      settingsUrl = await WorkspaceConnectRequest.getSettingsUrl({
        workspaceType: data.workspaceType,
        projectId: data.projectId,
      });
    } catch (err) {
      logger.debug(
        "No address of this server's own to link a Connect button to.",
      );
      logger.debug(err);
      return { button: WorkspaceConnectButton.None };
    }

    try {
      const { token } = await WorkspaceConnectRequest.create(data);

      return {
        button: WorkspaceConnectButton.OneClick,
        url: URL.fromString(settingsUrl.toString()).addQueryParam(
          CONNECT_REQUEST_QUERY_PARAM,
          token,
        ),
      };
    } catch (err) {
      logger.error(
        "Could not record a press to finish once the account is connected.",
        {
          projectId: data.projectId.toString(),
          workspaceType: data.workspaceType,
        },
      );
      logger.error(err, { projectId: data.projectId.toString() });

      return { button: WorkspaceConnectButton.SettingsPage, url: settingsUrl };
    }
  }

  /*
   * Where the Connect button goes: the person's own settings page for the
   * workspace, in the project, with the token. The page connects them at
   * once (Dashboard Components/Slack/SlackIntegration and
   * Components/MicrosoftTeams/MicrosoftTeamsIntegration).
   */
  @CaptureSpan()
  public static async getConnectUrl(data: {
    workspaceType: WorkspaceType;
    projectId: ObjectID;
    token: string;
  }): Promise<URL> {
    return (
      await WorkspaceConnectRequest.getSettingsUrl({
        workspaceType: data.workspaceType,
        projectId: data.projectId,
      })
    ).addQueryParam(CONNECT_REQUEST_QUERY_PARAM, data.token);
  }

  /*
   * The person's own settings page for the workspace in the project, where
   * they connect their account: what an answer links to when no press could
   * be recorded.
   */
  @CaptureSpan()
  public static async getSettingsUrl(data: {
    workspaceType: WorkspaceType;
    projectId: ObjectID;
  }): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${data.projectId.toString()}${ConnectCallbackUtil.getPagePath(
        data.workspaceType === WorkspaceType.MicrosoftTeams
          ? ConnectProvider.MicrosoftTeams
          : ConnectProvider.Slack,
        ConnectStartPage.UserSettings,
      )}`,
    );
  }

  /*
   * A stored request, read back: null for anything that is not one written
   * by create, or one past its expiry.
   */
  private static parse(
    raw: string | null,
  ): WorkspaceConnectRequestRecord | null {
    if (!raw) {
      return null;
    }

    let record: JSONObject;

    try {
      record = JSON.parse(raw) as JSONObject;
    } catch {
      logger.debug("A workspace connect request could not be read.");
      return null;
    }

    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return null;
    }

    const workspaceType: WorkspaceType = record[
      "workspaceType"
    ] as WorkspaceType;
    const projectId: unknown = record["projectId"];
    const workspaceUserId: unknown = record["workspaceUserId"];
    const purpose: unknown = record["purpose"];
    const expiresAt: number = Date.parse(String(record["expiresAt"]));

    if (
      !KNOWN_WORKSPACE_TYPES.includes(workspaceType) ||
      typeof projectId !== "string" ||
      !projectId ||
      typeof workspaceUserId !== "string" ||
      !workspaceUserId ||
      typeof purpose !== "string" ||
      !purpose ||
      Number.isNaN(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return null;
    }

    const parsed: WorkspaceConnectRequestRecord = {
      workspaceType: workspaceType,
      projectId: new ObjectID(projectId),
      workspaceUserId: workspaceUserId,
      purpose: purpose,
      expiresAt: new Date(expiresAt),
    };

    const pendingAction: WorkspacePendingAction | undefined =
      WorkspaceConnectRequest.parsePendingAction(record["pendingAction"]);

    if (pendingAction) {
      parsed.pendingAction = pendingAction;
    }

    const again: WorkspaceConnectRequestAgain | undefined =
      WorkspaceConnectRequest.parseAgain(record["again"]);

    if (again) {
      parsed.again = again;
    }

    const slack: JSONObject | undefined = WorkspaceConnectRequest.asObject(
      record["slack"],
    );

    if (slack) {
      parsed.slack = WorkspaceConnectRequest.compact({
        teamId: WorkspaceConnectRequest.asString(slack["teamId"]),
        channelId: WorkspaceConnectRequest.asString(slack["channelId"]),
        threadTs: WorkspaceConnectRequest.asString(slack["threadTs"]),
        responseUrl: WorkspaceConnectRequest.asString(slack["responseUrl"]),
        directMessageChannelId: WorkspaceConnectRequest.asString(
          slack["directMessageChannelId"],
        ),
      }) as WorkspaceConnectRequestSlackPlace;
    }

    const teams: JSONObject | undefined = WorkspaceConnectRequest.asObject(
      record["teams"],
    );

    const serviceUrl: string | undefined = WorkspaceConnectRequest.asString(
      teams?.["serviceUrl"],
    );
    const conversationId: string | undefined = WorkspaceConnectRequest.asString(
      teams?.["conversationId"],
    );

    if (teams && serviceUrl && conversationId) {
      parsed.teams = WorkspaceConnectRequest.compact({
        serviceUrl: serviceUrl,
        conversationId: conversationId,
        conversationType: WorkspaceConnectRequest.asString(
          teams["conversationType"],
        ),
        tenantId: WorkspaceConnectRequest.asString(teams["tenantId"]),
        userTeamsId: WorkspaceConnectRequest.asString(teams["userTeamsId"]),
        userName: WorkspaceConnectRequest.asString(teams["userName"]),
      }) as unknown as WorkspaceConnectRequestTeamsPlace;
    }

    return parsed;
  }

  private static parsePendingAction(
    value: unknown,
  ): WorkspacePendingAction | undefined {
    const action: JSONObject | undefined =
      WorkspaceConnectRequest.asObject(value);

    if (!action) {
      return undefined;
    }

    const kind: WorkspacePendingActionKind = action[
      "kind"
    ] as WorkspacePendingActionKind;
    const eventType: WorkspaceEventType = action[
      "eventType"
    ] as WorkspaceEventType;
    const eventId: string | undefined = WorkspaceConnectRequest.asString(
      action["eventId"],
    );

    if (
      !(Object.values(WorkspacePendingActionKind) as Array<string>).includes(
        kind,
      ) ||
      !(Object.values(WorkspaceEventType) as Array<string>).includes(
        eventType,
      ) ||
      !eventId
    ) {
      return undefined;
    }

    const pendingAction: WorkspacePendingAction = {
      kind: kind,
      eventType: eventType,
      eventId: new ObjectID(eventId),
    };

    const message: JSONObject | undefined = WorkspaceConnectRequest.asObject(
      action["message"],
    );
    const channelId: string | undefined = WorkspaceConnectRequest.asId(
      message?.["channelId"],
    );
    const messageId: string | undefined = WorkspaceConnectRequest.asId(
      message?.["messageId"],
    );

    // A note's press is only kept with the message it is on.
    const isNote: boolean = isSaveNoteKind(kind);

    if (channelId && messageId) {
      pendingAction.message = { channelId: channelId, messageId: messageId };

      const teamId: string | undefined = WorkspaceConnectRequest.asId(
        message?.["teamId"],
      );

      if (teamId) {
        pendingAction.message.teamId = teamId;
      }
    } else if (isNote) {
      return undefined;
    }

    return pendingAction;
  }

  // An id a chat gave: a string, not empty, and not longer than any is.
  private static asId(value: unknown): string | undefined {
    return typeof value === "string" &&
      value &&
      value.length <= MAX_PENDING_MESSAGE_ID_LENGTH
      ? value
      : undefined;
  }

  private static parseAgain(
    value: unknown,
  ): WorkspaceConnectRequestAgain | undefined {
    const again: JSONObject | undefined =
      WorkspaceConnectRequest.asObject(value);

    if (!again) {
      return undefined;
    }

    const kind: WorkspaceConnectRequestAgainKind = again[
      "kind"
    ] as WorkspaceConnectRequestAgainKind;

    if (
      !(
        Object.values(WorkspaceConnectRequestAgainKind) as Array<string>
      ).includes(kind)
    ) {
      return undefined;
    }

    const label: string | undefined = WorkspaceConnectRequest.asString(
      again["label"],
    );

    return label ? { kind: kind, label: label } : { kind: kind };
  }

  private static asObject(value: unknown): JSONObject | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : undefined;
  }

  private static asString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
  }

  // The object without its empty entries.
  private static compact(values: {
    [key: string]: string | undefined;
  }): JSONObject {
    const compacted: JSONObject = {};

    for (const [key, value] of Object.entries(values)) {
      if (value) {
        compacted[key] = value;
      }
    }

    return compacted;
  }

  private static hash(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
