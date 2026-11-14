import React, { FunctionComponent, ReactElement, useState } from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import DirectionArrow from "Common/UI/Components/DirectionArrow/DirectionArrow";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import FilterQueryBuilderField from "../FilterQueryBuilder/FilterQueryBuilderField";
import TraceFilterConfig from "../FilterQueryBuilder/TraceFilterConfig";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TracePipelineProcessorType from "Common/Types/Trace/TracePipelineProcessorType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  pipelineId: ObjectID;
  existingProcessor?: TracePipelineProcessor | undefined;
  onProcessorSaved: () => void;
  onCancel: () => void;
}

const processorTypeOptions: Array<DropdownOption> = [
  {
    value: TracePipelineProcessorType.AttributeRemapper,
    label: "Attribute Remapper",
    description:
      "Copy or rename a span attribute (e.g. rename 'http.user_agent' to 'user_agent').",
  },
  {
    value: TracePipelineProcessorType.SpanNameRemapper,
    label: "Span Name Remapper",
    description:
      "Override the span name when a source field matches a value (e.g. route → operation name).",
  },
  {
    value: TracePipelineProcessorType.StatusRemapper,
    label: "Status Remapper",
    description:
      "Override span status (Ok / Error / Unset) based on an attribute value.",
  },
  {
    value: TracePipelineProcessorType.SpanKindRemapper,
    label: "Span Kind Remapper",
    description:
      "Override span kind (Server / Client / Producer / Consumer / Internal) based on an attribute value.",
  },
  {
    value: TracePipelineProcessorType.CategoryProcessor,
    label: "Category Processor",
    description:
      "Tag spans with a category attribute based on filter rules (first match wins).",
  },
];

const statusCodeOptions: Array<DropdownOption> = [
  { value: 0, label: "Unset (0)" },
  { value: 1, label: "Ok (1)" },
  { value: 2, label: "Error (2)" },
];

const spanKindOptions: Array<DropdownOption> = [
  { value: "SPAN_KIND_SERVER", label: "Server" },
  { value: "SPAN_KIND_CLIENT", label: "Client" },
  { value: "SPAN_KIND_PRODUCER", label: "Producer" },
  { value: "SPAN_KIND_CONSUMER", label: "Consumer" },
  { value: "SPAN_KIND_INTERNAL", label: "Internal" },
  { value: "SPAN_KIND_UNSPECIFIED", label: "Unspecified" },
];

interface SpanNameMapping {
  matchValue: string;
  newName: string;
}

interface StatusMapping {
  matchValue: string;
  statusCode: number;
  statusMessage: string;
}

interface SpanKindMapping {
  matchValue: string;
  kind: string;
}

interface CategoryRule {
  name: string;
  filterQuery: string;
}

/*
 * The arrow between a mapping's match value and what it becomes. A row
 * reads from the right on an Arabic or Persian page (the match value is
 * on the right), and "→" is not a character that turns with the line: the
 * arrow is the one that points the way the page reads (DirectionArrow),
 * "←" there. A class that mirrored it as well would turn it back.
 */
export const MAPPING_ARROW_CLASS_NAME: string =
  "text-gray-400 text-sm font-medium";

const asString: (value: JSONValue | undefined, fallback: string) => string = (
  value: JSONValue | undefined,
  fallback: string,
): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

const asBoolean: (
  value: JSONValue | undefined,
  fallback: boolean,
) => boolean = (value: JSONValue | undefined, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
};

const asArray: (value: JSONValue | undefined) => Array<JSONObject> = (
  value: JSONValue | undefined,
): Array<JSONObject> => {
  if (Array.isArray(value)) {
    return value as Array<JSONObject>;
  }
  return [];
};

const TraceProcessorForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isEditMode: boolean = Boolean(props.existingProcessor);
  const existingConfig: JSONObject =
    (props.existingProcessor?.configuration as JSONObject) || {};
  const existingType: string = props.existingProcessor?.processorType || "";

  // Common fields
  const [name, setName] = useState<string>(props.existingProcessor?.name || "");
  const [processorType, setProcessorType] = useState<string>(existingType);
  const [isEnabled, setIsEnabled] = useState<boolean>(
    props.existingProcessor?.isEnabled ?? true,
  );

  // Attribute Remapper fields
  const [attrSourceKey, setAttrSourceKey] = useState<string>(
    existingType === TracePipelineProcessorType.AttributeRemapper
      ? asString(existingConfig["sourceKey"], "")
      : "",
  );
  const [attrTargetKey, setAttrTargetKey] = useState<string>(
    existingType === TracePipelineProcessorType.AttributeRemapper
      ? asString(existingConfig["targetKey"], "")
      : "",
  );
  const [preserveSource, setPreserveSource] = useState<boolean>(
    existingType === TracePipelineProcessorType.AttributeRemapper
      ? asBoolean(existingConfig["preserveSource"], false)
      : false,
  );
  const [overrideOnConflict, setOverrideOnConflict] = useState<boolean>(
    existingType === TracePipelineProcessorType.AttributeRemapper
      ? asBoolean(existingConfig["overrideOnConflict"], true)
      : true,
  );

  // Span Name Remapper fields
  const [spanNameSourceKey, setSpanNameSourceKey] = useState<string>(
    existingType === TracePipelineProcessorType.SpanNameRemapper
      ? asString(existingConfig["sourceKey"], "name")
      : "name",
  );
  const [spanNameMappings, setSpanNameMappings] = useState<
    Array<SpanNameMapping>
  >(() => {
    if (existingType === TracePipelineProcessorType.SpanNameRemapper) {
      const raw: Array<JSONObject> = asArray(existingConfig["mappings"]);
      if (raw.length > 0) {
        return raw.map((m: JSONObject) => {
          return {
            matchValue: asString(m["matchValue"], ""),
            newName: asString(m["newName"], ""),
          };
        });
      }
    }
    return [{ matchValue: "", newName: "" }];
  });

  // Status Remapper fields
  const [statusSourceKey, setStatusSourceKey] = useState<string>(
    existingType === TracePipelineProcessorType.StatusRemapper
      ? asString(existingConfig["sourceKey"], "")
      : "",
  );
  const [statusMappings, setStatusMappings] = useState<Array<StatusMapping>>(
    () => {
      if (existingType === TracePipelineProcessorType.StatusRemapper) {
        const raw: Array<JSONObject> = asArray(existingConfig["mappings"]);
        if (raw.length > 0) {
          return raw.map((m: JSONObject) => {
            return {
              matchValue: asString(m["matchValue"], ""),
              statusCode:
                typeof m["statusCode"] === "number" ? m["statusCode"] : 0,
              statusMessage: asString(m["statusMessage"], ""),
            };
          });
        }
      }
      return [{ matchValue: "", statusCode: 0, statusMessage: "" }];
    },
  );

  // Span Kind Remapper fields
  const [spanKindSourceKey, setSpanKindSourceKey] = useState<string>(
    existingType === TracePipelineProcessorType.SpanKindRemapper
      ? asString(existingConfig["sourceKey"], "")
      : "",
  );
  const [spanKindMappings, setSpanKindMappings] = useState<
    Array<SpanKindMapping>
  >(() => {
    if (existingType === TracePipelineProcessorType.SpanKindRemapper) {
      const raw: Array<JSONObject> = asArray(existingConfig["mappings"]);
      if (raw.length > 0) {
        return raw.map((m: JSONObject) => {
          return {
            matchValue: asString(m["matchValue"], ""),
            kind: asString(m["kind"], ""),
          };
        });
      }
    }
    return [{ matchValue: "", kind: "" }];
  });

  // Category Processor fields
  const [categoryTargetKey, setCategoryTargetKey] = useState<string>(
    existingType === TracePipelineProcessorType.CategoryProcessor
      ? asString(existingConfig["targetKey"], "span_category")
      : "span_category",
  );
  const [categories, setCategories] = useState<Array<CategoryRule>>(() => {
    if (existingType === TracePipelineProcessorType.CategoryProcessor) {
      const raw: Array<JSONObject> = asArray(existingConfig["categories"]);
      if (raw.length > 0) {
        return raw.map((c: JSONObject) => {
          return {
            name: asString(c["name"], ""),
            filterQuery: asString(c["filterQuery"], ""),
          };
        });
      }
    }
    return [{ name: "", filterQuery: "" }];
  });

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const buildConfiguration: () => JSONObject = (): JSONObject => {
    switch (processorType) {
      case TracePipelineProcessorType.AttributeRemapper:
        return {
          sourceKey: attrSourceKey.trim(),
          targetKey: attrTargetKey.trim(),
          preserveSource,
          overrideOnConflict,
        };
      case TracePipelineProcessorType.SpanNameRemapper:
        return {
          sourceKey: spanNameSourceKey.trim(),
          mappings: spanNameMappings
            .filter((m: SpanNameMapping) => {
              return m.matchValue && m.newName;
            })
            .map((m: SpanNameMapping) => {
              return { matchValue: m.matchValue, newName: m.newName };
            }) as unknown as JSONValue,
        };
      case TracePipelineProcessorType.StatusRemapper:
        return {
          sourceKey: statusSourceKey.trim(),
          mappings: statusMappings
            .filter((m: StatusMapping) => {
              return m.matchValue !== "";
            })
            .map((m: StatusMapping) => {
              const entry: JSONObject = {
                matchValue: m.matchValue,
                statusCode: m.statusCode,
              };
              if (m.statusMessage.trim()) {
                entry["statusMessage"] = m.statusMessage.trim();
              }
              return entry;
            }) as unknown as JSONValue,
        };
      case TracePipelineProcessorType.SpanKindRemapper:
        return {
          sourceKey: spanKindSourceKey.trim(),
          mappings: spanKindMappings
            .filter((m: SpanKindMapping) => {
              return m.matchValue && m.kind;
            })
            .map((m: SpanKindMapping) => {
              return { matchValue: m.matchValue, kind: m.kind };
            }) as unknown as JSONValue,
        };
      case TracePipelineProcessorType.CategoryProcessor:
        return {
          targetKey: categoryTargetKey.trim(),
          categories: categories
            .filter((c: CategoryRule) => {
              return c.name && c.filterQuery;
            })
            .map((c: CategoryRule) => {
              return { name: c.name, filterQuery: c.filterQuery };
            }) as unknown as JSONValue,
        };
      default:
        return {};
    }
  };

  const validate: () => string | null = (): string | null => {
    if (!name.trim()) {
      return translationKey("Name is required.");
    }
    if (!processorType) {
      return translationKey("Please select a processor type.");
    }

    switch (processorType) {
      case TracePipelineProcessorType.AttributeRemapper:
        if (!attrSourceKey.trim()) {
          return translationKey("Source key is required.");
        }
        if (!attrTargetKey.trim()) {
          return translationKey("Target key is required.");
        }
        break;
      case TracePipelineProcessorType.SpanNameRemapper: {
        if (!spanNameSourceKey.trim()) {
          return translationKey("Source key is required.");
        }
        const valid: Array<SpanNameMapping> = spanNameMappings.filter(
          (m: SpanNameMapping) => {
            return m.matchValue && m.newName;
          },
        );
        if (valid.length === 0) {
          return translationKey(
            "Add at least one mapping (match value → new span name).",
          );
        }
        break;
      }
      case TracePipelineProcessorType.StatusRemapper: {
        if (!statusSourceKey.trim()) {
          return translationKey("Source key is required.");
        }
        const valid: Array<StatusMapping> = statusMappings.filter(
          (m: StatusMapping) => {
            return m.matchValue !== "";
          },
        );
        if (valid.length === 0) {
          return translationKey(
            "Add at least one mapping (match value → status).",
          );
        }
        break;
      }
      case TracePipelineProcessorType.SpanKindRemapper: {
        if (!spanKindSourceKey.trim()) {
          return translationKey("Source key is required.");
        }
        const valid: Array<SpanKindMapping> = spanKindMappings.filter(
          (m: SpanKindMapping) => {
            return m.matchValue && m.kind;
          },
        );
        if (valid.length === 0) {
          return translationKey(
            "Add at least one mapping (match value → span kind).",
          );
        }
        break;
      }
      case TracePipelineProcessorType.CategoryProcessor: {
        if (!categoryTargetKey.trim()) {
          return translationKey("Target key is required.");
        }
        const valid: Array<CategoryRule> = categories.filter(
          (c: CategoryRule) => {
            return c.name && c.filterQuery;
          },
        );
        if (valid.length === 0) {
          return translationKey("Add at least one category rule.");
        }
        break;
      }
    }

    return null;
  };

  const handleSave: () => Promise<void> = async (): Promise<void> => {
    const validationError: string | null = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      if (
        isEditMode &&
        props.existingProcessor &&
        props.existingProcessor._id
      ) {
        const processor: TracePipelineProcessor = new TracePipelineProcessor();
        processor._id = props.existingProcessor._id;
        processor.name = name.trim();
        processor.processorType = processorType;
        processor.configuration = buildConfiguration();
        processor.isEnabled = isEnabled;

        await ModelAPI.update({
          model: processor,
          modelType: TracePipelineProcessor,
        });
      } else {
        const processor: TracePipelineProcessor = new TracePipelineProcessor();
        processor.name = name.trim();
        processor.processorType = processorType;
        processor.configuration = buildConfiguration();
        processor.isEnabled = isEnabled;
        processor.tracePipelineId = props.pipelineId;
        processor.sortOrder = 1;

        await ModelAPI.create({
          model: processor,
          modelType: TracePipelineProcessor,
        });
      }

      props.onProcessorSaved();
    } catch {
      setError(
        isEditMode
          ? "Failed to update processor. Please try again."
          : "Failed to create processor. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const currentTypeOption: DropdownOption | undefined = processorType
    ? processorTypeOptions.find((opt: DropdownOption) => {
        return opt.value === processorType;
      })
    : undefined;

  return (
    <Modal
      title={isEditMode ? "Edit Processor" : "Add Processor"}
      description="Processors change spans before they are stored. They run in order, after the pipeline's filter matches."
      modalWidth={ModalWidth.Large}
      submitButtonText={isEditMode ? "Save Processor" : "Create Processor"}
      onSubmit={handleSave}
      isLoading={isSaving}
      onClose={props.onCancel}
    >
      <div className="p-2 space-y-5">
        {error && (
          <Alert
            type={AlertType.DANGER}
            title={error}
            onClose={() => {
              setError("");
            }}
          />
        )}

        {/* Name */}
        <div>
          <FieldLabelElement title="Processor Name" />
          <div className="mt-1">
            <Input
              type={InputType.TEXT}
              placeholder="e.g. Normalize HTTP route names"
              value={name}
              onChange={setName}
            />
          </div>
        </div>

        {/* Processor Type */}
        <div>
          <FieldLabelElement
            title="Processor Type"
            description="Choose what this processor does"
          />
          <div className="mt-1">
            <Dropdown
              options={processorTypeOptions}
              value={currentTypeOption}
              placeholder="Select processor type..."
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setProcessorType(value?.toString() || "");
              }}
            />
          </div>
        </div>

        {/* === Attribute Remapper === */}
        {processorType === TracePipelineProcessorType.AttributeRemapper && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Attribute Remapper Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template="Copies or renames a key inside the span's {{attributes}} object. Useful for standardizing attribute names across services."
                slots={{
                  attributes: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      attributes
                    </code>
                  ),
                }}
              />
            </p>

            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Reads the value from {{key}}."
                    slots={{
                      key: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          attributes[sourceKey]
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  <TranslatedSentence
                    template="2. Writes that value to {{key}}."
                    slots={{
                      key: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          attributes[targetKey]
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "3. Optionally removes the original source key (if Preserve Source is off).",
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabelElement
                  title="Source Key"
                  description="The attribute key to read the value from"
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="e.g. http.user_agent"
                    value={attrSourceKey}
                    onChange={setAttrSourceKey}
                  />
                </div>
              </div>
              <div>
                <FieldLabelElement
                  title="Target Key"
                  description="The new attribute key to write the value to"
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="e.g. user_agent"
                    value={attrTargetKey}
                    onChange={setAttrTargetKey}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Toggle
                title="Preserve Source"
                description="Keep the original source attribute after remapping. If off, the source key is removed."
                value={preserveSource}
                onChange={setPreserveSource}
              />
              <Toggle
                title="Override on Conflict"
                description="If the target key already exists, overwrite it. If off and the target exists, the remap is skipped."
                value={overrideOnConflict}
                onChange={setOverrideOnConflict}
              />
            </div>
          </div>
        )}

        {/* === Span Name Remapper === */}
        {processorType === TracePipelineProcessorType.SpanNameRemapper && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Span Name Remapper Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template="Overrides the span name when a source value matches one of the mappings below. Use {{name}} as the Source Key to match on the current span name, or any attribute key to match on an attribute value."
                slots={{
                  name: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      name
                    </code>
                  ),
                }}
              />
            </p>

            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Reads the value from the Source Key (e.g. {{example}})."
                    slots={{
                      example: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          http.route
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "2. Looks up the value in your mappings below.",
                  )}
                </p>
                <p>
                  <TranslatedSentence
                    template="3. If a match is found, the span's {{name}} is updated to the new name."
                    slots={{
                      name: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          name
                        </code>
                      ),
                    }}
                  />
                </p>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Source Key"
                description={
                  'The field to match on. Use "name" for the span name itself, or any attribute key like "http.route".'
                }
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. http.route"
                  value={spanNameSourceKey}
                  onChange={setSpanNameSourceKey}
                />
              </div>
            </div>

            <div>
              <FieldLabelElement
                title="Mappings"
                description="Define how source values map to new span names."
              />
              <div className="mt-2 space-y-2">
                {spanNameMappings.map(
                  (mapping: SpanNameMapping, index: number) => {
                    return (
                      <div
                        key={index}
                        className="grid grid-cols-12 gap-3 items-center p-3 bg-gray-50 rounded-md border border-gray-200"
                      >
                        <div className="col-span-5">
                          <Input
                            type={InputType.TEXT}
                            placeholder="Match value (e.g. /api/v1/users)"
                            value={mapping.matchValue}
                            onChange={(value: string) => {
                              const next: Array<SpanNameMapping> = [
                                ...spanNameMappings,
                              ];
                              next[index] = { ...mapping, matchValue: value };
                              setSpanNameMappings(next);
                            }}
                          />
                        </div>
                        <div className="col-span-1 flex justify-center">
                          <DirectionArrow
                            className={MAPPING_ARROW_CLASS_NAME}
                          />
                        </div>
                        <div className="col-span-5">
                          <Input
                            type={InputType.TEXT}
                            placeholder="New name (e.g. ListUsers)"
                            value={mapping.newName}
                            onChange={(value: string) => {
                              const next: Array<SpanNameMapping> = [
                                ...spanNameMappings,
                              ];
                              next[index] = { ...mapping, newName: value };
                              setSpanNameMappings(next);
                            }}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button
                            ariaLabel="Remove"
                            icon={IconProp.Trash}
                            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                              setSpanNameMappings(
                                spanNameMappings.filter(
                                  (_: SpanNameMapping, i: number) => {
                                    return i !== index;
                                  },
                                ),
                              );
                            }}
                            disabled={spanNameMappings.length <= 1}
                          />
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
              <div className="mt-2">
                <Button
                  title="Add Mapping"
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setSpanNameMappings([
                      ...spanNameMappings,
                      { matchValue: "", newName: "" },
                    ]);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* === Status Remapper === */}
        {processorType === TracePipelineProcessorType.StatusRemapper && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Status Remapper Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              {translator.translateText(
                "Overrides the span's status code and (optionally) status message based on an attribute value.",
              )}
            </p>

            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Reads the value from the Source Key (e.g. {{example}})."
                    slots={{
                      example: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          http.status_code
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "2. Looks up the value in your mappings below.",
                  )}
                </p>
                <p>
                  <TranslatedSentence
                    template="3. If a match is found, sets the span's {{statusCode}} (Unset=0, Ok=1, Error=2) and optional {{statusMessage}}."
                    slots={{
                      statusCode: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          statusCode
                        </code>
                      ),
                      statusMessage: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          statusMessage
                        </code>
                      ),
                    }}
                  />
                </p>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Source Key"
                description="The attribute key to read the value from."
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. http.status_code"
                  value={statusSourceKey}
                  onChange={setStatusSourceKey}
                />
              </div>
            </div>

            <div>
              <FieldLabelElement
                title="Mappings"
                description="Match an attribute value and set the span status."
              />
              <div className="mt-2 space-y-2">
                {statusMappings.map((mapping: StatusMapping, index: number) => {
                  const selectedStatus: DropdownOption | undefined =
                    statusCodeOptions.find((opt: DropdownOption) => {
                      return opt.value === mapping.statusCode;
                    });
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-12 gap-3 items-center p-3 bg-gray-50 rounded-md border border-gray-200"
                    >
                      <div className="col-span-3">
                        <Input
                          type={InputType.TEXT}
                          placeholder="Match value (e.g. 500)"
                          value={mapping.matchValue}
                          onChange={(value: string) => {
                            const next: Array<StatusMapping> = [
                              ...statusMappings,
                            ];
                            next[index] = { ...mapping, matchValue: value };
                            setStatusMappings(next);
                          }}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <DirectionArrow className={MAPPING_ARROW_CLASS_NAME} />
                      </div>
                      <div className="col-span-3">
                        <Dropdown
                          options={statusCodeOptions}
                          value={selectedStatus}
                          placeholder="Status"
                          onChange={(
                            value: DropdownValue | Array<DropdownValue> | null,
                          ) => {
                            const code: number =
                              typeof value === "number"
                                ? value
                                : Number(value?.toString() || "0");
                            const next: Array<StatusMapping> = [
                              ...statusMappings,
                            ];
                            next[index] = { ...mapping, statusCode: code };
                            setStatusMappings(next);
                          }}
                        />
                      </div>
                      <div className="col-span-4">
                        <Input
                          type={InputType.TEXT}
                          placeholder="Optional status message"
                          value={mapping.statusMessage}
                          onChange={(value: string) => {
                            const next: Array<StatusMapping> = [
                              ...statusMappings,
                            ];
                            next[index] = {
                              ...mapping,
                              statusMessage: value,
                            };
                            setStatusMappings(next);
                          }}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          ariaLabel="Remove"
                          icon={IconProp.Trash}
                          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                          buttonSize={ButtonSize.Small}
                          onClick={() => {
                            setStatusMappings(
                              statusMappings.filter(
                                (_: StatusMapping, i: number) => {
                                  return i !== index;
                                },
                              ),
                            );
                          }}
                          disabled={statusMappings.length <= 1}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2">
                <Button
                  title="Add Mapping"
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setStatusMappings([
                      ...statusMappings,
                      { matchValue: "", statusCode: 0, statusMessage: "" },
                    ]);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* === Span Kind Remapper === */}
        {processorType === TracePipelineProcessorType.SpanKindRemapper && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Span Kind Remapper Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              {translator.translateText(
                "Overrides the span kind (Server / Client / Producer / Consumer / Internal) based on an attribute value.",
              )}
            </p>

            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Reads the value from the Source Key (e.g. {{example}})."
                    slots={{
                      example: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          messaging.operation
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "2. Looks up the value in your mappings below.",
                  )}
                </p>
                <p>
                  <TranslatedSentence
                    template="3. If a match is found, sets the span's {{kind}} to the selected span kind."
                    slots={{
                      kind: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          kind
                        </code>
                      ),
                    }}
                  />
                </p>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Source Key"
                description="The attribute key to read the value from."
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. messaging.operation"
                  value={spanKindSourceKey}
                  onChange={setSpanKindSourceKey}
                />
              </div>
            </div>

            <div>
              <FieldLabelElement
                title="Mappings"
                description="Match an attribute value and set the span kind."
              />
              <div className="mt-2 space-y-2">
                {spanKindMappings.map(
                  (mapping: SpanKindMapping, index: number) => {
                    const selectedKind: DropdownOption | undefined =
                      spanKindOptions.find((opt: DropdownOption) => {
                        return opt.value === mapping.kind;
                      });
                    return (
                      <div
                        key={index}
                        className="grid grid-cols-12 gap-3 items-center p-3 bg-gray-50 rounded-md border border-gray-200"
                      >
                        <div className="col-span-5">
                          <Input
                            type={InputType.TEXT}
                            placeholder="Match value (e.g. publish)"
                            value={mapping.matchValue}
                            onChange={(value: string) => {
                              const next: Array<SpanKindMapping> = [
                                ...spanKindMappings,
                              ];
                              next[index] = { ...mapping, matchValue: value };
                              setSpanKindMappings(next);
                            }}
                          />
                        </div>
                        <div className="col-span-1 flex justify-center">
                          <DirectionArrow
                            className={MAPPING_ARROW_CLASS_NAME}
                          />
                        </div>
                        <div className="col-span-5">
                          <Dropdown
                            options={spanKindOptions}
                            value={selectedKind}
                            placeholder="Select span kind..."
                            onChange={(
                              value:
                                | DropdownValue
                                | Array<DropdownValue>
                                | null,
                            ) => {
                              const next: Array<SpanKindMapping> = [
                                ...spanKindMappings,
                              ];
                              next[index] = {
                                ...mapping,
                                kind: value?.toString() || "",
                              };
                              setSpanKindMappings(next);
                            }}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button
                            ariaLabel="Remove"
                            icon={IconProp.Trash}
                            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                              setSpanKindMappings(
                                spanKindMappings.filter(
                                  (_: SpanKindMapping, i: number) => {
                                    return i !== index;
                                  },
                                ),
                              );
                            }}
                            disabled={spanKindMappings.length <= 1}
                          />
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
              <div className="mt-2">
                <Button
                  title="Add Mapping"
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setSpanKindMappings([
                      ...spanKindMappings,
                      { matchValue: "", kind: "" },
                    ]);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* === Category Processor === */}
        {processorType === TracePipelineProcessorType.CategoryProcessor && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Category Processor Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template="Tags each span with a category name based on filter rules. The category value is stored in the span's {{attributes}} object under the Target Key. Rules are evaluated in order — {{firstMatch}}."
                slots={{
                  attributes: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      attributes
                    </code>
                  ),
                  firstMatch: (
                    <strong>
                      {translator.translateText("first match wins")}
                    </strong>
                  ),
                }}
              />
            </p>

            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Each category rule has a filter condition (e.g. {{example}})."
                    slots={{
                      example: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          durationUnixNano &gt; 1000000000
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "2. Rules are evaluated top to bottom. The first rule that matches the span is applied.",
                  )}
                </p>
                <p>
                  <TranslatedSentence
                    template="3. The category name is stored at {{key}} on the span."
                    slots={{
                      key: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          attributes[targetKey]
                        </code>
                      ),
                    }}
                  />
                </p>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Target Key"
                description="The attribute key where the matched category name will be stored."
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. span_category"
                  value={categoryTargetKey}
                  onChange={setCategoryTargetKey}
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                <TranslatedSentence
                  template="The category will be accessible as {{key}} on spans."
                  slots={{
                    key: (
                      <code className="text-gray-500">
                        attributes.{categoryTargetKey || "span_category"}
                      </code>
                    ),
                  }}
                />
              </p>
            </div>

            <div>
              <FieldLabelElement
                title="Category Rules"
                description="Define categories and the filter conditions that trigger them. Rules are evaluated top to bottom — first match wins."
              />
              <div className="mt-2 space-y-3">
                {categories.map((cat: CategoryRule, index: number) => {
                  return (
                    <div
                      key={index}
                      className="p-3 bg-gray-50 rounded-md border border-gray-200 space-y-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
                            {translator.translateText("Category name")}
                          </label>
                          <Input
                            type={InputType.TEXT}
                            placeholder="e.g. Slow Request"
                            value={cat.name}
                            onChange={(value: string) => {
                              const next: Array<CategoryRule> = [...categories];
                              next[index] = { ...cat, name: value };
                              setCategories(next);
                            }}
                          />
                        </div>
                        <div className="flex-shrink-0 pt-5">
                          <Button
                            ariaLabel="Remove"
                            icon={IconProp.Trash}
                            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                              setCategories(
                                categories.filter(
                                  (_: CategoryRule, i: number) => {
                                    return i !== index;
                                  },
                                ),
                              );
                            }}
                            disabled={categories.length <= 1}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
                          {translator.translateText("When spans match")}
                        </label>
                        <FilterQueryBuilderField
                          initialValue={cat.filterQuery || ""}
                          onChange={(value: string) => {
                            const next: Array<CategoryRule> = [...categories];
                            next[index] = { ...cat, filterQuery: value };
                            setCategories(next);
                          }}
                          config={TraceFilterConfig}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2">
                <Button
                  title="Add Category Rule"
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setCategories([
                      ...categories,
                      { name: "", filterQuery: "" },
                    ]);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Enabled toggle */}
        {processorType && (
          <div>
            <Toggle
              title="Enabled"
              description="Enable this processor to start processing spans."
              value={isEnabled}
              onChange={setIsEnabled}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default TraceProcessorForm;
