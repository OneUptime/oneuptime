import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import Service from "Common/Models/DatabaseModels/Service";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import EntityType from "Common/Types/Telemetry/EntityType";
import { TopologyConnectionSection } from "Common/Types/Topology/TopologyApi";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import OneUptimeDate from "Common/Types/Date";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  formatCallRate,
  formatDurationMs,
  formatErrorRate,
  labelForRelationship,
  metaForEntityType,
} from "./TopologyMeta";
import {
  ServiceOperationalStatus,
  ServiceStatusItem,
} from "./OperationalOverlay";
import { TrafficTotals } from "./ServiceMapViewModel";
import { EntityDetailTarget } from "./TopologyData";
import {
  AppendedConnectionsPage,
  EntityConnection,
  EntityConnectionSection,
  EntityConnectionsPage,
  EntityDetail,
  EntityDetailData,
  EntityDetailErrorDescription,
  appendConnectionsPage,
  connectionId,
  describeEntityDetailError,
  fetchEntityConnections,
  fetchEntityDetail,
  pageSizeForSection,
  sectionReloadLimit,
} from "./EntityDetailApi";
import {
  TypedRowLink,
  resolveDatabaseServerLink,
} from "../Inventory/ResolveTypedRowLink";

/*
 * Right-hand detail drawer for anything on a topology map. It keeps the user
 * on the map and answers, in order: how is it doing, what does it call, what
 * calls it, where does it run, and where can I go next (inventory, traces,
 * the matching network device for a host).
 *
 * The caller hands over what it already knows (key, type, name), so the
 * header renders at once; the drawer then asks the server for the entity's
 * full row and its connections, classified and counted over the whole
 * inventory.
 *
 * Callers keep ONE drawer mounted while the user moves from entity to
 * entity (a connection row, another map node): no `key` per entity. A
 * remount would tear down the side-over, replay its slide-in, and drop
 * keyboard focus to <body> with the row that had it. So the drawer handles
 * a changed entity itself: it never shows rows fetched for another entity
 * or range, aborts what the previous entity still had in flight, tags its
 * best-effort links with the row they belong to, and moves focus to the top
 * of its content when focus was in the drawer (or lost), so keyboard users
 * stay in it and screen readers announce the new entity.
 */

export interface EntityTrafficSummary {
  inbound: TrafficTotals;
  outbound: TrafficTotals;
  statusLabel: string;
  statusColor: string;
  subtitle: string;
}

export interface ComponentProps {
  /** What the caller already knows about the entity; the header uses it. */
  entity: EntityDetailTarget;
  /*
   * The range start the map was drawn with (the server's echo): the drawer
   * counts the relationships reported since then. Until the page has one the
   * drawer keeps showing its loading state rather than guess a range.
   */
  rangeStart: Date | null | undefined;
  /** Service Map traffic for this node. */
  traffic?: EntityTrafficSummary | undefined;
  /** Active incidents/alerts affecting this service (Service Map overlay). */
  incidentStatus?: ServiceOperationalStatus | null | undefined;
  /** Seconds the depends-on metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
  onClose: () => void;
  /** Show the entity on the map. The button is hidden when absent. */
  onFocus?: ((entityKey: string) => void) | undefined;
  focusButtonLabel?: string | undefined;
  /** Open another entity's details (a connection row was chosen). */
  onSelectEntity?: ((target: EntityDetailTarget) => void) | undefined;
  /** Open a resource in the Infrastructure view. */
  onOpenInfrastructure?: ((entityKey: string) => void) | undefined;
}

interface SectionConfig {
  section: TopologyConnectionSection;
  title: string;
  testId: string;
  showMetrics: boolean;
  /* Rows open in the Infrastructure view when the page offers it. */
  infrastructureLinks: boolean;
  /* Say how many rows point at resources no longer in inventory. */
  reportsUnknown: boolean;
}

const SECTIONS: Array<SectionConfig> = [
  {
    section: "calls",
    title: "Calls",
    testId: "entity-detail-calls",
    showMetrics: true,
    infrastructureLinks: false,
    reportsUnknown: false,
  },
  {
    section: "calledBy",
    title: "Called by",
    testId: "entity-detail-called-by",
    showMetrics: true,
    infrastructureLinks: false,
    reportsUnknown: false,
  },
  {
    section: "runsOn",
    title: "Runs on",
    testId: "entity-detail-runs-on",
    showMetrics: false,
    infrastructureLinks: true,
    reportsUnknown: true,
  },
  {
    section: "related",
    title: "Related infrastructure",
    testId: "entity-detail-related",
    showMetrics: false,
    infrastructureLinks: false,
    reportsUnknown: true,
  },
];

type SectionFlags<T> = Partial<Record<TopologyConnectionSection, T>>;

/*
 * A section's own requests: "more" appends the next page ("Show more"),
 * "reload" refetches the section from its start ("Reload list").
 */
type SectionAction = "more" | "reload";

interface SectionError extends EntityDetailErrorDescription {
  action: SectionAction;
}

interface DrawerState {
  /* Which request this state answers: entity key, type and range start. */
  requestKey: string;
  status: "loading" | "ready" | "error";
  data: EntityDetailData | null;
  error: EntityDetailErrorDescription | null;
  /* Sections with a request of their own in flight, and which. */
  loadingMore: SectionFlags<SectionAction>;
  /* The last failed section request, per section. */
  moreErrors: SectionFlags<SectionError>;
  /*
   * Sections whose list changed on the server while the user paged it, so
   * rows may be missing (see appendConnectionsPage): they offer a reload.
   */
  changedSections: SectionFlags<boolean>;
  /*
   * What a section request wants focused once rendered: a row it added, the
   * section's "Reload list", or the top of the drawer (FOCUS_TOP).
   */
  focusId: string | null;
}

const FOCUS_TOP: string = "top";

function reloadFocusId(section: TopologyConnectionSection): string {
  return `reload:${section}`;
}

/* Best-effort links, tagged with the row they were resolved for. */
interface ResolvedLink<T> {
  forId: string;
  value: T;
}

/*
 * Descriptive attributes worth a line in the drawer, in display order.
 *
 * This is a summary, so it is deliberately narrower than the item's own
 * Attributes card, which shows every descriptive attribute we hold. But
 * it must not tell a different story about the same machine, so the host
 * asset facts belong here too. `os.description` and `host.id` stay out:
 * both are long, and neither reads at a glance.
 */
const DETAIL_ATTRIBUTES: Array<{ key: string; label: string }> = [
  { key: "telemetry.sdk.language", label: "Language" },
  { key: "db.system.name", label: "Database engine" },
  { key: "network.protocol.name", label: "Protocol" },
  { key: "k8s.pod.name", label: "Pod name" },
  { key: "k8s.node.name", label: "Node" },
  { key: "os.type", label: "Operating system" },
  { key: "host.arch", label: "Architecture" },
  { key: "host.ip", label: "IP Address" },
  { key: "device.manufacturer", label: "Manufacturer" },
  { key: "device.model.name", label: "Model Name" },
  { key: "host.serial_number", label: "Serial Number" },
  { key: "cloud.provider", label: "Cloud provider" },
  { key: "cloud.region", label: "Region" },
];

function normalizeHostName(value: string | undefined): string {
  if (!value) {
    return "";
  }
  // "host/web-1.example.com" and "WEB-1" should both match "web-1".
  const withoutPrefix: string = value.toLowerCase().replace(/^host\//, "");
  return withoutPrefix.split(".")[0] || withoutPrefix;
}

function loadingState(requestKey: string): DrawerState {
  return {
    requestKey: requestKey,
    status: "loading",
    data: null,
    error: null,
    loadingMore: {},
    moreErrors: {},
    changedSections: {},
    focusId: null,
  };
}

/* Fixed copy (outdated bundle, busy server) is translated; the rest is not. */
function errorDetail(
  error: EntityDetailErrorDescription,
  t: (value: string) => string,
): string {
  return error.isOutdated || error.isBusy ? t(error.detail) : error.detail;
}

function withFlag<T>(
  flags: SectionFlags<T>,
  section: TopologyConnectionSection,
  value: T | null,
): SectionFlags<T> {
  const next: SectionFlags<T> = { ...flags };
  if (value === null) {
    delete next[section];
  } else {
    next[section] = value;
  }
  return next;
}

/* "1,234", or "1,234+" when the server stopped counting early. */
function formatTotal(total: number, isScanLimited: boolean): string {
  return `${total.toLocaleString()}${isScanLimited ? "+" : ""}`;
}

/* The database-link resolver reads an inventory row; hand it the full one. */
function toInventoryItem(entity: EntityDetail): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = entity.entityKey;
  item.entityType = entity.entityType as EntityType;
  if (entity.displayName) {
    item.displayName = entity.displayName;
  }
  if (entity.identifyingAttributes) {
    item.identifyingAttributes = entity.identifyingAttributes;
  }
  if (entity.descriptiveAttributes) {
    item.descriptiveAttributes = entity.descriptiveAttributes;
  }
  return item;
}

/** One active incident/alert row: title link + severity line. */
function renderStatusItem(
  item: ServiceStatusItem,
  viewRoute: Route,
  fallbackColor: string,
): ReactElement {
  return (
    <li key={item.id} className="py-2">
      <Link
        to={RouteUtil.populateRouteParams(viewRoute, {
          modelId: new ObjectID(item.id),
        })}
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        {item.title}
      </Link>
      {item.severityName ? (
        <p
          className="mt-0.5 text-xs font-medium"
          style={{ color: item.severityColor || fallbackColor }}
        >
          {item.severityName}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
}

const EntityDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };
  const entityKey: string = props.entity.entityKey;
  const previewType: string | undefined = props.entity.entityType;
  const rangeStartMs: number | null =
    props.rangeStart && !Number.isNaN(props.rangeStart.getTime())
      ? props.rangeStart.getTime()
      : null;
  const requestKey: string = JSON.stringify([
    entityKey,
    previewType || "",
    rangeStartMs,
  ]);

  const [state, setState] = useState<DrawerState>(() => {
    return loadingState(requestKey);
  });
  const [attempt, setAttempt] = useState<number>(0);
  /*
   * The full row the best-effort links are resolved from. It survives a
   * reload of the same entity (a new range), so the links resolve once per
   * row rather than once per request.
   */
  const [linkSource, setLinkSource] = useState<EntityDetail | null>(null);
  const [serviceLink, setServiceLink] = useState<ResolvedLink<string> | null>(
    null,
  );
  const [databaseLink, setDatabaseLink] =
    useState<ResolvedLink<TypedRowLink> | null>(null);
  const [matchedDevice, setMatchedDevice] =
    useState<ResolvedLink<NetworkDevice> | null>(null);
  const moreControllers: React.MutableRefObject<
    Map<TopologyConnectionSection, AbortController>
  > = useRef<Map<TopologyConnectionSection, AbortController>>(
    new Map<TopologyConnectionSection, AbortController>(),
  );
  /* Rows and "Reload list" buttons a section request may move focus to. */
  const focusables: React.MutableRefObject<Map<string, HTMLElement>> = useRef<
    Map<string, HTMLElement>
  >(new Map<string, HTMLElement>());
  /* The drawer's content, and the focus target at its top. */
  const contentRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const focusTargetRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  /* The entity focus was last settled for (the first one needs nothing). */
  const focusedEntityKey: React.MutableRefObject<string> =
    useRef<string>(entityKey);

  /*
   * Only a state that answers the current request is shown: until the
   * effect below has reset it, a changed entity or range reads as loading
   * instead of flashing the previous entity's rows.
   */
  const current: DrawerState | null =
    state.requestKey === requestKey ? state : null;
  const status: DrawerState["status"] = current ? current.status : "loading";
  const data: EntityDetailData | null =
    current && current.status === "ready" ? current.data : null;
  const fullEntity: EntityDetail | null = data ? data.entity : null;
  const isMissing: boolean = Boolean(data && !data.entity);

  useEffect(() => {
    const controllers: Map<TopologyConnectionSection, AbortController> =
      moreControllers.current;
    setState((previous: DrawerState): DrawerState => {
      return previous.requestKey === requestKey &&
        previous.status === "loading" &&
        !previous.data
        ? previous
        : loadingState(requestKey);
    });

    if (rangeStartMs === null) {
      return undefined;
    }

    const controller: AbortController = new AbortController();
    const target: EntityDetailTarget = {
      entityKey: entityKey,
      entityType: previewType,
    };

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const loaded: EntityDetailData = await fetchEntityDetail(
          target,
          new Date(rangeStartMs),
          { signal: controller.signal },
        );
        if (controller.signal.aborted) {
          return;
        }
        setState((previous: DrawerState): DrawerState => {
          if (previous.requestKey !== requestKey) {
            return previous;
          }
          return { ...loadingState(requestKey), status: "ready", data: loaded };
        });
        if (loaded.entity) {
          const entity: EntityDetail = loaded.entity;
          setLinkSource((previous: EntityDetail | null): EntityDetail => {
            return previous && previous.id === entity.id ? previous : entity;
          });
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        setState((previous: DrawerState): DrawerState => {
          if (previous.requestKey !== requestKey) {
            return previous;
          }
          return {
            ...loadingState(requestKey),
            status: "error",
            error: describeEntityDetailError(error),
          };
        });
      }
    };
    void load();

    return () => {
      controller.abort();
      for (const pending of controllers.values()) {
        pending.abort();
      }
      controllers.clear();
    };
  }, [requestKey, attempt]);

  /*
   * Service entities: the traces link needs the Service row id. The
   * registry stamps the (resourceType, resourceId) pointer at reconcile
   * time — use it directly; fall back to a by-name lookup only for rows
   * written before the pointer existed.
   *
   * This and the two lookups below run from the FULL row, once per row:
   * the preview a map hands over has no attributes or resource pointer.
   */
  const linkSourceId: string | null = linkSource?.id || null;

  useEffect(() => {
    let cancelled: boolean = false;
    const entity: EntityDetail | null = linkSource;
    if (
      entity &&
      entity.id &&
      entity.entityType === EntityType.Service &&
      entity.displayName
    ) {
      if (entity.resourceType === "Service" && entity.resourceId) {
        setServiceLink({ forId: entity.id, value: entity.resourceId });
      } else {
        const load: () => Promise<void> = async (): Promise<void> => {
          try {
            const result: ListResult<Service> = await ModelAPI.getList<Service>(
              {
                modelType: Service,
                query: {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  name: entity.displayName!,
                },
                select: { _id: true },
                sort: {},
                skip: 0,
                limit: 1,
              },
            );
            if (!cancelled && result.data[0]?._id) {
              setServiceLink({
                forId: entity.id,
                value: result.data[0]._id.toString(),
              });
            }
          } catch {
            // Best-effort deep link; the panel works without it.
          }
        };
        void load();
      }
    }
    return () => {
      cancelled = true;
    };
  }, [linkSourceId]);

  /*
   * Database entities: the Databases product page of the server that owns
   * the endpoint this node names — its own port when it has one, else the
   * engine default, else the one database on that host (any port, or a
   * single-label Kubernetes name in any namespace). See ResolveTypedRowLink.
   */
  useEffect(() => {
    let cancelled: boolean = false;
    const entity: EntityDetail | null = linkSource;
    if (entity && entity.id && entity.entityType === EntityType.Database) {
      const load: () => Promise<void> = async (): Promise<void> => {
        const link: TypedRowLink | null = await resolveDatabaseServerLink(
          toInventoryItem(entity),
        );
        if (!cancelled && link) {
          setDatabaseLink({ forId: entity.id, value: link });
        }
      };
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [linkSourceId]);

  // Host entities: find a network device with the same hostname/sysName.
  useEffect(() => {
    let cancelled: boolean = false;
    const entity: EntityDetail | null = linkSource;
    const hostKey: string = normalizeHostName(entity?.displayName);
    if (
      entity &&
      entity.id &&
      entity.entityType === EntityType.Host &&
      hostKey
    ) {
      const load: () => Promise<void> = async (): Promise<void> => {
        try {
          const result: ListResult<NetworkDevice> =
            await ModelAPI.getList<NetworkDevice>({
              modelType: NetworkDevice,
              query: { projectId: ProjectUtil.getCurrentProjectId()! },
              select: { _id: true, name: true, hostname: true, sysName: true },
              sort: {},
              skip: 0,
              limit: 500,
            });
          const match: NetworkDevice | undefined = result.data.find(
            (device: NetworkDevice) => {
              return (
                normalizeHostName(device.hostname) === hostKey ||
                normalizeHostName(device.sysName) === hostKey ||
                normalizeHostName(device.name) === hostKey
              );
            },
          );
          if (!cancelled && match) {
            setMatchedDevice({ forId: entity.id, value: match });
          }
        } catch {
          // Cross-layer link is best-effort.
        }
      };
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [linkSourceId]);

  /*
   * Another entity in the same drawer (a connection row was opened, or
   * another node was clicked). The row that had focus is gone with the
   * previous entity's sections, which leaves focus on <body>; move it to
   * the top of the drawer so keyboard users stay in it and screen readers
   * announce the new entity. Focus the user put elsewhere (the map, the
   * search box) stays there. The first entity needs nothing: opening the
   * drawer keeps the behaviour of whatever opened it.
   */
  useEffect(() => {
    if (focusedEntityKey.current === entityKey) {
      return;
    }
    focusedEntityKey.current = entityKey;
    const target: HTMLDivElement | null = focusTargetRef.current;
    if (!target) {
      return;
    }
    const active: Element | null = document.activeElement;
    const drawer: Element | null =
      contentRef.current?.closest('[role="dialog"]') || contentRef.current;
    if (
      !active ||
      active === document.body ||
      Boolean(drawer && drawer.contains(active))
    ) {
      target.focus();
    }
  }, [entityKey]);

  /*
   * After a section request, move focus to what it asked for: the first row
   * "Show more" added, "Reload list" when the list changed under the user,
   * or the top of the drawer when what had focus is gone.
   */
  useEffect(() => {
    if (!state.focusId) {
      return;
    }
    const element: HTMLElement | undefined =
      state.focusId === FOCUS_TOP
        ? undefined
        : focusables.current.get(state.focusId);
    if (element) {
      const button: HTMLButtonElement | null =
        element instanceof HTMLButtonElement
          ? element
          : element.querySelector("button");
      (button || element).focus();
    } else {
      focusTargetRef.current?.focus();
    }
    setState((previous: DrawerState): DrawerState => {
      return previous.focusId ? { ...previous, focusId: null } : previous;
    });
  }, [state.focusId]);

  const registerFocusable: (
    id: string,
  ) => (element: HTMLElement | null) => void = (
    id: string,
  ): ((element: HTMLElement | null) => void) => {
    return (element: HTMLElement | null): void => {
      if (element) {
        focusables.current.set(id, element);
      } else {
        focusables.current.delete(id);
      }
    };
  };

  /*
   * A section's own request: "more" appends the page after the rows shown;
   * "reload" refetches the section from its start, as many rows as it
   * showed plus a page, and replaces it.
   */
  const loadSection: (
    section: TopologyConnectionSection,
    action: SectionAction,
  ) => Promise<void> = async (
    section: TopologyConnectionSection,
    action: SectionAction,
  ): Promise<void> => {
    if (!data || !fullEntity || rangeStartMs === null) {
      return;
    }
    const shown: EntityConnectionSection = data.sections[section];
    const offset: number | null = action === "reload" ? 0 : shown.nextOffset;
    if (offset === null || current?.loadingMore[section]) {
      return;
    }
    const limit: number =
      action === "reload"
        ? sectionReloadLimit(section, shown.rows.length)
        : pageSizeForSection(section);
    const key: string = requestKey;
    moreControllers.current.get(section)?.abort();
    const controller: AbortController = new AbortController();
    moreControllers.current.set(section, controller);
    setState((previous: DrawerState): DrawerState => {
      if (previous.requestKey !== key) {
        return previous;
      }
      return {
        ...previous,
        loadingMore: withFlag<SectionAction>(
          previous.loadingMore,
          section,
          action,
        ),
        moreErrors: withFlag<SectionError>(previous.moreErrors, section, null),
      };
    });

    try {
      const page: EntityConnectionsPage = await fetchEntityConnections(
        { entityKey: entityKey, entityType: previewType },
        new Date(rangeStartMs),
        section,
        offset,
        limit,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        return;
      }
      setState((previous: DrawerState): DrawerState => {
        if (previous.requestKey !== key || !previous.data) {
          return previous;
        }
        let next: EntityConnectionSection;
        let changed: boolean;
        let focusId: string | null;
        if (action === "reload") {
          next = page.connections;
          changed = false;
          const first: EntityConnection | undefined = next.rows[0];
          focusId = first ? connectionId(section, first) : FOCUS_TOP;
        } else {
          const appended: AppendedConnectionsPage = appendConnectionsPage(
            section,
            previous.data.sections[section],
            page.connections,
          );
          next = appended.merged;
          changed =
            Boolean(previous.changedSections[section]) || appended.listChanged;
          const last: EntityConnection | undefined =
            next.rows[next.rows.length - 1];
          /*
           * The first new row; else, when the list changed, its reload;
           * else, when "Show more" is gone, the last row.
           */
          focusId =
            appended.firstNewRowId ||
            (changed ? reloadFocusId(section) : null) ||
            (next.nextOffset === null && last
              ? connectionId(section, last)
              : null);
        }
        return {
          ...previous,
          data: {
            ...previous.data,
            sections: {
              ...previous.data.sections,
              [section]: next,
            },
            isScanLimited: previous.data.isScanLimited || page.isScanLimited,
          },
          loadingMore: withFlag<SectionAction>(
            previous.loadingMore,
            section,
            null,
          ),
          changedSections: withFlag<boolean>(
            previous.changedSections,
            section,
            changed ? true : null,
          ),
          focusId: focusId,
        };
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      const described: EntityDetailErrorDescription =
        describeEntityDetailError(error);
      setState((previous: DrawerState): DrawerState => {
        if (previous.requestKey !== key) {
          return previous;
        }
        return {
          ...previous,
          loadingMore: withFlag<SectionAction>(
            previous.loadingMore,
            section,
            null,
          ),
          moreErrors: withFlag<SectionError>(previous.moreErrors, section, {
            ...described,
            action: action,
          }),
        };
      });
    } finally {
      if (moreControllers.current.get(section) === controller) {
        moreControllers.current.delete(section);
      }
    }
  };

  const entityType: string | undefined = fullEntity?.entityType || previewType;
  const displayName: string =
    fullEntity?.displayName ||
    props.entity.displayName ||
    /*
     * A deep link knows only the key: show it while the row loads (and if
     * the row is gone) rather than calling a named resource "unnamed".
     */
    (fullEntity ? t("Unnamed entity") : entityKey || t("Unnamed entity"));
  const typeMeta: { label: string; color: string } =
    metaForEntityType(entityType);

  const renderTraffic: (
    title: string,
    totals: TrafficTotals,
  ) => ReactElement = (title: string, totals: TrafficTotals): ReactElement => {
    return (
      <div className="rounded-lg border border-gray-200 px-3 py-2.5">
        <p className="text-xs font-medium text-gray-500">{t(title)}</p>
        {totals.calls > 0 ? (
          <div className="mt-1 grid grid-cols-3 gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {formatCallRate(totals.calls, props.metricsWindowSeconds)}
              </p>
              <p className="text-[11px] text-gray-400">{t("requests")}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {formatErrorRate(totals.calls, totals.errors)}
              </p>
              <p className="text-[11px] text-gray-400">{t("errors")}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {totals.avgDurationMs === null
                  ? "—"
                  : formatDurationMs(totals.avgDurationMs)}
              </p>
              <p className="text-[11px] text-gray-400">{t("avg latency")}</p>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-500">{t("None observed")}</p>
        )}
      </div>
    );
  };

  const renderRow: (
    config: SectionConfig,
    row: EntityConnection,
  ) => ReactElement = (
    config: SectionConfig,
    row: EntityConnection,
  ): ReactElement => {
    const id: string = connectionId(config.section, row);
    const otherLabel: string =
      row.otherName ||
      (row.otherKnown ? t("Unnamed resource") : t("Undiscovered resource"));
    const verb: string = t(labelForRelationship(row.relationshipType));
    const sentence: string =
      row.direction === "out"
        ? `${displayName} ${verb} ${otherLabel}`
        : `${otherLabel} ${verb} ${displayName}`;
    const hasMetrics: boolean = Boolean(
      config.showMetrics && row.callCount && row.callCount > 0,
    );
    const typeLabel: string = row.otherType
      ? metaForEntityType(row.otherType).label
      : "";
    /*
     * Only a resource in inventory can be opened; the other end of a
     * relationship nothing reported is plain text, never a broken action.
     */
    let open: (() => void) | null = null;
    if (row.otherKnown) {
      if (config.infrastructureLinks && props.onOpenInfrastructure) {
        const openInfrastructure: (entityKey: string) => void =
          props.onOpenInfrastructure;
        open = () => {
          openInfrastructure(row.otherKey);
        };
      } else if (props.onSelectEntity) {
        const selectEntity: (target: EntityDetailTarget) => void =
          props.onSelectEntity;
        open = () => {
          selectEntity({
            entityKey: row.otherKey,
            entityType: row.otherType,
            displayName: row.otherName,
          });
        };
      }
    }
    return (
      <li
        key={id}
        className="rounded-md py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        tabIndex={-1}
        ref={registerFocusable(id)}
      >
        {open ? (
          <button
            type="button"
            className="w-full rounded-md text-left text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label={`${t("View details for")} ${otherLabel}`}
            onClick={open}
          >
            {sentence} <span aria-hidden={true}>→</span>
          </button>
        ) : (
          <p className="text-sm text-gray-900">{sentence}</p>
        )}
        {(hasMetrics || typeLabel) && (
          <p className="mt-0.5 text-xs text-gray-500">
            {typeLabel ? t(typeLabel) : ""}
            {typeLabel && hasMetrics ? " · " : ""}
            {hasMetrics
              ? `${formatCallRate(row.callCount!, props.metricsWindowSeconds)} · ${formatErrorRate(row.callCount, row.errorCount)} errors · avg ${formatDurationMs(row.avgDurationMs)}`
              : ""}
          </p>
        )}
      </li>
    );
  };

  const renderSection: (
    config: SectionConfig,
    loaded: EntityDetailData,
  ) => ReactElement | null = (
    config: SectionConfig,
    loaded: EntityDetailData,
  ): ReactElement | null => {
    const section: EntityConnectionSection = loaded.sections[config.section];
    if (section.total === 0 && section.rows.length === 0) {
      return null;
    }
    const title: string = t(config.title);
    const pending: SectionAction | undefined =
      current?.loadingMore[config.section];
    const moreError: SectionError | undefined =
      current?.moreErrors[config.section];
    /*
     * A server in another format fails every further page the same way:
     * offer the page reload instead of controls that cannot work.
     */
    const isOutdated: boolean = Boolean(moreError?.isOutdated);
    const listChanged: boolean =
      Boolean(current?.changedSections[config.section]) && !isOutdated;
    const actionClassName: string =
      "rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-wait disabled:text-gray-400";
    return (
      <div key={config.section} data-testid={config.testId}>
        <h3 className="text-sm font-semibold text-gray-900">
          {title} ({formatTotal(section.total, loaded.isScanLimited)})
        </h3>
        {config.reportsUnknown && section.unknownTotal > 0 && (
          <p className="mt-0.5 text-xs text-gray-500">
            {section.unknownTotal.toLocaleString()}{" "}
            {t("no longer in inventory")}
          </p>
        )}
        <ul className="mt-1 divide-y divide-gray-100">
          {section.rows.map((row: EntityConnection): ReactElement => {
            return renderRow(config, row);
          })}
        </ul>
        {moreError && (
          <div role="alert" className="mt-1 text-xs text-red-600">
            <p>
              {moreError.action === "reload"
                ? t("Could not reload this list.")
                : t("Could not load more connections.")}
              {moreError.detail ? ` ${errorDetail(moreError, t)}` : ""}
            </p>
            {isOutdated && (
              <button
                type="button"
                className={`mt-1 ${actionClassName}`}
                onClick={() => {
                  Navigation.reload();
                }}
              >
                {t("Reload page")}
              </button>
            )}
          </div>
        )}
        {listChanged && (
          <div
            className="mt-1 flex items-center justify-between gap-2"
            data-testid={`${config.testId}-changed`}
          >
            <p className="text-xs text-amber-700">
              {t("This list changed while you were browsing.")}
            </p>
            <button
              type="button"
              className={actionClassName}
              aria-label={`${t("Reload list")}: ${title}`}
              disabled={Boolean(pending)}
              aria-busy={pending === "reload"}
              ref={registerFocusable(reloadFocusId(config.section))}
              onClick={() => {
                void loadSection(config.section, "reload");
              }}
            >
              {pending === "reload" ? t("Loading…") : t("Reload list")}
            </button>
          </div>
        )}
        {section.nextOffset !== null && !isOutdated && (
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              {t("Showing")} {section.rows.length.toLocaleString()} {t("of")}{" "}
              {formatTotal(section.total, loaded.isScanLimited)}
            </p>
            <button
              type="button"
              className={actionClassName}
              aria-label={`${t("Show more")}: ${title}`}
              disabled={Boolean(pending)}
              aria-busy={pending === "more"}
              onClick={() => {
                void loadSection(config.section, "more");
              }}
            >
              {pending === "more" ? t("Loading…") : t("Show more")}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderConnections: () => ReactElement = (): ReactElement => {
    if (status === "error") {
      const error: EntityDetailErrorDescription | null = current?.error || null;
      return (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5"
        >
          <p className="text-sm font-medium text-red-800">
            {t("Could not load this resource's connections.")}
          </p>
          {error?.detail ? (
            <p className="mt-0.5 text-xs text-red-700">
              {errorDetail(error, t)}
            </p>
          ) : (
            <></>
          )}
          <div className="mt-2">
            {error?.isOutdated ? (
              /*
               * The server speaks another format than this bundle: asking
               * again gets the same answer, only the matching bundle helps.
               */
              <Button
                title={t("Reload page")}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  Navigation.reload();
                }}
              />
            ) : (
              <Button
                title={t("Try again")}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  setAttempt((previous: number): number => {
                    return previous + 1;
                  });
                }}
              />
            )}
          </div>
        </div>
      );
    }

    if (!data) {
      return (
        <div
          role="status"
          aria-busy={true}
          aria-live="polite"
          data-testid="entity-detail-loading"
        >
          <span className="sr-only">{t("Loading connections…")}</span>
          <div className="space-y-3" aria-hidden={true}>
            <div className="h-4 w-32 animate-pulse rounded bg-gray-100"></div>
            <div className="h-4 w-full animate-pulse rounded bg-gray-100"></div>
            <div className="h-4 w-5/6 animate-pulse rounded bg-gray-100"></div>
            <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100"></div>
          </div>
        </div>
      );
    }

    const sections: Array<ReactElement> = [];
    for (const config of SECTIONS) {
      const rendered: ReactElement | null = renderSection(config, data);
      if (rendered) {
        sections.push(rendered);
      }
    }

    return (
      <>
        {data.isScanLimited && (
          <p
            className="text-xs text-gray-500"
            data-testid="entity-detail-scan-limited"
          >
            {t(
              "This resource has more connections in the selected time range than the drawer counts; totals are lower bounds.",
            )}
          </p>
        )}
        {sections}
        {sections.length === 0 && (
          <p className="text-sm text-gray-500">
            {t("No connections in the selected time range.")}
          </p>
        )}
      </>
    );
  };

  const attributes: Array<{ label: string; value: string }> = fullEntity
    ? DETAIL_ATTRIBUTES.map((item: { key: string; label: string }) => {
        const bag: Record<string, unknown> = {
          ...((fullEntity.identifyingAttributes as Record<string, unknown>) ||
            {}),
          ...((fullEntity.descriptiveAttributes as Record<string, unknown>) ||
            {}),
        };
        const value: unknown = bag[item.key];
        return {
          label: item.label,
          value: typeof value === "string" ? value : "",
        };
      }).filter((item: { label: string; value: string }): boolean => {
        return Boolean(item.value) && item.value !== displayName;
      })
    : [];

  const fullEntityId: string | null = fullEntity?.id || null;
  const serviceId: string | null =
    serviceLink && serviceLink.forId === fullEntityId
      ? serviceLink.value
      : null;
  const resolvedDatabaseLink: TypedRowLink | null =
    databaseLink && databaseLink.forId === fullEntityId
      ? databaseLink.value
      : null;
  const device: NetworkDevice | null =
    matchedDevice && matchedDevice.forId === fullEntityId
      ? matchedDevice.value
      : null;

  const description: string = props.traffic?.subtitle || typeMeta.label;

  /*
   * One SideOver for every state and every entity, so it stays mounted
   * while the user moves between entities (no slide-in replay).
   */
  return (
    <SideOver
      title={displayName}
      description={description}
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      <div ref={contentRef} className="relative">
        {/*
         * Where focus lands when the drawer switches to another entity: at
         * the top of the content, read out as the entity's name and kind.
         */}
        <div
          ref={focusTargetRef}
          tabIndex={-1}
          className="sr-only"
          data-testid="entity-detail-focus-target"
        >
          {`${displayName}, ${description}`}
        </div>
        {isMissing ? (
          <p
            className="text-sm text-gray-600"
            data-testid="entity-detail-missing"
          >
            {t("This resource is no longer in Inventory.")}
          </p>
        ) : (
          <div className="space-y-6">
            {props.traffic && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: props.traffic.statusColor }}
                  aria-hidden={true}
                />
                <span data-testid="entity-detail-status">
                  {t(props.traffic.statusLabel)}
                </span>
              </div>
            )}

            {props.onFocus && (
              <div className="flex flex-wrap gap-2">
                <Button
                  title={t(props.focusButtonLabel || "Explore connections")}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  onClick={() => {
                    props.onFocus?.(entityKey);
                  }}
                />
              </div>
            )}

            {props.traffic && (
              <div className="grid gap-2">
                {renderTraffic("Requests it answered", props.traffic.inbound)}
                {renderTraffic("Calls it made", props.traffic.outbound)}
                <p className="text-xs text-gray-400">
                  {t("Latest ~15-minute window.")}
                </p>
              </div>
            )}

            {props.incidentStatus &&
            props.incidentStatus.activeIncidentCount > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {t("Active incidents")} (
                  {props.incidentStatus.activeIncidentCount})
                </h3>
                <ul className="mt-1 divide-y divide-gray-100">
                  {props.incidentStatus.incidents.map(
                    (item: ServiceStatusItem): ReactElement => {
                      return renderStatusItem(
                        item,
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        "#dc2626",
                      );
                    },
                  )}
                </ul>
              </div>
            ) : (
              <></>
            )}

            {props.incidentStatus &&
            props.incidentStatus.activeAlertCount > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {t("Active alerts")} ({props.incidentStatus.activeAlertCount})
                </h3>
                <ul className="mt-1 divide-y divide-gray-100">
                  {props.incidentStatus.alerts.map(
                    (item: ServiceStatusItem): ReactElement => {
                      return renderStatusItem(
                        item,
                        RouteMap[PageMap.ALERT_VIEW] as Route,
                        "#f59e0b",
                      );
                    },
                  )}
                </ul>
              </div>
            ) : (
              <></>
            )}

            {renderConnections()}

            {fullEntity && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {t("Details")}
                </h3>
                <dl className="mt-2 space-y-1 text-sm text-gray-600">
                  <div className="flex justify-between gap-4">
                    <dt>{t("Type")}</dt>
                    <dd className="text-right text-gray-900">
                      {t(typeMeta.label)}
                    </dd>
                  </div>
                  {attributes.map(
                    (item: { label: string; value: string }): ReactElement => {
                      return (
                        <div
                          key={item.label}
                          className="flex justify-between gap-4"
                        >
                          <dt>{t(item.label)}</dt>
                          <dd className="break-all text-right text-gray-900">
                            {item.value}
                          </dd>
                        </div>
                      );
                    },
                  )}
                  {fullEntity.firstSeenAt && (
                    <div className="flex justify-between gap-4">
                      <dt>{t("First seen")}</dt>
                      <dd className="text-right">
                        {OneUptimeDate.getDateAsLocalFormattedString(
                          fullEntity.firstSeenAt,
                        )}
                      </dd>
                    </div>
                  )}
                  {fullEntity.lastSeenAt && (
                    <div className="flex justify-between gap-4">
                      <dt>{t("Last seen")}</dt>
                      <dd className="text-right">
                        {OneUptimeDate.getDateAsLocalFormattedString(
                          fullEntity.lastSeenAt,
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {fullEntity && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {t("Open")}
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {fullEntity.id && (
                    <li>
                      <Link
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.INVENTORY_VIEW] as Route,
                          { modelId: new ObjectID(fullEntity.id) },
                        )}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {t("Inventory details")}
                      </Link>
                    </li>
                  )}
                  {serviceId && (
                    <li>
                      <Link
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                          { modelId: new ObjectID(serviceId) },
                        )}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {t("Traces for this service")}
                      </Link>
                    </li>
                  )}
                  {resolvedDatabaseLink && (
                    <li>
                      <Link
                        to={resolvedDatabaseLink.route}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {t(resolvedDatabaseLink.label)}
                      </Link>
                    </li>
                  )}
                  {device?._id && (
                    <li>
                      <Link
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                          { modelId: new ObjectID(device._id.toString()) },
                        )}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {t("Network device:")} {device.name || "device"}
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </SideOver>
  );
};

export default EntityDetailPanel;
