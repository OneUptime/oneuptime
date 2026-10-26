import PageComponentProps from "../../PageComponentProps";
import {
  KubernetesEventsPage,
  fetchKubernetesEvents,
} from "../../../Components/Kubernetes/KubernetesEventsApi";
import {
  KubernetesEventCounts,
  KubernetesEventRow,
  KubernetesEventsTypeFilter,
  getKubernetesEventPickerValues,
  mergeKubernetesEventRows,
} from "../../../Components/Kubernetes/KubernetesEventsModel";
import KubernetesEventsTable from "../../../Components/Kubernetes/KubernetesEventsTable";
import KubernetesWarningEventsAlertLine from "../../../Components/Kubernetes/KubernetesWarningEventsAlertLine";
import {
  KubernetesEventsViewState,
  hasKubernetesEventsFilters,
  readKubernetesEventsView,
  toKubernetesEventsUrlParams,
} from "../../../Components/Kubernetes/KubernetesEventsUrlState";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import {
  getFilteredEmptyStateProps,
  getLoadErrorStateProps,
} from "Common/UI/Components/Table/TableEmptyStateBuilders";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A CLUSTER'S EVENTS PAGE.
 *
 * Everything Kubernetes reported about the cluster's nodes, workloads,
 * autoscalers and volumes, one row per Event: what happened, what it says,
 * who reported it, what it is about, where, how many times and when. It
 * opens on the warnings - OOM kills, crash loops, failed mounts, an
 * autoscaler that cannot read its metrics - when there are any, which is
 * what a visit to it is for (issue #5179), and on every event otherwise.
 * The buttons switch between them; the pickers narrow the list to a
 * namespace, a kind of object or a reason; the time range reaches back as
 * far as the project keeps logs - further than the hour a cluster keeps
 * its own Events.
 *
 * Events are logs: this page reads them through the logs list, filtered on
 * the server (KubernetesEventsApi), and everything on it can also be
 * searched, charted and alerted on from Logs. The view lives in the URL.
 */

/*
 * Each picker as wide as "All namespaces" needs in one line: from sm up
 * they share a row, as many as fit, and the next one wraps under them
 * rather than squeezing its words onto two lines (beside the side menu at
 * 768px, three side by side did). From xl up they sit at the end of the
 * type buttons' line.
 */
const PICKER_CLASS_NAME: string = "sm:min-w-[11rem] sm:flex-1 xl:max-w-[14rem]";

// What the type buttons say, looked up where they are drawn.
const TYPE_LABELS: Record<KubernetesEventsTypeFilter, string> = {
  [KubernetesEventsTypeFilter.All]: translationKey("All"),
  [KubernetesEventsTypeFilter.Warning]: translationKey("Warnings"),
  [KubernetesEventsTypeFilter.Normal]: translationKey("Normal"),
};

const EVENTS_PLURAL_LABEL: string = translationKey("Events");

interface LoadedEvents {
  warnings: KubernetesEventsPage;
  all: KubernetesEventsPage;
}

const KubernetesClusterEvents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [view, setView] = useState<KubernetesEventsViewState>(
    (): KubernetesEventsViewState => {
      return readKubernetesEventsView((name: string): string | null => {
        return Navigation.getQueryStringByName(name);
      });
    },
  );
  const [clusterIdentifier, setClusterIdentifier] = useState<string>("");
  const [loaded, setLoaded] = useState<LoadedEvents | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // The request the page is waiting for: an answer to an older one is dropped.
  const requestSequence: React.MutableRefObject<number> = useRef<number>(0);

  const load: (next: KubernetesEventsViewState) => Promise<void> = useCallback(
    async (next: KubernetesEventsViewState): Promise<void> => {
      const sequence: number = ++requestSequence.current;
      const isCurrent: () => boolean = (): boolean => {
        return requestSequence.current === sequence;
      };

      setIsLoading(true);
      setError("");

      try {
        let identifier: string = clusterIdentifier;

        if (!identifier) {
          const cluster: KubernetesCluster | null = await ModelAPI.getItem({
            modelType: KubernetesCluster,
            id: modelId,
            select: { clusterIdentifier: true },
          });

          if (!cluster?.clusterIdentifier) {
            throw new Error(translator.translateText("Cluster not found."));
          }

          identifier = cluster.clusterIdentifier;

          if (isCurrent()) {
            setClusterIdentifier(identifier);
          }
        }

        // Resolved now, so a preset range ("Past 1 Day") ends at this moment.
        const window: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(next.range);
        const narrowing: {
          namespace?: string | undefined;
          reason?: string | undefined;
          objectKind?: string | undefined;
        } = {
          namespace: next.namespace,
          reason: next.reason,
          objectKind: next.objectKind,
        };

        /*
         * The warnings on their own, so a busy cluster's Normal events
         * never push them out of what is read, and every event for the
         * other buttons.
         */
        const [warnings, all]: [KubernetesEventsPage, KubernetesEventsPage] =
          await Promise.all([
            fetchKubernetesEvents({
              clusterIdentifier: identifier,
              scope: { kind: "cluster" },
              filters: {
                type: KubernetesEventsTypeFilter.Warning,
                ...narrowing,
              },
              window: window,
            }),
            fetchKubernetesEvents({
              clusterIdentifier: identifier,
              scope: { kind: "cluster" },
              filters: { type: KubernetesEventsTypeFilter.All, ...narrowing },
              window: window,
            }),
          ]);

        if (!isCurrent()) {
          return;
        }

        setLoaded({ warnings: warnings, all: all });
      } catch (err) {
        if (isCurrent()) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (isCurrent()) {
          setIsLoading(false);
        }
      }
    },
    [clusterIdentifier],
  );

  useEffect(() => {
    load(view).catch(() => {
      // handled inside.
    });
  }, []);

  const applyView: (next: KubernetesEventsViewState) => void = (
    next: KubernetesEventsViewState,
  ): void => {
    setView(next);
    Navigation.setQueryString(toKubernetesEventsUrlParams(next));
    load(next).catch(() => {
      // handled inside.
    });
  };

  /*
   * A warning the all-events read saw is a warning too: an Event stored
   * before ingest stamped its type is only found there.
   */
  const warningRows: Array<KubernetesEventRow> = loaded
    ? mergeKubernetesEventRows(loaded.warnings.rows, loaded.all.rows).filter(
        (row: KubernetesEventRow): boolean => {
          return row.isWarning;
        },
      )
    : [];
  const allRows: Array<KubernetesEventRow> = loaded
    ? mergeKubernetesEventRows(loaded.all.rows, warningRows)
    : [];
  const normalRows: Array<KubernetesEventRow> = allRows.filter(
    (row: KubernetesEventRow): boolean => {
      return !row.isWarning;
    },
  );
  const isAllComplete: boolean = Boolean(loaded) && !loaded!.all.hasMore;
  const counts: KubernetesEventCounts = {
    all: allRows.length,
    warning: warningRows.length,
    normal: normalRows.length,
  };

  // The reader's pick, else the warnings when there are any.
  const shownType: KubernetesEventsTypeFilter =
    view.type ||
    (warningRows.length > 0
      ? KubernetesEventsTypeFilter.Warning
      : KubernetesEventsTypeFilter.All);
  const rows: Array<KubernetesEventRow> =
    shownType === KubernetesEventsTypeFilter.Warning
      ? warningRows
      : shownType === KubernetesEventsTypeFilter.Normal
        ? normalRows
        : allRows;
  const isTruncated: boolean = Boolean(
    loaded &&
      (shownType === KubernetesEventsTypeFilter.Warning
        ? loaded.warnings.hasMore
        : loaded.all.hasMore),
  );
  const hasFilters: boolean = hasKubernetesEventsFilters(view);

  const typeOptions: Array<FilterButtonOption> = [
    {
      label: TYPE_LABELS[KubernetesEventsTypeFilter.All],
      value: KubernetesEventsTypeFilter.All,
      badge: isAllComplete ? counts.all : undefined,
    },
    {
      label: TYPE_LABELS[KubernetesEventsTypeFilter.Warning],
      value: KubernetesEventsTypeFilter.Warning,
      badge: loaded && !loaded.warnings.hasMore ? counts.warning : undefined,
    },
    {
      label: TYPE_LABELS[KubernetesEventsTypeFilter.Normal],
      value: KubernetesEventsTypeFilter.Normal,
      badge: isAllComplete ? counts.normal : undefined,
    },
  ];

  const pickerOptions: (
    field: "namespace" | "reason" | "objectKind",
    picked: string | undefined,
  ) => Array<DropdownOption> = (
    field: "namespace" | "reason" | "objectKind",
    picked: string | undefined,
  ): Array<DropdownOption> => {
    return getKubernetesEventPickerValues(allRows, field, picked).map(
      (value: string): DropdownOption => {
        // A namespace, a Kind and a reason are Kubernetes' words: never translated.
        return { value: value, label: value, isUserContent: true };
      },
    );
  };

  const renderPicker: (data: {
    field: "namespace" | "reason" | "objectKind";
    picked: string | undefined;
    placeholder: string;
    ariaLabel: string;
    testId: string;
    onPick: (value: string | undefined) => void;
  }) => ReactElement = (data: {
    field: "namespace" | "reason" | "objectKind";
    picked: string | undefined;
    placeholder: string;
    ariaLabel: string;
    testId: string;
    onPick: (value: string | undefined) => void;
  }): ReactElement => {
    const options: Array<DropdownOption> = pickerOptions(
      data.field,
      data.picked,
    );

    return (
      <div className={PICKER_CLASS_NAME}>
        <Dropdown
          options={options}
          value={options.find((option: DropdownOption): boolean => {
            return option.value === data.picked;
          })}
          placeholder={data.placeholder}
          ariaLabel={data.ariaLabel}
          dataTestId={data.testId}
          isClearable={true}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            data.onPick(value ? String(value) : undefined);
          }}
        />
      </div>
    );
  };

  const rangeElement: ReactElement = (
    <RangeStartAndEndDateView
      dashboardStartAndEndDate={view.range}
      onChange={(range: RangeStartAndEndDateTime) => {
        applyView({ ...view, range: range });
      }}
    />
  );

  /*
   * Refresh lives in the ⋯ at the end of the card's header, where every
   * table keeps it (getTableHeaderButtons), beside the time range.
   */
  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      onClick: () => {
        load(view).catch(() => {
          // handled inside.
        });
      },
      icon: IconProp.Refresh,
    },
  ];

  const renderEmptyState: () => ReactElement = (): ReactElement => {
    if (hasFilters) {
      return (
        <TableEmptyState
          {...getFilteredEmptyStateProps({
            title: "No events match these filters",
            description:
              "Try another namespace, kind or reason, or a longer time range.",
            onClear: () => {
              applyView({ range: view.range, type: view.type });
            },
          })}
          icon={IconProp.Filter}
          dataTestId="kubernetes-events-empty-filtered"
        />
      );
    }

    if (shownType === KubernetesEventsTypeFilter.Warning) {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.AllClear}
          title="No warnings in this time range"
          description="Kubernetes reported no warnings about this cluster's nodes, workloads, autoscalers or volumes."
          actions={[
            {
              title: "Show all events",
              dataTestId: "kubernetes-events-show-all",
              onClick: () => {
                applyView({ ...view, type: KubernetesEventsTypeFilter.All });
              },
            },
          ]}
          dataTestId="kubernetes-events-empty-warnings"
        />
      );
    }

    return (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={IconProp.Logs}
        title="No events in this time range"
        description="Events appear here as the Kubernetes agent sends them. Pick a longer time range to look further back."
        dataTestId="kubernetes-events-empty"
      />
    );
  };

  const translateOrKeep: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  return (
    <div data-testid="kubernetes-events-view">
      <Card
        title="Events"
        description="What Kubernetes reported about this cluster's nodes, workloads, autoscalers and volumes."
        rightElement={rangeElement}
        buttons={getTableHeaderButtons(cardButtons)}
        headerLayout="toolbar"
      >
        {!loaded && isLoading ? <ComponentLoader /> : <></>}

        {!loaded && !isLoading && error ? (
          <TableEmptyState
            {...getLoadErrorStateProps({
              pluralLabel: EVENTS_PLURAL_LABEL,
              error: error,
              onRetry: () => {
                load(view).catch(() => {
                  // handled inside.
                });
              },
              translate: translateOrKeep,
              translator: translator,
            })}
            dataTestId="kubernetes-events-error"
          />
        ) : (
          <></>
        )}

        {loaded && error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            data-testid="kubernetes-events-refresh-error"
          >
            <Icon
              icon={IconProp.Error}
              className="h-4 w-4 shrink-0 text-red-500"
            />
            <span>
              {translator.translateTemplate(
                "Couldn't refresh — showing previously loaded data. {{error}}",
                { error: error },
              )}
            </span>
          </div>
        ) : (
          <></>
        )}

        {loaded ? (
          <div
            className={isLoading ? "opacity-60 transition-opacity" : ""}
            aria-busy={isLoading}
          >
            {/*
             * One line from xl up: which types on the left, where and what on
             * the right. The pickers go under the buttons where a language's
             * words leave them too little room.
             */}
            <div
              className="mb-4 flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between"
              data-testid="kubernetes-events-filters"
            >
              <FilterButtons
                options={typeOptions}
                selectedValue={shownType}
                ariaLabel="Event type"
                onSelect={(value: string) => {
                  applyView({
                    ...view,
                    type: value as KubernetesEventsTypeFilter,
                  });
                }}
                className="flex-wrap xl:flex-shrink-0 xl:flex-nowrap"
              />
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap xl:flex-1 xl:flex-nowrap xl:justify-end">
                {renderPicker({
                  field: "namespace",
                  picked: view.namespace,
                  placeholder: "All namespaces",
                  ariaLabel: "Namespace",
                  testId: "kubernetes-events-namespace-filter",
                  onPick: (value: string | undefined) => {
                    applyView({ ...view, namespace: value });
                  },
                })}
                {renderPicker({
                  field: "objectKind",
                  picked: view.objectKind,
                  placeholder: "All kinds",
                  ariaLabel: "Kind",
                  testId: "kubernetes-events-kind-filter",
                  onPick: (value: string | undefined) => {
                    applyView({ ...view, objectKind: value });
                  },
                })}
                {renderPicker({
                  field: "reason",
                  picked: view.reason,
                  placeholder: "All reasons",
                  ariaLabel: "Reason",
                  testId: "kubernetes-events-reason-filter",
                  onPick: (value: string | undefined) => {
                    applyView({ ...view, reason: value });
                  },
                })}
              </div>
            </div>

            {rows.length === 0 ? (
              renderEmptyState()
            ) : (
              <KubernetesEventsTable
                id="kubernetes-events-table"
                rows={rows}
                clusterId={modelId}
                showObject={true}
                showNamespace={true}
                showType={shownType === KubernetesEventsTypeFilter.All}
                pageResetKey={JSON.stringify({ ...view, type: shownType })}
              />
            )}

            {rows.length > 0 && isTruncated ? (
              <p
                className="mt-4 text-center text-xs text-gray-500"
                data-testid="kubernetes-events-more-note"
              >
                {translator.translateText(
                  "These are the newest events of this time range. Pick a shorter range or a filter to see older ones.",
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {/*
         * Whether these warnings reach anyone: the monitor that alerts on
         * them, or the cluster's Warning Events recommendation to turn on
         * (follow-up of #5201).
         */}
        {clusterIdentifier ? (
          <KubernetesWarningEventsAlertLine
            clusterId={modelId}
            clusterIdentifier={clusterIdentifier}
          />
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default KubernetesClusterEvents;
