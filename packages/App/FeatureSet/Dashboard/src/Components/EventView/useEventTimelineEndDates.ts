import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useMemo, useState } from "react";
import {
  EventTimelineDate,
  getLatestTimelineDateByEventId,
} from "../../Utils/EventDuration";

type TimelineModel = DatabaseBaseModel & {
  startsAt?: Date | undefined;
};

export interface UseEventTimelineEndDatesProps<
  TTimeline extends TimelineModel,
> {
  eventIds: Array<string>;
  eventIdField: keyof TTimeline;
  timelineModelType: { new (): TTimeline };
}

export interface UseEventTimelineEndDatesResult {
  endDateByEventId: Record<string, Date>;
  isLoading: boolean;
}

/**
 * Fetch the final state-change date for the resolved events on the current
 * table page. Keeping this batched avoids an N+1 request for every table row.
 */
export default function useEventTimelineEndDates<
  TTimeline extends TimelineModel,
>(
  props: UseEventTimelineEndDatesProps<TTimeline>,
): UseEventTimelineEndDatesResult {
  const eventIdsKey: string = useMemo(() => {
    return Array.from(new Set(props.eventIds)).sort().join(",");
  }, [props.eventIds]);

  const [endDateByEventId, setEndDateByEventId] = useState<
    Record<string, Date>
  >({});
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    const eventIds: Array<string> = eventIdsKey ? eventIdsKey.split(",") : [];

    if (eventIds.length === 0) {
      setEndDateByEventId({});
      setIsLoading(false);
      return () => {};
    }

    let isCancelled: boolean = false;

    const fetchEndDates: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const query: Query<TTimeline> = {
          [props.eventIdField]: new Includes(eventIds),
        } as unknown as Query<TTimeline>;
        const select: Select<TTimeline> = {
          [props.eventIdField]: true,
          startsAt: true,
        } as Select<TTimeline>;

        const result: ListResult<TTimeline> = await ModelAPI.getList<TTimeline>(
          {
            modelType: props.timelineModelType,
            query: query,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: select,
            sort: {
              startsAt: SortOrder.Descending,
            } as Sort<TTimeline>,
          },
        );

        const timelineDates: Array<EventTimelineDate> = [];

        for (const timeline of result.data) {
          const eventId: unknown = timeline[props.eventIdField];

          if (!eventId) {
            continue;
          }

          timelineDates.push({
            eventId: eventId.toString(),
            ...(timeline.startsAt ? { startsAt: timeline.startsAt } : {}),
          });
        }

        if (!isCancelled) {
          setEndDateByEventId(getLatestTimelineDateByEventId(timelineDates));
        }
      } catch {
        if (!isCancelled) {
          // The primary table remains usable if duration enrichment fails.
          setEndDateByEventId({});
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchEndDates().catch(() => {
      if (!isCancelled) {
        setEndDateByEventId({});
        setIsLoading(false);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [eventIdsKey, props.eventIdField, props.timelineModelType]);

  return {
    endDateByEventId,
    isLoading,
  };
}
