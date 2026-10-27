import { describe, expect, test } from "@jest/globals";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import {
  EVIDENCE_WINDOW_PADDING_IN_HOURS,
  MAX_EVIDENCE_WINDOW_IN_DAYS,
  SESSION_LOOKBACK_IN_HOURS,
  SecurityCaseEvidenceLinks,
  SecurityCaseEvidenceWindow,
  SecurityCaseRequestEvidence,
  buildRequestEvidenceStatement,
  buildSessionReplayStatement,
  distinctValues,
  getEvidenceWindow,
  readRequestEvidenceRow,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityCaseEvidence";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT A CASE'S REQUESTS LEFT BEHIND, as the Preserve the evidence and Fix
 * the code with AI steps read it: the requests behind the events that name
 * what the case names (or that are behind its detections) over the time it
 * was detected in, only those that carry a trace or a session, one row a
 * request, the latest first; the session replays of those sessions; and
 * where each opens in the Dashboard.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1a2b3c4d-1a2b-41a2-81a2-1a2b3c4d5e6f",
);
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function caseDetected(first?: Date, last?: Date): SecurityCase {
  const model: SecurityCase = new SecurityCase();

  if (first) {
    model.firstDetectedAt = first;
  }

  if (last) {
    model.lastDetectedAt = last;
  }

  return model;
}

describe("the time a case's evidence is looked for over", () => {
  const now: Date = new Date("2026-10-27T12:00:00.000Z");

  test("from an hour before its first detection to an hour after its last", () => {
    const first: Date = new Date("2026-10-27T08:00:00.000Z");
    const last: Date = new Date("2026-10-27T09:00:00.000Z");
    const window: SecurityCaseEvidenceWindow = getEvidenceWindow(
      caseDetected(first, last),
      now,
    );

    expect(window.startTime.getTime()).toBe(
      first.getTime() - EVIDENCE_WINDOW_PADDING_IN_HOURS * HOUR,
    );
    expect(window.endTime.getTime()).toBe(
      last.getTime() + EVIDENCE_WINDOW_PADDING_IN_HOURS * HOUR,
    );
  });

  test("never past now", () => {
    const window: SecurityCaseEvidenceWindow = getEvidenceWindow(
      caseDetected(
        new Date("2026-10-27T11:30:00.000Z"),
        new Date("2026-10-27T11:50:00.000Z"),
      ),
      now,
    );

    expect(window.endTime.getTime()).toBe(now.getTime());
  });

  test("at most thirty days long, ending at its end", () => {
    const window: SecurityCaseEvidenceWindow = getEvidenceWindow(
      caseDetected(
        new Date("2025-01-01T00:00:00.000Z"),
        new Date("2026-10-27T10:00:00.000Z"),
      ),
      now,
    );

    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(
      MAX_EVIDENCE_WINDOW_IN_DAYS * DAY,
    );
  });

  test("a case with no detections yet looks around now", () => {
    const window: SecurityCaseEvidenceWindow = getEvidenceWindow(
      caseDetected(),
      now,
    );

    expect(window.endTime.getTime()).toBe(now.getTime());
    expect(window.startTime.getTime()).toBe(
      now.getTime() - EVIDENCE_WINDOW_PADDING_IN_HOURS * HOUR,
    );
  });
});

describe("distinct values", () => {
  test("trimmed, without blanks or repeats, at most the limit", () => {
    expect(
      distinctValues([" a ", "", undefined, null, "b", "a", "c"], 2),
    ).toEqual(["a", "b"]);
  });
});

describe("the requests behind a case", () => {
  const window: SecurityCaseEvidenceWindow = {
    startTime: new Date("2026-10-27T07:00:00.000Z"),
    endTime: new Date("2026-10-27T10:00:00.000Z"),
  };

  function statement(
    values: Array<string>,
    eventUids: Array<string>,
  ): Statement {
    return buildRequestEvidenceStatement({
      databaseName: "oneuptime",
      tableName: "SecurityEventItemV1",
      projectId: PROJECT_ID,
      values,
      eventUids,
      window,
      limit: 25,
    });
  }

  test("are the project's events in the window that carry a trace or a session, one row a request, latest first", () => {
    const built: Statement = statement(["203.0.113.9"], ["log:abc:0"]);
    const query: string = built.query;

    expect(query).toContain("FROM oneuptime.SecurityEventItemV1");
    expect(query).toContain("WHERE projectId = {p");
    expect(query).toContain("AND (traceId != '' OR sessionId != '')");
    expect(query).toContain("GROUP BY traceId, sessionId");
    expect(query).toContain("ORDER BY lastSeen DESC");
    expect(Object.values(built.query_params)).toContain(
      PROJECT_ID.toString(),
    );
    expect(Object.values(built.query_params)).toContainEqual([
      "203.0.113.9",
    ]);
    expect(Object.values(built.query_params)).toContain(
      "oneuptime.exception.fingerprint",
    );
  });

  test("name what the case names, or are behind its detections", () => {
    const both: string = statement(["alice"], ["uid-1"]).query;

    expect(both).toContain("hasAny(observables, {p");
    expect(both).toContain(" OR eventUid IN (");

    const onlyValues: string = statement(["alice"], []).query;

    expect(onlyValues).toContain("hasAny(observables, {p");
    expect(onlyValues).not.toContain("eventUid IN");

    const onlyUids: string = statement([], ["uid-1"]).query;

    expect(onlyUids).not.toContain("hasAny(observables");
    expect(onlyUids).toContain("eventUid IN (");
  });

  test("a row reads into what the request links to", () => {
    const evidence: SecurityCaseRequestEvidence = readRequestEvidenceRow({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sessionId: " session-1 ",
      exceptionFingerprint: "fp-1",
      requestOutcome: "Rejected",
      message: "SQL injection attempt: GET /x → 404",
      lastSeen: "2026-10-27 08:30:00.000000000",
    });

    expect(evidence).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sessionId: "session-1",
      exceptionFingerprint: "fp-1",
      requestOutcome: "Rejected",
      message: "SQL injection attempt: GET /x → 404",
      lastSeen: new Date("2026-10-27T08:30:00.000Z"),
    });
  });

  test("a row with nothing in it reads as nothing, not as 'undefined'", () => {
    expect(readRequestEvidenceRow({})).toEqual({
      traceId: "",
      spanId: "",
      sessionId: "",
      exceptionFingerprint: "",
      requestOutcome: "",
      message: "",
      lastSeen: null,
    });
  });
});

describe("the session replays of a case's sessions", () => {
  test("are read by session id from a day before the window, the project's only", () => {
    const window: SecurityCaseEvidenceWindow = {
      startTime: new Date("2026-10-27T07:00:00.000Z"),
      endTime: new Date("2026-10-27T10:00:00.000Z"),
    };
    const built: Statement = buildSessionReplayStatement({
      databaseName: "oneuptime",
      tableName: "RumSessionV1",
      projectId: PROJECT_ID,
      sessionIds: ["session-1", "session-2"],
      window,
    });

    expect(built.query).toContain(
      "SELECT sessionId, any(rumApplicationId) AS rumApplicationId FROM oneuptime.RumSessionV1",
    );
    expect(built.query).toContain("AND sessionId IN (");
    expect(built.query).toContain("GROUP BY sessionId");
    expect(Object.values(built.query_params)).toContain(
      PROJECT_ID.toString(),
    );

    const starts: Array<unknown> = Object.values(built.query_params).filter(
      (value: unknown): boolean => {
        return (
          typeof value === "string" &&
          value.startsWith(
            new Date(
              window.startTime.getTime() - SESSION_LOOKBACK_IN_HOURS * HOUR,
            )
              .toISOString()
              .slice(0, 10),
          )
        );
      },
    );

    expect(starts.length).toBeGreaterThan(0);
  });
});

describe("where the evidence opens", () => {
  const links: SecurityCaseEvidenceLinks = new SecurityCaseEvidenceLinks(
    URL.fromString("https://oneuptime.example/dashboard"),
    PROJECT_ID,
  );
  const base: string = `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}`;

  test("a trace, at its span when it has one", () => {
    expect(links.trace("abc").toString()).toBe(`${base}/traces/view/abc`);
    expect(links.trace("abc", "def").toString()).toBe(
      `${base}/traces/view/abc?spanId=def`,
    );
  });

  test("a session replay, an exception and its AI page, a runbook run and an announcement", () => {
    expect(links.sessionReplay("app-1", "session-1").toString()).toBe(
      `${base}/rum/app-1/session-replay/session-1`,
    );
    expect(links.exception("ex-1").toString()).toBe(`${base}/exceptions/ex-1`);
    expect(links.exceptionAiAssistance("ex-1").toString()).toBe(
      `${base}/exceptions/ex-1/ai-assistance`,
    );
    expect(links.runbookRun("rb-1", "run-1").toString()).toBe(
      `${base}/runbooks/rb-1/executions/run-1`,
    );
    expect(links.announcement("an-1").toString()).toBe(
      `${base}/status-pages/announcements/an-1`,
    );
  });

  test("an id that is not a word cannot add a path of its own", () => {
    expect(links.trace("../../settings").toString()).toBe(
      `${base}/traces/view/..%2F..%2Fsettings`,
    );
  });
});
