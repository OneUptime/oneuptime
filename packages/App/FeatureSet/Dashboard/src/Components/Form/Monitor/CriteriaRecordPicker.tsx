import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import { DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown, {
  EntityDropdownValue,
} from "Common/UI/Components/EntityDropdown/EntityDropdown";
import {
  getHeldValue,
  HeldValueOptions,
  useHeldValueOptions,
} from "Common/UI/Components/EntityDropdown/HeldValueOptions";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE ON-CALL POLICIES AND LABELS A MONITOR'S CRITERIA SET ON WHAT THEY
 * OPEN, SEARCHED ON THE SERVER (#10646, #10690).
 *
 * The criteria's incident and alert forms picked them from the project's
 * first 10,000 by name, and showed as picked only the saved ids found in
 * that list: a policy or a label past it could not be picked, did not show,
 * and was dropped the next time the field was changed - the next incident
 * the monitor opened went to nobody's on-call. The monitor form went on
 * reading those 10,000 every time it opened, only to name the picks.
 *
 * The picker searches the server as it is typed in (EntityDropdown), and
 * holds every saved id, read by its ids before it is drawn
 * (HeldValueOptions): each by its name, an archived label marked, one
 * deleted since reading "No longer available", to keep or take out. An
 * archived label is never offered for a new pick (ArchivedValuePicker).
 */

// A saved value no record answers to any more.
export const CRITERIA_RECORD_NOT_FOUND_LABEL: string = translationKey(
  "No longer available",
);

export interface ComponentProps {
  modelType: DatabaseBaseModelType;
  ids: Array<ObjectID> | undefined;
  placeholder: string;
  onChange: (ids: Array<ObjectID>) => void;
  dataTestId?: string | undefined;
}

const CriteriaRecordPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ids: Array<string> = (props.ids || []).map((id: ObjectID): string => {
    return id.toString();
  });

  const held: HeldValueOptions = useHeldValueOptions({
    modelType: props.modelType,
    ids: ids,
    notFoundLabel: CRITERIA_RECORD_NOT_FOUND_LABEL,
  });

  // Drawn once its picks are named: never their bare ids.
  if (!held.options && ids.length > 0) {
    return (
      <div
        data-testid={
          props.dataTestId ? `${props.dataTestId}-loading` : undefined
        }
      >
        <InlineValueSkeleton />
      </div>
    );
  }

  return (
    <EntityDropdown
      modelType={props.modelType}
      labelField="name"
      valueField="_id"
      isMultiSelect={true}
      placeholder={props.placeholder}
      dataTestId={props.dataTestId}
      notFoundLabel={CRITERIA_RECORD_NOT_FOUND_LABEL}
      value={
        getHeldValue({ ids: ids, options: held.options }) as EntityDropdownValue
      }
      onChange={(
        next: DropdownValue | Array<DropdownValue> | null,
        change: DropdownChange,
      ) => {
        // A record just picked is named by the search that offered it.
        held.remember(change.selectedOptions);

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
