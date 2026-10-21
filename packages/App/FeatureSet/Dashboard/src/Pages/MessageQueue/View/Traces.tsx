import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import MessageQueueUnscopedBanner from "../../../Components/MessageQueue/MessageQueueUnscopedBanner";
import useMessageQueueTelemetryScope, {
  UseMessageQueueTelemetryScopeResult,
} from "../../../Components/MessageQueue/useMessageQueueTelemetryScope";
import { isMessageQueueScoped } from "../../../Components/MessageQueue/MessageQueueTelemetryScope";
import { MESSAGE_QUEUE_NOT_FOUND_MESSAGE } from "../Utils/MessageQueuePresentation";

/*
 * The queue's traces: every span ingest tagged with the queue's entity key —
 * the PRODUCER spans that publish to it, the CONSUMER spans that process its
 * messages, and the CLIENT / INTERNAL spans that receive or settle them —
 * whatever generation of the messaging semantic conventions named it. The
 * key is built from the queue's identifier (its identity family), so spans
 * sent before the queue was created show too.
 */
const MessageQueueTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const {
    keys,
    entityKeyDisplays,
    isLoading,
    error,
    messageQueue,
  }: UseMessageQueueTelemetryScopeResult =
    useMessageQueueTelemetryScope(modelId);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!messageQueue) {
    return <ErrorMessage message={MESSAGE_QUEUE_NOT_FOUND_MESSAGE} />;
  }

  /*
   * No key means no scope, and the viewer would fall back to every trace in
   * the project. Show what is actually true instead.
   */
  if (!isMessageQueueScoped(keys)) {
    return <MessageQueueUnscopedBanner signal="traces" />;
  }

  return (
    <Fragment>
      <TracesViewer
        entityKeysFilter={keys}
        entityKeyDisplays={entityKeyDisplays}
      />
    </Fragment>
  );
};

export default MessageQueueTraces;
