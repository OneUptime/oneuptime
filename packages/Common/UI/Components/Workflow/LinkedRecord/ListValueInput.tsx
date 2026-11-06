/*
 * A setting whose value is picked from a list - the project's records, or a
 * custom field's own options - with { } beside the list for a value from an
 * earlier step. It says nothing of where the list comes from: LinkedRecordInput
 * and CustomFields/CustomFieldChoiceInput hand it what to offer.
 */

import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../Dropdown/Dropdown";
import {
  ValuePickerContextValue,
  useValuePicker,
} from "../ValuePicker/ValuePickerContext";
import ValuePickerMenu from "../ValuePicker/ValuePickerMenu";
import ValuePickerPopup, {
  ValuePickerCloseReason,
  ValuePickerPopupMode,
} from "../ValuePicker/ValuePickerPopup";
import {
  INSERT_VALUE_BUTTON_CLASS,
  INSERT_VALUE_BUTTON_IDLE_CLASS,
  INSERT_VALUE_BUTTON_OPEN_CLASS,
  INSERT_VALUE_LABEL,
} from "../ValuePicker/ValueTextField";
import { WorkflowViewOnlyContext } from "../WorkflowViewOnly";
import React, {
  FunctionComponent,
  ReactElement,
  useContext,
  useRef,
  useState,
} from "react";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export const LinkedRecordCopy: {
  readonly placeholder: string;
  readonly loading: string;
  readonly none: string;
  readonly noMatch: string;
  readonly useValue: string;
  readonly pickFromList: string;
  readonly noneChosen: string;
} = {
  placeholder: translationKey("Pick from the list"),
  loading: translationKey("Loading…"),
  none: translationKey("There is nothing to pick from yet."),
  noMatch: translationKey("Nothing matches “{{search}}”."),
  useValue: translationKey("Use “{{value}}”"),
  pickFromList: translationKey("Pick from the list instead"),
  noneChosen: translationKey("None"),
};

type OptionForValueFunction = (
  value: string,
  known: Map<string, DropdownOption>,
) => DropdownOption;

/*
 * What a held value is shown as: what it is called, once that is known. An ID
 * nothing answers to - a record since deleted - or an option since removed is
 * shown as it is, and a reference as it was written, so what the step holds is
 * always on screen and can be changed.
 */
export const optionForValue: OptionForValueFunction = (
  value: string,
  known: Map<string, DropdownOption>,
): DropdownOption => {
  return (
    known.get(value.toLowerCase()) || {
      value: value,
      label: value,
      isUserContent: true,
    }
  );
};

export interface ComponentProps {
  options: Array<DropdownOption>;
  // Everything known by its value, lower case, to name what is held.
  known: Map<string, DropdownOption>;
  // One value: what the setting holds, "" for nothing yet.
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  // Several values: what the setting holds, and every change to it.
  isList?: boolean | undefined;
  values?: Array<string> | undefined;
  onChangeList?: ((values: Array<string>) => void) | undefined;
  // A value picked with { }: it takes the setting's place, or joins the list.
  onPickReference?: ((reference: string) => void) | undefined;
  isLoading?: boolean | undefined;
  onSearchTextChange?: ((text: string) => void) | undefined;
  // Which typed words may be kept, beyond the list. Left out, any may be.
  isCreatableText?: ((text: string) => boolean) | undefined;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  autoFocus?: boolean | undefined;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId: string;
  // Which table the list is of, when it is a table's records.
  tableName?: string | undefined;
}

const ListValueInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const picker: ValuePickerContextValue = useValuePicker();
  // A step opened to be read: what it holds, by name, held still.
  const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);
  const dataTestId: string = props.dataTestId;

  const cellRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);

  const values: Array<string> = props.isList
    ? props.values || []
    : props.value
      ? [props.value]
      : [];

  const selected: Array<DropdownOption> = values.map(
    (value: string): DropdownOption => {
      return optionForValue(value, props.known);
    },
  );

  /*
   * A list to read: its entries by name, with nothing to take one off. A
   * disabled multi-select still draws a remove on every chip.
   */
  if (props.isList && isViewOnly) {
    return (
      <div
        className="flex w-full flex-wrap gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5"
        data-testid={dataTestId}
        data-table={props.tableName}
      >
        {selected.length === 0 ? (
          <span className="text-sm text-gray-500">
            {translator.translateText(LinkedRecordCopy.noneChosen)}
          </span>
        ) : (
          selected.map((option: DropdownOption) => {
            return (
              <span
                key={String(option.value)}
                className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
              >
                {option.label}
              </span>
            );
          })
        )}
      </div>
    );
  }

  const canPickValue: boolean =
    picker.isAvailable && !isViewOnly && Boolean(props.onPickReference);

  return (
    <div
      ref={cellRef}
      className="flex w-full items-center gap-1"
      data-testid={dataTestId}
      data-table={props.tableName}
    >
      <div className="min-w-0 flex-1">
        <Dropdown
          className="relative w-full overflow-visible rounded-md"
          options={props.options}
          isMultiSelect={Boolean(props.isList)}
          value={props.isList ? selected : selected[0]}
          placeholder={props.placeholder || LinkedRecordCopy.placeholder}
          ariaLabelledby={props.ariaLabelledby}
          disabled={isViewOnly}
          isClearable={!isViewOnly}
          autoFocus={props.autoFocus && !isViewOnly}
          error={props.error}
          onBlur={props.onBlur}
          isLoading={props.isLoading}
          loadingMessage={
            translator.translateText(LinkedRecordCopy.loading) || undefined
          }
          noOptionsMessage={(search: string): string => {
            return search.trim()
              ? translator.translateTemplate(LinkedRecordCopy.noMatch, {
                  search: search.trim(),
                })
              : translator.translateText(LinkedRecordCopy.none) || "";
          }}
          isCreatable={true}
          isCreatableText={props.isCreatableText}
          formatCreateLabel={(text: string): string => {
            return translator.translateTemplate(LinkedRecordCopy.useValue, {
              value: text,
            });
          }}
          onSearchTextChange={props.onSearchTextChange}
          closeMenuOnSelect={!props.isList}
          onChange={(
            change: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            if (props.isList) {
              props.onChangeList?.(
                (Array.isArray(change) ? change : []).map(
                  (value: DropdownValue): string => {
                    return String(value);
                  },
                ),
              );
              return;
            }

            props.onChange?.(
              change === null || Array.isArray(change) ? "" : String(change),
            );
          }}
        />
      </div>

      {canPickValue ? (
        <button
          type="button"
          aria-label={translator.translateText(INSERT_VALUE_LABEL)}
          title={translator.translateText(INSERT_VALUE_LABEL)}
          aria-haspopup="dialog"
          aria-expanded={isPickerOpen}
          data-testid={`${dataTestId}-insert-value`}
          className={`${INSERT_VALUE_BUTTON_CLASS} ${
            isPickerOpen
              ? INSERT_VALUE_BUTTON_OPEN_CLASS
              : INSERT_VALUE_BUTTON_IDLE_CLASS
          }`}
          onClick={() => {
            setIsPickerOpen(!isPickerOpen);
          }}
        >
          {"{ }"}
        </button>
      ) : null}

      {isPickerOpen ? (
        <ValuePickerPopup
          anchorRef={cellRef}
          mode={ValuePickerPopupMode.Popover}
          ariaLabel="Use a value"
          onClose={(reason: ValuePickerCloseReason) => {
            setIsPickerOpen(false);

            if (reason !== ValuePickerCloseReason.Outside) {
              cellRef.current
                ?.querySelector<HTMLElement>(
                  `[data-testid="${dataTestId}-insert-value"]`,
                )
                ?.focus();
            }
          }}
        >
          <ValuePickerMenu
            hasSearchBox={true}
            onPick={(reference: string) => {
              setIsPickerOpen(false);
              props.onPickReference?.(reference);
            }}
          />
        </ValuePickerPopup>
      ) : null}
    </div>
  );
};

export default ListValueInput;
