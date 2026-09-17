import {
  formatDurationCompact,
  formatErrorBudgetRemaining,
  formatErrorBudgetRemainingOfTotal,
} from "../../../Utils/Slo/SloDuration";

const MINUS_SIGN: string = "−";

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
    });

    it("renders an overspent budget with a minus sign and over budget", () => {
      expect(formatErrorBudgetRemaining(-750)).toBe(
        `${MINUS_SIGN}12m 30s over budget`,
      );
    });

    it("returns null when the SLO has not been evaluated", () => {
      expect(formatErrorBudgetRemaining(null)).toBeNull();
      expect(formatErrorBudgetRemaining(undefined)).toBeNull();
    });

    it("returns null for non-finite values", () => {
      expect(formatErrorBudgetRemaining(Number.NaN)).toBeNull();
      expect(formatErrorBudgetRemaining(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it("rejects a numeric string rather than coercing it", () => {
      expect(
        formatErrorBudgetRemaining("2592" as unknown as number),
      ).toBeNull();
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

    it("keeps the total visible when the budget is overspent", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: -750,
          totalSeconds: 2592,
        }),
      ).toBe(`${MINUS_SIGN}12m 30s over budget of 43m 12s`);
    });

    it("omits the total when it is unknown", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: 750,
          totalSeconds: null,
        }),
      ).toBe("12m 30s left");
    });

    it("omits a zero total — a brand-new SLO has no elapsed window yet", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: 0,
          totalSeconds: 0,
        }),
      ).toBe("0s left");
    });

    it("returns null when the SLO has not been evaluated", () => {
      expect(
        formatErrorBudgetRemainingOfTotal({
          remainingSeconds: null,
          totalSeconds: 2592,
        }),
      ).toBeNull();
    });
  });
});
