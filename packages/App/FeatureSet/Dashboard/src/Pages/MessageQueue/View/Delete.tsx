import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import { MESSAGE_QUEUE_DELETE_WARNING } from "../Utils/MessageQueuePresentation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Deleting a DISCOVERED queue does not make it go away: the next span or
 * broker metric that names it creates it again. The copy says so and points
 * at archiving, which is what actually dismisses it (and what the
 * auto-archive sweep undoes only for rows it archived itself).
 */
const MessageQueueDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <Alert
        type={AlertType.WARNING}
        strongTitle="Discovered queues come back."
        title={MESSAGE_QUEUE_DELETE_WARNING}
        className="mb-5"
        dataTestId="message-queue-delete-warning"
      />
      <ModelDelete
        modelType={MessageQueue}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.MESSAGE_QUEUES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default MessageQueueDelete;
