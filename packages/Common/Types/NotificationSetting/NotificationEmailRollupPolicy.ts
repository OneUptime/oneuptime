import NotificationSettingEventType from "./NotificationSettingEventType";

/*
 * Why this file exists: burst coalescing holds an owner email back for a few
 * minutes so the fourth-and-later message of a flood can arrive as one. That
 * trade is fine for "an incident you own changed state" and unacceptable for
 * "you are on call now". This file is the single place that decides which is
 * which, and it is pure - no imports beyond the enum - so the runtime write
 * path and the ratchet test read exactly the same constants with no mocks
 * between them.
 */

/*
 * Time-critical on-call mail. Never held back, never counted, never written to
 * the queue table at all.
 *
 * A five-minute coalescing window eats a thirty-minute shift lead time, which
 * is the entire value of "your shift starts soon". And "you are on call now",
 * delayed, is a missed page - the one failure mode an incident tool is not
 * allowed to have. The saving from rolling these up would be nil anyway: they
 * fire once per roster transition, not per resource, so they are not what
 * floods anyone's inbox.
 */
export const NEVER_ROLLED_UP_EVENT_TYPES: ReadonlySet<NotificationSettingEventType> =
  new Set<NotificationSettingEventType>([
    NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
    NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
    NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
    NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
    NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
  ]);

/*
 * SHRINK-ONLY. These two carry ON_CALL in their member name and are still
 * rollup-eligible, which is the one place in this feature where the obvious
 * reading of "never delay on-call mail" is deliberately not followed. The
 * reasoning, in full, because anyone auditing this file will stop here:
 *
 * They are configuration notices, not pages. "You were added to an on-call
 * policy" carries no deadline; nothing about it is actionable in the next five
 * minutes, and nobody is being asked to acknowledge anything. The escalation
 * pages that ARE time-critical do not pass through here at all - they call
 * MailService directly from UserNotificationRuleService and never consult
 * UserNotificationSetting - so nothing about this decision can reach them.
 *
 * And they are high volume in exactly the shape burst coalescing exists to
 * fix: they fan out per user per escalation rule, from six call sites
 * (Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService.ts:136 and
 * :370, ...RuleTeamService.ts:117/:153/:318/:355, and
 * ...RuleScheduleService.ts:270/:307/:495/:532). Adding a twenty-person team
 * to a five-rule policy is one hundred emails out of one admin click.
 * Excluding them would give away most of the real volume for no safety gain.
 *
 * Nothing may be ADDED to this list without a deliberate edit to
 * Common/Tests/Types/NotificationSetting/NotificationEmailRollupPolicy.test.ts,
 * which pins its exact membership. That is on purpose: the next member someone
 * is tempted to add here is far more likely to be a page than these two are.
 */
export const ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES: ReadonlySet<NotificationSettingEventType> =
  new Set<NotificationSettingEventType>([
    NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
    NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
  ]);

/*
 * Everything else - the other 42 members. Derived from the enum by exclusion
 * rather than listed by hand, so the two sets are a partition by construction
 * and cannot drift: there is no edit that adds a member to both, and no edit
 * that drops one from both.
 */
export const ROLLUP_ELIGIBLE_EVENT_TYPES: ReadonlySet<NotificationSettingEventType> =
  new Set<NotificationSettingEventType>(
    Object.values(NotificationSettingEventType).filter(
      (eventType: NotificationSettingEventType): boolean => {
        return !NEVER_ROLLED_UP_EVENT_TYPES.has(eventType);
      },
    ),
  );

export type IsRollupEligibleFunction = (
  eventType: NotificationSettingEventType,
) => boolean;

/*
 * A POSITIVE allow-list, not `!NEVER_ROLLED_UP_EVENT_TYPES.has(...)`. The two
 * are equivalent for every real enum member and deliberately different for a
 * value that is not one - a string cast in from the database, or a member a
 * newer build wrote and this one has never heard of. Under the allow-list such
 * a value is sent immediately, which is exactly what the product does today
 * and therefore the only safe answer. Under a deny-list it would be silently
 * coalesced, which is a behaviour change nobody asked for arriving through the
 * one path least likely to be noticed.
 *
 * The other half of the ratchet lives in NotificationEmailRollupCategory: a
 * genuinely new enum member is picked up here by Object.values and is
 * rollup-eligible by default, but it cannot compile until the exhaustive
 * Record over there classifies it, so nobody adds one without reading this
 * file.
 */
export const isRollupEligible: IsRollupEligibleFunction = (
  eventType: NotificationSettingEventType,
): boolean => {
  return ROLLUP_ELIGIBLE_EVENT_TYPES.has(eventType);
};
