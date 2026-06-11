import TraceAggregationType from "Common/Types/Trace/TraceAggregationType";
import IconProp from "Common/Types/Icon/IconProp";
import {
  TraceRecordingRuleAttributeFilter,
  TraceRecordingRuleSource,
  TraceRecordingRuleDefinitionUtil,
} from "Common/Types/Trace/TraceRecordingRuleDefinition";
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
import Toggle from "Common/UI/Components/Toggle/Toggle";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  source: TraceRecordingRuleSource;
  canDelete: boolean;
  onChange: (next: TraceRecordingRuleSource) => void;
  onDelete: () => void;
}

const TraceRecordingRuleSourceEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const hasSpanFilter: boolean = Boolean(
    props.source.spanNameRegex ||
      props.source.spanKind ||
      props.source.onlyErrors,
  );
  const hasAttrFilter: boolean = Boolean(
    props.source.filterAttributeKey ||
      props.source.filterAttributeValue ||
      (props.source.filterAttributes &&
        props.source.filterAttributes.length > 0),
  );

  const [showSpanFilter, setShowSpanFilter] = useState<boolean>(hasSpanFilter);
  const [showAttrFilter, setShowAttrFilter] = useState<boolean>(hasAttrFilter);

  /*
   * Rows shown in the editor: the multi-filter array, with the legacy single
   * pair folded in (editing migrates the source to `filterAttributes`).
   * Unlike getSourceAttributeFilters, incomplete rows are kept so the user
   * can type key and value independently.
   */
  const attributeFilterRows: Array<TraceRecordingRuleAttributeFilter> =
    useMemo(() => {
      const rows: Array<TraceRecordingRuleAttributeFilter> = [
        ...(props.source.filterAttributes || []),
      ];
      if (
        (props.source.filterAttributeKey ||
          props.source.filterAttributeValue) &&
        rows.length === 0
      ) {
        rows.push({
          key: props.source.filterAttributeKey || "",
          value: props.source.filterAttributeValue || "",
        });
      }
      if (rows.length === 0) {
        rows.push({ key: "", value: "" });
      }
      return rows;
    }, [props.source]);

  const setAttributeFilterRows: (
    rows: Array<TraceRecordingRuleAttributeFilter>,
  ) => void = (rows: Array<TraceRecordingRuleAttributeFilter>): void => {
    const next: TraceRecordingRuleSource = { ...props.source };
    // Editing migrates the legacy pair into the array form.
    delete next.filterAttributeKey;
    delete next.filterAttributeValue;
    if (rows.length > 0) {
      next.filterAttributes = rows;
    } else {
      delete next.filterAttributes;
    }
    props.onChange(next);
  };

  const aggregationOptions: Array<DropdownOption> = useMemo(() => {
    return TraceRecordingRuleDefinitionUtil.getAggregationOptions().map(
      (opt: {
        value: TraceAggregationType;
        label: string;
        description: string;
      }) => {
        return { value: opt.value, label: opt.label };
      },
    );
  }, []);

  const spanKindOptions: Array<DropdownOption> = useMemo(() => {
    return TraceRecordingRuleDefinitionUtil.getSpanKindOptions().map(
      (opt: { value: string; label: string }) => {
        return { value: opt.value, label: opt.label };
      },
    );
  }, []);

  const update: (patch: Partial<TraceRecordingRuleSource>) => void = (
    patch: Partial<TraceRecordingRuleSource>,
  ): void => {
    props.onChange({ ...props.source, ...patch });
  };

  const clearSpanFilter: () => void = (): void => {
    const next: TraceRecordingRuleSource = { ...props.source };
    delete next.spanNameRegex;
    delete next.spanKind;
    delete next.onlyErrors;
    props.onChange(next);
  };

  const clearAttributeFilter: () => void = (): void => {
    const next: TraceRecordingRuleSource = { ...props.source };
    delete next.filterAttributeKey;
    delete next.filterAttributeValue;
    delete next.filterAttributes;
    props.onChange(next);
  };

  const setSpanKind: (value: string) => void = (value: string): void => {
    if (!value) {
      const next: TraceRecordingRuleSource = { ...props.source };
      delete next.spanKind;
      props.onChange(next);
      return;
    }
    update({ spanKind: value });
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

      <div>
        <FieldLabelElement title="Aggregation" />
        <Dropdown
          value={aggregationOptions.find((o: DropdownOption) => {
            return o.value === props.source.aggregationType;
          })}
          options={aggregationOptions}
          onChange={(v: DropdownValue | Array<DropdownValue> | null) => {
            update({
              aggregationType: v?.toString() as TraceAggregationType,
            });
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!showSpanFilter && (
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            onClick={() => {
              return setShowSpanFilter(true);
            }}
          >
            + Span filter
          </button>
        )}
        {!showAttrFilter && (
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            onClick={() => {
              return setShowAttrFilter(true);
            }}
          >
            + Attribute filter
          </button>
        )}
      </div>

      {showSpanFilter && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              Span Filter
            </span>
            <button
              type="button"
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
              onClick={() => {
                setShowSpanFilter(false);
                clearSpanFilter();
              }}
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FieldLabelElement title="Span Name (regex)" />
              <Input
                placeholder="^GET /api/"
                value={props.source.spanNameRegex || ""}
                onChange={(v: string) => {
                  update({ spanNameRegex: v });
                }}
              />
            </div>
            <div>
              <FieldLabelElement title="Span Kind" />
              <Dropdown
                value={spanKindOptions.find((o: DropdownOption) => {
                  return o.value === (props.source.spanKind || "");
                })}
                options={spanKindOptions}
                onChange={(v: DropdownValue | Array<DropdownValue> | null) => {
                  setSpanKind(v?.toString() || "");
                }}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Toggle
              value={Boolean(props.source.onlyErrors)}
              onChange={(v: boolean) => {
                update({ onlyErrors: v });
              }}
            />
            <span className="text-sm text-gray-700">
              Only count spans with status = error
            </span>
          </div>
        </div>
      )}

      {showAttrFilter && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              Attribute Filters (ANDed)
            </span>
            <button
              type="button"
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
              onClick={() => {
                setShowAttrFilter(false);
                clearAttributeFilter();
              }}
            >
              Remove all
            </button>
          </div>
          <div className="space-y-3">
            {attributeFilterRows.map(
              (row: TraceRecordingRuleAttributeFilter, index: number) => {
                return (
                  <div
                    key={index}
                    className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_auto]"
                  >
                    <div>
                      <FieldLabelElement title="Attribute Key" />
                      <Input
                        placeholder="e.g. http.route"
                        value={row.key}
                        onChange={(v: string) => {
                          const next: Array<TraceRecordingRuleAttributeFilter> =
                            [...attributeFilterRows];
                          next[index] = { ...next[index]!, key: v };
                          setAttributeFilterRows(next);
                        }}
                      />
                    </div>
                    <div>
                      <FieldLabelElement title="Equals" />
                      <Input
                        placeholder="e.g. /Shipment/ShipShipment"
                        value={row.value}
                        onChange={(v: string) => {
                          const next: Array<TraceRecordingRuleAttributeFilter> =
                            [...attributeFilterRows];
                          next[index] = { ...next[index]!, value: v };
                          setAttributeFilterRows(next);
                        }}
                      />
                    </div>
                    <Button
                      title=""
                      icon={IconProp.Trash}
                      buttonStyle={ButtonStyleType.OUTLINE}
                      buttonSize={ButtonSize.Small}
                      onClick={() => {
                        const next: Array<TraceRecordingRuleAttributeFilter> =
                          attributeFilterRows.filter(
                            (
                              _row: TraceRecordingRuleAttributeFilter,
                              i: number,
                            ): boolean => {
                              return i !== index;
                            },
                          );
                        setAttributeFilterRows(next);
                        if (next.length === 0) {
                          setShowAttrFilter(false);
                        }
                      }}
                    />
                  </div>
                );
              },
            )}
          </div>
          <button
            type="button"
            className="mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-700"
            onClick={() => {
              setAttributeFilterRows([
                ...attributeFilterRows,
                { key: "", value: "" },
              ]);
            }}
          >
            + Add another attribute
          </button>
        </div>
      )}
    </div>
  );
};

export default TraceRecordingRuleSourceEditor;
