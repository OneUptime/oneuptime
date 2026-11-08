import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import EventMetricInvestigationPanel from "../Telemetry/EventMetricInvestigationPanel";
import { EventMetricSubject } from "../../Utils/EventMetricInvestigation";
import {
  EventStateTimelineDate,
  getEventEndDateForCurrentState,
} from "../../Utils/EventDuration";
import { getEventResponseTimes } from "../../Utils/EventOverview";
import {
  RootCauseMetrics,
  getRootCauseMetrics,
} from "../../Utils/IncidentRootCauseMetrics";

/*
 * Where the Root Cause page keeps what the reader changed in its URL
 * ("rootCauseMetricsTime=hour-before"): a name of its own, so it never
 * reads what the Overview's card keeps under "metrics".
 */
export const ROOT_CAUSE_METRICS_URL_PREFIX: string = "rootCauseMetrics";

export interface ComponentProps {
  incidentId: ObjectID;
}

interface LoadedRootCause {
  incidentId: string;
  metrics: RootCauseMetrics | null;
  startedAt?: Date | undefined;
  endedAt?: Date | undefined;
  impactStartedAt?: Date | undefined;
  stateTimeline: Array<EventStateTimelineDate>;
  states: Array<IncidentState>;
}

/**
 * The metrics behind an incident, beside its root cause (issue #6249): the
 * same investigation the incident's Overview shows (EventMetricInvestigationPanel),
 * metrics only - over the ranges around the incident (around its start, the
 * hour or the day before it started, its start to now or to its resolution,
 * what the monitor saw), relative ranges or a range of the reader's own,
 * with the incident's moments on the charts, Edit metrics, Copy link, Reset
 * and Open in Metric Explorer.
 *
 * It charts what the Overview charts when the incident kept a metric
 * snapshot, and otherwise its monitor's metrics as the monitor reads them
 * now (see IncidentRootCauseMetrics). Nothing at all for an incident with
 * no metrics behind it. What the reader changes is kept in the page's URL
 * under its own names, so a reload keeps it and a link opens the same
 * charts; an untouched card writes nothing there.
 */
const IncidentRootCauseMetricChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const incidentId: string = props.incidentId.toString();
  const [loaded, setLoaded] = useState<LoadedRootCause | null>(null);
  const [error, setError] = useState<{ incidentId: string; text: string }>({
    incidentId: "",
    text: "",
  });

  useEffect(() => {
    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const incident: Incident | null = await ModelAPI.getItem<Incident>({
        modelType: Incident,
        id: new ObjectID(incidentId),
        select: {
          declaredAt: true,
          impactStartedAt: true,
          telemetryQuery: true,
          seriesLabels: true,
          createdCriteriaId: true,
          monitors: {
            _id: true,
            monitorType: true,
            monitorSteps: true,
          } as never,
        },
      });

      /*
       * Stored as JSON: the window's bounds come back as strings, which
       * the charts read as Dates (TelemetryQueryTimeRange.hydrate).
       */
      const telemetryQuery: TelemetryQuery | null = incident?.telemetryQuery
        ? TelemetryQueryTimeRange.hydrate(
            JSONFunctions.deserialize(
              incident.telemetryQuery as unknown as JSONObject,
            ) as unknown as TelemetryQuery,
          )
        : null;

      const metrics: RootCauseMetrics | null = incident
        ? getRootCauseMetrics({
            telemetryQuery: telemetryQuery,
            seriesLabels: incident.seriesLabels as JSONObject | undefined,
            createdCriteriaId: incident.createdCriteriaId,
            monitors: (incident.monitors || []).map((monitor: Monitor) => {
              return {
                monitorType: monitor.monitorType,
                monitorSteps: monitor.monitorSteps,
              };
            }),
          })
        : null;

      if (!incident || !metrics) {
        if (!isCancelled) {
          setLoaded({
            incidentId: incidentId,
            metrics: null,
            stateTimeline: [],
            states: [],
          });
        }
        return;
      }

      /*
       * The incident's moments, read the way its Overview reads them: its
       * state timeline and the project's states. Only for a card there is.
       */
      const [timelines, states]: [
        ListResult<IncidentStateTimeline>,
        ListResult<IncidentState>,
      ] = await Promise.all([
        ModelAPI.getList<IncidentStateTimeline>({
          modelType: IncidentStateTimeline,
          query: {
            incidentId: new ObjectID(incidentId),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            startsAt: true,
            incidentStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
        }),
        ModelAPI.getList<IncidentState>({
          modelType: IncidentState,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            isAcknowledgedState: true,
            isResolvedState: true,
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        }),
      ]);

      const stateTimeline: Array<EventStateTimelineDate> = (
        timelines.data || []
      ).map((timeline: IncidentStateTimeline): EventStateTimelineDate => {
        return {
          stateId: timeline.incidentStateId?.toString(),
          startsAt: timeline.startsAt,
        };
      });

      const resolvedStateIds: Array<string> =
        ResolvedStateUtil.getResolvedStateIds({
          list: StateListType.IncidentState,
          states: states.data || [],
        }).map((stateId: ObjectID): string => {
          return stateId.toString();
        });

      if (isCancelled) {
        return;
      }

      setLoaded({
        incidentId: incidentId,
        metrics: metrics,
        // When it was declared, as on its Overview.
        startedAt: getEventResponseTimes({
          timelines: stateTimeline,
          startedAt: incident.declaredAt || undefined,
          acknowledgedStateIds: [],
          resolvedStateIds: resolvedStateIds,
        }).startedAt,
        // Resolved, while it still is.
        endedAt: getEventEndDateForCurrentState(
          stateTimeline,
          resolvedStateIds,
        ),
        impactStartedAt: incident.impactStartedAt || undefined,
        stateTimeline: stateTimeline,
        states: (states.data || []) as Array<IncidentState>,
      });
    };

    load().catch((err: Error) => {
      if (!isCancelled) {
        setError({ incidentId: incidentId, text: API.getFriendlyMessage(err) });
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [incidentId]);

  const errorText: string = error.incidentId === incidentId ? error.text : "";

  if (errorText) {
    return (
      <Card title="Metrics" description="Metrics related to this incident.">
        <ErrorMessage message={errorText} />
      </Card>
    );
  }

  if (!loaded || loaded.incidentId !== incidentId) {
    return (
      <Card title="Metrics" description="Metrics related to this incident.">
        <ComponentLoader />
      </Card>
    );
  }

  if (!loaded.metrics) {
    // No metrics behind this incident: nothing to show.
    return null;
  }

  return (
    /*
     * Mounted once the incident is read, as the investigation asks: a link
     * to one of its ranges is read when it mounts. Another incident mounts
     * a card of its own, on its own defaults.
     */
    <EventMetricInvestigationPanel
      key={incidentId}
      telemetryQuery={loaded.metrics.telemetryQuery}
      evaluationWindow={loaded.metrics.evaluationWindow}
      seriesSummary={loaded.metrics.seriesSummary}
      subject={EventMetricSubject.Incident}
      eventId={incidentId}
      startedAt={loaded.startedAt}
      endedAt={loaded.endedAt}
      impactStartedAt={loaded.impactStartedAt}
      stateTimeline={loaded.stateTimeline}
      states={loaded.states}
      urlParamPrefix={ROOT_CAUSE_METRICS_URL_PREFIX}
      showsCompanionTabs={false}
      chartedFromMonitorNow={loaded.metrics.chartedFromMonitorNow}
    />
  );
};

export default IncidentRootCauseMetricChart;
