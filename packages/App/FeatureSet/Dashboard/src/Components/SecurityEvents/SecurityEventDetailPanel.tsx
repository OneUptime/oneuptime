import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import TelemetryDetailPanel, {
  TelemetryDetailPanelTab,
} from "Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import { SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX } from "./SecurityEventsFacets";
import {
  SecurityEventDetailField,
  buildSecurityEventJson,
  buildSecurityEventOverviewFields,
} from "./SecurityEventDetailFields";

export const SECURITY_EVENT_DETAIL_PANEL_TEST_ID: string =
  "security-event-detail-panel";

export const SECURITY_EVENT_DETAIL_OVERVIEW_TAB_ID: string = "overview";
export const SECURITY_EVENT_DETAIL_ATTRIBUTES_TAB_ID: string = "attributes";
export const SECURITY_EVENT_DETAIL_JSON_TAB_ID: string = "json";

export interface ComponentProps {
  securityEvent: SecurityEvent;
  onClose: () => void;
  /*
   * Add a filter for one value of the event to the list behind the panel.
   * `facetKey` is a SecurityEvent column, or `attributes.<key>` for a source
   * attribute — the same keys the facet sidebar emits, so a filter added
   * from here is indistinguishable from one clicked in the sidebar.
   */
  onFilterBy?: ((facetKey: string, value: string) => void) | undefined;
  /*
   * Pivot to the Correlate tab on an observable. Defaults to a deep link,
   * which is what the events list wants; a host that already shows a
   * correlation graph passes its own so the pivot happens in place.
   */
  onCorrelateObservable?: ((observable: string) => void) | undefined;
}

const FilterByButton: FunctionComponent<{
  label: string;
  onClick: () => void;
}> = (props: { label: string; onClick: () => void }): ReactElement => {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className="flex-shrink-0 rounded p-0.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-indigo-600 group-hover:text-gray-400"
      onClick={props.onClick}
    >
      <Icon icon={IconProp.Filter} className="h-3 w-3" />
    </button>
  );
};

const FieldRow: FunctionComponent<{
  label: string;
  value: ReactElement | string;
  onFilter?: (() => void) | undefined;
  filterLabel?: string | undefined;
}> = (props: {
  label: string;
  value: ReactElement | string;
  onFilter?: (() => void) | undefined;
  filterLabel?: string | undefined;
}): ReactElement => {
  return (
    <div className="group grid grid-cols-3 gap-3 px-3 py-2 text-sm">
      <dt className="break-words font-medium text-gray-500">{props.label}</dt>
      <dd className="col-span-2 flex min-w-0 items-start gap-1.5">
        <span className="min-w-0 flex-1 break-words text-gray-900">
          {props.value}
        </span>
        {props.onFilter && (
          <FilterByButton
            label={props.filterLabel || `Filter by ${props.label}`}
            onClick={props.onFilter}
          />
        )}
      </dd>
    </div>
  );
};

/*
 * One security event, opened from the events list.
 *
 * Built on the shared TelemetryDetailPanel — the same drawer the traces and
 * exceptions explorers open, with its focus trap, Escape handling and tab
 * keyboard navigation — rather than a SideOver, so the explorer's list stays
 * usable behind it and every filterable value is one click from becoming a
 * chip in the list.
 */
const SecurityEventDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [activeTabId, setActiveTabId] = useState<string>(
    SECURITY_EVENT_DETAIL_OVERVIEW_TAB_ID,
  );
  const event: SecurityEvent = props.securityEvent;

  const overviewFields: Array<SecurityEventDetailField> = useMemo(() => {
    return buildSecurityEventOverviewFields(event);
  }, [event]);

  const attributes: JSONObject = useMemo(() => {
    return (event.attributes || {}) as JSONObject;
  }, [event]);

  const attributeKeys: Array<string> = useMemo(() => {
    return Object.keys(attributes).sort();
  }, [attributes]);

  const observables: Array<string> = useMemo(() => {
    return (event.observables || []).filter((observable: string): boolean => {
      return Boolean(observable);
    });
  }, [event]);

  const correlateObservable: (observable: string) => void = (
    observable: string,
  ): void => {
    if (props.onCorrelateObservable) {
      props.onCorrelateObservable(observable);
      return;
    }

    Navigation.navigate(
      (
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_EVENTS_CORRELATE] as Route,
        ) as Route
      ).addQueryParams({
        observable: encodeURIComponent(observable),
      }),
    );
  };

  const time: Date | null = event.time ? new Date(event.time) : null;

  const overview: ReactElement = (
    <div className="space-y-4">
      <dl className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {time && (
          <FieldRow
            label="Time"
            value={OneUptimeDate.getDateAsLocalFormattedString(time)}
          />
        )}
        <FieldRow
          label="Severity"
          value={
            <SecurityEventSeverityPill severityName={event.severityName} />
          }
          filterLabel="Filter by Severity"
          onFilter={
            props.onFilterBy && event.severityName
              ? () => {
                  props.onFilterBy?.("severityName", event.severityName || "");
                }
              : undefined
          }
        />
        {overviewFields.map((field: SecurityEventDetailField): ReactElement => {
          return (
            <FieldRow
              key={field.label}
              label={field.label}
              value={field.value}
              filterLabel={`Filter by ${field.label}`}
              onFilter={
                props.onFilterBy && field.facetKey
                  ? () => {
                      props.onFilterBy?.(field.facetKey!, field.value);
                    }
                  : undefined
              }
            />
          );
        })}
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">
          Observables
        </h3>
        {observables.length === 0 ? (
          <p className="text-sm text-gray-500">
            No observables extracted from this event.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {observables.map((observable: string, index: number) => {
              return (
                <button
                  key={`${observable}-${index}`}
                  type="button"
                  data-testid={`security-event-panel-observable-chip-${index}`}
                  title={`Correlate "${observable}"`}
                  className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-xs text-indigo-700 hover:bg-indigo-100"
                  onClick={() => {
                    correlateObservable(observable);
                  }}
                >
                  {observable}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const attributesTab: ReactElement =
    attributeKeys.length === 0 ? (
      <p className="text-sm text-gray-500">
        No attributes recorded for this event.
      </p>
    ) : (
      <dl className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {attributeKeys.map((key: string): ReactElement => {
          const value: string = String(attributes[key] ?? "");

          return (
            <FieldRow
              key={key}
              label={key}
              value={value}
              filterLabel={`Filter by ${key}`}
              onFilter={
                props.onFilterBy && value.length > 0
                  ? () => {
                      props.onFilterBy?.(
                        `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${key}`,
                        value,
                      );
                    }
                  : undefined
              }
            />
          );
        })}
      </dl>
    );

  const jsonTab: ReactElement = (
    <pre
      data-testid="security-event-detail-json"
      className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-800"
    >
      {JSON.stringify(buildSecurityEventJson(event), null, 2)}
    </pre>
  );

  const tabs: Array<TelemetryDetailPanelTab> = [
    {
      id: SECURITY_EVENT_DETAIL_OVERVIEW_TAB_ID,
      label: "Overview",
      content: overview,
    },
    {
      id: SECURITY_EVENT_DETAIL_ATTRIBUTES_TAB_ID,
      label: "Attributes",
      content: attributesTab,
      badge: attributeKeys.length,
    },
    {
      id: SECURITY_EVENT_DETAIL_JSON_TAB_ID,
      label: "JSON",
      content: jsonTab,
    },
  ];

  return (
    <div data-testid={SECURITY_EVENT_DETAIL_PANEL_TEST_ID}>
      <TelemetryDetailPanel
        isOpen={true}
        title={event.message || event.className || "Security Event"}
        subtitle={
          time ? OneUptimeDate.getDateAsLocalFormattedString(time) : undefined
        }
        onClose={props.onClose}
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  );
};

export default SecurityEventDetailPanel;
