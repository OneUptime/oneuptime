import SecurityUserErasureRequest from "../../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import {
  DETECTION_TURN_SETTLE_MS,
  RETRY_BACKOFF_MS,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import {
  SecurityUserErasureFindingsPass,
  SecurityUserErasureProgress,
  toStoredErasureProgress,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureProgress";
import { getErasureProgressLine } from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureProgressLine";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityUserErasureRequestStatus } from "../../../../../Types/SecurityEvent/SecurityUserErasure";
import {
  SecurityUserErasureProgressLine,
  SecurityUserErasureStage,
} from "../../../../../Types/SecurityEvent/SecurityUserErasureProgressLine";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW FAR AN ERASURE REQUEST HAS GOT, AS ITS PAGE SAYS IT (#11232): the one
 * line worked out of what the worker keeps (SecurityUserErasureProgress) and
 * the request's state - the step it is at, the pass of the Detection
 * Findings and the time of the last one read, when the final check or the
 * next try starts - never the finding's id the worker's cursor holds.
 */

const NOW: Date = new Date("2026-11-27T10:00:00.000Z");
const FINDING_ID: string = "6b3e1f40-1c2d-4e8f-9a61-7d0c2b4e6f99";
// A finding written at 2026-11-24T16:00:00.123Z, as the cursor keeps its time.
const CURSOR_TIME: string = "1764000000123456789";

function pass(
  overrides: Partial<SecurityUserErasureFindingsPass> = {},
): SecurityUserErasureFindingsPass {
  return {
    number: 1,
    startedAt: "2026-11-27T09:58:00.000Z",
    after: { time: CURSOR_TIME, id: FINDING_ID },
    changed: 4,
    unnamed: 4,
    isFinal: false,
    endedAt: null,
    ...overrides,
  };
}

function progress(
  overrides: Partial<SecurityUserErasureProgress> = {},
): SecurityUserErasureProgress {
  return {
    toldAt: "2026-11-27T09:58:00.000Z",
    namedEvents: 3,
    cleanSince: null,
    unnamedFindings: 0,
    findings: null,
    ...overrides,
  };
}

function erasing(
  fields: Partial<Record<string, unknown>> = {},
  kept?: SecurityUserErasureProgress | undefined,
): SecurityUserErasureRequest {
  return Object.assign(new SecurityUserErasureRequest(), {
    id: new ObjectID("11232000-0000-4000-8000-0000000000b1"),
    status: SecurityUserErasureRequestStatus.InProgress,
    attempts: 0,
    updatedAt: new Date("2026-11-27T09:59:00.000Z"),
    ...(kept ? { progress: toStoredErasureProgress(kept) } : {}),
    ...fields,
  });
}

function lineOf(
  request: SecurityUserErasureRequest,
  now: Date = NOW,
): SecurityUserErasureProgressLine | null {
  return getErasureProgressLine(request, now);
}

describe("the line of an erasure request", () => {
  test("Queued: no step yet", () => {
    expect(
      lineOf(erasing({ status: SecurityUserErasureRequestStatus.Pending })),
    ).toEqual({
      requestId: "11232000-0000-4000-8000-0000000000b1",
      status: SecurityUserErasureRequestStatus.Pending,
      stage: null,
    });
  });

  test("none for a request that is over, or that names none", () => {
    for (const status of [
      SecurityUserErasureRequestStatus.Completed,
      SecurityUserErasureRequestStatus.Failed,
    ]) {
      expect(lineOf(erasing({ status }))).toBeNull();
    }

    expect(lineOf(erasing({ id: undefined }))).toBeNull();
  });

  test("claimed, with nothing kept yet: starting", () => {
    expect(lineOf(erasing())?.stage).toBe(SecurityUserErasureStage.Starting);
  });

  test("told, and not yet reading the findings: waiting for the changes to be applied", () => {
    expect(lineOf(erasing({}, progress()))).toEqual({
      requestId: "11232000-0000-4000-8000-0000000000b1",
      status: SecurityUserErasureRequestStatus.InProgress,
      stage: SecurityUserErasureStage.Applying,
    });
  });

  test("reading the findings: which pass, and the time of the last one read", () => {
    expect(
      lineOf(erasing({}, progress({ findings: pass({ number: 2 }) }))),
    ).toEqual({
      requestId: "11232000-0000-4000-8000-0000000000b1",
      status: SecurityUserErasureRequestStatus.InProgress,
      stage: SecurityUserErasureStage.ReadingFindings,
      pass: 2,
      readUpTo: new Date(1764000000123).toISOString(),
    });
  });

  test("a pass that has read nothing yet says no time", () => {
    const line: SecurityUserErasureProgressLine | null = lineOf(
      erasing({}, progress({ findings: pass({ after: null }) })),
    );

    expect(line?.stage).toBe(SecurityUserErasureStage.ReadingFindings);
    expect(line?.pass).toBe(1);
    expect(line).not.toHaveProperty("readUpTo");
  });

  test("the final pass: checking that nothing is left", () => {
    expect(
      lineOf(
        erasing(
          {},
          progress({
            cleanSince: "2026-11-27T09:40:00.000Z",
            findings: pass({ number: 3, isFinal: true }),
          }),
        ),
      ),
    ).toEqual(
      expect.objectContaining({
        stage: SecurityUserErasureStage.FinalCheck,
        pass: 3,
        readUpTo: new Date(1764000000123).toISOString(),
      }),
    );
  });

  test("a pass done while the changes are still being applied: waiting for them", () => {
    expect(
      lineOf(
        erasing(
          {},
          progress({ findings: pass({ endedAt: "2026-11-27T09:59:00.000Z" }) }),
        ),
      )?.stage,
    ).toBe(SecurityUserErasureStage.Applying);
  });

  test("every change applied: when the final check starts, once no detection that read the name can still run", () => {
    const cleanSince: string = "2026-11-27T09:55:00.000Z";

    expect(
      lineOf(
        erasing(
          {},
          progress({
            cleanSince,
            findings: pass({ endedAt: "2026-11-27T09:59:00.000Z" }),
          }),
        ),
      ),
    ).toEqual({
      requestId: "11232000-0000-4000-8000-0000000000b1",
      status: SecurityUserErasureRequestStatus.InProgress,
      stage: SecurityUserErasureStage.WaitingForFinalCheck,
      finalCheckAt: new Date(
        new Date(cleanSince).getTime() + DETECTION_TURN_SETTLE_MS,
      ).toISOString(),
    });
  });

  test("a time it waits for that has passed reads as now: the next run gets to it", () => {
    expect(
      lineOf(
        erasing(
          {},
          progress({
            cleanSince: "2026-11-27T09:00:00.000Z",
            findings: pass({ endedAt: "2026-11-27T09:59:00.000Z" }),
          }),
        ),
      )?.finalCheckAt,
    ).toBe(NOW.toISOString());
  });

  test("its last run failed: when it tries again, a wait longer for each failed run, and why", () => {
    const updatedAt: Date = new Date("2026-11-27T09:55:00.000Z");

    expect(
      lineOf(
        erasing(
          {
            attempts: 2,
            updatedAt,
            failureReason: "  ClickHouse did not answer in time.  ",
          },
          progress({ findings: pass() }),
        ),
      ),
    ).toEqual({
      requestId: "11232000-0000-4000-8000-0000000000b1",
      status: SecurityUserErasureRequestStatus.InProgress,
      stage: SecurityUserErasureStage.Retrying,
      retryAt: new Date(
        updatedAt.getTime() + 2 * RETRY_BACKOFF_MS,
      ).toISOString(),
      failureReason: "ClickHouse did not answer in time.",
    });

    // Its wait over: the next run tries again.
    expect(
      lineOf(
        erasing({
          attempts: 1,
          updatedAt: new Date("2026-11-27T08:00:00.000Z"),
          failureReason: "Lost.",
        }),
      )?.retryAt,
    ).toBe(NOW.toISOString());
  });

  test("a cursor whose time is no finding's reads as no time", () => {
    for (const time of ["", "soon", "-1", "1".repeat(21)]) {
      expect(
        lineOf(
          erasing(
            {},
            progress({ findings: pass({ after: { time, id: FINDING_ID } }) }),
          ),
        ),
      ).not.toHaveProperty("readUpTo");
    }
  });

  test("never the finding's id, a count of what named the person, or anything of the worker's own", () => {
    const lines: Array<SecurityUserErasureProgressLine | null> = [
      lineOf(erasing({}, progress({ findings: pass() }))),
      lineOf(erasing({}, progress({ findings: pass({ isFinal: true }) }))),
      lineOf(
        erasing(
          {},
          progress({
            cleanSince: "2026-11-27T09:55:00.000Z",
            findings: pass({ endedAt: "2026-11-27T09:59:00.000Z" }),
          }),
        ),
      ),
    ];

    for (const line of lines) {
      const text: string = JSON.stringify(line);

      expect(text).not.toContain(FINDING_ID);
      expect(text).not.toContain(CURSOR_TIME);
      expect(Object.keys(line || {}).sort()).toEqual(
        expect.not.arrayContaining([
          "after",
          "changed",
          "unnamed",
          "namedEvents",
          "toldAt",
          "cleanSince",
        ]),
      );
    }
  });
});
