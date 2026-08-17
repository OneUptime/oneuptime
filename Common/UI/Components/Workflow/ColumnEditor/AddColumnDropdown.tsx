/*
 * The "add a field" picker.
 *
 * This is the part that answers the complaint directly: the columns are already
 * known, so they are offered by name and description rather than typed from
 * memory into a box labelled "Key". Required columns are grouped first, because
 * on a create those are the ones that decide whether the step works at all.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "../../Dropdown/Dropdown";
import Icon from "../../Icon/Icon";
import Input from "../../Input/Input";
import { ModelSchemaColumn } from "../ModelSchema";
import { columnTypeLabel } from "./ColumnControl";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  /** Already filtered to what may be offered, and to what is not on screen. */
  columns: Array<ModelSchemaColumn>;
  /** Column ids a create must be given a value for, listed first. */
  requiredColumnIds: Array<string>;
  placeholder: string;
  /**
   * True when there is nothing to offer from the schema - it failed to load, or
   * every column is already on screen - and the builder must still be able to
   * name one. The runner accepts column names this endpoint does not describe.
   */
  allowCustomColumn: boolean;
  onAdd: (columnId: string) => void;
  dataTestId?: string | undefined;
}

type ToOptionFunction = (column: ModelSchemaColumn) => DropdownOption;

const toOption: ToOptionFunction = (
  column: ModelSchemaColumn,
): DropdownOption => {
  return {
    value: column.id,
    label: `${column.title} · ${column.id}`,
    /*
     * The model's own description, shown as the option's second line. It is the
     * sentence that was previously nowhere on this screen, and it is the whole
     * reason the picker beats a text box.
     */
    description: column.description || columnTypeLabel(column),
  };
};

const AddColumnDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [customColumnId, setCustomColumnId] = useState<string>("");
  const [isNamingCustomColumn, setIsNamingCustomColumn] =
    useState<boolean>(false);
  /*
   * Bumped after every pick to remount the dropdown. It keeps its selection in
   * state of its own and only re-reads props.value when that prop changes, so
   * without this the picker would go on displaying the field it just added -
   * as though it were a filter rather than an action.
   */
  const [pickerNonce, setPickerNonce] = useState<number>(0);

  type AddCustomColumnFunction = () => void;

  const addCustomColumn: AddCustomColumnFunction = (): void => {
    const columnId: string = customColumnId.trim();

    if (columnId === "") {
      return;
    }

    props.onAdd(columnId);
    setCustomColumnId("");
    setIsNamingCustomColumn(false);
  };

  const hasOptions: boolean = props.columns.length > 0;

  if (isNamingCustomColumn || !hasOptions) {
    return (
      <div className="flex items-start gap-2">
        <div className="w-64">
          <Input
            value={customColumnId}
            placeholder="Column name"
            outerDivClassName="relative w-full"
            dataTestId={`${props.dataTestId || "model-column-add"}-custom`}
            onChange={setCustomColumnId}
            onEnterPress={addCustomColumn}
          />
        </div>
        <Button
          title="Add"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={addCustomColumn}
        />
        {hasOptions && (
          <Button
            title="Cancel"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            onClick={() => {
              setIsNamingCustomColumn(false);
              setCustomColumnId("");
            }}
          />
        )}
      </div>
    );
  }

  const requiredColumns: Array<ModelSchemaColumn> = props.columns.filter(
    (column: ModelSchemaColumn) => {
      return props.requiredColumnIds.includes(column.id);
    },
  );

  const otherColumns: Array<ModelSchemaColumn> = props.columns.filter(
    (column: ModelSchemaColumn) => {
      return !props.requiredColumnIds.includes(column.id);
    },
  );

  const options: Array<DropdownOption | DropdownOptionGroup> =
    requiredColumns.length > 0
      ? [
          { label: "Required", options: requiredColumns.map(toOption) },
          { label: "All fields", options: otherColumns.map(toOption) },
        ]
      : props.columns.map(toOption);

  return (
    <div className="flex items-center gap-3">
      <div className="w-72">
        <Dropdown
          key={pickerNonce}
          options={options}
          placeholder={props.placeholder}
          className="relative w-full overflow-visible rounded-md"
          isMultiSelect={false}
          dataTestId={props.dataTestId || "model-column-add"}
          ariaLabel={props.placeholder}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (value === null || Array.isArray(value)) {
              return;
            }

            setPickerNonce(pickerNonce + 1);
            props.onAdd(String(value));
          }}
        />
      </div>
      {props.allowCustomColumn && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          onClick={() => {
            setIsNamingCustomColumn(true);
          }}
        >
          <Icon icon={IconProp.Add} className="h-3 w-3" />
          Add a column by name
        </button>
      )}
    </div>
  );
};

export default AddColumnDropdown;
