import LogRecordingRuleFilterEditor from "./LogRecordingRuleFilterEditor";
import Service from "Common/Models/DatabaseModels/Service";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES,
  LogRecordingRuleAggregationOption,
  LogRecordingRuleDefinitionUtil,
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
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * The definition of a log recording rule, as one editor: which logs (the
 * Logs monitor's filters), what is computed from them (a count, or an
 * aggregation of one numeric attribute), what it is split by (up to
 * LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES attributes) and the output
 * metric's unit, with a line saying what the rule will write.
 *
 * The attribute key fields suggest the keys the project's logs carry (the
 * log explorer's attribute list): a key a log pipeline gave a prefix to is
 * easy to get wrong by hand. The suggestions and the service list are best
 * effort - a key can always be typed.
 */

export interface ComponentProps {
  value: LogRecordingRuleDefinition | undefined;
  onChange: (value: LogRecordingRuleDefinition) => void;
}

// The definition as the editor holds it: every list present, nothing dropped.
const toEditable: (
  value: LogRecordingRuleDefinition | undefined,
) => LogRecordingRuleDefinition = (
  value: LogRecordingRuleDefinition | undefined,
): LogRecordingRuleDefinition => {
  const empty: LogRecordingRuleDefinition =
    LogRecordingRuleDefinitionUtil.getEmptyDefinition();
  const parsed: LogRecordingRuleDefinition | null =
    LogRecordingRuleDefinitionUtil.fromJSON(value);

  if (!parsed) {
    return empty;
  }

  const filter: LogRecordingRuleFilter = parsed.filter || {};

  return {
    filter: {
      telemetryServiceIds: filter.telemetryServiceIds || [],
      severityTexts: filter.severityTexts || [],
      body: filter.body || "",
      attributeFilters: filter.attributeFilters || [],
    },
    aggregationType: parsed.aggregationType || empty.aggregationType,
    valueAttribute: parsed.valueAttribute || "",
    groupByAttributes: parsed.groupByAttributes || [],
    unit: parsed.unit || "",
  };
};

const LogRecordingRuleDefinitionEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [definition, setDefinition] = useState<LogRecordingRuleDefinition>(
    toEditable(props.value),
  );
  const [services, setServices] = useState<Array<Service>>([]);
  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [isLoadingAttributeKeys, setIsLoadingAttributeKeys] =
    useState<boolean>(false);

  useEffect(() => {
    props.onChange(definition);
  }, [definition]);

  useEffect(() => {
    const loadServices: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Service> = await ModelAPI.getList<Service>({
          modelType: Service,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

        setServices(result.data || []);
      } catch {
        // Best effort: the rule's own service ids still show without names.
      }
    };

    const loadAttributeKeys: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingAttributeKeys(true);

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/get-attributes",
            ),
            data: {},
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (!(response instanceof HTTPErrorResponse)) {
          setAttributeKeys(
            ((response.data["attributes"] || []) as Array<unknown>).filter(
              (key: unknown): key is string => {
                return typeof key === "string";
              },
            ),
          );
        }
      } catch {
        // Suggestions are best effort; a key can always be typed.
      } finally {
        setIsLoadingAttributeKeys(false);
      }
    };

    void loadServices();
    void loadAttributeKeys();
  }, []);

  const aggregationOptions: Array<DropdownOption> = useMemo(() => {
    return LogRecordingRuleDefinitionUtil.getAggregationOptions().map(
      (option: LogRecordingRuleAggregationOption): DropdownOption => {
        return {
          value: option.value,
          label: option.label,
          description: option.description,
        };
      },
    );
  }, []);

  const needsValueAttribute: boolean =
    LogRecordingRuleDefinitionUtil.needsValueAttribute(
      definition.aggregationType,
    );

  const groupByAttributes: Array<string> = definition.groupByAttributes || [];

  const canAddGroupBy: boolean =
    groupByAttributes.length < LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES;

  const setGroupByAttributes: (keys: Array<string>) => void = (
    keys: Array<string>,
  ): void => {
    setDefinition({ ...definition, groupByAttributes: keys });
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("Which Logs")}
          </h3>
          <p className="text-xs text-gray-500">
            {translator.translateText(
              "The logs that match every filter below are counted or aggregated. Leave a filter empty to match every log.",
            )}
          </p>
        </div>
        <LogRecordingRuleFilterEditor
          filter={definition.filter}
          services={services}
          attributeKeys={attributeKeys}
          isLoadingAttributeKeys={isLoadingAttributeKeys}
          onChange={(filter: LogRecordingRuleFilter) => {
            setDefinition({ ...definition, filter });
          }}
        />
      </section>

      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("Aggregation")}
          </h3>
          <p className="text-xs text-gray-500">
            {translator.translateText(
              "What each minute's point is: how many logs matched, or the sum, average, minimum, maximum or a percentile of a numeric attribute they carry.",
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <FieldLabelElement title="Aggregation" />
            <Dropdown
              ariaLabel="Aggregation"
              isClearable={false}
              options={aggregationOptions}
              value={aggregationOptions.find(
                (option: DropdownOption): boolean => {
                  return option.value === definition.aggregationType;
                },
              )}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value === null || Array.isArray(value)) {
                  return;
                }

                setDefinition({
                  ...definition,
                  aggregationType: value.toString() as AggregationType,
                });
              }}
            />
          </div>
          {needsValueAttribute && (
            <div>
              <FieldLabelElement title="Numeric Attribute" />
              <AutocompleteTextInput
                ariaLabel="Numeric Attribute"
                placeholder="e.g. latency"
                value={definition.valueAttribute || ""}
                suggestions={attributeKeys}
                isLoadingSuggestions={isLoadingAttributeKeys}
                outerDivClassName="relative w-full"
                onChange={(value: string) => {
                  setDefinition({ ...definition, valueAttribute: value });
                }}
              />
              <p className="text-xs text-gray-500 mt-1">
                {translator.translateText(
                  "Its value must be a number (latency=11). Logs where it is missing or not a number are skipped - never counted as 0.",
                )}
              </p>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText("Group By (Optional)")}
            </h3>
            <p className="text-xs text-gray-500">
              {translator.translateTemplate(
                "One series per distinct combination of these attributes' values, written with them, so charts and Metrics monitors can group by them too. Up to {{count}} attributes.",
                { count: LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES },
              )}
            </p>
          </div>
          <span className="text-xs font-medium text-gray-500">
            {translator.translateTemplate("{{used}} / {{max}}", {
              used: groupByAttributes.length,
              max: LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES,
            })}
          </span>
        </div>
        <div className="space-y-3">
          {groupByAttributes.map((key: string, index: number) => {
            return (
              <div
                key={index}
                className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto]"
              >
                <AutocompleteTextInput
                  ariaLabel={translator.translateTemplate(
                    "Group by attribute {{number}}",
                    { number: index + 1 },
                  )}
                  placeholder="e.g. gw_name"
                  value={key}
                  suggestions={attributeKeys}
                  isLoadingSuggestions={isLoadingAttributeKeys}
                  outerDivClassName="relative w-full"
                  onChange={(value: string) => {
                    const next: Array<string> = [...groupByAttributes];
                    next[index] = value;
                    setGroupByAttributes(next);
                  }}
                />
                <Button
                  title=""
                  ariaLabel={translator.translateTemplate(
                    "Remove group by attribute {{number}}",
                    { number: index + 1 },
                  )}
                  icon={IconProp.Trash}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setGroupByAttributes(
                      groupByAttributes.filter(
                        (_key: string, keyIndex: number): boolean => {
                          return keyIndex !== index;
                        },
                      ),
                    );
                  }}
                />
              </div>
            );
          })}
        </div>
        {canAddGroupBy && (
          <div className="mt-3">
            <Button
              title="Add Group By Attribute"
              icon={IconProp.Add}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                setGroupByAttributes([...groupByAttributes, ""]);
              }}
            />
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("Unit (Optional)")}
          </h3>
          <p className="text-xs text-gray-500">
            {translator.translateText(
              "The output metric's unit, shown wherever the metric is charted.",
            )}
          </p>
        </div>
        <div className="md:w-1/2">
          <Input
            ariaLabel="Unit"
            placeholder="e.g. ms"
            value={definition.unit || ""}
            onChange={(value: string) => {
              setDefinition({ ...definition, unit: value });
            }}
          />
        </div>
      </section>

      <div
        className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700"
        data-testid="log-recording-rule-summary"
      >
        {translator.translateText("Writes every minute:")}{" "}
        <code className="font-mono text-indigo-600">
          {LogRecordingRuleDefinitionUtil.describe(definition)}
        </code>
      </div>
    </div>
  );
};

export default LogRecordingRuleDefinitionEditor;
