import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import CoalescedRefresh from "../../Utils/CoalescedRefresh";
import Realtime from "../../Utils/Realtime";
import { getRecordIdText } from "../ObjectID/RecordIdText";
import {
  LIVE_ROWS_HOLD_RECHECK_IN_MS,
  LIVE_ROWS_MIN_INTERVAL_IN_MS,
  LIVE_ROWS_POINTER_REST_IN_MS,
  LiveRowsHeard,
  getLiveRowEventTypes,
  isPointerAtWorkOnRows,
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
  /*
   * Reads the page again, quietly; told which records were announced as
   * created since the last read, the ones a new row may be tinted for.
   */
  refresh: (heard: LiveRowsHeard) => Promise<void>;
  /*
   * The element the rows are drawn in. While the pointer is at work on it -
   * on its way to a row to open it - the rows stay where they are
   * (LiveRows.isPointerAtWorkOnRows).
   */
  getRowsElement?: (() => Element | null) | undefined;
  // For tests: how close together two reads may come.
  minIntervalInMs?: number | undefined;
  // For tests: how often a list waiting for the reader looks again.
  holdRecheckInMs?: number | undefined;
  // For tests: how long the pointer must rest before the rows move.
  pointerRestInMs?: number | undefined;
}

/*
 * How long the pointer has rested is a span of time, not a time of day: a
 * clock that only moves forward, which a change of the system's clock - or
 * a page whose dates are fixed, as an offline preview's are - does not move.
 */
const getElapsedNow: () => number = (): number => {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
};

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
  const refreshRef: MutableRefObject<(heard: LiveRowsHeard) => Promise<void>> =
    useRef<(heard: LiveRowsHeard) => Promise<void>>(options.refresh);
  refreshRef.current = options.refresh;

  const isHeldRef: MutableRefObject<() => boolean> = useRef<() => boolean>(
    options.isHeld,
  );
  isHeldRef.current = options.isHeld;

  const getRowsElementRef: MutableRefObject<
    (() => Element | null) | undefined
  > = useRef<(() => Element | null) | undefined>(options.getRowsElement);
  getRowsElementRef.current = options.getRowsElement;

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
  const pointerRestInMs: number =
    options.pointerRestInMs ?? LIVE_ROWS_POINTER_REST_IN_MS;

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
    /*
     * When the pointer last moved over the rows, or pressed on them. Null
     * once it moves anywhere else: it is off the rows.
     */
    let lastMovedOverRowsAt: number | null = null;

    const onPointer: (event: Event) => void = (event: Event): void => {
      const rows: Element | null = getRowsElementRef.current?.() || null;
      const target: EventTarget | null = event.target;

      lastMovedOverRowsAt =
        rows && target instanceof Node && rows.contains(target)
          ? getElapsedNow()
          : null;
    };

    const isHeld: () => boolean = (): boolean => {
      return (
        isHeldRef.current() ||
        isPointerAtWorkOnRows(
          lastMovedOverRowsAt,
          getElapsedNow(),
          pointerRestInMs,
        )
      );
    };

    /*
     * The records announced as created since the last read began: that
     * read is told them, and the rows it brings in for them are the new
     * ones (a row that slid in from the next page is not).
     */
    const createdIds: Set<string> = new Set();

    const refresh: CoalescedRefresh = new CoalescedRefresh({
      refresh: (): Promise<void> => {
        const heard: LiveRowsHeard = { createdIds: Array.from(createdIds) };
        createdIds.clear();
        return refreshRef.current(heard);
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
      if (isHeld()) {
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
      document.addEventListener("pointermove", onPointer, { passive: true });
      document.addEventListener("pointerdown", onPointer, { passive: true });
    }

    const stopListening: Array<() => void> = eventTypes.map(
      (eventType: ModelEventType): (() => void) => {
        return Realtime.listenToModelEvent<BaseModel>(
          {
            modelType: modelType,
            eventType: eventType,
            tenantId: options.tenantId!,
          },
          (modelId: unknown): void => {
            if (eventType === ModelEventType.Create) {
              const id: string = getRecordIdText(modelId);

              if (id) {
                createdIds.add(id);
              }
            }

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
        document.removeEventListener("pointermove", onPointer);
        document.removeEventListener("pointerdown", onPointer);
      }

      for (const stop of stopListening) {
        stop();
      }
    };
  }, [subscriptionKey, minIntervalInMs, holdRecheckInMs, pointerRestInMs]);
};

export default useLiveRows;
