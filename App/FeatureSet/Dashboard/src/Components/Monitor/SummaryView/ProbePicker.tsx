import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorSummaryProbeUtil, {
  AttachedProbe,
} from "Common/Utils/Monitor/MonitorSummaryProbeUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onProbeSelected?: (probe: Probe) => void;
  /*
   * Only the probes attached to the monitor being viewed. This is a view
   * filter over data that already exists - it does not change which probe
   * monitors the resource, so it must never offer a probe that does not.
   */
  probes: Array<Probe>;
  disabledProbeIds?: Array<string> | undefined;
  selectedProbe?: Probe;
}

const ProbePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const disabledProbeIdSet: Set<string> = new Set(props.disabledProbeIds || []);

  const dropdownOptions: Array<DropdownOption> =
    MonitorSummaryProbeUtil.getProbeDropdownOptions({
      probes: props.probes.map((probe: Probe): AttachedProbe => {
        const id: string = probe._id?.toString() || "";

        return {
          id: id,
          name: probe.name?.toString() || "Unknown",
          isEnabled: !disabledProbeIdSet.has(id),
        };
      }),
    });

  return (
    <div className="flex">
      <div className="w-fit mr-2 flex h-full align-middle items-center mt-4">
        {/*
         * Deliberately not `required`: this is a filter on what the card
         * displays, not a setting. Chroming it like a required form field
         * invited users to treat changing it as editing the monitor's probe,
         * and to read the (unsaved, because there is nothing to save)
         * selection as an edit that was thrown away.
         */}
        <FieldLabelElement
          title="Showing results from:"
          hideOptionalLabel={true}
        />
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
