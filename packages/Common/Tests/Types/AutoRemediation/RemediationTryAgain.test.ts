import {
  getRemediationTryAgainRefusal,
  parseRemediationTryAgainResult,
  REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS,
  REMEDIATION_TRY_AGAIN_REFUSALS,
  RemediationTryAgainRefusal,
  RemediationTryAgainResult,
  RemediationTryAgainSignal,
} from "../../../Types/AutoRemediation/RemediationTryAgain";
import { describe, expect, test } from "@jest/globals";

/*
 * Try again on the Remediation step (block 43): the answers the server and
 * the Dashboard share. The step says each refusal in the reader's language
 * from these very sentences, so they are pinned word for word, and every
 * refusal has one per kind of record.
 */

const REFUSALS: Array<RemediationTryAgainRefusal> = [
  RemediationTryAgainResult.Resolved,
  RemediationTryAgainResult.WaitingForInvestigation,
  RemediationTryAgainResult.FixInProgress,
  RemediationTryAgainResult.TooSoon,
  RemediationTryAgainResult.Busy,
];

const SIGNALS: Array<RemediationTryAgainSignal> = ["incident", "alert"];

describe("Try again's answers", () => {
  test("every answer but Evaluated is a refusal with a sentence per kind of record", () => {
    expect(Object.values(RemediationTryAgainResult).sort()).toEqual(
      [RemediationTryAgainResult.Evaluated, ...REFUSALS].sort(),
    );
    expect(Object.keys(REMEDIATION_TRY_AGAIN_REFUSALS).sort()).toEqual(
      [...REFUSALS].sort(),
    );

    for (const result of REFUSALS) {
      for (const signal of SIGNALS) {
        const sentence: string = getRemediationTryAgainRefusal({
          result,
          signal,
        });

        // One whole sentence that names the kind of record it is about.
        expect({ result, signal, sentence }).toEqual({
          result,
          signal,
          sentence: expect.stringMatching(/^[A-Z].*\.$/),
        });
        expect(sentence).toContain(signal);
        expect(sentence).not.toContain(
          signal === "incident" ? "alert" : "incident",
        );
      }
    }
  });

  test("the sentences, word for word", () => {
    expect(REMEDIATION_TRY_AGAIN_REFUSALS).toEqual({
      Resolved: {
        incident:
          "This incident is resolved, so OneUptime AI does not try to fix it.",
        alert:
          "This alert is resolved, so OneUptime AI does not try to fix it.",
      },
      WaitingForInvestigation: {
        incident:
          "OneUptime AI decides how to fix this incident as soon as its investigation is done.",
        alert:
          "OneUptime AI decides how to fix this alert as soon as its investigation is done.",
      },
      FixInProgress: {
        incident:
          "A fix for this incident is being worked out or waits for approval. Approve or dismiss it first.",
        alert:
          "A fix for this alert is being worked out or waits for approval. Approve or dismiss it first.",
      },
      TooSoon: {
        incident:
          "OneUptime AI has just checked this incident. Try again in a moment.",
        alert:
          "OneUptime AI has just checked this alert. Try again in a moment.",
      },
      Busy: {
        incident:
          "OneUptime AI is checking this incident right now. Try again in a moment.",
        alert:
          "OneUptime AI is checking this alert right now. Try again in a moment.",
      },
    });
  });

  test("a double click decides once, and nobody who just turned a setting on waits long", () => {
    expect(REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS).toBeGreaterThanOrEqual(10);
    expect(REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS).toBeLessThanOrEqual(60);
  });

  test("reads a result off the wire, and nothing it does not know", () => {
    for (const result of Object.values(RemediationTryAgainResult)) {
      expect(parseRemediationTryAgainResult(result)).toBe(result);
    }

    for (const value of [
      undefined,
      null,
      "",
      "evaluated",
      "Started",
      1,
      {},
      ["Evaluated"],
    ]) {
      expect(parseRemediationTryAgainResult(value)).toBeNull();
    }
  });
});
