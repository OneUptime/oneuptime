import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import {
  OverrideEventMeta,
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import {
  OVERRIDE_TITLE_MARKER,
  OverrideScopeKind,
  OverrideSummaryRow,
  OverrideUserDisplayInfo,
  UNKNOWN_USER_LABEL,
  buildOverrideEventTooltip,
  buildOverrideSummaryRows,
  describeOverrideScope,
  describeShiftOverride,
  describeSubstituteCoverage,
  formatOverrideEventTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";

/*
 * The wording the on-call schedule screens use for a substitution.
 *
 * These are pinned rather than left to the components because the whole
 * complaint they answer is a wording one: the calendar named the substitute and
 * stopped, so a reader could not tell an override from an ordinary shift, nor
 * see whose shift had been taken, nor whether the swap reached the policy they
 * were worried about. Each test below names the specific misreading it prevents.
 */

const POLICY_ID: string = "policy-1";
const OTHER_POLICY_ID: string = "policy-2";

const ALICE: string = "user-alice";
const BOB: string = "user-bob";
const CAROL: string = "user-carol";
const DAN: string = "user-dan";

const USERS: Dictionary<OverrideUserDisplayInfo> = {
  [ALICE]: { name: "Alice Scheduled", email: "alice@example.com" },
  [BOB]: { name: "Bob Covering", email: "bob@example.com" },
  [CAROL]: { name: "Carol Elsewhere", email: "carol@example.com" },
  [DAN]: { name: "", email: "dan@example.com" },
};

const POLICY_NAMES: Dictionary<string> = {
  [POLICY_ID]: "Database On-Call",
};

function at(hours: number): Date {
  return new Date(2026, 0, 1, hours, 0, 0, 0);
}

function record(data: {
  from: string;
  to: string;
  startHour: number;
  endHour: number;
  policyId?: string | null | undefined;
}): UserOverrideRecord {
  return {
    overrideUserId: data.from,
    routeAlertsToUserId: data.to,
    startsAt: at(data.startHour),
    endsAt: at(data.endHour),
    onCallDutyPolicyId: data.policyId ?? null,
  };
}

function meta(data: {
  from: string;
  to: string;
  policyId?: string | null | undefined;
}): OverrideEventMeta {
  return {
    isOverride: true,
    originalUserId: data.from,
    overrideUserId: data.to,
    overrideStartsAt: at(9),
    overrideEndsAt: at(17),
    onCallDutyPolicyId: data.policyId ?? null,
  };
}

describe("describeOverrideScope", () => {
  test("a global override says so, and says it reaches every policy", () => {
    const scope: ReturnType<typeof describeOverrideScope> =
      describeOverrideScope({ onCallDutyPolicyId: null });

    expect(scope.kind).toBe(OverrideScopeKind.Global);
    expect(scope.label).toBe("Global override");
    expect(scope.detail).toContain("every on-call policy");
  });

  test("undefined is treated as global, exactly as null is", () => {
    /*
     * The record type allows string | null | undefined and the database returns
     * whichever the write path happened to produce. Two spellings of "no
     * policy" that describe themselves differently would put two different
     * sentences on two screens looking at the same override.
     */
    expect(describeOverrideScope({}).kind).toBe(OverrideScopeKind.Global);
    expect(describeOverrideScope({ onCallDutyPolicyId: undefined })).toEqual(
      describeOverrideScope({ onCallDutyPolicyId: null }),
    );
  });

  test("a scoped override names the policy it is limited to", () => {
    const scope: ReturnType<typeof describeOverrideScope> =
      describeOverrideScope({
        onCallDutyPolicyId: POLICY_ID,
        policyName: "Database On-Call",
      });

    expect(scope.kind).toBe(OverrideScopeKind.Policy);
    expect(scope.label).toBe("Only for Database On-Call");
    expect(scope.detail).toContain("Database On-Call");
  });

  test("a scoped override with an unreadable policy stays scoped, never global", () => {
    /*
     * The failure that matters. If a missing policy name fell back to the
     * global wording, a reader would be told their cover applies everywhere
     * when it applies to one policy - and would go to bed expecting a page that
     * their other three policies will send to the person who is away.
     */
    const scope: ReturnType<typeof describeOverrideScope> =
      describeOverrideScope({ onCallDutyPolicyId: POLICY_ID });

    expect(scope.kind).toBe(OverrideScopeKind.Policy);
    expect(scope.label).toBe("Policy override");
    expect(scope.label).not.toContain("Global");
    expect(scope.detail).toContain("one on-call policy");
  });
});

describe("formatOverrideEventTitle", () => {
  test("leads with the swap marker, then the substitute, then whose shift it was", () => {
    const title: string = formatOverrideEventTitle({
      substituteName: "Bob Covering",
      originalName: "Alice Scheduled",
    });

    expect(title).toBe("⇄ Bob Covering (covering Alice Scheduled)");
  });

  test("the marker is the first character, so it survives truncation", () => {
    /*
     * A week-view column clips the label from the right. Any cue placed after
     * the names is the first thing to disappear on exactly the narrow screens
     * where the reader most needs it, which is why the marker is a prefix.
     */
    const title: string = formatOverrideEventTitle({
      substituteName: "Bob Covering",
      originalName: "Alice Scheduled",
    });

    expect(title.startsWith(OVERRIDE_TITLE_MARKER)).toBe(true);
    expect(title.slice(0, 6)).toContain(OVERRIDE_TITLE_MARKER);
  });

  test("the substitute is named before the person they are covering", () => {
    const title: string = formatOverrideEventTitle({
      substituteName: "Bob Covering",
      originalName: "Alice Scheduled",
    });

    /*
     * Order carries meaning here: the block's job is still "who is on call in
     * this slot". Reversing it would read as Alice being on call with Bob as a
     * footnote - the precise misreading that gets the wrong person called.
     */
    expect(title.indexOf("Bob Covering")).toBeLessThan(
      title.indexOf("Alice Scheduled"),
    );
  });
});

describe("buildOverrideEventTooltip", () => {
  const tooltip: string = buildOverrideEventTooltip({
    substituteName: "Bob Covering",
    originalName: "Alice Scheduled",
    overrideStartsAt: at(9),
    overrideEndsAt: at(17),
    scope: describeOverrideScope({
      onCallDutyPolicyId: POLICY_ID,
      policyName: "Database On-Call",
    }),
    timezone: "UTC",
  });

  test("states the direction of the swap in both arrow and prose form", () => {
    expect(tooltip).toContain("Override: Alice Scheduled → Bob Covering");
    expect(tooltip).toContain(
      "Alerts that would page Alice Scheduled go to Bob Covering.",
    );
  });

  test("carries the override's OWN window, not the block's", () => {
    /*
     * A block is the intersection of a shift and an override, so its edges are
     * usually not the override's. Showing only the block's window would let a
     * reader think the cover ends when this shift does.
     */
    expect(tooltip).toContain("Override window:");
    expect(tooltip).toContain("9:00 AM");
    expect(tooltip).toContain("5:00 PM");
  });

  test("carries the scope, so hovering answers 'does this cover my policy'", () => {
    expect(tooltip).toContain("Database On-Call");
  });

  test("is multi-line, since the native tooltip is the fallback for a clipped label", () => {
    expect(tooltip.split("\n").length).toBeGreaterThanOrEqual(4);
  });
});

describe("buildOverrideSummaryRows", () => {
  test("states both parties, the window and the scope for each override", () => {
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [
        record({
          from: ALICE,
          to: BOB,
          startHour: 9,
          endHour: 17,
          policyId: POLICY_ID,
        }),
      ],
      userInfoById: USERS,
      policyNameById: POLICY_NAMES,
      now: at(12),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.originalName).toBe("Alice Scheduled");
    expect(rows[0]!.substituteName).toBe("Bob Covering");
    expect(rows[0]!.startsAt).toEqual(at(9));
    expect(rows[0]!.endsAt).toEqual(at(17));
    expect(rows[0]!.scope.label).toBe("Only for Database On-Call");
    expect(rows[0]!.isActiveNow).toBe(true);
  });

  test("drops overrides whose window has already ended", () => {
    /*
     * The panel's claim is about what is in force. A finished substitution
     * listed there reads as a live one, and the calendar underneath can be
     * navigated into the past without changing what the panel means.
     */
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [record({ from: ALICE, to: BOB, startHour: 1, endHour: 5 })],
      userInfoById: USERS,
      policyNameById: {},
      now: at(12),
    });

    expect(rows).toHaveLength(0);
  });

  test("keeps a future override, marked as not yet in force", () => {
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [record({ from: ALICE, to: BOB, startHour: 20, endHour: 22 })],
      userInfoById: USERS,
      policyNameById: {},
      now: at(12),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.isActiveNow).toBe(false);
  });

  test("an override that is in force sorts above one that merely started earlier", () => {
    /*
     * The panel is read during an incident. Sorting by start alone buries the
     * live substitution under a long-running future one, which is the single
     * row the reader actually came for.
     */
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [
        // starts earlier, but has not begun relative to `now`... it has ended.
        record({ from: ALICE, to: CAROL, startHour: 18, endHour: 20 }),
        record({ from: ALICE, to: BOB, startHour: 11, endHour: 13 }),
      ],
      userInfoById: USERS,
      policyNameById: {},
      now: at(12),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.substituteName).toBe("Bob Covering");
    expect(rows[0]!.isActiveNow).toBe(true);
    expect(rows[1]!.substituteName).toBe("Carol Elsewhere");
  });

  test("an override boundary is half-open: it stops being in force at its end instant", () => {
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [record({ from: ALICE, to: BOB, startHour: 9, endHour: 12 })],
      userInfoById: USERS,
      policyNameById: {},
      now: at(12),
    });

    // Ends exactly at `now`, so it is over - and therefore not listed at all.
    expect(rows).toHaveLength(0);
  });

  test("a user with no name falls back to their email, never to a blank", () => {
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [record({ from: ALICE, to: DAN, startHour: 9, endHour: 17 })],
      userInfoById: USERS,
      policyNameById: {},
      now: at(12),
    });

    expect(rows[0]!.substituteName).toBe("dan@example.com");
  });

  test("a user missing from the map is named, not silently blank", () => {
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [
        record({ from: ALICE, to: "user-nobody", startHour: 9, endHour: 17 }),
      ],
      userInfoById: USERS,
      policyNameById: {},
      now: at(12),
    });

    expect(rows[0]!.substituteName).toBe(UNKNOWN_USER_LABEL);
  });

  test("two overrides differing only in scope get distinct keys", () => {
    /*
     * Same pair, same window, one global and one scoped, is a legal
     * configuration. Colliding keys would make React drop one row - hiding a
     * substitution the reader has to know about.
     */
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [
        record({ from: ALICE, to: BOB, startHour: 9, endHour: 17 }),
        record({
          from: ALICE,
          to: BOB,
          startHour: 9,
          endHour: 17,
          policyId: POLICY_ID,
        }),
      ],
      userInfoById: USERS,
      policyNameById: POLICY_NAMES,
      now: at(12),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.key).not.toBe(rows[1]!.key);
  });
});

describe("describeSubstituteCoverage", () => {
  test("names the person being covered, not just the fact of covering", () => {
    expect(
      describeSubstituteCoverage({
        substituteUserId: BOB,
        records: [record({ from: ALICE, to: BOB, startHour: 9, endHour: 17 })],
        userInfoById: USERS,
      }),
    ).toBe("Covering Alice Scheduled");
  });

  test("two people covered are both named", () => {
    expect(
      describeSubstituteCoverage({
        substituteUserId: BOB,
        records: [
          record({ from: ALICE, to: BOB, startHour: 9, endHour: 13 }),
          record({ from: CAROL, to: BOB, startHour: 13, endHour: 17 }),
        ],
        userInfoById: USERS,
      }),
    ).toBe("Covering Alice Scheduled and Carol Elsewhere");
  });

  test("three or more collapse to a count rather than overflowing the chip", () => {
    expect(
      describeSubstituteCoverage({
        substituteUserId: BOB,
        records: [
          record({ from: ALICE, to: BOB, startHour: 9, endHour: 11 }),
          record({ from: CAROL, to: BOB, startHour: 11, endHour: 13 }),
          record({ from: DAN, to: BOB, startHour: 13, endHour: 17 }),
        ],
        userInfoById: USERS,
      }),
    ).toBe("Covering Alice Scheduled and 2 others");
  });

  test("the same person covered twice is counted once", () => {
    expect(
      describeSubstituteCoverage({
        substituteUserId: BOB,
        records: [
          record({ from: ALICE, to: BOB, startHour: 9, endHour: 11 }),
          record({ from: ALICE, to: BOB, startHour: 14, endHour: 17 }),
        ],
        userInfoById: USERS,
      }),
    ).toBe("Covering Alice Scheduled");
  });

  test("ignores overrides routed to somebody else", () => {
    expect(
      describeSubstituteCoverage({
        substituteUserId: BOB,
        records: [
          record({ from: ALICE, to: CAROL, startHour: 9, endHour: 17 }),
        ],
        userInfoById: USERS,
      }),
    ).toBe("Covering");
  });
});

describe("describeShiftOverride", () => {
  test("produces the covering sentence and the scope for a shift", () => {
    const described: ReturnType<typeof describeShiftOverride> =
      describeShiftOverride({
        override: meta({ from: ALICE, to: BOB, policyId: POLICY_ID }),
        userInfoById: USERS,
        policyNameById: POLICY_NAMES,
      });

    expect(described.originalName).toBe("Alice Scheduled");
    expect(described.coveringLabel).toBe("Covering for Alice Scheduled");
    expect(described.scope.label).toBe("Only for Database On-Call");
  });

  test("a global override reads as global", () => {
    const described: ReturnType<typeof describeShiftOverride> =
      describeShiftOverride({
        override: meta({ from: ALICE, to: BOB }),
        userInfoById: USERS,
        policyNameById: POLICY_NAMES,
      });

    expect(described.scope.kind).toBe(OverrideScopeKind.Global);
  });

  test("a policy id with no name in the map does not borrow another policy's name", () => {
    const described: ReturnType<typeof describeShiftOverride> =
      describeShiftOverride({
        override: meta({ from: ALICE, to: BOB, policyId: OTHER_POLICY_ID }),
        userInfoById: USERS,
        policyNameById: POLICY_NAMES,
      });

    expect(described.scope.label).toBe("Policy override");
    expect(described.scope.label).not.toContain("Database On-Call");
  });
});

describe("timezone handling", () => {
  test("the tooltip renders the override window in the zone it is given", () => {
    /*
     * The window is an absolute instant; which wall clock it is shown against
     * is the reader's "view as" choice. Two viewers looking at the same
     * override must each see their own zone, or one of them mis-plans their
     * evening around the other's clock.
     */
    const instant: Date = OneUptimeDate.getInstantFromLocalWallClockInTimezone(
      new Date(2026, 0, 1, 9, 0, 0),
      "UTC",
    );

    const utc: string = buildOverrideEventTooltip({
      substituteName: "Bob Covering",
      originalName: "Alice Scheduled",
      overrideStartsAt: instant,
      overrideEndsAt: instant,
      scope: describeOverrideScope({}),
      timezone: "UTC",
    });

    const tokyo: string = buildOverrideEventTooltip({
      substituteName: "Bob Covering",
      originalName: "Alice Scheduled",
      overrideStartsAt: instant,
      overrideEndsAt: instant,
      scope: describeOverrideScope({}),
      timezone: "Asia/Tokyo",
    });

    expect(utc).toContain("9:00 AM");
    expect(tokyo).toContain("6:00 PM");
    expect(utc).not.toEqual(tokyo);
  });
});
