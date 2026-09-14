import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS } from "Common/Types/Rum/SessionReplay";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";
import {
  formatSessionReplayRetention,
  SESSION_REPLAY_RETENTION_OPTIONS,
} from "./SessionReplayRetention";

export interface ComponentProps {
  rumApplicationId: ObjectID;
}

/**
 * Session Replay has its own retention policy because recordings are more
 * sensitive and much larger than ordinary RUM telemetry. The same field is
 * also editable on Replay Policy; keeping this small card on the general
 * Settings page makes every data-retention control discoverable together.
 */
const SessionReplayRetentionSettingsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardModelDetail<RumApplication>
      name="Session Replay Retention"
      cardProps={{
        title: "Session Replay Retention",
        description:
          "Choose how long this application's session recordings and session metadata are retained. This policy is separate from logs, traces, metrics and profiles.",
      }}
      isEditable={true}
      editButtonText="Edit Replay Retention"
      formFields={[
        {
          field: { sessionReplayRetentionInDays: true },
          title: "Retain Session Replays For",
          description:
            "Recordings and their session metadata expire together. Seven days is the default because replay can contain sensitive end-user activity.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: SESSION_REPLAY_RETENTION_OPTIONS,
          required: true,
          defaultValue: DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
          dataTestId: "session-replay-retention-days",
        },
      ]}
      modelDetailProps={{
        modelType: RumApplication,
        id: "rum-application-session-replay-retention",
        modelId: props.rumApplicationId,
        fields: [
          {
            field: { sessionReplayRetentionInDays: true },
            title: "Retain Session Replays For",
            description:
              "The session row and its recording expire together. Related logs, traces and exceptions follow telemetry retention instead.",
            fieldType: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {formatSessionReplayRetention(
                    item.sessionReplayRetentionInDays,
                  )}
                </span>
              );
            },
          },
        ],
      }}
    />
  );
};

export default SessionReplayRetentionSettingsCard;
