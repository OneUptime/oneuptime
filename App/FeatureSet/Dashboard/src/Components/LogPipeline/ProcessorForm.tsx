import React, {
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
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

export interface ComponentProps {
  pipelineId: ObjectID;
  onProcessorCreated: () => void;
  onCancel: () => void;
}

type ProcessorType = "SeverityRemapper" | "AttributeRemapper" | "CategoryProcessor" | "";

const processorTypeOptions: Array<DropdownOption> = [
  {
    value: "SeverityRemapper",
    label: "Severity Remapper",
    description:
      "Map log field values to standard severity levels (e.g. map 'warn' to WARNING)",
  },
  {
    value: "AttributeRemapper",
    label: "Attribute Remapper",
    description:
      "Rename or copy a log attribute to a different key (e.g. rename 'src' to 'source')",
  },
  {
    value: "CategoryProcessor",
    label: "Category Processor",
    description:
      "Assign categories to logs based on filter conditions",
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
          mappings: severityMappings.filter(
            (m: SeverityMapping) => m.matchValue && m.severityText,
          ),
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
          categories: categories.filter(
            (c: CategoryRule) => c.name && c.filterQuery,
          ),
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
        const validMappings: Array<SeverityMapping> =
          severityMappings.filter(
            (m: SeverityMapping) => m.matchValue && m.severityText,
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
          (c: CategoryRule) => c.name && c.filterQuery,
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
    } catch (err) {
      setError("Failed to create processor. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card
      title="Add Processor"
      description="Configure a new processor for this pipeline."
      buttons={[
        {
          title: "Cancel",
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: props.onCancel,
          icon: IconProp.Close,
        },
        {
          title: "Create Processor",
          buttonStyle: ButtonStyleType.PRIMARY,
          onClick: handleSave,
          isLoading: isSaving,
          disabled: isSaving,
          icon: IconProp.CheckCircle,
        },
      ]}
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
                  ? processorTypeOptions.find(
                      (opt: DropdownOption) =>
                        opt.value === processorType,
                    )
                  : undefined
              }
              placeholder="Select processor type..."
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setProcessorType(
                  (value?.toString() as ProcessorType) || "",
                );
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
            <p className="text-xs text-gray-500 mb-4">
              Map values from a log attribute to standard severity levels.
              For example, map &quot;warn&quot; to WARNING, or
              &quot;err&quot; to ERROR.
            </p>

            <div className="mb-4">
              <FieldLabelElement
                title="Source Attribute"
                description="The log attribute that contains the severity value to map"
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. level"
                  value={severitySourceKey}
                  onChange={setSeveritySourceKey}
                />
              </div>
            </div>

            <div>
              <FieldLabelElement
                title="Mappings"
                description="Define how attribute values map to severity levels"
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
                              (_: SeverityMapping, i: number) =>
                                i !== index,
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
            <p className="text-xs text-gray-500 mb-4">
              Rename or copy a log attribute from one key to another.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabelElement
                  title="Source Key"
                  description="The attribute to read from"
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
                  description="The attribute to write to"
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
                description="Keep the original attribute after remapping"
                value={preserveSource}
                onChange={setPreserveSource}
              />
              <Toggle
                title="Override on Conflict"
                description="Overwrite the target if it already exists"
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
            <p className="text-xs text-gray-500 mb-4">
              Assign a category to logs based on filter conditions. The
              first matching rule wins.
            </p>

            <div className="mb-4">
              <FieldLabelElement
                title="Target Attribute"
                description="The attribute where the category name will be stored"
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. category"
                  value={categoryTargetKey}
                  onChange={setCategoryTargetKey}
                />
              </div>
            </div>

            <div>
              <FieldLabelElement
                title="Category Rules"
                description="Define categories and the conditions that trigger them"
              />
              <div className="mt-2 space-y-2">
                {categories.map(
                  (cat: CategoryRule, index: number) => {
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
                            buttonStyle={
                              ButtonStyleType.DANGER_OUTLINE
                            }
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                              setCategories(
                                categories.filter(
                                  (_: CategoryRule, i: number) =>
                                    i !== index,
                                ),
                              );
                            }}
                            disabled={categories.length <= 1}
                          />
                        </div>
                      </div>
                    );
                  },
                )}
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
    </Card>
  );
};

export default ProcessorForm;
