import React, { FunctionComponent, ReactElement } from "react";
import {
  TableColumn,
  TableColumnKind,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import Input, { InputType } from "Common/UI/Components/Input/Input";

export interface ComponentProps {
  columns: Array<TableColumn>;
  metricTypes: Array<MetricType>;
  onChange: (columns: Array<TableColumn>) => void;
}

const TableColumnsEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: Array<TableColumn> = props.columns || [];

  const metricNameOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromArray(
      props.metricTypes.map((m: MetricType): string => {
        return m.name || "";
      }),
    );

  const aggregationOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(MetricsAggregationType);

  const usedVariables: Set<string> = new Set(
    columns.map((c: TableColumn): string => {
      return c.variable;
    }),
  );

  const nextVariableLetter: () => string = (): string => {
    for (let i: number = 0; i < 26; i++) {
      const candidate: string = String.fromCharCode(97 + i);
      if (!usedVariables.has(candidate)) {
        return candidate;
      }
    }
    return `v${columns.length + 1}`;
  };

  const updateColumn: (index: number, patch: Partial<TableColumn>) => void = (
    index: number,
    patch: Partial<TableColumn>,
  ): void => {
    const next: Array<TableColumn> = [...columns];
    next[index] = { ...next[index]!, ...patch };
    props.onChange(next);
  };

  const removeColumn: (index: number) => void = (index: number): void => {
    const next: Array<TableColumn> = [...columns];
    next.splice(index, 1);
    props.onChange(next);
  };

  const addColumn: (kind: TableColumnKind) => void = (
    kind: TableColumnKind,
  ): void => {
    const variable: string = nextVariableLetter();
    const newColumn: TableColumn =
      kind === TableColumnKind.Metric
        ? {
            id: ObjectID.generate().toString(),
            variable,
            header: `Column ${columns.length + 1}`,
            kind: TableColumnKind.Metric,
            metricName: undefined,
            aggregation: MetricsAggregationType.Avg,
            decimals: 2,
          }
        : {
            id: ObjectID.generate().toString(),
            variable,
            header: `Formula ${columns.length + 1}`,
            kind: TableColumnKind.Formula,
            formula: "",
            decimals: 2,
          };
    props.onChange([...columns, newColumn]);
  };

  const referenceVariables: string = columns
    .filter((c: TableColumn): boolean => {
      return c.variable !== "" && c.variable !== undefined;
    })
    .map((c: TableColumn): string => {
      return c.variable;
    })
    .join(", ");

  return (
    <div className="mt-2 space-y-3">
      {columns.length === 0 && (
        <div className="text-xs text-gray-400 italic px-3 py-4 border border-dashed border-gray-200 rounded-lg text-center">
          No columns yet. Add a metric or formula column to get started.
        </div>
      )}

      {columns.map((column: TableColumn, index: number): ReactElement => {
        const isMetric: boolean = column.kind === TableColumnKind.Metric;
        const isFormula: boolean = column.kind === TableColumnKind.Formula;

        const selectedMetricName: DropdownOption | undefined = column.metricName
          ? metricNameOptions.find((o: DropdownOption): boolean => {
              return String(o.value) === column.metricName;
            })
          : undefined;

        const selectedAggregation: DropdownOption | undefined =
          column.aggregation
            ? aggregationOptions.find((o: DropdownOption): boolean => {
                return String(o.value) === column.aggregation;
              })
            : undefined;

        return (
          <div
            key={column.id}
            className="p-3 border border-gray-200 rounded-lg bg-gray-50"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-5 px-1.5 rounded bg-indigo-100 text-indigo-700 text-xs font-semibold">
                  {column.variable}
                </span>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {isMetric ? "Metric column" : "Formula column"}
                </span>
              </div>
              <Button
                title="Remove"
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                icon={IconProp.Trash}
                onClick={() => {
                  removeColumn(index);
                }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Header
                </label>
                <Input
                  type={InputType.TEXT}
                  value={column.header}
                  placeholder="Column header"
                  onChange={(value: string): void => {
                    updateColumn(index, { header: value });
                  }}
                />
              </div>

              {isMetric && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Metric
                  </label>
                  <Dropdown
                    options={metricNameOptions}
                    value={selectedMetricName}
                    placeholder="Pick a metric"
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ): void => {
                      updateColumn(index, {
                        metricName: value ? String(value) : undefined,
                      });
                    }}
                  />
                </div>
              )}

              {isMetric && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Aggregation
                  </label>
                  <Dropdown
                    options={aggregationOptions}
                    value={selectedAggregation}
                    placeholder="Avg"
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ): void => {
                      updateColumn(index, {
                        aggregation: value
                          ? (String(value) as MetricsAggregationType)
                          : undefined,
                      });
                    }}
                  />
                </div>
              )}

              {isFormula && (
                <div className="md:col-span-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Formula
                  </label>
                  <Input
                    type={InputType.TEXT}
                    value={column.formula || ""}
                    placeholder="(a / b) * 100"
                    onChange={(value: string): void => {
                      updateColumn(index, { formula: value });
                    }}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    {referenceVariables
                      ? `Available variables: ${referenceVariables}`
                      : "Add a metric column first to reference its variable."}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Decimals
                </label>
                <Input
                  type={InputType.NUMBER}
                  value={
                    typeof column.decimals === "number"
                      ? String(column.decimals)
                      : ""
                  }
                  placeholder="2"
                  onChange={(value: string): void => {
                    const parsed: number = parseInt(value, 10);
                    updateColumn(index, {
                      decimals: Number.isFinite(parsed) ? parsed : undefined,
                    });
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Suffix
                </label>
                <Input
                  type={InputType.TEXT}
                  value={column.suffix || ""}
                  placeholder="e.g. %, ms, GB"
                  onChange={(value: string): void => {
                    updateColumn(index, { suffix: value || undefined });
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex gap-2 pt-1">
        <Button
          title="Add Metric Column"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Add}
          onClick={(): void => {
            addColumn(TableColumnKind.Metric);
          }}
        />
        <Button
          title="Add Formula Column"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Add}
          onClick={(): void => {
            addColumn(TableColumnKind.Formula);
          }}
        />
      </div>
    </div>
  );
};

export default TableColumnsEditor;
