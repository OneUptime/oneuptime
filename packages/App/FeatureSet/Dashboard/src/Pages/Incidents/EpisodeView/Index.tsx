import LabelsElement from "Common/UI/Components/Label/Labels";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { StateListType } from "Common/Utils/StateOrder";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import IncidentEpisodeFeedElement from "../../../Components/IncidentEpisode/IncidentEpisodeFeed";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import PrivateRecordPublicNotes from "Common/Types/StatusPage/PrivateRecordPublicNotes";
import IncidentEpisodeMemberRoleAssignment from "../../../Components/IncidentEpisode/IncidentEpisodeMemberRoleAssignment";
import { assignIncidentEpisodeRole } from "../../../Utils/EventRoleAssignment";
import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import { PeoplePickerOption } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGate } from "Common/UI/Utils/PrivateRecordScope";
import { OwnersChange } from "../../../Components/Owners/AddOwners";
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
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ChangeEpisodeState from "../../../Components/IncidentEpisode/ChangeState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
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
import EventWhatHappenedCard from "../../../Components/EventView/EventWhatHappenedCard";
import useEventOwners, {
  EventOwnersState,
} from "../../../Components/EventView/useEventOwners";
import { EventStatusFact } from "../../../Components/EventView/EventStatusPanel";
import { getEventStartedByText } from "../../../Utils/EventOverview";
import EventStartTileValue from "../../../Components/EventView/EventStartTileValue";
import {
  getCommanderFact,
  getOwnersFact,
} from "../../../Components/EventView/EventPeopleFacts";
import {
  EventRolesSnapshot,
  PrimaryRoleHolding,
  getPrimaryRoleHolding,
  withRoleGiven,
} from "../../../Utils/EventPeople";
import IncidentEpisodeOwnerTeam from "Common/Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "Common/Models/DatabaseModels/IncidentEpisodeOwnerUser";
import EpisodeMembersCard from "../../../Components/EpisodeView/EpisodeMembersCard";
import {
  INCIDENT_EPISODE_MEMBERSHIP,
  INCIDENT_EPISODE_MEMBER_SELECT,
  getIncidentEpisodeMemberRow,
} from "../../../Components/EpisodeView/EpisodeMembers";
import {
  FetchedEpisodeMembers,
  fetchEpisodeMembers,
} from "../../../Components/EpisodeView/FetchEpisodeMembers";
import {
  EpisodeTiming,
  getEpisodeTiming,
} from "../../../Components/EpisodeView/EpisodeTiming";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useRecordChannelLinks, {
  getOpenInChatActions,
} from "../../../Components/Workspace/useRecordChannelLinks";
import usePassOnPage, {
  PassOnPageControls,
} from "../../../Components/OnCallPolicy/PassOn/usePassOnPage";
import { OnCallPageRecordType } from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import RecordChannelMembersCard from "../../../Components/Workspace/RecordChannelMembersCard";
import {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "Common/Types/Workspace/WorkspaceChannelLink";

const IncidentEpisodeView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * On a private record's page, what the reader holds on it: a change of it
   * or of a part of it - a link, a member, a role - is offered only when a
   * team of theirs that owns it may make it (PrivateRecordScope).
   */
  const privateRecordGate: (
    model: BaseModel,
  ) => PermissionGateOptions | undefined = usePrivateRecordGate();
  const translator: Translator = useTranslator();
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
   * Members are the episode's membership, as on the member card: an incident
   * that joined this episode and then a later one is still this one's.
   */
  const [telemetrySnapshot, setTelemetrySnapshot] =
    useState<DerivedTelemetrySnapshot>(EMPTY_TELEMETRY_SNAPSHOT);

  const requestIdRef: MutableRefObject<number> = useRef<number>(0);
  const hasLoadedRef: MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * Who runs the episode, for its header: the commander from what the
   * roles card reads (stamped with the episode it was read for), and the
   * owners, teams first.
   */
  const [rolesSnapshot, setRolesSnapshot] = useState<{
    subjectId: string;
    value: EventRolesSnapshot;
  } | null>(null);
  const onRolesLoaded: (
    recordId: string,
    snapshot: EventRolesSnapshot,
  ) => void = useCallback(
    (recordId: string, snapshot: EventRolesSnapshot): void => {
      setRolesSnapshot({ subjectId: recordId, value: snapshot });
    },
    [],
  );
  const owners: EventOwnersState = useEventOwners({
    ownerUserModelType: IncidentEpisodeOwnerUser,
    ownerTeamModelType: IncidentEpisodeOwnerTeam,
    resourceIdField: "incidentEpisodeId",
    resourceId: modelId,
  });
  /*
   * Bumped when the header's Assign gave the commander, so the roles card
   * reads the episode's roles again and shows the same.
   */
  const [rolesRefreshToken, setRolesRefreshToken] = useState<number>(0);
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
      const [firstMembers, episodeTimelines, stateList, loaded]: [
        FetchedEpisodeMembers<Incident> | null,
        ListResult<IncidentEpisodeStateTimeline>,
        ListResult<IncidentState>,
        IncidentEpisode | null,
      ] = await Promise.all([
        /*
         * The one read here the page can do without: it takes the episode's
         * membership as well as its incidents, and a reader who may not read
         * the membership (a custom role) still gets the overview, without
         * the panel.
         */
        fetchEpisodeMembers<Incident, IncidentEpisodeMember>({
          episodeId: modelId,
          membership: INCIDENT_EPISODE_MEMBERSHIP,
          modelType: Incident,
          select: {
            _id: true,
            telemetryQuery: true,
            seriesLabels: true,
          },
          sortField: "declaredAt",
          sortOrder: SortOrder.Ascending,
          limit: 1,
        }).catch((): null => {
          return null;
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
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
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
            // The What happened card, and who opened it under Declared.
            description: true,
            rootCause: true,
            createdByUser: {
              name: true,
              email: true,
            },
            isManuallyCreated: true,
            // A private episode takes no public notes: see its feed.
            isPrivate: true,
          },
        }),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      const firstMember: Incident | undefined = firstMembers?.members[0];

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

  // The episode's own Slack and Teams channels: Open in Slack / Teams.
  const channelLinks: Array<WorkspaceChannelLink> = useRecordChannelLinks({
    recordType: WorkspaceChannelRecordType.IncidentEpisode,
    recordId: modelId,
    // A rule's channel arrives a moment after a new episode is created.
    recordStartedAt:
      loadedModelId === modelIdString
        ? episode?.declaredAt || episode?.createdAt || undefined
        : undefined,
  });

  // "Escalate", for somebody an on-call policy is paging about it.
  const passOn: PassOnPageControls = usePassOnPage({
    recordType: OnCallPageRecordType.IncidentEpisode,
    recordId: modelId,
    // Escalating is a new feed entry.
    onPassedOn: () => {
      setContentRefreshToken((token: number): number => {
        return token + 1;
      });
    },
    // Somebody took it while the dialog asked: the page reads it again.
    onRecordChanged: () => {
      setHeaderRefreshToken((token: number): number => {
        return token + 1;
      });
      setContentRefreshToken((token: number): number => {
        return token + 1;
      });
      refreshInPlace();
    },
  });

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
    list: StateListType.IncidentState,
    states: incidentStates.map((state: IncidentState) => {
      return {
        id: state.id?.toString() || "",
        name: state.name,
        order: state.order,
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

  /*
   * Who runs the episode, first in its header: the commander (the
   * project's primary incident role) and the owners, teams first, each
   * filled right there - Assign and Add - while the episode is open, by a
   * reader who may give a role or add an owner.
   */
  const peopleFacts: Array<EventStatusFact> = [];
  const primaryRole: PrimaryRoleHolding | null = getPrimaryRoleHolding(
    rolesSnapshot?.subjectId === modelIdString
      ? rolesSnapshot.value
      : undefined,
  );
  const mayAssignRoles: boolean = PermissionGate.check(
    new IncidentEpisodeRoleMember(),
    ModelAction.Create,
    privateRecordGate(new IncidentEpisodeRoleMember()),
  ).isAllowed;
  const commanderFact: EventStatusFact | null = getCommanderFact({
    holding: primaryRole,
    onAssign:
      timing.isResolved || !primaryRole || !mayAssignRoles
        ? undefined
        : async (person: PeoplePickerOption): Promise<void> => {
            const episodeId: string = modelIdString;

            await assignIncidentEpisodeRole({
              incidentEpisodeId: new ObjectID(episodeId),
              userId: new ObjectID(person.id),
              roleId: new ObjectID(primaryRole.role.id),
            });

            // Named at once; the roles card's read says the same a moment later.
            setRolesSnapshot(
              (
                current: {
                  subjectId: string;
                  value: EventRolesSnapshot;
                } | null,
              ): {
                subjectId: string;
                value: EventRolesSnapshot;
              } | null => {
                if (!current || current.subjectId !== episodeId) {
                  return current;
                }

                return {
                  subjectId: episodeId,
                  value:
                    withRoleGiven({
                      snapshot: current.value,
                      roleId: primaryRole.role.id,
                      person: person,
                    }) || current.value,
                };
              },
            );
            setRolesRefreshToken((token: number): number => {
              return token + 1;
            });
            // Role changes are recorded on the episode feed.
            setContentRefreshToken((token: number): number => {
              return token + 1;
            });
          },
  });

  if (commanderFact) {
    peopleFacts.push(commanderFact);
  }

  const ownersFact: EventStatusFact | null = getOwnersFact({
    owners: owners.owners,
    ownersRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_EPISODE_VIEW_OWNERS] as Route,
      { modelId: modelId },
    ),
    addOwners:
      !timing.isResolved && owners.canAddOwners
        ? {
            target: owners.target,
            onOwnersChanged: async (change: OwnersChange): Promise<void> => {
              // An owner added is recorded on the episode feed.
              if (change.wasAdded) {
                setContentRefreshToken((token: number): number => {
                  return token + 1;
                });
              }
              await owners.refresh();
            },
          }
        : undefined,
  });

  if (ownersFact) {
    peopleFacts.push(ownersFact);
  }

  return (
    <div className="space-y-5">
      <ChangeEpisodeState
        episodeId={modelId}
        peopleFacts={peopleFacts}
        secondaryActions={[
          ...passOn.actions,
          ...getOpenInChatActions(channelLinks),
        ]}
        refreshToken={headerRefreshToken}
        onActionComplete={async () => {
          // The change also moved the member incidents; reload what shows them.
          setContentRefreshToken((token: number): number => {
            return token + 1;
          });
          setDetailsRefresher((refresher: boolean): boolean => {
            return !refresher;
          });
          // Acknowledging it ends the reader's own page, if they had one.
          passOn.refresh();
          await fetchData();
        }}
      />
      {passOn.dialog}

      {refreshError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-100"
        >
          <span className="min-w-0 break-words">
            {translator.translateTemplate(
              "Couldn't refresh episode timings: {{error}}",
              { error: refreshError },
            )}
          </span>
          <button
            type="button"
            onClick={refreshInPlace}
            className="rounded-sm font-medium underline underline-offset-2 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {translator.translateText("Try again")}
          </button>
        </div>
      )}

      <EventStatBar columns={4} ariaLabel="Episode timing">
        {/*
         * When it was declared and by whom, then how long until it was
         * acknowledged and resolved, then how many incidents it holds. How
         * long it has lasted is the header's, beside its state.
         */}
        <EventStatTile
          variant="segment"
          label="Declared"
          icon={IconProp.Calendar}
          value={
            timing.durationStartsAt ? (
              <EventStartTileValue startedAt={timing.durationStartsAt} />
            ) : (
              "-"
            )
          }
          description={getEventStartedByText(
            {
              user: episode?.createdByUser,
              /*
               * A grouping rule opened it. A manual episode whose creator
               * is not on record says nothing rather than Automatically.
               */
              isCreatedAutomatically: episode?.isManuallyCreated === false,
            },
            translator,
          )}
        />
        <EventStatTile
          variant="segment"
          label={translator.translateTemplate("{{stateName}} in", {
            stateName: translatableTerm(timing.acknowledgedStateName),
          })}
          icon={IconProp.Check}
          value={timing.timeToAcknowledge}
        />
        <EventStatTile
          variant="segment"
          label={translator.translateTemplate("{{stateName}} in", {
            stateName: translatableTerm(timing.resolvedStateName),
          })}
          icon={IconProp.CheckCircle}
          value={timing.timeToResolve}
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
          {/*
           * What happened - the episode's description and, once somebody
           * knows it, its root cause - before the incidents it holds.
           */}
          <EventWhatHappenedCard<IncidentEpisode>
            modelType={IncidentEpisode}
            modelId={modelId}
            description={episode?.description}
            rootCause={episode?.rootCause}
            // A status page that shows the episode shows its description.
            statusPageRecord="episode"
            onSaved={() => {
              refreshInPlace();
              // An edited root cause is a new feed entry.
              setContentRefreshToken((token: number): number => {
                return token + 1;
              });
            }}
          />

          <EpisodeMembersCard<Incident, IncidentEpisodeMember>
            modelType={Incident}
            episodeId={modelId}
            membership={INCIDENT_EPISODE_MEMBERSHIP}
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
            isPrivate={!PrivateRecordPublicNotes.takesPublicNotes(episode)}
          />
        </div>

        <div className="min-w-0 xl:col-span-1">
          {/* Who is in the episode's own channel, above its details. */}
          <RecordChannelMembersCard
            recordType={WorkspaceChannelRecordType.IncidentEpisode}
            recordId={modelId}
            links={channelLinks}
            // Somebody added is a new feed entry.
            onChanged={() => {
              setContentRefreshToken((token: number): number => {
                return token + 1;
              });
            }}
          />

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
            formFields={[
              {
                field: {
                  title: true,
                },
                title: "Episode Title",
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
                dropdownModal: {
                  type: IncidentSeverity,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: true,
                placeholder: "Episode Severity",
              },
              getLabelsFormField<IncidentEpisode>(),
            ]}
            modelDetailProps={{
              selectMoreFields: {
                episodeNumberWithPrefix: true,
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

                    return (
                      <span>{translator.translateText("Manual Episode")}</span>
                    );
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
            /*
             * The header names the commander from what this card reads; a
             * commander given in the header makes it read again.
             */
            onRolesLoaded={onRolesLoaded}
            refreshToken={rolesRefreshToken}
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
