import UserElement from "../User/User";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export enum AlertType {
  Ack,
  Resolve,
}

export interface ComponentProps {
  alertId: ObjectID;
  alertTimeline: Array<AlertStateTimeline>;
  alertType: AlertType;
  onActionComplete: () => void;
}

const ChangeAlertState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [alertTimeline, setAlertTimeline] = useState<
    AlertStateTimeline | undefined
  >(undefined);

  const [showModal, setShowModal] = useState<boolean>(false);

  useEffect(() => {
    for (const event of props.alertTimeline) {
      if (
        event.alertState &&
        (event.alertState.isAcknowledgedState ||
          event.alertState.isResolvedState) &&
        props.alertType === AlertType.Ack &&
        event.id
      ) {
        setAlertTimeline(event);
      }

      if (
        event.alertState &&
        event.alertState.isResolvedState &&
        props.alertType === AlertType.Resolve &&
        event.id
      ) {
        setAlertTimeline(event);
      }
    }
  }, [props.alertTimeline]);

  if (alertTimeline && alertTimeline.createdAt) {
    return (
      <div>
        {alertTimeline.createdByUser && (
          <UserElement user={alertTimeline.createdByUser} />
        )}
        {!alertTimeline.createdByUser && (
          <p>
            {props.alertType === AlertType.Ack ? "Acknowledged" : "Resolved"} by
            OneUptime
          </p>
        )}
        {OneUptimeDate.getDateAsLocalFormattedString(alertTimeline.createdAt)}
      </div>
    );
  }

  return (
    <div className="-ml-3 mt-1">
      <Button
        buttonSize={ButtonSize.Small}
        title={
          props.alertType === AlertType.Ack
            ? "Acknowledge Alert"
            : "Resolve Alert"
        }
        icon={
          props.alertType === AlertType.Ack
            ? IconProp.Circle
            : IconProp.CheckCircle
        }
        buttonStyle={
          props.alertType === AlertType.Ack
            ? ButtonStyleType.WARNING_OUTLINE
            : ButtonStyleType.SUCCESS_OUTLINE
        }
        onClick={async () => {
          setShowModal(true);
        }}
      />

      {showModal && (
        <ModelFormModal
          modelType={AlertStateTimeline}
          name={
            props.alertType === AlertType.Ack
              ? "Acknowledge Alert"
              : "Resolve Alert"
          }
          title={
            props.alertType === AlertType.Ack
              ? "Acknowledge Alert"
              : "Resolve Alert"
          }
          description={
            props.alertType === AlertType.Ack
              ? "Mark this alert as acknowledged."
              : "Mark this alert as resolved."
          }
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText="Save"
          onBeforeCreate={async (model: AlertStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            const alertStates: ListResult<AlertState> =
              await ModelAPI.getList<AlertState>({
                modelType: AlertState,
                query: {
                  projectId: projectId,
                },
                limit: 99,
                skip: 0,
                select: {
                  _id: true,
                  isResolvedState: true,
                  isAcknowledgedState: true,
                  isCreatedState: true,
                },
                sort: {},
                requestOptions: {},
              });

            let stateId: ObjectID | null = null;

            for (const state of alertStates.data) {
              if (
                props.alertType === AlertType.Ack &&
                state.isAcknowledgedState
              ) {
                stateId = state.id;
                break;
              }

              if (
                props.alertType === AlertType.Resolve &&
                state.isResolvedState
              ) {
                stateId = state.id;
                break;
              }
            }

            if (!stateId) {
              throw new BadDataException("Alert State not found.");
            }

            model.projectId = projectId;
            model.alertId = props.alertId;
            model.alertStateId = stateId;

            return model;
          }}
          onSuccess={() => {
            setShowModal(false);
            props.onActionComplete();
          }}
          formProps={{
            name: "create-scheduled-maintenance-state-timeline",
            modelType: AlertStateTimeline,
            id: "create-scheduled-maintenance-state-timeline",
            fields: [
              {
                field: {
                  publicNote: true,
                } as any,
                fieldType: FormFieldSchemaType.Markdown,
                description:
                  "Post a public note about this state change to the status page.",
                title: "Public Note",
                required: false,
                overrideFieldKey: "publicNote",
                showEvenIfPermissionDoesNotExist: true,
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}
    </div>
  );
};

export default ChangeAlertState;
