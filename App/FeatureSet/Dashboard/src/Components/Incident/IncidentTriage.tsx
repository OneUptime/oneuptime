import PeekView from "../EventView/PeekView";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { ShowToastNotification } from "Common/UI/Components/Toast/ToastInit";
import { ToastType } from "Common/UI/Components/Toast/Toast";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

const DEFAULT_COLOR: string = "#9ca3af";

type IsTypingTarget = (target: EventTarget | null) => boolean;

const isTypingTarget: IsTypingTarget = (
  target: EventTarget | null,
): boolean => {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag: string = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
};

/**
 * IncidentTriage
 *
 * A dense, keyboard-first triage list with a split-pane peek. Built to work the
 * active-incident queue fast: j/k to move, Enter to open the full record,
 * a to acknowledge, r to resolve, Esc to close the peek. Selecting a row peeks
 * its detail beside the list instead of navigating away.
 */
const IncidentTriage: FunctionComponent = (): ReactElement => {
  const [incidents, setIncidents] = useState<Array<Incident>>([]);
  const [states, setStates] = useState<Array<IncidentState>>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [actionInFlight, setActionInFlight] = useState<boolean>(false);

  // Refs so the single global key handler always reads current values.
  const incidentsRef: React.MutableRefObject<Array<Incident>> = useRef<
    Array<Incident>
  >([]);
  const statesRef: React.MutableRefObject<Array<IncidentState>> = useRef<
    Array<IncidentState>
  >([]);
  const selectedIndexRef: React.MutableRefObject<number> = useRef<number>(-1);

  useEffect(() => {
    incidentsRef.current = incidents;
  }, [incidents]);
  useEffect(() => {
    statesRef.current = states;
  }, [states]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const fetchData: () => Promise<void> = async (): Promise<void> => {
    try {
      const statesResult: ListResult<IncidentState> =
        await ModelAPI.getList<IncidentState>({
          modelType: IncidentState,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            order: true,
            isAcknowledgedState: true,
            isResolvedState: true,
          },
          sort: { order: SortOrder.Ascending },
        });

      const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
        modelType: Incident,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          currentIncidentState: {
            isResolvedState: false,
          },
        } as Query<Incident>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          title: true,
          createdAt: true,
          currentIncidentState: {
            name: true,
            color: true,
            order: true,
          },
          incidentSeverity: {
            name: true,
            color: true,
          },
        },
        sort: { createdAt: SortOrder.Descending },
      });

      setStates(statesResult.data);
      setIncidents(result.data);
      setSelectedIndex((prev: number): number => {
        if (result.data.length === 0) {
          return -1;
        }
        if (prev < 0) {
          return prev; // keep "nothing selected" until the user picks
        }
        return Math.min(prev, result.data.length - 1);
      });
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const openFull: (incident: Incident | undefined) => void = (
    incident: Incident | undefined,
  ): void => {
    if (!incident || !incident.id) {
      return;
    }
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW] as Route, {
        modelId: incident.id,
      }),
    );
  };

  const advanceState: (
    incident: Incident | undefined,
    predicate: (state: IncidentState) => boolean | undefined,
    verb: string,
  ) => Promise<void> = async (
    incident: Incident | undefined,
    predicate: (state: IncidentState) => boolean | undefined,
    verb: string,
  ): Promise<void> => {
    if (!incident || !incident.id) {
      return;
    }
    const target: IncidentState | undefined = statesRef.current.find(predicate);
    if (!target || !target.id) {
      ShowToastNotification({
        title: `No ${verb} state configured`,
        description: `This project has no ${verb} incident state to move to.`,
        type: ToastType.DANGER,
      });
      return;
    }

    // Idempotent: skip if already at or past the target state.
    const currentOrder: number = incident.currentIncidentState?.order || 0;
    if (currentOrder >= (target.order || 0)) {
      return;
    }

    setActionInFlight(true);
    try {
      const timeline: IncidentStateTimeline = new IncidentStateTimeline();
      timeline.incidentId = incident.id;
      timeline.incidentStateId = target.id;
      timeline.projectId = ProjectUtil.getCurrentProjectId()!;
      await ModelAPI.create<IncidentStateTimeline>({
        model: timeline,
        modelType: IncidentStateTimeline,
      });
      await fetchData();
    } catch (err) {
      ShowToastNotification({
        title: `Couldn't ${verb} incident`,
        description: API.getFriendlyMessage(err),
        type: ToastType.DANGER,
      });
    }
    setActionInFlight(false);
  };

  const acknowledge: (incident: Incident | undefined) => Promise<void> = (
    incident: Incident | undefined,
  ): Promise<void> => {
    return advanceState(
      incident,
      (s: IncidentState) => {
        return s.isAcknowledgedState;
      },
      "acknowledge",
    );
  };

  const resolve: (incident: Incident | undefined) => Promise<void> = (
    incident: Incident | undefined,
  ): Promise<void> => {
    return advanceState(
      incident,
      (s: IncidentState) => {
        return s.isResolvedState;
      },
      "resolve",
    );
  };

  // Single global keyboard handler (reads refs to stay current).
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (
        isTypingTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const list: Array<Incident> = incidentsRef.current;
      const key: string = event.key.toLowerCase();
      const selected: Incident | undefined =
        selectedIndexRef.current >= 0
          ? list[selectedIndexRef.current]
          : undefined;

      if (key === "j" || event.key === "ArrowDown") {
        if (list.length === 0) {
          return;
        }
        event.preventDefault();
        setSelectedIndex((prev: number): number => {
          return prev < 0 ? 0 : Math.min(prev + 1, list.length - 1);
        });
      } else if (key === "k" || event.key === "ArrowUp") {
        if (list.length === 0) {
          return;
        }
        event.preventDefault();
        setSelectedIndex((prev: number): number => {
          return prev <= 0 ? 0 : prev - 1;
        });
      } else if (event.key === "Enter") {
        if (selected) {
          event.preventDefault();
          openFull(selected);
        }
      } else if (key === "a") {
        if (selected) {
          event.preventDefault();
          acknowledge(selected);
        }
      } else if (key === "r") {
        if (selected) {
          event.preventDefault();
          resolve(selected);
        }
      } else if (event.key === "Escape") {
        setSelectedIndex(-1);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Keep the selected row scrolled into view.
  const listRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) {
      return;
    }
    const el: HTMLElement | null = listRef.current.querySelector(
      `[data-row-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (incidents.length === 0) {
    return (
      <EmptyState
        id="incident-triage-empty"
        icon={IconProp.CheckCircle}
        title="No active incidents"
        description="Nice work — the queue is clear. New incidents will appear here for fast triage."
      />
    );
  }

  const selected: Incident | undefined =
    selectedIndex >= 0 ? incidents[selectedIndex] : undefined;

  type RenderStatePill = (incident: Incident) => ReactElement;
  const renderStatePill: RenderStatePill = (
    incident: Incident,
  ): ReactElement => {
    const color: string =
      incident.currentIncidentState?.color?.toString() || DEFAULT_COLOR;
    return (
      <span
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
        style={{ borderColor: `${color}55`, color: color }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {incident.currentIncidentState?.name || "Unknown"}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* Dense list */}
      <div
        className={selected ? "lg:col-span-3" : "lg:col-span-5"}
        ref={listRef}
      >
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {incidents.map((incident: Incident, index: number): ReactElement => {
            const isSelected: boolean = index === selectedIndex;
            const sevColor: string =
              incident.incidentSeverity?.color?.toString() || DEFAULT_COLOR;
            return (
              <div
                key={incident.id?.toString() || index}
                data-row-index={index}
                role="button"
                tabIndex={0}
                aria-selected={isSelected}
                onClick={() => {
                  return setSelectedIndex(index);
                }}
                onDoubleClick={() => {
                  return openFull(incident);
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setSelectedIndex(index);
                  }
                }}
                className={`flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 ${
                  isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  title={incident.incidentSeverity?.name || "Unknown severity"}
                  style={{ backgroundColor: sevColor }}
                />
                <span className="w-16 flex-shrink-0 font-mono text-xs text-gray-500">
                  {incident.incidentNumberWithPrefix ||
                    (incident.incidentNumber
                      ? `#${incident.incidentNumber}`
                      : "")}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                  {incident.title || "Untitled incident"}
                </span>
                {renderStatePill(incident)}
                <span className="w-20 flex-shrink-0 text-right text-xs text-gray-400">
                  {incident.createdAt
                    ? OneUptimeDate.fromNow(incident.createdAt)
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 px-1 font-mono text-xs text-gray-400">
          <span className="font-semibold">j / k</span> move ·{" "}
          <span className="font-semibold">a</span> ack ·{" "}
          <span className="font-semibold">r</span> resolve ·{" "}
          <span className="font-semibold">↵</span> open ·{" "}
          <span className="font-semibold">esc</span> close
        </div>
      </div>

      {/* Peek */}
      {selected && (
        <div className="lg:col-span-2">
          <PeekView
            eyebrow={
              selected.incidentNumberWithPrefix ||
              (selected.incidentNumber ? `#${selected.incidentNumber}` : "")
            }
            title={selected.title || "Untitled incident"}
            onClose={() => {
              return setSelectedIndex(-1);
            }}
            footer={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={actionInFlight}
                  onClick={() => {
                    return acknowledge(selected);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Icon icon={IconProp.Check} className="h-4 w-4" />
                  Acknowledge
                </button>
                <button
                  type="button"
                  disabled={actionInFlight}
                  onClick={() => {
                    return resolve(selected);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
                  Resolve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    return openFull(selected);
                  }}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  Open full
                  <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {renderStatePill(selected)}
                {selected.incidentSeverity && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                    style={{
                      borderColor: `${selected.incidentSeverity.color?.toString() || DEFAULT_COLOR}55`,
                      color:
                        selected.incidentSeverity.color?.toString() ||
                        DEFAULT_COLOR,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          selected.incidentSeverity.color?.toString() ||
                          DEFAULT_COLOR,
                      }}
                    />
                    {selected.incidentSeverity.name}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-500">
                Declared{" "}
                {selected.createdAt
                  ? OneUptimeDate.fromNow(selected.createdAt)
                  : "recently"}
                .
              </div>
              <div className="text-xs text-gray-400">
                Open the full incident for the activity timeline, affected
                resources, owners and telemetry.
              </div>
            </div>
          </PeekView>
        </div>
      )}
    </div>
  );
};

export default IncidentTriage;
