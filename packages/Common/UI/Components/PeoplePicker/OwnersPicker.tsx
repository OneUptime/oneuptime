import ObjectID from "../../../Types/ObjectID";
import { getOwnersPeoplePickerConfig } from "./OwnersFormField";
import PeoplePicker from "./PeoplePicker";
import {
  getPeoplePickerKinds,
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
  toPeoplePickerIds,
} from "./PeoplePickerTypes";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The owners people picker outside a form: people and teams in one field,
 * for a component that keeps owners as two lists of ids of its own - a
 * monitor criteria's incident owners, the monitors a recommendation creates.
 */

const OWNERS_CONFIG: PeoplePickerFieldConfig = getOwnersPeoplePickerConfig();

export interface OwnersPickerValue {
  userIds: Array<ObjectID>;
  teamIds: Array<ObjectID>;
}

export interface ComponentProps {
  userIds: Array<ObjectID | string> | undefined;
  teamIds: Array<ObjectID | string> | undefined;
  onChange: (value: OwnersPickerValue) => void;
  // The id of the label that names the field.
  ariaLabelledby?: string | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
}

const toObjectIDs: (ids: Array<string> | undefined) => Array<ObjectID> = (
  ids: Array<string> | undefined,
): Array<ObjectID> => {
  return (ids || []).map((id: string): ObjectID => {
    return new ObjectID(id);
  });
};

const OwnersPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const value: PeoplePickerValue = {
    [PeoplePickerKind.User]: toPeoplePickerIds(props.userIds),
    [PeoplePickerKind.Team]: toPeoplePickerIds(props.teamIds),
  };

  return (
    <PeoplePicker
      kinds={getPeoplePickerKinds(OWNERS_CONFIG)}
      value={value}
      onChange={(next: PeoplePickerValue) => {
        props.onChange({
          userIds: toObjectIDs(next[PeoplePickerKind.User]),
          teamIds: toObjectIDs(next[PeoplePickerKind.Team]),
        });
      }}
      addButtonText={OWNERS_CONFIG.addButtonText}
      searchPlaceholder={OWNERS_CONFIG.searchPlaceholder}
      emptyText={OWNERS_CONFIG.emptyText}
      ariaLabelledby={props.ariaLabelledby}
      disabled={props.disabled}
      error={props.error}
      dataTestId={props.dataTestId}
    />
  );
};

export default OwnersPicker;
