import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Label from "Common/Models/DatabaseModels/Label";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "Common/Types/ObjectID";
import Detail from "Common/UI/Components/Detail/Detail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";
import NextReminderCountdown from "./NextReminderCountdown";
import ReminderRuleScope from "./ReminderRuleScope";
import RemindersSwitchCopy, {
  getRemindersSwitchDescription,
  REMINDERS_DETAILS_ID,
  REMINDERS_SWITCH_COLUMN,
  REMINDERS_SWITCH_SCOPE_COPY,
  REMINDERS_SWITCH_TEST_ID,
} from "./RemindersSwitchCopy";

/*
 * "Reminders", on an incident's, an alert's or a scheduled maintenance
 * event's Settings page: one switch, "Send reminders", that saves the
 * moment it is flipped, with two read-only lines under it - when the next
 * reminder goes out (NextReminderCountdown) and how many were sent.
 *
 * Turning reminders off or on makes the server work out the next reminder
 * again (the services' refreshReminderSchedule), so the card reads the
 * record again after every save (ModelSwitchCard's getDetails). Until that
 * read is back, the lines follow the switch: a switch that was just turned
 * off shows no countdown.
 *
 * See RemindersSwitchCopy for what it replaced.
 */

export interface ComponentProps {
  scope: ReminderRuleScope;
  modelId: ObjectID;
}

// What the lines under the switch read from the record.
interface ReminderFacts {
  nextReminderNotificationAt?: Date | undefined;
  reminderNotificationSentCount?: number | undefined;
  // The incident's or the alert's severity: reminder rules can match on it.
  severityId?: ObjectID | undefined;
  labels?: Array<Label> | undefined;
}

interface ReminderDetailsProps {
  scope: ReminderRuleScope;
  facts: ReminderFacts;
  isOn: boolean;
}

const ReminderDetails: FunctionComponent<ReminderDetailsProps> = (
  props: ReminderDetailsProps,
): ReactElement => {
  return (
    <Detail<ReminderFacts>
      id={REMINDERS_DETAILS_ID}
      item={props.facts}
      showDetailsInNumberOfColumns={1}
      fields={[
        {
          key: "nextReminderNotificationAt",
          title: RemindersSwitchCopy.nextReminderTitle,
          fieldType: FieldType.Element,
          getElement: (): ReactElement => {
            return (
              <NextReminderCountdown
                nextReminderAt={
                  props.isOn ? props.facts.nextReminderNotificationAt : null
                }
                severityId={props.facts.severityId}
                labelIds={(props.facts.labels || []).map(
                  (label: Label): ObjectID => {
                    return label.id!;
                  },
                )}
                scope={props.scope}
                remindersEnabled={props.isOn}
              />
            );
          },
        },
        {
          key: "reminderNotificationSentCount",
          title: RemindersSwitchCopy.remindersSentTitle,
          fieldType: FieldType.Element,
          getElement: (): ReactElement => {
            return (
              <span className="tabular-nums">
                {props.facts.reminderNotificationSentCount || 0}
              </span>
            );
          },
        },
      ]}
    />
  );
};

const RemindersCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const cardDescription: string =
    REMINDERS_SWITCH_SCOPE_COPY[props.scope].cardDescription;

  const getDescription: (isOn: boolean) => string = (isOn: boolean): string => {
    return getRemindersSwitchDescription({ scope: props.scope, isOn });
  };

  const getDetails: (facts: ReminderFacts, isOn: boolean) => ReactElement = (
    facts: ReminderFacts,
    isOn: boolean,
  ): ReactElement => {
    return <ReminderDetails scope={props.scope} facts={facts} isOn={isOn} />;
  };

  if (props.scope === ReminderRuleScope.Alert) {
    return (
      <ModelSwitchCard<Alert>
        modelType={Alert}
        modelId={props.modelId}
        column={REMINDERS_SWITCH_COLUMN}
        cardTitle={RemindersSwitchCopy.cardTitle}
        cardDescription={cardDescription}
        title={RemindersSwitchCopy.switchTitle}
        getDescription={getDescription}
        select={{
          nextReminderNotificationAt: true,
          reminderNotificationSentCount: true,
          alertSeverityId: true,
          labels: {
            _id: true,
          },
        }}
        getDetails={(item: Alert, isOn: boolean): ReactElement => {
          return getDetails(
            {
              nextReminderNotificationAt: item.nextReminderNotificationAt,
              reminderNotificationSentCount: item.reminderNotificationSentCount,
              severityId: item.alertSeverityId,
              labels: item.labels,
            },
            isOn,
          );
        }}
        dataTestId={REMINDERS_SWITCH_TEST_ID}
      />
    );
  }

  if (props.scope === ReminderRuleScope.ScheduledMaintenance) {
    return (
      <ModelSwitchCard<ScheduledMaintenance>
        modelType={ScheduledMaintenance}
        modelId={props.modelId}
        column={REMINDERS_SWITCH_COLUMN}
        cardTitle={RemindersSwitchCopy.cardTitle}
        cardDescription={cardDescription}
        title={RemindersSwitchCopy.switchTitle}
        getDescription={getDescription}
        select={{
          nextReminderNotificationAt: true,
          reminderNotificationSentCount: true,
          labels: {
            _id: true,
          },
        }}
        getDetails={(
          item: ScheduledMaintenance,
          isOn: boolean,
        ): ReactElement => {
          return getDetails(
            {
              nextReminderNotificationAt: item.nextReminderNotificationAt,
              reminderNotificationSentCount: item.reminderNotificationSentCount,
              labels: item.labels,
            },
            isOn,
          );
        }}
        dataTestId={REMINDERS_SWITCH_TEST_ID}
      />
    );
  }

  return (
    <ModelSwitchCard<Incident>
      modelType={Incident}
      modelId={props.modelId}
      column={REMINDERS_SWITCH_COLUMN}
      cardTitle={RemindersSwitchCopy.cardTitle}
      cardDescription={cardDescription}
      title={RemindersSwitchCopy.switchTitle}
      getDescription={getDescription}
      select={{
        nextReminderNotificationAt: true,
        reminderNotificationSentCount: true,
        incidentSeverityId: true,
        labels: {
          _id: true,
        },
      }}
      getDetails={(item: Incident, isOn: boolean): ReactElement => {
        return getDetails(
          {
            nextReminderNotificationAt: item.nextReminderNotificationAt,
            reminderNotificationSentCount: item.reminderNotificationSentCount,
            severityId: item.incidentSeverityId,
            labels: item.labels,
          },
          isOn,
        );
      }}
      dataTestId={REMINDERS_SWITCH_TEST_ID}
    />
  );
};

export default RemindersCard;
