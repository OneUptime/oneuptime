import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import CoalescedRefresh from "../../Utils/CoalescedRefresh";
import Realtime from "../../Utils/Realtime";
import {
  LIVE_ROWS_HOLD_RECHECK_IN_MS,
  LIVE_ROWS_MIN_INTERVAL_IN_MS,
  getLiveRowEventTypes,
} from "./LiveRows";
import { MutableRefObject, useEffect, useRef } from "react";

export interface UseLiveRowsOptions {
  /*
   * The table the list shows. Only a table whose changes the server
   * announces is heard (LiveRows.getLiveRowEventTypes).
   */
  modelType: { new (): BaseModel } | null;
  // The project whose changes are heard. None, nothing is heard.
  tenantId: ObjectID | null;
  // False keeps the rows as they were loaded, until Refresh.
  isEnabled: boolean;
  /*
   * Whether a change heard now must wait for the reader (LiveRows
   * .isLiveRowsHeld). Asked each time, so it reads the table as it is then.
   */
  isHeld: () => boolean;
  // Reads the page again, quietly.
  refresh: () => Promise<void>;
  // For tests: how close together two reads may come.
  minIntervalInMs?: number | undefined;
  // For tests: how often a list waiting for the reader looks again.
  holdRecheckInMs?: number | undefined;
}

const isPageHidden: () => boolean = (): boolean => {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
};

/*
 * Reads a list's page again whenever the server announces that a record of
 * its table was created, changed or deleted, at most once every
 * LIVE_ROWS_MIN_INTERVAL_IN_MS, and not while the reader is in the middle of
 * something (see LiveRows.ts for why).
 */
const useLiveRows: (options: UseLiveRowsOptions) => void = (
  options: UseLiveRowsOptions,
): void => {
  const refreshRef: MutableRefObject<() => Promise<void>> = useRef<
    () => Promise<void>
  >(options.refresh);
  refreshRef.current = options.refresh;

  const isHeldRef: MutableRefObject<() => boolean> = useRef<() => boolean>(
    options.isHeld,
  );
  isHeldRef.current = options.isHeld;

  const modelType: { new (): BaseModel } | null =
    options.isEnabled && options.tenantId ? options.modelType : null;

  const eventTypes: Array<ModelEventType> = modelType
    ? getLiveRowEventTypes(new modelType())
    : [];

  const tenantId: string = options.tenantId?.toString() || "";

  // What the subscription is for: it starts over only when this changes.
  const subscriptionKey: string =
    modelType && eventTypes.length > 0
      ? `${new modelType().tableName}|${tenantId}|${eventTypes.join(",")}`
      : "";

  const minIntervalInMs: number =
    options.minIntervalInMs ?? LIVE_ROWS_MIN_INTERVAL_IN_MS;
  const holdRecheckInMs: number =
    options.holdRecheckInMs ?? LIVE_ROWS_HOLD_RECHECK_IN_MS;

  useEffect(() => {
    if (!subscriptionKey || !modelType || !options.tenantId) {
      return undefined;
    }

    /*
     * The list joins the live connection the app keeps open (the Dashboard
     * opens it as it starts). Where there is none - a page drawn on its
     * own, as a preview or an offline browser check does - the rows stay as
     * they were loaded, and nothing is opened on their account.
     */
    if (!Realtime.isStarted()) {
      return undefined;
    }

    let isStopped: boolean = false;
    // A change was heard while the reader was busy or the page hidden.
    let isPending: boolean = false;
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh: CoalescedRefresh = new CoalescedRefresh({
      refresh: (): Promise<void> => {
        return refreshRef.current();
      },
      minIntervalInMs: minIntervalInMs,
    });

    const onChange: () => void = (): void => {
      if (isStopped) {
        return;
      }

      /*
       * A hidden tab reads nothing: it reads once, when it is looked at
       * again (visibilitychange below).
       */
      if (isPageHidden()) {
        isPending = true;
        return;
      }

      /*
       * The reader is in the middle of something: look again in a moment,
       * and read as soon as they are done.
       */
      if (isHeldRef.current()) {
        isPending = true;

        if (recheckTimer === null) {
          recheckTimer = setTimeout((): void => {
            recheckTimer = null;
            onChange();
          }, holdRecheckInMs);
        }

        return;
      }

      isPending = false;
      refresh.request();
    };

    const onVisibilityChange: () => void = (): void => {
      if (isPending && !isPageHidden()) {
        onChange();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    const stopListening: Array<() => void> = eventTypes.map(
      (eventType: ModelEventType): (() => void) => {
        return Realtime.listenToModelEvent<BaseModel>(
          {
            modelType: modelType,
            eventType: eventType,
            tenantId: options.tenantId!,
          },
          (): void => {
            if (isPending) {
              // The change waiting already reads this one too.
              return;
            }

            onChange();
          },
        );
      },
    );

    return (): void => {
      isStopped = true;
      refresh.stop();

      if (recheckTimer !== null) {
        clearTimeout(recheckTimer);
        recheckTimer = null;
      }

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }

      for (const stop of stopListening) {
        stop();
      }
    };
  }, [subscriptionKey, minIntervalInMs, holdRecheckInMs]);
};

export default useLiveRows;
