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
import { Gray500, Green, Yellow } from "Common/Types/BrandColors";
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
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import FileModel from "Common/Models/DatabaseModels/File";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

export type GetScheduledEventEventItemFunctionProps = {
  scheduledMaintenance: ScheduledMaintenance;
  scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote>;
  scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
  isPreviewPage: boolean;
  isSummary: boolean;
};

export type GetScheduledEventEventItemFunction = (
  props: GetScheduledEventEventItemFunctionProps,
) => EventItemComponentProps;

export const getScheduledEventEventItem: GetScheduledEventEventItemFunction = (
  props: GetScheduledEventEventItemFunctionProps,
): EventItemComponentProps => {
  const {
    scheduledMaintenance,
    scheduledMaintenanceEventsPublicNotes,
    scheduledMaintenanceStateTimelines,
    statusPageResources,
    monitorsInGroup,
    isPreviewPage,
    isSummary,
  } = props;
  /// get timeline.

  let currentStateStatus: string = "";
  let currentStatusColor: Color = Green;

  const timeline: Array<TimelineItem> = [];

  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();
  const statusPageIdString: string | null = statusPageId
    ? statusPageId.toString()
    : null;
  const scheduledMaintenanceIdString: string | null = scheduledMaintenance.id
    ? scheduledMaintenance.id.toString()
    : scheduledMaintenance._id
      ? scheduledMaintenance._id.toString()
      : null;

  if (isSummary) {
    // If this is summary then reverse the order so we show the latest first
    scheduledMaintenanceEventsPublicNotes.sort(
      (
        a: ScheduledMaintenancePublicNote,
        b: ScheduledMaintenancePublicNote,
      ) => {
        return OneUptimeDate.isAfter(a.postedAt!, b.postedAt!) === false
          ? 1
          : -1;
      },
    );

    scheduledMaintenanceStateTimelines.sort(
      (
        a: ScheduledMaintenanceStateTimeline,
        b: ScheduledMaintenanceStateTimeline,
      ) => {
        const aDate: Date = a.startsAt || a.createdAt!;
        const bDate: Date = b.startsAt || b.createdAt!;
        return OneUptimeDate.isAfter(aDate, bDate) === false ? 1 : -1;
      },
    );
  }

  for (const scheduledMaintenancePublicNote of scheduledMaintenanceEventsPublicNotes) {
    if (
      scheduledMaintenancePublicNote.scheduledMaintenanceId?.toString() ===
        scheduledMaintenance.id?.toString() &&
      scheduledMaintenancePublicNote?.note
    ) {
      const noteIdString: string | null = scheduledMaintenancePublicNote.id
        ? scheduledMaintenancePublicNote.id.toString()
        : scheduledMaintenancePublicNote._id
          ? scheduledMaintenancePublicNote._id.toString()
          : null;

      const attachments: Array<TimelineAttachment> =
        statusPageIdString && scheduledMaintenanceIdString && noteIdString
          ? (scheduledMaintenancePublicNote.attachments || [])
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
                  `/scheduled-maintenance-public-note/attachment/${statusPageIdString}/${scheduledMaintenanceIdString}/${noteIdString}/${attachmentId}`,
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
        note: scheduledMaintenancePublicNote?.note || "",
        date: scheduledMaintenancePublicNote?.postedAt as Date,
        type: TimelineItemType.Note,
        icon: IconProp.Chat,
        iconColor: Gray500,
        ...(attachments.length > 0
          ? {
              attachments,
            }
          : {}),
      });

      if (isSummary) {
        break;
      }
    }
  }

  for (const scheduledMaintenanceEventstateTimeline of scheduledMaintenanceStateTimelines) {
    if (
      scheduledMaintenanceEventstateTimeline.scheduledMaintenanceId?.toString() ===
        scheduledMaintenance.id?.toString() &&
      scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
    ) {
      timeline.push({
        state: scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState,
        date: scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
          ?.isScheduledState
          ? scheduledMaintenance.startsAt!
          : scheduledMaintenanceEventstateTimeline?.startsAt ||
            (scheduledMaintenanceEventstateTimeline?.createdAt as Date),
        type: TimelineItemType.StateChange,
        icon: scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
          .isScheduledState
          ? IconProp.Clock
          : scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
                .isOngoingState
            ? IconProp.Settings
            : scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
                  .isResolvedState
              ? IconProp.CheckCircle
              : IconProp.ArrowCircleRight,
        iconColor:
          scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
            .color || Gray500,
      });

      if (!currentStateStatus) {
        currentStateStatus =
          scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
            ?.name || "";
        currentStatusColor =
          scheduledMaintenanceEventstateTimeline.scheduledMaintenanceState
            ?.color || Green;
      }

      if (isSummary) {
        break;
      }
    }
  }

  timeline.sort((a: TimelineItem, b: TimelineItem) => {
    return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
  });

  let namesOfResources: Array<StatusPageResource> = [];

  if (scheduledMaintenance.monitors) {
    const monitorIdsInThisScheduledMaintenance: Array<string> =
      scheduledMaintenance.monitors
        .map((monitor: Monitor) => {
          return monitor.id!.toString();
        })
        .filter((id: string) => {
          return Boolean(id);
        });

    namesOfResources = statusPageResources.filter(
      (resource: StatusPageResource) => {
        return (
          resource.monitorId &&
          monitorIdsInThisScheduledMaintenance.includes(
            resource.monitorId.toString(),
          )
        );
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
          monitorsInGroup[monitorGroupId]!;

        for (const monitorId of monitorIdsInThisGroup) {
          if (
            monitorIdsInThisScheduledMaintenance.find(
              (id: string | undefined) => {
                return id?.toString() === monitorId.toString();
              },
            )
          ) {
            return true;
          }
        }

        return false;
      }),
    );
  }

  return {
    eventTitle: scheduledMaintenance.title || "",
    eventDescription: scheduledMaintenance.description,
    eventTimeline: timeline,
    eventType: "Scheduled Maintenance",
    eventResourcesAffected: namesOfResources.map((i: StatusPageResource) => {
      const groupName: string = i.statusPageGroup?.name || "";
      const displayName: string = i.displayName || "";
      return groupName ? `${groupName}: ${displayName}` : displayName;
    }),
    eventViewRoute: !isSummary
      ? undefined
      : RouteUtil.populateRouteParams(
          isPreviewPage
            ? (RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL] as Route)
            : (RouteMap[PageMap.SCHEDULED_EVENT_DETAIL] as Route),
          scheduledMaintenance.id!,
        ),
    isDetailItem: !isSummary,
    currentStatus: currentStateStatus,
    currentStatusColor: currentStatusColor,
    eventTypeColor: Yellow,
    eventSecondDescription: scheduledMaintenance.startsAt
      ? "Scheduled at " +
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          scheduledMaintenance.startsAt!,
        )
      : "",
    labels:
      scheduledMaintenance.labels?.map((label: Label) => {
        return {
          name: label.name!,
          color: label.color!,
        };
      }) || [],
  };
};

const Overview: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [
    scheduledMaintenanceEventsPublicNotes,
    setscheduledMaintenanceEventsPublicNotes,
  ] = useState<Array<ScheduledMaintenancePublicNote>>([]);
  const [scheduledMaintenanceEvent, setscheduledMaintenanceEvent] =
    useState<ScheduledMaintenance | null>(null);
  const [
    scheduledMaintenanceStateTimelines,
    setscheduledMaintenanceStateTimelines,
  ] = useState<Array<ScheduledMaintenanceStateTimeline>>([]);
  const [parsedData, setParsedData] = useState<EventItemComponentProps | null>(
    null,
  );

  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});

  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);

  StatusPageUtil.checkIfUserHasLoggedIn();

  useAsyncEffect(async () => {
    try {
      if (!StatusPageUtil.getStatusPageId()) {
        return;
      }
      setIsLoading(true);

      const id: ObjectID = LocalStorage.getItem("statusPageId") as ObjectID;
      if (!id) {
        throw new BadDataException("Status Page ID is required");
      }

      const eventId: string | undefined =
        Navigation.getLastParamAsObjectID().toString();

      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
          `/scheduled-maintenance-events/${id.toString()}/${eventId}`,
        ),
        data: {},
        headers: API.getDefaultHeaders(),
      });

      if (!response.isSuccess()) {
        throw response;
      }
      const data: JSONObject = response.data;

      const scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceEventsPublicNotes"] as JSONArray) || [],
          ScheduledMaintenancePublicNote,
        );

      const rawAnnouncements: JSONArray =
        (data["scheduledMaintenanceEvents"] as JSONArray) || [];

      const scheduledMaintenanceEvent: ScheduledMaintenance =
        BaseModel.fromJSONObject(
          (rawAnnouncements[0] as JSONObject) || {},
          ScheduledMaintenance,
        );
      const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceStateTimelines"] as JSONArray) || [],
          ScheduledMaintenanceStateTimeline,
        );

      const statusPageResources: Array<StatusPageResource> =
        BaseModel.fromJSONArray(
          (data["statusPageResources"] as JSONArray) || [],
          StatusPageResource,
        );

      const monitorsInGroup: Dictionary<Array<ObjectID>> =
        JSONFunctions.deserialize(
          (data["monitorsInGroup"] as JSONObject) || {},
        ) as Dictionary<Array<ObjectID>>;

      // save data. set()
      setscheduledMaintenanceEventsPublicNotes(
        scheduledMaintenanceEventsPublicNotes,
      );
      setscheduledMaintenanceEvent(scheduledMaintenanceEvent);
      setStatusPageResources(statusPageResources);

      setscheduledMaintenanceStateTimelines(scheduledMaintenanceStateTimelines);

      setMonitorsInGroup(monitorsInGroup);

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

    if (!scheduledMaintenanceEvent) {
      return;
    }
    setParsedData(
      getScheduledEventEventItem({
        scheduledMaintenance: scheduledMaintenanceEvent,
        scheduledMaintenanceEventsPublicNotes,
        scheduledMaintenanceStateTimelines,
        statusPageResources,
        monitorsInGroup,
        isPreviewPage: Boolean(StatusPageUtil.isPreviewPage()),
        isSummary: false,
      }),
    );
  }, [isLoading]);

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
      title="Scheduled Event Report"
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
          title: "Scheduled Events",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_LIST] as Route)
              : (RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route),
          ),
        },
        {
          title: "Scheduled Event",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL] as Route)
              : (RouteMap[PageMap.SCHEDULED_EVENT_DETAIL] as Route),
            Navigation.getLastParamAsObjectID(),
          ),
        },
      ]}
    >
      {scheduledMaintenanceEvent ? <EventItem {...parsedData} /> : <></>}
      {!scheduledMaintenanceEvent ? (
        <EmptyState
          id="scheduled-event-empty-state"
          title={"No Scheduled Event"}
          description={"No scheduled event found for this status page."}
          icon={IconProp.Clock}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Overview;
