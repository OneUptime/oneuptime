import { TemplateValues, translationKey } from "../Translator";
import UserOverrideUtil, { UserOverrideRecord } from "./UserOverrideUtil";

/*
 * TWO OVERRIDES OF ONE PERSON MAY NOT OVERLAP IN ONE SCOPE (issue #7630).
 *
 * An override says who takes someone's pages while they are away. Two of
 * the same person's overrides in the same scope - both on one policy, or
 * both global - at the same time cannot both be followed: only one decides
 * who is paged (compareUse), and the other quietly does nothing while they
 * overlap. Jane covered by Bob from 1 PM to 5 PM and by Carol from 3 PM to
 * 7 PM paged Bob at 3:30, whoever expected Carol. So the server refuses an
 * override - added or changed - that overlaps another of the same person in
 * the same scope (OnCallDutyPolicyUserOverrideService), naming the one it
 * overlaps; the dashboard says so as soon as the times are picked, with a
 * way to edit that one instead.
 *
 * Back to back is fine: one that ends at 5 PM and one that starts at 5 PM
 * do not overlap. So is a policy's own override over a global one: on its
 * policy, the policy's own decides (UserOverrideUtil.getPrecedence), which
 * is what it is for - "Jane is away this week" for every policy, with Bob
 * named for the one policy that matters most. The dashboard says which one
 * is used there (the notes below).
 *
 * Overlaps saved before the rule stay as they were saved. Where two
 * overlap, the one used is the one that names who covers over a skip, then
 * the one that starts first, then the one added first - the order paging
 * (OnCallDutyPolicyEscalationRuleService.getAwayOverride) and the schedules
 * (OnCallDutyPolicyScheduleService) follow - and the lists mark them
 * "Overlaps", saying which one is used (getOverlapNotes).
 *
 * Pure, so the server, the dashboard and their tests share one rule and
 * one set of words. The words are English, marked as keys of the
 * Dashboard's locales (its extractor reads this file); the server says them
 * in English, the dashboard in the reader's language.
 */

export interface UserOverrideTimes extends UserOverrideRecord {
  // The override's id, once it has one: an override never overlaps itself.
  id?: string | null | undefined;
  // When it was added: of two that start together, the first added is used.
  createdAt?: Date | null | undefined;
}

// Why, of two overrides that overlap, one is used rather than the other.
export enum UserOverrideUseReason {
  // It names who covers, and the other is a skip.
  NamesCover = "NamesCover",
  StartsFirst = "StartsFirst",
  // They start together, and it was added first.
  AddedFirst = "AddedFirst",
}

/*
 * An override's overlaps with the same person's other overrides in its
 * scope, for the lists' "Overlaps" mark.
 */
export interface UserOverrideOverlapNote<T extends UserOverrideTimes> {
  // The one named: used instead of this one, or else the first it overlaps.
  other: T;
  // Whether `other` is used where they overlap (else this one is).
  isOtherUsed: boolean;
  // Why the one used is used.
  reason: UserOverrideUseReason;
}

// What a refusal or a note names: the sentence, and the values it is filled with.
export interface UserOverrideSentence {
  template: string;
  values: TemplateValues;
}

/*
 * The server's refusal, and the dashboard's as soon as the times are
 * picked: what the override overlaps.
 */
export const USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY: string = translationKey(
  "{{away}} is already covered by {{cover}} on this policy from {{from}} to {{until}}.",
);

export const USER_OVERRIDE_CONFLICT_SKIPPED_ON_POLICY: string = translationKey(
  "{{away}} is already away on this policy from {{from}} to {{until}}, with the next person in the rotation covering.",
);

export const USER_OVERRIDE_CONFLICT_COVERED_GLOBALLY: string = translationKey(
  "{{away}} is already covered by {{cover}} on every policy from {{from}} to {{until}}.",
);

export const USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY: string = translationKey(
  "{{away}} is already away on every policy from {{from}} to {{until}}, with the next person in the rotation covering.",
);

// What to do about it: the server says it after the sentence above.
export const USER_OVERRIDE_CONFLICT_WHAT_TO_DO: string = translationKey(
  "Change the times, or edit that override.",
);

/*
 * The dashboard's notes on an overlap the rule allows: a policy's own
 * override and a global one of the same person.
 */
export const USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY: string = translationKey(
  "{{away}} also has a global override from {{from}} to {{until}}. On this policy, this override is used while both apply.",
);

export const USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL: string = translationKey(
  "{{away}} also has an override on {{policy}} from {{from}} to {{until}}. On that policy, that override is used while both apply.",
);

export const USER_OVERRIDE_NOTE_UNNAMED_POLICY_OVER_GLOBAL: string =
  translationKey(
    "{{away}} also has an override on one policy from {{from}} to {{until}}. On that policy, that override is used while both apply.",
  );

/*
 * The lists' mark on an overlap saved before the rule, and its tooltip: what
 * it overlaps, then which of the two is used there, and why.
 */
export const USER_OVERRIDE_OVERLAPS_LABEL: string = translationKey("Overlaps");

export const USER_OVERRIDE_OVERLAPS_COVERED: string = translationKey(
  "Overlaps another override for {{away}}, from {{from}} to {{until}}, in which {{cover}} covers.",
);

export const USER_OVERRIDE_OVERLAPS_SKIPPED: string = translationKey(
  "Overlaps another override for {{away}}, from {{from}} to {{until}}, in which the next person in the rotation covers.",
);

const OTHER_USED: Record<UserOverrideUseReason, string> = {
  [UserOverrideUseReason.NamesCover]: translationKey(
    "Where they overlap, that one is used, as it names who covers.",
  ),
  [UserOverrideUseReason.StartsFirst]: translationKey(
    "Where they overlap, that one is used, as it starts first.",
  ),
  [UserOverrideUseReason.AddedFirst]: translationKey(
    "Where they overlap, that one is used, as it was added first.",
  ),
};

const THIS_USED: Record<UserOverrideUseReason, string> = {
  [UserOverrideUseReason.NamesCover]: translationKey(
    "Where they overlap, this one is used, as it names who covers.",
  ),
  [UserOverrideUseReason.StartsFirst]: translationKey(
    "Where they overlap, this one is used, as it starts first.",
  ),
  [UserOverrideUseReason.AddedFirst]: translationKey(
    "Where they overlap, this one is used, as it was added first.",
  ),
};

const isSameId: (
  a: string | null | undefined,
  b: string | null | undefined,
) => boolean = (
  a: string | null | undefined,
  b: string | null | undefined,
): boolean => {
  // Ids are compared without case, as Postgres compares uuids.
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
};

export default class UserOverrideOverlap {
  // The same person away.
  public static isSamePerson(
    a: UserOverrideTimes,
    b: UserOverrideTimes,
  ): boolean {
    return isSameId(a.overrideUserId, b.overrideUserId);
  }

  // Both on the same policy, or both global.
  public static isSameScope(
    a: UserOverrideTimes,
    b: UserOverrideTimes,
  ): boolean {
    if (!a.onCallDutyPolicyId || !b.onCallDutyPolicyId) {
      return !a.onCallDutyPolicyId && !b.onCallDutyPolicyId;
    }

    return isSameId(a.onCallDutyPolicyId, b.onCallDutyPolicyId);
  }

  // Their times share a moment. One that ends as the other starts does not.
  public static doTimesOverlap(
    a: UserOverrideTimes,
    b: UserOverrideTimes,
  ): boolean {
    return (
      new Date(a.startsAt).getTime() < new Date(b.endsAt).getTime() &&
      new Date(b.startsAt).getTime() < new Date(a.endsAt).getTime()
    );
  }

  public static isSameOverride(
    a: UserOverrideTimes,
    b: UserOverrideTimes,
  ): boolean {
    return isSameId(a.id, b.id);
  }

  /*
   * Whether `other` keeps `override` from being saved: another override of
   * the same person, in the same scope, at the same time.
   */
  public static isConflict(
    override: UserOverrideTimes,
    other: UserOverrideTimes,
  ): boolean {
    return (
      !UserOverrideOverlap.isSameOverride(override, other) &&
      UserOverrideOverlap.isSamePerson(override, other) &&
      UserOverrideOverlap.isSameScope(override, other) &&
      UserOverrideOverlap.doTimesOverlap(override, other)
    );
  }

  // The overrides among `others` that keep `override` from being saved, the one used first.
  public static getConflicts<T extends UserOverrideTimes>(
    override: UserOverrideTimes,
    others: Array<T>,
  ): Array<T> {
    return others
      .filter((other: T): boolean => {
        return UserOverrideOverlap.isConflict(override, other);
      })
      .sort(UserOverrideOverlap.compareUse);
  }

  /*
   * The same person's overrides of the other scope that overlap
   * `override`, which the rule allows: on a policy, a global one; globally,
   * a policy's own. Earliest first.
   */
  public static getOtherScopeOverlaps<T extends UserOverrideTimes>(
    override: UserOverrideTimes,
    others: Array<T>,
  ): Array<T> {
    return others
      .filter((other: T): boolean => {
        return (
          !UserOverrideOverlap.isSameOverride(override, other) &&
          UserOverrideOverlap.isSamePerson(override, other) &&
          !UserOverrideOverlap.isSameScope(override, other) &&
          // A policy's own override never meets another policy's.
          (!override.onCallDutyPolicyId || !other.onCallDutyPolicyId) &&
          UserOverrideOverlap.doTimesOverlap(override, other)
        );
      })
      .sort(UserOverrideOverlap.compareUse);
  }

  /*
   * Which of two overrides of the same person decides while both apply:
   * negative when `a` does. The one of higher precedence (a policy's own
   * over a global one, one that names who covers over a skip:
   * UserOverrideUtil.getPrecedence), then the one that starts first, then
   * the one added first. The ids settle two added at once, so every reader
   * picks the same one.
   */
  public static compareUse(a: UserOverrideTimes, b: UserOverrideTimes): number {
    return (
      UserOverrideUtil.getPrecedence(a) - UserOverrideUtil.getPrecedence(b) ||
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      (a.createdAt ? new Date(a.createdAt).getTime() : 0) -
        (b.createdAt ? new Date(b.createdAt).getTime() : 0) ||
      (a.id || "").toLowerCase().localeCompare((b.id || "").toLowerCase())
    );
  }

  // Why `used` is used over `other` (compareUse).
  public static getUseReason(
    used: UserOverrideTimes,
    other: UserOverrideTimes,
  ): UserOverrideUseReason {
    if (
      UserOverrideUtil.getPrecedence(used) <
      UserOverrideUtil.getPrecedence(other)
    ) {
      return UserOverrideUseReason.NamesCover;
    }

    if (
      new Date(used.startsAt).getTime() < new Date(other.startsAt).getTime()
    ) {
      return UserOverrideUseReason.StartsFirst;
    }

    return UserOverrideUseReason.AddedFirst;
  }

  /*
   * The overlaps the lists mark, by override id: each override among
   * `overrides` that overlaps another of the same person in its scope -
   * saved before the rule - where they overlap at `now` or later. It names
   * the one used instead of it, or, when it is the one used wherever it
   * overlaps, the first it overlaps.
   */
  public static getOverlapNotes<T extends UserOverrideTimes>(
    overrides: Array<T>,
    now: Date,
  ): Map<string, UserOverrideOverlapNote<T>> {
    const notes: Map<string, UserOverrideOverlapNote<T>> = new Map();

    for (const override of overrides) {
      if (!override.id) {
        continue;
      }

      const overlapping: Array<T> = UserOverrideOverlap.getConflicts(
        override,
        overrides,
      ).filter((other: T): boolean => {
        // Where they overlap is over: nothing to say about it.
        return (
          Math.min(
            new Date(override.endsAt).getTime(),
            new Date(other.endsAt).getTime(),
          ) > now.getTime()
        );
      });

      const first: T | undefined = overlapping[0];

      if (!first) {
        continue;
      }

      const isOtherUsed: boolean =
        UserOverrideOverlap.compareUse(first, override) < 0;

      notes.set(override.id.toLowerCase(), {
        other: first,
        isOtherUsed: isOtherUsed,
        reason: isOtherUsed
          ? UserOverrideOverlap.getUseReason(first, override)
          : UserOverrideOverlap.getUseReason(override, first),
      });
    }

    return notes;
  }

  /*
   * What `conflict` - an override that keeps another from being saved - is,
   * as the refusal says it: who is away, who covers them in it, and when.
   * The names and times come as the reader reads them.
   */
  public static getConflictSentence(data: {
    conflict: UserOverrideTimes;
    awayName: string;
    coverName: string;
    from: string;
    until: string;
  }): UserOverrideSentence {
    const isGlobal: boolean = !data.conflict.onCallDutyPolicyId;
    const isSkip: boolean = UserOverrideUtil.isSkip(data.conflict);

    let template: string = USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY;

    if (isGlobal) {
      template = isSkip
        ? USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY
        : USER_OVERRIDE_CONFLICT_COVERED_GLOBALLY;
    } else if (isSkip) {
      template = USER_OVERRIDE_CONFLICT_SKIPPED_ON_POLICY;
    }

    return {
      template: template,
      values: {
        away: data.awayName,
        ...(isSkip ? {} : { cover: data.coverName }),
        from: data.from,
        until: data.until,
      },
    };
  }

  /*
   * The note on an overlap the rule allows (getOtherScopeOverlaps): which
   * of the two is used there.
   */
  public static getOtherScopeNote(data: {
    other: UserOverrideTimes;
    awayName: string;
    policyName: string;
    from: string;
    until: string;
  }): UserOverrideSentence {
    if (!data.other.onCallDutyPolicyId) {
      return {
        template: USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY,
        values: { away: data.awayName, from: data.from, until: data.until },
      };
    }

    if (!data.policyName) {
      return {
        template: USER_OVERRIDE_NOTE_UNNAMED_POLICY_OVER_GLOBAL,
        values: { away: data.awayName, from: data.from, until: data.until },
      };
    }

    return {
      template: USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL,
      values: {
        away: data.awayName,
        policy: data.policyName,
        from: data.from,
        until: data.until,
      },
    };
  }

  // The "Overlaps" mark's tooltip, in its two sentences.
  public static getOverlapNoteSentences(data: {
    note: UserOverrideOverlapNote<UserOverrideTimes>;
    awayName: string;
    otherCoverName: string;
    from: string;
    until: string;
  }): Array<UserOverrideSentence> {
    const isOtherSkip: boolean = UserOverrideUtil.isSkip(data.note.other);

    return [
      {
        template: isOtherSkip
          ? USER_OVERRIDE_OVERLAPS_SKIPPED
          : USER_OVERRIDE_OVERLAPS_COVERED,
        values: {
          away: data.awayName,
          ...(isOtherSkip ? {} : { cover: data.otherCoverName }),
          from: data.from,
          until: data.until,
        },
      },
      {
        template: data.note.isOtherUsed
          ? OTHER_USED[data.note.reason]
          : THIS_USED[data.note.reason],
        values: {},
      },
    ];
  }
}
