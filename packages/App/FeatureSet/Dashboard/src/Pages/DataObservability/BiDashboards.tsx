import PageComponentProps from "../PageComponentProps";
import {
  getRefreshCountText,
  getRefreshStatusPill,
  RefreshError,
  RefreshLine,
  TimeAgo,
  VIEWS,
} from "../../Components/DataObservability/DashboardActivity";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import DataBiConnection from "Common/Models/DatabaseModels/DataBiConnection";
import DataDashboard from "Common/Models/DatabaseModels/DataDashboard";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { DataObservabilityBiSyncResponse } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import DataBiTool, {
  DATA_BI_TOOL_CREDENTIALS,
  DATA_BI_TOOLS,
  needsBaseUrl,
} from "Common/Types/DataObservability/DataBiTool";
import {
  DataDashboardRefresh,
  DataDashboardRefreshHistory,
  DataDashboardUsageSummary,
  DataDashboardViewer,
  readDataDashboardRefreshHistory,
  readDataDashboardUsageSummary,
} from "Common/Types/DataObservability/DataDashboardActivity";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import URL from "Common/Types/API/URL";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { getReaderDateLocale } from "Common/Types/DateLanguage";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";

/*
 * The BI tools Data Observability reads dashboards from, and the dashboards
 * it found: each with the watched tables behind it, so a late or broken
 * table's alert lists the dashboards people open on it. A tool is read
 * every hour, once when it is added, and on Read Now.
 *
 * Where the tool says (Power BI), a dashboard's views, when it was last
 * viewed and its data's last refresh come first; its viewers, who views it
 * most and its refreshes are columns to switch on. A Power BI tool can alert
 * on failed refreshes: saving it keeps its monitor in step, as the person
 * who saved it (DataBiRefreshAlerts).
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

// How many times it was opened, and since when while the 28 days are still being read.
function getViewsElement(
  translator: Translator,
  item: DataDashboard,
): ReactElement {
  if (typeof item.viewCount !== "number") {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const summary: DataDashboardUsageSummary | null =
    readDataDashboardUsageSummary(item.usageSummary);

  return (
    <div className="min-w-0">
      <span className="block text-sm text-gray-900">
        {translator.formatNumber(item.viewCount)}
      </span>
      {summary?.since ? (
        <span className="block text-xs text-gray-500">
          {translator.translateTemplate("Since {{date}}", {
            date: OneUptimeDate.getDateAsLocalDayMonthString(summary.since),
          })}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
}

// The last refresh: how it went, when, and a failed one's error.
function getLastRefreshElement(item: DataDashboard): ReactElement {
  if (!item.lastRefreshStatus) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const history: DataDashboardRefreshHistory | null =
    readDataDashboardRefreshHistory(item.refreshHistory);

  return (
    <div className="min-w-0 space-y-1">
      {getRefreshStatusPill(item.lastRefreshStatus)}
      {item.lastRefreshAt ? (
        <TimeAgo
          at={item.lastRefreshAt}
          className="block text-xs text-gray-500"
        />
      ) : (
        <></>
      )}
      {history?.last?.error ? (
        <RefreshError
          error={history.last.error}
          className="block max-w-md truncate text-xs text-red-600"
        />
      ) : (
        <></>
      )}
    </div>
  );
}

function getTopViewers(item: DataDashboard): Array<DataDashboardViewer> {
  return readDataDashboardUsageSummary(item.usageSummary)?.topViewers || [];
}

// Who opened it most, the first three.
function getTopViewersElement(
  translator: Translator,
  item: DataDashboard,
): ReactElement {
  const viewers: Array<DataDashboardViewer> = getTopViewers(item).slice(0, 3);

  if (viewers.length === 0) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  return (
    <ul className="min-w-0 space-y-0.5">
      {viewers.map((viewer: DataDashboardViewer) => {
        return (
          <li key={viewer.viewer} className="text-xs text-gray-700">
            <span className="[overflow-wrap:anywhere]">{viewer.viewer}</span>{" "}
            <span className="text-gray-500">
              {translator.translatePlural(VIEWS, viewer.views)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// How many refreshes failed lately, and the latest three.
function getRefreshesElement(
  translator: Translator,
  item: DataDashboard,
): ReactElement {
  const history: DataDashboardRefreshHistory | null =
    readDataDashboardRefreshHistory(item.refreshHistory);
  const counts: string | null = getRefreshCountText(translator, history);

  if (!history || (!counts && history.refreshes.length === 0)) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  return (
    <div className="min-w-0 space-y-1">
      {counts ? (
        <span
          className={`block text-xs ${history.failureCount ? "text-red-700" : "text-gray-700"}`}
        >
          {counts}
        </span>
      ) : (
        <></>
      )}
      {history.refreshes
        .slice(0, 3)
        .map((refresh: DataDashboardRefresh, index: number) => {
          return (
            <div key={`${refresh.startedAt || ""}-${index}`}>
              <RefreshLine refresh={refresh} />
            </div>
          );
        })}
    </div>
  );
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
  const translator: Translator = useTranslator();
  const [readCount, setReadCount] = useState<number>(0);
  const [readError, setReadError] = useState<string>("");
  const [alertError, setAlertError] = useState<string>("");

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

  // The tool's monitor on failed refreshes, made, kept or removed to match what was saved.
  const keepRefreshAlert: (
    connection: DataBiConnection,
  ) => Promise<void> = async (connection: DataBiConnection): Promise<void> => {
    if (!connection.id) {
      return;
    }

    try {
      await DataObservabilityApi.syncBiRefreshAlert(connection.id);
      setAlertError("");
    } catch (error) {
      setAlertError(
        translator.translateTemplate(
          "The alert on failed refreshes was not saved: {{error}}",
          {
            error: errorInSentence(
              error instanceof Error ? error.message : String(error),
            ),
          },
        ),
      );
    }
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
      {alertError ? (
        <p className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
          {alertError}
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
            "Metabase, Superset, Tableau, Looker and Power BI dashboards, and Hightouch and Census syncs, read every hour, so a table's alerts list what is built on it.",
        }}
        noItemsMessage="No BI tool yet. Add one, with credentials that may read its dashboards, and a late table's alert names the dashboards people open on it."
        /*
         * Five rows on Add, four on Edit (the tool stays as it is), so the
         * form walks two steps (LongFormStepsGuard): the tool, then how
         * OneUptime reads it - as Connect a Database walks the database,
         * then its connection.
         */
        formSteps={[
          { title: "BI Tool", id: "tool" },
          { title: "Connection", id: "connection" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "tool",
            description: "What the BI tool is called here.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Finance Metabase",
          },
          {
            field: { tool: true },
            title: "Tool",
            stepId: "tool",
            description: "Which BI tool it is.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TOOL_OPTIONS,
            required: true,
            doNotShowWhenEditing: true,
          },
          {
            field: { baseUrl: true },
            title: "Address",
            stepId: "connection",
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
            stepId: "connection",
            description:
              "JSON with what may read its dashboards: an API key, a user, a token or a service principal, as the tool asks. Encrypted, and never shown again.",
            fieldType: FormFieldSchemaType.Password,
            required: true,
            placeholder: DATA_BI_TOOL_CREDENTIALS[DataBiTool.Metabase],
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            stepId: "connection",
            description: "Read its dashboards every hour.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
          },
          {
            field: { alertOnFailedRefreshes: true },
            title: "Alert on Failed Refreshes",
            stepId: "connection",
            description:
              "Open an alert for each dataset whose refresh fails, until a later one completes. OneUptime keeps one monitor for it, named after this tool.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            showIf: (values: FormValues<DataBiConnection>): boolean => {
              return values.tool === DataBiTool.PowerBI;
            },
          },
        ]}
        /*
         * Runs after Add and after Edit: the tool's alert is kept as saved -
         * first, as it is quick, and a Power BI read can take minutes - then
         * the tool is read.
         */
        onCreateSuccess={async (
          connection: DataBiConnection,
        ): Promise<DataBiConnection> => {
          await keepRefreshAlert(connection);
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
        selectMoreFields={{ lastSyncError: true, lastSyncWarning: true }}
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
                <div className="min-w-0">
                  <span className="block text-sm text-gray-700">
                    {item.lastSyncedAt
                      ? new Date(item.lastSyncedAt).toLocaleString(
                          getReaderDateLocale(),
                        )
                      : "-"}
                  </span>
                  {item.lastSyncWarning ? (
                    <span className="block text-xs text-yellow-700 [overflow-wrap:anywhere]">
                      {item.lastSyncWarning}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
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
            "Every dashboard of the BI tools above, with the watched tables its charts query - and, for Power BI, how often it is viewed and when its data last refreshed.",
        }}
        noItemsMessage="No dashboard read yet. Add a BI tool above: its dashboards appear here once they are read."
        selectMoreFields={{
          url: true,
          usageSummary: true,
          lastRefreshAt: true,
          refreshHistory: true,
        }}
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
            field: { viewCount: true },
            title: "Views",
            type: FieldType.Element,
            headerTooltip:
              "How many times it was opened in the last 28 days, from its tool's activity log (Power BI).",
            getExportValue: (item: DataDashboard): string => {
              return typeof item.viewCount === "number"
                ? String(item.viewCount)
                : "";
            },
            getElement: (item: DataDashboard): ReactElement => {
              return getViewsElement(translator, item);
            },
          },
          {
            field: { lastViewedAt: true },
            title: "Last Viewed",
            type: FieldType.Element,
            getExportValue: (item: DataDashboard): string => {
              return item.lastViewedAt
                ? new Date(item.lastViewedAt).toISOString()
                : "";
            },
            getElement: (item: DataDashboard): ReactElement => {
              return item.lastViewedAt ? (
                <TimeAgo
                  at={item.lastViewedAt}
                  className="text-sm text-gray-700"
                />
              ) : (
                <span className="text-sm text-gray-400">-</span>
              );
            },
          },
          {
            field: { lastRefreshStatus: true },
            title: "Last Refresh",
            type: FieldType.Element,
            headerTooltip:
              "How the last refresh of the data it charts went, and a failed one's error (Power BI).",
            getExportValue: (item: DataDashboard): string => {
              return item.lastRefreshStatus || "";
            },
            getElement: (item: DataDashboard): ReactElement => {
              return getLastRefreshElement(item);
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
          {
            field: { viewerCount: true },
            title: "Viewers",
            type: FieldType.Number,
            isHiddenByDefault: true,
            headerTooltip: "How many people opened it in the last 28 days.",
          },
          {
            field: { usageSummary: true },
            title: "Top Viewers",
            type: FieldType.Element,
            isHiddenByDefault: true,
            wrapContent: true,
            headerTooltip:
              "Who opened it most in the last 28 days, and how often.",
            getExportValue: (item: DataDashboard): string => {
              return getTopViewers(item)
                .map((viewer: DataDashboardViewer): string => {
                  return `${viewer.viewer} (${viewer.views})`;
                })
                .join(", ");
            },
            getElement: (item: DataDashboard): ReactElement => {
              return getTopViewersElement(translator, item);
            },
          },
          {
            field: { refreshHistory: true },
            title: "Refreshes",
            type: FieldType.Element,
            isHiddenByDefault: true,
            wrapContent: true,
            headerTooltip:
              "The latest refreshes of the data it charts, and how many failed in the last 7 days.",
            getExportValue: (item: DataDashboard): string => {
              return (
                getRefreshCountText(
                  translator,
                  readDataDashboardRefreshHistory(item.refreshHistory),
                ) || ""
              );
            },
            getElement: (item: DataDashboard): ReactElement => {
              return getRefreshesElement(translator, item);
            },
          },
        ]}
      />
    </div>
  );
};

export default BiDashboardsPage;
