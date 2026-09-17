import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import DataSourceModel from "Common/Models/DatabaseModels/DataSource";
import DataSourceType, {
  DataSourceTypeProps,
  DataSourceTypeUtil,
} from "Common/Types/DataSource/DataSourceType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Input from "Common/UI/Components/Input/Input";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  component: DashboardBaseComponent;
  onChange: (component: DashboardBaseComponent) => void;
}

/*
 * Query editor for the four external Data Source widgets. Writes straight
 * through onChange/commitComponent (NOT through a BasicForm) so section-form
 * snapshot re-emits can't clobber it — the same contract the
 * TableColumnsEditor uses.
 *
 * The Data Source Chart holds an ARRAY of queries (arguments.queries) so
 * several series can be overlaid; Value/Gauge/Table hold a single query
 * (arguments.query). These widget types exist only to read external data,
 * so the query is the primary configuration, not an alternative mode of
 * some other widget.
 */
const DataSourceQueryEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [dataSources, setDataSources] = useState<Array<DataSourceModel>>([]);
  const [loadError, setLoadError] = useState<string>("");

  useEffect(() => {
    let isMounted: boolean = true;

    const loadDataSources: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<DataSourceModel> =
          await ModelAPI.getList<DataSourceModel>({
            modelType: DataSourceModel,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            select: {
              _id: true,
              name: true,
              dataSourceType: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          });
        if (isMounted) {
          setDataSources(result.data);
          setLoadError("");
        }
      } catch (err: unknown) {
        if (isMounted) {
          setLoadError(API.getFriendlyErrorMessage(err as Error));
        }
      }
    };

    loadDataSources().catch(() => {
      // surfaced via loadError state.
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // Only the chart widget overlays several queries on one visualization.
  const isChart: boolean =
    props.component.componentType === DashboardComponentType.DataSourceChart;
  // Tables consume ROWS, not time series — the copy and fields differ.
  const isTable: boolean =
    props.component.componentType === DashboardComponentType.DataSourceTable;

  const componentArguments: Record<string, unknown> = (props.component
    .arguments || {}) as Record<string, unknown>;

  const queryConfigs: Array<DataSourceQueryConfig> = useMemo(() => {
    if (isChart) {
      return (
        (componentArguments["queries"] as Array<DataSourceQueryConfig>) || []
      );
    }
    const single: DataSourceQueryConfig | undefined = componentArguments[
      "query"
    ] as DataSourceQueryConfig | undefined;
    return single ? [single] : [];
  }, [componentArguments, isChart]);

  const dropdownOptions: Array<DropdownOption> = useMemo(() => {
    return dataSources.map((dataSource: DataSourceModel) => {
      return {
        value: dataSource._id?.toString() || "",
        label: `${dataSource.name || "Unnamed"} (${
          dataSource.dataSourceType || "Unknown"
        })`,
      };
    });
  }, [dataSources]);

  const writeConfigs: (next: Array<DataSourceQueryConfig>) => void = (
    next: Array<DataSourceQueryConfig>,
  ): void => {
    const nextArguments: Record<string, unknown> = {
      ...componentArguments,
    };

    if (isChart) {
      if (next.length > 0) {
        nextArguments["queries"] = next;
      } else {
        delete nextArguments["queries"];
      }
    } else if (next.length > 0 && next[0]) {
      nextArguments["query"] = next[0];
    } else {
      delete nextArguments["query"];
    }

    props.onChange({
      ...props.component,
      arguments: nextArguments,
    } as DashboardBaseComponent);
  };

  const getTypeOfDataSource: (
    dataSourceId: string,
  ) => DataSourceType | undefined = (
    dataSourceId: string,
  ): DataSourceType | undefined => {
    const matched: DataSourceModel | undefined = dataSources.find(
      (dataSource: DataSourceModel) => {
        return dataSource._id?.toString() === dataSourceId;
      },
    );
    return matched?.dataSourceType;
  };

  const renderQueryCard: (
    config: DataSourceQueryConfig,
    index: number,
  ) => ReactElement = (
    config: DataSourceQueryConfig,
    index: number,
  ): ReactElement => {
    const selectedType: DataSourceType | undefined = getTypeOfDataSource(
      config.dataSourceId,
    );
    const typeProps: DataSourceTypeProps | undefined = selectedType
      ? DataSourceTypeUtil.getProps(selectedType)
      : undefined;

    const updateConfig: (partial: Partial<DataSourceQueryConfig>) => void = (
      partial: Partial<DataSourceQueryConfig>,
    ): void => {
      const next: Array<DataSourceQueryConfig> = [...queryConfigs];
      next[index] = { ...config, ...partial };
      writeConfigs(next);
    };

    return (
      <div
        key={config.id || index}
        className="rounded-md border border-gray-200 p-3 mb-3 bg-gray-50/50"
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-gray-600">
            {isChart ? `Query ${index + 1}` : "Query"}
          </p>
          <Button
            title="Remove"
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            buttonSize={ButtonSize.Small}
            icon={IconProp.Trash}
            onClick={() => {
              const next: Array<DataSourceQueryConfig> = queryConfigs.filter(
                (_item: DataSourceQueryConfig, itemIndex: number) => {
                  return itemIndex !== index;
                },
              );
              writeConfigs(next);
            }}
          />
        </div>

        <p className="text-xs text-gray-500 mb-1">Data Source</p>
        <Dropdown
          value={dropdownOptions.find((option: DropdownOption) => {
            return option.value === config.dataSourceId;
          })}
          options={dropdownOptions}
          placeholder="Select a data source"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            updateConfig({
              dataSourceId: value ? value.toString() : "",
            });
          }}
        />

        <p className="text-xs text-gray-500 mt-3 mb-1">
          Query{typeProps ? ` (${typeProps.queryLanguageTitle})` : ""}
        </p>
        <TextArea
          initialValue={config.query || ""}
          placeholder={typeProps?.queryPlaceholder || "Enter your query"}
          onChange={(value: string) => {
            updateConfig({ query: value });
          }}
        />
        {selectedType && DataSourceTypeUtil.isDatabaseType(selectedType) && (
          <p className="mt-1 text-xs text-gray-400">
            {isTable
              ? "Any read-only query works — rows render as-is."
              : "Return a time column (time/timestamp) and a numeric value column; extra columns become series labels."}{" "}
            Time macros: $__startTime, $__endTime, $__startTimeMs, $__endTimeMs,
            $__rangeSeconds (UTC). Dashboard variables: {"{{variableName}}"}.
          </p>
        )}
        {selectedType && !DataSourceTypeUtil.isDatabaseType(selectedType) && (
          <p className="mt-1 text-xs text-gray-400">
            Dashboard variables interpolate with {"{{variableName}}"}.
          </p>
        )}

        {!isTable && (
          <>
            <p className="text-xs text-gray-500 mt-3 mb-1">Legend (optional)</p>
            <Input
              value={config.legend || ""}
              placeholder="e.g. {{instance}} — errors"
              onChange={(value: string) => {
                updateConfig({ legend: value || undefined });
              }}
            />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="mt-3">
      <CollapsibleSection
        title="Query"
        description={
          isTable
            ? "Rows to render, from a connected external system (Prometheus, SQL, ClickHouse, Loki, Elasticsearch, REST)."
            : "Data to visualize, from a connected external system (Prometheus, SQL, ClickHouse, Loki, Elasticsearch, REST)."
        }
        variant="bordered"
        /*
         * Never collapsed: on these widget types the query IS the widget,
         * so hiding it behind a disclosure would hide the only setting that
         * makes the widget show anything.
         */
        defaultCollapsed={false}
      >
        <div>
          {loadError && <p className="text-xs text-red-500">{loadError}</p>}
          {!loadError && dataSources.length === 0 && (
            <p className="text-xs text-gray-400">
              No data sources connected yet. Add one under Dashboards → Settings
              → Data Sources.
            </p>
          )}
          {queryConfigs.map(
            (config: DataSourceQueryConfig, index: number): ReactElement => {
              return renderQueryCard(config, index);
            },
          )}
          {dataSources.length > 0 && (isChart || queryConfigs.length === 0) && (
            <Button
              title="Add Query"
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              icon={IconProp.Add}
              onClick={() => {
                writeConfigs([
                  ...queryConfigs,
                  {
                    id: ObjectID.generate().toString(),
                    dataSourceId: "",
                    query: "",
                  },
                ]);
              }}
            />
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default DataSourceQueryEditor;
