import MeasurementSummaryElement from "./MeasurementSummaryElement";
import {
  EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS,
  EVENT_MEASUREMENT_TICK_INTERVAL_IN_MS,
  EventMeasurementDisplay,
  EventMeasurementListRequest,
  EventMeasurementReading,
  EventMeasurementSource,
  EventMeasurementTone,
  getEventMeasurementDefinitionsRequest,
  getEventMeasurementDisplay,
  getEventMeasurementReadings,
  getEventMeasurementValuesRequest,
  shouldEventMeasurementsTick,
} from "../../Utils/Measurement/EventMeasurements";
import {
  MEASUREMENT_PAGE_COPY,
  MEASUREMENT_VALUE_COPY,
  MeasurementPageCopy,
  MeasurementValues,
} from "../../Utils/Measurement/MeasurementSetup";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card, { CardHeaderLayout } from "Common/UI/Components/Card/Card";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  // Which kind of event this is: where its measurements are kept.
  source: EventMeasurementSource;
  eventId: ObjectID;
  /*
   * The event is resolved (completed, for maintenance): a state it was
   * still waiting for reads "Not reached" rather than a clock that runs on.
   */
  isEventOver: boolean;
  /*
   * Changes after the page's own state changes and edits; the card reads
   * its values again, and once more a moment later (see
   * EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS).
   */
  refreshToken?: number | undefined;
  // "stacked" in the narrow right-hand column of an overview page.
  headerLayout?: CardHeaderLayout | undefined;
}

// What was read, stamped with the event it was read for.
interface LoadedMeasurements {
  eventId: string;
  measurements: Array<MeasurementValues>;
  values: Array<MeasurementValues>;
}

const TONE_CLASS_NAMES: Record<EventMeasurementTone, string> = {
  [EventMeasurementTone.Value]: "font-medium text-gray-900",
  [EventMeasurementTone.State]: "text-gray-500",
  [EventMeasurementTone.Warning]: "font-medium text-amber-700",
};

type CanReadFunction = (modelType: { new (): BaseModel }) => boolean;

/*
 * Only a reader who certainly may not read the measurements is spared the
 * request. While the permission snapshot is still on its way there is no
 * reason given, and the card asks: the server decides.
 */
const canRead: CanReadFunction = (modelType: {
  new (): BaseModel;
}): boolean => {
  const gate: PermissionGateResult = PermissionGate.check(
    new modelType(),
    ModelAction.Read,
  );

  return gate.isAllowed || !gate.disabledReason;
};

/*
 * The Measurements card of an incident's, an alert's or a maintenance
 * event's own page: the measurements the project shows on event pages, in
 * their order, each with what it measures ("Declared → Acknowledged") and
 * what it reads for this event - "4 minutes", "Running for 12 minutes",
 * "Not reached".
 *
 * It draws nothing until it knows there is something to show, so the many
 * projects with no measurements see no card, no loader and no empty state;
 * and nothing when the reader may not read them or the first read fails. A
 * failed refresh keeps what is on screen.
 */
const EventMeasurementsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const eventIdString: string = props.eventId.toString();
  const copy: MeasurementPageCopy = MEASUREMENT_PAGE_COPY[props.source.domain];

  const [loaded, setLoaded] = useState<LoadedMeasurements | null>(null);
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  // Bumped by every read and on unmount: only the newest read lands.
  const requestRef: MutableRefObject<number> = useRef<number>(0);
  const settleTimerRef: MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The event the last read was for: the same one again is a refresh.
  const lastReadEventIdRef: MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  const isReadable: boolean =
    canRead(props.source.measurementModel) && canRead(props.source.valueModel);

  const load: () => Promise<void> = async (): Promise<void> => {
    requestRef.current++;
    const requestNumber: number = requestRef.current;
    const requestedEventId: string = eventIdString;

    try {
      const definitionsRequest: EventMeasurementListRequest =
        getEventMeasurementDefinitionsRequest(props.source);

      const definitions: ListResult<BaseModel> =
        await ModelAPI.getList<BaseModel>({
          modelType: props.source.measurementModel,
          query: definitionsRequest.query as Query<BaseModel>,
          select: definitionsRequest.select as Select<BaseModel>,
          sort: definitionsRequest.sort as Sort<BaseModel>,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      const measurements: Array<MeasurementValues> = (definitions.data ||
        []) as unknown as Array<MeasurementValues>;

      let values: Array<MeasurementValues> = [];

      // A project that shows no measurements costs the page one request.
      if (measurements.length > 0) {
        const valuesRequest: EventMeasurementListRequest =
          getEventMeasurementValuesRequest({
            source: props.source,
            eventId: props.eventId,
          });

        const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>(
          {
            modelType: props.source.valueModel,
            query: valuesRequest.query as Query<BaseModel>,
            select: valuesRequest.select as Select<BaseModel>,
            sort: valuesRequest.sort as Sort<BaseModel>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          },
        );

        values = (result.data || []) as unknown as Array<MeasurementValues>;
      }

      if (requestNumber !== requestRef.current) {
        return;
      }

      setLoaded({
        eventId: requestedEventId,
        measurements: measurements,
        values: values,
      });
      setNow(OneUptimeDate.getCurrentDate());
    } catch {
      /*
       * Best effort, like the page's other optional cards: a first read
       * that fails draws nothing, and a refresh that fails keeps the
       * values already on screen.
       */
    }
  };

  const clearSettleTimer: () => void = (): void => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!isReadable) {
      return;
    }

    const isRefresh: boolean = lastReadEventIdRef.current === eventIdString;
    lastReadEventIdRef.current = eventIdString;

    clearSettleTimer();

    load().catch(() => {
      // Handled in load.
    });

    if (isRefresh) {
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;

        load().catch(() => {
          // Handled in load.
        });
      }, EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS);
    }
  }, [eventIdString, props.refreshToken, isReadable]);

  useEffect(() => {
    return () => {
      requestRef.current++;
      clearSettleTimer();
    };
  }, []);

  const readings: Array<EventMeasurementReading> =
    loaded && loaded.eventId === eventIdString
      ? getEventMeasurementReadings({
          source: props.source,
          measurements: loaded.measurements,
          values: loaded.values,
          isEventOver: props.isEventOver,
          now: now,
        })
      : [];

  const shouldTick: boolean = shouldEventMeasurementsTick(readings);

  useEffect(() => {
    if (!shouldTick) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, EVENT_MEASUREMENT_TICK_INTERVAL_IN_MS);

    return () => {
      clearInterval(interval);
    };
  }, [shouldTick]);

  if (!isReadable || readings.length === 0) {
    return <></>;
  }

  return (
    <Card
      title={MEASUREMENT_VALUE_COPY.cardTitle}
      description={copy.eventCardDescription}
      headerLayout={props.headerLayout}
    >
      <dl
        className="divide-y divide-gray-100"
        data-testid="event-measurements"
      >
        {readings.map((reading: EventMeasurementReading): ReactElement => {
          const display: EventMeasurementDisplay = getEventMeasurementDisplay({
            reading: reading,
            translator: translator,
            now: now,
          });

          return (
            <div
              key={reading.measurementId}
              className="min-w-0 py-3 first:pt-0 last:pb-0"
              data-testid="event-measurement"
              data-measurement-id={reading.measurementId}
              data-measurement-state={reading.state}
            >
              <dt className="space-y-1">
                {/* The project's own name for it, never translated. */}
                <span
                  className="block break-words text-xs font-medium text-gray-500"
                  data-testid="event-measurement-name"
                >
                  {reading.name}
                </span>
                <span className="block text-xs leading-5">
                  <MeasurementSummaryElement
                    form={props.source.form}
                    measurement={reading.measurement}
                    className="text-xs text-gray-400"
                  />
                </span>
              </dt>
              <dd
                className={`mt-1 break-words text-sm ${
                  TONE_CLASS_NAMES[display.tone]
                }`}
                data-testid="event-measurement-value"
              >
                {display.text}
              </dd>
              {display.reason ? (
                <dd
                  className="mt-0.5 break-words text-xs leading-5 text-gray-500"
                  data-testid="event-measurement-reason"
                >
                  {display.reason}
                </dd>
              ) : (
                <></>
              )}
            </div>
          );
        })}
      </dl>
    </Card>
  );
};

export default EventMeasurementsCard;
