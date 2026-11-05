/*
 * A setting that names one of the project's records - or several: the records
 * by name in a list, and { } beside it for a value from an earlier step.
 *
 * https://github.com/OneUptime/oneuptime/issues/5943 - "It takes an ID, but I
 * do not want to dynamically populate it in some scenarios. I just want to
 * select a static incident severity." What is written is the ID, as it always
 * was, so a workflow reads and runs exactly as before; only the way it is
 * filled in changed. An ID or a reference pasted into the list still works.
 *
 * A person who may not list these records - or whose plan includes none -
 * gets the box to type an ID into instead (renderFallback): they could fill
 * this setting in before, and still can.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import { isRecordId } from "../../../../Types/Workflow/LinkedRecordValue";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../Dropdown/Dropdown";
import Icon from "../../Icon/Icon";
import {
  ValuePickerContextValue,
  useValuePicker,
} from "../ValuePicker/ValuePickerContext";
import ValuePickerMenu from "../ValuePicker/ValuePickerMenu";
import ValuePickerPopup, {
  ValuePickerCloseReason,
  ValuePickerPopupMode,
} from "../ValuePicker/ValuePickerPopup";
import { containsTemplateExpression } from "../ValuePicker/TemplateText";
import {
  INSERT_VALUE_BUTTON_CLASS,
  INSERT_VALUE_BUTTON_IDLE_CLASS,
  INSERT_VALUE_BUTTON_OPEN_CLASS,
  INSERT_VALUE_LABEL,
} from "../ValuePicker/ValueTextField";
import { WorkflowViewOnlyContext } from "../WorkflowViewOnly";
import useLinkedRecords, {
  LinkedRecordSources,
  LinkedRecordsState,
} from "./UseLinkedRecords";
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

type IsPastableFunction = (text: string) => boolean;

/*
 * What may be pasted in beyond the list: a record's ID, or a value from an
 * earlier step written out. Words are a search, and offering to "use" them
 * would only write an ID the run then refuses.
 */
export const isPastableIntoRecordList: IsPastableFunction = (
  text: string,
): boolean => {
  return isRecordId(text) || containsTemplateExpression(text.trim());
};

type OptionForValueFunction = (
  value: string,
  known: Map<string, DropdownOption>,
) => DropdownOption;

/*
 * What a held value is shown as: the record's name, once it is known. An ID
 * nothing answers to - a record since deleted - is shown as it is, and a
 * reference as it was written, so what the step holds is always on screen and
 * can be changed.
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
  tableName: string;
  // One record: what the setting holds, "" for nothing yet.
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  // Several records: what the setting holds, and every change to it.
  isList?: boolean | undefined;
  values?: Array<string> | undefined;
  onChangeList?: ((values: Array<string>) => void) | undefined;
  // A value picked with { }: it takes the setting's place, or joins the list.
  onPickReference?: ((reference: string) => void) | undefined;
  // Drawn instead when the records cannot be listed.
  renderFallback: () => ReactElement;
  /*
   * A setting whose value need not be a record - a severity by its name, or
   * "most severe" - takes any words typed, not only an ID or a reference.
   */
  allowsAnyText?: boolean | undefined;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  autoFocus?: boolean | undefined;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  // Where the records come from; the server unless a test says otherwise.
  sources?: LinkedRecordSources | undefined;
}

const LinkedRecordInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const picker: ValuePickerContextValue = useValuePicker();
  // A step opened to be read: what it holds, by name, held still.
  const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);
  const dataTestId: string = props.dataTestId || "linked-record";

  const cellRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);

  const values: Array<string> = props.isList
    ? props.values || []
    : props.value
      ? [props.value]
      : [];

  const records: LinkedRecordsState = useLinkedRecords({
    tableName: props.tableName,
    values: values,
    sources: props.sources,
  });

  if (records.isUnavailable) {
    return props.renderFallback();
  }

  const selected: Array<DropdownOption> = values.map(
    (value: string): DropdownOption => {
      return optionForValue(value, records.known);
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
          options={records.options}
          isMultiSelect={Boolean(props.isList)}
          value={props.isList ? selected : selected[0]}
          placeholder={props.placeholder || LinkedRecordCopy.placeholder}
          ariaLabelledby={props.ariaLabelledby}
          disabled={isViewOnly}
          isClearable={!isViewOnly}
          autoFocus={props.autoFocus && !isViewOnly}
          error={props.error}
          onBlur={props.onBlur}
          isLoading={records.isLoading}
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
          isCreatableText={
            props.allowsAnyText ? undefined : isPastableIntoRecordList
          }
          formatCreateLabel={(text: string): string => {
            return translator.translateTemplate(LinkedRecordCopy.useValue, {
              value: text,
            });
          }}
          onSearchTextChange={records.onSearchTextChange}
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

export interface PickFromListButtonProps {
  onClick: () => void;
  dataTestId?: string | undefined;
}

/*
 * Beside a value taken from an earlier step, in a setting that lists records:
 * back to the list. The list's own icon rather than the "abc" a typed value
 * has, since nothing is typed here.
 */
export const PickFromListButton: FunctionComponent<PickFromListButtonProps> = (
  props: PickFromListButtonProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <button
      type="button"
      aria-label={translator.translateText(LinkedRecordCopy.pickFromList)}
      title={translator.translateText(LinkedRecordCopy.pickFromList)}
      data-testid={props.dataTestId}
      className="mt-0.5 shrink-0 rounded-md border border-gray-200 p-1 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      onClick={props.onClick}
    >
      <Icon icon={IconProp.ListBullet} className="h-3.5 w-3.5" />
    </button>
  );
};

export default LinkedRecordInput;
