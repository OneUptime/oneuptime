import { describe, expect, test } from "@jest/globals";
import {
  OverviewSection,
  failSection,
  forbidSection,
  getLoadingSection,
  getSectionForSubject,
  resolveSection,
  shouldAttemptRead,
} from "../../FeatureSet/Dashboard/src/Utils/OverviewSection";

/*
 * Every supplementary read on the monitor overview is an OverviewSection.
 * These pin the two promises the page makes with them: a failed refresh
 * never throws away what already loaded, and a value never shows up on a
 * page for a different subject (monitor) than the one it was loaded for.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";

describe("OverviewSection", () => {
  test("starts loading, with no value and no subject", () => {
    expect(getLoadingSection<number>()).toEqual({
      status: "loading",
      value: null,
      error: "",
      refreshError: "",
      loadedFor: "",
    });
  });

  test("resolve stamps the subject", () => {
    expect(resolveSection({ value: [1, 2, 3], subjectId: MONITOR_A })).toEqual({
      status: "loaded",
      value: [1, 2, 3],
      error: "",
      refreshError: "",
      loadedFor: MONITOR_A,
    });
  });

  test("a failed refresh keeps the last value and records refreshError", () => {
    const loaded: OverviewSection<Array<number>> = resolveSection({
      value: [4, 5],
      subjectId: MONITOR_A,
    });

    const failed: OverviewSection<Array<number>> = failSection({
      previous: loaded,
      message: "Network error",
      subjectId: MONITOR_A,
    });

    expect(failed).toEqual({
      status: "loaded",
      value: [4, 5],
      error: "",
      refreshError: "Network error",
      loadedFor: MONITOR_A,
    });

    // A later success clears the refresh error.
    expect(
      resolveSection({ value: [6], subjectId: MONITOR_A }).refreshError,
    ).toBe("");
  });

  test("a failed first load has no value", () => {
    expect(
      failSection({
        previous: getLoadingSection<Array<number>>(),
        message: "Server error",
        subjectId: MONITOR_A,
      }),
    ).toEqual({
      status: "error",
      value: null,
      error: "Server error",
      refreshError: "",
      loadedFor: MONITOR_A,
    });
  });

  test("a failure never keeps another subject's value", () => {
    const loadedForA: OverviewSection<string> = resolveSection({
      value: "monitor A's probes",
      subjectId: MONITOR_A,
    });

    const failedForB: OverviewSection<string> = failSection({
      previous: loadedForA,
      message: "Timed out",
      subjectId: MONITOR_B,
    });

    expect(failedForB.status).toBe("error");
    expect(failedForB.value).toBeNull();
    expect(failedForB.loadedFor).toBe(MONITOR_B);
  });

  test("a failure after a forbidden or failed read stays an error", () => {
    expect(
      failSection({
        previous: forbidSection<number>({
          reason: "No access",
          subjectId: MONITOR_A,
        }),
        message: "Server error",
        subjectId: MONITOR_A,
      }).status,
    ).toBe("error");

    expect(
      failSection({
        previous: failSection<number>({
          previous: getLoadingSection<number>(),
          message: "first",
          subjectId: MONITOR_A,
        }),
        message: "second",
        subjectId: MONITOR_A,
      }),
    ).toEqual({
      status: "error",
      value: null,
      error: "second",
      refreshError: "",
      loadedFor: MONITOR_A,
    });
  });

  test("forbid carries the reason", () => {
    expect(
      forbidSection<number>({
        reason: "You need permission to read this monitor's status timeline.",
        subjectId: MONITOR_A,
      }),
    ).toEqual({
      status: "forbidden",
      value: null,
      error: "You need permission to read this monitor's status timeline.",
      refreshError: "",
      loadedFor: MONITOR_A,
    });
  });

  test("getSectionForSubject hides another monitor's value", () => {
    const loadedForA: OverviewSection<number> = resolveSection({
      value: 42,
      subjectId: MONITOR_A,
    });

    expect(getSectionForSubject(loadedForA, MONITOR_A)).toBe(loadedForA);

    const seenFromB: OverviewSection<number> = getSectionForSubject(
      loadedForA,
      MONITOR_B,
    );

    expect(seenFromB.status).toBe("loading");
    expect(seenFromB.value).toBeNull();

    // Forbidden and error sections are per subject too.
    expect(
      getSectionForSubject(
        forbidSection<number>({ reason: "No access", subjectId: MONITOR_A }),
        MONITOR_B,
      ).status,
    ).toBe("loading");
  });

  test("shouldAttemptRead: allowed → true, empty snapshot → true, definite denial → false", () => {
    expect(shouldAttemptRead({ isAllowed: true })).toBe(true);
    expect(
      shouldAttemptRead({ isAllowed: true, disabledReason: "ignored" }),
    ).toBe(true);

    // The gate could not decide: ask the server rather than assume no.
    expect(shouldAttemptRead({ isAllowed: false })).toBe(true);
    expect(
      shouldAttemptRead({ isAllowed: false, disabledReason: undefined }),
    ).toBe(true);
    expect(shouldAttemptRead({ isAllowed: false, disabledReason: "" })).toBe(
      true,
    );

    expect(
      shouldAttemptRead({
        isAllowed: false,
        disabledReason: "You need the Read Incident permission.",
      }),
    ).toBe(false);
  });
});
