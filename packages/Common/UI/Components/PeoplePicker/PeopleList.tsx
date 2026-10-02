import IconProp from "../../../Types/Icon/IconProp";
import { translateTemplate } from "../../Utils/TranslateTemplate";
import useTranslateValue from "../../Utils/Translation";
import Icon from "../Icon/Icon";
import PeopleAvatar from "./PeopleAvatar";
import { getPeoplePickerKindDefinition } from "./PeoplePickerKinds";
import {
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
  PeoplePickerValue,
} from "./PeoplePickerTypes";
import usePeopleOptions, { PeopleOptionsLookup } from "./usePeopleOptions";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Picks drawn as chips - an avatar and a name - in the picker itself (with a
 * remove button), and read-only wherever a record shows who it names: a
 * rule's view page, a form's summary step, a monitor's criteria.
 */

export const REMOVE_PICK_TEMPLATE: string = "Remove {{name}}";

export interface PeopleChipProps {
  kind: PeoplePickerKind;
  id: string;
  // Undefined while the pick's name is still being looked up.
  option: PeoplePickerOption | undefined;
  onRemove?: (() => void) | undefined;
  disabled?: boolean | undefined;
}

export const PeopleChip: FunctionComponent<PeopleChipProps> = (
  props: PeopleChipProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const option: PeoplePickerOption | undefined = props.option;
  const tag: string | undefined = getPeoplePickerKindDefinition(props.kind).tag;

  const name: string = option
    ? option.isUnknown
      ? translateString(option.name) || option.name
      : option.name
    : translateString("Loading...") || "Loading...";

  return (
    <span
      data-testid="people-chip"
      data-kind={props.kind}
      data-id={props.id}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 text-sm text-gray-900 ring-1 ring-inset ring-gray-200 ${
        props.onRemove ? "pr-1" : "pr-2.5"
      }`}
    >
      <PeopleAvatar
        size="chip"
        item={{
          kind: props.kind,
          name: option && !option.isUnknown ? option.name : "?",
          userId: option?.userId,
          hasProfilePicture: option?.hasProfilePicture,
        }}
      />
      <span
        className={`min-w-0 truncate ${
          !option || option.isUnknown ? "italic text-gray-500" : ""
        }`}
      >
        {name}
      </span>
      {tag && (
        <span className="flex-shrink-0 text-xs text-gray-500">
          {translateString(tag) || tag}
        </span>
      )}
      {props.onRemove && (
        <button
          type="button"
          onClick={props.onRemove}
          disabled={props.disabled}
          aria-label={translateTemplate(REMOVE_PICK_TEMPLATE, {
            name: name,
          })}
          title={translateTemplate(REMOVE_PICK_TEMPLATE, { name: name })}
          className="flex flex-shrink-0 items-center justify-center rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
};

export interface PeopleListProps {
  options: Array<PeoplePickerOption>;
  // Shown when there are none. Default: "None".
  noneText?: string | undefined;
  dataTestId?: string | undefined;
}

// Picks already known by name, read-only.
export const PeopleList: FunctionComponent<PeopleListProps> = (
  props: PeopleListProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  if (props.options.length === 0) {
    const noneText: string = props.noneText || "None";

    return (
      <span
        data-testid={props.dataTestId || "people-list"}
        className="text-sm text-gray-500"
      >
        {translateString(noneText) || noneText}
      </span>
    );
  }

  return (
    <div
      data-testid={props.dataTestId || "people-list"}
      className="flex flex-wrap items-center gap-1.5"
    >
      {props.options.map((option: PeoplePickerOption): ReactElement => {
        return (
          <PeopleChip
            key={getPeoplePickerOptionKey(option.kind, option.id)}
            kind={option.kind}
            id={option.id}
            option={option}
          />
        );
      })}
    </div>
  );
};

export interface PeopleListFromIdsProps {
  kinds: Array<PeoplePickerKind>;
  value: PeoplePickerValue;
  noneText?: string | undefined;
  dataTestId?: string | undefined;
}

// Picks known only by id - a form's summary step - looked up, read-only.
export const PeopleListFromIds: FunctionComponent<PeopleListFromIdsProps> = (
  props: PeopleListFromIdsProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const lookup: PeopleOptionsLookup = usePeopleOptions({
    kinds: props.kinds,
    value: props.value,
  });

  const picks: Array<{ kind: PeoplePickerKind; id: string }> = [];

  for (const kind of props.kinds) {
    for (const id of props.value[kind] || []) {
      picks.push({ kind, id });
    }
  }

  if (picks.length === 0) {
    const noneText: string = props.noneText || "None";

    return (
      <span
        data-testid={props.dataTestId || "people-list"}
        className="text-sm text-gray-500"
      >
        {translateString(noneText) || noneText}
      </span>
    );
  }

  return (
    <div
      data-testid={props.dataTestId || "people-list"}
      className="flex flex-wrap items-center gap-1.5"
    >
      {picks.map(
        (pick: { kind: PeoplePickerKind; id: string }): ReactElement => {
          return (
            <PeopleChip
              key={getPeoplePickerOptionKey(pick.kind, pick.id)}
              kind={pick.kind}
              id={pick.id}
              option={lookup.getOption(pick.kind, pick.id)}
            />
          );
        },
      )}
    </div>
  );
};

export default PeopleList;
