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
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { EpisodeMemberRoleAssignment } from "Common/Models/DatabaseModels/IncidentGroupingRule";

export interface EpisodeMemberRoleAssignmentsFormFieldProps {
  onChange?: ((value: Array<EpisodeMemberRoleAssignment>) => void) | undefined;
  initialValue?: Array<EpisodeMemberRoleAssignment> | undefined;
  error?: string | undefined;
}

interface RoleData {
  id: string;
  name: string;
  color: Color;
  icon?: IconProp;
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

  // State for new assignment form
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(
    undefined,
  );
  const [selectedRoleId, setSelectedRoleId] = useState<string | undefined>(
    undefined,
  );

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
            isPrimaryRole: true,
          },
          sort: {
            isPrimaryRole: SortOrder.Descending,
            name: SortOrder.Ascending,
          },
        });

      const roleData: Array<RoleData> = rolesResult.data.map(
        (role: IncidentRole): RoleData => {
          const data: RoleData = {
            id: role.id!.toString(),
            name: role.name || "",
            color: role.color || new Color("#000000"),
            isPrimaryRole: role.isPrimaryRole || false,
          };

          if (role.roleIcon) {
            data.icon = role.roleIcon;
          }

          return data;
        },
      );

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

  const addAssignment = useCallback((): void => {
    if (!selectedUserId || !selectedRoleId) {
      return;
    }

    // Check if assignment already exists
    const exists: boolean = assignments.some(
      (a: EpisodeMemberRoleAssignment) => {
        return (
          a.userId === selectedUserId && a.incidentRoleId === selectedRoleId
        );
      },
    );

    if (exists) {
      return;
    }

    const newAssignments: Array<EpisodeMemberRoleAssignment> = [
      ...assignments,
      { userId: selectedUserId, incidentRoleId: selectedRoleId },
    ];

    setAssignments(newAssignments);
    setSelectedUserId(undefined);
    setSelectedRoleId(undefined);

    if (props.onChange) {
      props.onChange(newAssignments);
    }
  }, [selectedUserId, selectedRoleId, assignments, props.onChange]);

  const removeAssignment = useCallback(
    (index: number): void => {
      const newAssignments: Array<EpisodeMemberRoleAssignment> =
        assignments.filter(
          (_: EpisodeMemberRoleAssignment, i: number) => i !== index,
        );
      setAssignments(newAssignments);

      if (props.onChange) {
        props.onChange(newAssignments);
      }
    },
    [assignments, props.onChange],
  );

  const getUserName = useCallback(
    (userId: string): string => {
      const user: DropdownOption | undefined = userOptions.find(
        (u: DropdownOption) => u.value === userId,
      );
      return user?.label || "Unknown User";
    },
    [userOptions],
  );

  const getRole = useCallback(
    (roleId: string): RoleData | undefined => {
      return roles.find((r: RoleData) => r.id === roleId);
    },
    [roles],
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

  const roleDropdownOptions: Array<DropdownOption> = roles.map(
    (role: RoleData): DropdownOption => {
      return {
        label: role.name,
        value: role.id,
      };
    },
  );

  return (
    <div className="space-y-4">
      {/* Existing assignments */}
      {assignments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Configured Role Assignments:
          </p>
          {assignments.map(
            (assignment: EpisodeMemberRoleAssignment, index: number) => {
              const role: RoleData | undefined = getRole(
                assignment.incidentRoleId,
              );
              return (
                <div
                  key={index}
                  className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-gray-50"
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-700">
                      {getUserName(assignment.userId)}
                    </span>
                    <span className="text-gray-400">→</span>
                    {role ? (
                      <RoleLabel
                        name={role.name}
                        color={role.color}
                        icon={role.icon}
                      />
                    ) : (
                      <span className="text-sm text-gray-500">Unknown Role</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAssignment(index)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <Icon icon={IconProp.Trash} className="h-4 w-4" />
                  </button>
                </div>
              );
            },
          )}
        </div>
      )}

      {/* Add new assignment form */}
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">
          Add Role Assignment:
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">User</label>
            <Dropdown
              placeholder="Select user..."
              options={userOptions}
              value={userOptions.find(
                (u: DropdownOption) => u.value === selectedUserId,
              )}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value && typeof value === "string") {
                  setSelectedUserId(value);
                } else {
                  setSelectedUserId(undefined);
                }
              }}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <Dropdown
              placeholder="Select role..."
              options={roleDropdownOptions}
              value={roleDropdownOptions.find(
                (r: DropdownOption) => r.value === selectedRoleId,
              )}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value && typeof value === "string") {
                  setSelectedRoleId(value);
                } else {
                  setSelectedRoleId(undefined);
                }
              }}
            />
          </div>
          <Button
            title="Add"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={addAssignment}
            disabled={!selectedUserId || !selectedRoleId}
          />
        </div>
      </div>

      {props.error && (
        <p className="text-sm text-red-500 mt-2">{props.error}</p>
      )}
    </div>
  );
};

export default EpisodeMemberRoleAssignmentsFormField;
