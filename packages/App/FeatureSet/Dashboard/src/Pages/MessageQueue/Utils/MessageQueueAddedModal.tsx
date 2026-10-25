import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourceAddedModal from "../../../Components/ResourceOnboarding/ResourceAddedModal";
import { SetupGuideFrameProps } from "../../../Components/SetupGuide/SetupGuideCard";
import PageMap from "../../../Utils/PageMap";
import MessageQueueDocumentationCard from "./MessageQueueDocumentationCard";
import { getMessageQueueDocumentationHeading } from "./DocumentationMarkdown";
import {
  MessageQueueDocumentation,
  fetchMessageQueueDocumentation,
} from "./MessageQueueDocumentationTarget";
import { MESSAGE_QUEUE_NOT_FOUND_MESSAGE } from "./MessageQueuePresentation";

/*
 * Add Queue saves the queue; its backlog, lag and dead letters come from
 * the broker's metrics, and its throughput from the apps that use it. So
 * once the form has saved one, its guide opens on its own - the queue's
 * Documentation tab, for its messaging system - and its last step says when
 * the queue's first data arrived.
 */

export const MESSAGE_QUEUE_ADDED_VIEW_TEXT: string =
  translationKey("View queue");

export interface ComponentProps {
  queueId: ObjectID;
  // The name the form saved, shown while the guide loads.
  name: string;
  onClose: () => void;
}

const MessageQueueAddedModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [queue, setQueue] = useState<MessageQueueDocumentation | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isMounted: boolean = true;

    fetchMessageQueueDocumentation(props.queueId)
      .then((found: MessageQueueDocumentation | null) => {
        if (!isMounted) {
          return;
        }
        if (!found) {
          setError(MESSAGE_QUEUE_NOT_FOUND_MESSAGE);
          return;
        }
        setQueue(found);
      })
      .catch((err: Error) => {
        if (isMounted) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [props.queueId.toString()]);

  const heading: { title: string; description: string } | null = queue
    ? getMessageQueueDocumentationHeading(queue.target)
    : null;

  return (
    <ResourceAddedModal
      title={heading?.title || props.name}
      description={heading?.description || ""}
      modelType={MessageQueue}
      recordId={props.queueId}
      name={queue?.name || props.name}
      viewPage={PageMap.MESSAGE_QUEUE_VIEW}
      viewText={MESSAGE_QUEUE_ADDED_VIEW_TEXT}
      isLoading={!queue && !error}
      error={error || undefined}
      onClose={props.onClose}
      renderGuide={(frame: SetupGuideFrameProps): ReactElement => {
        return (
          <MessageQueueDocumentationCard
            title={heading?.title || ""}
            description={heading?.description || ""}
            queue={queue?.target}
            isBare={frame.isBare}
            lastStep={frame.lastStep}
          />
        );
      }}
    />
  );
};

export default MessageQueueAddedModal;
