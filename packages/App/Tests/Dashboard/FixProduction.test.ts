import { describe, expect, test } from "@jest/globals";
import FixProductionCheck from "Common/Types/AI/FixProductionCheck";
import FixProductionStatus from "Common/Types/AI/FixProductionStatus";
import {
  FIX_PRODUCTION_LABELS,
  getFixProductionTone,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionAIAssistance";
import {
  FIX_PRODUCTION_CHECK_LABELS,
  getFixProductionLabel,
  getFixProductionVerdictTone,
} from "../../FeatureSet/Dashboard/src/Utils/FixProduction";

/*
 * The words for what production showed about a merged AI fix. Waiting for
 * the deploy and watching read alike for every fix; a verdict says what it
 * means for that kind of fix - an exception stopped, an operation made
 * faster, a monitor quiet, telemetry arriving - and its tone says at a
 * glance whether it worked.
 */

describe("FIX_PRODUCTION_CHECK_LABELS", () => {
  test("every check words every status", () => {
    for (const check of Object.values(FixProductionCheck)) {
      expect(Object.keys(FIX_PRODUCTION_CHECK_LABELS[check]).sort()).toEqual(
        Object.values(FixProductionStatus).sort(),
      );

      for (const status of Object.values(FixProductionStatus)) {
        expect(FIX_PRODUCTION_CHECK_LABELS[check][status].trim()).not.toBe("");
      }
    }
  });

  test("waiting, watching and not knowing read alike for every kind of fix", () => {
    for (const check of Object.values(FixProductionCheck)) {
      for (const status of [
        FixProductionStatus.AwaitingDeploy,
        FixProductionStatus.Watching,
        FixProductionStatus.Unverifiable,
      ]) {
        expect(FIX_PRODUCTION_CHECK_LABELS[check][status]).toBe(
          FIX_PRODUCTION_LABELS[status],
        );
      }
    }
  });

  test("a verdict says what it means for the kind of fix", () => {
    expect(
      Object.values(FixProductionCheck).map((check: FixProductionCheck) => {
        return [
          check,
          FIX_PRODUCTION_CHECK_LABELS[check][FixProductionStatus.Verified],
          FIX_PRODUCTION_CHECK_LABELS[check][FixProductionStatus.Regressed],
        ];
      }),
    ).toEqual([
      [
        FixProductionCheck.Exception,
        "Fixed in production",
        "Still happening after the fix",
      ],
      [
        FixProductionCheck.Performance,
        "Faster in production",
        "Still slow after the fix",
      ],
      [
        FixProductionCheck.Recurrence,
        "Fixed in production",
        "Happened again after the fix",
      ],
      [
        FixProductionCheck.Telemetry,
        "Arriving in production",
        "Telemetry stopped after the fix",
      ],
    ]);
  });
});

describe("getFixProductionLabel", () => {
  test("a verdict without a check is an exception fix's, the only kind watched before", () => {
    expect(
      getFixProductionLabel({ status: FixProductionStatus.Regressed }),
    ).toBe("Still happening after the fix");
  });

  test("a check picks its words", () => {
    expect(
      getFixProductionLabel({
        status: FixProductionStatus.Verified,
        check: FixProductionCheck.Performance,
      }),
    ).toBe("Faster in production");
  });
});

describe("getFixProductionVerdictTone", () => {
  test("worked is green, did not is red, unknown is gray, on its way is blue - for every kind", () => {
    for (const check of Object.values(FixProductionCheck)) {
      for (const status of Object.values(FixProductionStatus)) {
        expect(getFixProductionVerdictTone({ status, check })).toBe(
          getFixProductionTone(status),
        );
      }
    }

    expect(getFixProductionTone(FixProductionStatus.Verified)).toBe("success");
    expect(getFixProductionTone(FixProductionStatus.Regressed)).toBe("danger");
    expect(getFixProductionTone(FixProductionStatus.Unverifiable)).toBe(
      "neutral",
    );
    expect(getFixProductionTone(FixProductionStatus.Watching)).toBe("info");
  });
});
