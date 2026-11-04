import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataWarehouseJob from "Common/Models/DatabaseModels/DataWarehouseJob";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataObservabilitySpendSummary,
  DataObservabilitySpendTable,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * What the project's warehouses spent over the last day: Snowflake credits
 * and BigQuery bytes billed, by team, the tables whose writes cost the
 * most, and what is spent on jobs that fail or that write only tables
 * nobody has read for 90 days. Read once an hour with each warehouse's
 * collection.
 */

// Bytes billed as a reader reads them: 1.2 TB, 340 GB.
export function formatBytesBilled(bytes: number | null | undefined): string {
  const value: number = Number(bytes) || 0;
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
  let unit: number = 0;
  let scaled: number = value;

  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit++;
  }

  return `${scaled >= 100 || unit === 0 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}

export function formatCredits(credits: number | null | undefined): string {
  const value: number = Number(credits) || 0;

  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

const Stat: FunctionComponent<{
  title: string | undefined;
  value: string;
}> = (props: { title: string | undefined; value: string }): ReactElement => {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {props.title}
      </div>
      <div className="mt-1 text-xl font-semibold text-gray-900">
        {props.value}
      </div>
    </div>
  );
};

const SpendPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [summary, setSummary] = useState<DataObservabilitySpendSummary | null>(
    null,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getSpendSummary()
      .then((found: DataObservabilitySpendSummary): void => {
        if (isCurrent) {
          setSummary(found);
        }
      })
      .catch((): void => {
        // The jobs table below still lists every job.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const spendOf: (credits: number, bytes: number) => string = (
    credits: number,
    bytes: number,
  ): string => {
    return (
      [
        credits > 0
          ? translator.translateTemplate("{{credits}} credits", {
              credits: formatCredits(credits),
            })
          : "",
        bytes > 0
          ? translator.translateTemplate("{{bytes}} billed", {
              bytes: formatBytesBilled(bytes),
            })
          : "",
      ]
        .filter(Boolean)
        .join(" · ") || "-"
    );
  };

  return (
    <div className="space-y-5">
      <Card
        title="Warehouse Spend"
        description="What your warehouses spent over the last day: Snowflake credits and BigQuery bytes billed, read once an hour, by team and by table, and what goes to jobs that fail or write tables nobody reads."
      >
        {summary ? (
          <div className="space-y-6 px-6 pb-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                title={translator.translateText("Credits (24h)")}
                value={formatCredits(summary.credits)}
              />
              <Stat
                title={translator.translateText("Bytes Billed (24h)")}
                value={formatBytesBilled(summary.bytesBilled)}
              />
              <Stat
                title={translator.translateText("Jobs That Failed")}
                value={`${summary.failingJobCount} / ${summary.jobCount}`}
              />
              <Stat
                title={translator.translateText("Spent On Unused Tables")}
                value={spendOf(
                  summary.unusedCredits,
                  summary.unusedBytesBilled,
                )}
              />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {translator.translateText("By Team")}
                </h3>
                {summary.byTeam.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-500">
                    {translator.translateText(
                      "No spend read yet. Spend is read once an hour from Snowflake and BigQuery.",
                    )}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-gray-100">
                    {summary.byTeam.map(
                      (
                        team: DataObservabilitySpendSummary["byTeam"][number],
                      ) => {
                        return (
                          <li
                            key={team.team}
                            className="flex items-center justify-between py-2 text-sm"
                          >
                            <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">
                              {team.team}
                            </span>
                            <span className="text-gray-600">
                              {spendOf(team.credits, team.bytesBilled)}
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {translator.translateText("Costliest Tables")}
                </h3>
                {summary.topTables.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-500">
                    {translator.translateText(
                      "No table's writes have been tied to spend yet.",
                    )}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-gray-100">
                    {summary.topTables.map(
                      (table: DataObservabilitySpendTable) => {
                        return (
                          <li
                            key={table.dataAssetId}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <AppLink
                                to={RouteUtil.populateRouteParams(
                                  RouteMap[
                                    PageMap.DATA_OBSERVABILITY_TABLE_VIEW
                                  ] as Route,
                                  { modelId: new ObjectID(table.dataAssetId) },
                                )}
                                className="font-mono font-medium text-gray-900 hover:underline"
                              >
                                <span>{table.table}</span>
                              </AppLink>
                              {table.isUnused ? (
                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                                  {translator.translateText("Unused")}
                                </span>
                              ) : (
                                <></>
                              )}
                            </span>
                            <span className="text-gray-600">
                              {spendOf(
                                table.credits || 0,
                                table.bytesBilled || 0,
                              )}
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <></>
        )}
      </Card>
      <ModelTable<DataWarehouseJob>
        modelType={DataWarehouseJob}
        id="data-observability-warehouse-jobs"
        name="Data Observability > Warehouse Spend > Jobs"
        userPreferencesKey="data-observability-warehouse-jobs"
        query={{ ...(projectId ? { projectId: projectId } : {}) }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="credits"
        sortOrder={SortOrder.Descending}
        showRefreshButton={true}
        searchableFields={["name"]}
        cardProps={{
          title: "Jobs",
          description:
            "Each query your warehouses run again and again, with what it spent over the last day, its failures and the watched tables it writes. Named by its tag, or by what it does and writes: never by its query.",
        }}
        noItemsMessage="No job read yet. Spend is read once an hour from each Snowflake and BigQuery collection."
        selectMoreFields={{ writesOnlyUnusedTables: true, runCount: true }}
        filters={[
          {
            field: { team: true },
            title: "Team",
            type: FieldType.Text,
          },
          {
            field: { warehouseName: true },
            title: "Warehouse",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Job",
            type: FieldType.Element,
            getExportValue: (item: DataWarehouseJob): string => {
              return item.name || "";
            },
            getElement: (item: DataWarehouseJob): ReactElement => {
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">
                    {item.name || ""}
                  </span>
                  {item.writesOnlyUnusedTables ? (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                      {translator.translateText("Writes unused tables")}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { team: true },
            title: "Team",
            type: FieldType.Text,
          },
          {
            field: { failedRunCount: true },
            title: "Failed Runs (24h)",
            type: FieldType.Element,
            getElement: (item: DataWarehouseJob): ReactElement => {
              const failed: number = item.failedRunCount || 0;

              return (
                <span className={failed > 0 ? "text-red-700" : "text-gray-700"}>
                  {failed} / {item.runCount || 0}
                </span>
              );
            },
          },
          {
            field: { credits: true },
            title: "Credits (24h)",
            type: FieldType.Element,
            getElement: (item: DataWarehouseJob): ReactElement => {
              return (
                <span className="text-gray-700">
                  {item.credits !== undefined && item.credits !== null
                    ? formatCredits(item.credits)
                    : "-"}
                </span>
              );
            },
          },
          {
            field: { bytesBilled: true },
            title: "Bytes Billed (24h)",
            type: FieldType.Element,
            getElement: (item: DataWarehouseJob): ReactElement => {
              return (
                <span className="text-gray-700">
                  {item.bytesBilled ? formatBytesBilled(item.bytesBilled) : "-"}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default SpendPage;
