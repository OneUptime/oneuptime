import Page from "../../Components/Page/Page";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import PageComponentProps from "../PageComponentProps";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EventItem, {
  ComponentProps as EventItemComponentProps,
  TimelineAttachment,
  TimelineItem,
  TimelineItemType,
} from "Common/UI/Components/EventItem/EventItem";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import FileModel from "Common/Models/DatabaseModels/File";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

// Incident Event Item Helper
type GetIncidentEventItemFunctionProps = {
  incident: Incident;
  incidentPublicNotes: Array<IncidentPublicNote>;
  incidentStateTimelines: Array<IncidentStateTimeline>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
  isPreviewPage: boolean;
  isSummary: boolean;
};

type GetIncidentEventItemFunction = (
  props: GetIncidentEventItemFunctionProps,
) => EventItemComponentProps;

export const getIncidentEventItem: GetIncidentEventItemFunction = (
  props: GetIncidentEventItemFunctionProps,
): EventItemComponentProps => {
  const {
    incident,
    incidentPublicNotes,
    incidentStateTimelines,
    statusPageResources,
    monitorsInGroup,
    isPreviewPage,
    isSummary,
  } = props;

  const timeline: Array<TimelineItem> = [];

  let currentStateStatus: string = "";
  let currentStatusColor: Color = Green;

  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();
  const statusPageIdString: string | null = statusPageId
    ? statusPageId.toString()
    : null;
  const incidentIdString: string | null = incident.id
    ? incident.id.toString()
    : incident._id
      ? incident._id.toString()
      : null;

  if (isSummary) {
    // If this is summary then reverse the order so we show the latest first
    incidentPublicNotes.sort((a: IncidentPublicNote, b: IncidentPublicNote) => {
      return OneUptimeDate.isAfter(a.postedAt!, b.postedAt!) === false ? 1 : -1;
    });

    incidentStateTimelines.sort(
      (a: IncidentStateTimeline, b: IncidentStateTimeline) => {
        const aDate: Date = a.startsAt || a.createdAt!;
        const bDate: Date = b.startsAt || b.createdAt!;
        return OneUptimeDate.isAfter(aDate, bDate) === false ? 1 : -1;
      },
    );
  }

  for (const incidentPublicNote of incidentPublicNotes) {
    if (
      incidentPublicNote.incidentId?.toString() === incident.id?.toString() &&
      incidentPublicNote?.note
    ) {
      const noteIdString: string | null = incidentPublicNote.id
        ? incidentPublicNote.id.toString()
        : incidentPublicNote._id
          ? incidentPublicNote._id.toString()
          : null;

      const attachments: Array<TimelineAttachment> =
        statusPageIdString && incidentIdString && noteIdString
          ? (incidentPublicNote.attachments || [])
              .map((attachment: FileModel) => {
                const attachmentId: string | null = attachment.id
                  ? attachment.id.toString()
                  : attachment._id
                    ? attachment._id.toString()
                    : null;

                if (!attachmentId) {
                  return null;
                }

                const downloadRoute: Route = Route.fromString(
                  StatusPageApiRoute.toString(),
                ).addRoute(
                  `/incident-public-note/attachment/${statusPageIdString}/${incidentIdString}/${noteIdString}/${attachmentId}`,
                );

                return {
                  name: attachment.name || "Attachment",
                  downloadUrl: downloadRoute.toString(),
                };
              })
              .filter(
                (
                  attachment: TimelineAttachment | null,
                ): attachment is TimelineAttachment => {
                  return Boolean(attachment);
                },
              )
          : [];

      timeline.push({
        note: incidentPublicNote?.note,
        date: incidentPublicNote?.postedAt as Date,
        type: TimelineItemType.Note,
        icon: IconProp.Chat,
        iconColor: Gray500,
        ...(attachments.length > 0
          ? {
              attachments,
            }
          : {}),
      });

      // If this incident is a sumamry then don't include all the notes .
      if (isSummary) {
        break;
      }
    }
  }

  for (const incidentStateTimeline of incidentStateTimelines) {
    if (
      incidentStateTimeline.incidentId?.toString() ===
        incident.id?.toString() &&
      incidentStateTimeline.incidentState
    ) {
      timeline.push({
        state: incidentStateTimeline.incidentState,
        date:
          incidentStateTimeline?.startsAt ||
          (incidentStateTimeline?.createdAt as Date),
        type: TimelineItemType.StateChange,
        icon: incidentStateTimeline.incidentState.isCreatedState
          ? IconProp.Alert
          : incidentStateTimeline.incidentState.isAcknowledgedState
            ? IconProp.TransparentCube
            : incidentStateTimeline.incidentState.isResolvedState
              ? IconProp.CheckCircle
              : IconProp.ArrowCircleRight,
        iconColor: incidentStateTimeline.incidentState.color || Gray500,
      });

      if (!currentStateStatus) {
        currentStateStatus = incidentStateTimeline.incidentState?.name || "";
        currentStatusColor =
          incidentStateTimeline.incidentState?.color || Green;
      }

      // If this incident is a sumamry then don't include all the notes .
      if (isSummary) {
        break;
      }
    }
  }

  if (
    incident.showPostmortemOnStatusPage &&
    incident.postmortemNote &&
    incident.postmortemNote.trim() !== ""
  ) {
    const postmortemDate: Date =
      incident.postmortemPostedAt ||
      (incident.updatedAt as Date | undefined) ||
      incident.declaredAt ||
      (incident.createdAt as Date);

    const attachments: Array<TimelineAttachment> =
      statusPageIdString && incidentIdString
        ? (incident.postmortemAttachments || [])
            .map((attachment: FileModel) => {
              const attachmentId: string | null = attachment.id
                ? attachment.id.toString()
                : attachment._id
                  ? attachment._id.toString()
                  : null;

              if (!attachmentId) {
                return null;
              }

              const downloadRoute: Route = Route.fromString(
                StatusPageApiRoute.toString(),
              ).addRoute(
                `/incident/postmortem/attachment/${statusPageIdString}/${incidentIdString}/${attachmentId}`,
              );

              return {
                name: attachment.name || "Attachment",
                downloadUrl: downloadRoute.toString(),
              };
            })
            .filter(
              (
                attachment: TimelineAttachment | null,
              ): attachment is TimelineAttachment => {
                return Boolean(attachment);
              },
            )
        : [];

    timeline.push({
      note: incident.postmortemNote,
      date: postmortemDate,
      type: TimelineItemType.Note,
      icon: IconProp.DocumentCheck,
      iconColor: Gray500,
      title: "Incident Postmortem",
      highlight: true,
      ...(attachments.length > 0
        ? {
            attachments,
          }
        : {}),
    });
  }

  timeline.sort((a: TimelineItem, b: TimelineItem) => {
    return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
  });

  const monitorIdsInThisIncident: Array<string | undefined> =
    incident.monitors?.map((monitor: Monitor) => {
      return monitor._id;
    }) || [];

  let namesOfResources: Array<StatusPageResource> = statusPageResources.filter(
    (resource: StatusPageResource) => {
      return monitorIdsInThisIncident.includes(resource.monitorId?.toString());
    },
  );

  // add names of the groups as well.
  namesOfResources = namesOfResources.concat(
    statusPageResources.filter((resource: StatusPageResource) => {
      if (!resource.monitorGroupId) {
        return false;
      }

      const monitorGroupId: string = resource.monitorGroupId.toString();

      const monitorIdsInThisGroup: Array<ObjectID> =
        monitorsInGroup[monitorGroupId]! || [];

      for (const monitorId of monitorIdsInThisGroup) {
        if (
          monitorIdsInThisIncident.find((id: string | undefined) => {
            return id?.toString() === monitorId.toString();
          })
        ) {
          return true;
        }
      }

      return false;
    }),
  );

  const incidentDeclaredAt: Date | undefined =
    incident.declaredAt || (incident.createdAt as Date | undefined);

  const data: EventItemComponentProps = {
    eventTitle: incident.title || "",
    eventDescription: incident.description,
    eventResourcesAffected: namesOfResources.map((i: StatusPageResource) => {
      const groupName: string = i.statusPageGroup?.name || "";
      const displayName: string = i.displayName || "";
      return groupName ? `${groupName}: ${displayName}` : displayName;
    }),
    eventTimeline: timeline,
    eventType: "Incident",
    eventViewRoute: !isSummary
      ? undefined
      : RouteUtil.populateRouteParams(
          isPreviewPage
            ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
            : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
          incident.id!,
        ),
    isDetailItem: !isSummary,
    currentStatus: currentStateStatus,
    currentStatusColor: currentStatusColor,
    anotherStatusColor: incident.incidentSeverity?.color || undefined,
    anotherStatus: incident.incidentSeverity?.name,
    eventSecondDescription: incidentDeclaredAt
      ? "Declared at " +
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          incidentDeclaredAt,
        )
      : "",
    eventTypeColor: Red,
    labels:
      incident.labels?.map((label: Label) => {
        return {
          name: label.name!,
          color: label.color!,
        };
      }) || [],
  };

  return data;
};

// Episode Event Item Helper
type GetEpisodeEventItemFunctionProps = {
  episode: IncidentEpisode;
  episodePublicNotes: Array<IncidentEpisodePublicNote>;
  episodeStateTimelines: Array<IncidentEpisodeStateTimeline>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
  isPreviewPage: boolean;
  isSummary: boolean;
  statusPageId?: ObjectID | undefined;
};

type GetEpisodeEventItemFunction = (
  props: GetEpisodeEventItemFunctionProps,
) => EventItemComponentProps;

export const getEpisodeEventItem: GetEpisodeEventItemFunction = (
  props: GetEpisodeEventItemFunctionProps,
): EventItemComponentProps => {
  const {
    episode,
    episodePublicNotes,
    episodeStateTimelines,
    statusPageResources,
    monitorsInGroup,
    isPreviewPage,
    isSummary,
    statusPageId,
  } = props;

  const statusPageIdString: string | null = statusPageId
    ? statusPageId.toString()
    : null;
  const episodeIdString: string | null = episode.id
    ? episode.id.toString()
    : episode._id
      ? episode._id.toString()
      : null;

  // Get monitor IDs from episode (computed by backend from member incidents)
  const episodeMonitors: Array<Monitor> = (episode as any).monitors || [];
  const monitorIdsInThisEpisode: Array<string | undefined> = episodeMonitors.map(
    (monitor: Monitor) => {
      return monitor._id?.toString() || monitor.id?.toString();
    },
  );

  // Get affected resources from status page resources
  let namesOfResources: Array<StatusPageResource> = statusPageResources.filter(
    (resource: StatusPageResource) => {
      return monitorIdsInThisEpisode.includes(resource.monitorId?.toString());
    },
  );

  // Add names of the groups as well
  namesOfResources = namesOfResources.concat(
    statusPageResources.filter((resource: StatusPageResource) => {
      if (!resource.monitorGroupId) {
        return false;
      }

      const monitorGroupId: string = resource.monitorGroupId.toString();

      const monitorIdsInThisGroup: Array<ObjectID> =
        monitorsInGroup[monitorGroupId]! || [];

      for (const monitorId of monitorIdsInThisGroup) {
        if (
          monitorIdsInThisEpisode.find((id: string | undefined) => {
            return id?.toString() === monitorId.toString();
          })
        ) {
          return true;
        }
      }

      return false;
    }),
  );

  const timeline: Array<TimelineItem> = [];

  let currentStateStatus: string = "";
  let currentStatusColor: Color = Green;

  if (isSummary) {
    // If this is summary then reverse the order so we show the latest first
    episodePublicNotes.sort(
      (a: IncidentEpisodePublicNote, b: IncidentEpisodePublicNote) => {
        return OneUptimeDate.isAfter(a.postedAt!, b.postedAt!) === false
          ? 1
          : -1;
      },
    );

    episodeStateTimelines.sort(
      (a: IncidentEpisodeStateTimeline, b: IncidentEpisodeStateTimeline) => {
        const aDate: Date = a.startsAt || a.createdAt!;
        const bDate: Date = b.startsAt || b.createdAt!;
        return OneUptimeDate.isAfter(aDate, bDate) === false ? 1 : -1;
      },
    );
  }

  for (const episodePublicNote of episodePublicNotes) {
    if (
      episodePublicNote.incidentEpisodeId?.toString() ===
        episode.id?.toString() &&
      episodePublicNote?.note
    ) {
      const noteIdString: string | null = episodePublicNote.id
        ? episodePublicNote.id.toString()
        : episodePublicNote._id
          ? episodePublicNote._id.toString()
          : null;

      const attachments: Array<TimelineAttachment> =
        statusPageIdString && episodeIdString && noteIdString
          ? (episodePublicNote.attachments || [])
              .map((attachment: FileModel) => {
                const attachmentId: string | null = attachment.id
                  ? attachment.id.toString()
                  : attachment._id
                    ? attachment._id.toString()
                    : null;

                if (!attachmentId) {
                  return null;
                }

                const downloadRoute: Route = Route.fromString(
                  StatusPageApiRoute.toString(),
                ).addRoute(
                  `/incident-episode-public-note/attachment/${statusPageIdString}/${episodeIdString}/${noteIdString}/${attachmentId}`,
                );

                return {
                  name: attachment.name || "Attachment",
                  downloadUrl: downloadRoute.toString(),
                };
              })
              .filter(
                (
                  attachment: TimelineAttachment | null,
                ): attachment is TimelineAttachment => {
                  return Boolean(attachment);
                },
              )
          : [];

      timeline.push({
        note: episodePublicNote?.note,
        date: episodePublicNote?.postedAt as Date,
        type: TimelineItemType.Note,
        icon: IconProp.Chat,
        iconColor: Gray500,
        ...(attachments.length > 0
          ? {
              attachments,
            }
          : {}),
      });

      // If this episode is a summary then don't include all the notes.
      if (isSummary) {
        break;
      }
    }
  }

  for (const episodeStateTimeline of episodeStateTimelines) {
    if (
      episodeStateTimeline.incidentEpisodeId?.toString() ===
        episode.id?.toString() &&
      episodeStateTimeline.incidentState
    ) {
      timeline.push({
        state: episodeStateTimeline.incidentState,
        date:
          episodeStateTimeline?.startsAt ||
          (episodeStateTimeline?.createdAt as Date),
        type: TimelineItemType.StateChange,
        icon: episodeStateTimeline.incidentState.isCreatedState
          ? IconProp.Layers
          : episodeStateTimeline.incidentState.isAcknowledgedState
            ? IconProp.TransparentCube
            : episodeStateTimeline.incidentState.isResolvedState
              ? IconProp.CheckCircle
              : IconProp.ArrowCircleRight,
        iconColor: episodeStateTimeline.incidentState.color || Gray500,
      });

      if (!currentStateStatus) {
        currentStateStatus = episodeStateTimeline.incidentState?.name || "";
        currentStatusColor = episodeStateTimeline.incidentState?.color || Green;
      }

      // If this episode is a summary then don't include all the notes.
      if (isSummary) {
        break;
      }
    }
  }

  timeline.sort((a: TimelineItem, b: TimelineItem) => {
    return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
  });

  const episodeDeclaredAt: Date | undefined =
    episode.declaredAt || (episode.createdAt as Date | undefined);

  const data: EventItemComponentProps = {
    eventTitle: episode.title || "",
    eventDescription: episode.description,
    eventResourcesAffected: namesOfResources.map((i: StatusPageResource) => {
      const groupName: string = i.statusPageGroup?.name || "";
      const displayName: string = i.displayName || "";
      return groupName ? `${groupName}: ${displayName}` : displayName;
    }),
    eventTimeline: timeline,
    eventType: "Incident",
    eventViewRoute: !isSummary
      ? undefined
      : RouteUtil.populateRouteParams(
          isPreviewPage
            ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
            : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
          episode.id!,
        ),
    isDetailItem: !isSummary,
    currentStatus: currentStateStatus,
    currentStatusColor: currentStatusColor,
    anotherStatusColor: episode.incidentSeverity?.color || undefined,
    anotherStatus: episode.incidentSeverity?.name,
    eventSecondDescription: episodeDeclaredAt
      ? "Declared at " +
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          episodeDeclaredAt,
        )
      : "",
    eventTypeColor: Red,
    labels:
      episode.labels?.map((label: Label) => {
        return {
          name: label.name!,
          color: label.color!,
        };
      }) || [],
  };

  return data;
};

// Detail Page Component
const Detail: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  StatusPageUtil.checkIfUserHasLoggedIn();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);

  // Incident state
  const [incidentPublicNotes, setIncidentPublicNotes] = useState<
    Array<IncidentPublicNote>
  >([]);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [incidentStateTimelines, setIncidentStateTimelines] = useState<
    Array<IncidentStateTimeline>
  >([]);

  // Episode state
  const [episodePublicNotes, setEpisodePublicNotes] = useState<
    Array<IncidentEpisodePublicNote>
  >([]);
  const [episode, setEpisode] = useState<IncidentEpisode | null>(null);
  const [episodeStateTimelines, setEpisodeStateTimelines] = useState<
    Array<IncidentEpisodeStateTimeline>
  >([]);

  const [parsedData, setParsedData] = useState<EventItemComponentProps | null>(
    null,
  );

  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});

  const [isEpisode, setIsEpisode] = useState<boolean>(false);

  useAsyncEffect(async () => {
    try {
      if (!StatusPageUtil.getStatusPageId()) {
        return;
      }
      setIsLoading(true);

      const id: ObjectID = LocalStorage.getItem("statusPageId") as ObjectID;

      const itemId: string | undefined =
        Navigation.getLastParamAsObjectID().toString();

      if (!id) {
        throw new BadDataException("Status Page ID is required");
      }

      // First try to fetch as an incident
      let foundIncident: boolean = false;
      try {
        const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
          url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
            `/incidents/${id.toString()}/${itemId?.toString()}`,
          ),
          data: {},
          headers: API.getDefaultHeaders(),
        });

        if (response.isSuccess()) {
          const data: JSONObject = response.data;

          const incidentPublicNotes: Array<IncidentPublicNote> =
            BaseModel.fromJSONArray(
              (data["incidentPublicNotes"] as JSONArray) || [],
              IncidentPublicNote,
            );

          const rawIncidents: JSONArray =
            (data["incidents"] as JSONArray) || [];

          if (rawIncidents.length > 0) {
            const incident: Incident = BaseModel.fromJSONObject(
              (rawIncidents[0] as JSONObject) || {},
              Incident,
            );

            if (incident && incident.id) {
              foundIncident = true;
              setIsEpisode(false);

              const statusPageResources: Array<StatusPageResource> =
                BaseModel.fromJSONArray(
                  (data["statusPageResources"] as JSONArray) || [],
                  StatusPageResource,
                );

              const incidentStateTimelines: Array<IncidentStateTimeline> =
                BaseModel.fromJSONArray(
                  (data["incidentStateTimelines"] as JSONArray) || [],
                  IncidentStateTimeline,
                );

              const monitorsInGroup: Dictionary<Array<ObjectID>> =
                JSONFunctions.deserialize(
                  (data["monitorsInGroup"] as JSONObject) || {},
                ) as Dictionary<Array<ObjectID>>;

              setMonitorsInGroup(monitorsInGroup);
              setIncidentPublicNotes(incidentPublicNotes);
              setIncident(incident);
              setStatusPageResources(statusPageResources);
              setIncidentStateTimelines(incidentStateTimelines);
            }
          }
        }
      } catch {
        // Incident not found, will try episode
      }

      // If not found as incident, try as episode
      if (!foundIncident) {
        try {
          const response: HTTPResponse<JSONObject> = await API.post<JSONObject>(
            {
              url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
                `/episodes/${id.toString()}/${itemId?.toString()}`,
              ),
              data: {},
              headers: API.getDefaultHeaders(),
            },
          );

          if (response.isSuccess()) {
            const data: JSONObject = response.data;

            const rawEpisodes: JSONArray =
              (data["episodes"] as JSONArray) || [];

            if (rawEpisodes.length > 0) {
              const episode: IncidentEpisode = BaseModel.fromJSONObject(
                (rawEpisodes[0] as JSONObject) || {},
                IncidentEpisode,
              );

              if (episode && episode.id) {
                setIsEpisode(true);

                const episodePublicNotes: Array<IncidentEpisodePublicNote> =
                  BaseModel.fromJSONArray(
                    (data["episodePublicNotes"] as JSONArray) || [],
                    IncidentEpisodePublicNote,
                  );

                const statusPageResources: Array<StatusPageResource> =
                  BaseModel.fromJSONArray(
                    (data["statusPageResources"] as JSONArray) || [],
                    StatusPageResource,
                  );

                const episodeStateTimelines: Array<IncidentEpisodeStateTimeline> =
                  BaseModel.fromJSONArray(
                    (data["episodeStateTimelines"] as JSONArray) || [],
                    IncidentEpisodeStateTimeline,
                  );

                const monitorsInGroup: Dictionary<Array<ObjectID>> =
                  JSONFunctions.deserialize(
                    (data["monitorsInGroup"] as JSONObject) || {},
                  ) as Dictionary<Array<ObjectID>>;

                setMonitorsInGroup(monitorsInGroup);
                setEpisodePublicNotes(episodePublicNotes);
                setEpisode(episode);
                setStatusPageResources(statusPageResources);
                setEpisodeStateTimelines(episodeStateTimelines);
              }
            }
          }
        } catch {
          // Episode not found either
        }
      }

      setIsLoading(false);
      props.onLoadComplete();
    } catch (err) {
      if (err instanceof HTTPErrorResponse) {
        await StatusPageUtil.checkIfTheUserIsAuthenticated(err);
      }
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoading) {
      // parse data;
      setParsedData(null);
      return;
    }

    if (isEpisode && episode) {
      setParsedData(
        getEpisodeEventItem({
          episode,
          episodePublicNotes,
          episodeStateTimelines,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: StatusPageUtil.isPreviewPage(),
          isSummary: false,
          statusPageId: StatusPageUtil.getStatusPageId() || undefined,
        }),
      );
    } else if (!isEpisode && incident) {
      setParsedData(
        getIncidentEventItem({
          incident,
          incidentPublicNotes,
          incidentStateTimelines,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: StatusPageUtil.isPreviewPage(),
          isSummary: false,
        }),
      );
    }
  }, [isLoading, incident, episode, isEpisode]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!parsedData) {
    return <PageLoader isVisible={true} />;
  }

  const pageTitle: string = isEpisode ? "Episode Report" : "Incident Report";
  const hasItem: boolean = isEpisode ? Boolean(episode) : Boolean(incident);

  return (
    <Page
      title={pageTitle}
      breadcrumbLinks={[
        {
          title: "Overview",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
              : (RouteMap[PageMap.OVERVIEW] as Route),
          ),
        },
        {
          title: "Incidents",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route)
              : (RouteMap[PageMap.INCIDENT_LIST] as Route),
          ),
        },
        {
          title: pageTitle,
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
              : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
            Navigation.getLastParamAsObjectID(),
          ),
        },
      ]}
    >
      {hasItem ? <EventItem {...parsedData} /> : <></>}
      {!hasItem ? (
        <EmptyState
          id="item-empty-state"
          title={isEpisode ? "No Episode" : "No Incident"}
          description={
            isEpisode
              ? "Episode not found on this status page."
              : "Incident not found on this status page."
          }
          icon={isEpisode ? IconProp.Layers : IconProp.Alert}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Detail;
