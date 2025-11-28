import Page from "../../Components/Page/Page";
import Section from "../../Components/Section/Section";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import PageComponentProps from "../PageComponentProps";
import { getIncidentEventItem } from "./Detail";
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
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
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

  const [parsedActiveIncidentsData, setParsedActiveIncidentsData] =
    useState<EventHistoryListComponentProps | null>(null);

  const [parsedResolvedIncidentsData, setParsedResolvedIncidentsData] =
    useState<EventHistoryListComponentProps | null>(null);

  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});

  const [incidentStates, setIncidentStates] = useState<Array<IncidentState>>(
    [],
  );

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
      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
          `/incidents/${id.toString()}`,
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
      const incidents: Array<Incident> = BaseModel.fromJSONArray(
        (data["incidents"] as JSONArray) || [],
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

      const incidentStates: Array<IncidentState> = BaseModel.fromJSONArray(
        (data["incidentStates"] as JSONArray) || [],
        IncidentState,
      );

      setMonitorsInGroup(monitorsInGroup);
      setIncidentStates(incidentStates);

      // save data. set()
      setIncidentPublicNotes(incidentPublicNotes);
      setIncidents(incidents);
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

  type GetEventHistoryListComponentProps = (
    incidents: Array<Incident>,
  ) => EventHistoryListComponentProps;

  const getEventHistoryListComponentProps: GetEventHistoryListComponentProps = (
    incidents: Array<Incident>,
  ): EventHistoryListComponentProps => {
    const eventHistoryListComponentProps: EventHistoryListComponentProps = {
      items: [],
    };

    const days: Dictionary<EventHistoryDayListComponentProps> = {};

    for (const incident of incidents) {
      const incidentDate: Date =
        incident.declaredAt ||
        (incident.createdAt as Date | undefined) ||
        OneUptimeDate.getCurrentDate();
      const dayString: string = OneUptimeDate.getDateString(incidentDate);

      if (!days[dayString]) {
        days[dayString] = {
          date: incidentDate,
          items: [],
        };
      }

      days[dayString]?.items.push(
        getIncidentEventItem({
          incident,
          incidentPublicNotes,
          incidentStateTimelines,
          statusPageResources,
          monitorsInGroup,
          isPreviewPage: StatusPageUtil.isPreviewPage(),
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

  useEffect(() => {
    if (isLoading) {
      // parse data;
      setParsedActiveIncidentsData(null);
      setParsedResolvedIncidentsData(null);
      return;
    }

    const resolvedIncidentStateOrder: number =
      incidentStates.find((state: IncidentState) => {
        return state.isResolvedState;
      })?.order || 0;

    const activeIncidents: Array<Incident> = incidents.filter(
      (incident: Incident) => {
        return (
          (incident.currentIncidentState?.order || 0) <
          resolvedIncidentStateOrder
        );
      },
    );

    const resolvedIncidents: Array<Incident> = incidents.filter(
      (incident: Incident) => {
        return !(
          (incident.currentIncidentState?.order || 0) <
          resolvedIncidentStateOrder
        );
      },
    );

    setParsedActiveIncidentsData(
      getEventHistoryListComponentProps(activeIncidents),
    );
    setParsedResolvedIncidentsData(
      getEventHistoryListComponentProps(resolvedIncidents),
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
      {parsedActiveIncidentsData?.items &&
      parsedActiveIncidentsData?.items.length > 0 ? (
        <div>
          <Section title="Active Incidents" />

          <EventHistoryList items={parsedActiveIncidentsData?.items || []} />
        </div>
      ) : (
        <></>
      )}

      {parsedResolvedIncidentsData?.items &&
      parsedResolvedIncidentsData?.items.length > 0 ? (
        <div>
          <Section title="Resolved Incidents" />

          <EventHistoryList items={parsedResolvedIncidentsData?.items || []} />
        </div>
      ) : (
        <></>
      )}
      {incidents.length === 0 ? (
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
