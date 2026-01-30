import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useCallback,
} from "react";
import Card from "../Card/Card";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Image from "../Image/Image";
import Route from "../../../Types/API/Route";
import Icon from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import { ButtonStyleType } from "../Button/Button";

export interface MemberRole {
  id: ObjectID;
  name: string;
  color: Color;
  isPrimaryRole?: boolean;
}

export interface AssignedMember {
  id: ObjectID;
  memberId: ObjectID;
  userId: ObjectID;
  userName: string;
  userEmail: string;
  userProfilePictureUrl?: string | undefined;
  roleId: ObjectID;
  roleName: string;
  roleColor: Color;
}

export interface AvailableUser {
  id: ObjectID;
  name: string;
  email: string;
  profilePictureUrl?: string;
}

export interface ComponentProps {
  title?: string;
  description?: string;
  roles: Array<MemberRole>;
  assignedMembers: Array<AssignedMember>;
  availableUsers: Array<AvailableUser>;
  isLoading?: boolean;
  error?: string;
  onAssignMember: (userId: ObjectID, roleId: ObjectID) => Promise<void>;
  onUnassignMember: (memberId: ObjectID) => Promise<void>;
  onRefresh?: () => Promise<void>;
  emptyStateMessage?: string;
  className?: string;
}

const MemberRoleAssignment: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [isUnassigning, setIsUnassigning] = useState<ObjectID | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] =
    useState<AssignedMember | null>(null);
  const [activeRoleDropdown, setActiveRoleDropdown] = useState<ObjectID | null>(
    null,
  );
  const [selectedUserOption, setSelectedUserOption] =
    useState<DropdownOption | null>(null);
  const [localError, setLocalError] = useState<string>("");

  const handleAssign: (userId: ObjectID, roleId: ObjectID) => Promise<void> =
    useCallback(
      async (userId: ObjectID, roleId: ObjectID): Promise<void> => {
        try {
          setIsAssigning(true);
          setLocalError("");
          await props.onAssignMember(userId, roleId);
          setActiveRoleDropdown(null);
          setSelectedUserOption(null);
        } catch (err) {
          setLocalError(API.getFriendlyMessage(err));
        } finally {
          setIsAssigning(false);
        }
      },
      [props.onAssignMember],
    );

  const handleUnassign: (member: AssignedMember) => Promise<void> = useCallback(
    async (member: AssignedMember): Promise<void> => {
      try {
        setIsUnassigning(member.memberId);
        setLocalError("");
        await props.onUnassignMember(member.memberId);
        setShowConfirmDelete(null);
      } catch (err) {
        setLocalError(API.getFriendlyMessage(err));
      } finally {
        setIsUnassigning(null);
      }
    },
    [props.onUnassignMember],
  );

  // Get member for a specific role (only one per role)
  const getMemberForRole: (roleId: ObjectID) => AssignedMember | null =
    useCallback(
      (roleId: ObjectID): AssignedMember | null => {
        return (
          props.assignedMembers.find((member: AssignedMember) => {
            return member.roleId.toString() === roleId.toString();
          }) || null
        );
      },
      [props.assignedMembers],
    );

  const getUserDropdownOptions: () => Array<DropdownOption> =
    useCallback((): Array<DropdownOption> => {
      return props.availableUsers.map((user: AvailableUser) => {
        return {
          value: user.id.toString(),
          label: user.name || user.email,
        };
      });
    }, [props.availableUsers]);

  const cardTitle: string = props.title || "Team Members";
  const cardDescription: string =
    props.description || "Manage team member role assignments.";

  if (props.isLoading) {
    return (
      <Card
        title={cardTitle}
        description={cardDescription}
        className={props.className}
      >
        <ComponentLoader />
      </Card>
    );
  }

  if (props.error) {
    return (
      <Card
        title={cardTitle}
        description={cardDescription}
        className={props.className}
      >
        <ErrorMessage message={props.error} />
      </Card>
    );
  }

  return (
    <>
      <Card
        title={cardTitle}
        description={cardDescription}
        className={props.className}
        buttons={
          props.onRefresh
            ? [
                {
                  title: "Refresh",
                  icon: IconProp.Refresh,
                  onClick: () => {
                    props.onRefresh?.();
                  },
                  buttonStyle: ButtonStyleType.OUTLINE,
                },
              ]
            : []
        }
      >
        <div>
          {localError && (
            <div className="mb-4">
              <ErrorMessage message={localError} />
            </div>
          )}

          {props.roles.length === 0 ? (
            <div className="text-center py-12">
              <Icon
                icon={IconProp.User}
                className="mx-auto h-12 w-12 text-gray-300"
              />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No roles defined
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {props.emptyStateMessage ||
                  "Configure roles in settings to start assigning team members."}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden border border-gray-200 rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-1/3"
                    >
                      Role
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                    >
                      Assigned Member
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-24"
                    >
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {props.roles.map((role: MemberRole) => {
                    const member: AssignedMember | null = getMemberForRole(
                      role.id,
                    );
                    const isDropdownActive: boolean =
                      activeRoleDropdown?.toString() === role.id.toString();
                    const availableUsers: Array<DropdownOption> =
                      getUserDropdownOptions();

                    return (
                      <tr key={role.id.toString()} className="hover:bg-gray-50">
                        {/* Role Column */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor:
                                  role.color?.toString() || "#6b7280",
                              }}
                            />
                            <span className="text-sm font-medium text-gray-900">
                              {role.name}
                            </span>
                            {role.isPrimaryRole && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                Primary
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Member Column */}
                        <td className="px-4 py-4">
                          {isDropdownActive ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 max-w-xs">
                                <Dropdown
                                  options={availableUsers}
                                  placeholder="Select member..."
                                  onChange={(
                                    value:
                                      | DropdownValue
                                      | Array<DropdownValue>
                                      | null,
                                  ) => {
                                    if (value && !Array.isArray(value)) {
                                      const option:
                                        | DropdownOption
                                        | undefined = availableUsers.find(
                                        (opt: DropdownOption) => {
                                          return (
                                            opt.value.toString() ===
                                            value.toString()
                                          );
                                        },
                                      );
                                      setSelectedUserOption(option || null);
                                    } else {
                                      setSelectedUserOption(null);
                                    }
                                  }}
                                  value={selectedUserOption || undefined}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (selectedUserOption) {
                                    handleAssign(
                                      new ObjectID(
                                        selectedUserOption.value.toString(),
                                      ),
                                      role.id,
                                    );
                                  }
                                }}
                                disabled={!selectedUserOption || isAssigning}
                                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {isAssigning ? (
                                  <Icon
                                    icon={IconProp.Refresh}
                                    className="w-3.5 h-3.5 animate-spin"
                                  />
                                ) : (
                                  "Save"
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveRoleDropdown(null);
                                  setSelectedUserOption(null);
                                }}
                                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : member ? (
                            <div className="flex items-center gap-3">
                              {/* Avatar */}
                              {member.userProfilePictureUrl ? (
                                <Image
                                  imageUrl={Route.fromString(
                                    member.userProfilePictureUrl,
                                  )}
                                  alt={member.userName}
                                  className="h-8 w-8 rounded-full object-cover"
                                />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                  <span className="text-xs font-medium text-white">
                                    {member.userName?.charAt(0)?.toUpperCase() ||
                                      member.userEmail
                                        ?.charAt(0)
                                        ?.toUpperCase() ||
                                      "?"}
                                  </span>
                                </div>
                              )}
                              {/* User Info */}
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {member.userName || member.userEmail}
                                </p>
                                {member.userName && member.userEmail && (
                                  <p className="text-xs text-gray-500 truncate">
                                    {member.userEmail}
                                  </p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400 italic">
                              Not assigned
                            </span>
                          )}
                        </td>

                        {/* Action Column */}
                        <td className="px-4 py-4 text-right">
                          {!isDropdownActive && (
                            <>
                              {member ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowConfirmDelete(member);
                                  }}
                                  disabled={
                                    isUnassigning?.toString() ===
                                    member.memberId.toString()
                                  }
                                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50"
                                >
                                  {isUnassigning?.toString() ===
                                  member.memberId.toString() ? (
                                    <Icon
                                      icon={IconProp.Refresh}
                                      className="w-3.5 h-3.5 animate-spin"
                                    />
                                  ) : (
                                    "Remove"
                                  )}
                                </button>
                              ) : availableUsers.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveRoleDropdown(role.id);
                                  }}
                                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 hover:border-indigo-300 transition-colors"
                                >
                                  Assign
                                </button>
                              ) : (
                                <span className="text-xs text-gray-400">
                                  No users
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Confirm Delete Modal */}
      {showConfirmDelete && (
        <ConfirmModal
          title="Remove Member"
          description={`Are you sure you want to remove ${showConfirmDelete.userName || showConfirmDelete.userEmail} from the ${showConfirmDelete.roleName} role?`}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            handleUnassign(showConfirmDelete);
          }}
          onClose={() => {
            setShowConfirmDelete(null);
          }}
        />
      )}
    </>
  );
};

export default MemberRoleAssignment;
