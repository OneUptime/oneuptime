import Page from "../../Components/Page/Page";
import Section from "../../Components/Section/Section";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import PageComponentProps from "../PageComponentProps";
import { getIncidentEventItem, getEpisodeEventItem } from "./Detail";
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
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ComponentProps as EventHistoryDayListComponentProps } from "Common/UI/Components/EventHistoryList/EventHistoryDayList";
import EventHistoryList, {
  ComponentProps as EventHistoryListComponentProps,
} from "Common/UI/Components/EventHistoryList/EventHistoryList";
import { ComponentProps as EventItemComponentProps } from "Common/UI/Components/EventItem/EventItem";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

// Event item with date for sorting
interface EventWithDate {
  date: Date;
  eventItem: EventItemComponentProps;
  isResolved: boolean;
}

const Overview: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);
  const [incidentPublicNotes, setIncidentPublicNotes] = useState<
    Array<IncidentPublicNote>
  >([]);
  const [incidents, setIncidents] = useState<Array<Incident>>([]);
  const [incidentStateTimelines, setIncidentStateTimelines] = useState<
    Array<IncidentStateTimeline>
  >([]);

  // Episode state
  const [episodes, setEpisodes] = useState<Array<IncidentEpisode>>([]);
  const [episodePublicNotes, setEpisodePublicNotes] = useState<
    Array<IncidentEpisodePublicNote>
  >([]);
  const [episodeStateTimelines, setEpisodeStateTimelines] = useState<
    Array<IncidentEpisodeStateTimeline>
  >([]);

  const [parsedActiveEventsData, setParsedActiveEventsData] =
    useState<EventHistoryListComponentProps | null>(null);

  const [parsedResolvedEventsData, setParsedResolvedEventsData] =
    useState<EventHistoryListComponentProps | null>(null);

  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});

  const [incidentStates, setIncidentStates] = useState<Array<IncidentState>>(
    [],
  );

  const [hasEvents, setHasEvents] = useState<boolean>(false);

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

      // Fetch incidents
      const incidentsResponse: HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
            `/incidents/${id.toString()}`,
          ),
          data: {},
          headers: API.getDefaultHeaders(),
        });

      // Fetch episodes (may fail if episodes are not enabled)
      let episodesData: JSONObject = {
        episodes: [],
        episodePublicNotes: [],
        episodeStateTimelines: [],
        incidentStates: [],
        statusPageResources: [],
        monitorsInGroup: {},
      };

      try {
        const episodesResponse: HTTPResponse<JSONObject> =
          await API.post<JSONObject>({
            url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
              `/episodes/${id.toString()}`,
            ),
            data: {},
            headers: API.getDefaultHeaders(),
          });

        if (episodesResponse.isSuccess()) {
          episodesData = episodesResponse.data;
        }
      } catch {
        // Episodes endpoint might not be enabled, use empty data
      }

      if (!incidentsResponse.isSuccess()) {
        throw incidentsResponse;
      }

      const incidentsData: JSONObject = incidentsResponse.data;

      // Parse incidents data
      const incidentPublicNotes: Array<IncidentPublicNote> =
        BaseModel.fromJSONArray(
          (incidentsData["incidentPublicNotes"] as JSONArray) || [],
          IncidentPublicNote,
        );
      const incidents: Array<Incident> = BaseModel.fromJSONArray(
        (incidentsData["incidents"] as JSONArray) || [],
        Incident,
      );
      const statusPageResources: Array<StatusPageResource> =
        BaseModel.fromJSONArray(
          (incidentsData["statusPageResources"] as JSONArray) || [],
          StatusPageResource,
        );
      const incidentStateTimelines: Array<IncidentStateTimeline> =
        BaseModel.fromJSONArray(
          (incidentsData["incidentStateTimelines"] as JSONArray) || [],
          IncidentStateTimeline,
        );

      const monitorsInGroup: Dictionary<Array<ObjectID>> =
        JSONFunctions.deserialize(
          (incidentsData["monitorsInGroup"] as JSONObject) || {},
        ) as Dictionary<Array<ObjectID>>;

      const incidentStates: Array<IncidentState> = BaseModel.fromJSONArray(
        (incidentsData["incidentStates"] as JSONArray) || [],
        IncidentState,
      );

      // Parse episodes data
      const episodes: Array<IncidentEpisode> = BaseModel.fromJSONArray(
        (episodesData["episodes"] as JSONArray) || [],
        IncidentEpisode,
      );
      const episodePublicNotes: Array<IncidentEpisodePublicNote> =
        BaseModel.fromJSONArray(
          (episodesData["episodePublicNotes"] as JSONArray) || [],
          IncidentEpisodePublicNote,
        );
      const episodeStateTimelines: Array<IncidentEpisodeStateTimeline> =
        BaseModel.fromJSONArray(
          (episodesData["episodeStateTimelines"] as JSONArray) || [],
          IncidentEpisodeStateTimeline,
        );

      setMonitorsInGroup(monitorsInGroup);
      setIncidentStates(incidentStates);

      // save incident data
      setIncidentPublicNotes(incidentPublicNotes);
      setIncidents(incidents);
      setStatusPageResources(statusPageResources);
      setIncidentStateTimelines(incidentStateTimelines);

      // save episode data
      setEpisodes(episodes);
      setEpisodePublicNotes(episodePublicNotes);
      setEpisodeStateTimelines(episodeStateTimelines);

      setHasEvents(incidents.length > 0 || episodes.length > 0);

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

  type GetEventHistoryListComponentProps = (
    events: Array<EventWithDate>,
  ) => EventHistoryListComponentProps;

  const getEventHistoryListComponentProps: GetEventHistoryListComponentProps = (
    events: Array<EventWithDate>,
  ): EventHistoryListComponentProps => {
    const eventHistoryListComponentProps: EventHistoryListComponentProps = {
      items: [],
    };

    const days: Dictionary<EventHistoryDayListComponentProps> = {};

    for (const event of events) {
      const dayString: string = OneUptimeDate.getDateString(event.date);

      if (!days[dayString]) {
        days[dayString] = {
          date: event.date,
          items: [],
        };
      }

      days[dayString]?.items.push(event.eventItem);
    }

    for (const key in days) {
      eventHistoryListComponentProps.items.push(
        days[key] as EventHistoryDayListComponentProps,
      );
    }

    return eventHistoryListComponentProps;
  };

  useEffect(() => {
    if (isLoading) {
      // parse data;
      setParsedActiveEventsData(null);
      setParsedResolvedEventsData(null);
      return;
    }

    const resolvedIncidentStateOrder: number =
      incidentStates.find((state: IncidentState) => {
        return state.isResolvedState;
      })?.order || 0;

    // Build combined events list with incidents and episodes
    const allEvents: Array<EventWithDate> = [];

    // Add incidents
    for (const incident of incidents) {
      const incidentDate: Date =
        incident.declaredAt ||
        (incident.createdAt as Date | undefined) ||
        OneUptimeDate.getCurrentDate();

      const isResolved: boolean =
        (incident.currentIncidentState?.order || 0) >=
        resolvedIncidentStateOrder;

      allEvents.push({
        date: incidentDate,
        eventItem: getIncidentEventItem({
          incident,
          incidentPublicNotes,
          incidentStateTimelines,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: StatusPageUtil.isPreviewPage(),
          isSummary: true,
        }),
        isResolved,
      });
    }

    // Add episodes
    for (const episode of episodes) {
      const episodeDate: Date =
        episode.declaredAt ||
        (episode.createdAt as Date | undefined) ||
        OneUptimeDate.getCurrentDate();

      const isResolved: boolean =
        (episode.currentIncidentState?.order || 0) >=
        resolvedIncidentStateOrder;

      allEvents.push({
        date: episodeDate,
        eventItem: getEpisodeEventItem({
          episode,
          episodePublicNotes,
          episodeStateTimelines,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: StatusPageUtil.isPreviewPage(),
          isSummary: true,
          statusPageId: StatusPageUtil.getStatusPageId() || undefined,
        }),
        isResolved,
      });
    }

    // Sort by date descending
    allEvents.sort((a: EventWithDate, b: EventWithDate) => {
      return OneUptimeDate.isAfter(a.date, b.date) ? -1 : 1;
    });

    const activeEvents: Array<EventWithDate> = allEvents.filter(
      (event: EventWithDate) => {
        return !event.isResolved;
      },
    );

    const resolvedEvents: Array<EventWithDate> = allEvents.filter(
      (event: EventWithDate) => {
        return event.isResolved;
      },
    );

    setParsedActiveEventsData(getEventHistoryListComponentProps(activeEvents));
    setParsedResolvedEventsData(
      getEventHistoryListComponentProps(resolvedEvents),
    );
  }, [isLoading]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Page
      title={"Incidents"}
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
      ]}
    >
      {parsedActiveEventsData?.items &&
      parsedActiveEventsData?.items.length > 0 ? (
        <div>
          <Section title="Active Incidents" />

          <EventHistoryList items={parsedActiveEventsData?.items || []} />
        </div>
      ) : (
        <></>
      )}

      {parsedResolvedEventsData?.items &&
      parsedResolvedEventsData?.items.length > 0 ? (
        <div>
          <Section title="Resolved Incidents" />

          <EventHistoryList items={parsedResolvedEventsData?.items || []} />
        </div>
      ) : (
        <></>
      )}
      {!hasEvents ? (
        <EmptyState
          id={"incidents-empty-state"}
          title={"No Incident"}
          description={"No incidents posted on this status page."}
          icon={IconProp.Alert}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Overview;
