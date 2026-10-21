import {
  MessageQueueScopeSource,
  buildMessageQueueEntityKeyDisplays,
  getMessageQueueScopeKeys,
} from "./MessageQueueTelemetryScope";
import {
  MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
  isMessageQueueFound,
} from "../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import { LockedEntityKeyDisplayMap } from "../../Utils/LockedEntityKeyChips";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useMemo, useState } from "react";

/*
 * Loads what a Queue's telemetry tabs scope by — the row's project and its
 * queueIdentifier — and derives the entity-key set and the locked chip's
 * name from them through MessageQueueTelemetryScope. The Traces and Metrics
 * tabs both read this one hook so neither can build the scope differently,
 * and each checks `keys.length` before it mounts a viewer (an empty set is
 * "unscoped", never "the whole project") — the way
 * useDatabaseServerTelemetryScope serves a database's tabs.
 */

export interface UseMessageQueueTelemetryScopeResult {
  messageQueue: MessageQueue | null;
  keys: Array<string>;
  entityKeyDisplays: LockedEntityKeyDisplayMap;
  isLoading: boolean;
  error: string;
}

const useMessageQueueTelemetryScope: (
  modelId: ObjectID,
) => UseMessageQueueTelemetryScopeResult = (
  modelId: ObjectID,
): UseMessageQueueTelemetryScopeResult => {
  const [messageQueue, setMessageQueue] = useState<MessageQueue | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let ignore: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      setMessageQueue(null);
      try {
        const item: MessageQueue | null = await ModelAPI.getItem<MessageQueue>({
          modelType: MessageQueue,
          id: modelId,
          select: {
            name: true,
            projectId: true,
            queueIdentifier: true,
            messagingSystem: true,
          },
        });

        if (ignore) {
          return;
        }

        // A deleted or unknown id comes back as an empty model, not null.
        if (!item || !isMessageQueueFound(item)) {
          setError(MESSAGE_QUEUE_NOT_FOUND_MESSAGE);
          setIsLoading(false);
          return;
        }

        setMessageQueue(item);
      } catch (err) {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!ignore) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!ignore) {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      ignore = true;
    };
  }, [modelId.toString()]);

  const source: MessageQueueScopeSource = useMemo(() => {
    return {
      projectId: messageQueue?.projectId || ProjectUtil.getCurrentProjectId(),
      queueIdentifier: messageQueue?.queueIdentifier,
      name: messageQueue?.name,
      messagingSystem: messageQueue?.messagingSystem,
    };
  }, [messageQueue]);

  /*
   * Memoised on the loaded row: the viewers key their query and chip memos
   * on the identity of these values.
   */
  const keys: Array<string> = useMemo(() => {
    return messageQueue ? getMessageQueueScopeKeys(source) : [];
  }, [source]);

  const entityKeyDisplays: LockedEntityKeyDisplayMap = useMemo(() => {
    return messageQueue ? buildMessageQueueEntityKeyDisplays(source) : {};
  }, [source]);

  return {
    messageQueue,
    keys,
    entityKeyDisplays,
    isLoading,
    error,
  };
};

export default useMessageQueueTelemetryScope;
