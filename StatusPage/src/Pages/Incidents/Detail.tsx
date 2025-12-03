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
      return i.displayName || "";
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

const Detail: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  StatusPageUtil.checkIfUserHasLoggedIn();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);
  const [incidentPublicNotes, setIncidentPublicNotes] = useState<
    Array<IncidentPublicNote>
  >([]);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [incidentStateTimelines, setIncidentStateTimelines] = useState<
    Array<IncidentStateTimeline>
  >([]);
  const [parsedData, setParsedData] = useState<EventItemComponentProps | null>(
    null,
  );

  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});

  useAsyncEffect(async () => {
    try {
      if (!StatusPageUtil.getStatusPageId()) {
        return;
      }
      setIsLoading(true);

      const id: ObjectID = LocalStorage.getItem("statusPageId") as ObjectID;

      const incidentId: string | undefined =
        Navigation.getLastParamAsObjectID().toString();

      if (!id) {
        throw new BadDataException("Status Page ID is required");
      }
      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
          `/incidents/${id.toString()}/${incidentId?.toString()}`,
        ),
        data: {},
        headers: API.getDefaultHeaders(),
      });

      if (!response.isSuccess()) {
        throw response;
      }
      const data: JSONObject = response.data;

      const incidentPublicNotes: Array<IncidentPublicNote> =
        BaseModel.fromJSONArray(
          (data["incidentPublicNotes"] as JSONArray) || [],
          IncidentPublicNote,
        );

      const rawIncidents: JSONArray = (data["incidents"] as JSONArray) || [];
      const incident: Incident = BaseModel.fromJSONObject(
        (rawIncidents[0] as JSONObject) || {},
        Incident,
      );
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

      // save data. set()
      setIncidentPublicNotes(incidentPublicNotes);
      setIncident(incident);
      setStatusPageResources(statusPageResources);
      setIncidentStateTimelines(incidentStateTimelines);

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

    if (!incident) {
      return;
    }

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
  }, [isLoading, incident]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!parsedData) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Page
      title="Incident Report"
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
          title: "Incident Report",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
              : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
            Navigation.getLastParamAsObjectID(),
          ),
        },
      ]}
    >
      {incident ? <EventItem {...parsedData} /> : <></>}
      {!incident ? (
        <EmptyState
          id="incident-empty-state"
          title={"No Incident"}
          description={"Incident not found on this status page."}
          icon={IconProp.Alert}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Detail;
