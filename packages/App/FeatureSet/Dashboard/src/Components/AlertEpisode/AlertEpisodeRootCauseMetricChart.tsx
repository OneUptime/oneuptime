import React, { FunctionComponent, ReactElement } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "Common/Models/DatabaseModels/AlertState";
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
  ALERT_EPISODE_FIRST_MEMBER,
  fetchFirstEpisodeMember,
} from "../EpisodeView/EpisodeFirstMember";
import { EventStateTimelineDate } from "../../Utils/EventDuration";
import { EventMetricSubject } from "../../Utils/EventMetricInvestigation";
import {
  RootCauseEvent,
  getAlertEpisodeRootCauseEvent,
  getAlertEpisodeRootCauseTimes,
} from "../../Utils/EventRootCauseMetrics";

export interface ComponentProps {
  alertEpisodeId: ObjectID;
}

/*
 * How the Root Cause card reads an alert episode: its first alert, as its
 * Overview picks it (EpisodeFirstMember) - the columns that decide what it
 * charts, with its one monitor, only what the card reads of it, as an
 * alert's own card reads them; then, for a card there is, the episode
 * itself, as its Overview reads it: when it was created and resolved, its
 * state timeline and the project's alert states.
 */
export const ALERT_EPISODE_ROOT_CAUSE_READER: RootCauseEventReader = {
  subject: EventMetricSubject.AlertEpisode,
  stateList: StateListType.AlertState,
  readEvent: async (episodeId: ObjectID): Promise<RootCauseEvent | null> => {
    const member: Alert | null = await fetchFirstEpisodeMember<
      Alert,
      AlertEpisodeMember
    >({
      episodeId: episodeId,
      kind: ALERT_EPISODE_FIRST_MEMBER,
      select: {
        _id: true,
        telemetryQuery: true,
        seriesLabels: true,
        createdCriteriaId: true,
        monitor: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
        },
      },
    });

    return member ? getAlertEpisodeRootCauseEvent(member) : null;
  },
  readMoments: async (episodeId: ObjectID): Promise<RootCauseMoments> => {
    const [episode, timelines, states]: [
      AlertEpisode | null,
      ListResult<AlertEpisodeStateTimeline>,
      ListResult<AlertState>,
    ] = await Promise.all([
      ModelAPI.getItem<AlertEpisode>({
        modelType: AlertEpisode,
        id: episodeId,
        select: {
          createdAt: true,
          resolvedAt: true,
        },
      }),
      ModelAPI.getList<AlertEpisodeStateTimeline>({
        modelType: AlertEpisodeStateTimeline,
        query: {
          alertEpisodeId: episodeId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          startsAt: true,
          alertStateId: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
      }),
      ModelAPI.getList<AlertState>({
        modelType: AlertState,
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
    ).map((timeline: AlertEpisodeStateTimeline): EventStateTimelineDate => {
      return {
        stateId: timeline.alertStateId?.toString(),
        startsAt: timeline.startsAt,
      };
    });
    const projectStates: Array<AlertState> = (states.data ||
      []) as Array<AlertState>;

    return {
      stateTimeline: stateTimeline,
      states: projectStates,
      times: getAlertEpisodeRootCauseTimes({
        episode: episode,
        stateTimeline: stateTimeline,
        states: projectStates,
      }),
    };
  },
};

/**
 * The metrics behind an alert episode, beside its root cause (issue #6320):
 * the Root Cause card an alert's page shows (EventRootCauseMetricChart),
 * reading the episode - its first alert's metrics, as its Overview charts
 * them, around the episode, with every alert in it marked on the charts.
 */
const AlertEpisodeRootCauseMetricChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EventRootCauseMetricChart
      eventId={props.alertEpisodeId}
      reader={ALERT_EPISODE_ROOT_CAUSE_READER}
    />
  );
};

export default AlertEpisodeRootCauseMetricChart;
