import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../../Types/Billing/SubscriptionStatus";

/*
 * Every status Stripe can report, and whether a project in it is still served
 * (monitored, probed, polled, evaluated). Spelled out by hand - NOT derived
 * from getActiveSubscriptionStatuses - so a change to the shared list has to
 * be made here too, on purpose. past_due is active: the product decision is
 * that monitoring continues while Stripe is still retrying the invoice.
 */
const EXPECTED_ACTIVE_BY_STATUS: Record<SubscriptionStatus, boolean> = {
  [SubscriptionStatus.Active]: true,
  [SubscriptionStatus.Trialing]: true,
  [SubscriptionStatus.PastDue]: true,
  [SubscriptionStatus.Incomplete]: false,
  [SubscriptionStatus.IncompleteExpired]: false,
  [SubscriptionStatus.Canceled]: false,
  [SubscriptionStatus.Unpaid]: false,
  [SubscriptionStatus.Expired]: false,
  [SubscriptionStatus.Paused]: false,
};

describe("SubscriptionStatusUtil", () => {
  describe("getActiveSubscriptionStatuses", () => {
    test("is exactly active, trialing and past_due", () => {
      expect(
        [...SubscriptionStatusUtil.getActiveSubscriptionStatuses()].sort(),
      ).toEqual(["active", "past_due", "trialing"]);
    });

    /*
     * The production incident: a project whose autopay attempt failed (its
     * old India e-mandate card declined after sitting in "processing" for a
     * day) went past_due, and every monitoring query dropped it.
     */
    test("includes past_due so an overdue project keeps being monitored", () => {
      expect(SubscriptionStatusUtil.getActiveSubscriptionStatuses()).toContain(
        SubscriptionStatus.PastDue,
      );
    });

    test.each([
      SubscriptionStatus.Unpaid,
      SubscriptionStatus.Canceled,
      SubscriptionStatus.Incomplete,
      SubscriptionStatus.IncompleteExpired,
      SubscriptionStatus.Expired,
      SubscriptionStatus.Paused,
    ])("does not include %s", (status: SubscriptionStatus) => {
      expect(
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      ).not.toContain(status);
    });

    test("has no duplicates", () => {
      const statuses: Array<SubscriptionStatus> =
        SubscriptionStatusUtil.getActiveSubscriptionStatuses();

      expect(new Set(statuses).size).toBe(statuses.length);
    });

    test("only contains real enum values (each is a SQL-safe constant)", () => {
      const enumValues: Array<string> = Object.values(SubscriptionStatus);

      for (const status of SubscriptionStatusUtil.getActiveSubscriptionStatuses()) {
        expect(enumValues).toContain(status);
        // Bound into raw SQL by the claim queries - keep it boring.
        expect(status).toMatch(/^[a-z_]+$/);
      }
    });

    test("never contains undefined or null (NULL is handled by each query)", () => {
      for (const status of SubscriptionStatusUtil.getActiveSubscriptionStatuses()) {
        expect(status).toBeTruthy();
      }
    });

    /*
     * Handed straight to QueryHelper and to raw SQL parameters by several
     * callers. A shared array that one caller pushes onto would quietly
     * widen "active" for every other caller in the process.
     */
    test("returns a fresh array so a caller cannot mutate the definition", () => {
      const first: Array<SubscriptionStatus> =
        SubscriptionStatusUtil.getActiveSubscriptionStatuses();
      first.push(SubscriptionStatus.Canceled);
      first.splice(0, 1);

      const second: Array<SubscriptionStatus> =
        SubscriptionStatusUtil.getActiveSubscriptionStatuses();

      expect(second).not.toBe(first);
      expect([...second].sort()).toEqual(["active", "past_due", "trialing"]);
      expect(
        SubscriptionStatusUtil.isSubscriptionActive(
          SubscriptionStatus.Canceled,
        ),
      ).toBe(false);
      expect(
        SubscriptionStatusUtil.isSubscriptionActive(SubscriptionStatus.Active),
      ).toBe(true);
    });
  });

  describe("isSubscriptionActive agrees with getActiveSubscriptionStatuses", () => {
    test("covers every status in the enum (update the table when Stripe adds one)", () => {
      expect(Object.keys(EXPECTED_ACTIVE_BY_STATUS).sort()).toEqual(
        [...Object.values(SubscriptionStatus)].sort(),
      );
    });

    test.each(Object.values(SubscriptionStatus))(
      "%s: isSubscriptionActive matches membership in the shared list and the expected table",
      (status: SubscriptionStatus) => {
        const inList: boolean =
          SubscriptionStatusUtil.getActiveSubscriptionStatuses().includes(
            status,
          );

        expect(SubscriptionStatusUtil.isSubscriptionActive(status)).toBe(
          inList,
        );
        expect(inList).toBe(EXPECTED_ACTIVE_BY_STATUS[status]);
        expect(SubscriptionStatusUtil.isSubscriptionInactive(status)).toBe(
          !EXPECTED_ACTIVE_BY_STATUS[status],
        );
      },
    );

    test.each([undefined, null, ""])(
      "a missing status (%p) is active even though it is not in the list",
      (status: undefined | null | string) => {
        expect(
          SubscriptionStatusUtil.isSubscriptionActive(
            status as unknown as SubscriptionStatus | undefined,
          ),
        ).toBe(true);
      },
    );

    test("an unknown status string is not active", () => {
      expect(
        SubscriptionStatusUtil.isSubscriptionActive(
          "something_new" as SubscriptionStatus,
        ),
      ).toBe(false);
    });
  });

  /*
   * Billing enforcement is deliberately NOT the same question as "keep
   * monitoring". Making past_due monitorable must not make it cancelled, and
   * must not stop it being flagged as overdue (the banner and the daily
   * overdue emails key off that).
   */
  describe("billing enforcement is unchanged by the monitoring decision", () => {
    test("past_due is still overdue and still not cancelled", () => {
      expect(
        SubscriptionStatusUtil.isSubscriptionOverdue(
          SubscriptionStatus.PastDue,
        ),
      ).toBe(true);
      expect(
        SubscriptionStatusUtil.isSubscriptionCancelled(
          SubscriptionStatus.PastDue,
        ),
      ).toBe(false);
    });

    test("every cancelled status is outside the active list", () => {
      for (const status of Object.values(SubscriptionStatus)) {
        if (SubscriptionStatusUtil.isSubscriptionCancelled(status)) {
          expect(
            SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
          ).not.toContain(status);
        }
      }
    });
  });

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
