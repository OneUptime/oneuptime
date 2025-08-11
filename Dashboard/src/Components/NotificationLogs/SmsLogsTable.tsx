import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import SmsStatus from "Common/Types/SmsStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";

export interface SmsLogsTableProps {
  id?: string;
  userPreferencesKey?: string;
  name?: string;
  cardProps?: { title: string; description?: string };
  noItemsMessage?: string;
  query?: Record<string, any>;
  selectMoreFields?: Record<string, boolean>;
  showViewIdButton?: boolean;
  isViewable?: boolean;
  actionButtons?: Array<ActionButtonSchema<SmsLog>>;
  columns?: Columns<SmsLog>;
  filters?: Array<Filter<SmsLog>>;
  singularName?: string;
  pluralName?: string;
}

const SmsLogsTable: FunctionComponent<SmsLogsTableProps> = (
  props: SmsLogsTableProps,
): ReactElement => {
  const defaultColumns: Columns<SmsLog> = [
    { field: { toNumber: true }, title: "To", type: FieldType.Phone },
    {
      field: { fromNumber: true },
      title: "From",
      type: FieldType.Phone,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: SmsLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === SmsStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<SmsLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <ModelTable<SmsLog>
      modelType={SmsLog}
      id={
        props.id ||
        (props.singularName
          ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-sms-logs-table`
          : "sms-logs-table")
      }
      name={props.name || "SMS Logs"}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={props.showViewIdButton ?? true}
  isViewable={props.isViewable}
      userPreferencesKey={
        props.userPreferencesKey ||
        (props.singularName
          ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-sms-logs-table`
          : "sms-logs-table")
      }
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        ...(props.query || {}),
      }}
      selectMoreFields={{ statusMessage: true, ...(props.selectMoreFields || {}) }}
      cardProps={{
        title: props.cardProps?.title || "SMS Logs",
        description:
          props.cardProps?.description ||
          (props.singularName
            ? `SMS sent for this ${props.singularName}.`
            : "SMS sent."),
      }}
      noItemsMessage={
        props.noItemsMessage ||
        (props.singularName
          ? `No SMS logs for this ${props.singularName}.`
          : "No SMS logs.")
      }
      showRefreshButton={true}
  columns={props.columns || defaultColumns}
  filters={props.filters || defaultFilters}
  actionButtons={props.actionButtons}
    />
  );
};

export default SmsLogsTable;
