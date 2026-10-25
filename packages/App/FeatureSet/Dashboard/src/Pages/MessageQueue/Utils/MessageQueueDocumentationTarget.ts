import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { MessageQueueDocumentationTarget } from "./DocumentationMarkdown";
import { isMessageQueueFound } from "./MessageQueuePresentation";

/*
 * The setup guide's target for one queue: its messaging system, the
 * destination its telemetry names, and what its spans already reported
 * about the broker. Read by the queue's Documentation tab and by the guide
 * that opens once Add Queue has saved one.
 *
 * Null for a queue that is not there: a deleted or unknown id comes back as
 * an empty model, not null.
 */
export interface MessageQueueDocumentation {
  name: string;
  target: MessageQueueDocumentationTarget;
}

export async function fetchMessageQueueDocumentation(
  id: ObjectID,
): Promise<MessageQueueDocumentation | null> {
  const item: MessageQueue | null = await ModelAPI.getItem<MessageQueue>({
    modelType: MessageQueue,
    id: id,
    select: {
      name: true,
      queueIdentifier: true,
      messagingSystem: true,
      destinationName: true,
      brokerScope: true,
      brokerAddress: true,
    },
  });

  if (!item || !isMessageQueueFound(item)) {
    return null;
  }

  return {
    name: item.name || item.destinationName || "",
    target: {
      system: item.messagingSystem,
      destination: item.destinationName || item.name,
      brokerScope: item.brokerScope,
      brokerAddress: item.brokerAddress,
    },
  };
}
