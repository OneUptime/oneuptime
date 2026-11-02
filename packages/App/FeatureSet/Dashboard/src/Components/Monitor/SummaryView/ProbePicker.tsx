import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorSummaryProbeUtil, {
  AttachedProbe,
} from "Common/Utils/Monitor/MonitorSummaryProbeUtil";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * How the picker sits in the Monitor Summary card's header.
 *
 * On a phone the label sits over the list, and the list takes the header's
 * whole width: beside the label it was left about 90px, and cut every probe
 * to "Frankfu…". From sm up the two share a line while the list keeps 15rem
 * beside the label - a probe's name and region, such as "Singapore
 * (ap-southeast-1)" - and the list goes under the label, the whole width
 * again, when the card has less room (beside a side menu at 768px).
 *
 * On a phone the list has no width of its own (w-full), so the header's row
 * of actions can always shrink the picker to the card's width, however
 * narrow the phone, instead of running past the card.
 */
export const PROBE_PICKER_CLASS_NAME: string =
  "flex w-full flex-wrap items-center gap-x-3 gap-y-1.5";

// The list: the whole line on a phone, 15rem beside the label from sm up.
export const PROBE_PICKER_LIST_CLASS_NAME: string =
  "w-full max-w-full grow sm:w-60";

// The list's own box: no margins of its own beside or under the label.
export const PROBE_PICKER_DROPDOWN_CLASS_NAME: string =
  "relative w-full min-w-0 rounded-md overflow-visible";

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
  /*
   * A react-select control cannot be reached with htmlFor - the element that
   * carries role="combobox" is the search input react-select renders itself -
   * so the label points at it through aria-labelledby, exactly as FormField
   * does for every Dropdown it renders. Without this the picker has no
   * accessible name at all.
   */
  const fieldLabelId: string = useId();

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
    <div className={PROBE_PICKER_CLASS_NAME} data-testid="probe-picker">
      {/*
       * Deliberately not `required`: this is a filter on what the card
       * displays, not a setting. Chroming it like a required form field
       * invited users to treat changing it as editing the monitor's probe,
       * and to read the (unsaved, because there is nothing to save)
       * selection as an edit that was thrown away.
       */}
      <FieldLabelElement
        title="Showing results from:"
        id={fieldLabelId}
        hideOptionalLabel={true}
      />
      <div className={PROBE_PICKER_LIST_CLASS_NAME}>
        {/*
         * Never cleared: the card always shows one probe's results, so a
         * cleared list only came back to the probe it showed - and its ×
         * took a third of a phone's list.
         */}
        <Dropdown
          ariaLabelledby={fieldLabelId}
          className={PROBE_PICKER_DROPDOWN_CLASS_NAME}
          isClearable={false}
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
