import { describe, expect, test } from "@jest/globals";
import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import OneUptimeDate from "Common/Types/Date";
import { SecurityUserErasureRequestStatus } from "Common/Types/SecurityEvent/SecurityUserErasure";
import {
  SecurityUserErasureProgressLine,
  SecurityUserErasureStage,
} from "Common/Types/SecurityEvent/SecurityUserErasureProgressLine";
import { Translator } from "Common/Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  writeErasingLine,
  writeErasureStatusLine,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ErasureRequests/ErasureRequestCells";
import * as Copy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ErasureRequests/ErasureRequestCopy";

/*
 * HOW FAR AN ERASURE HAS GOT, UNDER ERASING (#11232), in every language the
 * Dashboard ships: the line each step of the worker's progress reads as -
 * the pass of the Detection Findings in the reader's digits, the time of
 * the last one read written by OneUptimeDate, when the final check or the
 * next try starts - and what the row says when the server has no line for
 * it. Never a finding's id: the line the page is handed has none.
 */

const NOW: Date = new Date("2026-11-27T10:00:00.000Z");
const READ_UP_TO: string = "2026-11-24T16:00:00.123Z";
const REQUEST_ID: string = "11232000-0000-4000-8000-0000000000d1";

function line(
  stage: SecurityUserErasureStage,
  fields: Partial<SecurityUserErasureProgressLine> = {},
): SecurityUserErasureProgressLine {
  return {
    requestId: REQUEST_ID,
    status: SecurityUserErasureRequestStatus.InProgress,
    stage,
    ...fields,
  };
}

function erasing(
  status: SecurityUserErasureRequestStatus = SecurityUserErasureRequestStatus.InProgress,
): SecurityUserErasureRequest {
  return Object.assign(new SecurityUserErasureRequest(), {
    _id: REQUEST_ID,
    status,
  });
}

const LINE_KEYS: ReadonlyArray<string> = [
  Copy.STARTING_LINE,
  Copy.READING_FINDINGS_LINE,
  Copy.READING_FINDINGS_STARTED_LINE,
  Copy.FINAL_CHECK_LINE,
  Copy.FINAL_CHECK_STARTED_LINE,
  Copy.FINAL_CHECK_STARTS_LINE,
  Copy.RETRYING_LINE,
  Copy.RETRYING_WITHOUT_REASON_LINE,
];

describe("the line under Erasing, in English", () => {
  const english: Translator = dashboardTranslator("en");
  const date: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(READ_UP_TO);

  test("each step says what the worker is doing", () => {
    expect(
      writeErasingLine(english, line(SecurityUserErasureStage.Starting), NOW),
    ).toBe("Taking them out of cases, detections and events.");
    expect(
      writeErasingLine(english, line(SecurityUserErasureStage.Applying), NOW),
    ).toBe(Copy.ERASING_LINE);
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.ReadingFindings, {
          pass: 1,
          readUpTo: READ_UP_TO,
        }),
        NOW,
      ),
    ).toBe(`Reading the Detection Findings: pass 1, up to ${date}.`);
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.ReadingFindings, { pass: 2 }),
        NOW,
      ),
    ).toBe("Reading the Detection Findings: pass 2.");
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.FinalCheck, {
          pass: 3,
          readUpTo: READ_UP_TO,
        }),
        NOW,
      ),
    ).toBe(`Checking that nothing is left, up to ${date}.`);
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.FinalCheck, { pass: 3 }),
        NOW,
      ),
    ).toBe("Checking that nothing is left.");
  });

  test("the final check: when it starts, never a time that has passed", () => {
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.WaitingForFinalCheck, {
          finalCheckAt: new Date(NOW.getTime() + 9 * 60 * 1000).toISOString(),
        }),
        NOW,
      ),
    ).toBe("The final check starts in 9\u00A0minutes.");
    // Passed, or about to: the worker's next run, within a minute.
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.WaitingForFinalCheck, {
          finalCheckAt: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
        }),
        NOW,
      ),
    ).toBe("The final check starts in a minute.");
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.WaitingForFinalCheck),
        NOW,
      ),
    ).toBeNull();
  });

  test("a run that failed: why, and when it tries again", () => {
    const retryAt: string = new Date(
      NOW.getTime() + 20 * 60 * 1000,
    ).toISOString();

    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.Retrying, {
          retryAt,
          failureReason: "ClickHouse did not answer in time.",
        }),
        NOW,
      ),
    ).toBe(
      "ClickHouse did not answer in time. It tries again in 20\u00A0minutes.",
    );
    expect(
      writeErasingLine(
        english,
        line(SecurityUserErasureStage.Retrying, { retryAt }),
        NOW,
      ),
    ).toBe("Its last run failed. It tries again in 20\u00A0minutes.");
  });

  test("no line, a line for another state, or a step it does not know: the row says it is waiting for the last of it", () => {
    for (const progress of [
      undefined,
      line(SecurityUserErasureStage.Starting, {
        status: SecurityUserErasureRequestStatus.Pending,
      }),
      { ...line(SecurityUserErasureStage.Applying), stage: null },
    ]) {
      expect(writeErasureStatusLine(english, erasing(), progress, NOW)).toBe(
        Copy.ERASING_LINE,
      );
    }
  });

  test("only a request that reads Erasing takes the line; the others say what they always said", () => {
    const reading: SecurityUserErasureProgressLine = line(
      SecurityUserErasureStage.ReadingFindings,
      { pass: 1, readUpTo: READ_UP_TO },
    );

    expect(
      writeErasureStatusLine(
        english,
        erasing(SecurityUserErasureRequestStatus.Pending),
        reading,
        NOW,
      ),
    ).toBe(Copy.QUEUED_LINE);
    expect(writeErasureStatusLine(english, erasing(), reading, NOW)).toContain(
      "Reading the Detection Findings",
    );
  });

  test("never the request's id, nor a finding's: the line names neither", () => {
    for (const stage of Object.values(SecurityUserErasureStage)) {
      const written: string | null = writeErasingLine(
        english,
        line(stage, {
          pass: 1,
          readUpTo: READ_UP_TO,
          finalCheckAt: NOW.toISOString(),
          retryAt: NOW.toISOString(),
        }),
        NOW,
      );

      expect(written || "").not.toContain(REQUEST_ID);
    }
  });
});

describe("the line under Erasing, in every language", () => {
  test("each line is worded in every language, keeping its placeholders", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const key of LINE_KEYS) {
        if (!isWordedInDashboardLocale(key, language)) {
          unworded.push(`${language}: ${key}`);
        }
      }
    }

    expect(unworded).toEqual([]);
  });

  test("each step reads in the reader's words, its pass in the reader's digits, nothing left to fill", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const written: Array<string | null> = [
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.Starting),
          NOW,
        ),
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.ReadingFindings, {
            pass: 2,
            readUpTo: READ_UP_TO,
          }),
          NOW,
        ),
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.ReadingFindings, { pass: 2 }),
          NOW,
        ),
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.FinalCheck, {
            pass: 2,
            readUpTo: READ_UP_TO,
          }),
          NOW,
        ),
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.FinalCheck, { pass: 2 }),
          NOW,
        ),
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.WaitingForFinalCheck, {
            finalCheckAt: new Date(NOW.getTime() + 9 * 60 * 1000).toISOString(),
          }),
          NOW,
        ),
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.Retrying, {
            retryAt: new Date(NOW.getTime() + 20 * 60 * 1000).toISOString(),
            failureReason: "Boom.",
          }),
          NOW,
        ),
        writeErasingLine(
          translator,
          line(SecurityUserErasureStage.Retrying, {
            retryAt: new Date(NOW.getTime() + 20 * 60 * 1000).toISOString(),
          }),
          NOW,
        ),
      ];

      for (const text of written) {
        expect({ language, text: text?.includes("{{") }).toEqual({
          language,
          text: false,
        });
        expect({ language, empty: !text }).toEqual({ language, empty: false });
      }

      // The pass, as the reader's language writes a number.
      expect({
        language,
        pass: (written[1] || "").includes(translator.formatNumber(2)),
      }).toEqual({ language, pass: true });
      expect({
        language,
        reason: (written[6] || "").includes("Boom."),
      }).toEqual({ language, reason: true });

      if (language !== "en") {
        // Not the English sentence: the reader's own words.
        expect({
          language,
          starting: written[0] === Copy.STARTING_LINE,
        }).toEqual({ language, starting: false });
      }
    }
  });

  test("Persian writes the pass in its own digits", () => {
    const persian: Translator = dashboardTranslator("fa");

    expect(
      writeErasingLine(
        persian,
        line(SecurityUserErasureStage.ReadingFindings, { pass: 2 }),
        NOW,
      ),
    ).toContain("۲");
  });
});

describe("which rows the page asks about, and when it reads the list again", () => {
  function requestOf(
    id: string,
    status: SecurityUserErasureRequestStatus | string,
  ): SecurityUserErasureRequest {
    return Object.assign(new SecurityUserErasureRequest(), {
      _id: id,
      status,
    });
  }

  test("the open rows a page shows: Queued and Erasing, by id, in the state shown", () => {
    expect(
      Array.from(
        Copy.getShownOpenRequests([
          requestOf("a", SecurityUserErasureRequestStatus.InProgress),
          requestOf("b", SecurityUserErasureRequestStatus.Pending),
          requestOf("c", SecurityUserErasureRequestStatus.Completed),
          requestOf("d", SecurityUserErasureRequestStatus.Failed),
          // A state the page does not know reads as Queued, as its pill does.
          requestOf("e", "Paused"),
          Object.assign(new SecurityUserErasureRequest(), {
            status: SecurityUserErasureRequestStatus.Pending,
          }),
        ]).entries(),
      ),
    ).toEqual([
      ["a", SecurityUserErasureRequestStatus.InProgress],
      ["b", SecurityUserErasureRequestStatus.Pending],
      ["e", SecurityUserErasureRequestStatus.Pending],
    ]);
  });

  test("the server's lines, by the request each is about", () => {
    const lines: Array<SecurityUserErasureProgressLine> = [
      line(SecurityUserErasureStage.Applying, { requestId: "a" }),
      line(SecurityUserErasureStage.Starting, { requestId: "b" }),
    ];

    expect(Array.from(Copy.getProgressById(lines).keys())).toEqual(["a", "b"]);
  });

  test("a row has moved on when the server says another state for it, or has no line for it", () => {
    const shown: Map<string, SecurityUserErasureRequestStatus> = new Map([
      ["a", SecurityUserErasureRequestStatus.InProgress],
      ["b", SecurityUserErasureRequestStatus.Pending],
    ]);
    const asShown: Map<string, SecurityUserErasureProgressLine> =
      Copy.getProgressById([
        line(SecurityUserErasureStage.Applying, { requestId: "a" }),
        {
          requestId: "b",
          status: SecurityUserErasureRequestStatus.Pending,
          stage: null,
        },
      ]);

    expect(Copy.hasShownRequestMovedOn(shown, asShown)).toBe(false);

    // Started since.
    expect(
      Copy.hasShownRequestMovedOn(
        shown,
        Copy.getProgressById([
          line(SecurityUserErasureStage.Applying, { requestId: "a" }),
          line(SecurityUserErasureStage.Starting, { requestId: "b" }),
        ]),
      ),
    ).toBe(true);

    // Done since: no line for it.
    expect(
      Copy.hasShownRequestMovedOn(
        shown,
        Copy.getProgressById([
          {
            requestId: "b",
            status: SecurityUserErasureRequestStatus.Pending,
            stage: null,
          },
        ]),
      ),
    ).toBe(true);

    // Nothing shown open: nothing moved on.
    expect(Copy.hasShownRequestMovedOn(new Map(), asShown)).toBe(false);
  });

  test("asks again twice a minute, as the worker moves a request on once a minute", () => {
    expect(Copy.ERASURE_PROGRESS_REFRESH_IN_MS).toBe(30 * 1000);
  });
});
