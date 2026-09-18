import React, { FunctionComponent, ReactElement } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

export interface ComponentProps {
  securityEvent: SecurityEvent;
  onClose: () => void;
  /*
   * Pivot handler for the observable chips. When the detail panel is
   * already on the Correlate page the pivot happens in place; everywhere
   * else (omit the prop) a chip deep-links to the Correlate page seeded
   * with that observable.
   */
  onCorrelateObservable?: ((observable: string) => void) | undefined;
}

interface DetailRow {
  label: string;
  value: ReactElement | string | undefined;
}

const SecurityEventDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const event: SecurityEvent = props.securityEvent;

  const formatArray: (values: Array<string> | undefined) => string = (
    values: Array<string> | undefined,
  ): string => {
    return (values || [])
      .filter((value: string) => {
        return Boolean(value);
      })
      .join(", ");
  };

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

  const observables: Array<string> = (event.observables || []).filter(
    (observable: string) => {
      return Boolean(observable);
    },
  );

  /*
   * Observables are the pivot points of the whole product — every one of
   * them is a valid Correlate query, so render them as chips that start
   * (or refocus) a correlation instead of a comma-joined string.
   */
  const observableChips: ReactElement | undefined =
    observables.length > 0 ? (
      <span className="flex flex-wrap gap-1.5">
        {observables.map((observable: string, index: number): ReactElement => {
          return (
            <button
              key={index}
              type="button"
              data-testid={`security-event-observable-chip-${index}`}
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
      </span>
    ) : undefined;

  const rows: Array<DetailRow> = [
    {
      label: "Time",
      value: event.time
        ? OneUptimeDate.getDateAsLocalFormattedString(new Date(event.time))
        : undefined,
    },
    {
      label: "Severity",
      value: <SecurityEventSeverityPill severityName={event.severityName} />,
    },
    { label: "Event Class", value: event.className },
    { label: "Category", value: event.categoryName },
    { label: "Activity", value: event.activityName },
    { label: "Status", value: event.statusName },
    { label: "Message", value: event.message },
    { label: "Vendor", value: event.vendorName },
    { label: "Product", value: event.productName },
    { label: "Rule ID", value: event.ruleId },
    { label: "Rule Name", value: event.ruleName },
    { label: "MITRE Tactics", value: formatArray(event.mitreTactics) },
    { label: "MITRE Techniques", value: formatArray(event.mitreTechniques) },
    { label: "Principal User", value: event.principalUser },
    { label: "Principal Host", value: event.principalHost },
    { label: "Principal IP", value: event.principalIp },
    { label: "Principal Process", value: event.principalProcess },
    { label: "Target User", value: event.targetUser },
    { label: "Target Host", value: event.targetHost },
    { label: "Target IP", value: event.targetIp },
    {
      label: "Target Port",
      value: event.targetPort ? event.targetPort.toString() : undefined,
    },
    { label: "Target Resource", value: event.targetResource },
    { label: "Observables", value: observableChips },
    { label: "Event UID", value: event.eventUid },
  ];

  const attributes: JSONObject = event.attributes || {};
  const attributeKeys: Array<string> = Object.keys(attributes).sort();

  return (
    <SideOver
      title="Security Event"
      description={event.message || "Details of the selected security event."}
      onClose={props.onClose}
      size={SideOverSize.Large}
    >
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Event Fields
          </h3>
          <dl className="divide-y divide-gray-100 border border-gray-200 rounded-md">
            {rows
              .filter((row: DetailRow) => {
                return Boolean(row.value);
              })
              .map((row: DetailRow, index: number): ReactElement => {
                return (
                  <div
                    key={index}
                    className="grid grid-cols-3 gap-3 px-3 py-2 text-sm"
                  >
                    <dt className="font-medium text-gray-500">{row.label}</dt>
                    <dd className="col-span-2 text-gray-900 break-words">
                      {row.value}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Attributes
          </h3>
          {attributeKeys.length === 0 ? (
            <p className="text-sm text-gray-500">
              No attributes recorded for this event.
            </p>
          ) : (
            <dl className="divide-y divide-gray-100 border border-gray-200 rounded-md">
              {attributeKeys.map((key: string): ReactElement => {
                return (
                  <div
                    key={key}
                    className="grid grid-cols-3 gap-3 px-3 py-2 text-sm"
                  >
                    <dt className="font-medium text-gray-500 break-words">
                      {key}
                    </dt>
                    <dd className="col-span-2 text-gray-900 break-words">
                      {String(attributes[key] ?? "")}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </div>
    </SideOver>
  );
};

export default SecurityEventDetail;
