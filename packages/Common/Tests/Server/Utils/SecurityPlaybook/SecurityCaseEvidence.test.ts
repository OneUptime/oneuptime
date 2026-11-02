import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import SecurityCaseEvidence, {
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
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT A CASE'S REQUESTS LEFT BEHIND, as the Preserve the evidence and Fix
 * the code with AI steps read it: the requests behind the events that name
 * what the case names (or that are behind its detections) over the time it
 * was detected in, only those that carry a trace or a session, one row a
 * request, the latest first; the session replays of those sessions; the
 * exceptions they threw; and where each opens in the Dashboard.
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
    expect(Object.values(built.query_params)).toContain(PROJECT_ID.toString());
    expect(Object.values(built.query_params)).toContainEqual(["203.0.113.9"]);
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
    expect(Object.values(built.query_params)).toContain(PROJECT_ID.toString());

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

/*
 * The exceptions the case's requests threw. A request names its exception
 * by its occurrence's fingerprint, which a merged exception's occurrences
 * keep: the lookup leaves the merged row out and reads the rows of the
 * survivor's fingerprint, and what was merged into what says which of
 * those the request's exception went into. Postgres is mocked.
 */
describe("the exceptions a case's requests threw", () => {
  const SURVIVOR_ID: string = "5a5a5a5a-0000-4000-8000-00000000000a";
  const OTHER_ID: string = "5a5a5a5a-0000-4000-8000-00000000000c";
  // Another service's exception that only shares the survivor's fingerprint.
  const LOOKALIKE_ID: string = "5a5a5a5a-0000-4000-8000-0000000000ff";

  let lookups: Array<FindBy<TelemetryException>>;
  let mergedReads: Array<FindBy<TelemetryException>>;

  function exceptionRow(id: string, fingerprint: string): TelemetryException {
    const row: TelemetryException = new TelemetryException();
    row._id = id;
    row.fingerprint = fingerprint;
    row.exceptionType = "TypeError";
    row.message = `thrown at ${fingerprint}`;
    row.isResolved = false;
    row.isArchived = false;
    return row;
  }

  function idsOf(exceptions: Array<TelemetryException>): Array<string> {
    return exceptions.map((exception: TelemetryException): string => {
      return exception.id!.toString();
    });
  }

  beforeEach(() => {
    lookups = [];
    mergedReads = [];

    jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
      findBy: FindBy<TelemetryException>,
    ) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;

      if ("mergedIntoTelemetryExceptionId" in query) {
        mergedReads.push(findBy);

        // fp-b's exception was merged into fp-a's.
        const merged: TelemetryException = new TelemetryException();
        merged.fingerprint = "fp-b";
        merged.mergedIntoTelemetryExceptionId = new ObjectID(SURVIVOR_ID);
        merged.mergedIntoTelemetryException = new TelemetryException();
        merged.mergedIntoTelemetryException.fingerprint = "fp-a";
        return [merged];
      }

      lookups.push(findBy);

      // As the lookup reads them: the merged row left out, fp-a's rows in.
      return [
        exceptionRow(LOOKALIKE_ID, "fp-a"),
        exceptionRow(SURVIVOR_ID, "fp-a"),
        exceptionRow(OTHER_ID, "fp-c"),
      ];
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a merged exception's request finds the exception it was merged into, and not another that only shares its fingerprint", async () => {
    const exceptions: Array<TelemetryException> =
      await SecurityCaseEvidence.findExceptions({
        projectId: PROJECT_ID,
        fingerprints: ["fp-b", "fp-c"],
      });

    expect(idsOf(exceptions)).toEqual([SURVIVOR_ID, OTHER_ID]);
  });

  test("each exception once, in the order of the fingerprints: the latest request's first", async () => {
    const exceptions: Array<TelemetryException> =
      await SecurityCaseEvidence.findExceptions({
        projectId: PROJECT_ID,
        // fp-a and fp-b are one exception now; fp-d is no exception.
        fingerprints: ["fp-c", "fp-b", "fp-d", "fp-a"],
      });

    expect(idsOf(exceptions)).toEqual([OTHER_ID, SURVIVOR_ID, LOOKALIKE_ID]);
  });

  test("reads the project's own, as OneUptime, with what the steps say of each", async () => {
    await SecurityCaseEvidence.findExceptions({
      projectId: PROJECT_ID,
      fingerprints: ["fp-b", "fp-c"],
    });

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.props).toEqual({ isRoot: true });
    expect(lookups[0]!.limit).toBe(10);
    expect((lookups[0]!.query as Record<string, unknown>)["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(lookups[0]!.select).toEqual({
      _id: true,
      fingerprint: true,
      exceptionType: true,
      message: true,
      isResolved: true,
      isArchived: true,
    });

    expect(mergedReads).toHaveLength(1);
    expect(
      (mergedReads[0]!.query as Record<string, unknown>)["projectId"],
    ).toBe(PROJECT_ID);
  });

  test("no fingerprint: nothing is read", async () => {
    expect(
      await SecurityCaseEvidence.findExceptions({
        projectId: PROJECT_ID,
        fingerprints: [],
      }),
    ).toEqual([]);
    expect(lookups).toHaveLength(0);
    expect(mergedReads).toHaveLength(0);
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
