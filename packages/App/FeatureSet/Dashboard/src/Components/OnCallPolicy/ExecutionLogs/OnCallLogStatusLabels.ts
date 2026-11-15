import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { PASS_ON_PAGE_TEXT } from "../PassOn/PassOnPage";

/*
 * THE ON-CALL LOGS' STATUSES, IN WORDS.
 *
 * A policy's Execution Logs, a run's Execution Timeline and User Settings >
 * Notification Logs draw each status as a pill, and their Status filters
 * offer it in the same words while filtering by the stored value. Each word
 * is a key of the Dashboard's locales, so the pill, the filter's menu and its
 * chip read alike in the reader's language. A page somebody escalated is
 * stored "Passed On" and reads "Escalated" (PassedOnStatus).
 */

// A policy run's status (OnCallDutyPolicyExecutionLog).
export const ON_CALL_POLICY_RUN_STATUS_LABELS: Record<
  OnCallDutyPolicyStatus,
  string
> = {
  [OnCallDutyPolicyStatus.Waiting]: translationKey("Waiting"),
  [OnCallDutyPolicyStatus.Scheduled]: translationKey("Scheduled"),
  [OnCallDutyPolicyStatus.Started]: translationKey("Started"),
  [OnCallDutyPolicyStatus.Executing]: translationKey("Executing"),
  [OnCallDutyPolicyStatus.Completed]: translationKey("Execution Completed"),
  [OnCallDutyPolicyStatus.CompletedWithNoNotifications]: translationKey(
    "Execution Completed - No One Notified",
  ),
  [OnCallDutyPolicyStatus.Error]: translationKey("Error"),
};

export function getOnCallPolicyRunStatusFilterOptions(): Array<DropdownOption> {
  return Object.values(OnCallDutyPolicyStatus).map(
    (status: OnCallDutyPolicyStatus): DropdownOption => {
      return { value: status, label: ON_CALL_POLICY_RUN_STATUS_LABELS[status] };
    },
  );
}

// A line of a run's Execution Timeline: one person paged at one level.
export const ON_CALL_TIMELINE_STATUS_LABELS: Record<
  OnCallDutyExecutionLogTimelineStatus,
  string
> = {
  [OnCallDutyExecutionLogTimelineStatus.Skipped]: translationKey("Skipped"),
  [OnCallDutyExecutionLogTimelineStatus.Started]: translationKey("Started"),
  [OnCallDutyExecutionLogTimelineStatus.Executing]: translationKey("Executing"),
  [OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged]:
    translationKey("Successfully Acknowledged"),
  [OnCallDutyExecutionLogTimelineStatus.NotificationSent]:
    translationKey("Notification Sent"),
  [OnCallDutyExecutionLogTimelineStatus.Error]: translationKey("Error"),
  [OnCallDutyExecutionLogTimelineStatus.PassedOn]:
    PASS_ON_PAGE_TEXT.passedOnStatus,
};

export function getOnCallTimelineStatusFilterOptions(): Array<DropdownOption> {
  return Object.values(OnCallDutyExecutionLogTimelineStatus).map(
    (status: OnCallDutyExecutionLogTimelineStatus): DropdownOption => {
      return { value: status, label: ON_CALL_TIMELINE_STATUS_LABELS[status] };
    },
  );
}

// A page of yours, in User Settings > Notification Logs (UserOnCallLog).
export const USER_ON_CALL_LOG_STATUS_LABELS: Record<
  UserNotificationExecutionStatus,
  string
> = {
  [UserNotificationExecutionStatus.Scheduled]: translationKey("Scheduled"),
  [UserNotificationExecutionStatus.Started]: translationKey("Started"),
  [UserNotificationExecutionStatus.Executing]: translationKey("Executing"),
  [UserNotificationExecutionStatus.Completed]: translationKey("Completed"),
  [UserNotificationExecutionStatus.Error]: translationKey("Error"),
  [UserNotificationExecutionStatus.PassedOn]: PASS_ON_PAGE_TEXT.passedOnStatus,
};

export function getUserOnCallLogStatusFilterOptions(): Array<DropdownOption> {
  return Object.values(UserNotificationExecutionStatus).map(
    (status: UserNotificationExecutionStatus): DropdownOption => {
      return { value: status, label: USER_ON_CALL_LOG_STATUS_LABELS[status] };
    },
  );
}
