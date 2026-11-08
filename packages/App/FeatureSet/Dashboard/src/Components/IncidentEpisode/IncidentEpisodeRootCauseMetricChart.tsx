import React, { FunctionComponent, ReactElement } from "react";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { StateListType } from "Common/Utils/StateOrder";
import EventRootCauseMetricChart, {
  RootCauseEventReader,
  RootCauseMoments,
} from "../Telemetry/EventRootCauseMetricChart";
import {
  INCIDENT_EPISODE_FIRST_MEMBER,
  fetchFirstEpisodeMember,
} from "../EpisodeView/EpisodeFirstMember";
import { EventStateTimelineDate } from "../../Utils/EventDuration";
import { EventMetricSubject } from "../../Utils/EventMetricInvestigation";
import {
  RootCauseEvent,
  getIncidentEpisodeRootCauseEvent,
  getIncidentEpisodeRootCauseTimes,
} from "../../Utils/EventRootCauseMetrics";

export interface ComponentProps {
  incidentEpisodeId: ObjectID;
}

/*
 * How the Root Cause card reads an incident episode: its first incident, as
 * its Overview picks it (EpisodeFirstMember) - the columns that decide what
 * it charts, with the monitors it is on, as an incident's own card reads
 * them; then, for a card there is, the episode itself, as its Overview reads
 * it: when it was declared and resolved, its state timeline and the
 * project's incident states.
 */
export const INCIDENT_EPISODE_ROOT_CAUSE_READER: RootCauseEventReader = {
  subject: EventMetricSubject.IncidentEpisode,
  stateList: StateListType.IncidentState,
  readEvent: async (episodeId: ObjectID): Promise<RootCauseEvent | null> => {
    const member: Incident | null = await fetchFirstEpisodeMember<
      Incident,
      IncidentEpisodeMember
    >({
      episodeId: episodeId,
      kind: INCIDENT_EPISODE_FIRST_MEMBER,
      select: {
        _id: true,
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

    return member ? getIncidentEpisodeRootCauseEvent(member) : null;
  },
  readMoments: async (episodeId: ObjectID): Promise<RootCauseMoments> => {
    const [episode, timelines, states]: [
      IncidentEpisode | null,
      ListResult<IncidentEpisodeStateTimeline>,
      ListResult<IncidentState>,
    ] = await Promise.all([
      ModelAPI.getItem<IncidentEpisode>({
        modelType: IncidentEpisode,
        id: episodeId,
        select: {
          declaredAt: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
      ModelAPI.getList<IncidentEpisodeStateTimeline>({
        modelType: IncidentEpisodeStateTimeline,
        query: {
          incidentEpisodeId: episodeId,
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
    ).map((timeline: IncidentEpisodeStateTimeline): EventStateTimelineDate => {
      return {
        stateId: timeline.incidentStateId?.toString(),
        startsAt: timeline.startsAt,
      };
    });
    const projectStates: Array<IncidentState> = (states.data ||
      []) as Array<IncidentState>;

    return {
      stateTimeline: stateTimeline,
      states: projectStates,
      times: getIncidentEpisodeRootCauseTimes({
        episode: episode,
        stateTimeline: stateTimeline,
        states: projectStates,
      }),
    };
  },
};

/**
 * The metrics behind an incident episode, beside its root cause (issue
 * #6320): the Root Cause card an incident's page shows
 * (EventRootCauseMetricChart), reading the episode - its first incident's
 * metrics, as its Overview charts them, around the episode, with every
 * incident in it marked on the charts.
 */
const IncidentEpisodeRootCauseMetricChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EventRootCauseMetricChart
      eventId={props.incidentEpisodeId}
      reader={INCIDENT_EPISODE_ROOT_CAUSE_READER}
    />
  );
};

export default IncidentEpisodeRootCauseMetricChart;
