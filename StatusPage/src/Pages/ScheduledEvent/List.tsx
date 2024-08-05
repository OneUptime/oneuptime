import Page from "../../Components/Page/Page";
import Section from "../../Components/Section/Section";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import PageComponentProps from "../PageComponentProps";
import { getScheduledEventEventItem } from "./Detail";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import EmptyState from "CommonUI/src/Components/EmptyState/EmptyState";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import { ComponentProps as EventHistoryDayListComponentProps } from "CommonUI/src/Components/EventHistoryList/EventHistoryDayList";
import EventHistoryList, {
  ComponentProps as EventHistoryListComponentProps,
} from "CommonUI/src/Components/EventHistoryList/EventHistoryList";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import LocalStorage from "CommonUI/src/Utils/LocalStorage";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

const Overview: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [
    scheduledMaintenanceEventsPublicNotes,
    setscheduledMaintenanceEventsPublicNotes,
  ] = useState<Array<ScheduledMaintenancePublicNote>>([]);
  const [scheduledMaintenanceEvents, setscheduledMaintenanceEvents] = useState<
    Array<ScheduledMaintenance>
  >([]);
  const [
    scheduledMaintenanceStateTimelines,
    setscheduledMaintenanceStateTimelines,
  ] = useState<Array<ScheduledMaintenanceStateTimeline>>([]);

  const [ongoingEventsParsedData, setOngoingEventsParsedData] =
    useState<EventHistoryListComponentProps | null>(null);
  const [scheduledEventsParsedData, setScheduledEventsParsedData] =
    useState<EventHistoryListComponentProps | null>(null);
  const [endedEventsParsedData, setEndedEventsParsedData] =
    useState<EventHistoryListComponentProps | null>(null);

  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);

  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});

  const [scheduledMaintenanceStates, setScheduledMaintenanceStates] = useState<
    Array<ScheduledMaintenanceState>
  >([]);

  StatusPageUtil.checkIfUserHasLoggedIn();

  type GetEventHistoryFunctionProps = {
    scheduledMaintenanceEvents: ScheduledMaintenance[];
    scheduledMaintenanceEventsPublicNotes: ScheduledMaintenancePublicNote[];
    scheduledMaintenanceStateTimelines: ScheduledMaintenanceStateTimeline[];
    statusPageResources: StatusPageResource[];
    monitorsInGroup: Dictionary<ObjectID[]>;
  };

  type GetEventHistoryFunction = (
    data: GetEventHistoryFunctionProps,
  ) => EventHistoryListComponentProps;

  const getEventHistoryListComponentProps: GetEventHistoryFunction = (
    data: GetEventHistoryFunctionProps,
  ): EventHistoryListComponentProps => {
    const {
      scheduledMaintenanceEvents,
      scheduledMaintenanceEventsPublicNotes,
      scheduledMaintenanceStateTimelines,
      statusPageResources,
      monitorsInGroup,
    } = data;

    const eventHistoryListComponentProps: EventHistoryListComponentProps = {
      items: [],
    };

    const days: Dictionary<EventHistoryDayListComponentProps> = {};

    for (const scheduledMaintenance of scheduledMaintenanceEvents) {
      const dayString: string = OneUptimeDate.getDateString(
        scheduledMaintenance.startsAt!,
      );

      if (!days[dayString]) {
        days[dayString] = {
          date: scheduledMaintenance.startsAt!,
          items: [],
        };
      }

      days[dayString]?.items.push(
        getScheduledEventEventItem({
          scheduledMaintenance: scheduledMaintenance,
          scheduledMaintenanceEventsPublicNotes,
          scheduledMaintenanceStateTimelines,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: Boolean(StatusPageUtil.isPreviewPage()),
          isSummary: true,
        }),
      );
    }

    for (const key in days) {
      eventHistoryListComponentProps.items.push(
        days[key] as EventHistoryDayListComponentProps,
      );
    }
    return eventHistoryListComponentProps;
  };

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
      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>(
        URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
          `/scheduled-maintenance-events/${id.toString()}`,
        ),
        {},
        API.getDefaultHeaders(StatusPageUtil.getStatusPageId()!),
      );

      if (!response.isSuccess()) {
        throw response;
      }
      const data: JSONObject = response.data;

      const scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceEventsPublicNotes"] as JSONArray) || [],
          ScheduledMaintenancePublicNote,
        );
      const scheduledMaintenanceEvents: Array<ScheduledMaintenance> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceEvents"] as JSONArray) || [],
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

      const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceStates"] as JSONArray) || [],
          ScheduledMaintenanceState,
        );

      setScheduledMaintenanceStates(scheduledMaintenanceStates);
      setStatusPageResources(statusPageResources);
      setMonitorsInGroup(monitorsInGroup);

      // save data. set()
      setscheduledMaintenanceEventsPublicNotes(
        scheduledMaintenanceEventsPublicNotes,
      );
      setscheduledMaintenanceEvents(scheduledMaintenanceEvents);
      setscheduledMaintenanceStateTimelines(scheduledMaintenanceStateTimelines);

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
      setOngoingEventsParsedData(null);
      setScheduledEventsParsedData(null);
      setEndedEventsParsedData(null);
      return;
    }

    const ongoingOrder: number =
      scheduledMaintenanceStates.find((state: ScheduledMaintenanceState) => {
        return state.isOngoingState;
      })?.order || 0;

    const endedEventOrder: number =
      scheduledMaintenanceStates.find((state: ScheduledMaintenanceState) => {
        return state.isEndedState;
      })?.order || 0;

    // get ongoing events - anything after ongoing state but before ended state

    const ongoingEvents: ScheduledMaintenance[] =
      scheduledMaintenanceEvents.filter((event: ScheduledMaintenance) => {
        return (
          event.currentScheduledMaintenanceState!.order! >= ongoingOrder &&
          event.currentScheduledMaintenanceState!.order! < endedEventOrder
        );
      });

    // get scheduled events - anything before ongoing state

    const scheduledEvents: ScheduledMaintenance[] =
      scheduledMaintenanceEvents.filter((event: ScheduledMaintenance) => {
        return event.currentScheduledMaintenanceState!.order! < ongoingOrder;
      });

    // get ended events - anythign equalTo or after ended state

    const endedEvents: ScheduledMaintenance[] =
      scheduledMaintenanceEvents.filter((event: ScheduledMaintenance) => {
        return (
          event.currentScheduledMaintenanceState!.order! >= endedEventOrder
        );
      });

    const endedEventProps: EventHistoryListComponentProps =
      getEventHistoryListComponentProps({
        scheduledMaintenanceEvents: endedEvents,
        scheduledMaintenanceEventsPublicNotes,
        scheduledMaintenanceStateTimelines,
        statusPageResources,
        monitorsInGroup,
      });
    const scheduledEventProps: EventHistoryListComponentProps =
      getEventHistoryListComponentProps({
        scheduledMaintenanceEvents: scheduledEvents,
        scheduledMaintenanceEventsPublicNotes,
        scheduledMaintenanceStateTimelines,
        statusPageResources,
        monitorsInGroup,
      });
    const ongoingEventProps: EventHistoryListComponentProps =
      getEventHistoryListComponentProps({
        scheduledMaintenanceEvents: ongoingEvents,
        scheduledMaintenanceEventsPublicNotes,
        scheduledMaintenanceStateTimelines,
        statusPageResources,
        monitorsInGroup,
      });

    setOngoingEventsParsedData(ongoingEventProps);
    setScheduledEventsParsedData(scheduledEventProps);
    setEndedEventsParsedData(endedEventProps);
  }, [isLoading]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  return (
    <Page
      title="Scheduled Events"
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
      ]}
    >
      {ongoingEventsParsedData?.items &&
      ongoingEventsParsedData?.items.length > 0 ? (
        <div>
          <Section title="Ongoing Events" />

          <EventHistoryList items={ongoingEventsParsedData?.items || []} />
        </div>
      ) : (
        <></>
      )}

      {scheduledEventsParsedData?.items &&
      scheduledEventsParsedData?.items.length > 0 ? (
        <div>
          <Section title="Scheduled Events" />

          <EventHistoryList items={scheduledEventsParsedData?.items || []} />
        </div>
      ) : (
        <></>
      )}

      {endedEventsParsedData?.items &&
      endedEventsParsedData?.items.length > 0 ? (
        <div>
          <Section title="Completed Events" />

          <EventHistoryList items={endedEventsParsedData?.items || []} />
        </div>
      ) : (
        <></>
      )}

      {scheduledMaintenanceEvents.length === 0 ? (
        <EmptyState
          id="scheduled-events-empty-state"
          title={"No Scheduled Events"}
          description={"No scheduled events posted for this status page."}
          icon={IconProp.Clock}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Overview;
