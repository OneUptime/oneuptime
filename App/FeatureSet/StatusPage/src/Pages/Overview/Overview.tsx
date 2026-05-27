import MonitorOverview from "../../Components/Monitor/MonitorOverview";
import Page from "../../Components/Page/Page";
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
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
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

/*
 * -------------------------------------------------------------------
 * GroupCard — a fully custom replacement for the legacy Accordion when
 * rendering status page groups. Gives complete design control over the
 * header layout, expand/collapse chevron, and animated content reveal.
 * -------------------------------------------------------------------
 */
interface GroupCardProps {
  title?: string | undefined;
  description?: string | undefined;
  rightElement?: ReactElement | undefined;
  defaultExpanded?: boolean | undefined;
  children: ReactElement | Array<ReactElement>;
}

const renderChildrenWithDividers: (
  children: ReactElement | Array<ReactElement>,
) => ReactElement = (
  children: ReactElement | Array<ReactElement>,
): ReactElement => {
  const flat: Array<React.ReactNode> = React.Children.toArray(children);
  if (flat.length <= 1) {
    return <div>{children}</div>;
  }
  return (
    <div>
      {flat.map((child: React.ReactNode, i: number) => {
        const isFirst: boolean = i === 0;
        const classes: string = isFirst
          ? ""
          : "mt-5 sm:mt-6 pt-5 sm:pt-6 border-t border-gray-100";
        return (
          <div key={i} className={classes}>
            {child}
          </div>
        );
      })}
    </div>
  );
};

const GroupCard: FunctionComponent<GroupCardProps> = (
  props: GroupCardProps,
): ReactElement => {
  const hasTitle: boolean = Boolean(props.title);
  const [isOpen, setIsOpen] = useState<boolean>(
    hasTitle ? Boolean(props.defaultExpanded) : true,
  );

  // No title (ungrouped resources): just a plain card with the content.
  if (!hasTitle) {
    return (
      <div className="rounded-2xl bg-white ring-1 ring-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          {renderChildrenWithDividers(props.children)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white ring-1 ring-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className="w-full flex items-center justify-between gap-3 px-5 sm:px-6 py-4 sm:py-5 hover:bg-gray-50/70 active:bg-gray-50 transition-colors text-left group"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 tracking-tight truncate">
            {props.title}
          </h3>
          {props.description ? (
            <p className="text-xs sm:text-sm text-gray-500 mt-1 leading-relaxed line-clamp-2 sm:line-clamp-1">
              {props.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {props.rightElement ? (
            <div className="text-sm">{props.rightElement}</div>
          ) : null}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className={`w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-transform duration-200 ${
              isOpen ? "rotate-180" : "rotate-0"
            }`}
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {isOpen ? (
        <div className="border-t border-gray-100 px-5 py-5 sm:px-6 sm:py-6">
          {renderChildrenWithDividers(props.children)}
        </div>
      ) : null}
    </div>
  );
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

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedTick, setLastUpdatedTick] = useState<number>(0);

  const [timelineIncidents, setTimelineIncidents] = useState<
    Array<UptimeBarTooltipIncident>
  >([]);

  StatusPageUtil.checkIfUserHasLoggedIn();

  const loadPage: (silent?: boolean) => Promise<void> = async (
    silent?: boolean,
  ): Promise<void> => {
    try {
      if (!StatusPageUtil.getStatusPageId()) {
        return;
      }
      if (!silent) {
        setIsLoading(true);
      }

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
      setLastUpdated(new Date());

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

  // Re-render the "Updated X ago" label every 30 seconds so it stays accurate.
  useEffect(() => {
    if (!lastUpdated) {
      return undefined;
    }
    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
      setLastUpdatedTick((tick: number): number => {
        return tick + 1;
      });
    }, 30000);
    return () => {
      clearInterval(intervalId);
    };
  }, [lastUpdated]);

  // Silently refresh page data every 60 seconds so the status stays live.
  useEffect(() => {
    if (isLoading || error) {
      return undefined;
    }
    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
      loadPage(true).catch((err: Error) => {
        // Soft-fail on background refresh; keep the existing data on screen.
        // eslint-disable-next-line no-console
        console.warn("Background status refresh failed:", err.message);
      });
    }, 60000);
    return () => {
      clearInterval(intervalId);
    };
  }, [isLoading, error]);

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

      const statusColor: string =
        currentStatus?.color?.toString() || Green.toString();

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
          <span
            className="inline-flex items-center font-semibold tabular-nums tracking-tight text-sm"
            style={{ color: statusColor }}
          >
            {uptimePercent}
            {t("overview.uptimeSuffix")}
          </span>
        );
      }

      if (data.group.showCurrentStatus) {
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase ring-1"
            style={{
              backgroundColor: tintFromHex(statusColor, 0.1),
              color: statusColor,
              borderColor: tintFromHex(statusColor, 0.22),
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: statusColor }}
              aria-hidden="true"
            />
            {translateStatusName(currentStatus?.name) ||
              t("overview.operational")}
          </span>
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

    type CellStats = {
      isEmpty: boolean;
      color: string;
      statusName: string;
      uptimePercentText: string | null;
      labels: Array<string>;
    };

    type ComputeCellStatsFn = (cell: CellContent) => CellStats;

    const computeCellStats: ComputeCellStatsFn = (
      cell: CellContent,
    ): CellStats => {
      if (cell.resources.length === 0) {
        return {
          isEmpty: true,
          color: Green.toString(),
          statusName: "",
          uptimePercentText: null,
          labels: [],
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

      return {
        isEmpty: false,
        color: cellColor,
        statusName:
          translateStatusName(worstStatus?.name) || t("overview.operational"),
        uptimePercentText,
        labels,
      };
    };

    type RenderCellFunction = (
      cell: CellContent,
      rowLabel: string,
      colLabel: string,
    ) => ReactElement;

    const renderCell: RenderCellFunction = (
      cell: CellContent,
      rowLabel: string,
      colLabel: string,
    ): ReactElement => {
      const stats: CellStats = computeCellStats(cell);

      if (stats.isEmpty) {
        return (
          <div
            className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 h-full min-h-[92px] flex items-center justify-center px-3 py-4"
            aria-label={`${rowLabel} / ${colLabel}: no data`}
          >
            <span className="text-xs text-gray-400 font-medium select-none">
              No data
            </span>
          </div>
        );
      }

      const cellTooltip: string = `${rowLabel} · ${colLabel}${
        stats.labels.length > 0 ? ` — ${stats.labels.join(", ")}` : ""
      }`;

      return (
        <div
          className="group relative rounded-xl px-4 py-3.5 h-full min-h-[92px] flex flex-col justify-between transition-shadow duration-200 cursor-default hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          style={{
            background: tintFromHex(stats.color, 0.07),
            boxShadow: `inset 0 0 0 1px ${tintFromHex(stats.color, 0.2)}`,
          }}
          title={cellTooltip}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: stats.color }}
              aria-hidden="true"
            />
            <span
              className="text-[10px] font-bold tracking-[0.08em] uppercase truncate"
              style={{ color: stats.color }}
            >
              {stats.statusName}
            </span>
          </div>
          <div className="mt-1.5">
            {stats.uptimePercentText ? (
              <div
                className="text-xl font-bold tracking-tight tabular-nums leading-none"
                style={{ color: stats.color }}
              >
                {stats.uptimePercentText}
              </div>
            ) : null}
            {cell.resources.length === 1 && stats.labels[0] ? (
              <div className="text-[11px] text-gray-500 truncate mt-1.5">
                {stats.labels[0]}
              </div>
            ) : null}
            {cell.resources.length > 1 ? (
              <div className="text-[11px] text-gray-500 mt-1.5">
                {cell.resources.length}{" "}
                {t("overview.monitorsLabel", {
                  defaultValue: "monitors",
                })}
              </div>
            ) : null}
          </div>
        </div>
      );
    };

    const rowAxisDisplay: string =
      group.rowAxisLabel ||
      t("overview.gridRowAxisDefaultLabel", {
        defaultValue: "Resource",
      });

    const gridTemplate: string = `minmax(140px, max-content) repeat(${columnValues.length}, minmax(150px, 1fr))`;
    const gridMinWidth: string = `${160 + columnValues.length * 160}px`;

    return (
      <div className="-mx-1 sm:-mx-2 pt-1 pb-2">
        {/* Column axis label as a centered divider */}
        {group.columnAxisLabel ? (
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="h-px bg-gradient-to-r from-transparent to-gray-200 flex-1" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold whitespace-nowrap">
              {group.columnAxisLabel}
            </span>
            <div className="h-px bg-gradient-to-l from-transparent to-gray-200 flex-1" />
          </div>
        ) : null}

        <div className="overflow-x-auto -mx-2 px-2 pb-1">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: gridTemplate,
              minWidth: gridMinWidth,
            }}
          >
            {/* Header row: corner + column labels */}
            <div className="sticky left-0 z-20 bg-white flex items-end px-3 pb-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400 font-bold">
                {rowAxisDisplay}
              </span>
            </div>
            {columnValues.map((col: string, i: number) => {
              return (
                <div
                  key={`col-${i}`}
                  className="flex items-end justify-center px-2 pb-2"
                >
                  <span className="text-sm font-semibold text-gray-800 tracking-tight truncate">
                    {col}
                  </span>
                </div>
              );
            })}

            {/* Body rows */}
            {rowValues.map((row: string, rowIdx: number) => {
              return (
                <React.Fragment key={`row-${rowIdx}`}>
                  <div className="sticky left-0 z-10 bg-white flex items-center px-4 py-3 rounded-xl ring-1 ring-gray-100 shadow-sm">
                    <span className="text-sm font-semibold text-gray-900 tracking-tight">
                      {row}
                    </span>
                  </div>
                  {columnValues.map((col: string, colIdx: number) => {
                    const cell: CellContent = cellByRowCol[row]![col]!;
                    return (
                      <div key={`cell-${rowIdx}-${colIdx}`}>
                        {renderCell(cell, row, col)}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
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

  // -------- Status hero computations --------
  type HeroState = {
    title: string;
    description: string;
    color: string;
    isOperational: boolean;
    serviceSummary: string;
  };

  const computeHeroState: () => HeroState | null = (): HeroState | null => {
    if (!currentStatus || statusPageResources.length === 0) {
      return null;
    }
    const rawStatusName: string = currentStatus.name || "";
    const statusName: string =
      translateStatusName(rawStatusName) || rawStatusName;
    const isMaintenance: boolean =
      rawStatusName.toLowerCase() === "maintenance";
    const isOperational: boolean = Boolean(currentStatus.isOperationalState);
    const color: string = currentStatus.color?.toString() || Green.toString();

    let title: string;
    let description: string;
    if (isOperational) {
      title = t("overview.allResourcesAre", { status: statusName });
      description = t("overview.allClearDescription", {
        defaultValue: "All resources are operating normally.",
      });
    } else if (isMaintenance) {
      title = t("overview.someResourcesAreUnder", { status: statusName });
      description = t("overview.maintenanceDescription", {
        defaultValue: "Some resources are undergoing maintenance.",
      });
    } else {
      title = t("overview.someResourcesAre", { status: statusName });
      description = t("overview.degradedDescription", {
        defaultValue: "Some resources are not operating normally. We're on it.",
      });
    }

    // Compute service operational counts.
    const downtimeStatusIds: Array<string> = (
      statusPage?.downtimeMonitorStatuses || []
    ).map((s: MonitorStatus): string => {
      return s.id?.toString() || "";
    });

    let operationalCount: number = 0;
    let totalCount: number = 0;
    for (const resource of statusPageResources) {
      let resourceStatusId: string | undefined;
      if (resource.monitor) {
        resourceStatusId = resource.monitor.currentMonitorStatusId?.toString();
      } else if (resource.monitorGroupId) {
        resourceStatusId =
          monitorGroupCurrentStatuses[
            resource.monitorGroupId?.toString() || ""
          ]?.toString();
      } else {
        continue;
      }
      totalCount += 1;
      const isResourceDown: boolean =
        resourceStatusId !== undefined &&
        downtimeStatusIds.includes(resourceStatusId);
      if (!isResourceDown) {
        operationalCount += 1;
      }
    }

    const serviceWord: string =
      totalCount === 1
        ? t("overview.serviceWordSingular", { defaultValue: "service" })
        : t("overview.serviceWordPlural", { defaultValue: "services" });
    let serviceSummary: string;
    if (totalCount === 0) {
      serviceSummary = "";
    } else if (operationalCount === totalCount) {
      serviceSummary = `${totalCount} ${serviceWord} operational`;
    } else {
      serviceSummary = `${operationalCount} of ${totalCount} ${serviceWord} operational`;
    }

    return {
      title,
      description,
      color,
      isOperational,
      serviceSummary,
    };
  };

  const heroState: HeroState | null = computeHeroState();

  // Overall uptime % across all resources, regardless of operational state.
  const overallUptimeText: string | null = (() => {
    if (!statusPage?.showOverallUptimePercentOnStatusPage) {
      return null;
    }
    if (statusPageResources.length === 0) {
      return null;
    }
    const value: number | null =
      StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources({
        monitorStatusTimelines: monitorStatusTimelines,
        statusPageResources: statusPageResources,
        downtimeMonitorStatuses: statusPage?.downtimeMonitorStatuses || [],
        precision:
          statusPage?.overallUptimePercentPrecision ||
          UptimePrecision.TWO_DECIMAL,
        resourceGroups: resourceGroups,
        monitorsInGroup: monitorsInGroup,
      });
    if (value === null || value === undefined) {
      return null;
    }
    return `${value}${t("overview.uptimeSuffix")}`;
  })();

  // Reference lastUpdatedTick so React re-renders this expression every 30s.
  const lastUpdatedLabel: string = (() => {
    void lastUpdatedTick;
    if (!lastUpdated) {
      return "";
    }
    return OneUptimeDate.fromNow(lastUpdated);
  })();

  // -------- Section header sub-component --------
  type SectionHeaderProps = {
    title: string;
    subtitle?: string;
    count?: number;
    accentColor?: string;
  };

  const SectionHeader: FunctionComponent<SectionHeaderProps> = (
    sectionProps: SectionHeaderProps,
  ): ReactElement => {
    return (
      <div className="mt-8 sm:mt-10 mb-3 sm:mb-4 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {sectionProps.accentColor ? (
              <span
                className="inline-block w-1 h-5 rounded-full"
                style={{ backgroundColor: sectionProps.accentColor }}
              />
            ) : null}
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight truncate">
              {sectionProps.title}
            </h2>
            {typeof sectionProps.count === "number" &&
            sectionProps.count > 0 ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                {sectionProps.count}
              </span>
            ) : null}
          </div>
          {sectionProps.subtitle ? (
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              {sectionProps.subtitle}
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <Page>
      {isLoading ? <PageLoader isVisible={true} /> : <></>}
      {error ? <ErrorMessage message={error} /> : <></>}

      {!isLoading && !error ? (
        <div
          data-testid="status-page-overview"
          className="w-full max-w-6xl mx-auto px-1 sm:px-2"
        >
          {/* Overview Page Description */}
          {statusPage && statusPage.overviewPageDescription && (
            <div
              id="status-page-description"
              className="bg-white px-5 py-4 sm:px-6 sm:py-5 my-4 sm:my-5 rounded-2xl ring-1 ring-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            >
              <MarkdownViewer text={statusPage.overviewPageDescription} />
            </div>
          )}

          {/* Load Active Announcement */}
          {activeAnnouncements.length > 0 ? (
            <div id="announcements-list" className="space-y-3">
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
          ) : null}

          {/* Status Hero */}
          {heroState ? (
            <div
              id="overview-status-hero"
              className="relative overflow-hidden rounded-2xl bg-white ring-1 ring-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] mt-4 sm:mt-5"
            >
              {/* Top status accent strip */}
              <div
                aria-hidden="true"
                className="h-1 w-full"
                style={{ backgroundColor: heroState.color }}
              />

              <div className="px-5 py-6 sm:px-8 sm:py-8">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5 sm:gap-8">
                  {/* Left: live dot + status text */}
                  <div className="flex items-start gap-3.5 sm:gap-4 min-w-0">
                    <span
                      className="relative flex shrink-0 mt-2 sm:mt-2.5"
                      aria-hidden="true"
                    >
                      <span
                        className="absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping"
                        style={{ backgroundColor: heroState.color }}
                      />
                      <span
                        className="relative inline-flex w-3 h-3 rounded-full"
                        style={{ backgroundColor: heroState.color }}
                      />
                    </span>
                    <div className="min-w-0">
                      <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-bold text-gray-900 tracking-tight leading-[1.15]">
                        {heroState.title}
                      </h1>
                      <p className="text-sm sm:text-base text-gray-500 mt-1.5 sm:mt-2 leading-relaxed">
                        {heroState.description}
                      </p>
                    </div>
                  </div>

                  {/* Right: Overall uptime metric */}
                  {overallUptimeText ? (
                    <div className="flex sm:flex-col items-baseline sm:items-end justify-between sm:justify-start gap-2 sm:gap-0 sm:text-right shrink-0 sm:pl-8 sm:border-l sm:border-gray-100 sm:min-w-[140px]">
                      <div className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight tabular-nums leading-none">
                        {overallUptimeText}
                      </div>
                      <div className="text-[10px] sm:text-[11px] text-gray-400 uppercase tracking-[0.16em] font-semibold sm:mt-2.5">
                        {uptimeHistoryDays}-day uptime
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Bottom strip: service summary + last updated */}
                <div className="mt-5 sm:mt-6 pt-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] sm:text-xs">
                  <div className="flex items-center gap-4 sm:gap-5 text-gray-400">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className="relative flex shrink-0">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300" />
                      </span>
                      <span className="uppercase tracking-[0.12em]">
                        {t("overview.live", { defaultValue: "Live" })}
                      </span>
                    </div>
                    {heroState.serviceSummary ? (
                      <div className="flex items-center gap-1.5">
                        <span className="hidden sm:inline text-gray-300">
                          ·
                        </span>
                        <span className="text-gray-500 font-medium">
                          {heroState.serviceSummary}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {lastUpdatedLabel ? (
                    <div className="text-gray-400">
                      <span className="hidden sm:inline">
                        {t("overview.updatedLabel", {
                          defaultValue: "Updated",
                        })}{" "}
                      </span>
                      <span className="font-semibold text-gray-600">
                        {lastUpdatedLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Section label above component cards */}
          {statusPageResources.length > 0 ? (
            <div className="mt-7 sm:mt-9 mb-3 sm:mb-4 px-1 flex items-center justify-between gap-3">
              <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-gray-400 font-bold">
                {t("overview.componentsLabel", {
                  defaultValue: "Components",
                })}
              </h2>
              <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-gray-400 font-semibold">
                {t("overview.componentsSubtitle", {
                  days: uptimeHistoryDays,
                  defaultValue: `${uptimeHistoryDays}-day history`,
                })}
              </span>
            </div>
          ) : null}

          {/* Component cards: ungrouped + per-group */}
          {statusPageResources.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              {statusPageResources.filter((resources: StatusPageResource) => {
                return !resources.statusPageGroupId;
              }).length > 0 ? (
                <GroupCard key="ungrouped">
                  {getMonitorOverviewListInGroup(null)}
                </GroupCard>
              ) : null}

              {resourceGroups.length > 0 &&
                resourceGroups.map(
                  (resourceGroup: StatusPageGroup, i: number) => {
                    const isGrid: boolean =
                      resourceGroup.viewMode === StatusPageGroupViewMode.Grid;
                    // Hide description when it duplicates the title.
                    const description: string | undefined =
                      resourceGroup.description &&
                      resourceGroup.description.trim() !==
                        (resourceGroup.name || "").trim()
                        ? resourceGroup.description
                        : undefined;
                    return (
                      <GroupCard
                        key={`group-${i}`}
                        title={resourceGroup.name}
                        description={description}
                        defaultExpanded={resourceGroup.isExpandedByDefault}
                        rightElement={getCurrentGroupStatusElement({
                          group: resourceGroup,
                        })}
                      >
                        {isGrid
                          ? getGridForGroup(resourceGroup)
                          : getMonitorOverviewListInGroup(resourceGroup)}
                      </GroupCard>
                    );
                  },
                )}
            </div>
          )}

          {/* Load Active Incidents and Episodes */}
          {(activeIncidentsInIncidentGroup.length > 0 ||
            activeEpisodesInEpisodeGroup.length > 0) && (
            <div id="incidents-list">
              <SectionHeader
                title={t("overview.activeIncidents")}
                subtitle={t("overview.activeIncidentsSubtitle", {
                  defaultValue:
                    "Ongoing issues that may affect service availability.",
                })}
                count={
                  activeIncidentsInIncidentGroup.length +
                  activeEpisodesInEpisodeGroup.length
                }
                accentColor="#ef4444"
              />
              <div className="space-y-3">
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
            </div>
          )}

          {/* Load Active ScheduledEvent */}
          {activeScheduledMaintenanceEventsInScheduledMaintenanceGroup &&
            activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.length >
              0 && (
              <div id="scheduled-events-list">
                <SectionHeader
                  title={t("overview.scheduledMaintenanceEvents")}
                  subtitle={t("overview.scheduledMaintenanceSubtitle", {
                    defaultValue:
                      "Planned maintenance windows that may affect availability.",
                  })}
                  count={
                    activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.length
                  }
                  accentColor="#3b82f6"
                />
                <div className="space-y-3">
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
                            monitorsInGroup:
                              scheduledEventGroup.monitorsInGroup,
                            isPreviewPage: StatusPageUtil.isPreviewPage(),
                            isSummary: true,
                          })}
                          isDetailItem={false}
                        />
                      );
                    },
                  )}
                </div>
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
              <div className="mt-5">
                <EmptyState
                  id="overview-empty-state"
                  icon={IconProp.CheckCircle}
                  title={t("overview.allClearTitle")}
                  description={t("overview.allClearDescription")}
                />
              </div>
            )}

          {/* Subtle page-level metadata footer */}
          {lastUpdatedLabel ? (
            <div
              id="overview-metadata-footer"
              className="mt-8 sm:mt-10 pt-4 sm:pt-5 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] sm:text-xs text-gray-400"
            >
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300" />
                <span>
                  {t("overview.autoRefreshHint", {
                    defaultValue: "Status refreshes automatically every minute",
                  })}
                </span>
              </div>
              <div>
                <span>
                  {t("overview.lastUpdatedFooter", {
                    defaultValue: "Last updated",
                  })}{" "}
                </span>
                <span className="font-semibold text-gray-600">
                  {lastUpdatedLabel}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Overview;
