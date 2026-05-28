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
import { translateStatusName } from "../../Utils/StatusTranslation";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import StatusPageResourceUptimeUtil from "Common/Utils/StatusPage/ResourceUptime";
import BadDataException from "Common/Types/Exception/BadDataException";
import UptimeBarTooltipIncident from "Common/Types/Monitor/UptimeBarTooltipIncident";
import Color from "Common/Types/Color";

const parseAxisValues: (raw?: string) => Array<string> = (
  raw?: string,
): Array<string> => {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value: string): string => {
      return value.trim();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
};

const tintFromHex: (hex: string, alpha: number) => string = (
  hex: string,
  alpha: number,
): string => {
  const cleaned: string = hex.replace("#", "").trim();
  if (cleaned.length !== 6) {
    return hex;
  }
  const r: number = parseInt(cleaned.substring(0, 2), 16);
  const g: number = parseInt(cleaned.substring(2, 4), 16);
  const b: number = parseInt(cleaned.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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
                  name: translateStatusName(incident.incidentSeverity.name),
                  color:
                    incident.incidentSeverity.color || new Color("#000000"),
                }
              : undefined,
            currentIncidentState: incident.currentIncidentState
              ? {
                  name: translateStatusName(incident.currentIncidentState.name),
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
            {translateStatusName(currentStatus?.name) ||
              t("overview.operational")}
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

  type GetCurrentStatusForResourceFunction = (
    resource: StatusPageResource,
  ) => MonitorStatus;

  const getCurrentStatusForResource: GetCurrentStatusForResourceFunction = (
    resource: StatusPageResource,
  ): MonitorStatus => {
    let currentStatus: MonitorStatus | undefined;

    if (resource.monitor) {
      currentStatus = monitorStatuses.find((status: MonitorStatus) => {
        return (
          status._id?.toString() ===
          resource.monitor?.currentMonitorStatusId?.toString()
        );
      });
    } else if (resource.monitorGroupId) {
      currentStatus = monitorStatuses.find((status: MonitorStatus) => {
        return (
          status._id?.toString() ===
          monitorGroupCurrentStatuses[
            resource.monitorGroupId?.toString() || ""
          ]?.toString()
        );
      });
    }

    if (!currentStatus) {
      currentStatus = new MonitorStatus();
      currentStatus.name = t("overview.operational");
      currentStatus.color = Green;
    }

    return currentStatus;
  };

  type GetGridForGroupFunction = (group: StatusPageGroup) => ReactElement;

  const getGridForGroup: GetGridForGroupFunction = (
    group: StatusPageGroup,
  ): ReactElement => {
    const rowValues: Array<string> = parseAxisValues(group.rowAxisValues);
    const columnValues: Array<string> = parseAxisValues(group.columnAxisValues);

    if (rowValues.length === 0 || columnValues.length === 0) {
      return (
        <div className="mb-5">
          <ErrorMessage
            message={t("overview.gridAxesNotConfigured", {
              defaultValue:
                "This group is set to grid view but no row or column values are configured.",
            })}
          />
        </div>
      );
    }

    const resourcesInGroup: Array<StatusPageResource> =
      statusPageResources.filter((resource: StatusPageResource) => {
        return resource.statusPageGroupId?.toString() === group._id?.toString();
      });

    type CellContent = {
      resources: Array<StatusPageResource>;
    };

    const cellByRowCol: Record<string, Record<string, CellContent>> = {};
    for (const rowValue of rowValues) {
      cellByRowCol[rowValue] = {};
      for (const colValue of columnValues) {
        cellByRowCol[rowValue]![colValue] = { resources: [] };
      }
    }

    for (const resource of resourcesInGroup) {
      const row: string | undefined = resource.rowAxisValue || undefined;
      const col: string | undefined = resource.columnAxisValue || undefined;

      if (!row || !col) {
        continue;
      }

      if (!cellByRowCol[row] || !cellByRowCol[row]![col]) {
        continue;
      }

      cellByRowCol[row]![col]!.resources.push(resource);
    }

    type CellMeta = {
      isEmpty: boolean;
      color: string | null;
      statusName: string;
      uptimeText: string | null;
      labels: Array<string>;
      resourceCount: number;
    };

    type ComputeCellMetaFunction = (cell: CellContent) => CellMeta;

    const computeCellMeta: ComputeCellMetaFunction = (
      cell: CellContent,
    ): CellMeta => {
      if (cell.resources.length === 0) {
        return {
          isEmpty: true,
          color: null,
          statusName: "",
          uptimeText: null,
          labels: [],
          resourceCount: 0,
        };
      }

      const statuses: Array<MonitorStatus> = cell.resources.map(
        (resource: StatusPageResource) => {
          return getCurrentStatusForResource(resource);
        },
      );

      const worstStatus: MonitorStatus =
        StatusPageResourceUptimeUtil.getWorstMonitorStatus({
          monitorStatuses: statuses,
        });

      const cellColor: string =
        worstStatus.color?.toString() || Green.toString();

      const showUptimePercent: boolean = cell.resources.some(
        (resource: StatusPageResource) => {
          return Boolean(resource.showUptimePercent);
        },
      );

      let uptimePercentText: string | null = null;
      if (showUptimePercent) {
        const uptimePercents: Array<number> = [];
        for (const resource of cell.resources) {
          const percent: number | null =
            StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
              statusPageResource: resource,
              monitorStatusTimelines: monitorStatusTimelines,
              precision:
                resource.uptimePercentPrecision || UptimePrecision.ONE_DECIMAL,
              downtimeMonitorStatuses:
                statusPage?.downtimeMonitorStatuses || [],
              monitorsInGroup: monitorsInGroup,
            });
          if (percent !== null) {
            uptimePercents.push(percent);
          }
        }
        if (uptimePercents.length > 0) {
          const avg: number =
            uptimePercents.reduce((a: number, b: number) => {
              return a + b;
            }, 0) / uptimePercents.length;
          uptimePercentText = `${avg.toFixed(2)}${t("overview.uptimeSuffix")}`;
        }
      }

      const labels: Array<string> = cell.resources.map(
        (resource: StatusPageResource) => {
          return resource.displayName || resource.monitor?.name || "";
        },
      );

      const statusName: string =
        translateStatusName(worstStatus?.name) || t("overview.operational");

      return {
        isEmpty: false,
        color: cellColor,
        statusName,
        uptimeText: uptimePercentText,
        labels,
        resourceCount: cell.resources.length,
      };
    };

    type RenderCellContentFunction = (meta: CellMeta) => ReactElement;

    const renderCellContent: RenderCellContentFunction = (
      meta: CellMeta,
    ): ReactElement => {
      if (meta.isEmpty) {
        return (
          <div
            className="flex items-center justify-center py-3.5"
            aria-hidden="true"
          >
            <span className="block w-3 h-0.5 bg-gray-200 rounded-full select-none" />
          </div>
        );
      }

      const color: string = meta.color!;

      return (
        <div
          className="flex flex-col items-center justify-center gap-1 px-2 py-3"
          title={meta.labels.join(", ")}
        >
          <div
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-transform group-hover:scale-[1.03]"
            style={{
              backgroundColor: "rgba(255,255,255,0.85)",
              boxShadow: `inset 0 0 0 1px ${tintFromHex(color, 0.25)}`,
            }}
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-40"
                style={{ backgroundColor: color }}
              />
              <span
                className="relative inline-flex rounded-full h-2 w-2"
                style={{ backgroundColor: color }}
              />
            </span>
            <span
              className="text-[11px] font-semibold tracking-tight"
              style={{ color: color }}
            >
              {meta.statusName}
            </span>
            {meta.resourceCount > 1 && (
              <span
                className="text-[10px] font-medium tabular-nums opacity-60"
                style={{ color: color }}
              >
                ×{meta.resourceCount}
              </span>
            )}
          </div>
          {meta.uptimeText && (
            <div className="text-[10.5px] text-gray-500 font-medium tabular-nums">
              {meta.uptimeText}
            </div>
          )}
        </div>
      );
    };

    const rowAxisDisplay: string =
      group.rowAxisLabel ||
      t("overview.gridRowAxisDefaultLabel", {
        defaultValue: "Resource",
      });

    type StatBucket = { color: string; count: number; label: string };

    const statBuckets: Map<string, StatBucket> = new Map();
    let totalCellsWithData: number = 0;
    let totalEmptyCells: number = 0;
    for (const row of rowValues) {
      for (const col of columnValues) {
        const cell: CellContent = cellByRowCol[row]![col]!;
        const meta: CellMeta = computeCellMeta(cell);
        if (meta.isEmpty) {
          totalEmptyCells++;
          continue;
        }
        totalCellsWithData++;
        const key: string = `${meta.statusName}|${meta.color}`;
        const existing: StatBucket | undefined = statBuckets.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          statBuckets.set(key, {
            color: meta.color!,
            count: 1,
            label: meta.statusName,
          });
        }
      }
    }
    const statEntries: Array<StatBucket> = Array.from(statBuckets.values());

    return (
      <div className="pt-1 pb-1">
        {(statEntries.length > 0 || totalEmptyCells > 0) && (
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mb-3 px-1 text-xs">
            {statEntries.map((stat: StatBucket, i: number) => {
              return (
                <div
                  key={`stat-${i}`}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stat.color }}
                    aria-hidden="true"
                  />
                  <span className="text-gray-700">
                    <span className="font-semibold tabular-nums">
                      {stat.count}
                    </span>
                    <span className="text-gray-500 ml-1">{stat.label}</span>
                  </span>
                </div>
              );
            })}
            {totalEmptyCells > 0 && totalCellsWithData > 0 && (
              <div className="inline-flex items-center gap-1.5">
                <span
                  className="block w-2 h-0.5 bg-gray-300 rounded-full flex-shrink-0"
                  aria-hidden="true"
                />
                <span className="text-gray-500">
                  <span className="font-semibold tabular-nums text-gray-600">
                    {totalEmptyCells}
                  </span>{" "}
                  not configured
                </span>
              </div>
            )}
          </div>
        )}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-[0_1px_2px_0_rgba(0,0,0,0.02)]">
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                {group.columnAxisLabel ? (
                  <tr>
                    <th className="bg-gradient-to-b from-gray-50 to-gray-50/80 px-4 pt-3 pb-1.5 min-w-[160px] border-r border-gray-200" />
                    <th
                      colSpan={columnValues.length}
                      className="bg-gradient-to-b from-gray-50 to-gray-50/80 px-4 pt-3 pb-1.5 text-center text-[10px] uppercase tracking-[0.18em] text-gray-400 font-semibold"
                    >
                      {group.columnAxisLabel}
                    </th>
                  </tr>
                ) : null}
                <tr>
                  <th className="sticky left-0 z-10 bg-gradient-to-b from-gray-50 to-gray-50/80 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 border-b border-r border-gray-200 min-w-[160px]">
                    {rowAxisDisplay}
                  </th>
                  {columnValues.map((col: string, i: number) => {
                    return (
                      <th
                        key={`col-${i}`}
                        className={`bg-gradient-to-b from-gray-50 to-gray-50/80 px-3 py-3 text-center text-sm font-semibold text-gray-900 border-b border-gray-200 min-w-[140px] ${
                          i < columnValues.length - 1
                            ? "border-r border-gray-100"
                            : ""
                        }`}
                      >
                        {col}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rowValues.map((row: string, rowIdx: number) => {
                  const isLast: boolean = rowIdx === rowValues.length - 1;
                  return (
                    <tr
                      key={`row-${rowIdx}`}
                      className="group transition-colors"
                    >
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 bg-white group-hover:bg-gray-50/80 px-4 py-3 text-left text-sm font-semibold text-gray-900 min-w-[140px] border-r border-gray-200 transition-colors ${
                          isLast ? "" : "border-b border-gray-100"
                        }`}
                      >
                        {row}
                      </th>
                      {columnValues.map((col: string, colIdx: number) => {
                        const cell: CellContent = cellByRowCol[row]![col]!;
                        const meta: CellMeta = computeCellMeta(cell);
                        const isLastCol: boolean =
                          colIdx === columnValues.length - 1;

                        return (
                          <td
                            key={`cell-${rowIdx}-${colIdx}`}
                            className={`align-middle text-center transition-colors ${
                              isLast ? "" : "border-b border-gray-100"
                            } ${isLastCol ? "" : "border-r border-gray-100"} ${
                              meta.isEmpty ? "group-hover:bg-gray-50/40" : ""
                            }`}
                            style={
                              meta.color
                                ? {
                                    backgroundColor: tintFromHex(
                                      meta.color,
                                      0.05,
                                    ),
                                  }
                                : undefined
                            }
                          >
                            {renderCellContent(meta)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
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
                  const rawStatusName: string = currentStatus.name || "";
                  const statusName: string =
                    translateStatusName(rawStatusName) || rawStatusName;
                  const isMaintenance: boolean =
                    rawStatusName.toLowerCase() === "maintenance";
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
            <div className="mt-5 mb-6 space-y-3 sm:space-y-5">
              {statusPageResources.filter((resources: StatusPageResource) => {
                return !resources.statusPageGroupId;
              }).length > 0 ? (
                <div className="bg-white pl-3 pr-3 sm:pl-5 sm:pr-5 rounded-xl shadow">
                  <Accordion
                    key={Math.random()}
                    title={undefined}
                    isLastElement={true}
                  >
                    {getMonitorOverviewListInGroup(null)}
                  </Accordion>
                </div>
              ) : (
                <></>
              )}
              {resourceGroups.length > 0 &&
                resourceGroups.map(
                  (resourceGroup: StatusPageGroup, i: number) => {
                    const isGrid: boolean =
                      resourceGroup.viewMode === StatusPageGroupViewMode.Grid;
                    const groupName: string = resourceGroup.name || "";
                    const rawDescription: string =
                      resourceGroup.description || "";
                    const description: string | undefined =
                      rawDescription &&
                      rawDescription.trim() !== groupName.trim()
                        ? rawDescription
                        : undefined;
                    return (
                      <div
                        key={i}
                        className="bg-white pl-3 pr-3 sm:pl-5 sm:pr-5 rounded-xl shadow"
                      >
                        <Accordion
                          rightElement={getCurrentGroupStatusElement({
                            group: resourceGroup,
                          })}
                          isInitiallyExpanded={
                            resourceGroup.isExpandedByDefault
                          }
                          isLastElement={true}
                          title={groupName}
                          titleClassName="text-base sm:text-lg font-semibold tracking-tight"
                          description={description}
                        >
                          {isGrid
                            ? getGridForGroup(resourceGroup)
                            : getMonitorOverviewListInGroup(resourceGroup)}
                        </Accordion>
                      </div>
                    );
                  },
                )}
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
