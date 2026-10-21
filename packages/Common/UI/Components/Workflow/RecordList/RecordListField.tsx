/*
 * A step's "who to page" setting: a list of the project's people, teams,
 * on-call schedules or on-call policies, picked by name.
 *
 * It is the people picker every other form picks people with - "Add user"
 * opens one search list, each pick is a chip with a remove button - with one
 * thing a workflow adds: an entry can also be a value from an earlier step
 * or a variable (an incident's owners, a list a webhook sent). { } at the end
 * of the row opens the value picker, and a value picked there joins the row
 * as a chip of its own, named the way values are named everywhere else in
 * the Builder ("Incident › Owner Users") and removed like a pick.
 *
 * Whatever else the setting holds - an email address written into a workflow
 * made through the API - is shown as written, so it can be seen and removed.
 *
 * The setting is saved as a list of strings: ids, then everything else
 * (RecordListValue).
 */

import IconProp from "../../../../Types/Icon/IconProp";
import {
  translateTemplate,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import Icon from "../../Icon/Icon";
import { REMOVE_PICK_TEMPLATE } from "../../PeoplePicker/PeopleList";
import PeoplePicker from "../../PeoplePicker/PeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "../../PeoplePicker/PeoplePickerTypes";
import InsertValueButton from "../ValuePicker/InsertValueButton";
import {
  ReferenceDescription,
  ReferenceTone,
} from "../ValuePicker/ReferenceDescription";
import { chipTitle } from "../ValuePicker/ReferenceChip";
import {
  ValuePickerContextValue,
  useValuePicker,
} from "../ValuePicker/ValuePickerContext";
import {
  INSERT_VALUE_BUTTON_CLASS,
  INSERT_VALUE_BUTTON_IDLE_CLASS,
} from "../ValuePicker/ValueTextField";
import {
  RecordListEntry,
  RecordListEntryType,
  getOtherEntries,
  getRecordIds,
  getWholeReference,
  readRecordListEntries,
  toStoredRecordList,
  withReference,
  withoutEntry,
} from "./RecordListValue";
import React, { FunctionComponent, ReactElement } from "react";

// What { } says here: the value names the records, it is not text put in.
export const USE_VALUE_FOR_LIST_LABEL: string = translationKey(
  "Add a value from an earlier step or a variable",
);

/*
 * The words of each kind's picker, in English: the button that opens the
 * search list, what its search box says, and what it says when the project
 * has none to pick.
 */
export interface RecordListCopy {
  addButtonText: string;
  searchPlaceholder: string;
  emptyText: string;
}

export const RECORD_LIST_COPY: Record<PeoplePickerKind, RecordListCopy> = {
  [PeoplePickerKind.User]: {
    addButtonText: translationKey("Add user"),
    searchPlaceholder: translationKey("Search people by name or email"),
    emptyText: translationKey("This project has no people to page yet."),
  },
  [PeoplePickerKind.Team]: {
    addButtonText: translationKey("Add team"),
    searchPlaceholder: translationKey("Search teams by name"),
    emptyText: translationKey("This project has no teams yet."),
  },
  [PeoplePickerKind.OnCallSchedule]: {
    addButtonText: translationKey("Add on-call schedule"),
    searchPlaceholder: translationKey("Search on-call schedules by name"),
    emptyText: translationKey(
      "This project has no on-call schedules yet. Create one under On-Call Duty.",
    ),
  },
  // Not offered as a list of records; listed as its schedules are.
  [PeoplePickerKind.OnCallScheduleNextInRotation]: {
    addButtonText: translationKey("Add next in rotation"),
    searchPlaceholder: translationKey("Search on-call schedules by name"),
    emptyText: translationKey(
      "This project has no on-call schedules yet. Create one under On-Call Duty.",
    ),
  },
  [PeoplePickerKind.OnCallPolicy]: {
    addButtonText: translationKey("Add on-call policy"),
    searchPlaceholder: translationKey("Search on-call policies by name"),
    emptyText: translationKey(
      "This project has no on-call policies yet. Create one under On-Call Duty.",
    ),
  },
};

export interface RecordListFieldProps {
  // Which of the project's records the setting lists.
  kind: PeoplePickerKind;
  // The setting as it is stored: a list of ids and {{references}}.
  value: unknown;
  // Every change, as the whole new list.
  onChange: (value: Array<string>) => void;
  // The id of the label that names the field.
  ariaLabelledby?: string | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
  onBlur?: (() => void) | undefined;
}

const VALUE_CHIP_CLASS: Record<ReferenceTone, string> = {
  [ReferenceTone.Normal]: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  [ReferenceTone.Warning]: "bg-amber-50 text-amber-800 ring-amber-200",
};

const VALUE_CHIP_MARK_CLASS: Record<ReferenceTone, string> = {
  [ReferenceTone.Normal]: "text-indigo-500",
  [ReferenceTone.Warning]: "text-amber-600",
};

const VALUE_CHIP_REMOVE_CLASS: Record<ReferenceTone, string> = {
  [ReferenceTone.Normal]:
    "text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700",
  [ReferenceTone.Warning]:
    "text-amber-500 hover:bg-amber-100 hover:text-amber-800",
};

const RecordListField: FunctionComponent<RecordListFieldProps> = (
  props: RecordListFieldProps,
): ReactElement => {
  const picker: ValuePickerContextValue = useValuePicker();
  const dataTestId: string = props.dataTestId || "record-list-field";
  const copy: RecordListCopy = RECORD_LIST_COPY[props.kind];

  const entries: Array<RecordListEntry> = readRecordListEntries(props.value);
  const recordIds: Array<string> = getRecordIds(entries);
  const others: Array<RecordListEntry> = getOtherEntries(entries);

  const pickerValue: PeoplePickerValue = { [props.kind]: recordIds };

  const valueChips: Array<ReactElement> = others.map(
    (entry: RecordListEntry): ReactElement => {
      const reference: string | null =
        entry.type === RecordListEntryType.Reference
          ? getWholeReference(entry.value)
          : null;
      const description: ReferenceDescription | null = reference
        ? picker.describeReference(reference)
        : null;

      const isValue: boolean = entry.type === RecordListEntryType.Reference;
      const tone: ReferenceTone = description?.tone || ReferenceTone.Normal;
      // "Incident › Owner Users", or the entry as it is written.
      const name: string = description ? description.label : entry.value;

      const removeLabel: string = translateTemplate(REMOVE_PICK_TEMPLATE, {
        name: name,
      });

      return (
        <span
          key={`${entry.type}:${entry.value}`}
          data-testid={`${dataTestId}-value-chip`}
          data-entry-type={entry.type}
          data-tone={tone}
          title={reference ? chipTitle(description, reference) : entry.value}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-2.5 pr-1 text-sm ring-1 ring-inset ${
            isValue
              ? VALUE_CHIP_CLASS[tone]
              : "bg-white text-gray-900 ring-gray-200"
          }`}
        >
          {isValue ? (
            <span
              aria-hidden="true"
              className={`flex-shrink-0 font-mono text-[11px] leading-none ${VALUE_CHIP_MARK_CLASS[tone]}`}
            >
              {"{ }"}
            </span>
          ) : null}
          <span className="min-w-0 truncate">{name}</span>
          <button
            type="button"
            aria-label={removeLabel}
            title={removeLabel}
            data-testid={`${dataTestId}-value-chip-remove`}
            onClick={() => {
              props.onChange(withoutEntry(entries, entry));
            }}
            className={`flex flex-shrink-0 items-center justify-center rounded-full p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isValue
                ? VALUE_CHIP_REMOVE_CLASS[tone]
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            }`}
          >
            <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
          </button>
        </span>
      );
    },
  );

  return (
    <PeoplePicker
      kinds={[props.kind]}
      value={pickerValue}
      onChange={(next: PeoplePickerValue) => {
        props.onChange(
          toStoredRecordList({
            recordIds: next[props.kind] || [],
            others: others,
          }),
        );
      }}
      addButtonText={copy.addButtonText}
      searchPlaceholder={copy.searchPlaceholder}
      emptyText={copy.emptyText}
      ariaLabelledby={props.ariaLabelledby}
      error={props.error}
      dataTestId={dataTestId}
      onBlur={props.onBlur}
      extraChips={valueChips}
      trailing={
        <InsertValueButton
          key="record-list-insert-value"
          ariaLabel={USE_VALUE_FOR_LIST_LABEL}
          className={`${INSERT_VALUE_BUTTON_CLASS} ${INSERT_VALUE_BUTTON_IDLE_CLASS}`}
          dataTestId={`${dataTestId}-insert-value`}
          onPick={(reference: string) => {
            props.onChange(withReference(entries, reference));
          }}
        >
          {"{ }"}
        </InsertValueButton>
      }
    />
  );
};

export default RecordListField;
