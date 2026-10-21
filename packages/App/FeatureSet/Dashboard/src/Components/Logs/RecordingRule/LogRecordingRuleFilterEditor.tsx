import Service from "Common/Models/DatabaseModels/Service";
import IconProp from "Common/Types/Icon/IconProp";
import LogSeverity from "Common/Types/Log/LogSeverity";
import {
  LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS,
  LogRecordingRuleAttributeFilter,
  LogRecordingRuleFilter,
} from "Common/Types/Log/LogRecordingRuleDefinition";
import AutocompleteTextInput from "Common/UI/Components/AutocompleteTextInput/AutocompleteTextInput";
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
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * Which logs a log recording rule reads: the Logs monitor's filters
 * (telemetry services, severities, text in the body, attributes), all
 * optional and ANDed. Rows of the attribute filter are kept as typed -
 * a key with no value yet included - so the definition's validation can
 * say what is missing instead of a half-typed row silently vanishing.
 */

export interface ComponentProps {
  filter: LogRecordingRuleFilter;
  services: Array<Service>;
  attributeKeys: Array<string>;
  isLoadingAttributeKeys: boolean;
  onChange: (filter: LogRecordingRuleFilter) => void;
}

const LogRecordingRuleFilterEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const selectedServiceIds: Array<string> = (
    props.filter.telemetryServiceIds || []
  ).map((id: string): string => {
    return id.toLowerCase();
  });

  /*
   * Every project service, and any id the rule names that is no longer one
   * (a deleted service) - so it can still be seen and removed.
   */
  const serviceOptions: Array<DropdownOption> = useMemo(() => {
    const options: Array<DropdownOption> = props.services
      .filter((service: Service): boolean => {
        return Boolean(service.id);
      })
      .map((service: Service): DropdownOption => {
        return {
          label: service.name || service.id!.toString(),
          value: service.id!.toString().toLowerCase(),
        };
      });

    for (const id of selectedServiceIds) {
      if (
        !options.some((option: DropdownOption): boolean => {
          return option.value === id;
        })
      ) {
        options.push({ label: id, value: id });
      }
    }

    return options;
  }, [props.services, props.filter.telemetryServiceIds]);

  const severityOptions: Array<DropdownOption> = useMemo(() => {
    return DropdownUtil.getDropdownOptionsFromEnum(LogSeverity);
  }, []);

  const attributeFilterRows: Array<LogRecordingRuleAttributeFilter> =
    props.filter.attributeFilters || [];

  const update: (patch: Partial<LogRecordingRuleFilter>) => void = (
    patch: Partial<LogRecordingRuleFilter>,
  ): void => {
    props.onChange({ ...props.filter, ...patch });
  };

  const toValues: (
    value: DropdownValue | Array<DropdownValue> | null,
  ) => Array<string> = (
    value: DropdownValue | Array<DropdownValue> | null,
  ): Array<string> => {
    if (value === null || value === undefined) {
      return [];
    }

    return (Array.isArray(value) ? value : [value]).map(
      (item: DropdownValue): string => {
        return item.toString();
      },
    );
  };

  const setAttributeFilterRows: (
    rows: Array<LogRecordingRuleAttributeFilter>,
  ) => void = (rows: Array<LogRecordingRuleAttributeFilter>): void => {
    update({ attributeFilters: rows });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <FieldLabelElement title="Telemetry Services" />
          <Dropdown
            isMultiSelect={true}
            ariaLabel="Telemetry Services"
            placeholder="All services"
            options={serviceOptions}
            value={serviceOptions.filter((option: DropdownOption): boolean => {
              return selectedServiceIds.includes(option.value.toString());
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              update({ telemetryServiceIds: toValues(value) });
            }}
          />
        </div>
        <div>
          <FieldLabelElement title="Severities" />
          <Dropdown
            isMultiSelect={true}
            ariaLabel="Severities"
            placeholder="All severities"
            options={severityOptions}
            value={severityOptions.filter((option: DropdownOption): boolean => {
              return (props.filter.severityTexts || []).includes(
                option.value as LogSeverity,
              );
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              update({
                severityTexts: toValues(value) as Array<LogSeverity>,
              });
            }}
          />
        </div>
      </div>

      <div>
        <FieldLabelElement
          title="Body Contains"
          description="Only logs whose body contains this text (not case-sensitive)."
        />
        <Input
          ariaLabel="Body Contains"
          placeholder='e.g. log_type="SD-WAN"'
          value={props.filter.body || ""}
          onChange={(value: string) => {
            update({ body: value });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Attribute Filters"
          description="Only logs that carry each of these attributes with exactly this value. Keys match whatever their case."
        />
        <div className="space-y-3 mt-2">
          {attributeFilterRows.map(
            (row: LogRecordingRuleAttributeFilter, index: number) => {
              return (
                <div
                  key={index}
                  className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_1fr_auto]"
                >
                  <AutocompleteTextInput
                    ariaLabel={translator.translateTemplate(
                      "Attribute filter {{number}} key",
                      { number: index + 1 },
                    )}
                    placeholder="e.g. log_component"
                    value={row.key}
                    suggestions={props.attributeKeys}
                    isLoadingSuggestions={props.isLoadingAttributeKeys}
                    outerDivClassName="relative w-full"
                    onChange={(value: string) => {
                      const next: Array<LogRecordingRuleAttributeFilter> = [
                        ...attributeFilterRows,
                      ];
                      next[index] = { ...next[index]!, key: value };
                      setAttributeFilterRows(next);
                    }}
                  />
                  <Input
                    ariaLabel={translator.translateTemplate(
                      "Attribute filter {{number}} value",
                      { number: index + 1 },
                    )}
                    placeholder="e.g. SLA"
                    value={row.value}
                    onChange={(value: string) => {
                      const next: Array<LogRecordingRuleAttributeFilter> = [
                        ...attributeFilterRows,
                      ];
                      next[index] = { ...next[index]!, value: value };
                      setAttributeFilterRows(next);
                    }}
                  />
                  <Button
                    title=""
                    ariaLabel={translator.translateTemplate(
                      "Remove attribute filter {{number}}",
                      { number: index + 1 },
                    )}
                    icon={IconProp.Trash}
                    buttonStyle={ButtonStyleType.OUTLINE}
                    buttonSize={ButtonSize.Small}
                    onClick={() => {
                      setAttributeFilterRows(
                        attributeFilterRows.filter(
                          (
                            _row: LogRecordingRuleAttributeFilter,
                            rowIndex: number,
                          ): boolean => {
                            return rowIndex !== index;
                          },
                        ),
                      );
                    }}
                  />
                </div>
              );
            },
          )}
        </div>
        {attributeFilterRows.length <
          LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS && (
          <div className="mt-3">
            <Button
              title="Add Attribute Filter"
              icon={IconProp.Add}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                setAttributeFilterRows([
                  ...attributeFilterRows,
                  { key: "", value: "" },
                ]);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default LogRecordingRuleFilterEditor;
