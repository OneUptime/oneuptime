import React, { FunctionComponent, ReactElement } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";

export interface ComponentProps {
  securityEvent: SecurityEvent;
  onClose: () => void;
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
    { label: "Observables", value: formatArray(event.observables) },
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
