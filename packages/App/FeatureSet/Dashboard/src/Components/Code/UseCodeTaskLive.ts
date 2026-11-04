import {
  CODE_TASK_LIVE_MIN_INTERVAL_MS,
  CODE_TASK_LIVE_POLL_MS,
  CODE_TASK_POLL_MS,
  getCodeTaskPollInterval,
} from "./CodeTaskLive";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import CoalescedRefresh from "Common/UI/Utils/CoalescedRefresh";
import Realtime from "Common/UI/Utils/Realtime";
import { MutableRefObject, useEffect, useRef } from "react";

export interface UseCodeTaskLiveOptions {
  // The project the task is in: its announcements are heard there.
  projectId: ObjectID | null;
  /*
   * The run whose announcements the page hears: a task's (the conversation
   * hears every turn of it), or one turn's (its Log). None, nothing is
   * heard.
   */
  recordId: string | null;
  // AI works on it: the page also reads on its own (CodeTaskLive).
  isWorking: boolean;
  // Reads what changed, quietly: the page stays as it is while it reads.
  refresh: () => Promise<void>;
  // How often a working page reads when it hears nothing (CODE_TASK_POLL_MS).
  pollMs?: number | undefined;
  // How often while it hears announcements (CODE_TASK_LIVE_POLL_MS).
  livePollMs?: number | undefined;
  // For tests: the quickest two reads follow each other.
  minIntervalMs?: number | undefined;
}

const isPageHidden: () => boolean = (): boolean => {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
};

/*
 * Keeps a Code page up with AI as it works (see CodeTaskLive.ts): it reads
 * again as soon as the run it shows is announced to have changed, and on
 * its own while AI works - every few seconds until an announcement is
 * heard, seldom while they keep coming. Announcements and the page's own
 * reads share one reader (CoalescedRefresh), so two reads never overlap. A
 * hidden tab reads nothing: it reads once, when it is looked at again.
 *
 * It joins the live connection the Dashboard keeps open and never opens
 * one: drawn where there is none (an offline page), it reads on its own.
 */
const useCodeTaskLive: (options: UseCodeTaskLiveOptions) => void = (
  options: UseCodeTaskLiveOptions,
): void => {
  const refreshRef: MutableRefObject<() => Promise<void>> = useRef<
    () => Promise<void>
  >(options.refresh);
  refreshRef.current = options.refresh;

  // When the run was last announced, as Date.now() counts.
  const lastHeardAtRef: MutableRefObject<number | null> = useRef<number | null>(
    null,
  );

  const readerRef: MutableRefObject<CoalescedRefresh | null> =
    useRef<CoalescedRefresh | null>(null);

  // A change was heard while the tab was hidden.
  const isPendingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const projectId: string = options.projectId?.toString() || "";
  const recordId: string =
    options.recordId && ObjectID.isValidUUID(options.recordId)
      ? options.recordId
      : "";
  const minIntervalMs: number =
    options.minIntervalMs ?? CODE_TASK_LIVE_MIN_INTERVAL_MS;
  const pollMs: number = options.pollMs ?? CODE_TASK_POLL_MS;
  const livePollMs: number = options.livePollMs ?? CODE_TASK_LIVE_POLL_MS;

  const request: () => void = (): void => {
    if (isPageHidden()) {
      isPendingRef.current = true;
      return;
    }

    isPendingRef.current = false;
    readerRef.current?.request();
  };

  // One reader for the record, while the page shows it.
  useEffect(() => {
    const reader: CoalescedRefresh = new CoalescedRefresh({
      refresh: (): Promise<void> => {
        return refreshRef.current();
      },
      minIntervalInMs: minIntervalMs,
    });

    readerRef.current = reader;
    lastHeardAtRef.current = null;
    isPendingRef.current = false;

    const onVisibilityChange: () => void = (): void => {
      if (isPendingRef.current && !isPageHidden()) {
        request();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return (): void => {
      reader.stop();

      if (readerRef.current === reader) {
        readerRef.current = null;
      }

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [recordId, minIntervalMs]);

  // What the server announces of the run.
  useEffect(() => {
    if (!projectId || !recordId || !Realtime.isStarted()) {
      return undefined;
    }

    return Realtime.listenToModelEvent<AIRun>(
      {
        modelType: AIRun,
        eventType: ModelEventType.Update,
        tenantId: new ObjectID(projectId),
        modelId: new ObjectID(recordId),
      },
      (): void => {
        lastHeardAtRef.current = Date.now();
        request();
      },
    );
  }, [projectId, recordId]);

  // Reads on its own while AI works.
  useEffect(() => {
    if (!options.isWorking) {
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let isStopped: boolean = false;

    const schedule: () => void = (): void => {
      timer = setTimeout(
        (): void => {
          timer = null;

          if (isStopped) {
            return;
          }

          request();
          schedule();
        },
        getCodeTaskPollInterval({
          lastHeardAt: lastHeardAtRef.current,
          now: Date.now(),
          pollMs,
          livePollMs,
        }),
      );
    };

    schedule();

    return (): void => {
      isStopped = true;

      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [options.isWorking, recordId, pollMs, livePollMs]);
};

export default useCodeTaskLive;
