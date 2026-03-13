import React, { FunctionComponent, ReactElement } from "react";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

export interface SeverityMapping {
  matchValue: string;
  severityText: string;
  severityNumber: number;
}

export interface ComponentProps {
  mapping: SeverityMapping;
  onChange: (mapping: SeverityMapping) => void;
  onDelete: () => void;
  canDelete: boolean;
}

const severityOptions: Array<DropdownOption> = [
  { value: "TRACE", label: "TRACE" },
  { value: "DEBUG", label: "DEBUG" },
  { value: "INFO", label: "INFO" },
  { value: "WARNING", label: "WARNING" },
  { value: "ERROR", label: "ERROR" },
  { value: "FATAL", label: "FATAL" },
];

const severityNumberMap: Record<string, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARNING: 13,
  ERROR: 17,
  FATAL: 21,
};

const SeverityMappingRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { mapping } = props;

  return (
    <div className="grid grid-cols-12 gap-3 items-center p-3 bg-gray-50 rounded-md border border-gray-200">
      <div className="col-span-5">
        <Input
          type={InputType.TEXT}
          placeholder='Value to match (e.g. "warn", "err")'
          value={mapping.matchValue}
          onChange={(value: string) => {
            props.onChange({ ...mapping, matchValue: value });
          }}
        />
      </div>

      <div className="col-span-1 flex justify-center">
        <span className="text-gray-400 text-sm font-medium">maps to</span>
      </div>

      <div className="col-span-5">
        <Dropdown
          options={severityOptions}
          value={
            mapping.severityText
              ? {
                  value: mapping.severityText,
                  label: mapping.severityText,
                }
              : undefined
          }
          placeholder="Select severity..."
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const text: string = value?.toString() || "";
            props.onChange({
              ...mapping,
              severityText: text,
              severityNumber: severityNumberMap[text] || 0,
            });
          }}
        />
      </div>

      <div className="col-span-1 flex justify-end">
        <Button
          icon={IconProp.Trash}
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          buttonSize={ButtonSize.Small}
          onClick={props.onDelete}
          disabled={!props.canDelete}
        />
      </div>
    </div>
  );
};

export default SeverityMappingRow;
