import { describe, expect, test } from "@jest/globals";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import {
  ROLLUP_CATEGORY_BY_EVENT_TYPE,
  ROLLUP_CATEGORY_LABEL,
  ROLLUP_CATEGORY_ORDER,
  RollupCategory,
  getRollupCategory,
} from "../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import {
  NEVER_ROLLED_UP_EVENT_TYPES,
  ROLLUP_ELIGIBLE_EVENT_TYPES,
  ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES,
  isRollupEligible,
} from "../../../Types/NotificationSetting/NotificationEmailRollupPolicy";

/*
 * This is the classification ratchet for owner-email burst coalescing, and
 * these are the failures it exists to catch in review rather than in an
 * incident:
 *
 * - Somebody adds a 48th NotificationSettingEventType and does not classify
 *   it. Every count below breaks, so the omission cannot be merged.
 * - Somebody moves a time-critical on-call event out of
 *   NEVER_ROLLED_UP_EVENT_TYPES. "You are on call now", delayed five minutes,
 *   is a missed page; that is the one thing this feature must never cause.
 * - Somebody grows ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES. It is the
 *   deliberate two-entry exception to "no on-call mail is coalesced", it is
 *   shrink-only, and the whole point is that adding to it requires editing
 *   this file and explaining yourself.
 * - Somebody flips isRollupEligible to a deny-list. An event type this build
 *   has never seen would then be silently coalesced instead of sent
 *   immediately, which is a behaviour change arriving through the path least
 *   likely to be noticed.
 *
 * No mocks: both modules under test are pure and import nothing but the enum.
 */
describe("NotificationEmailRollupPolicy - the two sets partition the enum", () => {
  test("the enum still has exactly 47 members, split 5 / 42", () => {
    const allEventTypes: Array<NotificationSettingEventType> = Object.values(
      NotificationSettingEventType,
    );

    expect(allEventTypes.length).toBe(47);
    expect(NEVER_ROLLED_UP_EVENT_TYPES.size).toBe(5);
    expect(ROLLUP_ELIGIBLE_EVENT_TYPES.size).toBe(42);
  });

  test("their union is exactly the enum, so a 48th member fails CI until classified", () => {
    const allEventTypes: Array<NotificationSettingEventType> = Object.values(
      NotificationSettingEventType,
    );

    const union: Set<NotificationSettingEventType> =
      new Set<NotificationSettingEventType>([
        ...Array.from(NEVER_ROLLED_UP_EVENT_TYPES),
        ...Array.from(ROLLUP_ELIGIBLE_EVENT_TYPES),
      ]);

    expect(Array.from(union).sort()).toEqual(allEventTypes.sort());
  });

  test("their intersection is empty, so no event type is both", () => {
    const inBoth: Array<NotificationSettingEventType> = Array.from(
      NEVER_ROLLED_UP_EVENT_TYPES,
    ).filter((eventType: NotificationSettingEventType): boolean => {
      return ROLLUP_ELIGIBLE_EVENT_TYPES.has(eventType);
    });

    expect(inBoth).toEqual([]);
  });
});

describe("NotificationEmailRollupPolicy - never rolled up", () => {
  test("holds exactly the five time-critical on-call events and nothing else", () => {
    expect(Array.from(NEVER_ROLLED_UP_EVENT_TYPES).sort()).toEqual(
      [
        NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
        NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
        NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
        NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
      ].sort(),
    );
  });

  test("none of the five is rollup eligible", () => {
    for (const eventType of Array.from(NEVER_ROLLED_UP_EVENT_TYPES)) {
      expect(isRollupEligible(eventType)).toBe(false);
    }
  });
});

describe("NotificationEmailRollupPolicy - the shrink-only on-call exception", () => {
  test("every ON_CALL or SHIFT member is never-rolled-up unless it is a named exception", () => {
    const entries: Array<[string, NotificationSettingEventType]> =
      Object.entries(NotificationSettingEventType);

    const onCallMemberNames: Array<string> = [];

    for (const [memberName, eventType] of entries) {
      if (!memberName.includes("ON_CALL") && !memberName.includes("SHIFT")) {
        continue;
      }

      onCallMemberNames.push(memberName);

      const isNamedException: boolean =
        ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES.has(eventType);

      if (isNamedException) {
        expect(NEVER_ROLLED_UP_EVENT_TYPES.has(eventType)).toBe(false);
        expect(isRollupEligible(eventType)).toBe(true);
        continue;
      }

      expect(NEVER_ROLLED_UP_EVENT_TYPES.has(eventType)).toBe(true);
      expect(isRollupEligible(eventType)).toBe(false);
    }

    /*
     * Guards the loop itself: if a rename ever drops ON_CALL out of every
     * member name the loop above would pass by doing nothing at all.
     */
    expect(onCallMemberNames.length).toBe(7);
  });

  test("the exception set is capped at two and holds exactly the two policy-membership events", () => {
    expect(ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES.size).toBeLessThanOrEqual(
      2,
    );

    expect(
      Array.from(ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES).sort(),
    ).toEqual(
      [
        NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
        NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
      ].sort(),
    );
  });

  test("the exception set is a subset of the rollup-eligible set", () => {
    for (const eventType of Array.from(
      ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES,
    )) {
      expect(ROLLUP_ELIGIBLE_EVENT_TYPES.has(eventType)).toBe(true);
    }
  });
});

describe("NotificationEmailRollupPolicy - isRollupEligible is a positive allow-list", () => {
  test("an unclassified value cast in from the database is not eligible", () => {
    const unknownEventType: NotificationSettingEventType =
      "Some event type a newer build invented" as NotificationSettingEventType;

    expect(isRollupEligible(unknownEventType)).toBe(false);
  });

  test("an empty string is not eligible", () => {
    expect(isRollupEligible("" as NotificationSettingEventType)).toBe(false);
  });

  test("a real classified member is eligible", () => {
    expect(
      isRollupEligible(
        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
      ),
    ).toBe(true);
  });
});

describe("NotificationEmailRollupCategory", () => {
  test("classifies every enum member, with no key that is not an enum member", () => {
    const allEventTypes: Array<string> = Object.values(
      NotificationSettingEventType,
    );

    expect(Object.keys(ROLLUP_CATEGORY_BY_EVENT_TYPE).sort()).toEqual(
      allEventTypes.sort(),
    );
  });

  test("every classification is a real RollupCategory", () => {
    const categories: Array<string> = Object.values(RollupCategory);

    for (const category of Object.values(ROLLUP_CATEGORY_BY_EVENT_TYPE)) {
      expect(categories).toContain(category);
    }
  });

  test("getRollupCategory agrees with the map for a member of each group", () => {
    expect(
      getRollupCategory(
        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
      ),
    ).toBe(RollupCategory.Incidents);

    expect(
      getRollupCategory(
        NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
      ),
    ).toBe(RollupCategory.Alerts);

    expect(
      getRollupCategory(
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
      ),
    ).toBe(RollupCategory.Monitors);

    expect(
      getRollupCategory(
        NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
      ),
    ).toBe(RollupCategory.Probes);

    expect(
      getRollupCategory(
        NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
      ),
    ).toBe(RollupCategory.OnCall);
  });

  test("getRollupCategory falls back to Other for a value cast in from the database", () => {
    const unknownEventType: NotificationSettingEventType =
      "Some event type a newer build invented" as NotificationSettingEventType;

    expect(getRollupCategory(unknownEventType)).toBe(RollupCategory.Other);
  });

  test("every RollupCategory has a non-empty label", () => {
    for (const category of Object.values(RollupCategory)) {
      const label: string | undefined = ROLLUP_CATEGORY_LABEL[category];

      expect(typeof label).toBe("string");
      expect((label ?? "").length).toBeGreaterThan(0);
    }
  });

  test("the label map has no key that is not a RollupCategory", () => {
    const categories: Array<string> = Object.values(RollupCategory);

    expect(Object.keys(ROLLUP_CATEGORY_LABEL).sort()).toEqual(
      categories.sort(),
    );
  });

  test("category values are stable machine codes, never display strings", () => {
    for (const category of Object.values(RollupCategory)) {
      /*
       * Persisted in UserNotificationEmailRollupItem.rollupCategory, so the
       * value can never be reworded. Lowercase kebab keeps it visibly unfit to
       * show a user, which is what stops somebody "fixing the capitalisation"
       * of a column value and orphaning every pending row.
       */
      expect(category).toMatch(/^[a-z]+(-[a-z]+)*$/u);
    }
  });

  /*
   * ROLLUP_CATEGORY_ORDER decides what the rollup email lists first, and -
   * unlike ROLLUP_CATEGORY_LABEL and ROLLUP_CATEGORY_BY_EVENT_TYPE, which are
   * exhaustive Records the compiler checks - it is an array, and an array
   * cannot say "every member, once". These three tests are that guarantee.
   */
  test("the section order lists every RollupCategory", () => {
    expect([...ROLLUP_CATEGORY_ORDER].sort()).toEqual(
      Object.values(RollupCategory).sort(),
    );
  });

  test("the section order lists no category twice", () => {
    expect(new Set<RollupCategory>(ROLLUP_CATEGORY_ORDER).size).toBe(
      ROLLUP_CATEGORY_ORDER.length,
    );
  });

  test("incidents lead and Other trails, because the order is urgency, not the alphabet", () => {
    expect(ROLLUP_CATEGORY_ORDER[0]).toBe(RollupCategory.Incidents);
    expect(ROLLUP_CATEGORY_ORDER[ROLLUP_CATEGORY_ORDER.length - 1]).toBe(
      RollupCategory.Other,
    );

    /*
     * The pairs that would be wrong in either direction if somebody sorted
     * this array: a monitor is how an incident was noticed, and a probe is how
     * the monitor was noticed, so both belong below it.
     */
    expect(
      ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Incidents),
    ).toBeLessThan(ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Monitors));
    expect(ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Monitors)).toBeLessThan(
      ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Probes),
    );
    expect(ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Alerts)).toBeLessThan(
      ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Monitors),
    );
  });
});
