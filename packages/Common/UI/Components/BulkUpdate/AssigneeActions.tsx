import React, { ReactElement, useState } from "react";

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { getRecordDisplayName } from "../../Utils/ModelDisplayName";
import PermissionGate, {
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import {
  PluralTemplate,
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import User from "../../Utils/User";
import useTranslator from "../../Utils/UseTranslator";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionContext,
} from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import { ActionMenuGroup } from "../ActionButton/ActionMenuGroup";
import BasicFormModal from "../FormModal/BasicFormModal";
import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import {
  PeoplePickerKind,
  toPeoplePickerIds,
} from "../PeoplePicker/PeoplePickerTypes";
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
import { ASSIGN_TO_ME_TITLE } from "./BulkOwnerActions";

/*
 * ONE WAY TO ASSIGN A RECORD THAT HAS ONE ASSIGNEE.
 *
 * A security case is assigned to one person (and belongs to a team): the
 * record holds the assignee's id in a column of its own. These actions set
 * it from a list, without opening the record, in a row's ⋯ menu and in Bulk
 * Actions:
 *
 *   - "Assign to Me" writes the viewer at once; a row already assigned to
 *     them is not offered it (and, in bulk, is listed as left alone);
 *   - "Assign to Someone Else" opens the people picker every OneUptime form
 *     uses, one person - and, where the record has a team column, its team
 *     too - and writes them to the row, or to each selected row;
 *   - both are gated on the column's own update permission, locked with the
 *     permission it takes for someone who may not change it;
 *   - every write goes through the API, one row at a time, so the server
 *     checks each row and runs what an assignment runs.
 *
 * A record whose people are owners (rows of <Model>OwnerUser and
 * <Model>OwnerTeam) is assigned with useBulkOwnerActions instead.
 */

export interface AssigneeActionsConfig<T extends BaseModel> {
  modelType: { new (): T };
  // The column the assignee's id is written to: "assignedToUserId".
  userIdColumn: keyof T & string;
  // The team column, for a record that also names a team: "assignedToTeamId".
  teamIdColumn?: (keyof T & string) | undefined;
  // What one row and several are called, when the list calls them otherwise.
  singularName?: string | undefined;
  pluralName?: string | undefined;
  // How a dialog names a row; the row's name column otherwise.
  getItemName?: ((item: T) => string) | undefined;
  modelAPI?: typeof ModelAPI | undefined;
  // Told once a row's assignee changed (after the list is read again).
  onChanged?: (() => void) | undefined;
}

export interface AssigneeActionsResult<T extends BaseModel> {
  rowActions: Array<ActionButtonSchema<T>>;
  bulkActions: Array<BulkActionButtonSchema<T>>;
  modals: ReactElement;
}

export const ASSIGN_TO_SOMEONE_ELSE_TITLE: string = translationKey(
  "Assign to Someone Else",
);

export const ASSIGN_ROW_DESCRIPTION: string = translationKey(
  "Pick who {{name}} is assigned to.",
);

export const ASSIGN_BULK_DESCRIPTION: PluralTemplate = {
  one: "Pick who the {{count}} selected {{itemName}} is assigned to.",
  other: "Pick who the {{count}} selected {{itemsName}} are assigned to.",
};

export const ASSIGNEE_FIELD_TITLE: string = translationKey("Assignee");
export const ASSIGNEE_TEAM_FIELD_TITLE: string = translationKey("Team");

// Why a selected row was left alone.
export const ALREADY_ASSIGNED_TO_YOU: string = translationKey(
  "Assigned to you already.",
);
export const ALREADY_ASSIGNED_TO_THEM: string = translationKey(
  "Assigned to them already.",
);

export const ASSIGN_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} {{itemName}} assigned",
    other: "{{count}} {{itemsName}} assigned",
  },
  failed: {
    one: "{{count}} {{itemName}} not assigned",
    other: "{{count}} {{itemsName}} not assigned",
  },
};

// The id a row's column holds, as text ("" when it holds none).
export const readAssigneeId: <T extends BaseModel>(
  item: T,
  column: string,
) => string = <T extends BaseModel>(item: T, column: string): string => {
  const value: unknown = (item as unknown as JSONObject)[column];

  return value ? value.toString() : "";
};

// The people a dialog picked: one person, and a team where there is one.
export interface PickedAssignee {
  userId: string;
  teamId: string;
}

// What a write sets: the person, and the team when one was picked.
export const getAssigneeWrite: (data: {
  picked: PickedAssignee;
  userIdColumn: string;
  teamIdColumn?: string | undefined;
}) => JSONObject = (data: {
  picked: PickedAssignee;
  userIdColumn: string;
  teamIdColumn?: string | undefined;
}): JSONObject => {
  const write: JSONObject = {
    [data.userIdColumn]: data.picked.userId,
  };

  if (data.teamIdColumn && data.picked.teamId) {
    write[data.teamIdColumn] = data.picked.teamId;
  }

  return write;
};

// Whether a row already holds what a write would set.
export const isAlreadyAssigned: <T extends BaseModel>(data: {
  item: T;
  picked: PickedAssignee;
  userIdColumn: string;
  teamIdColumn?: string | undefined;
}) => boolean = <T extends BaseModel>(data: {
  item: T;
  picked: PickedAssignee;
  userIdColumn: string;
  teamIdColumn?: string | undefined;
}): boolean => {
  if (readAssigneeId(data.item, data.userIdColumn) !== data.picked.userId) {
    return false;
  }

  if (data.teamIdColumn && data.picked.teamId) {
    return readAssigneeId(data.item, data.teamIdColumn) === data.picked.teamId;
  }

  return true;
};

interface OpenDialog<T extends BaseModel> {
  kind: "row" | "bulk";
  items: Array<T>;
  bulkActionProps?: BulkActionOnClickProps<T> | undefined;
  context?: RowActionContext | undefined;
}

const USER_KEY: string = "assigneeUserId";
const TEAM_KEY: string = "assigneeTeamId";

function useAssigneeActions<T extends BaseModel>(
  config: AssigneeActionsConfig<T>,
): AssigneeActionsResult<T> {
  const translator: Translator = useTranslator();
  const model: T = new config.modelType();
  const modelAPI: typeof ModelAPI = config.modelAPI || ModelAPI;

  const [dialog, setDialog] = useState<OpenDialog<T> | null>(null);
  const [dialogError, setDialogError] = useState<string>("");

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

  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    config.userIdColumn,
  );

  const lock: { disabled?: boolean; tooltip?: string } =
    !gate.isAllowed && gate.disabledReason
      ? { disabled: true, tooltip: gate.disabledReason }
      : {};

  const getMyId: () => string = (): string => {
    const myId: string = User.getUserId()?.toString() || "";

    if (!myId) {
      throw new BadDataException("You are not signed in.");
    }

    return myId;
  };

  type WriteFunction = (item: T, picked: PickedAssignee) => Promise<void>;

  const write: WriteFunction = async (
    item: T,
    picked: PickedAssignee,
  ): Promise<void> => {
    if (!item.id) {
      throw new BadDataException("Item ID not found");
    }

    await modelAPI.updateById<T>({
      modelType: config.modelType,
      id: item.id as ObjectID,
      data: getAssigneeWrite({
        picked: picked,
        userIdColumn: config.userIdColumn,
        teamIdColumn: config.teamIdColumn,
      }),
    });
  };

  type RunBulkFunction = (
    actionProps: BulkActionOnClickProps<T>,
    picked: PickedAssignee,
    alreadyReason: string,
  ) => Promise<void>;

  const runBulk: RunBulkFunction = async (
    actionProps: BulkActionOnClickProps<T>,
    picked: PickedAssignee,
    alreadyReason: string,
  ): Promise<void> => {
    await runBulkAction<T>({
      actionProps: actionProps,
      concurrency: 1,
      step: async (item: T): Promise<BulkItemOutcome> => {
        if (
          isAlreadyAssigned({
            item: item,
            picked: picked,
            userIdColumn: config.userIdColumn,
            teamIdColumn: config.teamIdColumn,
          })
        ) {
          return bulkItemUnchanged(
            translator.translateText(alreadyReason) || alreadyReason,
          );
        }

        await write(item, picked);

        return BULK_ITEM_CHANGED;
      },
    });

    config.onChanged?.();
  };

  const assignToMeRowAction: ActionButtonSchema<T> = {
    title: ASSIGN_TO_ME_TITLE,
    icon: IconProp.User,
    buttonStyleType: ButtonStyleType.OUTLINE,
    menuGroup: ActionMenuGroup.People,
    placement: ActionButtonPlacement.MoreMenu,
    // Not on a row that is the viewer's already.
    isVisible: (item: T): boolean => {
      const myId: string = User.getUserId()?.toString() || "";

      return !myId || readAssigneeId(item, config.userIdColumn) !== myId;
    },
    ...lock,
    onClick: async (
      item: T,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): Promise<void> => {
      try {
        await write(item, { userId: getMyId(), teamId: "" });
        context?.refresh();
        config.onChanged?.();
        onCompleteAction();
      } catch (err) {
        onError(new Error(API.getFriendlyMessage(err)));
      }
    },
  };

  const assignToSomeoneElseRowAction: ActionButtonSchema<T> = {
    title: ASSIGN_TO_SOMEONE_ELSE_TITLE,
    icon: IconProp.UserPlus,
    buttonStyleType: ButtonStyleType.OUTLINE,
    menuGroup: ActionMenuGroup.People,
    placement: ActionButtonPlacement.MoreMenu,
    ...lock,
    onClick: (
      item: T,
      onCompleteAction: VoidFunction,
      _onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): void => {
      setDialogError("");
      setDialog({ kind: "row", items: [item], context: context });
      onCompleteAction();
    },
  };

  const assignToMeBulkAction: BulkActionButtonSchema<T> = {
    title: ASSIGN_TO_ME_TITLE,
    icon: IconProp.User,
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: ActionMenuGroup.People,
    resultLabels: ASSIGN_RESULT_LABELS,
    ...lock,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      await runBulk(
        actionProps,
        { userId: getMyId(), teamId: "" },
        ALREADY_ASSIGNED_TO_YOU,
      );
    },
  };

  const assignToSomeoneElseBulkAction: BulkActionButtonSchema<T> = {
    title: ASSIGN_TO_SOMEONE_ELSE_TITLE,
    icon: IconProp.UserPlus,
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: ActionMenuGroup.People,
    resultLabels: ASSIGN_RESULT_LABELS,
    ...lock,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setDialogError("");
      setDialog({
        kind: "bulk",
        items: actionProps.items,
        bulkActionProps: actionProps,
      });
    },
  };

  const close: VoidFunction = (): void => {
    setDialog(null);
    setDialogError("");
  };

  type SubmitFunction = (formData: JSONObject) => Promise<void>;

  const submit: SubmitFunction = async (
    formData: JSONObject,
  ): Promise<void> => {
    if (!dialog) {
      return;
    }

    const picked: PickedAssignee = {
      userId: toPeoplePickerIds(formData[USER_KEY])[0] || "",
      teamId: toPeoplePickerIds(formData[TEAM_KEY])[0] || "",
    };

    if (!picked.userId) {
      return;
    }

    if (dialog.kind === "row") {
      const item: T | undefined = dialog.items[0];

      if (
        !item ||
        isAlreadyAssigned({
          item: item,
          picked: picked,
          userIdColumn: config.userIdColumn,
          teamIdColumn: config.teamIdColumn,
        })
      ) {
        close();
        return;
      }

      try {
        await write(item, picked);
      } catch (err) {
        setDialogError(API.getFriendlyMessage(err));
        return;
      }

      const context: RowActionContext | undefined = dialog.context;
      close();
      context?.refresh();
      config.onChanged?.();
      return;
    }

    const actionProps: BulkActionOnClickProps<T> | undefined =
      dialog.bulkActionProps;

    close();

    if (actionProps) {
      await runBulk(actionProps, picked, ALREADY_ASSIGNED_TO_THEM);
    }
  };

  const fields: Array<Field<JSONObject>> = [
    {
      field: { [USER_KEY]: true },
      title: ASSIGNEE_FIELD_TITLE,
      fieldType: FormFieldSchemaType.PeoplePicker,
      required: true,
      peoplePicker: {
        kinds: [{ kind: PeoplePickerKind.User, valueKey: USER_KEY }],
        isSinglePick: true,
        addButtonText: translationKey("Choose someone"),
        searchPlaceholder: translationKey("Search by name or email…"),
        emptyText: translationKey("No project members"),
      },
    },
    ...(config.teamIdColumn
      ? [
          {
            field: { [TEAM_KEY]: true },
            title: ASSIGNEE_TEAM_FIELD_TITLE,
            fieldType: FormFieldSchemaType.PeoplePicker,
            required: false,
            peoplePicker: {
              kinds: [{ kind: PeoplePickerKind.Team, valueKey: TEAM_KEY }],
              isSinglePick: true,
              addButtonText: translationKey("Choose a team"),
              searchPlaceholder: translationKey("Search teams…"),
              emptyText: translationKey("No teams"),
            },
          } as Field<JSONObject>,
        ]
      : []),
  ];

  const description: string = !dialog
    ? ""
    : dialog.kind === "row"
      ? translator.translateTemplate(ASSIGN_ROW_DESCRIPTION, {
          name: dialog.items[0] ? nameOf(dialog.items[0]) : "",
        })
      : translator.translatePlural(
          ASSIGN_BULK_DESCRIPTION,
          dialog.items.length,
          nounValues(true),
        );

  const modals: ReactElement = dialog ? (
    <BasicFormModal<JSONObject>
      title={ASSIGN_TO_SOMEONE_ELSE_TITLE}
      description={description}
      error={dialogError || undefined}
      onClose={close}
      submitButtonText={translationKey("Assign")}
      onSubmit={submit}
      formProps={{
        name: `assign-${config.userIdColumn}`,
        fields: fields,
      }}
    />
  ) : (
    <></>
  );

  return {
    rowActions: [assignToMeRowAction, assignToSomeoneElseRowAction],
    bulkActions: [assignToMeBulkAction, assignToSomeoneElseBulkAction],
    modals: modals,
  };
}

export default useAssigneeActions;
