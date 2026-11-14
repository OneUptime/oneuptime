import UserOverrideOverlap, {
  USER_OVERRIDE_CONFLICT_COVERED_GLOBALLY,
  USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY,
  USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY,
  USER_OVERRIDE_CONFLICT_SKIPPED_ON_POLICY,
  USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
  USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY,
  USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL,
  USER_OVERRIDE_NOTE_UNNAMED_POLICY_OVER_GLOBAL,
  USER_OVERRIDE_OVERLAPS_COVERED,
  USER_OVERRIDE_OVERLAPS_LABEL,
  USER_OVERRIDE_OVERLAPS_SKIPPED,
  UserOverrideOverlapNote,
  UserOverrideSentence,
  UserOverrideTimes,
  UserOverrideUseReason,
} from "../../../Types/OnCallDutyPolicy/UserOverrideOverlap";
import {
  fillTemplate,
  getTemplatePlaceholders,
} from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE PERSON'S OVERRIDES MAY NOT OVERLAP IN ONE SCOPE (issue #7630): the
 * rule the server refuses an add or an edit by, and the dashboard's
 * dialog warns by as soon as the times are picked - and, for overlaps
 * saved before the rule, which of two is used where they overlap, as
 * paging and the schedules pick it, and what the lists' "Overlaps" mark
 * says.
 */

const JANE: string = "7630cccc-0000-4000-8000-000000000001";
const BOB: string = "7630cccc-0000-4000-8000-000000000002";
const CAROL: string = "7630cccc-0000-4000-8000-000000000003";
const KIM: string = "7630cccc-0000-4000-8000-000000000004";
const PAYMENTS: string = "7630cccc-0000-4000-8000-0000000000b1";
const SEARCH: string = "7630cccc-0000-4000-8000-0000000000b2";

const at: (time: string) => Date = (time: string): Date => {
  return new Date(`2026-11-13T${time}:00.000Z`);
};

// Jane, covered by Bob on Payments - unless told otherwise.
const override: (data: {
  id?: string | undefined;
  away?: string | undefined;
  cover?: string | null | undefined;
  policy?: string | null | undefined;
  from: string;
  until: string;
  addedAt?: string | undefined;
}) => UserOverrideTimes = (data: {
  id?: string | undefined;
  away?: string | undefined;
  cover?: string | null | undefined;
  policy?: string | null | undefined;
  from: string;
  until: string;
  addedAt?: string | undefined;
}): UserOverrideTimes => {
  return {
    id: data.id || null,
    overrideUserId: data.away || JANE,
    routeAlertsToUserId: data.cover === undefined ? BOB : data.cover,
    onCallDutyPolicyId: data.policy === undefined ? PAYMENTS : data.policy,
    startsAt: at(data.from),
    endsAt: at(data.until),
    createdAt: data.addedAt ? at(data.addedAt) : null,
  };
};

const fill: (sentence: UserOverrideSentence) => string = (
  sentence: UserOverrideSentence,
): string => {
  // Every placeholder the sentence names is filled, and nothing else is passed.
  expect(Object.keys(sentence.values).sort()).toEqual(
    getTemplatePlaceholders(sentence.template).sort(),
  );

  return fillTemplate(sentence.template, sentence.values);
};

describe("which overrides may not overlap", () => {
  // The issue's Override 1: Jane covered by Bob from 1:00 PM to 5:00 PM.
  const BOBS: UserOverrideTimes = override({
    id: "o1",
    from: "13:00",
    until: "17:00",
  });

  test("the issue's case: Jane covered by Carol from 3:00 PM to 4:00 PM, inside Bob's", () => {
    const carols: UserOverrideTimes = override({
      cover: CAROL,
      from: "15:00",
      until: "16:00",
    });

    expect(UserOverrideOverlap.isConflict(carols, BOBS)).toBe(true);
    expect(UserOverrideOverlap.isConflict(BOBS, carols)).toBe(true);
  });

  test.each([
    ["around it", "12:00", "18:00"],
    ["ending inside it", "12:00", "13:01"],
    ["starting inside it", "16:59", "19:00"],
    ["at the very same times", "13:00", "17:00"],
  ])("one %s overlaps", (_how: string, from: string, until: string) => {
    expect(
      UserOverrideOverlap.isConflict(override({ from, until }), BOBS),
    ).toBe(true);
  });

  test("back to back does not, either way round", () => {
    const after: UserOverrideTimes = override({
      from: "17:00",
      until: "19:00",
    });
    const before: UserOverrideTimes = override({
      from: "11:00",
      until: "13:00",
    });

    expect(UserOverrideOverlap.doTimesOverlap(after, BOBS)).toBe(false);
    expect(UserOverrideOverlap.doTimesOverlap(BOBS, after)).toBe(false);
    expect(UserOverrideOverlap.isConflict(before, BOBS)).toBe(false);
  });

  test("a skip and a cover of the same person on the same policy do: it is Jane away twice", () => {
    expect(
      UserOverrideOverlap.isConflict(
        override({ cover: null, from: "14:00", until: "15:00" }),
        BOBS,
      ),
    ).toBe(true);
  });

  test("two global ones do, and two skips", () => {
    expect(
      UserOverrideOverlap.isConflict(
        override({ policy: null, from: "14:00", until: "15:00" }),
        override({ policy: null, from: "13:00", until: "17:00" }),
      ),
    ).toBe(true);
    expect(
      UserOverrideOverlap.isConflict(
        override({ cover: null, from: "14:00", until: "15:00" }),
        override({ cover: null, from: "13:00", until: "17:00" }),
      ),
    ).toBe(true);
  });

  test("a policy's own and a global one do not: on the policy, its own is used", () => {
    const global: UserOverrideTimes = override({
      policy: null,
      from: "14:00",
      until: "15:00",
    });

    expect(UserOverrideOverlap.isSameScope(global, BOBS)).toBe(false);
    expect(UserOverrideOverlap.isConflict(global, BOBS)).toBe(false);
  });

  test("two policies' own do not", () => {
    expect(
      UserOverrideOverlap.isConflict(
        override({ policy: SEARCH, from: "14:00", until: "15:00" }),
        BOBS,
      ),
    ).toBe(false);
  });

  test("somebody else's do not", () => {
    expect(
      UserOverrideOverlap.isConflict(
        override({ away: KIM, from: "14:00", until: "15:00" }),
        BOBS,
      ),
    ).toBe(false);
  });

  test("an override never overlaps itself, in whatever case its id is written", () => {
    const moved: UserOverrideTimes = override({
      id: "O1",
      from: "14:00",
      until: "18:00",
    });

    expect(UserOverrideOverlap.isSameOverride(moved, BOBS)).toBe(true);
    expect(UserOverrideOverlap.isConflict(moved, BOBS)).toBe(false);
  });

  test("people and policies are compared without case, as Postgres compares uuids", () => {
    expect(
      UserOverrideOverlap.isConflict(
        override({
          away: JANE.toUpperCase(),
          policy: PAYMENTS.toUpperCase(),
          from: "14:00",
          until: "15:00",
        }),
        BOBS,
      ),
    ).toBe(true);
  });

  test("an override without an id yet - one being added - is not the same as any", () => {
    expect(
      UserOverrideOverlap.isSameOverride(
        override({ from: "13:00", until: "17:00" }),
        override({ from: "13:00", until: "17:00" }),
      ),
    ).toBe(false);
  });
});

describe("the overlaps of one override among others", () => {
  const candidate: UserOverrideTimes = override({
    from: "12:00",
    until: "18:00",
  });

  const others: Array<UserOverrideTimes> = [
    override({ id: "skip", cover: null, from: "13:00", until: "14:00" }),
    override({ id: "late", cover: CAROL, from: "16:00", until: "20:00" }),
    override({ id: "early", cover: KIM, from: "11:00", until: "13:00" }),
    override({ id: "kim", away: KIM, from: "12:00", until: "18:00" }),
    override({ id: "global", policy: null, from: "12:00", until: "13:00" }),
    override({ id: "search", policy: SEARCH, from: "12:00", until: "13:00" }),
    override({ id: "after", from: "18:00", until: "19:00" }),
  ];

  test("its conflicts, the one used first first: a cover over a skip, then the one that starts first", () => {
    expect(
      UserOverrideOverlap.getConflicts(candidate, others).map(
        (other: UserOverrideTimes): string => {
          return other.id || "";
        },
      ),
    ).toEqual(["early", "late", "skip"]);
  });

  test("on a policy, the global ones it overlaps, which the rule allows", () => {
    expect(
      UserOverrideOverlap.getOtherScopeOverlaps(candidate, others).map(
        (other: UserOverrideTimes): string => {
          return other.id || "";
        },
      ),
    ).toEqual(["global"]);
  });

  test("globally, every policy's own it overlaps", () => {
    expect(
      UserOverrideOverlap.getOtherScopeOverlaps(
        override({ policy: null, from: "12:00", until: "18:00" }),
        others,
      ).map((other: UserOverrideTimes): string => {
        return other.id || "";
      }),
    ).toEqual(["early", "search", "late", "skip"]);
  });
});

describe("which of two is used where they overlap", () => {
  test("a policy's cover, a policy's skip, a global cover, a global skip, in that order", () => {
    const shuffled: Array<UserOverrideTimes> = [
      override({
        id: "global-skip",
        policy: null,
        cover: null,
        from: "08:00",
        until: "18:00",
      }),
      override({
        id: "policy-skip",
        cover: null,
        from: "11:00",
        until: "18:00",
      }),
      override({
        id: "global-cover",
        policy: null,
        from: "09:00",
        until: "18:00",
      }),
      override({ id: "policy-cover", from: "12:00", until: "18:00" }),
    ];

    expect(
      [...shuffled]
        .sort(UserOverrideOverlap.compareUse)
        .map((one: UserOverrideTimes): string => {
          return one.id || "";
        }),
    ).toEqual(["policy-cover", "policy-skip", "global-cover", "global-skip"]);
  });

  test("of two alike, the one that starts first", () => {
    const early: UserOverrideTimes = override({
      id: "b",
      from: "12:00",
      until: "18:00",
      addedAt: "11:00",
    });
    const late: UserOverrideTimes = override({
      id: "a",
      from: "13:00",
      until: "18:00",
      addedAt: "10:00",
    });

    expect(UserOverrideOverlap.compareUse(early, late)).toBeLessThan(0);
    expect(UserOverrideOverlap.getUseReason(early, late)).toBe(
      UserOverrideUseReason.StartsFirst,
    );
  });

  test("of two alike that start together, the one added first", () => {
    const first: UserOverrideTimes = override({
      id: "b",
      from: "12:00",
      until: "18:00",
      addedAt: "10:00",
    });
    const second: UserOverrideTimes = override({
      id: "a",
      from: "12:00",
      until: "18:00",
      addedAt: "11:00",
    });

    expect(UserOverrideOverlap.compareUse(first, second)).toBeLessThan(0);
    expect(UserOverrideOverlap.getUseReason(first, second)).toBe(
      UserOverrideUseReason.AddedFirst,
    );
  });

  test("of two added at once, the same one every time, whichever comes first", () => {
    const a: UserOverrideTimes = override({
      id: "A1",
      from: "12:00",
      until: "18:00",
      addedAt: "10:00",
    });
    const b: UserOverrideTimes = override({
      id: "b2",
      from: "12:00",
      until: "18:00",
      addedAt: "10:00",
    });

    expect([a, b].sort(UserOverrideOverlap.compareUse)[0]).toBe(a);
    expect([b, a].sort(UserOverrideOverlap.compareUse)[0]).toBe(a);
  });

  test("one that names who covers over a skip, whenever they start", () => {
    const cover: UserOverrideTimes = override({
      from: "15:00",
      until: "18:00",
    });
    const skip: UserOverrideTimes = override({
      cover: null,
      from: "08:00",
      until: "18:00",
    });

    expect(UserOverrideOverlap.compareUse(cover, skip)).toBeLessThan(0);
    expect(UserOverrideOverlap.getUseReason(cover, skip)).toBe(
      UserOverrideUseReason.NamesCover,
    );
  });
});

describe("the lists' Overlaps mark, for overlaps saved before the rule", () => {
  const NOON: Date = at("12:00");

  test("each of the two is marked, naming the other, and which one is used", () => {
    const bobs: UserOverrideTimes = override({
      id: "BOB-1",
      from: "13:00",
      until: "17:00",
      addedAt: "09:00",
    });
    const carols: UserOverrideTimes = override({
      id: "carol-1",
      cover: CAROL,
      from: "15:00",
      until: "19:00",
      addedAt: "08:00",
    });

    const notes: Map<
      string,
      UserOverrideOverlapNote<UserOverrideTimes>
    > = UserOverrideOverlap.getOverlapNotes([bobs, carols], NOON);

    // By id, in lower case.
    expect([...notes.keys()].sort()).toEqual(["bob-1", "carol-1"]);

    expect(notes.get("carol-1")).toEqual({
      other: bobs,
      isOtherUsed: true,
      reason: UserOverrideUseReason.StartsFirst,
    });
    expect(notes.get("bob-1")).toEqual({
      other: carols,
      isOtherUsed: false,
      reason: UserOverrideUseReason.StartsFirst,
    });
  });

  test("a skip under a cover says the cover is used, as it names who covers", () => {
    const skip: UserOverrideTimes = override({
      id: "skip",
      cover: null,
      from: "08:00",
      until: "18:00",
    });
    const cover: UserOverrideTimes = override({
      id: "cover",
      from: "13:00",
      until: "15:00",
    });

    const notes: Map<
      string,
      UserOverrideOverlapNote<UserOverrideTimes>
    > = UserOverrideOverlap.getOverlapNotes([skip, cover], NOON);

    expect(notes.get("skip")).toEqual({
      other: cover,
      isOtherUsed: true,
      reason: UserOverrideUseReason.NamesCover,
    });
    expect(notes.get("cover")?.isOtherUsed).toBe(false);
  });

  test("one inside two others names the one used instead of it", () => {
    const all: UserOverrideTimes = override({
      id: "all",
      from: "10:00",
      until: "18:00",
    });
    const first: UserOverrideTimes = override({
      id: "first",
      cover: CAROL,
      from: "11:00",
      until: "12:30",
    });
    const second: UserOverrideTimes = override({
      id: "second",
      cover: KIM,
      from: "15:00",
      until: "16:00",
    });

    const notes: Map<
      string,
      UserOverrideOverlapNote<UserOverrideTimes>
    > = UserOverrideOverlap.getOverlapNotes([all, first, second], NOON);

    // "all" is used wherever it overlaps: it names the first it overlaps.
    expect(notes.get("all")?.other).toBe(first);
    expect(notes.get("all")?.isOtherUsed).toBe(false);
    expect(notes.get("second")?.other).toBe(all);
    expect(notes.get("second")?.isOtherUsed).toBe(true);
  });

  test("where they overlap is over: nothing is said, though one of them goes on", () => {
    const morning: UserOverrideTimes = override({
      id: "morning",
      from: "08:00",
      until: "11:00",
    });
    const day: UserOverrideTimes = override({
      id: "day",
      cover: CAROL,
      from: "10:00",
      until: "18:00",
    });

    expect(UserOverrideOverlap.getOverlapNotes([morning, day], NOON).size).toBe(
      0,
    );
  });

  test("where they overlap ends right now: nothing is said either", () => {
    const morning: UserOverrideTimes = override({
      id: "morning",
      from: "08:00",
      until: "12:00",
    });
    const day: UserOverrideTimes = override({
      id: "day",
      cover: CAROL,
      from: "10:00",
      until: "18:00",
    });

    expect(UserOverrideOverlap.getOverlapNotes([morning, day], NOON).size).toBe(
      0,
    );
  });

  test("overlaps the rule allows are not marked", () => {
    const notes: Map<
      string,
      UserOverrideOverlapNote<UserOverrideTimes>
    > = UserOverrideOverlap.getOverlapNotes(
      [
        override({ id: "policy", from: "13:00", until: "17:00" }),
        override({ id: "global", policy: null, from: "13:00", until: "17:00" }),
        override({
          id: "search",
          policy: SEARCH,
          from: "13:00",
          until: "17:00",
        }),
        override({ id: "kim", away: KIM, from: "13:00", until: "17:00" }),
      ],
      NOON,
    );

    expect(notes.size).toBe(0);
  });

  test("an override without an id has no row to mark", () => {
    expect(
      UserOverrideOverlap.getOverlapNotes(
        [
          override({ from: "13:00", until: "17:00" }),
          override({ cover: CAROL, from: "13:00", until: "17:00" }),
        ],
        NOON,
      ).size,
    ).toBe(0);
  });
});

describe("what the refusal says", () => {
  const times: { from: string; until: string } = {
    from: "1:00 PM",
    until: "5:00 PM",
  };

  test("the issue's case, on a policy: who is away, who covers them, and when", () => {
    const sentence: UserOverrideSentence =
      UserOverrideOverlap.getConflictSentence({
        conflict: override({ from: "13:00", until: "17:00" }),
        awayName: "Jane",
        coverName: "Bob",
        ...times,
      });

    expect(sentence.template).toBe(USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY);
    expect(`${fill(sentence)} ${USER_OVERRIDE_CONFLICT_WHAT_TO_DO}`).toBe(
      "Jane is already covered by Bob on this policy from 1:00 PM to 5:00 PM. Change the times, or edit that override.",
    );
  });

  test("a skip on a policy: the rotation covers, and no name is asked for", () => {
    const sentence: UserOverrideSentence =
      UserOverrideOverlap.getConflictSentence({
        conflict: override({ cover: null, from: "13:00", until: "17:00" }),
        awayName: "Jane",
        coverName: "",
        ...times,
      });

    expect(sentence.template).toBe(USER_OVERRIDE_CONFLICT_SKIPPED_ON_POLICY);
    expect(fill(sentence)).toBe(
      "Jane is already away on this policy from 1:00 PM to 5:00 PM, with the next person in the rotation covering.",
    );
  });

  test("a global cover, and a global skip: on every policy", () => {
    const cover: UserOverrideSentence = UserOverrideOverlap.getConflictSentence(
      {
        conflict: override({ policy: null, from: "13:00", until: "17:00" }),
        awayName: "Jane",
        coverName: "Bob",
        ...times,
      },
    );
    const skip: UserOverrideSentence = UserOverrideOverlap.getConflictSentence({
      conflict: override({
        policy: null,
        cover: null,
        from: "13:00",
        until: "17:00",
      }),
      awayName: "Jane",
      coverName: "",
      ...times,
    });

    expect(cover.template).toBe(USER_OVERRIDE_CONFLICT_COVERED_GLOBALLY);
    expect(fill(cover)).toBe(
      "Jane is already covered by Bob on every policy from 1:00 PM to 5:00 PM.",
    );
    expect(skip.template).toBe(USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY);
    expect(fill(skip)).toBe(
      "Jane is already away on every policy from 1:00 PM to 5:00 PM, with the next person in the rotation covering.",
    );
  });
});

describe("the dialog's note on an overlap the rule allows", () => {
  const times: { from: string; until: string } = {
    from: "1:00 PM",
    until: "5:00 PM",
  };

  test("on a policy, under a global one: this override is used here", () => {
    const sentence: UserOverrideSentence =
      UserOverrideOverlap.getOtherScopeNote({
        other: override({ policy: null, from: "13:00", until: "17:00" }),
        awayName: "Jane",
        policyName: "",
        ...times,
      });

    expect(sentence.template).toBe(USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY);
    expect(fill(sentence)).toBe(
      "Jane also has a global override from 1:00 PM to 5:00 PM. On this policy, this override is used while both apply.",
    );
  });

  test("a global one over a policy's own: that policy's is used there, named", () => {
    const sentence: UserOverrideSentence =
      UserOverrideOverlap.getOtherScopeNote({
        other: override({ from: "13:00", until: "17:00" }),
        awayName: "Jane",
        policyName: "Payments",
        ...times,
      });

    expect(sentence.template).toBe(USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL);
    expect(fill(sentence)).toBe(
      "Jane also has an override on Payments from 1:00 PM to 5:00 PM. On that policy, that override is used while both apply.",
    );
  });

  test("a policy the reader can't name is one policy", () => {
    const sentence: UserOverrideSentence =
      UserOverrideOverlap.getOtherScopeNote({
        other: override({ from: "13:00", until: "17:00" }),
        awayName: "Jane",
        policyName: "",
        ...times,
      });

    expect(sentence.template).toBe(
      USER_OVERRIDE_NOTE_UNNAMED_POLICY_OVER_GLOBAL,
    );
    expect(fill(sentence)).toContain("an override on one policy");
  });
});

describe("what the Overlaps mark says", () => {
  test("its label", () => {
    expect(USER_OVERRIDE_OVERLAPS_LABEL).toBe("Overlaps");
  });

  test("what it overlaps, then which one is used there and why - every reason, both ways", () => {
    const said: Array<string> = [];

    for (const isOtherUsed of [true, false]) {
      for (const reason of Object.values(UserOverrideUseReason)) {
        const sentences: Array<UserOverrideSentence> =
          UserOverrideOverlap.getOverlapNoteSentences({
            note: {
              other: override({ cover: CAROL, from: "13:00", until: "17:00" }),
              isOtherUsed: isOtherUsed,
              reason: reason,
            },
            awayName: "Jane",
            otherCoverName: "Carol",
            from: "1:00 PM",
            until: "5:00 PM",
          });

        expect(sentences).toHaveLength(2);
        expect(sentences[0]!.template).toBe(USER_OVERRIDE_OVERLAPS_COVERED);
        expect(fill(sentences[0]!)).toBe(
          "Overlaps another override for Jane, from 1:00 PM to 5:00 PM, in which Carol covers.",
        );

        const why: string = fill(sentences[1]!);

        expect(why).toContain(
          isOtherUsed ? "that one is used" : "this one is used",
        );
        said.push(why);
      }
    }

    // Six different sentences.
    expect(new Set(said).size).toBe(6);
  });

  test("an overlap with a skip says the rotation covers in it", () => {
    const sentences: Array<UserOverrideSentence> =
      UserOverrideOverlap.getOverlapNoteSentences({
        note: {
          other: override({ cover: null, from: "13:00", until: "17:00" }),
          isOtherUsed: false,
          reason: UserOverrideUseReason.NamesCover,
        },
        awayName: "Jane",
        otherCoverName: "",
        from: "1:00 PM",
        until: "5:00 PM",
      });

    expect(sentences[0]!.template).toBe(USER_OVERRIDE_OVERLAPS_SKIPPED);
    expect(fill(sentences[0]!)).toBe(
      "Overlaps another override for Jane, from 1:00 PM to 5:00 PM, in which the next person in the rotation covers.",
    );
    expect(fill(sentences[1]!)).toBe(
      "Where they overlap, this one is used, as it names who covers.",
    );
  });
});
