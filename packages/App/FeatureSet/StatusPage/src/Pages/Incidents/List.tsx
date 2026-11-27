import Page from "../../Components/Page/Page";
import Section from "../../Components/Section/Section";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import {
  HISTORY_WINDOW_WORDS,
  readHistoryInDays,
} from "../../Utils/HistoryWindow";
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
import { EventListSkeleton } from "../../Components/Skeleton/PageSkeletons";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
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
import { useTranslation } from "react-i18next";
import { Translator } from "Common/Types/Translator";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { DEFAULT_STATUS_PAGE_HISTORY_IN_DAYS } from "Common/Utils/StatusPage/HistoryWindow";
import StatusPageIncidentGrouping, {
  StatusPageIncidentListCards,
  StatusPageIncidentListMode,
} from "Common/Utils/StatusPage/IncidentGrouping";
import {
  getEpisodeIncidents,
  readEpisodeIncidents,
  readIncidentListMode,
} from "../../Utils/IncidentGrouping";
import useAsyncEffect from "use-async-effect";
import { Location, useLocation } from "react-router-dom";

/*
 * The cards the list draws, in the page's mode (Common/Utils/StatusPage/
 * IncidentGrouping): grouped by episode, an incident an episode card lists
 * has no card of its own, and an episode that lists none is not drawn.
 */
const getListCards: (data: {
  mode: StatusPageIncidentListMode;
  incidents: Array<Incident>;
  episodes: Array<IncidentEpisode>;
  episodeIncidents: Dictionary<Array<Incident>>;
}) => StatusPageIncidentListCards<Incident, IncidentEpisode> = (data: {
  mode: StatusPageIncidentListMode;
  incidents: Array<Incident>;
  episodes: Array<IncidentEpisode>;
  episodeIncidents: Dictionary<Array<Incident>>;
}): StatusPageIncidentListCards<Incident, IncidentEpisode> => {
  return StatusPageIncidentGrouping.getCards<Incident, IncidentEpisode>({
    mode: data.mode,
    incidents: data.incidents,
    episodes: data.episodes,
    getIncidentId: (incident: Incident): string | undefined => {
      return incident.id?.toString() || incident._id;
    },
    getEpisodeIncidentIds: (episode: IncidentEpisode): Array<string> => {
      return getEpisodeIncidents(
        data.episodeIncidents,
        episode.id?.toString() || episode._id,
      ).map((incident: Incident): string => {
        return (incident.id?.toString() || incident._id || "").toString();
      });
    },
  });
};

// Event item with date for sorting
interface EventWithDate {
  date: Date;
  eventItem: EventItemComponentProps;
  isResolved: boolean;
}

const Overview: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const { t, i18n: i18nInstance } = useTranslation();
  const location: Location = useLocation();
  const category: string | null = new URLSearchParams(location.search).get(
    "category",
  );
  const translator: Translator = useTranslator();
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

  // How the page lists them, and the incidents each episode card lists.
  const [incidentListMode, setIncidentListMode] =
    useState<StatusPageIncidentListMode>(StatusPageIncidentListMode.Separate);
  const [episodeIncidents, setEpisodeIncidents] = useState<
    Dictionary<Array<Incident>>
  >({});

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

  // How many days of incidents the server sent: what the page names.
  const [historyInDays, setHistoryInDays] = useState<number>(
    DEFAULT_STATUS_PAGE_HISTORY_IN_DAYS,
  );
  const [selectedCategory, setSelectedCategory] = useState<{
    publicName: string;
    publicDescription?: string | undefined;
  } | null>(null);
  const requestNumber: React.MutableRefObject<number> = React.useRef<number>(0);

  StatusPageUtil.checkIfUserHasLoggedIn();

  useAsyncEffect(async () => {
    const thisRequest: number = ++requestNumber.current;
    try {
      if (!StatusPageUtil.getStatusPageId()) {
        return;
      }
      setIsLoading(true);

      const id: ObjectID | null = StatusPageUtil.getStatusPageId();
      if (!id) {
        throw new BadDataException("Status Page ID is required");
      }

      setError(null);
      setSelectedCategory(null);

      // Fetch incidents
      const incidentsResponse: HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(STATUS_PAGE_API_URL.toString())
            .addRoute(`/incidents/${id.toString()}`)
            .addQueryParams(category ? { category: category } : {}),
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

      if (!category) {
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
      }

      if (!incidentsResponse.isSuccess()) {
        throw incidentsResponse;
      }

      if (thisRequest !== requestNumber.current) {
        return;
      }

      const incidentsData: JSONObject = incidentsResponse.data;
      const categoryRows: Array<JSONObject> = Array.isArray(
        incidentsData["incidentCategories"],
      )
        ? (incidentsData["incidentCategories"] as Array<JSONObject>)
        : [];
      const currentCategory: JSONObject | undefined = categoryRows.find(
        (item: JSONObject): boolean => {
          return item["_id"] === category;
        },
      );
      if (
        currentCategory &&
        typeof currentCategory["publicName"] === "string"
      ) {
        setSelectedCategory({
          publicName: currentCategory["publicName"],
          publicDescription:
            typeof currentCategory["publicDescription"] === "string"
              ? currentCategory["publicDescription"]
              : undefined,
        });
      }

      setHistoryInDays(readHistoryInDays(incidentsData));

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
      const rawEpisodesArray: JSONArray =
        (episodesData["episodes"] as JSONArray) || [];
      const episodes: Array<IncidentEpisode> = BaseModel.fromJSONArray(
        rawEpisodesArray,
        IncidentEpisode,
      );

      // Preserve monitors from raw JSON (not part of model schema)
      for (let i: number = 0; i < episodes.length; i++) {
        const rawEpisode: JSONObject = rawEpisodesArray[i] as JSONObject;
        if (rawEpisode && rawEpisode["monitors"]) {
          (episodes[i] as any).monitors = rawEpisode["monitors"];
        }
      }

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

      const mode: StatusPageIncidentListMode = category
        ? StatusPageIncidentListMode.Separate
        : readIncidentListMode(incidentsData, episodesData);
      const incidentsOfEpisodes: Dictionary<Array<Incident>> =
        readEpisodeIncidents(rawEpisodesArray);

      setIncidentListMode(mode);
      setEpisodeIncidents(incidentsOfEpisodes);

      const cards: StatusPageIncidentListCards<Incident, IncidentEpisode> =
        getListCards({
          mode: mode,
          incidents: incidents,
          episodes: episodes,
          episodeIncidents: incidentsOfEpisodes,
        });

      setHasEvents(cards.incidents.length > 0 || cards.episodes.length > 0);

      setIsLoading(false);
      props.onLoadComplete();
    } catch (err) {
      if (thisRequest !== requestNumber.current) {
        return;
      }
      if (err instanceof HTTPErrorResponse) {
        await StatusPageUtil.checkIfTheUserIsAuthenticated(err);
      }
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  }, [category]);

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

    /*
     * Where the project's resolved state sits: an incident or episode in it,
     * or in a state placed after it, is resolved (Common/Utils/ResolvedState).
     */
    const resolvedIncidentStateOrder: number =
      ResolvedStateUtil.getResolvedOrder({
        list: StateListType.IncidentState,
        states: incidentStates,
      }) || 0;

    // Build combined events list with incidents and episodes
    const allEvents: Array<EventWithDate> = [];

    const cards: StatusPageIncidentListCards<Incident, IncidentEpisode> =
      getListCards({
        mode: incidentListMode,
        incidents: incidents,
        episodes: episodes,
        episodeIncidents: episodeIncidents,
      });

    // Add incidents
    for (const incident of cards.incidents) {
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
          incidentStates,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: StatusPageUtil.isPreviewPage(),
          isSummary: true,
        }),
        isResolved,
      });
    }

    // Add episodes
    for (const episode of cards.episodes) {
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
          incidentStates,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: StatusPageUtil.isPreviewPage(),
          isSummary: true,
          statusPageId: StatusPageUtil.getStatusPageId() || undefined,
          // Grouped by episode, its card lists its incidents.
          incidents: StatusPageIncidentGrouping.isGroupedByEpisode(
            incidentListMode,
          )
            ? getEpisodeIncidents(
                episodeIncidents,
                episode.id?.toString() || episode._id,
              )
            : undefined,
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
  }, [isLoading, i18nInstance.resolvedLanguage]);

  type RenderPageFunction = (pageContent: ReactElement) => ReactElement;

  /*
   * The page chrome — title and breadcrumbs — comes from static translations,
   * not from the request, so render it immediately and swap only the body
   * between the loading skeleton, an error and the real content. Returning a
   * bare loader instead used to blank the whole page and drag the footer up
   * into the middle of the viewport until the data arrived.
   */
  const renderPage: RenderPageFunction = (
    pageContent: ReactElement,
  ): ReactElement => {
    return (
      <Page
        title={t("incidents.title")}
        isTitleTranslated={true}
        breadcrumbLinks={[
          {
            title: t("nav.overview"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              StatusPageUtil.isPreviewPage()
                ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                : (RouteMap[PageMap.OVERVIEW] as Route),
            ),
          },
          {
            title: t("incidents.title"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              StatusPageUtil.isPreviewPage()
                ? (RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route)
                : (RouteMap[PageMap.INCIDENT_LIST] as Route),
            ),
          },
        ]}
      >
        {pageContent}
      </Page>
    );
  };

  if (isLoading) {
    return renderPage(<EventListSkeleton />);
  }

  if (error) {
    return renderPage(<ErrorMessage message={error} />);
  }

  return renderPage(
    <>
      {selectedCategory && (
        <div className="mb-5 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-lg font-semibold">
            {selectedCategory.publicName}
          </h2>
          {selectedCategory.publicDescription && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {selectedCategory.publicDescription}
            </p>
          )}
        </div>
      )}
      {parsedActiveEventsData?.items &&
      parsedActiveEventsData?.items.length > 0 ? (
        <div>
          <Section title={t("incidents.active")} />

          <EventHistoryList items={parsedActiveEventsData?.items || []} />
        </div>
      ) : (
        <></>
      )}

      {parsedResolvedEventsData?.items &&
      parsedResolvedEventsData?.items.length > 0 ? (
        <div>
          <Section
            title={translator.translatePlural(
              HISTORY_WINDOW_WORDS.resolvedIncidents,
              historyInDays,
            )}
          />

          <EventHistoryList items={parsedResolvedEventsData?.items || []} />
        </div>
      ) : (
        <></>
      )}
      {!hasEvents ? (
        <EmptyState
          id={"incidents-empty-state"}
          title={translator.translatePlural(
            HISTORY_WINDOW_WORDS.noIncidents,
            historyInDays,
          )}
          description={t("incidents.noneDescription")}
          icon={IconProp.Calendar}
        />
      ) : (
        <></>
      )}
    </>,
  );
};

export default Overview;
