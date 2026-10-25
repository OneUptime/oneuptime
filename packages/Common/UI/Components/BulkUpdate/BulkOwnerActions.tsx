import React, { ReactElement, useState } from "react";

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { getRecordDisplayName } from "../../Utils/ModelDisplayName";
import ProjectUtil from "../../Utils/Project";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import User from "../../Utils/User";
import useTranslator from "../../Utils/UseTranslator";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionContext,
} from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import { ActionMenuGroup } from "../ActionButton/ActionMenuGroup";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import BasicFormModal from "../FormModal/BasicFormModal";
import Field from "../Forms/Types/Field";
import getOwnersFormField from "../PeoplePicker/OwnersFormField";
import { toPeoplePickerIds } from "../PeoplePicker/PeoplePickerTypes";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "./BulkUpdateForm";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "./BulkActionRunner";

type OwnerJunctionModel = BaseModel;

export interface BulkOwnerActionsConfig<T extends BaseModel = BaseModel> {
  ownerUserModelType: { new (): OwnerJunctionModel };
  ownerTeamModelType: { new (): OwnerJunctionModel };
  resourceIdField: string;
  /*
   * "Assign to Me" in Bulk Actions too, ahead of Add Owner: for the lists of
   * work someone picks up - incidents, alerts, episodes, scheduled
   * maintenance. A row's ⋯ menu offers it wherever the list draws rowActions.
   */
  offerAssignToMeInBulk?: boolean | undefined;
  /*
   * Whether the viewer owns a row already, for a list that reads its rows'
   * owners (useResourceOwners): a row they own is not offered Assign to Me.
   * Left out, or answering undefined while the owners load, it is offered,
   * and on a row they own it adds nothing.
   */
  isOwnedByMe?: ((item: T) => boolean | undefined) | undefined;
  // How a row's Add Owner dialog names the row; its name column otherwise.
  getItemName?: ((item: T) => string) | undefined;
}

export interface BulkOwnerActionsResult<T extends BaseModel> {
  bulkActions: Array<BulkActionButtonSchema<T>>;
  /*
   * For each row's ⋯ menu: Assign to Me (the viewer becomes an owner, at
   * once) and Add Owner (the same people and teams picker, for that row).
   */
  rowActions: Array<ActionButtonSchema<T>>;
  modals: ReactElement;
}

export const ASSIGN_TO_ME_TITLE: string = translationKey("Assign to Me");

// Why Assign to Me left a selected row alone.
export const ALREADY_OWNED_BY_YOU: string = translationKey(
  "You are an owner already.",
);

// The Add Owner dialog of one row, naming it.
export const ADD_OWNER_TO_ROW_DESCRIPTION: string = translationKey(
  "Pick the people and teams to add as owners of {{name}}. Its existing owners are kept.",
);

export const ASSIGN_TO_ME_RESULT_LABELS: {
  succeeded: { one: string; other: string };
  failed: { one: string; other: string };
} = {
  succeeded: {
    one: "{{count}} {{itemName}} assigned to you",
    other: "{{count}} {{itemsName}} assigned to you",
  },
  failed: {
    one: "{{count}} {{itemName}} not assigned to you",
    other: "{{count}} {{itemsName}} not assigned to you",
  },
};

type BulkOwnerMode = "add" | "remove";

// The people and teams picked in the dialog, as ids.
interface PickedOwners {
  userIds: Array<string>;
  teamIds: Array<string>;
}

/*
 * The dialogs' one Owners field: the people picker every owners form uses,
 * people and teams in one list, at least one required. A row's dialog
 * gives it no line of its own: the sentence above the field says already
 * whose owners these become, and that the row keeps its owners.
 */
const ownersField: (description?: string | undefined) => Field<JSONObject> = (
  description?: string | undefined,
): Field<JSONObject> => {
  return getOwnersFormField<JSONObject>({
    usersKey: "ownerUserIds",
    teamsKey: "ownerTeamIds",
    ...(description ? { description: description } : {}),
    required: true,
  });
};

const readPickedOwners: (formData: JSONObject) => PickedOwners = (
  formData: JSONObject,
): PickedOwners => {
  return {
    userIds: toPeoplePickerIds(formData["ownerUserIds"]),
    teamIds: toPeoplePickerIds(formData["ownerTeamIds"]),
  };
};

/**
 * Reusable hook that provides "Add Owner" and "Remove Owner" bulk actions
 * for any ModelTable whose model has companion `<Resource>OwnerUser` and
 * `<Resource>OwnerTeam` junction tables (e.g., `ServiceOwnerUser` +
 * `ServiceOwnerTeam` with `serviceId` as the foreign key).
 *
 * Usage:
 *   const { bulkActions, modals } = useBulkOwnerActions<Service>({
 *     ownerUserModelType: ServiceOwnerUser,
 *     ownerTeamModelType: ServiceOwnerTeam,
 *     resourceIdField: "serviceId",
 *   });
 *   <ModelTable bulkActions={{ buttons: [...bulkActions, ...] }} />
 *   {modals}
 */
function useBulkOwnerActions<T extends BaseModel>(
  config: BulkOwnerActionsConfig<T>,
): BulkOwnerActionsResult<T> {
  const translator: Translator = useTranslator();
  /*
   * Owners are picked with the people picker, which searches the project's
   * people and teams when its list opens - nothing is read up front, so a
   * table that offers these actions costs no requests until they are used.
   */
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showRemoveModal, setShowRemoveModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<T> | null>(null);

  /*
   * The row a row's Add Owner is about, with the list's refresh, and what
   * went wrong adding to it - shown in the dialog, which stays open.
   */
  const [rowTarget, setRowTarget] = useState<{
    item: T;
    context?: RowActionContext | undefined;
  } | null>(null);
  const [rowAddError, setRowAddError] = useState<string>("");

  /*
   * The people and teams added as owners of one record, leaving out the
   * ones that own it already. Whether any was added.
   */
  const addOwnersToItem: (
    item: T,
    picked: PickedOwners,
  ) => Promise<boolean> = async (
    item: T,
    picked: PickedOwners,
  ): Promise<boolean> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!item.id) {
      throw new BadDataException("Item ID not found");
    }

    if (!projectId) {
      throw new BadDataException("Project not found");
    }

    const userIds: Array<string> = picked.userIds;
    const teamIds: Array<string> = picked.teamIds;

    const fetchUsers: Promise<Array<OwnerJunctionModel>> =
      userIds.length > 0
        ? ModelAPI.getList<OwnerJunctionModel>({
            modelType: config.ownerUserModelType,
            query: {
              [config.resourceIdField]: item.id,
              projectId: projectId,
            } as Query<OwnerJunctionModel>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { userId: true } as Record<string, unknown>,
            sort: {},
          }).then((r: ListResult<OwnerJunctionModel>) => {
            return r.data;
          })
        : Promise.resolve([] as Array<OwnerJunctionModel>);

    const fetchTeams: Promise<Array<OwnerJunctionModel>> =
      teamIds.length > 0
        ? ModelAPI.getList<OwnerJunctionModel>({
            modelType: config.ownerTeamModelType,
            query: {
              [config.resourceIdField]: item.id,
              projectId: projectId,
            } as Query<OwnerJunctionModel>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { teamId: true } as Record<string, unknown>,
            sort: {},
          }).then((r: ListResult<OwnerJunctionModel>) => {
            return r.data;
          })
        : Promise.resolve([] as Array<OwnerJunctionModel>);

    const [existingUsers, existingTeams]: [
      Array<OwnerJunctionModel>,
      Array<OwnerJunctionModel>,
    ] = await Promise.all([fetchUsers, fetchTeams]);

    const existingUserIds: Set<string> = new Set<string>(
      existingUsers
        .map((row: OwnerJunctionModel) => {
          return (
            (row as unknown as { userId?: ObjectID }).userId?.toString() || ""
          );
        })
        .filter((id: string) => {
          return id.length > 0;
        }),
    );

    const existingTeamIds: Set<string> = new Set<string>(
      existingTeams
        .map((row: OwnerJunctionModel) => {
          return (
            (row as unknown as { teamId?: ObjectID }).teamId?.toString() || ""
          );
        })
        .filter((id: string) => {
          return id.length > 0;
        }),
    );

    let added: boolean = false;

    for (const userId of userIds) {
      if (existingUserIds.has(userId)) {
        continue;
      }
      const ownerModel: OwnerJunctionModel = new config.ownerUserModelType();
      (ownerModel as unknown as Record<string, unknown>)["userId"] =
        new ObjectID(userId);
      (ownerModel as unknown as Record<string, unknown>)[
        config.resourceIdField
      ] = item.id;
      (ownerModel as unknown as Record<string, unknown>)["projectId"] =
        projectId;
      await ModelAPI.create<OwnerJunctionModel>({
        model: ownerModel,
        modelType: config.ownerUserModelType,
      });
      added = true;
    }

    for (const teamId of teamIds) {
      if (existingTeamIds.has(teamId)) {
        continue;
      }
      const ownerModel: OwnerJunctionModel = new config.ownerTeamModelType();
      (ownerModel as unknown as Record<string, unknown>)["teamId"] =
        new ObjectID(teamId);
      (ownerModel as unknown as Record<string, unknown>)[
        config.resourceIdField
      ] = item.id;
      (ownerModel as unknown as Record<string, unknown>)["projectId"] =
        projectId;
      await ModelAPI.create<OwnerJunctionModel>({
        model: ownerModel,
        modelType: config.ownerTeamModelType,
      });
      added = true;
    }

    return added;
  };

  // The viewer, as Assign to Me adds them.
  const getMyOwnerPick: () => PickedOwners = (): PickedOwners => {
    const myUserId: string = User.getUserId()?.toString() || "";

    if (!myUserId) {
      throw new BadDataException("You are not signed in.");
    }

    return { userIds: [myUserId], teamIds: [] };
  };

  const applyOwners: (
    picked: PickedOwners,
    mode: BulkOwnerMode,
  ) => Promise<void> = async (
    picked: PickedOwners,
    mode: BulkOwnerMode,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    // Close the form modal first so the progress modal is visible
    setShowAddModal(false);
    setShowRemoveModal(false);

    const userIds: Array<string> = picked.userIds;
    const teamIds: Array<string> = picked.teamIds;

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    onBulkActionStart();

    const totalItems: Array<T> = [...items];
    const inProgressItems: Array<T> = [...items];
    const successItems: Array<T> = [];
    const failedItems: Array<BulkActionFailed<T>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }
        if (!projectId) {
          throw new BadDataException("Project not found");
        }

        if (mode === "add") {
          await addOwnersToItem(item, picked);
        } else {
          const fetchMatchingUsers: Promise<Array<OwnerJunctionModel>> =
            userIds.length > 0
              ? ModelAPI.getList<OwnerJunctionModel>({
                  modelType: config.ownerUserModelType,
                  query: {
                    [config.resourceIdField]: item.id,
                    projectId: projectId,
                    userId: new Includes(
                      userIds.map((id: string) => {
                        return new ObjectID(id);
                      }),
                    ),
                  } as Query<OwnerJunctionModel>,
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  select: { _id: true } as Record<string, unknown>,
                  sort: {},
                }).then((r: ListResult<OwnerJunctionModel>) => {
                  return r.data;
                })
              : Promise.resolve([] as Array<OwnerJunctionModel>);

          const fetchMatchingTeams: Promise<Array<OwnerJunctionModel>> =
            teamIds.length > 0
              ? ModelAPI.getList<OwnerJunctionModel>({
                  modelType: config.ownerTeamModelType,
                  query: {
                    [config.resourceIdField]: item.id,
                    projectId: projectId,
                    teamId: new Includes(
                      teamIds.map((id: string) => {
                        return new ObjectID(id);
                      }),
                    ),
                  } as Query<OwnerJunctionModel>,
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  select: { _id: true } as Record<string, unknown>,
                  sort: {},
                }).then((r: ListResult<OwnerJunctionModel>) => {
                  return r.data;
                })
              : Promise.resolve([] as Array<OwnerJunctionModel>);

          const [matchingUsers, matchingTeams]: [
            Array<OwnerJunctionModel>,
            Array<OwnerJunctionModel>,
          ] = await Promise.all([fetchMatchingUsers, fetchMatchingTeams]);

          for (const row of matchingUsers) {
            if (!row.id) {
              continue;
            }
            await ModelAPI.deleteItem<OwnerJunctionModel>({
              modelType: config.ownerUserModelType,
              id: row.id,
            });
          }
          for (const row of matchingTeams) {
            if (!row.id) {
              continue;
            }
            await ModelAPI.deleteItem<OwnerJunctionModel>({
              modelType: config.ownerTeamModelType,
              id: row.id,
            });
          }
        }

        successItems.push(item);
      } catch (err) {
        failedItems.push({
          item: item,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setBulkActionProps(null);
  };

  /*
   * Bulk actions are handed straight to the table's action bar, which never
   * looks at permissions - so a viewer on an otherwise gated table could still
   * reassign every row they had selected. Ownership is stored as rows in the
   * owner junction tables, so adding an owner is a create there and removing
   * one is a delete.
   */
  const addGate: PermissionGateResult = PermissionGate.check(
    new config.ownerUserModelType(),
    ModelAction.Create,
  );

  const removeGate: PermissionGateResult = PermissionGate.check(
    new config.ownerUserModelType(),
    ModelAction.Delete,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<T>,
    gate: PermissionGateResult,
  ) => BulkActionButtonSchema<T>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<T>,
    gate: PermissionGateResult,
  ): BulkActionButtonSchema<T> => {
    if (gate.isAllowed || !gate.disabledReason) {
      return action;
    }

    return {
      ...action,
      disabled: true,
      tooltip: gate.disabledReason,
    };
  };

  /*
   * The viewer becomes an owner of every selected row they do not own yet;
   * a row they own already is listed as left alone.
   */
  const assignToMeBulkAction: BulkActionButtonSchema<T> = {
    title: ASSIGN_TO_ME_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: ActionMenuGroup.People,
    icon: IconProp.User,
    resultLabels: ASSIGN_TO_ME_RESULT_LABELS,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      await runBulkAction<T>({
        actionProps: actionProps,
        concurrency: 1,
        step: async (item: T): Promise<BulkItemOutcome> => {
          const added: boolean = await addOwnersToItem(item, getMyOwnerPick());

          return added
            ? BULK_ITEM_CHANGED
            : bulkItemUnchanged(
                translator.translateText(ALREADY_OWNED_BY_YOU) ||
                  ALREADY_OWNED_BY_YOU,
              );
        },
      });
    },
  };

  const addOwnerAction: BulkActionButtonSchema<T> = {
    title: "Add Owner",
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: ActionMenuGroup.People,
    icon: IconProp.UserPlus,
    /*
     * The two modals are independent booleans rendered as sibling
     * branches, so nothing in the hook keeps them mutually exclusive —
     * only the modal backdrop covering the action bar does, which is a
     * property of a different component. Resetting the sibling here makes
     * the invariant local: two stacked dialogs would share one
     * bulkActionProps, and whichever submitted first would null it and
     * leave the other silently inert.
     */
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowRemoveModal(false);
      setShowAddModal(true);
    },
  };

  const removeOwnerAction: BulkActionButtonSchema<T> = {
    title: "Remove Owner",
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: ActionMenuGroup.People,
    icon: IconProp.UserMinus,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowAddModal(false);
      setShowRemoveModal(true);
    },
  };

  const lockFor: (gate: PermissionGateResult) => {
    disabled?: boolean;
    tooltip?: string;
  } = (
    gate: PermissionGateResult,
  ): { disabled?: boolean; tooltip?: string } => {
    return !gate.isAllowed && gate.disabledReason
      ? { disabled: true, tooltip: gate.disabledReason }
      : {};
  };

  const assignToMeRowAction: ActionButtonSchema<T> = {
    title: ASSIGN_TO_ME_TITLE,
    icon: IconProp.User,
    buttonStyleType: ButtonStyleType.OUTLINE,
    menuGroup: ActionMenuGroup.People,
    // In the ⋯ menu: the row's one button stays View.
    placement: ActionButtonPlacement.MoreMenu,
    isVisible: (item: T): boolean => {
      return config.isOwnedByMe?.(item) !== true;
    },
    ...lockFor(addGate),
    onClick: async (
      item: T,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): Promise<void> => {
      try {
        await addOwnersToItem(item, getMyOwnerPick());
        context?.refresh();
        onCompleteAction();
      } catch (err) {
        onError(new Error(API.getFriendlyMessage(err)));
      }
    },
  };

  const addOwnerRowAction: ActionButtonSchema<T> = {
    title: "Add Owner",
    icon: IconProp.UserPlus,
    buttonStyleType: ButtonStyleType.OUTLINE,
    menuGroup: ActionMenuGroup.People,
    placement: ActionButtonPlacement.MoreMenu,
    ...lockFor(addGate),
    onClick: (
      item: T,
      onCompleteAction: VoidFunction,
      _onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): void => {
      setShowAddModal(false);
      setShowRemoveModal(false);
      setBulkActionProps(null);
      setRowAddError("");
      setRowTarget({ item: item, context: context });
      onCompleteAction();
    },
  };

  const rowTargetName: string = rowTarget
    ? (config.getItemName ? config.getItemName(rowTarget.item).trim() : "") ||
      getRecordDisplayName(rowTarget.item)
    : "";

  const modals: ReactElement = (
    <>
      {rowTarget && (
        <BasicFormModal
          title="Add Owner"
          description={translator.translateTemplate(
            ADD_OWNER_TO_ROW_DESCRIPTION,
            { name: rowTargetName },
          )}
          error={rowAddError || undefined}
          onClose={() => {
            setRowTarget(null);
            setRowAddError("");
          }}
          submitButtonText="Add Owner"
          onSubmit={async (formData: JSONObject) => {
            const target: {
              item: T;
              context?: RowActionContext | undefined;
            } = rowTarget;

            try {
              await addOwnersToItem(target.item, readPickedOwners(formData));
            } catch (err) {
              setRowAddError(API.getFriendlyMessage(err));
              return;
            }

            setRowTarget(null);
            setRowAddError("");
            target.context?.refresh();
          }}
          formProps={{
            fields: [ownersField()],
          }}
        />
      )}

      {showAddModal && (
        <BasicFormModal
          title="Add Owner"
          description="Pick the people and teams to add as owners of the selected items. Their existing owners are kept."
          onClose={() => {
            setShowAddModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Add Owner"
          onSubmit={async (formData: JSONObject) => {
            await applyOwners(readPickedOwners(formData), "add");
          }}
          formProps={{
            fields: [
              ownersField(
                "These people and teams are added as owners of each selected item.",
              ),
            ],
          }}
        />
      )}

      {showRemoveModal && (
        <BasicFormModal
          title="Remove Owner"
          description="Pick the people and teams to remove as owners of the selected items. Items that have none of them are skipped."
          onClose={() => {
            setShowRemoveModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Remove Owner"
          submitButtonStyleType={ButtonStyleType.DANGER}
          onSubmit={async (formData: JSONObject) => {
            await applyOwners(readPickedOwners(formData), "remove");
          }}
          formProps={{
            fields: [
              ownersField(
                "These people and teams are removed as owners of each selected item.",
              ),
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [
      ...(config.offerAssignToMeInBulk
        ? [gateAction(assignToMeBulkAction, addGate)]
        : []),
      gateAction(addOwnerAction, addGate),
      gateAction(removeOwnerAction, removeGate),
    ],
    rowActions: [assignToMeRowAction, addOwnerRowAction],
    modals: modals,
  };
}

export default useBulkOwnerActions;
