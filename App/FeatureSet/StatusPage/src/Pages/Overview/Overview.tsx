import MonitorOverview from "../../Components/Monitor/MonitorOverview";
import Page from "../../Components/Page/Page";
import Section from "../../Components/Section/Section";
import IncidentGroup from "../../Types/IncidentGroup";
import ScheduledMaintenanceGroup from "../../Types/ScheduledMaintenanceGroup";
import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { getAnnouncementEventItem } from "../Announcement/Detail";
import { getIncidentEventItem, getEpisodeEventItem } from "../Incidents/Detail";
import PageComponentProps from "../PageComponentProps";
import EpisodeGroup from "../../Types/EpisodeGroup";
import { getScheduledEventEventItem } from "../ScheduledEvent/Detail";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Green } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Accordion from "Common/UI/Components/Accordion/Accordion";
import AccordionGroup from "Common/UI/Components/Accordion/AccordionGroup";
import Alert, { AlertSize } from "Common/UI/Components/Alerts/Alert";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EventItem from "Common/UI/Components/EventItem/EventItem";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import StatusPageResourceUptimeUtil from "Common/Utils/StatusPage/ResourceUptime";
import BadDataException from "Common/Types/Exception/BadDataException";
import UptimeBarTooltipIncident from "Common/Types/Monitor/UptimeBarTooltipIncident";
import Color from "Common/Types/Color";

const Overview: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  if (LocalStorage.getItem("redirectUrl")) {
    // const get item

    const redirectUrl: string = LocalStorage.getItem("redirectUrl") as string;

    // clear local storage.
    LocalStorage.removeItem("redirectUrl");

    Navigation.navigate(new Route(redirectUrl));
  }

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [
    scheduledMaintenanceEventsPublicNotes,
    setScheduledMaintenanceEventsPublicNotes,
  ] = useState<Array<ScheduledMaintenancePublicNote>>([]);
  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
  const [
    activeScheduledMaintenanceEvents,
    setActiveScheduledMaintenanceEvents,
  ] = useState<Array<ScheduledMaintenance>>([]);
  const [activeAnnouncements, setActiveAnnouncements] = useState<
    Array<StatusPageAnnouncement>
  >([]);
  const [incidentPublicNotes, setIncidentPublicNotes] = useState<
    Array<IncidentPublicNote>
  >([]);
  const [activeIncidents, setActiveIncidents] = useState<Array<Incident>>([]);
  const [activeEpisodes, setActiveEpisodes] = useState<Array<IncidentEpisode>>(
    [],
  );
  const [episodePublicNotes, setEpisodePublicNotes] = useState<
    Array<IncidentEpisodePublicNote>
  >([]);
  const [episodeStateTimelines, setEpisodeStateTimelines] = useState<
    Array<IncidentEpisodeStateTimeline>
  >([]);
  const [monitorStatusTimelines, setMonitorStatusTimelines] = useState<
    Array<MonitorStatusTimeline>
  >([]);
  const [resourceGroups, setResourceGroups] = useState<Array<StatusPageGroup>>(
    [],
  );
  const [monitorStatuses, setMonitorStatuses] = useState<Array<MonitorStatus>>(
    [],
  );

  const [
    statusPageHistoryChartBarColorRules,
    setStatusPageHistoryChartBarColorRules,
  ] = useState<Array<StatusPageHistoryChartBarColorRule>>([]);

  const [statusPageResources, setStatusPageResources] = useState<
    Array<StatusPageResource>
  >([]);
  const [incidentStateTimelines, setIncidentStateTimelines] = useState<
    Array<IncidentStateTimeline>
  >([]);
  const [
    scheduledMaintenanceStateTimelines,
    setScheduledMaintenanceStateTimelines,
  ] = useState<Array<ScheduledMaintenanceStateTimeline>>([]);
  const uptimeHistoryDays: number = statusPage?.showUptimeHistoryInDays || 90;
  const startDate: Date = OneUptimeDate.getSomeDaysAgo(uptimeHistoryDays);
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const [currentStatus, setCurrentStatus] = useState<MonitorStatus | null>(
    null,
  );
  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

  const [monitorsInGroup, setMonitorsInGroup] = useState<
    Dictionary<Array<ObjectID>>
  >({});

  const [monitorGroupCurrentStatuses, setMonitorGroupCurrentStatuses] =
    useState<Dictionary<ObjectID>>({});

  const [timelineIncidents, setTimelineIncidents] = useState<
    Array<UptimeBarTooltipIncident>
  >([]);

  StatusPageUtil.checkIfUserHasLoggedIn();

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
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
          `/overview/${id.toString()}`,
        ),
        data: {},
        headers: API.getDefaultHeaders(),
      });

      if (!response.isSuccess()) {
        throw response;
      }

      if (!response.isSuccess()) {
        throw response;
      }

      const data: JSONObject = response.data;

      const scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceEventsPublicNotes"] as JSONArray) || [],
          ScheduledMaintenancePublicNote,
        );
      const activeScheduledMaintenanceEvents: Array<ScheduledMaintenance> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceEvents"] as JSONArray) || [],
          ScheduledMaintenance,
        );
      const activeAnnouncements: Array<StatusPageAnnouncement> =
        BaseModel.fromJSONArray(
          (data["activeAnnouncements"] as JSONArray) || [],
          StatusPageAnnouncement,
        );
      const incidentPublicNotes: Array<IncidentPublicNote> =
        BaseModel.fromJSONArray(
          (data["incidentPublicNotes"] as JSONArray) || [],
          IncidentPublicNote,
        );

      const statusPageHistoryChartBarColorRules: Array<StatusPageHistoryChartBarColorRule> =
        BaseModel.fromJSONArray(
          (data["statusPageHistoryChartBarColorRules"] as JSONArray) || [],
          StatusPageHistoryChartBarColorRule,
        );

      const activeIncidents: Array<Incident> = BaseModel.fromJSONArray(
        (data["activeIncidents"] as JSONArray) || [],
        Incident,
      );

      // Parse episodes data
      const rawEpisodesArray: JSONArray =
        (data["activeEpisodes"] as JSONArray) || [];
      const activeEpisodes: Array<IncidentEpisode> = BaseModel.fromJSONArray(
        rawEpisodesArray,
        IncidentEpisode,
      );

      // Preserve monitors from raw JSON (not part of model schema)
      for (let i: number = 0; i < activeEpisodes.length; i++) {
        const rawEpisode: JSONObject = rawEpisodesArray[i] as JSONObject;
        if (rawEpisode && rawEpisode["monitors"]) {
          (activeEpisodes[i] as any).monitors = rawEpisode["monitors"];
        }
      }

      const episodePublicNotes: Array<IncidentEpisodePublicNote> =
        BaseModel.fromJSONArray(
          (data["episodePublicNotes"] as JSONArray) || [],
          IncidentEpisodePublicNote,
        );

      const episodeStateTimelines: Array<IncidentEpisodeStateTimeline> =
        BaseModel.fromJSONArray(
          (data["episodeStateTimelines"] as JSONArray) || [],
          IncidentEpisodeStateTimeline,
        );

      const monitorStatusTimelines: Array<MonitorStatusTimeline> =
        BaseModel.fromJSONArray(
          (data["monitorStatusTimelines"] as JSONArray) || [],
          MonitorStatusTimeline,
        );
      const resourceGroups: Array<StatusPageGroup> = BaseModel.fromJSONArray(
        (data["resourceGroups"] as JSONArray) || [],
        StatusPageGroup,
      );
      const monitorStatuses: Array<MonitorStatus> = BaseModel.fromJSONArray(
        (data["monitorStatuses"] as JSONArray) || [],
        MonitorStatus,
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

      const statusPage: StatusPage = BaseModel.fromJSONObject(
        (data["statusPage"] as JSONObject) || [],
        StatusPage,
      );

      const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
        BaseModel.fromJSONArray(
          (data["scheduledMaintenanceStateTimelines"] as JSONArray) || [],
          ScheduledMaintenanceStateTimeline,
        );

      const monitorsInGroup: Dictionary<Array<ObjectID>> =
        JSONFunctions.deserialize(
          (data["monitorsInGroup"] as JSONObject) || {},
        ) as Dictionary<Array<ObjectID>>;

      const monitorGroupCurrentStatuses: Dictionary<ObjectID> =
        JSONFunctions.deserialize(
          (data["monitorGroupCurrentStatuses"] as JSONObject) || {},
        ) as Dictionary<ObjectID>;

      // Parse timeline incidents for uptime bar tooltips
      const rawTimelineIncidents: Array<Incident> = BaseModel.fromJSONArray(
        (data["timelineIncidents"] as JSONArray) || [],
        Incident,
      );

      const parsedTimelineIncidents: Array<UptimeBarTooltipIncident> =
        rawTimelineIncidents.map((incident: Incident) => {
          return {
            id: incident._id || "",
            title: incident.title || "",
            declaredAt: incident.declaredAt || new Date(),
            incidentSeverity: incident.incidentSeverity
              ? {
                  name: incident.incidentSeverity.name || "",
                  color:
                    incident.incidentSeverity.color || new Color("#000000"),
                }
              : undefined,
            currentIncidentState: incident.currentIncidentState
              ? {
                  name: incident.currentIncidentState.name || "",
                  color:
                    incident.currentIncidentState.color || new Color("#000000"),
                }
              : undefined,
            monitorIds: (incident.monitors || []).map((m: Monitor) => {
              return new ObjectID(m._id?.toString() || "");
            }),
          };
        });

      setTimelineIncidents(parsedTimelineIncidents);
      setMonitorsInGroup(monitorsInGroup);
      setMonitorGroupCurrentStatuses(monitorGroupCurrentStatuses);

      setStatusPageHistoryChartBarColorRules(
        statusPageHistoryChartBarColorRules,
      );

      // save data. set()
      setScheduledMaintenanceEventsPublicNotes(
        scheduledMaintenanceEventsPublicNotes,
      );
      setActiveScheduledMaintenanceEvents(activeScheduledMaintenanceEvents);
      setActiveAnnouncements(activeAnnouncements);
      setIncidentPublicNotes(incidentPublicNotes);
      setActiveIncidents(activeIncidents);
      setActiveEpisodes(activeEpisodes);
      setEpisodePublicNotes(episodePublicNotes);
      setEpisodeStateTimelines(episodeStateTimelines);
      setMonitorStatusTimelines(monitorStatusTimelines);
      setResourceGroups(resourceGroups);
      setMonitorStatuses(monitorStatuses);
      setStatusPage(statusPage);
      setStatusPageResources(statusPageResources);
      setIncidentStateTimelines(incidentStateTimelines);
      setScheduledMaintenanceStateTimelines(scheduledMaintenanceStateTimelines);

      const overallStatus: MonitorStatus | null = data["overallStatus"]
        ? BaseModel.fromJSONObject(
            (data["overallStatus"] as JSONObject) || {},
            MonitorStatus,
          )
        : null;

      // Parse Data.
      setCurrentStatus(overallStatus);

      setIsLoading(false);
      props.onLoadComplete();
    } catch (err) {
      if (err instanceof HTTPErrorResponse) {
        await StatusPageUtil.checkIfTheUserIsAuthenticated(err);
      }

      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPage().catch((err: Error) => {
      setError(err.message);
    });
  }, []);

  useEffect(() => {
    loadPage().catch((err: Error) => {
      setError(err.message);
    });
  }, [
    StatusPageUtil.getStatusPageId()?.toString() || "",
    StatusPageUtil.isPreviewPage(),
    StatusPageUtil.isPrivateStatusPage(),
  ]);

  type GetCurrentGroupStatusElementFunction = (data: {
    group: StatusPageGroup;
  }) => ReactElement;

  const getCurrentGroupStatusElement: GetCurrentGroupStatusElementFunction =
    (data: { group: StatusPageGroup }): ReactElement => {
      const currentStatus: MonitorStatus =
        StatusPageResourceUptimeUtil.getCurrentStatusPageGroupStatus({
          statusPageGroup: data.group,
          monitorStatusTimelines: monitorStatusTimelines,
          statusPageResources: statusPageResources,
          monitorStatuses: monitorStatuses,
          monitorGroupCurrentStatuses: monitorGroupCurrentStatuses,
        });

      if (
        !(statusPage?.downtimeMonitorStatuses || []).find(
          (downtimeStatus: MonitorStatus) => {
            return (
              currentStatus?.id?.toString() === downtimeStatus?.id?.toString()
            );
          },
        ) &&
        data.group.showUptimePercent
      ) {
        const uptimePercent: number | null =
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: data.group,
              monitorStatusTimelines: monitorStatusTimelines,
              precision:
                data.group.uptimePercentPrecision ||
                UptimePrecision.ONE_DECIMAL,
              downtimeMonitorStatuses:
                statusPage?.downtimeMonitorStatuses || [],
              statusPageResources: statusPageResources,
              monitorsInGroup: monitorsInGroup,
            },
          );

        if (uptimePercent === null) {
          return <></>;
        }

        return (
          <div
            className="font-medium"
            style={{
              color: currentStatus?.color?.toString() || Green.toString(),
            }}
          >
            {uptimePercent}
            {t("overview.uptimeSuffix")}
          </div>
        );
      }

      if (data.group.showCurrentStatus) {
        return (
          <div
            className=""
            style={{
              color: currentStatus?.color?.toString() || Green.toString(),
            }}
          >
            {currentStatus?.name || t("overview.operational")}
          </div>
        );
      }

      return <></>;
    };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  type GetMonitorOverviewListInGroupFunction = (
    group: StatusPageGroup | null,
  ) => Array<ReactElement>;

  const getMonitorOverviewListInGroup: GetMonitorOverviewListInGroupFunction = (
    group: StatusPageGroup | null,
  ): Array<ReactElement> => {
    const elements: Array<ReactElement> = [];

    for (const resource of statusPageResources) {
      if (
        (resource.statusPageGroupId &&
          resource.statusPageGroupId.toString() &&
          group &&
          group._id?.toString() &&
          group._id?.toString() === resource.statusPageGroupId.toString()) ||
        (!resource.statusPageGroupId && !group)
      ) {
        // if it's not a monitor or a monitor group, then continue. This should ideally not happen.

        if (!resource.monitor && !resource.monitorGroupId) {
          continue;
        }

        // if it's a monitor

        if (resource.monitor) {
          let currentStatus: MonitorStatus | undefined = monitorStatuses.find(
            (status: MonitorStatus) => {
              return (
                status._id?.toString() ===
                resource.monitor?.currentMonitorStatusId?.toString()
              );
            },
          );

          if (!currentStatus) {
            currentStatus = new MonitorStatus();
            currentStatus.name = t("overview.operational");
            currentStatus.color = Green;
          }

          const monitorId: string = resource.monitor?._id?.toString() || "";

          const monitorIncidents: Array<UptimeBarTooltipIncident> =
            timelineIncidents.filter((incident: UptimeBarTooltipIncident) => {
              return incident.monitorIds.some((id: ObjectID) => {
                return id.toString() === monitorId;
              });
            });

          elements.push(
            <MonitorOverview
              key={Math.random()}
              className="mb-3 sm:mb-5"
              monitorName={resource.displayName || resource.monitor?.name || ""}
              statusPageHistoryChartBarColorRules={
                statusPageHistoryChartBarColorRules
              }
              downtimeMonitorStatuses={
                statusPage?.downtimeMonitorStatuses || []
              }
              description={resource.displayDescription || ""}
              tooltip={resource.displayTooltip || ""}
              currentStatus={currentStatus}
              showUptimePercent={Boolean(resource.showUptimePercent)}
              uptimePrecision={
                resource.uptimePercentPrecision || UptimePrecision.ONE_DECIMAL
              }
              monitorStatusTimeline={StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource(
                {
                  statusPageResource: resource,
                  monitorStatusTimelines: monitorStatusTimelines,
                  monitorsInGroup: monitorsInGroup,
                },
              )}
              startDate={startDate}
              endDate={endDate}
              showHistoryChart={resource.showStatusHistoryChart}
              showCurrentStatus={resource.showCurrentStatus}
              uptimeGraphHeight={10}
              defaultBarColor={statusPage?.defaultBarColor || Green}
              uptimeHistoryDays={uptimeHistoryDays}
              incidents={monitorIncidents}
              onIncidentClick={(incidentId: string) => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    StatusPageUtil.isPreviewPage()
                      ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
                      : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
                    new ObjectID(incidentId),
                  ),
                );
              }}
            />,
          );
        }

        // if it's a monitor group, then...

        if (resource.monitorGroupId) {
          let currentStatus: MonitorStatus | undefined = monitorStatuses.find(
            (status: MonitorStatus) => {
              return (
                status._id?.toString() ===
                monitorGroupCurrentStatuses[
                  resource.monitorGroupId?.toString() || ""
                ]?.toString()
              );
            },
          );

          if (!currentStatus) {
            currentStatus = new MonitorStatus();
            currentStatus.name = t("overview.operational");
            currentStatus.color = Green;
          }

          // Get monitor IDs in this group
          const groupMonitorIds: Array<string> = (
            monitorsInGroup[resource.monitorGroupId?.toString() || ""] || []
          ).map((id: ObjectID) => {
            return id.toString();
          });

          const groupIncidents: Array<UptimeBarTooltipIncident> =
            timelineIncidents.filter((incident: UptimeBarTooltipIncident) => {
              return incident.monitorIds.some((id: ObjectID) => {
                return groupMonitorIds.includes(id.toString());
              });
            });

          elements.push(
            <MonitorOverview
              key={Math.random()}
              className="mb-3 sm:mb-5"
              monitorName={resource.displayName || resource.monitor?.name || ""}
              showUptimePercent={Boolean(resource.showUptimePercent)}
              uptimePrecision={
                resource.uptimePercentPrecision || UptimePrecision.ONE_DECIMAL
              }
              statusPageHistoryChartBarColorRules={
                statusPageHistoryChartBarColorRules
              }
              description={resource.displayDescription || ""}
              tooltip={resource.displayTooltip || ""}
              currentStatus={currentStatus}
              monitorStatusTimeline={StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource(
                {
                  statusPageResource: resource,
                  monitorStatusTimelines: monitorStatusTimelines,
                  monitorsInGroup: monitorsInGroup,
                },
              )}
              downtimeMonitorStatuses={
                statusPage?.downtimeMonitorStatuses || []
              }
              startDate={startDate}
              endDate={endDate}
              showHistoryChart={resource.showStatusHistoryChart}
              showCurrentStatus={resource.showCurrentStatus}
              uptimeGraphHeight={10}
              defaultBarColor={statusPage?.defaultBarColor || Green}
              uptimeHistoryDays={uptimeHistoryDays}
              incidents={groupIncidents}
              onIncidentClick={(incidentId: string) => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    StatusPageUtil.isPreviewPage()
                      ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
                      : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
                    new ObjectID(incidentId),
                  ),
                );
              }}
            />,
          );
        }
      }
    }

    if (elements.length === 0) {
      elements.push(
        <div key={1} className="mb-20">
          <ErrorMessage message={t("overview.noResourcesInGroup")} />
        </div>,
      );
    }

    return elements;
  };

  type GetActiveIncidentsFunction = () => Array<IncidentGroup>;

  const getActiveIncidents: GetActiveIncidentsFunction =
    (): Array<IncidentGroup> => {
      const groups: Array<IncidentGroup> = [];

      for (const activeIncident of activeIncidents) {
        if (!activeIncident.currentIncidentState) {
          //should not happen.
          continue;
        }

        const timeline: IncidentStateTimeline | undefined =
          incidentStateTimelines.find((timeline: IncidentStateTimeline) => {
            return timeline.incidentId?.toString() === activeIncident._id;
          });

        const group: IncidentGroup = {
          incident: activeIncident,
          incidentState: activeIncident.currentIncidentState,
          incidentResources: statusPageResources,
          publicNotes: incidentPublicNotes.filter(
            (publicNote: IncidentPublicNote) => {
              return publicNote.incidentId?.toString() === activeIncident._id;
            },
          ),
          incidentSeverity: activeIncident.incidentSeverity!,
          incidentStateTimelines: timeline ? [timeline] : [],
          monitorsInGroup: monitorsInGroup,
        };

        groups.push(group);
      }

      return groups;
    };

  type GetActiveEpisodesFunction = () => Array<EpisodeGroup>;

  const getActiveEpisodesGroups: GetActiveEpisodesFunction =
    (): Array<EpisodeGroup> => {
      const groups: Array<EpisodeGroup> = [];

      for (const activeEpisode of activeEpisodes) {
        if (!activeEpisode.currentIncidentState) {
          // should not happen.
          continue;
        }

        const timeline: IncidentEpisodeStateTimeline | undefined =
          episodeStateTimelines.find(
            (timeline: IncidentEpisodeStateTimeline) => {
              return (
                timeline.incidentEpisodeId?.toString() === activeEpisode._id
              );
            },
          );

        const group: EpisodeGroup = {
          episode: activeEpisode,
          incidentState: activeEpisode.currentIncidentState,
          episodeResources: statusPageResources,
          publicNotes: episodePublicNotes.filter(
            (publicNote: IncidentEpisodePublicNote) => {
              return (
                publicNote.incidentEpisodeId?.toString() === activeEpisode._id
              );
            },
          ),
          incidentSeverity: activeEpisode.incidentSeverity!,
          episodeStateTimelines: timeline ? [timeline] : [],
          monitorsInGroup: monitorsInGroup,
        };

        groups.push(group);
      }

      return groups;
    };

  type GetOngoingScheduledEventsFunction =
    () => Array<ScheduledMaintenanceGroup>;

  const getOngoingScheduledEvents: GetOngoingScheduledEventsFunction =
    (): Array<ScheduledMaintenanceGroup> => {
      const groups: Array<ScheduledMaintenanceGroup> = [];

      for (const activeEvent of activeScheduledMaintenanceEvents) {
        if (!activeEvent.currentScheduledMaintenanceState) {
          //should not happen.
          continue;
        }

        const timeline: ScheduledMaintenanceStateTimeline | undefined =
          scheduledMaintenanceStateTimelines.find(
            (timeline: ScheduledMaintenanceStateTimeline) => {
              return (
                timeline.scheduledMaintenanceId?.toString() === activeEvent._id
              );
            },
          );

        const group: ScheduledMaintenanceGroup = {
          scheduledMaintenance: activeEvent,
          scheduledMaintenanceState:
            activeEvent.currentScheduledMaintenanceState,
          scheduledEventResources: statusPageResources,
          publicNotes: scheduledMaintenanceEventsPublicNotes.filter(
            (publicNote: ScheduledMaintenancePublicNote) => {
              return (
                publicNote.scheduledMaintenanceId?.toString() ===
                activeEvent._id
              );
            },
          ),
          scheduledMaintenanceStateTimelines: timeline ? [timeline] : [],
          monitorsInGroup: monitorsInGroup,
        };

        groups.push(group);
      }

      return groups;
    };

  const activeIncidentsInIncidentGroup: Array<IncidentGroup> =
    getActiveIncidents();
  const activeEpisodesInEpisodeGroup: Array<EpisodeGroup> =
    getActiveEpisodesGroups();
  const activeScheduledMaintenanceEventsInScheduledMaintenanceGroup: Array<ScheduledMaintenanceGroup> =
    getOngoingScheduledEvents();

  return (
    <Page>
      {isLoading ? <PageLoader isVisible={true} /> : <></>}
      {error ? <ErrorMessage message={error} /> : <></>}

      {!isLoading && !error ? (
        <div data-testid="status-page-overview">
          {/* Overview Page Description */}
          {statusPage && statusPage.overviewPageDescription && (
            <div
              id="status-page-description"
              className="bg-white p-5 my-5 rounded-xl shadow"
            >
              <MarkdownViewer text={statusPage.overviewPageDescription} />
            </div>
          )}

          {/* Load Active Announcement */}
          <div id="announcements-list">
            {activeAnnouncements.map(
              (announcement: StatusPageAnnouncement, i: number) => {
                return (
                  <EventItem
                    {...getAnnouncementEventItem({
                      announcement,
                      statusPageResources,
                      monitorsInGroup,
                      isPreviewPage: StatusPageUtil.isPreviewPage(),
                      isSummary: true,
                      statusPageId,
                    })}
                    isDetailItem={false}
                    key={i}
                  />
                );
              },
            )}
          </div>

          <div>
            {currentStatus && statusPageResources.length > 0 && (
              <Alert
                size={AlertSize.Large}
                title={(() => {
                  const statusName: string = currentStatus.name || "";
                  const isMaintenance: boolean =
                    statusName.toLowerCase() === "maintenance";
                  if (currentStatus.isOperationalState) {
                    return t("overview.allResourcesAre", {
                      status: statusName,
                    });
                  }
                  if (isMaintenance) {
                    return t("overview.someResourcesAreUnder", {
                      status: statusName,
                    });
                  }
                  return t("overview.someResourcesAre", {
                    status: statusName,
                  });
                })()}
                color={currentStatus.color}
                doNotShowIcon={true}
                textOnRight={
                  currentStatus.isOperationalState &&
                  statusPage?.showOverallUptimePercentOnStatusPage
                    ? (StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
                        {
                          monitorStatusTimelines: monitorStatusTimelines,
                          statusPageResources: statusPageResources,
                          downtimeMonitorStatuses:
                            statusPage.downtimeMonitorStatuses || [],
                          precision:
                            statusPage.overallUptimePercentPrecision ||
                            UptimePrecision.TWO_DECIMAL,
                          resourceGroups: resourceGroups,
                          monitorsInGroup: monitorsInGroup,
                        },
                      )?.toString() || "100") + t("overview.uptimeSuffix")
                    : undefined
                }
                textClassName="text-white text-lg flex justify-between w-full"
                id="overview-alert"
              />
            )}
          </div>

          {statusPageResources.length > 0 && (
            <div className="bg-white pl-3 pr-3 sm:pl-5 sm:pr-5 mt-5 rounded-xl shadow space-y-3 sm:space-y-5 mb-6">
              <AccordionGroup>
                {statusPageResources.filter((resources: StatusPageResource) => {
                  return !resources.statusPageGroupId;
                }).length > 0 ? (
                  <Accordion
                    key={Math.random()}
                    title={undefined}
                    isLastElement={resourceGroups.length === 0}
                  >
                    {getMonitorOverviewListInGroup(null)}
                  </Accordion>
                ) : (
                  <></>
                )}
                <div
                  key={Math.random()}
                  style={{
                    padding: "0px",
                  }}
                >
                  {resourceGroups.length > 0 &&
                    resourceGroups.map(
                      (resourceGroup: StatusPageGroup, i: number) => {
                        return (
                          <Accordion
                            key={i}
                            rightElement={getCurrentGroupStatusElement({
                              group: resourceGroup,
                            })}
                            isInitiallyExpanded={
                              resourceGroup.isExpandedByDefault
                            }
                            isLastElement={resourceGroups.length - 1 === i}
                            title={resourceGroup.name!}
                            description={resourceGroup.description!}
                          >
                            {getMonitorOverviewListInGroup(resourceGroup)}
                          </Accordion>
                        );
                      },
                    )}
                </div>
              </AccordionGroup>
            </div>
          )}

          {/* Load Active Incidents and Episodes */}
          {(activeIncidentsInIncidentGroup.length > 0 ||
            activeEpisodesInEpisodeGroup.length > 0) && (
            <div id="incidents-list mt-2">
              <Section title={t("overview.activeIncidents")} />
              {activeIncidentsInIncidentGroup.map(
                (incidentGroup: IncidentGroup, i: number) => {
                  return (
                    <EventItem
                      {...getIncidentEventItem({
                        incident: incidentGroup.incident,
                        incidentPublicNotes: incidentGroup.publicNotes || [],
                        incidentStateTimelines:
                          incidentGroup.incidentStateTimelines,
                        statusPageResources: incidentGroup.incidentResources,
                        monitorsInGroup: incidentGroup.monitorsInGroup,
                        isPreviewPage: StatusPageUtil.isPreviewPage(),
                        isSummary: true,
                      })}
                      isDetailItem={false}
                      key={`incident-${i}`}
                    />
                  );
                },
              )}
              {activeEpisodesInEpisodeGroup.map(
                (episodeGroup: EpisodeGroup, i: number) => {
                  return (
                    <EventItem
                      {...getEpisodeEventItem({
                        episode: episodeGroup.episode,
                        episodePublicNotes: episodeGroup.publicNotes || [],
                        episodeStateTimelines:
                          episodeGroup.episodeStateTimelines,
                        statusPageResources: episodeGroup.episodeResources,
                        monitorsInGroup: episodeGroup.monitorsInGroup,
                        isPreviewPage: StatusPageUtil.isPreviewPage(),
                        isSummary: true,
                        statusPageId: statusPageId || undefined,
                      })}
                      isDetailItem={false}
                      key={`episode-${i}`}
                    />
                  );
                },
              )}
            </div>
          )}

          {/* Load Active ScheduledEvent */}
          {activeScheduledMaintenanceEventsInScheduledMaintenanceGroup &&
            activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.length >
              0 && (
              <div id="scheduled-events-list mt-2">
                <Section title={t("overview.scheduledMaintenanceEvents")} />
                {activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.map(
                  (
                    scheduledEventGroup: ScheduledMaintenanceGroup,
                    i: number,
                  ) => {
                    return (
                      <EventItem
                        key={i}
                        {...getScheduledEventEventItem({
                          scheduledMaintenance:
                            scheduledEventGroup.scheduledMaintenance,
                          scheduledMaintenanceEventsPublicNotes:
                            scheduledEventGroup.publicNotes || [],
                          scheduledMaintenanceStateTimelines:
                            scheduledEventGroup.scheduledMaintenanceStateTimelines,
                          statusPageResources:
                            scheduledEventGroup.scheduledEventResources,
                          monitorsInGroup: scheduledEventGroup.monitorsInGroup,
                          isPreviewPage: StatusPageUtil.isPreviewPage(),
                          isSummary: true,
                        })}
                        isDetailItem={false}
                      />
                    );
                  },
                )}
              </div>
            )}

          {activeIncidentsInIncidentGroup.length === 0 &&
            activeEpisodesInEpisodeGroup.length === 0 &&
            activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.length ===
              0 &&
            statusPageResources.length === 0 &&
            activeAnnouncements.length === 0 &&
            !isLoading &&
            !error && (
              <EmptyState
                id="overview-empty-state"
                icon={IconProp.CheckCircle}
                title={t("overview.allClearTitle")}
                description={t("overview.allClearDescription")}
              />
            )}
        </div>
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Overview;
