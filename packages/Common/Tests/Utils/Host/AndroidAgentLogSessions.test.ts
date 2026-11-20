import AndroidAgentLogSessions, {
  CANCELLED_MESSAGE,
  DEVICE_SILENT_WHILE_COLLECTING_MESSAGE,
  DEVICE_SILENT_WHILE_REQUESTED_MESSAGE,
  DeviceLogSessionChange,
  DeviceLogSessionRequest,
  MAX_REPORTED_SESSIONS,
  MAX_STATUS_MESSAGE_LENGTH,
  NOBODY_ALLOWED_MESSAGE,
} from "../../../Utils/Host/AndroidAgentLogSessions";
import HostLogSessionUtil, {
  HOST_LOG_SESSION_ACTIVE_STATUSES,
  HOST_LOG_SESSION_ATTRIBUTE,
  HOST_LOG_SESSION_DURATIONS,
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "../../../Types/Host/HostLogSession";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #9806: what the OneUptime Android agent and OneUptime say to each
 * other about log sessions. The agent's side is Kotlin
 * (agents/AndroidAgent logsession/LogSessionClient.kt and LogSession.kt), so
 * the words both read - the statuses, the levels, the route, the attribute
 * that tags a session's lines - are checked against its source here.
 */

const SESSION_ID: string = "3f2a1b0c-0000-4000-8000-0000000000aa";

const NOW: Date = new Date("2026-11-19T10:00:00.000Z");

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

const AGENT: string = path.resolve(
  __dirname,
  "../../../../../agents/AndroidAgent/app/src/main/java/com/oneuptime/androidagent",
);

function agentSource(file: string): string {
  return fs.readFileSync(path.join(AGENT, file), "utf8");
}

describe("the words the agent and OneUptime share", () => {
  test("every status the agent says is one OneUptime reads, and the other way round", () => {
    const kotlin: string = agentSource("logsession/LogSession.kt");
    const wire: Array<string> = Array.from(
      kotlin.matchAll(/^\s+[A-Z_]+\("([A-Za-z]+)"\),?$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(wire.sort()).toEqual(
      (Object.values(HostLogSessionStatus) as Array<string>).sort(),
    );
  });

  test("the route is where the agent asks, beside OTLP", () => {
    const kotlin: string = agentSource("logsession/LogSessionClient.kt");

    expect(kotlin).toContain(
      'const val PATH: String = "/telemetry/android-agent/v1/log-sessions"',
    );
  });

  test("a session's lines carry the attribute OneUptime finds them by", () => {
    const kotlin: string = agentSource("logs/LogcatCollector.kt");

    expect(kotlin).toContain(`"${HOST_LOG_SESSION_ATTRIBUTE}"`);
  });

  test("the agent runs a session as long as the longest OneUptime offers", () => {
    const kotlin: string = agentSource("logsession/LogSessionManager.kt");
    const longest: number = Math.max(...HOST_LOG_SESSION_DURATIONS);

    expect(kotlin).toContain(
      `const val MAX_DURATION_MINUTES: Int = ${longest}`,
    );
  });
});

describe("a device moves a session on, never back", () => {
  test("waiting, starting, collecting, then one of the ends", () => {
    expect(
      HostLogSessionUtil.canDeviceMove(
        HostLogSessionStatus.Requested,
        HostLogSessionStatus.AwaitingApproval,
      ),
    ).toBe(true);
    expect(
      HostLogSessionUtil.canDeviceMove(
        HostLogSessionStatus.AwaitingApproval,
        HostLogSessionStatus.Collecting,
      ),
    ).toBe(true);
    expect(
      HostLogSessionUtil.canDeviceMove(
        HostLogSessionStatus.Collecting,
        HostLogSessionStatus.Ended,
      ),
    ).toBe(true);
    expect(
      HostLogSessionUtil.canDeviceMove(
        HostLogSessionStatus.Requested,
        HostLogSessionStatus.Unavailable,
      ),
    ).toBe(true);
  });

  test("a late report never takes a session back, nor reopens one that is over", () => {
    expect(
      HostLogSessionUtil.canDeviceMove(
        HostLogSessionStatus.Collecting,
        HostLogSessionStatus.AwaitingApproval,
      ),
    ).toBe(false);
    expect(
      HostLogSessionUtil.canDeviceMove(
        HostLogSessionStatus.Collecting,
        HostLogSessionStatus.Collecting,
      ),
    ).toBe(false);

    for (const over of [
      HostLogSessionStatus.Cancelled,
      HostLogSessionStatus.Ended,
      HostLogSessionStatus.Expired,
      HostLogSessionStatus.Declined,
      HostLogSessionStatus.Unavailable,
    ]) {
      expect(
        HostLogSessionUtil.canDeviceMove(over, HostLogSessionStatus.Collecting),
      ).toBe(false);
      expect(
        HostLogSessionUtil.canDeviceMove(over, HostLogSessionStatus.Ended),
      ).toBe(false);
    }
  });

  test("Requested and Cancelled are OneUptime's words, never the device's", () => {
    for (const from of HOST_LOG_SESSION_ACTIVE_STATUSES) {
      expect(
        HostLogSessionUtil.canDeviceMove(from, HostLogSessionStatus.Cancelled),
      ).toBe(false);
      expect(
        HostLogSessionUtil.canDeviceMove(from, HostLogSessionStatus.Requested),
      ).toBe(false);
    }
  });
});

describe("reading the agent's request", () => {
  test("a request as the agent writes it", () => {
    const request: DeviceLogSessionRequest | null =
      AndroidAgentLogSessions.parseRequest({
        hostName: " store-0412-kiosk-02 ",
        androidApiLevel: 34,
        agentVersion: "1.2.0",
        canSendLogs: true,
        sessions: [
          {
            id: SESSION_ID,
            status: "Collecting",
            startedAt: "2026-11-19T09:58:00Z",
            endsAt: "2026-11-19T10:28:00Z",
          },
        ],
      });

    expect(request).toEqual({
      hostName: "store-0412-kiosk-02",
      androidApiLevel: 34,
      agentVersion: "1.2.0",
      canSendLogs: true,
      reports: [
        {
          id: new ObjectID(SESSION_ID),
          status: HostLogSessionStatus.Collecting,
          statusMessage: undefined,
          startedAt: new Date("2026-11-19T09:58:00Z"),
          endsAt: new Date("2026-11-19T10:28:00Z"),
        },
      ],
    });
  });

  test("no host name, or not an object, is not a request", () => {
    expect(AndroidAgentLogSessions.parseRequest(null)).toBeNull();
    expect(AndroidAgentLogSessions.parseRequest([])).toBeNull();
    expect(AndroidAgentLogSessions.parseRequest("hostName")).toBeNull();
    expect(AndroidAgentLogSessions.parseRequest({ sessions: [] })).toBeNull();
    expect(AndroidAgentLogSessions.parseRequest({ hostName: "  " })).toBeNull();
    expect(
      AndroidAgentLogSessions.parseRequest({ hostName: "a".repeat(256) }),
    ).toBeNull();
  });

  test("a report that cannot be read is left out, the rest kept", () => {
    const request: DeviceLogSessionRequest | null =
      AndroidAgentLogSessions.parseRequest({
        hostName: "kiosk",
        sessions: [
          { id: "not-an-id", status: "Ended" },
          { id: SESSION_ID, status: "Finished" },
          { id: SESSION_ID },
          "Ended",
          { id: SESSION_ID, status: "Ended", startedAt: "yesterday" },
        ],
      });

    expect(request?.reports).toEqual([
      {
        id: new ObjectID(SESSION_ID),
        status: HostLogSessionStatus.Ended,
        statusMessage: undefined,
        startedAt: undefined,
        endsAt: undefined,
      },
    ]);
  });

  test("a status message is cut to what OneUptime keeps, and only so many reports are read", () => {
    const sessions: Array<JSONObject> = [];

    for (let index: number = 0; index < MAX_REPORTED_SESSIONS + 5; index++) {
      sessions.push({
        id: SESSION_ID,
        status: "Declined",
        statusMessage: "x".repeat(MAX_STATUS_MESSAGE_LENGTH + 100),
      });
    }

    const request: DeviceLogSessionRequest | null =
      AndroidAgentLogSessions.parseRequest({ hostName: "kiosk", sessions });

    expect(request?.reports).toHaveLength(MAX_REPORTED_SESSIONS);
    expect(request?.reports[0]?.statusMessage).toHaveLength(
      MAX_STATUS_MESSAGE_LENGTH,
    );
  });
});

describe("what a device's report makes of a session", () => {
  test("collecting: when it started and when it ends", () => {
    const change: DeviceLogSessionChange | null =
      AndroidAgentLogSessions.changeFromReport({
        row: { status: HostLogSessionStatus.AwaitingApproval },
        report: {
          id: new ObjectID(SESSION_ID),
          status: HostLogSessionStatus.Collecting,
          startedAt: minutesFromNow(-1),
          endsAt: minutesFromNow(29),
        },
        now: NOW,
      });

    expect(change).toEqual({
      status: HostLogSessionStatus.Collecting,
      statusMessage: undefined,
      startedAt: minutesFromNow(-1),
      endsAt: minutesFromNow(29),
    });
  });

  test("an end past the longest session is not believed", () => {
    const change: DeviceLogSessionChange | null =
      AndroidAgentLogSessions.changeFromReport({
        row: { status: HostLogSessionStatus.Starting },
        report: {
          id: new ObjectID(SESSION_ID),
          status: HostLogSessionStatus.Collecting,
          startedAt: NOW,
          endsAt: minutesFromNow(60 * 24),
        },
        now: NOW,
      });

    expect(change?.endsAt).toEqual(minutesFromNow(241));
  });

  test("an ending keeps the agent's reason and when OneUptime learned it", () => {
    const change: DeviceLogSessionChange | null =
      AndroidAgentLogSessions.changeFromReport({
        row: { status: HostLogSessionStatus.Starting },
        report: {
          id: new ObjectID(SESSION_ID),
          status: HostLogSessionStatus.Declined,
          statusMessage:
            "Android's prompt to allow access to all device logs was declined.",
        },
        now: NOW,
      });

    expect(change).toEqual({
      status: HostLogSessionStatus.Declined,
      statusMessage:
        "Android's prompt to allow access to all device logs was declined.",
      endedAt: NOW,
    });
  });

  test("a cancelled session stays cancelled whatever the device reports late", () => {
    expect(
      AndroidAgentLogSessions.changeFromReport({
        row: { status: HostLogSessionStatus.Cancelled },
        report: {
          id: new ObjectID(SESSION_ID),
          status: HostLogSessionStatus.Collecting,
        },
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("a session the device stopped telling OneUptime about", () => {
  test("a request the device never fetched expires, saying so", () => {
    expect(
      AndroidAgentLogSessions.staleChange({
        row: {
          status: HostLogSessionStatus.Requested,
          expiresAt: minutesFromNow(-11),
        },
        now: NOW,
      }),
    ).toEqual({
      status: HostLogSessionStatus.Expired,
      statusMessage: DEVICE_SILENT_WHILE_REQUESTED_MESSAGE,
      endedAt: NOW,
    });
  });

  test("a request nobody allowed expires", () => {
    expect(
      AndroidAgentLogSessions.staleChange({
        row: {
          status: HostLogSessionStatus.AwaitingApproval,
          expiresAt: minutesFromNow(-11),
        },
        now: NOW,
      })?.statusMessage,
    ).toBe(NOBODY_ALLOWED_MESSAGE);
  });

  test("the device has a few minutes past the end to say how it went", () => {
    expect(
      AndroidAgentLogSessions.staleChange({
        row: {
          status: HostLogSessionStatus.AwaitingApproval,
          expiresAt: minutesFromNow(-5),
        },
        now: NOW,
      }),
    ).toBeNull();
    expect(
      AndroidAgentLogSessions.staleChange({
        row: {
          status: HostLogSessionStatus.Collecting,
          endsAt: minutesFromNow(-5),
        },
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a session well past its end with no word from the device ended without it", () => {
    expect(
      AndroidAgentLogSessions.staleChange({
        row: {
          status: HostLogSessionStatus.Collecting,
          endsAt: minutesFromNow(-11),
        },
        now: NOW,
      }),
    ).toEqual({
      status: HostLogSessionStatus.Ended,
      statusMessage: DEVICE_SILENT_WHILE_COLLECTING_MESSAGE,
      endedAt: NOW,
    });
  });

  test("a session that is over is left as it is", () => {
    expect(
      AndroidAgentLogSessions.staleChange({
        row: {
          status: HostLogSessionStatus.Cancelled,
          expiresAt: minutesFromNow(-600),
        },
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("the answer the device reads", () => {
  test("each session as LogSessionClient.parseSessions reads it", () => {
    expect(
      AndroidAgentLogSessions.toAnswer([
        {
          id: SESSION_ID,
          status: HostLogSessionStatus.Requested,
          durationMinutes: 30,
          minimumLevel: HostLogSessionLevel.Debug,
          requestedAt: NOW,
          requestedByName: "Dana Reyes",
          expiresAt: minutesFromNow(60),
        },
        {
          id: SESSION_ID,
          status: HostLogSessionStatus.Cancelled,
          durationMinutes: 15,
          minimumLevel: HostLogSessionLevel.Info,
        },
      ]),
    ).toEqual({
      sessions: [
        {
          id: SESSION_ID,
          status: "Requested",
          durationMinutes: 30,
          minimumLevel: "debug",
          requestedAt: "2026-11-19T10:00:00.000Z",
          requestedByName: "Dana Reyes",
          expiresAt: "2026-11-19T11:00:00.000Z",
        },
        {
          id: SESSION_ID,
          status: "Cancelled",
          durationMinutes: 15,
          minimumLevel: "info",
        },
      ],
    });
  });

  test("the agent reads each key the answer has", () => {
    const kotlin: string = agentSource("logsession/LogSessionClient.kt");

    for (const key of [
      "id",
      "status",
      "durationMinutes",
      "minimumLevel",
      "requestedAt",
      "requestedByName",
      "note",
      "expiresAt",
    ]) {
      expect(kotlin).toContain(`"${key}"`);
    }
    expect(CANCELLED_MESSAGE).toMatch(/\.$/);
  });

  test("a session with a note tells it, and one without says nothing of a note (#9966)", () => {
    expect(
      AndroidAgentLogSessions.toAnswer([
        {
          id: SESSION_ID,
          status: HostLogSessionStatus.Requested,
          durationMinutes: 30,
          minimumLevel: HostLogSessionLevel.Info,
          note: "Checking why the payment app crashes after 6pm",
        },
        {
          id: SESSION_ID,
          status: HostLogSessionStatus.Requested,
          durationMinutes: 30,
          minimumLevel: HostLogSessionLevel.Info,
          note: "",
        },
      ]),
    ).toEqual({
      sessions: [
        {
          id: SESSION_ID,
          status: "Requested",
          durationMinutes: 30,
          minimumLevel: "info",
          note: "Checking why the payment app crashes after 6pm",
        },
        {
          id: SESSION_ID,
          status: "Requested",
          durationMinutes: 30,
          minimumLevel: "info",
        },
      ],
    });
  });

  test("the agent shows the note only as it would send text itself (LogSessionNote)", () => {
    const kotlin: string = agentSource("logsession/LogSessionNote.kt");

    expect(kotlin).toContain("Redactor.redact(");
    expect(kotlin).toContain("const val MAX_LENGTH: Int = 500");
  });
});
