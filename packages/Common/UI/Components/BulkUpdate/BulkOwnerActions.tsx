import React, { ReactElement, useRef, useState } from "react";

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
  BulkActionOnClickProps,
} from "./BulkUpdateForm";
import {
  BULK_ACTION_CONCURRENCY,
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "./BulkActionRunner";
import BulkReadAhead from "./BulkReadAhead";

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
 * A record's owner rows that name the people and teams picked: the ones
 * Add Owner skips and Remove Owner deletes.
 */
interface PickedOwnerRows {
  users: Array<BaseModel>;
  teams: Array<BaseModel>;
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
  // The row's owners being added: its dialog's button is busy, pressed once.
  const [isRowAdding, setIsRowAdding] = useState<boolean>(false);
  const isRowAddingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

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

  /*
   * The owner rows of these records that name the people and teams picked,
   * by record: what Add Owner and Assign to Me skip, and what Remove Owner
   * deletes. One list request per owner table for every record asked about,
   * and none for a table nothing was picked from.
   */
  const readPickedOwnerRows: (data: {
    items: Array<T>;
    picked: PickedOwners;
    projectId: ObjectID;
  }) => Promise<Map<string, PickedOwnerRows>> = async (data: {
    items: Array<T>;
    picked: PickedOwners;
    projectId: ObjectID;
  }): Promise<Map<string, PickedOwnerRows>> => {
    const itemIds: Array<ObjectID> = [];

    for (const item of data.items) {
      if (item.id) {
        itemIds.push(item.id);
      }
    }

    const byItem: Map<string, PickedOwnerRows> = new Map<
      string,
      PickedOwnerRows
    >();

    if (itemIds.length === 0) {
      return byItem;
    }

    const rowsOf: (itemId: string) => PickedOwnerRows = (
      itemId: string,
    ): PickedOwnerRows => {
      let rows: PickedOwnerRows | undefined = byItem.get(itemId);

      if (!rows) {
        rows = { users: [], teams: [] };
        byItem.set(itemId, rows);
      }

      return rows;
    };

    const readTable: (table: {
      modelType: { new (): OwnerJunctionModel };
      ownerColumn: "userId" | "teamId";
      ownerIds: Array<string>;
    }) => Promise<Array<OwnerJunctionModel>> = async (table: {
      modelType: { new (): OwnerJunctionModel };
      ownerColumn: "userId" | "teamId";
      ownerIds: Array<string>;
    }): Promise<Array<OwnerJunctionModel>> => {
      if (table.ownerIds.length === 0) {
        return [];
      }

      const result: ListResult<OwnerJunctionModel> =
        await ModelAPI.getList<OwnerJunctionModel>({
          modelType: table.modelType,
          query: {
            [config.resourceIdField]: new Includes(itemIds),
            projectId: data.projectId,
            [table.ownerColumn]: new Includes(
              table.ownerIds.map((id: string) => {
                return new ObjectID(id);
              }),
            ),
          } as Query<OwnerJunctionModel>,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            [table.ownerColumn]: true,
            [config.resourceIdField]: true,
          } as Record<string, unknown>,
          sort: {},
        });

      return result.data;
    };

    const [userRows, teamRows]: [
      Array<OwnerJunctionModel>,
      Array<OwnerJunctionModel>,
    ] = await Promise.all([
      readTable({
        modelType: config.ownerUserModelType,
        ownerColumn: "userId",
        ownerIds: data.picked.userIds,
      }),
      readTable({
        modelType: config.ownerTeamModelType,
        ownerColumn: "teamId",
        ownerIds: data.picked.teamIds,
      }),
    ]);

    const recordIdOf: (row: OwnerJunctionModel) => string = (
      row: OwnerJunctionModel,
    ): string => {
      const value: unknown = (row as unknown as Record<string, unknown>)[
        config.resourceIdField
      ];

      return value ? String(value).toLowerCase() : "";
    };

    for (const row of userRows) {
      const itemId: string = recordIdOf(row);

      if (itemId) {
        rowsOf(itemId).users.push(row);
      }
    }

    for (const row of teamRows) {
      const itemId: string = recordIdOf(row);

      if (itemId) {
        rowsOf(itemId).teams.push(row);
      }
    }

    return byItem;
  };

  // Of the owner rows read, the ids of the people or teams they name.
  const ownerIdsOf: (
    rows: Array<OwnerJunctionModel>,
    ownerColumn: "userId" | "teamId",
  ) => Set<string> = (
    rows: Array<OwnerJunctionModel>,
    ownerColumn: "userId" | "teamId",
  ): Set<string> => {
    const ids: Set<string> = new Set<string>();

    for (const row of rows) {
      const value: unknown = (row as unknown as Record<string, unknown>)[
        ownerColumn
      ];
      const id: string = value ? String(value) : "";

      if (id) {
        ids.add(id);
      }
    }

    return ids;
  };

  /*
   * Adds the picked people and teams a record is not owned by yet, as owners
   * of it, each its own owner row. Whether any was added.
   */
  const addMissingOwners: (data: {
    item: T;
    picked: PickedOwners;
    existing: PickedOwnerRows;
    projectId: ObjectID;
  }) => Promise<boolean> = async (data: {
    item: T;
    picked: PickedOwners;
    existing: PickedOwnerRows;
    projectId: ObjectID;
  }): Promise<boolean> => {
    const existingUserIds: Set<string> = ownerIdsOf(
      data.existing.users,
      "userId",
    );
    const existingTeamIds: Set<string> = ownerIdsOf(
      data.existing.teams,
      "teamId",
    );

    let added: boolean = false;

    for (const userId of data.picked.userIds) {
      if (existingUserIds.has(userId)) {
        continue;
      }

      const ownerModel: OwnerJunctionModel = new config.ownerUserModelType();
      (ownerModel as unknown as Record<string, unknown>)["userId"] =
        new ObjectID(userId);
      (ownerModel as unknown as Record<string, unknown>)[
        config.resourceIdField
      ] = data.item.id;
      (ownerModel as unknown as Record<string, unknown>)["projectId"] =
        data.projectId;
      await ModelAPI.create<OwnerJunctionModel>({
        model: ownerModel,
        modelType: config.ownerUserModelType,
      });
      added = true;
    }

    for (const teamId of data.picked.teamIds) {
      if (existingTeamIds.has(teamId)) {
        continue;
      }

      const ownerModel: OwnerJunctionModel = new config.ownerTeamModelType();
      (ownerModel as unknown as Record<string, unknown>)["teamId"] =
        new ObjectID(teamId);
      (ownerModel as unknown as Record<string, unknown>)[
        config.resourceIdField
      ] = data.item.id;
      (ownerModel as unknown as Record<string, unknown>)["projectId"] =
        data.projectId;
      await ModelAPI.create<OwnerJunctionModel>({
        model: ownerModel,
        modelType: config.ownerTeamModelType,
      });
      added = true;
    }

    return added;
  };

  // Deletes the owner rows read for a record (Remove Owner).
  const removeOwnerRows: (rows: PickedOwnerRows) => Promise<void> = async (
    rows: PickedOwnerRows,
  ): Promise<void> => {
    for (const row of rows.users) {
      if (!row.id) {
        continue;
      }
      await ModelAPI.deleteItem<OwnerJunctionModel>({
        modelType: config.ownerUserModelType,
        id: row.id,
      });
    }
    for (const row of rows.teams) {
      if (!row.id) {
        continue;
      }
      await ModelAPI.deleteItem<OwnerJunctionModel>({
        modelType: config.ownerTeamModelType,
        id: row.id,
      });
    }
  };

  /*
   * A bulk Add Owner, Remove Owner or Assign to Me: the selected records'
   * owner rows read a window at a time (BulkReadAhead: one list request per
   * owner table for fifty records), then each record changed through the
   * shared runner, several at once. A window whose read fails reads its
   * records one by one.
   */
  const runOwnerChange: (data: {
    actionProps: BulkActionOnClickProps<T>;
    picked: PickedOwners;
    mode: BulkOwnerMode | "assignToMe";
  }) => Promise<void> = async (data: {
    actionProps: BulkActionOnClickProps<T>;
    picked: PickedOwners;
    mode: BulkOwnerMode | "assignToMe";
  }): Promise<void> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const reader: BulkReadAhead<T, PickedOwnerRows> = new BulkReadAhead<
      T,
      PickedOwnerRows
    >({
      items: data.actionProps.items,
      getKey: (item: T): string => {
        return item.id?.toString() || "";
      },
      readWindow: async (
        windowItems: Array<T>,
      ): Promise<Map<string, PickedOwnerRows>> => {
        if (!projectId) {
          return new Map<string, PickedOwnerRows>();
        }

        return await readPickedOwnerRows({
          items: windowItems,
          picked: data.picked,
          projectId: projectId,
        });
      },
      readOne: async (item: T): Promise<PickedOwnerRows | null> => {
        if (!projectId || !item.id) {
          return null;
        }

        return (
          (
            await readPickedOwnerRows({
              items: [item],
              picked: data.picked,
              projectId: projectId,
            })
          ).get(item.id.toString().toLowerCase()) || null
        );
      },
    });

    await runBulkAction<T>({
      actionProps: data.actionProps,
      concurrency: BULK_ACTION_CONCURRENCY,
      step: async (item: T): Promise<BulkItemOutcome> => {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        if (!projectId) {
          throw new BadDataException("Project not found");
        }

        const existing: PickedOwnerRows = (await reader.read(item)) || {
          users: [],
          teams: [],
        };

        if (data.mode === "remove") {
          await removeOwnerRows(existing);
          return BULK_ITEM_CHANGED;
        }

        const added: boolean = await addMissingOwners({
          item: item,
          picked: data.picked,
          existing: existing,
          projectId: projectId,
        });

        // Assign to Me says why a record it added nothing to was left alone.
        if (data.mode === "assignToMe" && !added) {
          return bulkItemUnchanged(
            translator.translateText(ALREADY_OWNED_BY_YOU) ||
              ALREADY_OWNED_BY_YOU,
          );
        }

        return BULK_ITEM_CHANGED;
      },
    });
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

    // Close the form modal first so the progress modal is visible
    setShowAddModal(false);
    setShowRemoveModal(false);

    await runOwnerChange({
      actionProps: bulkActionProps,
      picked: picked,
      mode: mode,
    });

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
      let picked: PickedOwners;

      try {
        picked = getMyOwnerPick();
      } catch (err) {
        // Not signed in: every row fails with why, as it always did.
        await runBulkAction<T>({
          actionProps: actionProps,
          step: async (): Promise<void> => {
            throw err;
          },
        });
        return;
      }

      await runOwnerChange({
        actionProps: actionProps,
        picked: picked,
        mode: "assignToMe",
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
          isSubmitting={isRowAdding}
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

            if (isRowAddingRef.current) {
              return;
            }

            isRowAddingRef.current = true;
            setIsRowAdding(true);

            try {
              await addOwnersToItem(target.item, readPickedOwners(formData));
            } catch (err) {
              setRowAddError(API.getFriendlyMessage(err));
              return;
            } finally {
              isRowAddingRef.current = false;
              setIsRowAdding(false);
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
