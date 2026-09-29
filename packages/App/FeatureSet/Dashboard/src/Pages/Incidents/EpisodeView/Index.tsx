import LabelsElement from "Common/UI/Components/Label/Labels";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import IncidentEpisodeFeedElement from "../../../Components/IncidentEpisode/IncidentEpisodeFeed";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import IncidentEpisodeMemberRoleAssignment from "../../../Components/IncidentEpisode/IncidentEpisodeMemberRoleAssignment";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import UserElement from "../../../Components/User/User";
import ChangeEpisodeState from "../../../Components/IncidentEpisode/ChangeState";
import Incident from "Common/Models/DatabaseModels/Incident";
import TelemetrySnapshotPanel from "../../../Components/Telemetry/TelemetrySnapshotPanel";
import {
  DerivedTelemetrySnapshot,
  EMPTY_TELEMETRY_SNAPSHOT,
  deriveTelemetrySnapshot,
} from "../../../Utils/TelemetrySnapshot";
import { JSONObject } from "Common/Types/JSON";
import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import LiveDuration from "../../../Components/EventView/LiveDuration";
import EpisodeMembersCard from "../../../Components/EpisodeView/EpisodeMembersCard";
import {
  INCIDENT_EPISODE_MEMBER_SELECT,
  getIncidentEpisodeMemberRow,
} from "../../../Components/EpisodeView/EpisodeMembers";
import {
  EpisodeTiming,
  getEpisodeTiming,
} from "../../../Components/EpisodeView/EpisodeTiming";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

const IncidentEpisodeView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();

  const [episode, setEpisode] = useState<IncidentEpisode | null>(null);
  const [episodeStateTimeline, setEpisodeStateTimeline] = useState<
    IncidentEpisodeStateTimeline[]
  >([]);
  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);

  /*
   * Which episode the state above was loaded for (or failed to load for).
   * Only the first load of an episode shows the skeleton. Everything after
   * it - a state change, a role change, an edit - reloads in place, so the
   * feed, telemetry and member list keep their scroll position and paging.
   *
   * Decided at render time, not reset in an effect: the page stays mounted
   * when the reader moves to another episode on the same route, and an effect
   * runs only after a render that would already have handed every card the
   * new id over the previous episode's numbers.
   */
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [refreshError, setRefreshError] = useState<string>("");

  // Reloads the children that fetch for themselves, without remounting them.
  const [contentRefreshToken, setContentRefreshToken] = useState<number>(0);
  const [headerRefreshToken, setHeaderRefreshToken] = useState<number>(0);
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);

  /*
   * Telemetry snapshot of the episode's FIRST member incident (earliest
   * declared): episodes group many incidents from one root cause, so the
   * first member's evaluation window is the "what kicked this off" view.
   */
  const [telemetrySnapshot, setTelemetrySnapshot] =
    useState<DerivedTelemetrySnapshot>(EMPTY_TELEMETRY_SNAPSHOT);

  const requestIdRef: MutableRefObject<number> = useRef<number>(0);
  const hasLoadedRef: MutableRefObject<boolean> = useRef<boolean>(false);
  /*
   * The episode the page is on now. A callback from a card rendered for the
   * previous episode can still fire after the switch (a state change or a
   * save that lands late); its reload must not cancel this episode's load.
   */
  const currentModelIdRef: MutableRefObject<string> =
    useRef<string>(modelIdString);

  const fetchData: () => Promise<void> = async (): Promise<void> => {
    // The episode this fetch was started for, captured with this render.
    const requestedModelId: string = modelIdString;

    if (requestedModelId !== currentModelIdRef.current) {
      // A card rendered for the episode the reader already left.
      return;
    }

    const requestId: number = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const [memberIncidents, episodeTimelines, stateList, loaded]: [
        ListResult<Incident>,
        ListResult<IncidentEpisodeStateTimeline>,
        ListResult<IncidentState>,
        IncidentEpisode | null,
      ] = await Promise.all([
        ModelAPI.getList({
          modelType: Incident,
          query: {
            incidentEpisodeId: modelId,
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            telemetryQuery: true,
            seriesLabels: true,
          },
          sort: {
            declaredAt: SortOrder.Ascending,
          },
        }),
        ModelAPI.getList({
          modelType: IncidentEpisodeStateTimeline,
          query: {
            incidentEpisodeId: modelId,
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
        ModelAPI.getList({
          modelType: IncidentState,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            isAcknowledgedState: true,
            isResolvedState: true,
          },
          sort: {},
        }),
        ModelAPI.getItem({
          modelType: IncidentEpisode,
          id: modelId,
          select: {
            declaredAt: true,
            createdAt: true,
            resolvedAt: true,
            incidentCount: true,
            shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
          },
        }),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      const firstMember: Incident | undefined = memberIncidents.data[0];

      setTelemetrySnapshot(
        deriveTelemetrySnapshot({
          storedTelemetryQuery: firstMember?.telemetryQuery,
          seriesLabels: firstMember?.seriesLabels as JSONObject | undefined,
        }),
      );

      setEpisode(loaded);
      setIncidentStates(stateList.data as IncidentState[]);
      setEpisodeStateTimeline(
        episodeTimelines.data as IncidentEpisodeStateTimeline[],
      );
      setError("");
      setRefreshError("");
      hasLoadedRef.current = true;
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      // A failed refresh keeps the loaded page; only a failed first load blanks it.
      if (hasLoadedRef.current) {
        setRefreshError(BaseAPI.getFriendlyMessage(err));
      } else {
        setError(BaseAPI.getFriendlyMessage(err));
      }
    }

    setLoadedModelId(requestedModelId);
  };

  useEffect(() => {
    /*
     * A different episode is a first load again. The skeleton is already on
     * screen (loadedModelId still names the previous episode); forget the
     * previous episode's errors while it is. On mount these are no-ops.
     */
    currentModelIdRef.current = modelIdString;
    hasLoadedRef.current = false;
    setError("");
    setRefreshError("");

    fetchData().catch((err: Error) => {
      setError(BaseAPI.getFriendlyMessage(err));
      setLoadedModelId(modelIdString);
    });

    return () => {
      requestIdRef.current += 1;
    };
  }, [modelIdString]);

  const refreshInPlace: () => void = (): void => {
    fetchData().catch((err: Error) => {
      setRefreshError(BaseAPI.getFriendlyMessage(err));
    });
  };

  if (loadedModelId !== modelIdString) {
    return (
      <EventOverviewSkeleton statCount={4} loadingText="Loading episode" />
    );
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setError("");
          // Back to the skeleton while the retry is in flight.
          setLoadedModelId(null);
          fetchData().catch((err: Error) => {
            setError(BaseAPI.getFriendlyMessage(err));
            setLoadedModelId(modelIdString);
          });
        }}
      />
    );
  }

  const timing: EpisodeTiming = getEpisodeTiming({
    // Older episodes predate declaredAt; they started when they were created.
    startedAt: episode?.declaredAt || episode?.createdAt || undefined,
    resolvedAt: episode?.resolvedAt || undefined,
    states: incidentStates.map((state: IncidentState) => {
      return {
        id: state.id?.toString() || "",
        name: state.name,
        isAcknowledgedState: state.isAcknowledgedState,
        isResolvedState: state.isResolvedState,
      };
    }),
    timelines: episodeStateTimeline.map(
      (timeline: IncidentEpisodeStateTimeline) => {
        return {
          stateId: timeline.incidentStateId?.toString(),
          startsAt: timeline.startsAt,
        };
      },
    ),
  });

  const incidentCount: number | undefined =
    typeof episode?.incidentCount === "number"
      ? episode.incidentCount
      : undefined;

  /*
   * Off when the episode was created without notifying status page
   * subscribers; the feed's public note form then starts with "Notify Status
   * Page Subscribers" unticked. Read from the loaded episode, so it always
   * belongs to the episode on screen: the skeleton above covers the page
   * until another episode has loaded.
   */
  const notifyStatusPageSubscribersByDefault: boolean =
    PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
      episode,
    );

  return (
    <div className="space-y-5">
      <ChangeEpisodeState
        episodeId={modelId}
        refreshToken={headerRefreshToken}
        onActionComplete={async () => {
          // The change also moved the member incidents; reload what shows them.
          setContentRefreshToken((token: number): number => {
            return token + 1;
          });
          setDetailsRefresher((refresher: boolean): boolean => {
            return !refresher;
          });
          await fetchData();
        }}
      />

      {refreshError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-100"
        >
          <span className="min-w-0 break-words">
            {`Couldn't refresh episode timings: ${refreshError}`}
          </span>
          <button
            type="button"
            onClick={refreshInPlace}
            className="rounded-sm font-medium underline underline-offset-2 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Try again
          </button>
        </div>
      )}

      <EventStatBar columns={4} ariaLabel="Episode timing">
        <EventStatTile
          variant="segment"
          label={`${timing.acknowledgedStateName} in`}
          icon={IconProp.Check}
          value={timing.timeToAcknowledge}
        />
        <EventStatTile
          variant="segment"
          label={`${timing.resolvedStateName} in`}
          icon={IconProp.CheckCircle}
          value={timing.timeToResolve}
        />
        <EventStatTile
          variant="segment"
          label="Duration"
          icon={IconProp.Clock}
          value={
            timing.durationStartsAt ? (
              <LiveDuration
                startDate={timing.durationStartsAt}
                endDate={timing.durationEndsAt}
              />
            ) : (
              "-"
            )
          }
        />
        <EventStatTile
          variant="segment"
          label="Incidents"
          icon={IconProp.Alert}
          value={incidentCount === undefined ? "-" : incidentCount.toString()}
        />
      </EventStatBar>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <EpisodeMembersCard<Incident>
            modelType={Incident}
            episodeId={modelId}
            episodeIdField="incidentEpisodeId"
            select={INCIDENT_EPISODE_MEMBER_SELECT}
            sortField="declaredAt"
            toRow={getIncidentEpisodeMemberRow}
            title="Incidents in this episode"
            singularNoun="incident"
            pluralNoun="incidents"
            viewAllRoute={RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS] as Route,
              { modelId: modelId },
            )}
            getMemberRoute={(memberId: ObjectID): Route => {
              return RouteUtil.populateRouteParams(
                RouteMap[PageMap.INCIDENT_VIEW] as Route,
                { modelId: memberId },
              );
            }}
            refreshToken={contentRefreshToken}
          />

          {telemetrySnapshot.telemetryQuery && (
            <div className="mb-5">
              <TelemetrySnapshotPanel
                telemetryQuery={telemetrySnapshot.telemetryQuery}
                snapshotWindow={telemetrySnapshot.snapshotWindow}
                seriesSummary={telemetrySnapshot.seriesSummary}
                eventNoun="incident"
              />
            </div>
          )}

          <IncidentEpisodeFeedElement
            incidentEpisodeId={modelId}
            refreshToken={contentRefreshToken}
            notifyStatusPageSubscribersByDefault={
              notifyStatusPageSubscribersByDefault
            }
          />
        </div>

        <div className="min-w-0 xl:col-span-1">
          <CardModelDetail<IncidentEpisode>
            name="Episode Details"
            cardProps={{
              title: "Episode Details",
              description: "Key facts about this episode.",
              headerLayout: "stacked",
            }}
            isEditable={true}
            editButtonText="Edit"
            refresher={detailsRefresher}
            onSaveSuccess={() => {
              // Title and severity show in the header; the edit lands in the feed.
              setHeaderRefreshToken((token: number): number => {
                return token + 1;
              });
              setContentRefreshToken((token: number): number => {
                return token + 1;
              });
              refreshInPlace();
            }}
            formSteps={[
              {
                title: "Episode Details",
                id: "episode-details",
              },
              {
                title: "Labels",
                id: "labels",
              },
            ]}
            formFields={[
              {
                field: {
                  title: true,
                },
                title: "Episode Title",
                stepId: "episode-details",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Episode Title",
                validation: {
                  minLength: 2,
                },
              },
              {
                field: {
                  incidentSeverity: true,
                },
                title: "Episode Severity",
                description: "What is the severity of this episode?",
                fieldType: FormFieldSchemaType.Dropdown,
                stepId: "episode-details",
                dropdownModal: {
                  type: IncidentSeverity,
                  labelField: "name",
                  valueField: "_id",
                },
                required: true,
                placeholder: "Episode Severity",
              },
              {
                field: {
                  labels: true,
                },
                title: "Labels ",
                stepId: "labels",
                description:
                  "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: Label,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Labels",
              },
            ]}
            modelDetailProps={{
              selectMoreFields: {
                episodeNumberWithPrefix: true,
                createdByUser: {
                  _id: true,
                  name: true,
                  email: true,
                  profilePictureId: true,
                },
              },
              showDetailsInNumberOfColumns: 1,
              style: DetailStyle.Compact,
              modelType: IncidentEpisode,
              id: "model-detail-episodes",
              fields: [
                {
                  field: {
                    episodeNumber: true,
                    episodeNumberWithPrefix: true,
                  },
                  title: "Episode Number",
                  fieldType: FieldType.Element,
                  getElement: (item: IncidentEpisode): ReactElement => {
                    if (!item.episodeNumber) {
                      return <>-</>;
                    }

                    return (
                      <span className="font-semibold tabular-nums text-gray-900">
                        {item.episodeNumberWithPrefix ||
                          `#${item.episodeNumber}`}
                      </span>
                    );
                  },
                },
                {
                  field: {
                    currentIncidentState: {
                      color: true,
                      name: true,
                    },
                  },
                  title: "Current State",
                  fieldType: FieldType.Entity,
                  getElement: (item: IncidentEpisode): ReactElement => {
                    if (!item["currentIncidentState"]) {
                      return <>-</>;
                    }

                    return (
                      <Pill
                        color={item.currentIncidentState.color || Black}
                        text={item.currentIncidentState.name || "Unknown"}
                      />
                    );
                  },
                },
                {
                  field: {
                    incidentSeverity: {
                      color: true,
                      name: true,
                    },
                  },
                  title: "Episode Severity",
                  fieldType: FieldType.Entity,
                  getElement: (item: IncidentEpisode): ReactElement => {
                    if (!item["incidentSeverity"]) {
                      return <>-</>;
                    }

                    return (
                      <Pill
                        color={item.incidentSeverity.color || Black}
                        text={item.incidentSeverity.name || "Unknown"}
                      />
                    );
                  },
                },
                {
                  field: {
                    incidentCount: true,
                  },
                  title: "Incident Count",
                  fieldType: FieldType.Number,
                },
                {
                  field: {
                    incidentGroupingRule: {
                      name: true,
                      _id: true,
                    },
                  },
                  title: "Grouping Rule",
                  fieldType: FieldType.Element,
                  getElement: (item: IncidentEpisode): ReactElement => {
                    if (item.incidentGroupingRule?.name) {
                      return <span>{item.incidentGroupingRule.name}</span>;
                    }

                    return <span>Manual Episode</span>;
                  },
                },
                {
                  field: {
                    createdByUser: {
                      name: true,
                      email: true,
                      profilePictureId: true,
                    },
                  },
                  title: "Created By",
                  fieldType: FieldType.Element,
                  getElement: (item: IncidentEpisode): ReactElement => {
                    if (item.createdByUser) {
                      return <UserElement user={item.createdByUser} />;
                    }

                    return <span>System</span>;
                  },
                },
                {
                  field: {
                    onCallDutyPolicies: {
                      name: true,
                      _id: true,
                    },
                  },
                  title: "On-Call Duty Policies",
                  fieldType: FieldType.Element,
                  getElement: (item: IncidentEpisode): ReactElement => {
                    return (
                      <OnCallDutyPoliciesView
                        onCallPolicies={item.onCallDutyPolicies || []}
                      />
                    );
                  },
                },
                {
                  field: {
                    createdAt: true,
                  },
                  title: "Created At",
                  fieldType: FieldType.DateTime,
                },
                {
                  field: {
                    labels: {
                      name: true,
                      color: true,
                    },
                  },
                  title: "Labels",
                  fieldType: FieldType.Element,
                  getElement: (item: IncidentEpisode): ReactElement => {
                    return <LabelsElement labels={item["labels"] || []} />;
                  },
                },
                {
                  field: {
                    _id: true,
                  },
                  title: "Episode ID",
                  fieldType: FieldType.ObjectID,
                },
              ],
              modelId: modelId,
            }}
          />

          <IncidentEpisodeMemberRoleAssignment
            incidentEpisodeId={modelId}
            headerLayout="stacked"
            onMemberChange={async () => {
              // Role changes are recorded on the episode feed.
              setContentRefreshToken((token: number): number => {
                return token + 1;
              });
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default IncidentEpisodeView;
