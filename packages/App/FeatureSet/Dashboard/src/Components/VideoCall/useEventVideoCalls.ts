import AlertVideoCall from "Common/Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useState } from "react";

/*
 * The video calls of one incident or alert, newest first, for the card on
 * its page and the Join call button in its header - one request shared by
 * both.
 */

export enum VideoCallEventKind {
  Incident = "Incident",
  Alert = "Alert",
}

export type EventVideoCall = IncidentVideoCall | AlertVideoCall;

export interface EventVideoCallsState {
  calls: Array<EventVideoCall>;
  // Whether the calls of the event on screen have been read once.
  hasLoaded: boolean;
  error: string | undefined;
  refresh: () => void;
}

// More than a responder would ever want on one page.
const MAX_CALLS: number = 20;

export async function fetchEventVideoCalls(data: {
  kind: VideoCallEventKind;
  eventId: ObjectID;
}): Promise<Array<EventVideoCall>> {
  const select: {
    _id: true;
    provider: true;
    title: true;
    joinUrl: true;
    createdAt: true;
    workspaceNotificationRuleId: true;
    videoCallConnection: { name: true; provider: true };
    createdByUser: { _id: true; name: true; email: true };
  } = {
    _id: true,
    provider: true,
    title: true,
    joinUrl: true,
    createdAt: true,
    workspaceNotificationRuleId: true,
    videoCallConnection: { name: true, provider: true },
    createdByUser: { _id: true, name: true, email: true },
  };

  if (data.kind === VideoCallEventKind.Incident) {
    const result: ListResult<IncidentVideoCall> = await ModelAPI.getList({
      modelType: IncidentVideoCall,
      query: { incidentId: data.eventId },
      select,
      sort: { createdAt: SortOrder.Descending },
      skip: 0,
      limit: MAX_CALLS,
    });

    return result.data;
  }

  const result: ListResult<AlertVideoCall> = await ModelAPI.getList({
    modelType: AlertVideoCall,
    query: { alertId: data.eventId },
    select,
    sort: { createdAt: SortOrder.Descending },
    skip: 0,
    limit: MAX_CALLS,
  });

  return result.data;
}

/*
 * A workspace rule starts its call a moment after the incident or alert is
 * created, so whoever declared it from the dashboard lands on its page
 * before the call exists. While the event is new and has no call, the page
 * looks again a few times, then stops: an event that still has no call
 * after that has no rule that starts one.
 */
export const VIDEO_CALL_RECHECK_DELAYS_MS: ReadonlyArray<number> = [
  3000, 7000, 15000, 30000,
];
export const VIDEO_CALL_RECHECK_WINDOW_MS: number = 5 * 60 * 1000;
// Clocks disagree a little; an event "a few seconds in the future" is new.
const CLOCK_SKEW_MS: number = 60 * 1000;

export function getVideoCallRecheckDelay(data: {
  eventStartedAt: Date | undefined;
  now: Date;
  callCount: number;
  attempt: number;
}): number | null {
  if (data.callCount > 0 || !data.eventStartedAt) {
    return null;
  }

  const age: number = data.now.getTime() - data.eventStartedAt.getTime();

  if (
    Number.isNaN(age) ||
    age < -CLOCK_SKEW_MS ||
    age > VIDEO_CALL_RECHECK_WINDOW_MS
  ) {
    return null;
  }

  return VIDEO_CALL_RECHECK_DELAYS_MS[data.attempt] ?? null;
}

interface LoadedCalls {
  eventKey: string;
  calls: Array<EventVideoCall>;
  error: string | undefined;
}

export default function useEventVideoCalls(data: {
  kind: VideoCallEventKind;
  eventId: ObjectID;
  // When the event started, once the page knows; see getVideoCallRecheckDelay.
  eventStartedAt?: Date | undefined;
}): EventVideoCallsState {
  const eventKey: string = `${data.kind}:${data.eventId.toString()}`;
  const [loaded, setLoaded] = useState<LoadedCalls | null>(null);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [recheck, setRecheck] = useState<{ eventKey: string; count: number }>({
    eventKey,
    count: 0,
  });

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchEventVideoCalls({ kind: data.kind, eventId: data.eventId })
      .then((calls: Array<EventVideoCall>) => {
        if (isCurrent) {
          setLoaded({ eventKey, calls, error: undefined });
        }
      })
      .catch((err: Error) => {
        if (!isCurrent) {
          return;
        }

        setLoaded((previous: LoadedCalls | null): LoadedCalls => {
          // A failed refresh keeps the calls already on screen.
          if (previous && previous.eventKey === eventKey && !previous.error) {
            return previous;
          }

          return {
            eventKey,
            calls: [],
            error: API.getFriendlyErrorMessage(err),
          };
        });
      });

    return () => {
      // A later event's page is not filled in with this one's calls.
      isCurrent = false;
    };
  }, [eventKey, refreshCounter]);

  const refresh: () => void = useCallback((): void => {
    setRefreshCounter((value: number): number => {
      return value + 1;
    });
  }, []);

  /*
   * Only the first answer for an event shows as loading. A refresh keeps
   * what is on screen until its answer replaces it, so the card never
   * flashes a spinner.
   */
  const isCurrentEvent: boolean = loaded?.eventKey === eventKey;
  const calls: Array<EventVideoCall> = isCurrentEvent ? loaded!.calls : [];
  const error: string | undefined = isCurrentEvent ? loaded!.error : undefined;
  const isLoading: boolean = !isCurrentEvent;

  const attempt: number = recheck.eventKey === eventKey ? recheck.count : 0;
  const recheckDelay: number | null =
    isLoading || error
      ? null
      : getVideoCallRecheckDelay({
          eventStartedAt: data.eventStartedAt
            ? OneUptimeDate.fromString(data.eventStartedAt)
            : undefined,
          now: OneUptimeDate.getCurrentDate(),
          callCount: calls.length,
          attempt,
        });

  useEffect(() => {
    if (recheckDelay === null) {
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setRecheck({ eventKey, count: attempt + 1 });
      refresh();
    }, recheckDelay);

    return () => {
      clearTimeout(timer);
    };
  }, [recheckDelay, eventKey, attempt]);

  return { calls, hasLoaded: !isLoading, error, refresh };
}
