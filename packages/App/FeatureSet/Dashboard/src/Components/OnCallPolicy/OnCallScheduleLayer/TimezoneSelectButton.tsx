import IconProp from "Common/Types/Icon/IconProp";
import TimezoneAlias from "Common/Types/TimezoneAlias";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Timezone options are static and not free to build (every current zone
 * resolved to its GMT offset and sorted), so compute them once at module load
 * rather than per render.
 */
const timezoneDropdownOptions: Array<DropdownOption> =
  TimezoneUtil.getTimezoneDropdownOptions();

export interface ComponentProps {
  value?: string | undefined;
  onChange: (value: string | undefined) => void;
  modalTitle: string;
  modalDescription?: string | undefined;
  // Text on the modal's confirm button (e.g. "Save timezone", "Apply").
  submitButtonText?: string | undefined;
  // Bubble text shown when no value is set.
  placeholder?: string | undefined;
  icon?: IconProp | undefined;
  // Shows a transient "Saving…" state on the bubble (for async persistence).
  saving?: boolean | undefined;
  dataTestId?: string | undefined;
}

/*
 * A compact "bubble" that shows the current timezone and, on click, opens a
 * modal with a searchable timezone picker and an explicit confirm button. Used
 * for both the schedule's timezone (persisted, "Save") and the preview's
 * "View as" display zone (ephemeral, "Apply"). The pending selection is held in
 * a draft so closing the modal without confirming discards it.
 */
const TimezoneSelectButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * The value can be a legacy tz name the picker does not offer: a schedule
   * saved with "US/Pacific", or a "View as" zone seeded from the browser's
   * guess, which Chromium spells "Asia/Calcutta" (see
   * Common/Types/TimezoneAlias.ts). Matched as given it selects no option, so
   * the modal would open on its placeholder instead of the zone in use. Read
   * it as its current name instead — in the bubble and in the draft, which is
   * what selects the option and what Save hands back.
   */
  const currentValue: string | undefined = props.value
    ? TimezoneAlias.getCanonicalTimezone(props.value)
    : undefined;

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<string | undefined>(currentValue);

  const openModal: () => void = (): void => {
    setDraft(currentValue);
    setIsModalOpen(true);
  };

  const selectedDraftOption: DropdownOption | undefined = draft
    ? timezoneDropdownOptions.find((option: DropdownOption) => {
        return option.value === draft;
      })
    : undefined;

  const bubbleText: string = props.saving
    ? "Saving…"
    : currentValue || props.placeholder || "Select timezone";

  return (
    <React.Fragment>
      <button
        type="button"
        data-testid={props.dataTestId}
        onClick={openModal}
        className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
      >
        <Icon
          icon={props.icon || IconProp.Globe}
          className="h-4 w-4 text-gray-400"
        />
        <span className={currentValue || props.saving ? "" : "text-gray-400"}>
          {bubbleText}
        </span>
        <Icon icon={IconProp.ChevronDown} className="h-3 w-3 text-gray-400" />
      </button>

      {isModalOpen && (
        <Modal
          title={props.modalTitle}
          description={props.modalDescription}
          modalWidth={ModalWidth.Normal}
          submitButtonText={props.submitButtonText || "Save"}
          submitButtonStyleType={ButtonStyleType.PRIMARY}
          onSubmit={() => {
            /*
             * Saving the zone that was already set hands back the value as
             * it came, legacy spelling and all, so the caller sees no change
             * and does not rewrite a stored "US/Pacific" nobody touched.
             */
            props.onChange(draft === currentValue ? props.value : draft);
            setIsModalOpen(false);
          }}
          onClose={() => {
            setIsModalOpen(false);
          }}
        >
          {/* Standard labeled field; the searchable menu portals to <body> so it never clips. */}
          <div className="mt-1">
            <FieldLabelElement title="Timezone" required={true} />
            <Dropdown
              options={timezoneDropdownOptions}
              value={selectedDraftOption}
              placeholder="Search and select a timezone"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setDraft(
                  value && !Array.isArray(value) ? value.toString() : undefined,
                );
              }}
            />
          </div>
        </Modal>
      )}
    </React.Fragment>
  );
};

export default TimezoneSelectButton;
