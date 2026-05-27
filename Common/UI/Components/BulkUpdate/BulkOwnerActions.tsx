import React, { ReactElement, useEffect, useMemo, useState } from "react";

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../Utils/Project";
import { ButtonStyleType } from "../Button/Button";
import { DropdownOption, DropdownOptionGroup } from "../Dropdown/Dropdown";
import BasicFormModal from "../FormModal/BasicFormModal";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
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

const USER_PREFIX: string = "user:";
const TEAM_PREFIX: string = "team:";

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
  const [userOptions, setUserOptions] = useState<Array<DropdownOption>>([]);
  const [teamOptions, setTeamOptions] = useState<Array<DropdownOption>>([]);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showRemoveModal, setShowRemoveModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<T> | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return;
    }

    const fetchOwners: () => Promise<void> = async (): Promise<void> => {
      try {
        const [teamMembersResult, teamsResult]: [
          ListResult<TeamMember>,
          ListResult<Team>,
        ] = await Promise.all([
          ModelAPI.getList<TeamMember>({
            modelType: TeamMember,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              user: {
                _id: true,
                name: true,
                email: true,
              },
            },
            sort: {},
          }),
          ModelAPI.getList<Team>({
            modelType: Team,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              name: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
          }),
        ]);

        const seenUserIds: Set<string> = new Set<string>();
        const users: Array<DropdownOption> = [];

        for (const member of teamMembersResult.data) {
          const userId: string = member.user?._id?.toString() || "";
          if (!userId || seenUserIds.has(userId)) {
            continue;
          }
          seenUserIds.add(userId);
          users.push({
            value: `${USER_PREFIX}${userId}`,
            label:
              member.user?.name?.toString() ||
              member.user?.email?.toString() ||
              "",
          });
        }

        users.sort((a: DropdownOption, b: DropdownOption) => {
          return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
        });

        setUserOptions(users);

        setTeamOptions(
          teamsResult.data.map((team: Team) => {
            return {
              value: `${TEAM_PREFIX}${team._id?.toString() || ""}`,
              label: team.name?.toString() || "",
            };
          }),
        );
      } catch {
        // dropdowns will remain empty; modal will show no options
      }
    };

    void fetchOwners();
  }, []);

  const applyOwners: (
    selectedKeys: Array<string>,
    mode: BulkOwnerMode,
  ) => Promise<void> = async (
    selectedKeys: Array<string>,
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

    const userIds: Array<string> = [];
    const teamIds: Array<string> = [];

    for (const key of selectedKeys) {
      if (key.startsWith(USER_PREFIX)) {
        const id: string = key.slice(USER_PREFIX.length);
        if (id) {
          userIds.push(id);
        }
      } else if (key.startsWith(TEAM_PREFIX)) {
        const id: string = key.slice(TEAM_PREFIX.length);
        if (id) {
          teamIds.push(id);
        }
      }
    }

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

  const groupedOwnerOptions: Array<DropdownOption | DropdownOptionGroup> =
    useMemo((): Array<DropdownOption | DropdownOptionGroup> => {
      const groups: Array<DropdownOptionGroup> = [];
      if (userOptions.length > 0) {
        groups.push({ label: "People", options: userOptions });
      }
      if (teamOptions.length > 0) {
        groups.push({ label: "Teams", options: teamOptions });
      }
      return groups;
    }, [userOptions, teamOptions]);

  const addOwnerAction: BulkActionButtonSchema<T> = {
    title: "Add Owner",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.UserPlus,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowAddModal(true);
    },
  };

  const removeOwnerAction: BulkActionButtonSchema<T> = {
    title: "Remove Owner",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.UserMinus,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowRemoveModal(true);
    },
  };

  const modals: ReactElement = (
    <>
      {showAddModal && (
        <BasicFormModal
          title="Add Owner"
          description="Select users and/or teams to add as owners to the selected items. Existing owners will be preserved."
          onClose={() => {
            setShowAddModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Add Owner"
          onSubmit={async (formData: { ownerKeys: Array<string> }) => {
            await applyOwners(formData.ownerKeys || [], "add");
          }}
          formProps={{
            fields: [
              {
                field: {
                  ownerKeys: true,
                },
                title: "Select Owners",
                description:
                  "These users and teams will be added as owners to each selected item.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: true,
                dropdownOptions: groupedOwnerOptions,
              },
            ],
          }}
        />
      )}

      {showRemoveModal && (
        <BasicFormModal
          title="Remove Owner"
          description="Select users and/or teams to remove from the selected items. Items that do not have any of these owners will be skipped."
          onClose={() => {
            setShowRemoveModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Remove Owner"
          onSubmit={async (formData: { ownerKeys: Array<string> }) => {
            await applyOwners(formData.ownerKeys || [], "remove");
          }}
          formProps={{
            fields: [
              {
                field: {
                  ownerKeys: true,
                },
                title: "Select Owners",
                description:
                  "These users and teams will be removed as owners from each selected item.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: true,
                dropdownOptions: groupedOwnerOptions,
              },
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [addOwnerAction, removeOwnerAction],
    modals: modals,
  };
}

export default useBulkOwnerActions;
