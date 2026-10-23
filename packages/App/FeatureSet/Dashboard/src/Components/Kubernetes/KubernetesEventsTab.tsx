import {
  KubernetesEventsPage,
  fetchKubernetesEvents,
} from "./KubernetesEventsApi";
import {
  KubernetesEventCounts,
  KubernetesEventRow,
  KubernetesEventsScope,
  KubernetesEventsTypeFilter,
  countKubernetesEventRows,
  filterKubernetesEventRowsByType,
} from "./KubernetesEventsModel";
import KubernetesEventsTable from "./KubernetesEventsTable";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { Tab, TabType } from "Common/UI/Components/Tabs/Tab";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getLoadErrorStateProps } from "Common/UI/Components/Table/TableEmptyStateBuilders";
import API from "Common/UI/Utils/API/API";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE EVENTS TAB OF A NODE, A WORKLOAD, AN AUTOSCALER, A VOLUME OR A
 * NAMESPACE.
 *
 * What Kubernetes reported in the last day about the object - and, on a
 * workload's page, about what it runs (a Deployment's ReplicaSets and Pods,
 * a CronJob's Jobs and their Pods), where a crash loop, an OOM kill or a
 * failed mount is reported. A namespace's tab has every Event in it.
 *
 * The page reads them as it opens (useKubernetesEventsTab), not when the
 * tab is opened, so the tab itself says how many warnings there are -
 * "Events (2)", in the warning colour - from the Overview: the warnings
 * about a node or an HPA are one look away wherever its page is opened.
 * The tab opens on those warnings when there are any, and on every event
 * otherwise.
 */

// How far back the tab looks.
export const KUBERNETES_OBJECT_EVENTS_WINDOW_IN_HOURS: number = 24;

const TYPE_LABELS: Record<KubernetesEventsTypeFilter, string> = {
  [KubernetesEventsTypeFilter.All]: translationKey("All"),
  [KubernetesEventsTypeFilter.Warning]: translationKey("Warnings"),
  [KubernetesEventsTypeFilter.Normal]: translationKey("Normal"),
};

export interface KubernetesEventsState {
  rows: Array<KubernetesEventRow>;
  hasMore: boolean;
  isLoading: boolean;
  error: string;
}

/*
 * The Events of a scope over the last day, read once the cluster is known
 * (an empty identifier waits) and again when the scope changes.
 */
export function useKubernetesEvents(data: {
  clusterIdentifier: string;
  scope: KubernetesEventsScope | null;
}): KubernetesEventsState & { reload: () => void } {
  const [state, setState] = useState<KubernetesEventsState>({
    rows: [],
    hasMore: false,
    isLoading: true,
    error: "",
  });
  const requestSequence: React.MutableRefObject<number> = useRef<number>(0);
  const scopeKey: string = data.scope ? JSON.stringify(data.scope) : "";

  const load: () => void = (): void => {
    if (!data.clusterIdentifier || !data.scope) {
      return;
    }

    const sequence: number = ++requestSequence.current;
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const window: InBetween<Date> = new InBetween<Date>(
      OneUptimeDate.addRemoveHours(
        endDate,
        -KUBERNETES_OBJECT_EVENTS_WINDOW_IN_HOURS,
      ),
      endDate,
    );

    setState((previous: KubernetesEventsState): KubernetesEventsState => {
      return { ...previous, isLoading: true, error: "" };
    });

    fetchKubernetesEvents({
      clusterIdentifier: data.clusterIdentifier,
      scope: data.scope,
      filters: { type: KubernetesEventsTypeFilter.All },
      window: window,
    })
      .then((page: KubernetesEventsPage) => {
        if (requestSequence.current === sequence) {
          setState({
            rows: page.rows,
            hasMore: page.hasMore,
            isLoading: false,
            error: "",
          });
        }
      })
      .catch((err: unknown) => {
        if (requestSequence.current === sequence) {
          setState((previous: KubernetesEventsState): KubernetesEventsState => {
            return {
              ...previous,
              isLoading: false,
              error: API.getFriendlyMessage(err),
            };
          });
        }
      });
  };

  useEffect(() => {
    load();
  }, [data.clusterIdentifier, scopeKey]);

  return { ...state, reload: load };
}

export interface ComponentProps {
  events: KubernetesEventsState & { reload: () => void };
  scope: KubernetesEventsScope;
  // The cluster, for the links to an Event's object.
  clusterId: ObjectID;
  // What the scope is, in English: "node", "deployment", "namespace".
  resourceKind: string;
}

const KubernetesEventsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [pickedType, setPickedType] =
    useState<KubernetesEventsTypeFilter | null>(null);
  const events: KubernetesEventsState & { reload: () => void } = props.events;

  if (events.isLoading && events.rows.length === 0) {
    return <PageLoader isVisible={true} />;
  }

  if (events.error && events.rows.length === 0) {
    return (
      <TableEmptyState
        {...getLoadErrorStateProps({
          pluralLabel: translationKey("Events"),
          error: events.error,
          onRetry: events.reload,
          translate: (text: string): string => {
            return translator.translateText(text) || text;
          },
          translator: translator,
        })}
        dataTestId="kubernetes-events-tab-error"
      />
    );
  }

  if (events.rows.length === 0) {
    return (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={IconProp.Logs}
        title={translator.translateTemplate(
          "No events found for this {{kind}} in the last 24 hours.",
          { kind: translatableTerm(props.resourceKind, { inSentence: true }) },
        )}
        description="Events appear here as the Kubernetes agent sends them."
        dataTestId="kubernetes-events-tab-empty"
      />
    );
  }

  const counts: KubernetesEventCounts = countKubernetesEventRows(events.rows);
  // The reader's pick, else the warnings when there are any.
  const shownType: KubernetesEventsTypeFilter =
    pickedType ||
    (counts.warning > 0
      ? KubernetesEventsTypeFilter.Warning
      : KubernetesEventsTypeFilter.All);
  const rows: Array<KubernetesEventRow> = filterKubernetesEventRowsByType(
    events.rows,
    shownType,
  );

  const options: Array<FilterButtonOption> = [
    {
      label: TYPE_LABELS[KubernetesEventsTypeFilter.All],
      value: KubernetesEventsTypeFilter.All,
      badge: counts.all,
    },
    {
      label: TYPE_LABELS[KubernetesEventsTypeFilter.Warning],
      value: KubernetesEventsTypeFilter.Warning,
      badge: counts.warning,
    },
    {
      label: TYPE_LABELS[KubernetesEventsTypeFilter.Normal],
      value: KubernetesEventsTypeFilter.Normal,
      badge: counts.normal,
    },
  ];

  return (
    <div data-testid="kubernetes-events-tab">
      <div className="mb-4">
        <FilterButtons
          options={options}
          selectedValue={shownType}
          ariaLabel="Event type"
          onSelect={(value: string) => {
            setPickedType(value as KubernetesEventsTypeFilter);
          }}
          className="flex-wrap"
        />
      </div>

      {rows.length === 0 ? (
        <TableEmptyState
          kind={
            shownType === KubernetesEventsTypeFilter.Warning
              ? TableEmptyStateKind.AllClear
              : TableEmptyStateKind.Empty
          }
          title={
            shownType === KubernetesEventsTypeFilter.Warning
              ? "No warnings in the last 24 hours"
              : "No normal events in the last 24 hours"
          }
          isCompact={true}
          dataTestId="kubernetes-events-tab-empty-type"
        />
      ) : (
        <KubernetesEventsTable
          id="kubernetes-events-table"
          rows={rows}
          clusterId={props.clusterId}
          showObject={props.scope.kind !== "object"}
          showNamespace={false}
          showType={shownType === KubernetesEventsTypeFilter.All}
          pageResetKey={shownType}
        />
      )}

      {events.hasMore ? (
        <p
          className="mt-4 text-center text-xs text-gray-500"
          data-testid="kubernetes-events-tab-more-note"
        >
          {translator.translateText(
            "These are the newest events of the last 24 hours. The cluster's Events page reaches further back.",
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default KubernetesEventsTab;

/*
 * The Events tab of a detail page, ready for its Tabs: read as the page
 * opens, its name carrying the number of warnings in the warning colour.
 * Call it with the other hooks, before the page's early returns; until the
 * cluster is known it waits.
 */
export function useKubernetesEventsTab(data: {
  clusterIdentifier: string;
  clusterId: ObjectID;
  scope: KubernetesEventsScope | null;
  // The card's title and description, in English.
  title: string;
  description: string;
  // What the scope is, in English: "node", "deployment", "namespace".
  resourceKind: string;
}): Tab {
  const events: KubernetesEventsState & { reload: () => void } =
    useKubernetesEvents({
      clusterIdentifier: data.clusterIdentifier,
      scope: data.scope,
    });
  const warnings: number = countKubernetesEventRows(events.rows).warning;

  return {
    name: "Events",
    countBadge: warnings > 0 ? warnings : undefined,
    tabType: TabType.Warning,
    children: (
      <Card title={data.title} description={data.description}>
        {data.scope ? (
          <KubernetesEventsTab
            events={events}
            scope={data.scope}
            clusterId={data.clusterId}
            resourceKind={data.resourceKind}
          />
        ) : (
          <PageLoader isVisible={true} />
        )}
      </Card>
    ),
  };
}
