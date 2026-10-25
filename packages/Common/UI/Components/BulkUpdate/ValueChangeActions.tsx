import React, { ReactElement, useRef, useState } from "react";

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ArchivedValuePicker from "../../Utils/ArchivedValuePicker";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import { getRecordDisplayName } from "../../Utils/ModelDisplayName";
import PermissionGate, {
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import ProjectUtil from "../../Utils/Project";
import {
  PluralTemplate,
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionContext,
} from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import { ActionMenuGroup } from "../ActionButton/ActionMenuGroup";
import { DropdownOption } from "../Dropdown/Dropdown";
import DeleteItemNames from "../DeleteConfirmation/DeleteItemNames";
import BasicFormModal from "../FormModal/BasicFormModal";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "./BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "./BulkUpdateForm";

/*
 * ONE WAY TO CHANGE A RECORD'S VALUE FROM A LIST.
 *
 * An incident's severity, an alert's, a security case's priority or status:
 * a record points at one of its project's values, and the values are an
 * ordered list the project keeps (Settings > Incident Severity, ...). These
 * actions change it without opening the record - "Change Severity" in a
 * row's ⋯ menu, and in Bulk Actions for every row selected - the way the
 * record's own Edit form does: the same column, written through the API, so
 * the server checks the permission on each row and runs everything a change
 * of that value runs (the timeline line, the notifications).
 *
 *   - the values offered are the project's own, in their order, the
 *     archived ones left out (nobody can pick one again: ArchivedValuePicker);
 *     read when the dialog opens, never before, so a list that offers the
 *     action costs no request until it is used;
 *   - the row's dialog lists the value it has now, marked Current, where it
 *     cannot be picked again - as a security case's Change Priority and
 *     Change Status do - so the dialog never sends what the row has;
 *   - the action is gated on the column's own update permission, locked for
 *     someone who may not change it, with the permission it takes;
 *   - in bulk, a row that has the value already is left alone and listed
 *     ("Already Critical."), and a row the server refuses is listed with its
 *     words; the others change one after another.
 */

export interface ValueChangeActionsConfig<
  T extends BaseModel,
  V extends BaseModel,
> {
  modelType: { new (): T };
  /*
   * The record's link to its value ("incidentSeverity") and the column the
   * value's id is written to ("incidentSeverityId"). The list reads the
   * link with its _id (a column or selectMoreFields), so a row's value now
   * is known.
   */
  column: keyof T & string;
  idColumn: keyof T & string;
  // The values: IncidentSeverity, SecurityCasePriority, ...
  valueModelType: { new (): V };
  // The menu item and the dialog's title and button, in English.
  title: string;
  // The field's title in the dialog, in English: "Severity".
  fieldTitle: string;
  // What the empty field says, in English: "Choose a severity".
  placeholder?: string | undefined;
  icon: IconProp;
  /*
   * Narrows the values offered beyond the project's live ones - a list
   * whose records take only some of them.
   */
  valueQuery?: JSONObject | undefined;
  // What one row and several are called, when the list calls them otherwise.
  singularName?: string | undefined;
  pluralName?: string | undefined;
  // How a dialog names a row; the row's name column otherwise.
  getItemName?: ((item: T) => string) | undefined;
  // The API the reads and writes go through.
  modelAPI?: typeof ModelAPI | undefined;
  // Told once a row's value changed (after the list is read again).
  onChanged?: (() => void) | undefined;
}

export interface ValueChangeActionsResult<T extends BaseModel> {
  rowActions: Array<ActionButtonSchema<T>>;
  bulkActions: Array<BulkActionButtonSchema<T>>;
  // The dialog the actions open; drawn by the list beside its table.
  modals: ReactElement;
}

// The dialog's sentence for one row: "Pick the new severity for Checkout API down."
export const VALUE_CHANGE_ROW_DESCRIPTION: string = translationKey(
  "Pick the new {{field}} for {{name}}.",
);

// ... and for a selection: "Pick the severity for the 3 selected incidents."
export const VALUE_CHANGE_BULK_DESCRIPTION: PluralTemplate = {
  one: "Pick the {{field}} for the {{count}} selected {{itemName}}.",
  other: "Pick the {{field}} for the {{count}} selected {{itemsName}}.",
};

// Beside the value the row has now, in the row's dialog.
export const VALUE_CHANGE_CURRENT: string = translationKey("Current");

// Why a selected row was left alone: "Already Critical."
export const VALUE_CHANGE_ALREADY: string =
  translationKey("Already {{value}}.");

export const VALUE_CHANGE_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} {{itemName}} updated",
    other: "{{count}} {{itemsName}} updated",
  },
  failed: {
    one: "{{count}} {{itemName}} not updated",
    other: "{{count}} {{itemsName}} not updated",
  },
};

// The form value the picked value's id is held under.
const PICKED_VALUE_KEY: string = "pickedValueId";

// A value as the dialog lists it.
export interface ValueChoice {
  id: string;
  name: string;
  color?: Color | undefined;
}

// The id of the value a row has now, read off its link or its id column.
export const getCurrentValueId: <T extends BaseModel>(
  item: T,
  column: string,
  idColumn: string,
) => string = <T extends BaseModel>(
  item: T,
  column: string,
  idColumn: string,
): string => {
  const record: JSONObject = item as unknown as JSONObject;
  const link: unknown = record[column];

  if (link && typeof link === "object") {
    const linkId: unknown =
      (link as JSONObject)["_id"] || (link as JSONObject)["id"];

    if (linkId) {
      return linkId.toString();
    }
  }

  const id: unknown = record[idColumn];

  return id ? id.toString() : "";
};

/*
 * The dialog's options: every value, in order, the one the row has now
 * marked Current and not offered again (a row's dialog only): listed, so
 * the reader sees where the row stands, but never the one picked.
 */
export const getValueChoiceOptions: (data: {
  values: Array<ValueChoice>;
  currentValueId?: string | undefined;
  translator: Translator;
}) => Array<DropdownOption> = (data: {
  values: Array<ValueChoice>;
  currentValueId?: string | undefined;
  translator: Translator;
}): Array<DropdownOption> => {
  return data.values.map((value: ValueChoice): DropdownOption => {
    const option: DropdownOption = {
      value: value.id,
      label: value.name,
    };

    if (value.color) {
      option.color = value.color;
    }

    if (data.currentValueId && value.id === data.currentValueId) {
      option.description =
        data.translator.translateText(VALUE_CHANGE_CURRENT) ||
        VALUE_CHANGE_CURRENT;
      option.isDisabled = true;
    }

    return option;
  });
};

interface OpenDialog<T extends BaseModel> {
  // Which opening this is: a read that comes back late fills only its own.
  openId: number;
  // One row (from its ⋯ menu), or the selection (Bulk Actions).
  kind: "row" | "bulk";
  items: Array<T>;
  bulkActionProps?: BulkActionOnClickProps<T> | undefined;
  context?: RowActionContext | undefined;
  /*
   * The project's values, read as the dialog opens: the dialog shows at
   * once, waiting for them, rather than after them.
   */
  isReadingValues: boolean;
  values: Array<ValueChoice>;
  error: string;
}

function useValueChangeActions<T extends BaseModel, V extends BaseModel>(
  config: ValueChangeActionsConfig<T, V>,
): ValueChangeActionsResult<T> {
  const translator: Translator = useTranslator();
  const model: T = new config.modelType();
  const valueModel: V = new config.valueModelType();
  const modelAPI: typeof ModelAPI = config.modelAPI || ModelAPI;

  const [dialog, setDialog] = useState<OpenDialog<T> | null>(null);
  const [dialogError, setDialogError] = useState<string>("");
  // One row's value being written: its dialog's button is busy, pressed once.
  const [isWriting, setIsWriting] = useState<boolean>(false);
  const isWritingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const openCount: React.MutableRefObject<number> = useRef<number>(0);

  const nounValues: (
    inSentence: boolean,
  ) => Record<string, TranslatableTerm> = (
    inSentence: boolean,
  ): Record<string, TranslatableTerm> => {
    return {
      itemName: translatableTerm(
        config.singularName || model.singularName || "item",
        { inSentence: inSentence },
      ),
      itemsName: translatableTerm(
        config.pluralName || model.pluralName || "items",
        { inSentence: inSentence },
      ),
    };
  };

  const nameOf: (item: T) => string = (item: T): string => {
    const given: string = config.getItemName
      ? config.getItemName(item).trim()
      : "";

    return given || getRecordDisplayName(item, { model: model });
  };

  // Writing the value is an update of that one column.
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    config.idColumn,
  );

  // The project's live values, in their order.
  const readValues: () => Promise<Array<ValueChoice>> = async (): Promise<
    Array<ValueChoice>
  > => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const select: JSONObject = { _id: true, name: true };

    if (valueModel.hasColumn("color")) {
      select["color"] = true;
    }

    const result: ListResult<V> = await modelAPI.getList<V>({
      modelType: config.valueModelType,
      query: ArchivedValuePicker.getPickerQuery(config.valueModelType, {
        ...(projectId ? { projectId: projectId } : {}),
        ...(config.valueQuery || {}),
      }) as never,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: select as never,
      sort: (valueModel.hasColumn("order")
        ? { order: SortOrder.Ascending }
        : { name: SortOrder.Ascending }) as never,
    });

    return ArchivedValuePicker.getLiveValues(result.data).map(
      (value: V): ValueChoice => {
        const record: JSONObject = value as unknown as JSONObject;
        const color: unknown = record["color"];

        return {
          id: value.id?.toString() || record["_id"]?.toString() || "",
          name: (record["name"] as string | undefined) || "",
          color: color instanceof Color ? color : undefined,
        };
      },
    );
  };

  type OpenFunction = (data: {
    kind: "row" | "bulk";
    items: Array<T>;
    bulkActionProps?: BulkActionOnClickProps<T> | undefined;
    context?: RowActionContext | undefined;
  }) => Promise<void>;

  const open: OpenFunction = async (data: {
    kind: "row" | "bulk";
    items: Array<T>;
    bulkActionProps?: BulkActionOnClickProps<T> | undefined;
    context?: RowActionContext | undefined;
  }): Promise<void> => {
    openCount.current += 1;
    const openId: number = openCount.current;

    // The dialog opens at once, waiting for the values it offers.
    setDialogError("");
    setDialog({
      openId: openId,
      kind: data.kind,
      items: data.items,
      bulkActionProps: data.bulkActionProps,
      context: data.context,
      isReadingValues: true,
      values: [],
      error: "",
    });

    let values: Array<ValueChoice> = [];
    let error: string = "";

    try {
      values = await readValues();
    } catch (err) {
      error = API.getFriendlyMessage(err);
    }

    // Closed, or opened again, meanwhile: this read is no one's now.
    setDialog((current: OpenDialog<T> | null): OpenDialog<T> | null => {
      if (!current || current.openId !== openId) {
        return current;
      }

      return {
        ...current,
        isReadingValues: false,
        values: values,
        error: error,
      };
    });
  };

  const close: VoidFunction = (): void => {
    setDialog(null);
    setDialogError("");
  };

  type WriteFunction = (item: T, valueId: string) => Promise<void>;

  const write: WriteFunction = async (
    item: T,
    valueId: string,
  ): Promise<void> => {
    if (!item.id) {
      throw new BadDataException("Item ID not found");
    }

    await modelAPI.updateById<T>({
      modelType: config.modelType,
      id: item.id as ObjectID,
      data: {
        [config.idColumn]: valueId,
      },
    });
  };

  type SubmitFunction = (valueId: string) => Promise<void>;

  const submit: SubmitFunction = async (valueId: string): Promise<void> => {
    if (!dialog || !valueId) {
      return;
    }

    const picked: ValueChoice | undefined = dialog.values.find(
      (value: ValueChoice): boolean => {
        return value.id === valueId;
      },
    );

    if (dialog.kind === "row") {
      const item: T | undefined = dialog.items[0];

      // A write in flight: a second press waits for it.
      if (isWritingRef.current) {
        return;
      }

      // Nothing to change: the row has that value already.
      if (
        !item ||
        getCurrentValueId(item, config.column, config.idColumn) === valueId
      ) {
        close();
        return;
      }

      isWritingRef.current = true;
      setIsWriting(true);

      try {
        await write(item, valueId);
      } catch (err) {
        setDialogError(API.getFriendlyMessage(err));
        return;
      } finally {
        isWritingRef.current = false;
        setIsWriting(false);
      }

      const context: RowActionContext | undefined = dialog.context;
      close();
      context?.refresh();
      config.onChanged?.();
      return;
    }

    const actionProps: BulkActionOnClickProps<T> | undefined =
      dialog.bulkActionProps;

    // The progress dialog takes over from here.
    close();

    if (!actionProps) {
      return;
    }

    const valueName: string = picked?.name || "";

    await runBulkAction<T>({
      actionProps: actionProps,
      concurrency: 1,
      step: async (item: T): Promise<BulkItemOutcome> => {
        if (
          getCurrentValueId(item, config.column, config.idColumn) === valueId
        ) {
          return bulkItemUnchanged(
            translator.translateTemplate(VALUE_CHANGE_ALREADY, {
              value: translatableTerm(valueName),
            }),
          );
        }

        await write(item, valueId);

        return BULK_ITEM_CHANGED;
      },
    });

    config.onChanged?.();
  };

  const lock: { disabled?: boolean; tooltip?: string } =
    !gate.isAllowed && gate.disabledReason
      ? { disabled: true, tooltip: gate.disabledReason }
      : {};

  const rowAction: ActionButtonSchema<T> = {
    title: config.title,
    icon: config.icon,
    buttonStyleType: ButtonStyleType.OUTLINE,
    menuGroup: ActionMenuGroup.Change,
    // In the ⋯ menu: the row's one button stays View.
    placement: ActionButtonPlacement.MoreMenu,
    ...lock,
    onClick: async (
      item: T,
      onCompleteAction: VoidFunction,
      _onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): Promise<void> => {
      await open({ kind: "row", items: [item], context: context });
      onCompleteAction();
    },
  };

  const bulkAction: BulkActionButtonSchema<T> = {
    title: config.title,
    icon: config.icon,
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: ActionMenuGroup.Change,
    resultLabels: VALUE_CHANGE_RESULT_LABELS,
    ...lock,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      await open({
        kind: "bulk",
        items: actionProps.items,
        bulkActionProps: actionProps,
      });
    },
  };

  const fieldTerm: TranslatableTerm = translatableTerm(config.fieldTitle, {
    inSentence: true,
  });

  const description: string = !dialog
    ? ""
    : dialog.kind === "row"
      ? translator.translateTemplate(VALUE_CHANGE_ROW_DESCRIPTION, {
          field: fieldTerm,
          name: dialog.items[0] ? nameOf(dialog.items[0]) : "",
        })
      : translator.translatePlural(
          VALUE_CHANGE_BULK_DESCRIPTION,
          dialog.items.length,
          {
            field: fieldTerm,
            ...nounValues(true),
          },
        );

  const modals: ReactElement = dialog ? (
    <BasicFormModal<JSONObject>
      title={config.title}
      description={description}
      error={dialogError || dialog.error || undefined}
      isLoading={dialog.isReadingValues}
      isSubmitting={dialog.kind === "row" && isWriting}
      onClose={close}
      submitButtonText={config.title}
      onSubmit={async (formData: JSONObject) => {
        await submit(String(formData[PICKED_VALUE_KEY] || ""));
      }}
      /*
       * A selection's dialog names the rows it changes, as its neighbours
       * in Bulk Actions do (a state move's); one row's sentence names it.
       */
      beforeFormElement={
        dialog.kind === "bulk" ? (
          <DeleteItemNames
            names={dialog.items
              .map((item: T): string => {
                return nameOf(item);
              })
              .filter((name: string): boolean => {
                return Boolean(name);
              })}
            totalCount={dialog.items.length}
          />
        ) : undefined
      }
      formProps={{
        name: `change-${config.idColumn}`,
        /*
         * Nothing is picked as it opens: the row's own value is listed,
         * Current, and cannot be picked again.
         */
        fields: [
          {
            field: {
              [PICKED_VALUE_KEY]: true,
            },
            title: config.fieldTitle,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            ...(config.placeholder ? { placeholder: config.placeholder } : {}),
            dropdownOptions: getValueChoiceOptions({
              values: dialog.values,
              currentValueId:
                dialog.kind === "row" && dialog.items[0]
                  ? getCurrentValueId(
                      dialog.items[0],
                      config.column,
                      config.idColumn,
                    )
                  : undefined,
              translator: translator,
            }),
          },
        ],
      }}
    />
  ) : (
    <></>
  );

  return {
    rowActions: [rowAction],
    bulkActions: [bulkAction],
    modals: modals,
  };
}

export default useValueChangeActions;
