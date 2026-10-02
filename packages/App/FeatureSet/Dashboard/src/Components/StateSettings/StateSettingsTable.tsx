import {
  StateSettingsPageCopy,
  StateSettingsSharedCopy,
} from "./StateSettingsCopy";
import {
  getStateSettingsBuiltInTooltip,
  getStateSettingsCountsAs,
} from "./StateSettingsRows";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { StateListDefinition } from "Common/Utils/StateOrder";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Columns from "Common/UI/Components/ModelTable/Columns";
import SelectEntityField from "Common/UI/Types/SelectEntityField";
import Pill from "Common/UI/Components/Pill/Pill";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The table the six state, severity and monitor status settings pages share:
 * one compact, draggable row per state - its colour and name, what it counts
 * as (on the state pages), and its description - instead of a stack of big
 * centred cards. Each page keeps its own <ModelTable<...>> (so the
 * drag-ordered list guard can read it) and takes its columns and form from
 * here, so the six look and read the same.
 */

/*
 * The six models share these columns, but a generic table cannot name them
 * through its own field type.
 */
const selectField: <T extends BaseModel>(
  column: string,
) => SelectEntityField<T> = <T extends BaseModel>(
  column: string,
): SelectEntityField<T> => {
  return { [column]: true } as SelectEntityField<T>;
};

export interface StateSettingsNameCellProps {
  name: string;
  color: Color;
  // What OneUptime does with this row, when it is a built-in one.
  builtInTooltip?: string | undefined;
}

/*
 * The row's colour dot and name, as states and severities look in every
 * other table, and - for a built-in row - a small "Built-in" tag whose
 * tooltip says what OneUptime does with it.
 */
export const StateSettingsNameCell: FunctionComponent<
  StateSettingsNameCellProps
> = (props: StateSettingsNameCellProps): ReactElement => {
  const { translateString } = useTranslateValue();

  const builtInTag: string =
    translateString(StateSettingsSharedCopy.builtInTag) ||
    StateSettingsSharedCopy.builtInTag;

  const builtInTooltip: string | undefined = props.builtInTooltip
    ? translateString(props.builtInTooltip) || props.builtInTooltip
    : undefined;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="state-settings-name"
    >
      <Pill isMinimal={true} color={props.color} text={props.name} />
      {builtInTooltip ? (
        /*
         * Focusable, so the tooltip opens from the keyboard too. What it
         * says is in the tag as well, for a screen reader, which is why the
         * tooltip does not describe the tag a second time.
         */
        <Tooltip text={builtInTooltip} isTriggerAlreadyDescribed={true}>
          <div
            tabIndex={0}
            data-testid="state-settings-built-in"
            className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon icon={IconProp.Lock} className="h-3 w-3" />
            <span>{builtInTag}</span>
            <span className="sr-only">{builtInTooltip}</span>
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
};

export interface StateSettingsTextCellProps {
  text: string | null;
  // Translate the text: it is OneUptime's own words, not the project's.
  isOwnCopy?: boolean | undefined;
  testId?: string | undefined;
}

export const StateSettingsTextCell: FunctionComponent<
  StateSettingsTextCellProps
> = (props: StateSettingsTextCellProps): ReactElement => {
  const { translateString } = useTranslateValue();

  if (!props.text) {
    return <></>;
  }

  return (
    <span className="text-sm text-gray-600" data-testid={props.testId}>
      {props.isOwnCopy ? translateString(props.text) || props.text : props.text}
    </span>
  );
};

/**
 * The page's columns: the name (with its colour and, for a built-in row, the
 * Built-in tag), what a row counts as on the state pages, and the
 * description. `rows` are the rows on the page, which "Counts as" is worked
 * out from. No column shows or sorts by the order: the rows are dragged.
 */
export const getStateSettingsColumns: <T extends BaseModel>(data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  rows: Array<T>;
}) => Columns<T> = <T extends BaseModel>(data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  rows: Array<T>;
}): Columns<T> => {
  const columns: Columns<T> = [
    {
      field: selectField<T>("name"),
      title: StateSettingsSharedCopy.nameColumnTitle,
      type: FieldType.Text,
      isNotCustomizable: true,
      getElement: (item: T): ReactElement => {
        const record: Record<string, unknown> = item as unknown as Record<
          string,
          unknown
        >;

        return (
          <StateSettingsNameCell
            name={(record["name"] as string) || ""}
            color={(record["color"] as Color) || Gray500}
            builtInTooltip={getStateSettingsBuiltInTooltip({
              definition: data.definition,
              copy: data.copy,
              item: item,
            })}
          />
        );
      },
    },
  ];

  if (data.copy.countsAs) {
    const countsAs: (item: T) => string = (item: T): string => {
      return (
        getStateSettingsCountsAs({
          definition: data.definition,
          copy: data.copy,
          rows: data.rows,
          item: item,
        }) || ""
      );
    };

    columns.push({
      // Worked out from where the row sits, not read off one field.
      field: selectField<T>("_id"),
      id: "counts-as",
      title: data.copy.countsAs.title,
      headerTooltip: data.copy.countsAs.tooltip,
      type: FieldType.Text,
      getExportValue: countsAs,
      getElement: (item: T): ReactElement => {
        return (
          <StateSettingsTextCell
            text={countsAs(item)}
            isOwnCopy={true}
            testId="state-settings-counts-as"
          />
        );
      },
    });
  }

  columns.push({
    field: selectField<T>("description"),
    title: StateSettingsSharedCopy.descriptionColumnTitle,
    type: FieldType.LongText,
    wrapContent: true,
    hideOnMobile: true,
    getElement: (item: T): ReactElement => {
      return (
        <StateSettingsTextCell
          text={
            ((item as unknown as Record<string, unknown>)[
              "description"
            ] as string) || null
          }
          testId="state-settings-description"
        />
      );
    },
  });

  return columns;
};

/**
 * The create and edit form: a name, a description and a colour - nothing
 * about the order, which is set by dragging the rows.
 */
export const getStateSettingsFormFields: <T extends BaseModel>(
  copy: StateSettingsPageCopy,
) => Array<ModelField<T>> = <T extends BaseModel>(
  copy: StateSettingsPageCopy,
): Array<ModelField<T>> => {
  return [
    {
      field: selectField<T>("name"),
      title: StateSettingsSharedCopy.nameFieldTitle,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: copy.namePlaceholder,
      validation: {
        minLength: 2,
      },
    },
    {
      field: selectField<T>("description"),
      title: StateSettingsSharedCopy.descriptionFieldTitle,
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: copy.descriptionPlaceholder,
    },
    {
      field: selectField<T>("color"),
      title: StateSettingsSharedCopy.colorFieldTitle,
      description: StateSettingsSharedCopy.colorFieldDescription,
      fieldType: FormFieldSchemaType.Color,
      required: true,
      placeholder: StateSettingsSharedCopy.colorFieldPlaceholder,
    },
  ];
};
