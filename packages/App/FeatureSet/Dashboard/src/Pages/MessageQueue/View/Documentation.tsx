import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MessageQueueGuideCard from "../Utils/MessageQueueGuideCard";
import {
  MessageQueueDocumentationTarget,
  MessageQueueGuideVariables,
  getMessageQueueDocumentationMarkdown,
} from "../Utils/DocumentationMarkdown";
import {
  MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
  getMessageQueueSystemLabel,
  isMessageQueueFound,
} from "../Utils/MessageQueuePresentation";

/*
 * The setup guide prefilled for THIS queue: the guide of its specific
 * messaging system (an ActiveMQ queue gets ActiveMQ's, a JMS one JMS's until
 * the broker's metrics refine it), with how its telemetry finds it and what
 * its spans already reported about the broker.
 */
const MessageQueueDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [target, setTarget] = useState<MessageQueueDocumentationTarget | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: MessageQueue | null = await ModelAPI.getItem<MessageQueue>({
        modelType: MessageQueue,
        id: modelId,
        select: {
          name: true,
          queueIdentifier: true,
          messagingSystem: true,
          destinationName: true,
          brokerScope: true,
          brokerAddress: true,
        },
      });

      // A deleted or unknown id comes back as an empty model, not null.
      if (!item || !isMessageQueueFound(item)) {
        setError(MESSAGE_QUEUE_NOT_FOUND_MESSAGE);
        setIsLoading(false);
        return;
      }

      setTarget({
        system: item.messagingSystem,
        destination: item.destinationName || item.name,
        brokerScope: item.brokerScope,
        brokerAddress: item.brokerAddress,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!target) {
    return <ErrorMessage message={MESSAGE_QUEUE_NOT_FOUND_MESSAGE} />;
  }

  const buildMarkdown: (vars: MessageQueueGuideVariables) => string = (
    vars: MessageQueueGuideVariables,
  ): string => {
    return getMessageQueueDocumentationMarkdown(vars, target);
  };

  return (
    <Fragment>
      <MessageQueueGuideCard
        title={`Send ${getMessageQueueSystemLabel(target.system)} telemetry for this queue`}
        description="Instrument the applications that publish to and consume from this queue, and send its broker's metrics to OneUptime. Every value below is prefilled for this queue."
        buildMarkdown={buildMarkdown}
      />
    </Fragment>
  );
};

export default MessageQueueDocumentation;
