import ObjectID from "Common/Types/ObjectID";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import {
  EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE,
  MESSAGE_QUEUE_HEADLINE_CONCURRENCY,
  MessageQueueBrokerHeadline,
  MessageQueueHeadlineQueue,
  fetchMessageQueueBrokerHeadline,
  isMessageQueueHeadlineReadable,
  runWithConcurrency,
} from "./MessageQueueBrokerHeadlines";

/*
 * The broker's numbers of the queues on screen, read a few at a time as
 * they come into view and kept for the range, so filtering, focusing or
 * opening a drawer never reads a queue twice. A queue whose numbers cannot
 * exist (MessageQueueBrokerHeadlines.isMessageQueueHeadlineReadable) is
 * never read. A new range starts over.
 */

export type MessageQueueHeadlineEntry =
  | { status: "loading" }
  | { status: "ready"; headline: MessageQueueBrokerHeadline };

export default function useMessageQueueBrokerHeadlines(data: {
  projectId: ObjectID | null;
  queues: ReadonlyArray<MessageQueueHeadlineQueue>;
  window: { start: Date; end: Date } | null;
}): Map<string, MessageQueueHeadlineEntry> {
  const [entries, setEntries] = useState<
    Map<string, MessageQueueHeadlineEntry>
  >(new Map<string, MessageQueueHeadlineEntry>());
  // What is read or being read for the current range, by queue id.
  const requested: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );
  const entriesRange: MutableRefObject<string> = useRef<string>("");

  const rangeKey: string = data.window
    ? `${data.window.start.getTime()}-${data.window.end.getTime()}`
    : "";
  const readable: Array<MessageQueueHeadlineQueue> = data.window
    ? data.queues.filter((queue: MessageQueueHeadlineQueue): boolean => {
        return isMessageQueueHeadlineReadable(queue, data.window!.start);
      })
    : [];
  const queuesKey: string = readable
    .map((queue: MessageQueueHeadlineQueue): string => {
      return queue.id;
    })
    .sort()
    .join("|");

  useEffect(() => {
    if (!data.window) {
      return undefined;
    }
    let fresh: boolean = false;
    if (entriesRange.current !== rangeKey) {
      entriesRange.current = rangeKey;
      requested.current = new Set<string>();
      fresh = true;
    }
    const toRead: Array<MessageQueueHeadlineQueue> = readable.filter(
      (queue: MessageQueueHeadlineQueue): boolean => {
        return !requested.current.has(queue.id);
      },
    );
    if (toRead.length === 0) {
      if (fresh) {
        setEntries(new Map<string, MessageQueueHeadlineEntry>());
      }
      return undefined;
    }

    let cancelled: boolean = false;
    const window: { start: Date; end: Date } = data.window;
    for (const queue of toRead) {
      requested.current.add(queue.id);
    }
    setEntries(
      (
        previous: Map<string, MessageQueueHeadlineEntry>,
      ): Map<string, MessageQueueHeadlineEntry> => {
        const next: Map<string, MessageQueueHeadlineEntry> = fresh
          ? new Map<string, MessageQueueHeadlineEntry>()
          : new Map<string, MessageQueueHeadlineEntry>(previous);
        for (const queue of toRead) {
          next.set(queue.id, { status: "loading" });
        }
        return next;
      },
    );

    const pending: Set<string> = new Set<string>(
      toRead.map((queue: MessageQueueHeadlineQueue): string => {
        return queue.id;
      }),
    );

    runWithConcurrency(
      toRead,
      MESSAGE_QUEUE_HEADLINE_CONCURRENCY,
      async (queue: MessageQueueHeadlineQueue): Promise<void> => {
        // A read that fails says nothing, as a queue with no numbers does.
        let headline: MessageQueueBrokerHeadline =
          EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE;
        try {
          headline = await fetchMessageQueueBrokerHeadline({
            projectId: data.projectId,
            queue: queue,
            start: window.start,
            end: window.end,
          });
        } catch {
          headline = EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE;
        }
        if (cancelled) {
          return;
        }
        pending.delete(queue.id);
        setEntries(
          (
            previous: Map<string, MessageQueueHeadlineEntry>,
          ): Map<string, MessageQueueHeadlineEntry> => {
            const next: Map<string, MessageQueueHeadlineEntry> = new Map<
              string,
              MessageQueueHeadlineEntry
            >(previous);
            next.set(queue.id, { status: "ready", headline: headline });
            return next;
          },
        );
      },
      (): boolean => {
        return cancelled;
      },
    ).catch(() => {
      // Each queue's failure is its own (runWithConcurrency).
    });

    return () => {
      cancelled = true;
      /*
       * A reading dropped half way is not an answer: the queues it had not
       * finished are read again by the next run.
       */
      for (const id of pending) {
        requested.current.delete(id);
      }
    };
  }, [rangeKey, queuesKey, data.projectId?.toString()]);

  return entries;
}
