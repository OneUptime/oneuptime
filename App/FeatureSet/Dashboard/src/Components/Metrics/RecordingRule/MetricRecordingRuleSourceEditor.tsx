import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import IconProp from "Common/Types/Icon/IconProp";
import {
  RecordingRuleSource,
  RecordingRuleDefinitionUtil,
} from "Common/Types/Metrics/RecordingRuleDefinition";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  source: RecordingRuleSource;
  index: number;
  canDelete: boolean;
  onChange: (next: RecordingRuleSource) => void;
  onDelete: () => void;
}

const MetricRecordingRuleSourceEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showFilter, setShowFilter] = useState<boolean>(
    Boolean(
      props.source.filterAttributeKey || props.source.filterAttributeValue,
    ),
  );

  const aggregationOptions: Array<DropdownOption> = useMemo(() => {
    return RecordingRuleDefinitionUtil.getAggregationOptions().map(
      (opt: { value: AggregationType; label: string }) => {
        return { value: opt.value, label: opt.label };
      },
    );
  }, []);

  const update: (patch: Partial<RecordingRuleSource>) => void = (
    patch: Partial<RecordingRuleSource>,
  ): void => {
    props.onChange({ ...props.source, ...patch });
  };

  const clearAttributeFilter: () => void = (): void => {
    const next: RecordingRuleSource = { ...props.source };
    delete next.filterAttributeKey;
    delete next.filterAttributeValue;
    props.onChange(next);
  };

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-mono font-semibold text-sm">
            {props.source.alias}
          </span>
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Source {props.source.alias}
            </div>
            <div className="text-xs text-gray-500">
              Reference as{" "}
              <code className="font-mono text-indigo-600">
                {props.source.alias}
              </code>{" "}
              in the expression.
            </div>
          </div>
        </div>
        {props.canDelete && (
          <Button
            title="Remove"
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              props.onDelete();
            }}
          />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <FieldLabelElement title="Metric Name" />
          <Input
            placeholder="e.g. http.server.errors"
            value={props.source.metricName}
            onChange={(v: string) => {
              update({ metricName: v });
            }}
          />
        </div>
        <div>
          <FieldLabelElement title="Aggregation" />
          <Dropdown
            value={aggregationOptions.find((o: DropdownOption) => {
              return o.value === props.source.aggregationType;
            })}
            options={aggregationOptions}
            onChange={(v: DropdownValue | Array<DropdownValue> | null) => {
              update({ aggregationType: v?.toString() as AggregationType });
            }}
          />
        </div>
      </div>

      <div className="mt-3">
        {!showFilter ? (
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            onClick={() => {
              return setShowFilter(true);
            }}
          >
            + Add attribute filter (optional)
          </button>
        ) : (
          <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                Attribute Filter
              </span>
              <button
                type="button"
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
                onClick={() => {
                  setShowFilter(false);
                  clearAttributeFilter();
                }}
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <FieldLabelElement title="Attribute Key" />
                <Input
                  placeholder="e.g. http.status_code_class"
                  value={props.source.filterAttributeKey || ""}
                  onChange={(v: string) => {
                    update({ filterAttributeKey: v });
                  }}
                />
              </div>
              <div>
                <FieldLabelElement title="Equals" />
                <Input
                  placeholder="e.g. 5xx"
                  value={props.source.filterAttributeValue || ""}
                  onChange={(v: string) => {
                    update({ filterAttributeValue: v });
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Only data points where{" "}
              <code className="font-mono">attribute = value</code> are included
              in this source.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricRecordingRuleSourceEditor;
