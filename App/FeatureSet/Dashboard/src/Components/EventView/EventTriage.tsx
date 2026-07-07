import PeekView from "./PeekView";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
import React, { ReactElement, useEffect, useRef, useState } from "react";

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
 * Config that adapts a specific "event" model (Incident / Alert) to the shared
 * triage view. Everything model-specific — queries, selects, field accessors,
 * how to build a state-timeline row — is passed in, so the triage logic itself
 * (dense rows, peek, keyboard, ack/resolve) lives in exactly one place.
 */
export interface EventTriageConfig<
  TModel extends BaseModel,
  TState extends BaseModel,
  TTimeline extends BaseModel,
> {
  modelType: { new (): TModel };
  stateModelType: { new (): TState };
  timelineModelType: { new (): TTimeline };
  listQuery: Query<TModel>;
  listSelect: Select<TModel>;
  listSort: Sort<TModel>;
  stateSelect: Select<TState>;
  stateSort: Sort<TState>;
  viewPageMapKey: PageMap;
  emptyTitle: string;
  emptyDescription: string;
  getId: (model: TModel) => ObjectID | undefined;
  getNumberLabel: (model: TModel) => string;
  getTitle: (model: TModel) => string;
  getCreatedAt: (model: TModel) => Date | undefined;
  getStateName: (model: TModel) => string;
  getStateColor: (model: TModel) => string | undefined;
  getStateOrder: (model: TModel) => number;
  getSeverityName: (model: TModel) => string | undefined;
  getSeverityColor: (model: TModel) => string | undefined;
  isAckState: (state: TState) => boolean | undefined;
  isResolvedState: (state: TState) => boolean | undefined;
  getStateId: (state: TState) => ObjectID | undefined;
  getStateOrderFromState: (state: TState) => number;
  buildTimeline: (args: {
    modelId: ObjectID;
    stateId: ObjectID;
    projectId: ObjectID;
  }) => TTimeline;
}

export interface EventTriageProps<
  TModel extends BaseModel,
  TState extends BaseModel,
  TTimeline extends BaseModel,
> {
  config: EventTriageConfig<TModel, TState, TTimeline>;
}

function EventTriage<
  TModel extends BaseModel,
  TState extends BaseModel,
  TTimeline extends BaseModel,
>(props: EventTriageProps<TModel, TState, TTimeline>): ReactElement {
  const { config } = props;

  const [items, setItems] = useState<Array<TModel>>([]);
  const [states, setStates] = useState<Array<TState>>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [actionInFlight, setActionInFlight] = useState<boolean>(false);

  const itemsRef: React.MutableRefObject<Array<TModel>> = useRef<Array<TModel>>(
    [],
  );
  const statesRef: React.MutableRefObject<Array<TState>> = useRef<
    Array<TState>
  >([]);
  const selectedIndexRef: React.MutableRefObject<number> = useRef<number>(-1);
  const listRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    statesRef.current = states;
  }, [states]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const fetchData: () => Promise<void> = async (): Promise<void> => {
    try {
      const statesResult: ListResult<TState> = await ModelAPI.getList<TState>({
        modelType: config.stateModelType,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
        } as Query<TState>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: config.stateSelect,
        sort: config.stateSort,
      });

      const result: ListResult<TModel> = await ModelAPI.getList<TModel>({
        modelType: config.modelType,
        query: config.listQuery,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: config.listSelect,
        sort: config.listSort,
      });

      setStates(statesResult.data);
      setItems(result.data);
      setSelectedIndex((prev: number): number => {
        if (result.data.length === 0) {
          return -1;
        }
        if (prev < 0) {
          return prev;
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

  const openFull: (item: TModel | undefined) => void = (
    item: TModel | undefined,
  ): void => {
    const id: ObjectID | undefined = item ? config.getId(item) : undefined;
    if (!id) {
      return;
    }
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[config.viewPageMapKey] as Route, {
        modelId: id,
      }),
    );
  };

  const advanceState: (
    item: TModel | undefined,
    predicate: (state: TState) => boolean | undefined,
    verb: string,
  ) => Promise<void> = async (
    item: TModel | undefined,
    predicate: (state: TState) => boolean | undefined,
    verb: string,
  ): Promise<void> => {
    const id: ObjectID | undefined = item ? config.getId(item) : undefined;
    if (!item || !id) {
      return;
    }
    const target: TState | undefined = statesRef.current.find(predicate);
    const targetId: ObjectID | undefined = target
      ? config.getStateId(target)
      : undefined;
    if (!target || !targetId) {
      ShowToastNotification({
        title: `No ${verb} state configured`,
        description: `This project has no ${verb} state to move to.`,
        type: ToastType.DANGER,
      });
      return;
    }

    // Idempotent: skip if already at or past the target state.
    if (config.getStateOrder(item) >= config.getStateOrderFromState(target)) {
      return;
    }

    setActionInFlight(true);
    try {
      const timeline: TTimeline = config.buildTimeline({
        modelId: id,
        stateId: targetId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      });
      await ModelAPI.create<TTimeline>({
        model: timeline,
        modelType: config.timelineModelType,
      });
      await fetchData();
    } catch (err) {
      ShowToastNotification({
        title: `Couldn't ${verb}`,
        description: API.getFriendlyMessage(err),
        type: ToastType.DANGER,
      });
    }
    setActionInFlight(false);
  };

  const acknowledge: (item: TModel | undefined) => Promise<void> = (
    item: TModel | undefined,
  ): Promise<void> => {
    return advanceState(item, config.isAckState, "acknowledge");
  };

  const resolve: (item: TModel | undefined) => Promise<void> = (
    item: TModel | undefined,
  ): Promise<void> => {
    return advanceState(item, config.isResolvedState, "resolve");
  };

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

      const list: Array<TModel> = itemsRef.current;
      const key: string = event.key.toLowerCase();
      const selectedItem: TModel | undefined =
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
        if (selectedItem) {
          event.preventDefault();
          openFull(selectedItem);
        }
      } else if (key === "a") {
        if (selectedItem) {
          event.preventDefault();
          acknowledge(selectedItem);
        }
      } else if (key === "r") {
        if (selectedItem) {
          event.preventDefault();
          resolve(selectedItem);
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

  if (items.length === 0) {
    return (
      <EmptyState
        id="event-triage-empty"
        icon={IconProp.CheckCircle}
        title={config.emptyTitle}
        description={config.emptyDescription}
      />
    );
  }

  const selected: TModel | undefined =
    selectedIndex >= 0 ? items[selectedIndex] : undefined;

  type RenderPill = (name: string, color: string | undefined) => ReactElement;
  const renderPill: RenderPill = (
    name: string,
    color: string | undefined,
  ): ReactElement => {
    const c: string = color || DEFAULT_COLOR;
    return (
      <span
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
        style={{ borderColor: `${c}55`, color: c }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: c }}
        />
        {name}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div
        className={selected ? "lg:col-span-3" : "lg:col-span-5"}
        ref={listRef}
      >
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {items.map((item: TModel, index: number): ReactElement => {
            const isSelected: boolean = index === selectedIndex;
            const sevColor: string =
              config.getSeverityColor(item) || DEFAULT_COLOR;
            return (
              <div
                key={config.getId(item)?.toString() || index}
                data-row-index={index}
                role="button"
                tabIndex={0}
                aria-selected={isSelected}
                onClick={() => {
                  return setSelectedIndex(index);
                }}
                onDoubleClick={() => {
                  return openFull(item);
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
                  title={config.getSeverityName(item) || "Unknown severity"}
                  style={{ backgroundColor: sevColor }}
                />
                <span className="w-16 flex-shrink-0 font-mono text-xs text-gray-500">
                  {config.getNumberLabel(item)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                  {config.getTitle(item)}
                </span>
                {renderPill(
                  config.getStateName(item),
                  config.getStateColor(item),
                )}
                <span className="w-20 flex-shrink-0 text-right text-xs text-gray-400">
                  {config.getCreatedAt(item)
                    ? OneUptimeDate.fromNow(config.getCreatedAt(item)!)
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

      {selected && (
        <div className="lg:col-span-2">
          <PeekView
            eyebrow={config.getNumberLabel(selected)}
            title={config.getTitle(selected)}
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
                {renderPill(
                  config.getStateName(selected),
                  config.getStateColor(selected),
                )}
                {config.getSeverityName(selected) &&
                  renderPill(
                    config.getSeverityName(selected)!,
                    config.getSeverityColor(selected),
                  )}
              </div>
              <div className="text-sm text-gray-500">
                Declared{" "}
                {config.getCreatedAt(selected)
                  ? OneUptimeDate.fromNow(config.getCreatedAt(selected)!)
                  : "recently"}
                .
              </div>
              <div className="text-xs text-gray-400">
                Open the full record for the activity timeline, affected
                resources, owners and telemetry.
              </div>
            </div>
          </PeekView>
        </div>
      )}
    </div>
  );
}

export default EventTriage;
