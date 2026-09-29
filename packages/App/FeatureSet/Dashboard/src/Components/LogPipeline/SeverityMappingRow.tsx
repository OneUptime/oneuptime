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
import LogSeverity, {
  LogSeverityNumber,
  normalizeLogSeverity,
} from "Common/Types/Log/LogSeverity";

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

/*
 * These write straight onto the log row, so they must be the exact strings
 * ingest stores — the seven LogSeverity members. This dropdown used to offer
 * TRACE/DEBUG/INFO/WARNING/ERROR/FATAL, which meant a remapped log was saved
 * with a severityText no filter could ever match.
 *
 * Unspecified is deliberately absent: remapping a log TO "no severity" is not a
 * thing anyone wants, and it is the value this processor exists to replace.
 */
const severityOptions: Array<DropdownOption> = [
  LogSeverity.Trace,
  LogSeverity.Debug,
  LogSeverity.Information,
  LogSeverity.Warning,
  LogSeverity.Error,
  LogSeverity.Fatal,
].map((severity: LogSeverity) => {
  return { value: severity, label: severity };
});

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
          /*
           * Normalised so a pipeline saved with the old "INFO" / "WARNING"
           * values still shows its selection instead of an empty dropdown.
           * Re-saving the pipeline then writes the corrected value back.
           */
          value={((): DropdownOption | undefined => {
            const severity: LogSeverity | null = normalizeLogSeverity(
              mapping.severityText,
            );
            return severity ? { value: severity, label: severity } : undefined;
          })()}
          placeholder="Select severity..."
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const severity: LogSeverity | null = normalizeLogSeverity(
              value?.toString() || "",
            );
            props.onChange({
              ...mapping,
              severityText: severity || "",
              // Kept in step with the text so the row cannot disagree with itself.
              severityNumber: severity ? LogSeverityNumber[severity] : 0,
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
