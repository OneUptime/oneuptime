import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import AppLink from "../AppLink/AppLink";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import { TopologyConnectionSection } from "Common/Types/Topology/TopologyApi";
import Navigation from "Common/UI/Utils/Navigation";
import { InventoryTypeBadge } from "./InventoryBadges";
import {
  RelationshipDirection,
  getRelationshipPhrase,
} from "./InventoryRelationshipLabels";
import {
  AppendedConnectionsPage,
  EntityConnection,
  EntityConnectionSection,
  EntityConnectionsPage,
  EntityDetailData,
  EntityDetailErrorDescription,
  appendConnectionsPage,
  connectionId,
  describeEntityDetailError,
  fetchEntityAllTime,
  fetchEntityAllTimeConnections,
  formatConnectionTotal,
  pageSizeForSection,
  sectionReloadLimit,
} from "../Topology/EntityDetailApi";
import { EntityDetailTarget } from "../Topology/TopologyData";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * "What is this connected to?" — both directions of the relationship graph
 * for one inventory item.
 *
 * The server classifies, orders and counts the item's relationships
 * (POST /telemetry/topology/entity/all-time) and returns exact totals with
 * the first rows of each section, the other end already named and typed;
 * "Show more" pages a section from /entity/all-time/connections. This list
 * used to download both directions itself, 10,000 rows each, and resolve
 * the far ends with one huge IN list — a cluster, namespace or node with
 * more relationships than that was cut off without a word.
 *
 * All time, not the Topology drawer's range: this page has no time picker,
 * relationships drawn by hand are never re-bumped or pruned, and an archived
 * item is still viewable here — with its connections, and linking to
 * archived neighbours. An edge whose other end has no row (it was pruned, or
 * the edge outlived it) still renders, showing the raw key — the connection
 * is real even when we can no longer name what is on the far side.
 */

interface SectionConfig {
  section: TopologyConnectionSection;
  title: string;
}

/* The server's sections, in the Topology drawer's order. */
const SECTIONS: Array<SectionConfig> = [
  { section: "calls", title: "Calls" },
  { section: "calledBy", title: "Called by" },
  { section: "runsOn", title: "Runs on" },
  { section: "related", title: "Related" },
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

interface PanelState {
  /* Which item this state answers: its key and type. */
  requestKey: string;
  status: "loading" | "ready" | "error";
  data: EntityDetailData | null;
  error: EntityDetailErrorDescription | null;
  /* Sections with a request of their own in flight, and which. */
  pending: SectionFlags<SectionAction>;
  /* The last failed section request, per section. */
  sectionErrors: SectionFlags<SectionError>;
  /*
   * Sections whose list changed on the server while the user paged it, so
   * rows may be missing (see appendConnectionsPage): they offer a reload.
   */
  changedSections: SectionFlags<boolean>;
  /* A row, or a section's "Reload list", to focus once rendered. */
  focusId: string | null;
}

function loadingState(requestKey: string): PanelState {
  return {
    requestKey: requestKey,
    status: "loading",
    data: null,
    error: null,
    pending: {},
    sectionErrors: {},
    changedSections: {},
    focusId: null,
  };
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

function reloadFocusId(section: TopologyConnectionSection): string {
  return `reload:${section}`;
}

/* The stored edge points one way; the phrase is read from this item's end. */
function directionOf(row: EntityConnection): RelationshipDirection {
  return row.direction === "out" ? "outgoing" : "incoming";
}

export interface ComponentProps {
  entityKey: string;
  /* Narrows the lookup when two items share the key; the key is enough. */
  entityType?: string | undefined;
  /** Full-project topology, pre-focused on this item. */
  fullMapRoute?: Route | undefined;
  /** Rendered inside a Card unless the page supplies its own. */
  showCard?: boolean | undefined;
}

const InventoryRelationships: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const entityKey: string = props.entityKey;
  const entityType: string | undefined = props.entityType || undefined;
  const requestKey: string = JSON.stringify([entityKey, entityType || ""]);

  const [state, setState] = useState<PanelState>(() => {
    return loadingState(requestKey);
  });
  const [attempt, setAttempt] = useState<number>(0);
  const sectionControllers: MutableRefObject<
    Map<TopologyConnectionSection, AbortController>
  > = useRef<Map<TopologyConnectionSection, AbortController>>(
    new Map<TopologyConnectionSection, AbortController>(),
  );
  const focusables: MutableRefObject<Map<string, HTMLElement>> = useRef<
    Map<string, HTMLElement>
  >(new Map<string, HTMLElement>());

  /*
   * Only a state that answers the current item is shown: until the effect
   * below has reset it, another item reads as loading instead of flashing
   * the previous item's connections.
   */
  const current: PanelState | null =
    state.requestKey === requestKey ? state : null;

  useEffect(() => {
    const controllers: Map<TopologyConnectionSection, AbortController> =
      sectionControllers.current;
    setState((previous: PanelState): PanelState => {
      return previous.requestKey === requestKey && previous.status === "loading"
        ? previous
        : loadingState(requestKey);
    });

    const controller: AbortController = new AbortController();
    const target: EntityDetailTarget = {
      entityKey: entityKey,
      entityType: entityType,
    };

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const loaded: EntityDetailData = await fetchEntityAllTime(target, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setState((previous: PanelState): PanelState => {
          if (previous.requestKey !== requestKey) {
            return previous;
          }
          return { ...loadingState(requestKey), status: "ready", data: loaded };
        });
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        setState((previous: PanelState): PanelState => {
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
   * After a section request, move focus to what it asked for — the first
   * row "Show more" added, or "Reload list" when the list changed — so a
   * keyboard user is not left on a button that has gone.
   */
  useEffect(() => {
    if (!state.focusId) {
      return;
    }
    focusables.current.get(state.focusId)?.focus();
    setState((previous: PanelState): PanelState => {
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
    const data: EntityDetailData | null = current?.data || null;
    if (!data || !data.entity || current?.pending[section]) {
      return;
    }
    const shown: EntityConnectionSection = data.sections[section];
    const offset: number | null = action === "reload" ? 0 : shown.nextOffset;
    if (offset === null) {
      return;
    }
    const limit: number =
      action === "reload"
        ? sectionReloadLimit(section, shown.rows.length)
        : pageSizeForSection(section);
    const key: string = requestKey;
    sectionControllers.current.get(section)?.abort();
    const controller: AbortController = new AbortController();
    sectionControllers.current.set(section, controller);
    setState((previous: PanelState): PanelState => {
      if (previous.requestKey !== key) {
        return previous;
      }
      return {
        ...previous,
        pending: withFlag<SectionAction>(previous.pending, section, action),
        sectionErrors: withFlag<SectionError>(
          previous.sectionErrors,
          section,
          null,
        ),
      };
    });

    try {
      const page: EntityConnectionsPage = await fetchEntityAllTimeConnections(
        { entityKey: entityKey, entityType: entityType },
        section,
        offset,
        limit,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        return;
      }
      setState((previous: PanelState): PanelState => {
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
          focusId = first ? connectionId(section, first) : null;
        } else {
          const appended: AppendedConnectionsPage = appendConnectionsPage(
            section,
            previous.data.sections[section],
            page.connections,
          );
          next = appended.merged;
          changed =
            Boolean(previous.changedSections[section]) || appended.listChanged;
          focusId =
            appended.firstNewRowId || (changed ? reloadFocusId(section) : null);
        }
        return {
          ...previous,
          data: {
            ...previous.data,
            sections: { ...previous.data.sections, [section]: next },
            isScanLimited: previous.data.isScanLimited || page.isScanLimited,
          },
          pending: withFlag<SectionAction>(previous.pending, section, null),
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
      setState((previous: PanelState): PanelState => {
        if (previous.requestKey !== key) {
          return previous;
        }
        return {
          ...previous,
          pending: withFlag<SectionAction>(previous.pending, section, null),
          sectionErrors: withFlag<SectionError>(
            previous.sectionErrors,
            section,
            { ...described, action: action },
          ),
        };
      });
    } finally {
      if (sectionControllers.current.get(section) === controller) {
        sectionControllers.current.delete(section);
      }
    }
  };

  const renderRow: (
    section: TopologyConnectionSection,
    row: EntityConnection,
  ) => ReactElement = (
    section: TopologyConnectionSection,
    row: EntityConnection,
  ): ReactElement => {
    const id: string = connectionId(section, row);
    const label: string = row.otherName || row.otherKey.substring(0, 16);

    return (
      <li
        key={id}
        ref={registerFocusable(id)}
        tabIndex={-1}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <Icon
          icon={
            row.direction === "out" ? IconProp.ArrowRight : IconProp.ArrowLeft
          }
          size={SizeProp.Smaller}
          className="h-4 w-4 shrink-0 text-gray-400"
        />
        <span className="text-sm text-gray-500">
          {getRelationshipPhrase(row.relationshipType, directionOf(row))}
        </span>
        {row.otherId ? (
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW] as Route,
              { modelId: new ObjectID(row.otherId) },
            )}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {label}
          </AppLink>
        ) : (
          <span className="font-mono text-sm text-gray-700">{label}</span>
        )}
        {row.otherType ? (
          <InventoryTypeBadge entityType={row.otherType} />
        ) : null}
        <span className="ml-auto text-xs text-gray-400">
          {row.lastSeenAt
            ? OneUptimeDate.getDateAsLocalFormattedString(row.lastSeenAt)
            : ""}
        </span>
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
    const pending: SectionAction | undefined = current?.pending[config.section];
    const sectionError: SectionError | undefined =
      current?.sectionErrors[config.section];
    /*
     * A server in another format fails every further page the same way:
     * offer the page reload instead of controls that cannot work.
     */
    const isOutdated: boolean = Boolean(sectionError?.isOutdated);
    const listChanged: boolean =
      Boolean(current?.changedSections[config.section]) && !isOutdated;
    const total: string = formatConnectionTotal(
      section.total,
      loaded.isScanLimited,
    );
    const actionClassName: string =
      "rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-wait disabled:text-gray-400";

    return (
      <div
        key={config.section}
        data-testid={`inventory-connections-${config.section}`}
      >
        <h3 className="text-sm font-semibold text-gray-900">
          {config.title} ({total})
        </h3>
        {section.unknownTotal > 0 && (
          <p className="mt-0.5 text-xs text-gray-500">
            {section.unknownTotal.toLocaleString()} no longer in inventory
          </p>
        )}
        <ul className="divide-y divide-gray-100">
          {section.rows.map((row: EntityConnection): ReactElement => {
            return renderRow(config.section, row);
          })}
        </ul>
        {sectionError && (
          <div role="alert" className="mt-1 text-sm text-red-600">
            <p>
              {sectionError.action === "reload"
                ? "Could not reload this list."
                : "Could not load more connections."}
              {sectionError.detail ? ` ${sectionError.detail}` : ""}
            </p>
            {isOutdated && (
              <button
                type="button"
                className={`mt-1 ${actionClassName}`}
                onClick={() => {
                  Navigation.reload();
                }}
              >
                Reload page
              </button>
            )}
          </div>
        )}
        {listChanged && (
          <div
            className="mt-1 flex items-center justify-between gap-2"
            data-testid={`inventory-connections-${config.section}-changed`}
          >
            <p className="text-sm text-amber-700">
              This list changed while you were browsing.
            </p>
            <button
              type="button"
              className={actionClassName}
              aria-label={`Reload list: ${config.title}`}
              disabled={Boolean(pending)}
              aria-busy={pending === "reload"}
              ref={registerFocusable(reloadFocusId(config.section))}
              onClick={() => {
                void loadSection(config.section, "reload");
              }}
            >
              {pending === "reload" ? "Loading…" : "Reload list"}
            </button>
          </div>
        )}
        {section.nextOffset !== null && !isOutdated && (
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-sm text-gray-500">
              Showing {section.rows.length.toLocaleString()} of {total}
            </p>
            <button
              type="button"
              className={actionClassName}
              aria-label={`Show more: ${config.title}`}
              disabled={Boolean(pending)}
              aria-busy={pending === "more"}
              onClick={() => {
                void loadSection(config.section, "more");
              }}
            >
              {pending === "more" ? "Loading…" : "Show more"}
            </button>
          </div>
        )}
      </div>
    );
  };

  type RenderBodyFunction = () => ReactElement;

  const renderBody: RenderBodyFunction = (): ReactElement => {
    if (current?.status === "error") {
      const error: EntityDetailErrorDescription | null = current.error;
      return (
        <ErrorMessage
          message={`Could not load this item's connections.${
            error?.detail ? ` ${error.detail}` : ""
          }`}
          onRefreshClick={() => {
            if (error?.isOutdated) {
              // Asking again gets the same answer; only the new bundle helps.
              Navigation.reload();
              return;
            }
            setAttempt((previous: number): number => {
              return previous + 1;
            });
          }}
        />
      );
    }

    const data: EntityDetailData | null =
      current?.status === "ready" ? current.data : null;

    if (!data) {
      return <ComponentLoader />;
    }

    if (!data.entity) {
      return (
        <p className="text-sm text-gray-500">
          This item is no longer in the inventory, so there are no connections
          to show.
        </p>
      );
    }

    const sections: Array<ReactElement> = [];
    for (const config of SECTIONS) {
      const rendered: ReactElement | null = renderSection(config, data);
      if (rendered) {
        sections.push(rendered);
      }
    }

    if (sections.length === 0) {
      return (
        <p className="text-sm text-gray-500">
          Nothing is connected to this item yet. Connections are worked out from
          telemetry that mentions two things at once — a span that names both a
          service and the pod it ran on, for example.
        </p>
      );
    }

    return (
      <div className="space-y-6" data-testid="inventory-relationship-rows">
        {data.isScanLimited && (
          <p
            className="text-sm text-gray-500"
            data-testid="inventory-connections-scan-limited"
          >
            This item has more connections than the list counts; totals are
            lower bounds.
          </p>
        )}
        {sections}
      </div>
    );
  };

  if (props.showCard === false) {
    return renderBody();
  }

  return (
    <Card
      title="Connections"
      description="What this item runs on, belongs to and depends on. This list shows every immediate neighbor the inventory holds, in both directions; the full map shows the wider connected system."
      rightElement={
        props.fullMapRoute ? (
          <AppLink
            to={props.fullMapRoute}
            className="inline-flex items-center gap-x-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            <span>Open full map</span>
            <Icon
              icon={IconProp.ArrowRight}
              size={SizeProp.Smaller}
              className="h-4 w-4"
            />
          </AppLink>
        ) : undefined
      }
    >
      {renderBody()}
    </Card>
  );
};

export default InventoryRelationships;
