import Page from "../../Components/Page/Page";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import PageComponentProps from "../PageComponentProps";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Blue500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EventItem, {
  ComponentProps as EventItemComponentProps,
  TimelineAttachment,
} from "Common/UI/Components/EventItem/EventItem";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import FileModel from "Common/Models/DatabaseModels/File";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

type GetAnnouncementEventItemFunctionProps = {
  announcement: StatusPageAnnouncement;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
  isPreviewPage: boolean;
  isSummary: boolean;
  statusPageId?: ObjectID | null;
};

type GetAnnouncementEventItemFunction = (
  data: GetAnnouncementEventItemFunctionProps,
) => EventItemComponentProps;

export const getAnnouncementEventItem: GetAnnouncementEventItemFunction = (
  data: GetAnnouncementEventItemFunctionProps,
): EventItemComponentProps => {
  const {
    announcement,
    statusPageResources,
    monitorsInGroup,
    isPreviewPage,
    isSummary,
    statusPageId,
  } = data;

  // Get affected resources based on monitors in the announcement
  const monitorIdsInThisAnnouncement: Array<string | undefined> =
    announcement.monitors?.map((monitor: Monitor) => {
      return monitor._id;
    }) || [];

  let namesOfResources: Array<StatusPageResource> = statusPageResources.filter(
    (resource: StatusPageResource) => {
      return monitorIdsInThisAnnouncement.includes(
        resource.monitorId?.toString(),
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
        monitorsInGroup[monitorGroupId]! || [];

      for (const monitorId of monitorIdsInThisGroup) {
        if (
          monitorIdsInThisAnnouncement.find((id: string | undefined) => {
            return id?.toString() === monitorId.toString();
          })
        ) {
          return true;
        }
      }

      return false;
    }),
  );

  const statusPageIdString: string | null = statusPageId
    ? statusPageId.toString()
    : null;
  const announcementIdString: string | null = announcement.id
    ? announcement.id.toString()
    : announcement._id
      ? announcement._id.toString()
      : null;

  const attachments: Array<TimelineAttachment> =
    statusPageIdString && announcementIdString
      ? (announcement.attachments || [])
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
              `/status-page-announcement/attachment/${statusPageIdString}/${announcementIdString}/${attachmentId}`,
            );

            return {
              name: attachment.name || "Attachment",
              downloadUrl: downloadRoute.toString(),
            };
          })
          .filter(
            (item: TimelineAttachment | null): item is TimelineAttachment => {
              return Boolean(item);
            },
          )
      : [];

  return {
    eventTitle: announcement.title || "",
    eventDescription: announcement.description,
    eventResourcesAffected: namesOfResources.map((i: StatusPageResource) => {
      const groupName: string = i.statusPageGroup?.name || "";
      const displayName: string = i.displayName || "";
      return groupName ? `${groupName}: ${displayName}` : displayName;
    }),
    eventTimeline: [],
    eventType: "Announcement",
    eventViewRoute: !isSummary
      ? undefined
      : RouteUtil.populateRouteParams(
          isPreviewPage
            ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_DETAIL] as Route)
            : (RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route),
          announcement.id!,
        ),
    isDetailItem: !isSummary,
    eventTypeColor: Blue500,
    eventSecondDescription: announcement.showAnnouncementAt!
      ? "Announced at " +
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          announcement.showAnnouncementAt!,
        )
      : "",
    ...(attachments.length > 0
      ? {
          eventAttachments: attachments,
        }
      : {}),
  };
};

const Overview: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] =
    useState<StatusPageAnnouncement | null>(null);
  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);
  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});
  const [parsedData, setParsedData] = useState<EventItemComponentProps | null>(
    null,
  );
  const [statusPageId, setStatusPageId] = useState<ObjectID | null>(null);

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

      setStatusPageId(id);

      const announcementId: string | undefined =
        Navigation.getLastParamAsObjectID().toString();

      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
          `/announcements/${id.toString()}/${announcementId}`,
        ),
        data: {},
        headers: API.getDefaultHeaders(),
      });

      if (!response.isSuccess()) {
        throw response;
      }
      const data: JSONObject = response.data;

      const rawAnnouncements: JSONArray =
        (data["announcements"] as JSONArray) || [];

      const announcement: StatusPageAnnouncement = BaseModel.fromJSONObject(
        (rawAnnouncements[0] as JSONObject) || {},
        StatusPageAnnouncement,
      );

      const statusPageResources: Array<StatusPageResource> =
        BaseModel.fromJSONArray(
          (data["statusPageResources"] as JSONArray) || [],
          StatusPageResource,
        );

      const monitorsInGroup: Dictionary<Array<ObjectID>> = data[
        "monitorsInGroup"
      ] as Dictionary<Array<ObjectID>>;

      // save data. set()
      setAnnouncement(announcement);
      setStatusPageResources(statusPageResources);
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

    if (!announcement) {
      return;
    }

    setParsedData(
      getAnnouncementEventItem({
        announcement,
        statusPageResources,
        monitorsInGroup,
        isPreviewPage: Boolean(StatusPageUtil.isPreviewPage()),
        isSummary: false,
        statusPageId,
      }),
    );
  }, [isLoading, statusPageId]);

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
      title="Announcement"
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
          title: "Announcements",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST] as Route)
              : (RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route),
          ),
        },
        {
          title: "Announcement",
          to: RouteUtil.populateRouteParams(
            StatusPageUtil.isPreviewPage()
              ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_DETAIL] as Route)
              : (RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route),
            Navigation.getLastParamAsObjectID(),
          ),
        },
      ]}
    >
      {announcement ? <EventItem {...parsedData} /> : <></>}
      {!announcement ? (
        <EmptyState
          id="announcement-empty-state"
          title={"No Announcement"}
          description={"Announcement not found on this status page."}
          icon={IconProp.Announcement}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Overview;
