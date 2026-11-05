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
import Icon from "../../Icon/Icon";
import { containsTemplateExpression } from "../ValuePicker/TemplateText";
import ListValueInput, {
  LinkedRecordCopy,
  optionForValue,
} from "./ListValueInput";
import useLinkedRecords, {
  LinkedRecordSources,
  LinkedRecordsState,
} from "./UseLinkedRecords";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export { LinkedRecordCopy, optionForValue };

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

  return (
    <ListValueInput
      options={records.options}
      known={records.known}
      value={props.value}
      onChange={props.onChange}
      isList={props.isList}
      values={props.values}
      onChangeList={props.onChangeList}
      onPickReference={props.onPickReference}
      isLoading={records.isLoading}
      onSearchTextChange={records.onSearchTextChange}
      isCreatableText={
        props.allowsAnyText ? undefined : isPastableIntoRecordList
      }
      placeholder={props.placeholder}
      ariaLabelledby={props.ariaLabelledby}
      autoFocus={props.autoFocus}
      error={props.error}
      onBlur={props.onBlur}
      dataTestId={props.dataTestId || "linked-record"}
      tableName={props.tableName}
    />
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
