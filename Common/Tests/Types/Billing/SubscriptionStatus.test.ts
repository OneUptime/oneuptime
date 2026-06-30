import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../../Types/Billing/SubscriptionStatus";

describe("SubscriptionStatusUtil", () => {
  describe("isSubscriptionActive", () => {
    test("treats a missing status as active", () => {
      expect(SubscriptionStatusUtil.isSubscriptionActive(undefined)).toBe(true);
    });

    test.each([
      SubscriptionStatus.Active,
      SubscriptionStatus.Trialing,
      SubscriptionStatus.PastDue,
    ])("returns true for %s", (status: SubscriptionStatus) => {
      expect(SubscriptionStatusUtil.isSubscriptionActive(status)).toBe(true);
    });

    test.each([
      SubscriptionStatus.Incomplete,
      SubscriptionStatus.IncompleteExpired,
      SubscriptionStatus.Canceled,
      SubscriptionStatus.Unpaid,
      SubscriptionStatus.Expired,
      SubscriptionStatus.Paused,
    ])("returns false for %s", (status: SubscriptionStatus) => {
      expect(SubscriptionStatusUtil.isSubscriptionActive(status)).toBe(false);
    });
  });

  describe("isSubscriptionInactive", () => {
    test("is the inverse of isSubscriptionActive", () => {
      const statuses: Array<SubscriptionStatus | undefined> = [
        undefined,
        ...Object.values(SubscriptionStatus),
      ];

      for (const status of statuses) {
        expect(SubscriptionStatusUtil.isSubscriptionInactive(status)).toBe(
          !SubscriptionStatusUtil.isSubscriptionActive(status),
        );
      }
    });

    test("treats a missing status as active (not inactive)", () => {
      expect(SubscriptionStatusUtil.isSubscriptionInactive(undefined)).toBe(
        false,
      );
    });
  });

  describe("isSubscriptionOverdue", () => {
    test("returns false for a missing status", () => {
      expect(SubscriptionStatusUtil.isSubscriptionOverdue(undefined)).toBe(
        false,
      );
    });

    test("returns true only for PastDue", () => {
      expect(
        SubscriptionStatusUtil.isSubscriptionOverdue(
          SubscriptionStatus.PastDue,
        ),
      ).toBe(true);
      expect(
        SubscriptionStatusUtil.isSubscriptionOverdue(SubscriptionStatus.Active),
      ).toBe(false);
      expect(
        SubscriptionStatusUtil.isSubscriptionOverdue(
          SubscriptionStatus.Canceled,
        ),
      ).toBe(false);
    });
  });

  describe("isSubscriptionCancelled", () => {
    test("returns false for a missing status", () => {
      expect(SubscriptionStatusUtil.isSubscriptionCancelled(undefined)).toBe(
        false,
      );
    });

    test.each([
      SubscriptionStatus.Canceled,
      SubscriptionStatus.Unpaid,
      SubscriptionStatus.Expired,
      SubscriptionStatus.IncompleteExpired,
    ])("returns true for %s", (status: SubscriptionStatus) => {
      expect(SubscriptionStatusUtil.isSubscriptionCancelled(status)).toBe(true);
    });

    test.each([
      SubscriptionStatus.Active,
      SubscriptionStatus.Trialing,
      SubscriptionStatus.PastDue,
      SubscriptionStatus.Incomplete,
      SubscriptionStatus.Paused,
    ])("returns false for %s", (status: SubscriptionStatus) => {
      expect(SubscriptionStatusUtil.isSubscriptionCancelled(status)).toBe(
        false,
      );
    });
  });

  describe("status relationships", () => {
    test("PastDue is both active and overdue", () => {
      expect(
        SubscriptionStatusUtil.isSubscriptionActive(SubscriptionStatus.PastDue),
      ).toBe(true);
      expect(
        SubscriptionStatusUtil.isSubscriptionOverdue(
          SubscriptionStatus.PastDue,
        ),
      ).toBe(true);
    });

    test("active and cancelled statuses never overlap", () => {
      for (const status of Object.values(SubscriptionStatus)) {
        const active: boolean =
          SubscriptionStatusUtil.isSubscriptionActive(status);
        const cancelled: boolean =
          SubscriptionStatusUtil.isSubscriptionCancelled(status);
        expect(active && cancelled).toBe(false);
      }
    });
  });
});
