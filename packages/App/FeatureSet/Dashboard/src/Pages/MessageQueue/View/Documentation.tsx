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
import MessageQueueDocumentationCard from "../Utils/MessageQueueDocumentationCard";
import {
  MessageQueueDocumentationTarget,
  getMessageQueueDocumentationHeading,
} from "../Utils/DocumentationMarkdown";
import {
  MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
  isMessageQueueFound,
} from "../Utils/MessageQueuePresentation";

/*
 * The setup guide prefilled for THIS queue: the guide of its specific
 * messaging system (an ActiveMQ queue gets ActiveMQ's, a JMS one JMS's until
 * the broker's metrics refine it), with how its telemetry finds it and what
 * its spans already reported about the broker — the product's guide card
 * without its system picker, since a queue's system is fixed.
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

  // The heading follows the guide's own steps (see the helper).
  const heading: { title: string; description: string } =
    getMessageQueueDocumentationHeading(target);

  return (
    <Fragment>
      <MessageQueueDocumentationCard
        title={heading.title}
        description={heading.description}
        queue={target}
      />
    </Fragment>
  );
};

export default MessageQueueDocumentation;
