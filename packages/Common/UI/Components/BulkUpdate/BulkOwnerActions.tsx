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
import ProjectUtil from "../../Utils/Project";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { ButtonStyleType } from "../Button/Button";
import BasicFormModal from "../FormModal/BasicFormModal";
import Field from "../Forms/Types/Field";
import getOwnersFormField from "../PeoplePicker/OwnersFormField";
import { toPeoplePickerIds } from "../PeoplePicker/PeoplePickerTypes";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "./BulkUpdateForm";

type OwnerJunctionModel = BaseModel;

export interface BulkOwnerActionsConfig {
  ownerUserModelType: { new (): OwnerJunctionModel };
  ownerTeamModelType: { new (): OwnerJunctionModel };
  resourceIdField: string;
}

export interface BulkOwnerActionsResult<T extends BaseModel> {
  bulkActions: Array<BulkActionButtonSchema<T>>;
  modals: ReactElement;
}

type BulkOwnerMode = "add" | "remove";

// The people and teams picked in the dialog, as ids.
interface PickedOwners {
  userIds: Array<string>;
  teamIds: Array<string>;
}

/*
 * The dialogs' one Owners field: the people picker every owners form uses,
 * people and teams in one list, at least one required.
 */
const ownersField: (description: string) => Field<JSONObject> = (
  description: string,
): Field<JSONObject> => {
  return getOwnersFormField<JSONObject>({
    usersKey: "ownerUserIds",
    teamsKey: "ownerTeamIds",
    description: description,
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
  config: BulkOwnerActionsConfig,
): BulkOwnerActionsResult<T> {
  /*
   * Owners are picked with the people picker, which searches the project's
   * people and teams when its list opens - nothing is read up front, so a
   * table that offers these actions costs no requests until they are used.
   */
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showRemoveModal, setShowRemoveModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<T> | null>(null);

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
                  (
                    row as unknown as { userId?: ObjectID }
                  ).userId?.toString() || ""
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
                  (
                    row as unknown as { teamId?: ObjectID }
                  ).teamId?.toString() || ""
                );
              })
              .filter((id: string) => {
                return id.length > 0;
              }),
          );

          for (const userId of userIds) {
            if (existingUserIds.has(userId)) {
              continue;
            }
            const ownerModel: OwnerJunctionModel =
              new config.ownerUserModelType();
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
          }

          for (const teamId of teamIds) {
            if (existingTeamIds.has(teamId)) {
              continue;
            }
            const ownerModel: OwnerJunctionModel =
              new config.ownerTeamModelType();
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
          }
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

  const addOwnerAction: BulkActionButtonSchema<T> = {
    title: "Add Owner",
    buttonStyleType: ButtonStyleType.NORMAL,
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
    icon: IconProp.UserMinus,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowAddModal(false);
      setShowRemoveModal(true);
    },
  };

  const modals: ReactElement = (
    <>
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
      gateAction(addOwnerAction, addGate),
      gateAction(removeOwnerAction, removeGate),
    ],
    modals: modals,
  };
}

export default useBulkOwnerActions;
