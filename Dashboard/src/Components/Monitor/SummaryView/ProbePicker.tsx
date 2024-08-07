import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onProbeSelected?: (probe: Probe) => void;
  probes: Array<Probe>;
  selectedProbe?: Probe;
}

const ProbePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dropdownOptions: Array<DropdownOption> = props.probes.map(
    (probe: Probe) => {
      return {
        label: probe.name?.toString() || "Unknown",
        value: probe._id?.toString() || "",
      };
    },
  );

  return (
    <div className="flex">
      <div className="w-fit mr-2 flex h-full align-middle items-center">
        <FieldLabelElement title="Select Probe:" required={true} />
      </div>
      <div>
        <Dropdown
          value={dropdownOptions.find((option: DropdownOption) => {
            return option.value === props.selectedProbe?._id?.toString();
          })}
          options={dropdownOptions}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            value = value?.toString() || "";

            const probe: Probe | undefined = props.probes.find((p: Probe) => {
              return p._id?.toString() === value;
            });

            if (props.onProbeSelected && probe) {
              props.onProbeSelected(probe);
            }
          }}
        />
      </div>
    </div>
  );
};

export default ProbePicker;
