import React, { ReactElement } from "react";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Column from "Common/UI/Components/ModelTable/Column";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import OneUptimeDate from "Common/Types/Date";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";

/*
 * Array columns (observables, MITRE ids) render as one comma-joined line with
 * the full list on hover: a row is one line tall, and an event that mentions
 * thirty observables would otherwise push every other row off the screen.
 */
type JoinArrayFunction = (values: Array<string> | undefined) => string;

const joinArray: JoinArrayFunction = (
  values: Array<string> | undefined,
): string => {
  return (values || [])
    .filter((value: string) => {
      return Boolean(value);
    })
    .join(", ");
};

type NoValueFunction = () => ReactElement;

const noValue: NoValueFunction = (): ReactElement => {
  return <span className="text-gray-400">-</span>;
};

type ArrayColumnFunction = (data: {
  field: Column<SecurityEvent>["field"];
  title: string;
  getValues: (item: SecurityEvent) => Array<string> | undefined;
}) => Column<SecurityEvent>;

const arrayColumn: ArrayColumnFunction = (data: {
  field: Column<SecurityEvent>["field"];
  title: string;
  getValues: (item: SecurityEvent) => Array<string> | undefined;
}): Column<SecurityEvent> => {
  return {
    field: data.field,
    title: data.title,
    type: FieldType.Element,
    isHiddenByDefault: true,
    // ClickHouse can order by an Array(String), but the ordering is meaningless.
    disableSort: true,
    getExportValue: (item: SecurityEvent): string => {
      return joinArray(data.getValues(item));
    },
    getElement: (item: SecurityEvent): ReactElement => {
      const text: string = joinArray(data.getValues(item));

      if (!text) {
        return noValue();
      }

      return (
        <span className="break-words" title={text}>
          {text}
        </span>
      );
    },
  };
};

type TextColumnFunction = (data: {
  field: Column<SecurityEvent>["field"];
  title: string;
  type?: FieldType | undefined;
}) => Column<SecurityEvent>;

const hiddenTextColumn: TextColumnFunction = (data: {
  field: Column<SecurityEvent>["field"];
  title: string;
  type?: FieldType | undefined;
}): Column<SecurityEvent> => {
  return {
    field: data.field,
    title: data.title,
    type: data.type || FieldType.Text,
    noValueMessage: "-",
    isHiddenByDefault: true,
  };
};

/*
 * ---------------------------------------------------------------------------
 * Columns
 * ---------------------------------------------------------------------------
 *
 * Every field the detail side-over shows is a column here, so that anything
 * worth reading on one event is also something you can scan down the table -
 * "which vendor produced all of these", "group these by rule name". The seven
 * that were the whole table before are still the seven that show by default;
 * the rest ship hidden and are one click away in "Customize Columns".
 *
 * They are appended rather than interleaved on purpose: inserting them in
 * detail-panel order would silently reshuffle the default layout for everyone
 * who has never opened the picker.
 *
 * The OCSF *typed* columns stop here. Everything else a source sent lands in
 * the `attributes` map, whose keys differ per event class - those are offered
 * through the picker's "Add Attribute Column" search instead (see
 * attributeColumnsProps below).
 */
const securityEventColumns: Columns<SecurityEvent> = [
  {
    field: { time: true },
    title: "Time",
    type: FieldType.Element,
    getElement: (item: SecurityEvent): ReactElement => {
      const time: Date | undefined = item.time;
      if (!time) {
        return noValue();
      }
      const timeDate: Date = new Date(time);
      return (
        <div
          className="flex flex-col leading-tight"
          title={OneUptimeDate.getDateAsLocalFormattedString(timeDate)}
        >
          <span className="text-sm font-medium text-gray-900">
            {OneUptimeDate.fromNow(timeDate)}
          </span>
          <span className="text-[11px] text-gray-500">
            {OneUptimeDate.getDateAsLocalFormattedString(timeDate)}
          </span>
        </div>
      );
    },
  },
  {
    field: { severityName: true },
    title: "Severity",
    type: FieldType.Element,
    getElement: (item: SecurityEvent): ReactElement => {
      return <SecurityEventSeverityPill severityName={item.severityName} />;
    },
  },
  {
    field: { className: true },
    title: "Event Class",
    type: FieldType.Text,
    noValueMessage: "-",
  },
  {
    field: { message: true },
    title: "Message",
    type: FieldType.LongText,
    noValueMessage: "-",
  },
  {
    field: { principalUser: true },
    title: "Principal User",
    type: FieldType.Text,
    noValueMessage: "-",
  },
  {
    field: { principalHost: true },
    title: "Principal Host",
    type: FieldType.Text,
    noValueMessage: "-",
  },
  {
    field: { vendorName: true },
    title: "Vendor",
    type: FieldType.Text,
    noValueMessage: "-",
  },
  hiddenTextColumn({ field: { categoryName: true }, title: "Category" }),
  hiddenTextColumn({ field: { activityName: true }, title: "Activity" }),
  hiddenTextColumn({ field: { statusName: true }, title: "Status" }),
  hiddenTextColumn({ field: { productName: true }, title: "Product" }),
  hiddenTextColumn({ field: { ruleId: true }, title: "Rule ID" }),
  hiddenTextColumn({ field: { ruleName: true }, title: "Rule Name" }),
  arrayColumn({
    field: { mitreTactics: true },
    title: "MITRE Tactics",
    getValues: (item: SecurityEvent): Array<string> | undefined => {
      return item.mitreTactics;
    },
  }),
  arrayColumn({
    field: { mitreTechniques: true },
    title: "MITRE Techniques",
    getValues: (item: SecurityEvent): Array<string> | undefined => {
      return item.mitreTechniques;
    },
  }),
  hiddenTextColumn({ field: { principalIp: true }, title: "Principal IP" }),
  hiddenTextColumn({
    field: { principalProcess: true },
    title: "Principal Process",
    type: FieldType.LongText,
  }),
  hiddenTextColumn({ field: { targetUser: true }, title: "Target User" }),
  hiddenTextColumn({ field: { targetHost: true }, title: "Target Host" }),
  hiddenTextColumn({ field: { targetIp: true }, title: "Target IP" }),
  {
    field: { targetPort: true },
    title: "Target Port",
    type: FieldType.Element,
    isHiddenByDefault: true,
    /*
     * The column is non-nullable with a 0 default, so 0 means "the source did
     * not say" far more often than it means port zero. Rendering it as a
     * literal 0 reads as data the event does not have.
     */
    getExportValue: (item: SecurityEvent): string => {
      return item.targetPort ? item.targetPort.toString() : "";
    },
    getElement: (item: SecurityEvent): ReactElement => {
      if (!item.targetPort) {
        return noValue();
      }

      return <span>{item.targetPort.toString()}</span>;
    },
  },
  hiddenTextColumn({
    field: { targetResource: true },
    title: "Target Resource",
    type: FieldType.LongText,
  }),
  arrayColumn({
    field: { observables: true },
    title: "Observables",
    getValues: (item: SecurityEvent): Array<string> | undefined => {
      return item.observables;
    },
  }),
  hiddenTextColumn({ field: { eventUid: true }, title: "Event UID" }),
];

export default securityEventColumns;
