import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
  useCallback,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectUtil from "Common/UI/Utils/Project";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Dropdown from "Common/UI/Components/Dropdown/Dropdown";
import RoleLabel from "Common/UI/Components/RoleLabel/RoleLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import ProjectUser from "../../Utils/ProjectUser";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { EpisodeMemberRoleAssignment } from "Common/Models/DatabaseModels/IncidentGroupingRule";

export interface EpisodeMemberRoleAssignmentsFormFieldProps {
  onChange?: ((value: Array<EpisodeMemberRoleAssignment>) => void) | undefined;
  initialValue?: Array<EpisodeMemberRoleAssignment> | undefined;
  error?: string | undefined;
}

interface RoleData {
  id: ObjectID;
  name: string;
  color: Color;
  icon?: IconProp;
  canAssignMultipleUsers: boolean;
  isPrimaryRole: boolean;
}

const EpisodeMemberRoleAssignmentsFormField: FunctionComponent<
  EpisodeMemberRoleAssignmentsFormFieldProps
> = (props: EpisodeMemberRoleAssignmentsFormFieldProps): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [roles, setRoles] = useState<Array<RoleData>>([]);
  const [userOptions, setUserOptions] = useState<Array<DropdownOption>>([]);
  const [assignments, setAssignments] = useState<
    Array<EpisodeMemberRoleAssignment>
  >(props.initialValue || []);

  const fetchRolesAndUsers = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        setError("Project not found");
        setIsLoading(false);
        return;
      }

      // Fetch incident roles
      const rolesResult: ListResult<IncidentRole> =
        await ModelAPI.getList<IncidentRole>({
          modelType: IncidentRole,
          query: {
            projectId: projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            color: true,
            roleIcon: true,
            canAssignMultipleUsers: true,
            isPrimaryRole: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      const roleData: Array<RoleData> = rolesResult.data
        .map((role: IncidentRole): RoleData => {
          const data: RoleData = {
            id: role.id!,
            name: role.name || "",
            color: role.color || new Color("#000000"),
            canAssignMultipleUsers: role.canAssignMultipleUsers || false,
            isPrimaryRole: role.isPrimaryRole || false,
          };

          if (role.roleIcon) {
            data.icon = role.roleIcon;
          }

          return data;
        })
        .sort((a: RoleData, b: RoleData) => {
          // Primary roles first, then sort by name
          if (a.isPrimaryRole && !b.isPrimaryRole) {
            return -1;
          }
          if (!a.isPrimaryRole && b.isPrimaryRole) {
            return 1;
          }
          return a.name.localeCompare(b.name);
        });

      setRoles(roleData);

      // Fetch project users
      const users: Array<DropdownOption> =
        await ProjectUser.fetchProjectUsersAsDropdownOptions(projectId);
      setUserOptions(users);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchRolesAndUsers();
  }, [fetchRolesAndUsers]);

  // Get user IDs assigned to a specific role
  const getSelectedUsersForRole = useCallback(
    (roleId: string): string[] => {
      return assignments
        .filter(
          (a: EpisodeMemberRoleAssignment) => a.incidentRoleId === roleId,
        )
        .map((a: EpisodeMemberRoleAssignment) => a.userId);
    },
    [assignments],
  );

  // Add a user to a role
  const addUserToRole = useCallback(
    (roleId: string, userId: string): void => {
      // Check if assignment already exists
      const exists: boolean = assignments.some(
        (a: EpisodeMemberRoleAssignment) =>
          a.incidentRoleId === roleId && a.userId === userId,
      );

      if (exists) {
        return;
      }

      const newAssignments: Array<EpisodeMemberRoleAssignment> = [
        ...assignments,
        { userId, incidentRoleId: roleId },
      ];

      setAssignments(newAssignments);

      if (props.onChange) {
        props.onChange(newAssignments);
      }
    },
    [assignments, props.onChange],
  );

  // Remove a user from a role
  const removeUserFromRole = useCallback(
    (roleId: string, userId: string): void => {
      const newAssignments: Array<EpisodeMemberRoleAssignment> =
        assignments.filter(
          (a: EpisodeMemberRoleAssignment) =>
            !(a.incidentRoleId === roleId && a.userId === userId),
        );

      setAssignments(newAssignments);

      if (props.onChange) {
        props.onChange(newAssignments);
      }
    },
    [assignments, props.onChange],
  );

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (roles.length === 0) {
    return (
      <p className="text-gray-500">
        No incident roles defined. Go to Incidents {">"} Settings {">"} Roles to
        create roles first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {roles.map((role: RoleData) => {
        const selectedUsers: string[] = getSelectedUsersForRole(
          role.id.toString(),
        );
        const canAddMore: boolean =
          role.canAssignMultipleUsers || selectedUsers.length === 0;

        return (
          <div
            key={role.id.toString()}
            className="border border-gray-200 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <RoleLabel
                  name={role.name}
                  color={role.color}
                  icon={role.icon}
                />
                {role.isPrimaryRole && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">
                    Primary
                  </span>
                )}
                {role.canAssignMultipleUsers && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    Multiple
                  </span>
                )}
              </div>
            </div>

            {/* Selected users */}
            {selectedUsers.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedUsers.map((userId: string) => {
                  const userOption: DropdownOption | undefined =
                    userOptions.find((opt: DropdownOption) => {
                      return opt.value === userId;
                    });
                  return (
                    <div
                      key={userId}
                      className="flex items-center bg-gray-100 rounded-full px-3 py-1 text-sm"
                    >
                      <span>{userOption?.label || "Unknown User"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          removeUserFromRole(role.id.toString(), userId);
                        }}
                        className="ml-2 text-gray-500 hover:text-gray-700"
                      >
                        <Icon icon={IconProp.Close} className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* User selection dropdown */}
            {canAddMore && (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Dropdown
                    placeholder={`Select user for ${role.name}`}
                    options={userOptions.filter((opt: DropdownOption) => {
                      // Filter out already selected users for this role
                      return !selectedUsers.includes(opt.value as string);
                    })}
                    value={undefined}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      if (value && typeof value === "string") {
                        addUserToRole(role.id.toString(), value);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {!canAddMore && (
              <p className="text-xs text-gray-500">
                Only one user can be assigned to this role.
              </p>
            )}
          </div>
        );
      })}

      {props.error && (
        <p className="text-sm text-red-500 mt-2">{props.error}</p>
      )}
    </div>
  );
};

export default EpisodeMemberRoleAssignmentsFormField;
