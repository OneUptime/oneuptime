import PageComponentProps from "../PageComponentProps";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import DataBiConnection from "Common/Models/DatabaseModels/DataBiConnection";
import DataDashboard from "Common/Models/DatabaseModels/DataDashboard";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DataObservabilityBiSyncResponse } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import DataBiTool, {
  DATA_BI_TOOL_CREDENTIALS,
  DATA_BI_TOOLS,
  needsBaseUrl,
} from "Common/Types/DataObservability/DataBiTool";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Link from "Common/UI/Components/Link/Link";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import URL from "Common/Types/API/URL";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The BI tools Data Observability reads dashboards from, and the dashboards
 * it found: each with the watched tables behind it, so a late or broken
 * table's alert lists the dashboards people open on it. A tool is read
 * every hour, once when it is added, and on Read Now.
 */

// A dashboard's link, when its tool gave one that reads as a URL.
function readUrl(value: string | undefined): URL | null {
  if (!value) {
    return null;
  }

  try {
    return URL.fromString(value);
  } catch {
    return null;
  }
}

const TOOL_OPTIONS: Array<DropdownOption> = DATA_BI_TOOLS.map(
  (tool: DataBiTool): DropdownOption => {
    return { value: tool, label: tool };
  },
);

const BiDashboardsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const projectId: ReturnType<typeof ProjectUtil.getCurrentProjectId> =
    ProjectUtil.getCurrentProjectId();
  const [readCount, setReadCount] = useState<number>(0);
  const [readError, setReadError] = useState<string>("");

  const readTool: (connection: DataBiConnection) => Promise<void> = async (
    connection: DataBiConnection,
  ): Promise<void> => {
    if (!connection.id) {
      return;
    }

    try {
      const result: DataObservabilityBiSyncResponse =
        await DataObservabilityApi.syncBiConnection(connection.id);

      setReadError(result.error || "");
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error));
    }

    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  return (
    <div className="space-y-5">
      {readError ? (
        <p className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
          {readError}
        </p>
      ) : (
        <></>
      )}
      <ModelTable<DataBiConnection>
        modelType={DataBiConnection}
        rowSwitch={{ column: "isEnabled" }}
        id="data-observability-bi-tools"
        name="Data Observability > BI Tools"
        userPreferencesKey="data-observability-bi-tools"
        query={{ ...(projectId ? { projectId: projectId } : {}) }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createVerb="Add"
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        refreshToggle={String(readCount)}
        cardProps={{
          title: "BI Tools",
          description:
            "Metabase, Superset, Tableau, Looker and Power BI: their dashboards, and the tables behind them, read every hour, so a table's alerts list the dashboards built on it.",
        }}
        noItemsMessage="No BI tool yet. Add one, with credentials that may read its dashboards, and a late table's alert names the dashboards people open on it."
        formFields={[
          {
            field: { name: true },
            title: "Name",
            description: "What the BI tool is called here.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Finance Metabase",
          },
          {
            field: { tool: true },
            title: "Tool",
            description: "Which BI tool it is.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TOOL_OPTIONS,
            required: true,
            doNotShowWhenEditing: true,
          },
          {
            field: { baseUrl: true },
            title: "Address",
            description:
              "The tool's own address, such as https://metabase.acme.com. Power BI needs none.",
            fieldType: FormFieldSchemaType.URL,
            required: (values: FormValues<DataBiConnection>): boolean => {
              return needsBaseUrl(values.tool as DataBiTool);
            },
            showIf: (values: FormValues<DataBiConnection>): boolean => {
              return values.tool !== DataBiTool.PowerBI;
            },
            placeholder: "https://metabase.acme.com",
          },
          {
            field: { credentials: true },
            title: "Credentials",
            description:
              "JSON that may read its dashboards: Metabase an API key, Superset a user, Tableau a personal access token, Looker an API client, Power BI a service principal. Encrypted, and never shown again.",
            fieldType: FormFieldSchemaType.Password,
            required: true,
            placeholder: DATA_BI_TOOL_CREDENTIALS[DataBiTool.Metabase],
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            description: "Read its dashboards every hour.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
          },
        ]}
        onCreateSuccess={async (
          connection: DataBiConnection,
        ): Promise<DataBiConnection> => {
          await readTool(connection);

          return connection;
        }}
        actionButtons={[
          {
            title: "Read Now",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            onClick: async (
              item: DataBiConnection,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                await readTool(item);
                onCompleteAction();
              } catch (err) {
                onError(err as Error);
              }
            },
          },
        ]}
        selectMoreFields={{ lastSyncError: true }}
        filters={[]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { tool: true },
            title: "Tool",
            type: FieldType.Text,
          },
          {
            field: { dashboardCount: true },
            title: "Dashboards",
            type: FieldType.Number,
          },
          {
            field: { matchedTableCount: true },
            title: "Tables Matched",
            type: FieldType.Number,
          },
          {
            field: { lastSyncedAt: true },
            title: "Last Read",
            type: FieldType.Element,
            getElement: (item: DataBiConnection): ReactElement => {
              if (item.lastSyncError) {
                return (
                  <span className="text-sm text-red-700 [overflow-wrap:anywhere]">
                    {item.lastSyncError}
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-700">
                  {item.lastSyncedAt
                    ? new Date(item.lastSyncedAt).toLocaleString()
                    : "-"}
                </span>
              );
            },
          },
        ]}
      />
      <ModelTable<DataDashboard>
        modelType={DataDashboard}
        id="data-observability-bi-dashboards"
        name="Data Observability > BI Dashboards"
        userPreferencesKey="data-observability-bi-dashboards"
        query={{ ...(projectId ? { projectId: projectId } : {}) }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        refreshToggle={String(readCount)}
        searchableFields={["name"]}
        cardProps={{
          title: "BI Dashboards",
          description:
            "Every dashboard of the BI tools above, with the watched tables its charts query.",
        }}
        noItemsMessage="No dashboard read yet. Add a BI tool above: its dashboards appear here once they are read."
        selectMoreFields={{ url: true }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { tool: true },
            title: "Tool",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Dashboard",
            type: FieldType.Element,
            getExportValue: (item: DataDashboard): string => {
              return item.name || "";
            },
            getElement: (item: DataDashboard): ReactElement => {
              const url: URL | null = readUrl(item.url);

              return url ? (
                <Link
                  to={url}
                  openInNewTab={true}
                  className="font-medium text-indigo-700 hover:underline"
                >
                  {item.name || ""}
                </Link>
              ) : (
                <span className="font-medium text-gray-900">
                  {item.name || ""}
                </span>
              );
            },
          },
          {
            field: { tool: true },
            title: "Tool",
            type: FieldType.Text,
          },
          {
            field: { folder: true },
            title: "Folder",
            type: FieldType.Text,
          },
          {
            field: { owner: true },
            title: "Owner",
            type: FieldType.Text,
          },
          {
            field: { tableCount: true },
            title: "Tables",
            type: FieldType.Number,
          },
        ]}
      />
    </div>
  );
};

export default BiDashboardsPage;
