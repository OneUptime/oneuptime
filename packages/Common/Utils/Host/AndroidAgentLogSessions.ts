import HostLogSessionUtil, {
  HOST_LOG_SESSION_SILENT_END_GRACE_MINUTES,
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "../../Types/Host/HostLogSession";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * What the OneUptime Android agent and OneUptime say to each other about log
 * sessions (#9806), every minute: POST
 * /telemetry/android-agent/v1/log-sessions with the device's Server
 * ingestion key. The agent sends its host name and what became of the
 * sessions it has; OneUptime answers with the sessions open for the device.
 * The agent's side is agents/AndroidAgent logsession/LogSessionClient.kt.
 *
 *   request:  { hostName, androidApiLevel, agentVersion, canSendLogs,
 *               sessions: [{ id, status, statusMessage?, startedAt?, endsAt? }] }
 *   answer:   { sessions: [{ id, status, durationMinutes, minimumLevel,
 *               requestedAt, requestedByName?, expiresAt? }] }
 *
 * Everything the device sends is read as untrusted: what cannot be read is
 * left out, and text is cut to what OneUptime keeps.
 */

// A device has a session or two at a time; more in one request is not a device's.
export const MAX_REPORTED_SESSIONS: number = 20;

// What OneUptime keeps of a status message (ColumnLength.LongText).
export const MAX_STATUS_MESSAGE_LENGTH: number = 500;

// The longest host.name OneUptime keeps.
export const MAX_HOST_NAME_LENGTH: number = 255;

/*
 * A session never runs longer than the longest one can be asked for, plus a
 * minute for the device's clock: an endsAt past that is not believed.
 */
const MAX_SESSION_MILLIS: number = (240 + 1) * 60 * 1000;

export interface DeviceLogSessionReport {
  id: ObjectID;
  status: HostLogSessionStatus;
  statusMessage?: string | undefined;
  startedAt?: Date | undefined;
  endsAt?: Date | undefined;
}

export interface DeviceLogSessionRequest {
  hostName: string;
  androidApiLevel?: number | undefined;
  agentVersion?: string | undefined;
  canSendLogs?: boolean | undefined;
  reports: Array<DeviceLogSessionReport>;
}

// A session as the device is told it.
export interface DeviceLogSession {
  id: string;
  status: HostLogSessionStatus;
  durationMinutes: number;
  minimumLevel: HostLogSessionLevel;
  requestedAt?: Date | undefined;
  requestedByName?: string | undefined;
  expiresAt?: Date | undefined;
}

// What a session's row becomes after the device's report, or nothing to change.
export interface DeviceLogSessionChange {
  status: HostLogSessionStatus;
  statusMessage?: string | undefined;
  startedAt?: Date | undefined;
  endsAt?: Date | undefined;
  endedAt?: Date | undefined;
}

// The parts of a session's row these rules read.
export interface LogSessionRow {
  status?: HostLogSessionStatus | undefined;
  createdAt?: Date | undefined;
  expiresAt?: Date | undefined;
  startedAt?: Date | undefined;
  endsAt?: Date | undefined;
  durationMinutes?: number | undefined;
}

export const DEVICE_SILENT_WHILE_REQUESTED_MESSAGE: string =
  "The device did not fetch it before it expired. It may be switched off or offline.";

export const NOBODY_ALLOWED_MESSAGE: string =
  "Nobody at the device allowed it in time.";

export const DEVICE_SILENT_WHILE_COLLECTING_MESSAGE: string =
  "The device stopped reporting before the session ended.";

export const CANCELLED_MESSAGE: string = "Cancelled in OneUptime.";

export default class AndroidAgentLogSessions {
  /*
   * The agent's request, or null when it is not one: no host name, or not a
   * JSON object. Reports that cannot be read are left out, the rest kept.
   */
  public static parseRequest(body: unknown): DeviceLogSessionRequest | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const json: JSONObject = body as JSONObject;
    const hostName: string =
      typeof json["hostName"] === "string" ? json["hostName"].trim() : "";

    if (!hostName || hostName.length > MAX_HOST_NAME_LENGTH) {
      return null;
    }

    const reports: Array<DeviceLogSessionReport> = [];
    const sessions: unknown = json["sessions"];

    if (Array.isArray(sessions)) {
      for (const session of sessions.slice(0, MAX_REPORTED_SESSIONS)) {
        const report: DeviceLogSessionReport | null =
          AndroidAgentLogSessions.parseReport(session);

        if (report) {
          reports.push(report);
        }
      }
    }

    const apiLevel: unknown = json["androidApiLevel"];
    const agentVersion: unknown = json["agentVersion"];
    const canSendLogs: unknown = json["canSendLogs"];

    return {
      hostName,
      androidApiLevel:
        typeof apiLevel === "number" && Number.isInteger(apiLevel)
          ? apiLevel
          : undefined,
      agentVersion:
        typeof agentVersion === "string"
          ? agentVersion.trim().slice(0, 50)
          : undefined,
      canSendLogs: typeof canSendLogs === "boolean" ? canSendLogs : undefined,
      reports,
    };
  }

  private static parseReport(value: unknown): DeviceLogSessionReport | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;
    const id: unknown = json["id"];
    const status: unknown = json["status"];

    if (typeof id !== "string" || !ObjectID.isValidUUID(id)) {
      return null;
    }

    if (!HostLogSessionUtil.isStatus(status)) {
      return null;
    }

    const message: unknown = json["statusMessage"];

    return {
      id: new ObjectID(id),
      status,
      statusMessage:
        typeof message === "string" && message.trim()
          ? message.trim().slice(0, MAX_STATUS_MESSAGE_LENGTH)
          : undefined,
      startedAt: AndroidAgentLogSessions.parseDate(json["startedAt"]),
      endsAt: AndroidAgentLogSessions.parseDate(json["endsAt"]),
    };
  }

  private static parseDate(value: unknown): Date | undefined {
    if (typeof value !== "string" || value.length > 40) {
      return undefined;
    }

    const date: Date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
  }

  /*
   * What the device's report makes of a session, or null when it changes
   * nothing: a session only moves on (HostLogSessionUtil.canDeviceMove), so
   * a late report never brings back one that ended or that OneUptime
   * cancelled.
   */
  public static changeFromReport(data: {
    row: LogSessionRow;
    report: DeviceLogSessionReport;
    now: Date;
  }): DeviceLogSessionChange | null {
    const from: HostLogSessionStatus | undefined = data.row.status;

    if (!from || !HostLogSessionUtil.canDeviceMove(from, data.report.status)) {
      return null;
    }

    const change: DeviceLogSessionChange = {
      status: data.report.status,
      statusMessage: data.report.statusMessage,
    };

    if (data.report.startedAt) {
      change.startedAt = data.report.startedAt;
    }

    if (data.report.endsAt) {
      const startedAt: Date =
        data.report.startedAt || data.row.startedAt || data.now;
      const endsAt: Date = data.report.endsAt;
      const longest: number = startedAt.getTime() + MAX_SESSION_MILLIS;

      change.endsAt =
        endsAt.getTime() > longest
          ? new Date(longest)
          : endsAt.getTime() < startedAt.getTime()
            ? startedAt
            : endsAt;
    }

    if (!HostLogSessionUtil.isActive(data.report.status)) {
      change.endedAt = data.now;
    }

    return change;
  }

  /*
   * A session the device has stopped telling OneUptime about, ended without
   * it: a request nobody allowed well after it expired, and a session past
   * its end with no word from the device. Null while the device may still
   * report it. The device decides everything else.
   */
  public static staleChange(data: {
    row: LogSessionRow;
    now: Date;
  }): DeviceLogSessionChange | null {
    const grace: number = HOST_LOG_SESSION_SILENT_END_GRACE_MINUTES * 60 * 1000;
    const now: number = data.now.getTime();
    const row: LogSessionRow = data.row;

    switch (row.status) {
      case HostLogSessionStatus.Requested:
      case HostLogSessionStatus.AwaitingApproval: {
        if (!row.expiresAt || now < row.expiresAt.getTime() + grace) {
          return null;
        }

        return {
          status: HostLogSessionStatus.Expired,
          statusMessage:
            row.status === HostLogSessionStatus.Requested
              ? DEVICE_SILENT_WHILE_REQUESTED_MESSAGE
              : NOBODY_ALLOWED_MESSAGE,
          endedAt: data.now,
        };
      }
      case HostLogSessionStatus.Starting:
      case HostLogSessionStatus.Collecting: {
        const durationMillis: number = (row.durationMinutes || 0) * 60 * 1000;
        const endsAt: number | undefined = row.endsAt
          ? row.endsAt.getTime()
          : row.expiresAt
            ? row.expiresAt.getTime() + durationMillis
            : undefined;

        if (endsAt === undefined || now < endsAt + grace) {
          return null;
        }

        return {
          status: HostLogSessionStatus.Ended,
          statusMessage: DEVICE_SILENT_WHILE_COLLECTING_MESSAGE,
          endedAt: data.now,
        };
      }
      default:
        return null;
    }
  }

  public static toAnswer(sessions: Array<DeviceLogSession>): JSONObject {
    return {
      sessions: sessions.map((session: DeviceLogSession): JSONObject => {
        const json: JSONObject = {
          id: session.id,
          status: session.status,
          durationMinutes: session.durationMinutes,
          minimumLevel: session.minimumLevel,
        };

        if (session.requestedAt) {
          json["requestedAt"] = session.requestedAt.toISOString();
        }

        if (session.requestedByName) {
          json["requestedByName"] = session.requestedByName;
        }

        if (session.expiresAt) {
          json["expiresAt"] = session.expiresAt.toISOString();
        }

        return json;
      }),
    };
  }
}
