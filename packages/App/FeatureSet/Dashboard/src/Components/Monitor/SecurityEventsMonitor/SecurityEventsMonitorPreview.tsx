import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Query from "Common/Types/BaseDatabase/Query";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import OneUptimeDate from "Common/Types/Date";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";

export interface ComponentProps {
  monitorStepSecurityEventsMonitor:
    | MonitorStepSecurityEventsMonitor
    | undefined;
}

/*
 * A live count of the security events the configured filters currently
 * match. toQuery() stamps the evaluation window (now - lastXSecondsOfEvents
 * .. now) at call time, so every refresh shows exactly what the monitor
 * would evaluate if it ran right now — which is what someone tuning the
 * filters wants to see.
 */
const SecurityEventsMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const monitorStep: MonitorStepSecurityEventsMonitor | undefined =
    props.monitorStepSecurityEventsMonitor;

  const fetchCount: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };

      if (!monitorStep) {
        setCount(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const query: Query<SecurityEvent> =
          MonitorStepSecurityEventsMonitorUtil.toQuery(monitorStep);

        const eventCount: number = await AnalyticsModelAPI.count<SecurityEvent>(
          SecurityEvent,
          query,
        );

        if (isStale()) {
          return;
        }

        setCount(eventCount);
        setError(null);
      } catch (err: unknown) {
        if (isStale()) {
          return;
        }
        setCount(null);
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      if (!isStale()) {
        setIsLoading(false);
      }
    }, [
      JSON.stringify(
        monitorStep
          ? MonitorStepSecurityEventsMonitorUtil.toJSON(monitorStep)
          : null,
      ),
    ]);

  useEffect(() => {
    void fetchCount();
  }, [fetchCount]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (count === null) {
    return (
      <div className="text-sm text-gray-500">
        Configure the filters above to preview matching security events.
      </div>
    );
  }

  const windowText: string = monitorStep?.lastXSecondsOfEvents
    ? OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
        monitorStep.lastXSecondsOfEvents,
      )
    : "";

  return (
    <div>
      <div className="text-3xl font-semibold text-gray-900">
        {count.toLocaleString()}
      </div>
      <div className="mt-1 text-sm text-gray-500">
        {count === 1 ? "security event matches" : "security events match"} the
        filters above{windowText ? ` in the last ${windowText}` : ""}.
      </div>
    </div>
  );
};

export default SecurityEventsMonitorPreview;
