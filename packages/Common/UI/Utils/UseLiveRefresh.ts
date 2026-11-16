import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../Types/ObjectID";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import CoalescedRefresh from "./CoalescedRefresh";
import { getOpenLiveConnection } from "./LiveConnection";
/*
 * Type-only on purpose: a part that reads again joins the connection the app
 * opened (LiveConnection), so a page that opens none - a status page - does
 * not load Realtime and socket.io with it.
 */
import type Realtime from "./Realtime";
import {
  LIVE_ROWS_MIN_INTERVAL_IN_MS,
  getLiveRowEventTypes,
} from "../Components/ModelTable/LiveRows";
import { MutableRefObject, useEffect, useMemo, useRef } from "react";

/*
 * A PART OF A PAGE THAT READS AGAIN WHEN WHAT IT SHOWS CHANGES.
 *
 * The server announces every record of some tables that is created, changed
 * or deleted - Incident, Alert, Monitor, ScheduledMaintenance and the rest
 * (a model's enableRealtimeEventsOn) - to the people who may read it. A part
 * that shows such records hears those announcements for the project it is
 * drawn in, for every kind it shows, and reads again:
 *
 *   - at once for the first change, then at most once every
 *     LIVE_ROWS_MIN_INTERVAL_IN_MS however many follow, of whichever kind
 *     (one CoalescedRefresh for all of them): a bulk action that resolves
 *     thousands of alerts announces every one, and is two reads, not one per
 *     record; the last change is always read;
 *   - not while the tab is hidden: it reads once when the tab is looked at
 *     again, if anything changed meanwhile;
 *   - only on the live connection the app keeps open (the Dashboard opens it
 *     as it starts, before anything is drawn). A page drawn without one - a
 *     preview, a status page - opens none on its account, and does not even
 *     load one.
 *
 * An announcement says only that a record changed, never what it holds: the
 * part reads what it shows again, through the API, with the reader's own
 * permissions. So nothing reaches the page that the person may not read.
 *
 * A side menu's count (UseLiveCount) and Home's overview (UseHomeOverview)
 * read again this way. A kind the server announces nothing for is not heard.
 */

export interface UseLiveRefreshOptions {
  // The kinds of record whose changes are heard. None, nothing is heard.
  modelTypes: ReadonlyArray<{ new (): BaseModel }>;
  // False hears nothing: there is nothing to read again yet.
  isEnabled: boolean;
  /*
   * The project whose changes are heard; none, nothing is heard. Asked only
   * when something can be heard - a kind the server announces, on the app's
   * live connection - and on every render then, so a part drawn for another
   * project listens to that one.
   */
  getTenantId: () => ObjectID | null | undefined;
  // Reads again, keeping what is on show while it does.
  refresh: () => Promise<void>;
  // For tests: how close together two reads may come.
  minIntervalInMs?: number | undefined;
}

interface AnnouncedTable {
  modelType: { new (): BaseModel };
  tableName: string;
  eventTypes: Array<ModelEventType>;
}

const isPageHidden: () => boolean = (): boolean => {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
};

// The tables of `modelTypes` the server announces changes of, each once.
export const getAnnouncedTables: (
  modelTypes: ReadonlyArray<{ new (): BaseModel }>,
) => Array<AnnouncedTable> = (
  modelTypes: ReadonlyArray<{ new (): BaseModel }>,
): Array<AnnouncedTable> => {
  const tables: Array<AnnouncedTable> = [];

  for (const modelType of modelTypes) {
    const model: BaseModel = new modelType();
    const tableName: string = model.tableName || "";
    const eventTypes: Array<ModelEventType> = getLiveRowEventTypes(model);

    if (
      eventTypes.length === 0 ||
      tables.some((table: AnnouncedTable): boolean => {
        return table.tableName === tableName;
      })
    ) {
      continue;
    }

    tables.push({
      modelType: modelType,
      tableName: tableName,
      eventTypes: eventTypes,
    });
  }

  return tables;
};

const useLiveRefresh: (options: UseLiveRefreshOptions) => void = (
  options: UseLiveRefreshOptions,
): void => {
  // The read of the moment: a change heard later reads what is asked then.
  const refreshRef: MutableRefObject<() => Promise<void>> = useRef<
    () => Promise<void>
  >(options.refresh);
  refreshRef.current = options.refresh;

  // The app's live connection, once it has opened one.
  const realtime: typeof Realtime | null = options.isEnabled
    ? getOpenLiveConnection()
    : null;

  /*
   * The kinds by name: a caller that builds its list again on every render
   * hears the same, and nothing is worked out again.
   */
  const kinds: string = realtime
    ? options.modelTypes
        .map((modelType: { new (): BaseModel }): string => {
          return modelType.name;
        })
        .join(",")
    : "";

  // What the server announces for those kinds: read once per list of kinds.
  const announced: Array<AnnouncedTable> = useMemo(() => {
    return kinds ? getAnnouncedTables(options.modelTypes) : [];
  }, [kinds]);

  const tenantId: string =
    announced.length > 0 ? options.getTenantId()?.toString() || "" : "";

  // What the subscriptions are for: they start over only when this changes.
  const subscriptionKey: string =
    announced.length > 0 && tenantId
      ? `${tenantId}|${announced
          .map((table: AnnouncedTable): string => {
            return `${table.tableName}:${table.eventTypes.join(",")}`;
          })
          .join("|")}`
      : "";

  const minIntervalInMs: number =
    options.minIntervalInMs ?? LIVE_ROWS_MIN_INTERVAL_IN_MS;

  useEffect(() => {
    if (!subscriptionKey || !realtime || announced.length === 0) {
      return undefined;
    }

    let isStopped: boolean = false;
    // A change was heard while the tab was hidden.
    let isPending: boolean = false;

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

      if (isPageHidden()) {
        isPending = true;
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

    const stopListening: Array<() => void> = [];

    for (const table of announced) {
      for (const eventType of table.eventTypes) {
        stopListening.push(
          realtime.listenToModelEvent<BaseModel>(
            {
              modelType: table.modelType,
              eventType: eventType,
              tenantId: new ObjectID(tenantId),
            },
            (): void => {
              onChange();
            },
          ),
        );
      }
    }

    return (): void => {
      isStopped = true;
      refresh.stop();

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }

      for (const stop of stopListening) {
        stop();
      }
    };
  }, [subscriptionKey, minIntervalInMs]);
};

export default useLiveRefresh;
