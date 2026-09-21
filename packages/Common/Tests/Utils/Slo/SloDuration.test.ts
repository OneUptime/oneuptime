import {
  formatDurationCompact,
  formatErrorBudgetRemaining,
  formatErrorBudgetRemainingOfTotal,
} from "../../../Utils/Slo/SloDuration";

describe("SloDuration", () => {
  describe("formatDurationCompact", () => {
    it("renders seconds under a minute", () => {
      expect(formatDurationCompact(45)).toBe("45s");
      expect(formatDurationCompact(1)).toBe("1s");
    });

    it("renders zero as 0s rather than an empty string", () => {
      expect(formatDurationCompact(0)).toBe("0s");
    });

    it("renders minutes and seconds", () => {
      // 99.9% over 30 days — the canonical error budget.
      expect(formatDurationCompact(2592)).toBe("43m 12s");
    });

    it("drops a zero remainder instead of padding it", () => {
      expect(formatDurationCompact(120)).toBe("2m");
      expect(formatDurationCompact(7200)).toBe("2h");
      expect(formatDurationCompact(172800)).toBe("2d");
    });

    it("renders hours and minutes", () => {
      // 99% over 90 days.
      expect(formatDurationCompact(77760)).toBe("21h 36m");
      expect(formatDurationCompact(7860)).toBe("2h 11m");
    });

    it("renders days and hours", () => {
      expect(formatDurationCompact(190800)).toBe("2d 5h");
    });

    it("shows at most the two most significant units", () => {
      // 2d 5h 13m 7s — the minutes and seconds are dropped.
      expect(formatDurationCompact(191587)).toBe("2d 5h");
    });

    it("skips leading zero units", () => {
      // 0d 0h 5m 3s.
      expect(formatDurationCompact(303)).toBe("5m 3s");
    });

    it("skips an interior zero unit and moves on to the next", () => {
      /*
       * Exactly 2 days + 30 seconds: hours and minutes are both zero, so
       * the second slot is filled by seconds rather than padded with "0h".
       */
      expect(formatDurationCompact(172830)).toBe("2d 30s");
    });

    it("floors fractional seconds instead of rounding up", () => {
      // A 59.9s budget must never read as a full minute it does not have.
      expect(formatDurationCompact(59.9)).toBe("59s");
      expect(formatDurationCompact(0.4)).toBe("0s");
    });

    it("renders the magnitude of a negative input (sign is the caller's job)", () => {
      expect(formatDurationCompact(-2592)).toBe("43m 12s");
    });
  });

  describe("formatErrorBudgetRemaining", () => {
    it("labels a positive remainder as left", () => {
      expect(formatErrorBudgetRemaining(2592)).toBe("43m 12s left");
    });

    it("renders an exhausted-but-not-overspent budget as 0s left", () => {
      expect(formatErrorBudgetRemaining(0)).toBe("0s left");
      expect(formatErrorBudgetRemaining(-0)).toBe("0s left");
    });

    it("states the overage as a positive duration with over budget", () => {
      expect(formatErrorBudgetRemaining(-750)).toBe("12m 30s over budget");
    });

    it("keeps a multi-day overage readable", () => {
      expect(formatErrorBudgetRemaining(-346980)).toBe("4d 23m over budget");
    });

    it.each([0.001, 0.4, 0.999])(
      "distinguishes a positive %ps remainder from an empty budget",
      (seconds: number) => {
        expect(formatErrorBudgetRemaining(seconds)).toBe("under 1s left");
      },
    );

    it.each([-0.001, -0.4, -0.999])(
      "preserves a %ps overage instead of rounding it to zero",
      (seconds: number) => {
        expect(formatErrorBudgetRemaining(seconds)).toBe(
          "under 1s over budget",
        );
      },
    );

    it("uses seconds at the one-second boundary without rounding up", () => {
      expect(formatErrorBudgetRemaining(1)).toBe("1s left");
      expect(formatErrorBudgetRemaining(-1)).toBe("1s over budget");
      expect(formatErrorBudgetRemaining(59.9)).toBe("59s left");
      expect(formatErrorBudgetRemaining(-59.9)).toBe("59s over budget");
    });

    it("returns null when the SLO has not been evaluated", () => {
      expect(formatErrorBudgetRemaining(null)).toBeNull();
      expect(formatErrorBudgetRemaining(undefined)).toBeNull();
    });

    it("returns null for non-finite values", () => {
      expect(formatErrorBudgetRemaining(Number.NaN)).toBeNull();
      expect(formatErrorBudgetRemaining(Number.POSITIVE_INFINITY)).toBeNull();
      expect(formatErrorBudgetRemaining(Number.NEGATIVE_INFINITY)).toBeNull();
    });

    it("rejects a numeric string rather than coercing it", () => {
      expect(
        formatErrorBudgetRemaining("2592" as unknown as number),
      ).toBeNull();
    });

    it("rejects booleans rather than treating them as zero or one", () => {
      expect(formatErrorBudgetRemaining(false as unknown as number)).toBeNull();
      expect(formatErrorBudgetRemaining(true as unknown as number)).toBeNull();
    });
  });

  describe("formatErrorBudgetRemainingOfTotal", () => {
    it("renders remaining alongside the total", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: 750,
          totalSeconds: 2592,
        }),
      ).toBe("12m 30s left of 43m 12s");
    });

    it("identifies the allowance separately from how far over budget it is", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: -750,
          totalSeconds: 2592,
        }),
      ).toBe("12m 30s over budget · 43m 12s allowed");
    });

    it("explains the reported multi-day overage against its small allowance", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: -346980,
          totalSeconds: 347,
        }),
      ).toBe("4d 23m over budget · 5m 47s allowed");
    });

    it("retains the allowance at exactly zero without claiming an overage", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: 0,
          totalSeconds: 2592,
        }),
      ).toBe("0s left of 43m 12s");
    });

    it.each([
      [0.25, "under 1s left of under 1s"],
      [-0.25, "under 1s over budget · under 1s allowed"],
      [0, "0s left of under 1s"],
    ])(
      "does not round a subsecond allowance to zero for a %ps remainder",
      (remainingSeconds: number, expected: string) => {
        expect(
          formatErrorBudgetRemainingOfTotal({
            remainingSeconds,
            totalSeconds: 0.5,
          }),
        ).toBe(expected);
      },
    );

    it.each([
      ["missing", undefined],
      ["null", null],
      ["zero", 0],
      ["negative", -2592],
      ["NaN", Number.NaN],
      ["positive infinity", Number.POSITIVE_INFINITY],
      ["negative infinity", Number.NEGATIVE_INFINITY],
      ["numeric string", "2592" as unknown as number],
      ["boolean", true as unknown as number],
    ])(
      "omits an unusable %s total while preserving the remaining or over-budget state",
      (_label: string, totalSeconds: number | null | undefined) => {
        expect(
          formatErrorBudgetRemainingOfTotal({
            remainingSeconds: 750,
            totalSeconds,
          }),
        ).toBe("12m 30s left");
        expect(
          formatErrorBudgetRemainingOfTotal({
            remainingSeconds: -750,
            totalSeconds,
          }),
        ).toBe("12m 30s over budget");
        expect(
          formatErrorBudgetRemainingOfTotal({
            remainingSeconds: 0,
            totalSeconds,
          }),
        ).toBe("0s left");
      },
    );

    it.each([
      ["missing", undefined],
      ["null", null],
      ["NaN", Number.NaN],
      ["positive infinity", Number.POSITIVE_INFINITY],
      ["negative infinity", Number.NEGATIVE_INFINITY],
      ["numeric string", "750" as unknown as number],
      ["boolean", false as unknown as number],
    ])(
      "does not let a known total imply an evaluated budget when the remainder is %s",
      (_label: string, remainingSeconds: number | null | undefined) => {
        expect(
          formatErrorBudgetRemainingOfTotal({
            remainingSeconds,
            totalSeconds: 2592,
          }),
        ).toBeNull();
      },
    );
  });
});
