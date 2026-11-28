import { JSONObject } from "../../../Types/JSON";
import { SecurityUserErasureRequestStatus } from "../../../Types/SecurityEvent/SecurityUserErasure";
import {
  SECURITY_USER_ERASURE_PROGRESS_PATH,
  SecurityUserErasureProgressLine,
  SecurityUserErasureStage,
  progressLineToJSON,
  progressLinesToJSON,
  readProgressLines,
} from "../../../Types/SecurityEvent/SecurityUserErasureProgressLine";
import { describe, expect, test } from "@jest/globals";

/*
 * The answer of POST /security-user-erasure-request/progress (#11232), as
 * the server writes it and the page reads it: one line for each open
 * request, read defensively - a line that names no request or a state the
 * page does not know is left out, a step it does not know reads as none.
 */

const READING: SecurityUserErasureProgressLine = {
  requestId: "11232000-0000-4000-8000-0000000000c1",
  status: SecurityUserErasureRequestStatus.InProgress,
  stage: SecurityUserErasureStage.ReadingFindings,
  pass: 2,
  readUpTo: "2026-11-24T16:00:00.123Z",
};

describe("the progress lines' answer", () => {
  test("is under the requests' own path", () => {
    expect(SECURITY_USER_ERASURE_PROGRESS_PATH).toBe(
      "/security-user-erasure-request/progress",
    );
  });

  test("reads back as it was written, for every step", () => {
    const lines: Array<SecurityUserErasureProgressLine> = [
      READING,
      {
        requestId: "q",
        status: SecurityUserErasureRequestStatus.Pending,
        stage: null,
      },
      {
        requestId: "w",
        status: SecurityUserErasureRequestStatus.InProgress,
        stage: SecurityUserErasureStage.WaitingForFinalCheck,
        finalCheckAt: "2026-11-27T10:12:30.000Z",
      },
      {
        requestId: "r",
        status: SecurityUserErasureRequestStatus.InProgress,
        stage: SecurityUserErasureStage.Retrying,
        retryAt: "2026-11-27T10:20:00.000Z",
        failureReason: "ClickHouse did not answer in time.",
      },
      ...[
        SecurityUserErasureStage.Starting,
        SecurityUserErasureStage.Applying,
        SecurityUserErasureStage.FinalCheck,
      ].map(
        (stage: SecurityUserErasureStage): SecurityUserErasureProgressLine => {
          return {
            requestId: stage,
            status: SecurityUserErasureRequestStatus.InProgress,
            stage,
          };
        },
      ),
    ];

    expect(
      readProgressLines(
        JSON.parse(JSON.stringify(progressLinesToJSON(lines))) as JSONObject,
      ),
    ).toEqual(lines);
  });

  test("writes only what a line says", () => {
    expect(progressLineToJSON(READING)).toEqual({
      requestId: READING.requestId,
      status: SecurityUserErasureRequestStatus.InProgress,
      stage: SecurityUserErasureStage.ReadingFindings,
      pass: 2,
      readUpTo: "2026-11-24T16:00:00.123Z",
    });
    expect(
      progressLineToJSON({
        requestId: "x",
        status: SecurityUserErasureRequestStatus.Pending,
        stage: null,
        failureReason: "",
      }),
    ).toEqual({
      requestId: "x",
      status: SecurityUserErasureRequestStatus.Pending,
      stage: null,
    });
  });

  test("leaves out a line that names no request or a state it does not know", () => {
    expect(
      readProgressLines({
        requests: [
          { status: SecurityUserErasureRequestStatus.Pending, stage: null },
          { requestId: "a", status: "Paused", stage: null },
          "not a line",
          null,
          [],
          { requestId: "b", status: SecurityUserErasureRequestStatus.Pending },
        ] as never,
      }),
    ).toEqual([
      {
        requestId: "b",
        status: SecurityUserErasureRequestStatus.Pending,
        stage: null,
      },
    ]);
  });

  test("a step, a pass or a time it does not know reads as none", () => {
    expect(
      readProgressLines({
        requests: [
          {
            requestId: "a",
            status: SecurityUserErasureRequestStatus.InProgress,
            stage: "napping",
            pass: 1.5,
            readUpTo: "not a time",
            finalCheckAt: 7,
            retryAt: "",
            failureReason: "   ",
          },
        ] as never,
      }),
    ).toEqual([
      {
        requestId: "a",
        status: SecurityUserErasureRequestStatus.InProgress,
        stage: null,
      },
    ]);

    for (const pass of [0, -1, "2"]) {
      expect(
        readProgressLines({
          requests: [
            {
              requestId: "a",
              status: SecurityUserErasureRequestStatus.InProgress,
              stage: SecurityUserErasureStage.ReadingFindings,
              pass,
            },
          ] as never,
        })[0],
      ).not.toHaveProperty("pass");
    }
  });

  test("an answer that is no answer has no lines", () => {
    for (const json of [
      undefined,
      null,
      {},
      { requests: "nope" },
      { requests: {} },
    ]) {
      expect(readProgressLines(json as JSONObject)).toEqual([]);
    }
  });
});
