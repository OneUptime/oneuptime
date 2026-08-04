import React, { FunctionComponent, ReactElement, useState } from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import {
  EMPTY_ADVANCED_FILTERS,
  SessionReplayAdvancedFilters,
} from "./SessionReplayListFilters";
import {
  SESSION_REPLAY_FILTER_FIELDS,
  SessionReplayFilterField,
  SessionReplayFilterKind,
} from "./SessionReplayFilterFields";

/*
 * The session list's filter editor.
 *
 * It is the product's standard filter modal - same ModalWidth.Large shell,
 * same "Filter <plural>" / "Apply Filters" chrome, same 140px-label row as
 * Common/UI/Components/Filters/FiltersForm - but deliberately not
 * FiltersForm itself: that form's TextFilter and NumberFilter hardcode
 * operator lists (contains, starts with, is empty, ...) and
 * /telemetry/rum/session-replay/list can only match these columns with
 * equality and duration >=. Offering operators the endpoint cannot honour
 * would either lie about the result set or ignore what the user picked.
 */

export interface ComponentProps {
  filters: SessionReplayAdvancedFilters;
  onApply: (filters: SessionReplayAdvancedFilters) => void;
  onClose: () => void;
}

const SessionReplayFilterModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Edits are a draft until Apply, which is how FilterViewer's own modal
   * behaves (tempFilterDataForModal). The component is mounted only while
   * open, so the draft is seeded from props once per opening.
   */
  const [draft, setDraft] = useState<SessionReplayAdvancedFilters>(
    props.filters,
  );

  type SetFieldFunction = (
    field: keyof SessionReplayAdvancedFilters,
    value: string,
  ) => void;

  const setField: SetFieldFunction = (
    field: keyof SessionReplayAdvancedFilters,
    value: string,
  ): void => {
    setDraft(
      (
        existing: SessionReplayAdvancedFilters,
      ): SessionReplayAdvancedFilters => {
        return { ...existing, [field]: value };
      },
    );
  };

  type GetControlFunction = (field: SessionReplayFilterField) => ReactElement;

  const getControl: GetControlFunction = (
    field: SessionReplayFilterField,
  ): ReactElement => {
    const value: string = draft[field.field];

    if (field.kind === SessionReplayFilterKind.Dropdown) {
      const options: Array<DropdownOption> = field.options || [];

      return (
        <Dropdown
          options={options}
          value={options.filter((option: DropdownOption): boolean => {
            return option.value.toString() === value;
          })}
          placeholder={`Filter by ${field.title}`}
          className="relative rounded-md w-full overflow-visible"
          onChange={(
            dropdownValue: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            // Dropdown is always clearable; clearing hands back null.
            setField(
              field.field,
              dropdownValue === null ? "" : dropdownValue.toString(),
            );
          }}
        />
      );
    }

    return (
      <Input
        value={value}
        placeholder={field.placeholder}
        type={
          field.kind === SessionReplayFilterKind.Number
            ? InputType.NUMBER
            : InputType.TEXT
        }
        /*
         * Input's default outer div carries mt-2 mb-1, which would make
         * these rows taller than the ones FiltersForm renders.
         */
        outerDivClassName="relative rounded-md shadow-sm w-full"
        onChange={(inputValue: string): void => {
          setField(field.field, inputValue);
        }}
        onEnterPress={(): void => {
          props.onApply(draft);
        }}
      />
    );
  };

  return (
    <Modal
      modalWidth={ModalWidth.Large}
      title="Filter Sessions"
      description="Narrow down sessions by one or more criteria below."
      submitButtonText="Apply Filters"
      onClose={props.onClose}
      onSubmit={(): void => {
        props.onApply(draft);
      }}
      leftFooterElement={
        <Button
          title="Clear Filters"
          icon={IconProp.Close}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          onClick={(): void => {
            setDraft(EMPTY_ADVANCED_FILTERS);
          }}
        />
      }
    >
      <div className="space-y-3">
        {SESSION_REPLAY_FILTER_FIELDS.map(
          (field: SessionReplayFilterField): ReactElement => {
            const hasValue: boolean = Boolean(draft[field.field]);

            return (
              <div
                key={field.field}
                className="grid grid-cols-[140px_1fr_auto] gap-3 items-center"
              >
                {/* Label column */}
                <div className="flex items-center min-w-0">
                  <label className="text-sm font-medium text-gray-700 truncate">
                    {field.title}
                  </label>
                </div>

                {/* Controls column */}
                <div className="min-w-0">{getControl(field)}</div>

                {/*
                 * Clear column. Copied from FiltersForm rather than built
                 * from Button so a row here is pixel-identical to a row in
                 * every other filter modal.
                 */}
                <div className="flex items-center">
                  {hasValue ? (
                    <button
                      type="button"
                      onClick={(): void => {
                        setField(field.field, "");
                      }}
                      className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                      aria-label={`Clear ${field.title} filter`}
                      title={`Clear ${field.title}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  ) : (
                    <div className="w-7" aria-hidden="true" />
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </Modal>
  );
};

export default SessionReplayFilterModal;
