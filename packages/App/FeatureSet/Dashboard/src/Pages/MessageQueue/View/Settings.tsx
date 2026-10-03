import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { useParams } from "react-router-dom";
import {
  MessageQueueViewOutletContext,
  useMessageQueueViewOutletContext,
} from "../Utils/MessageQueueViewOutletContext";
import { MESSAGE_QUEUE_NAME_HELP } from "../Utils/MessageQueuePresentation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A queue's own settings: its name, description and labels, and archiving.
 * No retention card: a queue owns no telemetry of its own — its spans belong
 * to the services that publish and consume, its broker metrics to the
 * collector's resource — so there is nothing stored AS the queue to keep for
 * longer or shorter.
 *
 * The id is read with useParams, not a fixed URL segment: this page is also
 * reached as ".../settings/" and ".../settings?source=overview".
 */
const MessageQueueSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  // A rename must reach the page header, which the layout reads once.
  const { refreshMessageQueueHeader }: MessageQueueViewOutletContext =
    useMessageQueueViewOutletContext();

  return (
    <Fragment>
      <CardModelDetail<MessageQueue>
        name="Queue Settings"
        onSaveSuccess={(): void => {
          refreshMessageQueueHeader();
        }}
        cardProps={{
          title: "Queue Settings",
          description: "Manage the name, description and labels of this queue.",
        }}
        isEditable={true}
        editButtonText="Edit Queue"
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Order events",
            description: MESSAGE_QUEUE_NAME_HELP,
            /*
             * No minimum length: a queue is named after its destination,
             * and a one-character destination ("q") is a real queue. The
             * form checks the prefilled name on every save, so a minimum
             * would block editing such a queue's description or labels.
             */
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Order events from checkout to fulfilment",
          },
          getLabelsFormField<MessageQueue>(),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: MessageQueue,
          id: "model-detail-message-queue",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              placeholder: "No description",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: MessageQueue): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
        }}
      />
      <ArchiveResourceCard<MessageQueue>
        modelType={MessageQueue}
        modelId={modelId}
        singularName="queue"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MESSAGE_QUEUES] as Route,
        )}
      />
    </Fragment>
  );
};

export default MessageQueueSettings;
