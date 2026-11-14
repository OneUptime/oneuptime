import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import CoalescedRefresh from "../../Utils/CoalescedRefresh";
import { getOpenLiveConnection } from "../../Utils/LiveConnection";
/*
 * Type-only on purpose: the count joins the connection the app opened
 * (LiveConnection), so a page that draws a side menu and opens none - a
 * status page - does not load Realtime and socket.io with it.
 */
import type Realtime from "../../Utils/Realtime";
import {
  LIVE_ROWS_MIN_INTERVAL_IN_MS,
  getLiveRowEventTypes,
} from "../ModelTable/LiveRows";
import { MutableRefObject, useEffect, useMemo, useRef } from "react";

/*
 * A SIDE-MENU COUNT THAT KEEPS ITSELF CURRENT.
 *
 * The list beside a side menu keeps itself current (UseLiveRows), and so do
 * the header's counts: the server announces every record of a table such as
 * Alert or Incident that is created, changed or deleted, and both read again.
 * The count beside "Active Alerts" did not hear those announcements. A
 * teammate resolving an alert, a monitor raising one, an episode closing on
 * its own, the alerts a bulk action deleted - the list followed, and the
 * count beside it kept saying "4" until the page was reloaded (#6856).
 *
 * It hears them now, for the project it is drawn in, and counts again:
 *
 *   - at once for the first change, then at most once every
 *     LIVE_ROWS_MIN_INTERVAL_IN_MS however many follow (CoalescedRefresh) -
 *     the pace of the list and the header. A bulk action that resolves
 *     thousands of alerts announces every one, and must not turn into
 *     thousands of count requests; the last change is always counted;
 *   - not while the tab is hidden: it counts once when the tab is looked
 *     at again, if anything changed meanwhile;
 *   - only on the live connection the app keeps open (the Dashboard opens it
 *     as it starts, before anything is drawn). A page drawn without one - a
 *     preview, an offline check - opens none on a count's account, and does
 *     not even load one: the count asks LiveConnection, so a status page's
 *     subscribe menu does not download socket.io to draw its side menu.
 *
 * A table the server announces nothing for (Monitor, ScheduledMaintenance)
 * is not heard: its count follows what the page asks (SideMenuCountRefresh).
 */

export interface UseLiveCountOptions {
  // The table the count counts. None, nothing is heard.
  modelType: { new (): BaseModel } | undefined;
  // False hears nothing: there is no question to count yet.
  isEnabled: boolean;
  /*
   * The project whose changes are heard; none, nothing is heard. Asked only
   * when the count can be heard - a kind the server announces, on the app's
   * live connection - and on every render then, so a count drawn for
   * another project listens to that one.
   */
  getTenantId: () => ObjectID | null | undefined;
  // Counts again, keeping the count on show while it does.
  recount: () => Promise<void>;
  // For tests: how close together two counts may come.
  minIntervalInMs?: number | undefined;
}

const isPageHidden: () => boolean = (): boolean => {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
};

interface AnnouncedTable {
  tableName: string;
  eventTypes: Array<ModelEventType>;
}

const useLiveCount: (options: UseLiveCountOptions) => void = (
  options: UseLiveCountOptions,
): void => {
  // The count of the moment: a change heard later counts what is asked then.
  const recountRef: MutableRefObject<() => Promise<void>> = useRef<
    () => Promise<void>
  >(options.recount);
  recountRef.current = options.recount;

  // The app's live connection, once it has opened one.
  const realtime: typeof Realtime | null = options.isEnabled
    ? getOpenLiveConnection()
    : null;

  const modelType: { new (): BaseModel } | undefined = realtime
    ? options.modelType
    : undefined;

  // What the server announces for the table: read once per kind.
  const announced: AnnouncedTable | null = useMemo(() => {
    if (!modelType) {
      return null;
    }

    const model: BaseModel = new modelType();
    const eventTypes: Array<ModelEventType> = getLiveRowEventTypes(model);

    return eventTypes.length > 0
      ? { tableName: model.tableName || "", eventTypes: eventTypes }
      : null;
  }, [modelType]);

  const tenantId: string = announced
    ? options.getTenantId()?.toString() || ""
    : "";

  // What the subscription is for: it starts over only when this changes.
  const subscriptionKey: string =
    announced && tenantId
      ? `${announced.tableName}|${tenantId}|${announced.eventTypes.join(",")}`
      : "";

  const minIntervalInMs: number =
    options.minIntervalInMs ?? LIVE_ROWS_MIN_INTERVAL_IN_MS;

  useEffect(() => {
    if (!subscriptionKey || !modelType || !announced || !realtime) {
      return undefined;
    }

    let isStopped: boolean = false;
    // A change was heard while the tab was hidden.
    let isPending: boolean = false;

    const refresh: CoalescedRefresh = new CoalescedRefresh({
      refresh: (): Promise<void> => {
        return recountRef.current();
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

    const stopListening: Array<() => void> = announced.eventTypes.map(
      (eventType: ModelEventType): (() => void) => {
        return realtime.listenToModelEvent<BaseModel>(
          {
            modelType: modelType,
            eventType: eventType,
            tenantId: new ObjectID(tenantId),
          },
          (): void => {
            onChange();
          },
        );
      },
    );

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

export default useLiveCount;
