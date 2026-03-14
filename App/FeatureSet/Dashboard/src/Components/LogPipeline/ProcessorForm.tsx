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
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import SeverityMappingRow, { SeverityMapping } from "./SeverityMappingRow";
import { JSONObject } from "Common/Types/JSON";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";

export interface ComponentProps {
  pipelineId: ObjectID;
  onProcessorCreated: () => void;
  onCancel: () => void;
}

type ProcessorType =
  | "SeverityRemapper"
  | "AttributeRemapper"
  | "CategoryProcessor"
  | "";

const processorTypeOptions: Array<DropdownOption> = [
  {
    value: "SeverityRemapper",
    label: "Severity Remapper",
    description:
      "Reads a raw value (e.g. 'warn') from a log attribute and maps it to a standard severity level (e.g. WARNING)",
  },
  {
    value: "AttributeRemapper",
    label: "Attribute Remapper",
    description:
      "Renames or copies a log attribute key to a new key (e.g. rename 'src_ip' to 'source_ip')",
  },
  {
    value: "CategoryProcessor",
    label: "Category Processor",
    description:
      "Tags logs with a category name based on filter rules. Stored in log attributes for easy searching.",
  },
];

interface CategoryRule {
  name: string;
  filterQuery: string;
}

const ProcessorForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Common fields
  const [name, setName] = useState<string>("");
  const [processorType, setProcessorType] = useState<ProcessorType>("");
  const [isEnabled, setIsEnabled] = useState<boolean>(true);

  // Severity Remapper fields
  const [severitySourceKey, setSeveritySourceKey] = useState<string>("level");
  const [severityMappings, setSeverityMappings] = useState<
    Array<SeverityMapping>
  >([{ matchValue: "", severityText: "", severityNumber: 0 }]);

  // Attribute Remapper fields
  const [attrSourceKey, setAttrSourceKey] = useState<string>("");
  const [attrTargetKey, setAttrTargetKey] = useState<string>("");
  const [preserveSource, setPreserveSource] = useState<boolean>(false);
  const [overrideOnConflict, setOverrideOnConflict] = useState<boolean>(true);

  // Category Processor fields
  const [categoryTargetKey, setCategoryTargetKey] =
    useState<string>("category");
  const [categories, setCategories] = useState<Array<CategoryRule>>([
    { name: "", filterQuery: "" },
  ]);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const buildConfiguration: () => JSONObject = (): JSONObject => {
    switch (processorType) {
      case "SeverityRemapper":
        return {
          sourceKey: severitySourceKey,
          mappings: severityMappings.filter((m: SeverityMapping) => {
            return m.matchValue && m.severityText;
          }),
        };
      case "AttributeRemapper":
        return {
          sourceKey: attrSourceKey,
          targetKey: attrTargetKey,
          preserveSource,
          overrideOnConflict,
        };
      case "CategoryProcessor":
        return {
          targetKey: categoryTargetKey,
          categories: categories.filter((c: CategoryRule) => {
            return c.name && c.filterQuery;
          }),
        };
      default:
        return {};
    }
  };

  const validate: () => string | null = (): string | null => {
    if (!name.trim()) {
      return "Name is required.";
    }
    if (!processorType) {
      return "Please select a processor type.";
    }

    switch (processorType) {
      case "SeverityRemapper": {
        if (!severitySourceKey.trim()) {
          return "Source key is required for Severity Remapper.";
        }
        const validMappings: Array<SeverityMapping> = severityMappings.filter(
          (m: SeverityMapping) => {
            return m.matchValue && m.severityText;
          },
        );
        if (validMappings.length === 0) {
          return "At least one severity mapping is required.";
        }
        break;
      }
      case "AttributeRemapper":
        if (!attrSourceKey.trim()) {
          return "Source key is required.";
        }
        if (!attrTargetKey.trim()) {
          return "Target key is required.";
        }
        break;
      case "CategoryProcessor": {
        if (!categoryTargetKey.trim()) {
          return "Target key is required.";
        }
        const validCategories: Array<CategoryRule> = categories.filter(
          (c: CategoryRule) => {
            return c.name && c.filterQuery;
          },
        );
        if (validCategories.length === 0) {
          return "At least one category rule is required.";
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
      const processor: LogPipelineProcessor = new LogPipelineProcessor();
      processor.name = name;
      processor.processorType = processorType;
      processor.configuration = buildConfiguration();
      processor.isEnabled = isEnabled;
      processor.logPipelineId = props.pipelineId;

      await ModelAPI.create({
        model: processor,
        modelType: LogPipelineProcessor,
      });

      props.onProcessorCreated();
    } catch {
      setError("Failed to create processor. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Add Processor"
      description="Processors transform logs as they flow through the pipeline. They run in order after the filter conditions match. Each processor modifies the log before it is stored."
      modalWidth={ModalWidth.Large}
      submitButtonText="Create Processor"
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
              placeholder="e.g. Remap severity levels"
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
              value={
                processorType
                  ? processorTypeOptions.find((opt: DropdownOption) => {
                      return opt.value === processorType;
                    })
                  : undefined
              }
              placeholder="Select processor type..."
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setProcessorType((value?.toString() as ProcessorType) || "");
              }}
            />
          </div>
        </div>

        {/* === Severity Remapper Configuration === */}
        {processorType === "SeverityRemapper" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              Severity Remapper Configuration
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              Normalizes raw severity values from your logs into standard levels
              (TRACE, DEBUG, INFO, WARNING, ERROR, FATAL). This processor reads
              a value from a log attribute and maps it to the log&apos;s{" "}
              <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                severityText
              </code>{" "}
              field.
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                How it works
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  1. The processor reads the value from the Source Attribute in
                  your log&apos;s{" "}
                  <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                    attributes
                  </code>{" "}
                  object.
                </p>
                <p>2. It looks up the value in your mappings below.</p>
                <p>
                  3. If a match is found, the log&apos;s{" "}
                  <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                    severityText
                  </code>{" "}
                  is updated to the mapped severity level.
                </p>
              </div>
              <div className="mt-2 p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed">
                <span className="text-gray-500">// Example: incoming log</span>
                <br />
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;level&quot;</span>:{" "}
                <span className="text-sky-400">&quot;warn&quot;</span> {"}"}
                <br />
                <span className="text-gray-500">
                  // After processing (with mapping: warn → WARNING)
                </span>
                <br />
                <span className="text-amber-400">severityText</span>:{" "}
                <span className="text-sky-400">&quot;WARNING&quot;</span>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Source Attribute"
                description={
                  'The key in your log\'s attributes object that contains the raw severity value. Many logging libraries (Pino, Winston, Bunyan) use "level" by default.'
                }
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. level"
                  value={severitySourceKey}
                  onChange={setSeveritySourceKey}
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                Common values: <code className="text-gray-500">level</code>,{" "}
                <code className="text-gray-500">log_level</code>,{" "}
                <code className="text-gray-500">severity</code>,{" "}
                <code className="text-gray-500">priority</code>
              </p>
            </div>

            <div>
              <FieldLabelElement
                title="Mappings"
                description="Define how raw attribute values map to standard severity levels. The match value should be exactly what your application emits."
              />
              <div className="mt-2 space-y-2">
                {severityMappings.map(
                  (mapping: SeverityMapping, index: number) => {
                    return (
                      <SeverityMappingRow
                        key={index}
                        mapping={mapping}
                        canDelete={severityMappings.length > 1}
                        onChange={(updated: SeverityMapping) => {
                          const newMappings: Array<SeverityMapping> = [
                            ...severityMappings,
                          ];
                          newMappings[index] = updated;
                          setSeverityMappings(newMappings);
                        }}
                        onDelete={() => {
                          setSeverityMappings(
                            severityMappings.filter(
                              (_: SeverityMapping, i: number) => {
                                return i !== index;
                              },
                            ),
                          );
                        }}
                      />
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
                    setSeverityMappings([
                      ...severityMappings,
                      {
                        matchValue: "",
                        severityText: "",
                        severityNumber: 0,
                      },
                    ]);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* === Attribute Remapper Configuration === */}
        {processorType === "AttributeRemapper" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              Attribute Remapper Configuration
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              Renames or copies a key inside the log&apos;s{" "}
              <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                attributes
              </code>{" "}
              object. Useful for standardizing attribute names across services
              or cleaning up legacy key names.
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                How it works
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  1. Reads the value from{" "}
                  <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                    attributes[sourceKey]
                  </code>
                  .
                </p>
                <p>
                  2. Writes that value to{" "}
                  <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                    attributes[targetKey]
                  </code>
                  .
                </p>
                <p>
                  3. Optionally removes the original source key (if Preserve
                  Source is off).
                </p>
              </div>
              <div className="mt-2 p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed">
                <span className="text-gray-500">
                  // Before: attributes has &quot;src_ip&quot;
                </span>
                <br />
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;src_ip&quot;</span>:{" "}
                <span className="text-sky-400">&quot;10.0.1.5&quot;</span> {"}"}
                <br />
                <span className="text-gray-500">
                  // After: renamed to &quot;source_ip&quot;
                </span>
                <br />
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;source_ip&quot;</span>:{" "}
                <span className="text-sky-400">&quot;10.0.1.5&quot;</span> {"}"}
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
                    placeholder="e.g. src_ip"
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
                    placeholder="e.g. source_ip"
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
                description="If the target key already exists, overwrite its value. If off and the target exists, the remap is skipped."
                value={overrideOnConflict}
                onChange={setOverrideOnConflict}
              />
            </div>
          </div>
        )}

        {/* === Category Processor Configuration === */}
        {processorType === "CategoryProcessor" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              Category Processor Configuration
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              Tags each log with a category name based on filter rules. The
              category value is stored in the log&apos;s{" "}
              <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                attributes
              </code>{" "}
              object under the Target Attribute key. Rules are evaluated in
              order and <strong>the first matching rule wins</strong>.
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                How it works
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  1. Each category rule has a filter condition (e.g.{" "}
                  <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                    severityText = &apos;ERROR&apos;
                  </code>
                  ).
                </p>
                <p>
                  2. The processor evaluates rules top to bottom. The first rule
                  that matches the log is applied.
                </p>
                <p>
                  3. The category name is stored at{" "}
                  <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                    attributes[targetAttribute]
                  </code>{" "}
                  on the log.
                </p>
                <p>
                  4. You can then filter and search logs by this attribute in
                  the Logs Viewer.
                </p>
              </div>
              <div className="mt-2 p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed">
                <span className="text-gray-500">
                  // Rule: &quot;Critical Errors&quot; when severityText =
                  &apos;ERROR&apos;
                </span>
                <br />
                <span className="text-gray-500">
                  // Target Attribute: &quot;category&quot;
                </span>
                <br />
                <br />
                <span className="text-gray-500">// Before processing</span>
                <br />
                <span className="text-amber-400">severityText</span>:{" "}
                <span className="text-sky-400">&quot;ERROR&quot;</span>,{" "}
                <span className="text-amber-400">attributes</span>: {"{"} {"}"}
                <br />
                <span className="text-gray-500">// After processing</span>
                <br />
                <span className="text-amber-400">severityText</span>:{" "}
                <span className="text-sky-400">&quot;ERROR&quot;</span>,{" "}
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;category&quot;</span>:{" "}
                <span className="text-sky-400">
                  &quot;Critical Errors&quot;
                </span>{" "}
                {"}"}
              </div>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Target Attribute"
                description={
                  "The key in the log's attributes where the matched category name will be stored. You can search logs by this attribute in the Logs Viewer."
                }
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. category"
                  value={categoryTargetKey}
                  onChange={setCategoryTargetKey}
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                The category will be accessible as{" "}
                <code className="text-gray-500">
                  attributes.{categoryTargetKey || "category"}
                </code>{" "}
                in your logs.
              </p>
            </div>

            <div>
              <FieldLabelElement
                title="Category Rules"
                description="Define categories and the filter conditions that trigger them. Rules are evaluated top to bottom — the first match wins."
              />
              <div className="mt-2 space-y-2">
                {categories.map((cat: CategoryRule, index: number) => {
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-12 gap-3 items-center p-3 bg-gray-50 rounded-md border border-gray-200"
                    >
                      <div className="col-span-4">
                        <Input
                          type={InputType.TEXT}
                          placeholder="Category name (e.g. Error)"
                          value={cat.name}
                          onChange={(value: string) => {
                            const newCats: Array<CategoryRule> = [
                              ...categories,
                            ];
                            newCats[index] = {
                              ...cat,
                              name: value,
                            };
                            setCategories(newCats);
                          }}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <span className="text-gray-400 text-sm font-medium">
                          when
                        </span>
                      </div>
                      <div className="col-span-6">
                        <Input
                          type={InputType.TEXT}
                          placeholder="e.g. severityText = 'ERROR'"
                          value={cat.filterQuery}
                          onChange={(value: string) => {
                            const newCats: Array<CategoryRule> = [
                              ...categories,
                            ];
                            newCats[index] = {
                              ...cat,
                              filterQuery: value,
                            };
                            setCategories(newCats);
                          }}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
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
              description="Enable this processor to start processing logs"
              value={isEnabled}
              onChange={setIsEnabled}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ProcessorForm;
