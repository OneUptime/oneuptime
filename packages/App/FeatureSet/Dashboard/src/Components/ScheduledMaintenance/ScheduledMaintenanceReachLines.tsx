import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import { ScopeNotice } from "../Incident/IncidentStatusPageScopeNotices";
import {
  MaintenanceReachRecord,
  getEventSubscriberNotificationsFold,
  getEventSubscriberNotificationsSummary,
  getMaintenanceNotifyOptionsReason,
  getMaintenanceReachQuestion,
  getMaintenanceRemindersReason,
  getMaintenanceStatusPagesReason,
  getTemplateSubscriberNotificationsFold,
  getTemplateSubscriberNotificationsSummary,
} from "./ScheduledMaintenanceReach";
import useScheduledMaintenanceReach, {
  ScheduledMaintenanceReachState,
  getKeptScheduledMaintenanceReach,
} from "./useScheduledMaintenanceReach";

/*
 * What Schedule Maintenance Event and a maintenance template say of their
 * subscribers, once the server has said what the status pages picked do
 * (#9920, useScheduledMaintenanceReach): the folded Subscriber
 * Notifications line, on the form and on the review step, why nobody would
 * be told under the three boxes, and which reminders are not sent under
 * the reminders. The words are ScheduledMaintenanceReach's; each place asks
 * for itself, and one answer serves them all.
 */

export const MAINTENANCE_SUBSCRIBER_NOTIFICATIONS_LINE_TEST_ID: string =
  "maintenance-subscriber-notifications-line";

export const MAINTENANCE_NOTIFY_OPTIONS_REASON_TEST_ID: string =
  "maintenance-notify-options-reason";

export const MAINTENANCE_REMINDERS_REASON_TEST_ID: string =
  "maintenance-reminders-reason";

export const MAINTENANCE_STATUS_PAGES_REASON_TEST_ID: string =
  "maintenance-status-pages-reason";

// The answer for the form's pages, asked as the line is drawn.
const useReachFor: (
  values: unknown,
  record: MaintenanceReachRecord,
) => ScheduledMaintenanceReachState = (
  values: unknown,
  record: MaintenanceReachRecord,
): ScheduledMaintenanceReachState => {
  return useScheduledMaintenanceReach(
    getMaintenanceReachQuestion({ values: values, record: record }),
  );
};

/*
 * The folded section's line, on the form and on the review step
 * (FormFieldCollapsibleSection.getSummaryElement): the sentences for the
 * pages picked and the form's settings, each looked up on its own, as the
 * section draws its sentences.
 */
export const MaintenanceSubscriberNotificationsLine: FunctionComponent<{
  values: unknown;
  record: MaintenanceReachRecord;
}> = (props: {
  values: unknown;
  record: MaintenanceReachRecord;
}): ReactElement => {
  const { translateString } = useTranslateValue();
  const { reach }: ScheduledMaintenanceReachState = useReachFor(
    props.values,
    props.record,
  );

  const sentences: Array<string> =
    props.record === MaintenanceReachRecord.Template
      ? getTemplateSubscriberNotificationsSummary(props.values, reach)
      : getEventSubscriberNotificationsSummary(props.values, reach);

  // Each sentence on its own: a locale translates sentences, not a paragraph.
  return (
    <span data-testid={MAINTENANCE_SUBSCRIBER_NOTIFICATIONS_LINE_TEST_ID}>
      {sentences
        .map((sentence: string): string => {
          return translateString(sentence) ?? sentence;
        })
        .join(" ")}
    </span>
  );
};

/*
 * Under the three boxes, while anything is asked of the subscribers and
 * the server has said nobody would be told: why, in the amber note the
 * form's other warnings under a field use. Nothing otherwise.
 */
export const MaintenanceNotifyOptionsReason: FunctionComponent<{
  values: unknown;
  record: MaintenanceReachRecord;
}> = (props: {
  values: unknown;
  record: MaintenanceReachRecord;
}): ReactElement => {
  const { translateString } = useTranslateValue();
  const { reach }: ScheduledMaintenanceReachState = useReachFor(
    props.values,
    props.record,
  );

  const reason: string | null = getMaintenanceNotifyOptionsReason({
    values: props.values,
    record: props.record,
    reach: reach,
  });

  if (!reason) {
    return <></>;
  }

  return (
    <ScopeNotice
      text={translateString(reason) || reason}
      dataTestId={MAINTENANCE_NOTIFY_OPTIONS_REASON_TEST_ID}
    />
  );
};

/*
 * Under the status page picker on an event's Edit (#9974): what the pages
 * picked will do with it when that is nothing - it shows on none of them,
 * or it shows and tells nobody - and why, in the amber note the form's
 * other warnings under a field use. Nothing while the server's answer is
 * not known, and when a page shows the event and notifies.
 */
export const MaintenanceStatusPagesReason: FunctionComponent<{
  values: unknown;
  record: MaintenanceReachRecord;
}> = (props: {
  values: unknown;
  record: MaintenanceReachRecord;
}): ReactElement => {
  const { translateString } = useTranslateValue();
  const { reach }: ScheduledMaintenanceReachState = useReachFor(
    props.values,
    props.record,
  );

  const sentences: Array<string> = getMaintenanceStatusPagesReason({
    values: props.values,
    record: props.record,
    reach: reach,
  });

  if (sentences.length === 0) {
    return <></>;
  }

  return (
    <ScopeNotice
      text={sentences
        .map((sentence: string): string => {
          return translateString(sentence) || sentence;
        })
        .join(" ")}
      dataTestId={MAINTENANCE_STATUS_PAGES_REASON_TEST_ID}
    />
  );
};

/*
 * Under an event's reminders: which of them are not sent - due before it
 * is published, or whose time has passed. Nothing while every reminder is
 * sent, or the note above says nobody is told.
 */
export const MaintenanceRemindersReason: FunctionComponent<{
  values: unknown;
}> = (props: { values: unknown }): ReactElement => {
  const { translateString } = useTranslateValue();
  const { reach }: ScheduledMaintenanceReachState = useReachFor(
    props.values,
    MaintenanceReachRecord.Event,
  );

  const sentences: Array<string> = getMaintenanceRemindersReason({
    values: props.values,
    reach: reach,
  });

  if (sentences.length === 0) {
    return <></>;
  }

  return (
    <ScopeNotice
      text={sentences
        .map((sentence: string): string => {
          return translateString(sentence) || sentence;
        })
        .join(" ")}
      dataTestId={MAINTENANCE_REMINDERS_REASON_TEST_ID}
    />
  );
};

// The answer kept for the form's pages, for the sentences that decide the line.
const getKeptReach: (
  record: MaintenanceReachRecord,
) => (
  values: unknown,
) => ReturnType<typeof getKeptScheduledMaintenanceReach> = (
  record: MaintenanceReachRecord,
): ((
  values: unknown,
) => ReturnType<typeof getKeptScheduledMaintenanceReach>) => {
  return (
    values: unknown,
  ): ReturnType<typeof getKeptScheduledMaintenanceReach> => {
    return getKeptScheduledMaintenanceReach(
      getMaintenanceReachQuestion({ values: values, record: record }),
    );
  };
};

/*
 * Subscriber Notifications on Create Maintenance Event: when the event is
 * published, the switches and the reminders, folded to the line that says
 * what happens. Its sentences, which decide that it has a line, read the
 * answer the line was given.
 */
export const getEventSubscriberNotificationsSection: <
  TEntity,
>() => FormFieldCollapsibleSection<TEntity> = <
  TEntity,
>(): FormFieldCollapsibleSection<TEntity> => {
  return {
    ...getEventSubscriberNotificationsFold<TEntity>(
      getKeptReach(MaintenanceReachRecord.Event),
    ),
    getSummaryElement: (values: FormValues<TEntity>): ReactElement => {
      return (
        <MaintenanceSubscriberNotificationsLine
          values={values}
          record={MaintenanceReachRecord.Event}
        />
      );
    },
  };
};

/*
 * Subscriber Notifications on a maintenance template's forms: the switches
 * and the reminders of the events made from it, folded to the line that
 * says what happens on the template's status pages. On its Edit the form's
 * values carry the template's own id, which the line asks with.
 */
export const getSubscriberNotificationsSection: <
  TEntity,
>() => FormFieldCollapsibleSection<TEntity> = <
  TEntity,
>(): FormFieldCollapsibleSection<TEntity> => {
  return {
    ...getTemplateSubscriberNotificationsFold<TEntity>(
      getKeptReach(MaintenanceReachRecord.Template),
    ),
    getSummaryElement: (values: FormValues<TEntity>): ReactElement => {
      return (
        <MaintenanceSubscriberNotificationsLine
          values={values}
          record={MaintenanceReachRecord.Template}
        />
      );
    },
  };
};
