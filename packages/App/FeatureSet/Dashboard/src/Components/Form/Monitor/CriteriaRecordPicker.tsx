import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  EntityDropdownValue,
} from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE ON-CALL POLICIES AND LABELS A MONITOR'S CRITERIA SET ON WHAT THEY
 * OPEN, SEARCHED ON THE SERVER (#10646).
 *
 * The criteria's incident and alert forms picked them from the project's
 * first 10,000 by name, and showed as picked only the saved ids found in
 * that list: a policy or a label past it could not be picked, did not show,
 * and was dropped the next time the field was changed - the next incident
 * the monitor opened went to nobody's on-call.
 *
 * The picker searches the server as it is typed in (EntityDropdown), and
 * holds every saved id: one the page has named already (`knownOptions`, the
 * list the monitor form read) shows its name at once, an archived label
 * marked; any other is read by its id; one deleted since reads "No longer
 * available", to keep or take out. An archived label is never offered for
 * a new pick (ArchivedValuePicker).
 */

// A saved value no record answers to any more.
export const CRITERIA_RECORD_NOT_FOUND_LABEL: string = translationKey(
  "No longer available",
);

export interface ComponentProps {
  modelType: DatabaseBaseModelType;
  ids: Array<ObjectID> | undefined;
  // Names the page read already, shown without reading them again.
  knownOptions: Array<DropdownOption>;
  placeholder: string;
  onChange: (ids: Array<ObjectID>) => void;
  dataTestId?: string | undefined;
}

const CriteriaRecordPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const known: Map<string, DropdownOption> = new Map<string, DropdownOption>();

  for (const option of props.knownOptions) {
    known.set(String(option.value).toLowerCase(), option);
  }

  // Every saved id, each named where the page knows its name.
  const value: Array<DropdownOption | string> = (props.ids || []).map(
    (id: ObjectID): DropdownOption | string => {
      const key: string = id.toString().toLowerCase();
      const option: DropdownOption | undefined = known.get(key);

      return option ? { ...option, value: id.toString() } : id.toString();
    },
  );

  return (
    <EntityDropdown
      modelType={props.modelType}
      labelField="name"
      valueField="_id"
      isMultiSelect={true}
      placeholder={props.placeholder}
      dataTestId={props.dataTestId}
      notFoundLabel={CRITERIA_RECORD_NOT_FOUND_LABEL}
      value={value as EntityDropdownValue}
      onChange={(next: DropdownValue | Array<DropdownValue> | null) => {
        props.onChange(
          (Array.isArray(next) ? next : next ? [next] : []).map(
            (entry: DropdownValue): ObjectID => {
              return new ObjectID(entry.toString());
            },
          ),
        );
      }}
    />
  );
};

export default CriteriaRecordPicker;
