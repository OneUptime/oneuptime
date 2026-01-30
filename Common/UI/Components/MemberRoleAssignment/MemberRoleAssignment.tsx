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

  // Get members for a specific role
  const getMembersForRole: (roleId: ObjectID) => Array<AssignedMember> =
    useCallback(
      (roleId: ObjectID): Array<AssignedMember> => {
        return props.assignedMembers.filter((member: AssignedMember) => {
          return member.roleId.toString() === roleId.toString();
        });
      },
      [props.assignedMembers],
    );

  // Get users not already assigned to a specific role
  const getAvailableUsersForRole: (roleId: ObjectID) => Array<AvailableUser> =
    useCallback(
      (roleId: ObjectID): Array<AvailableUser> => {
        // Get user IDs already assigned to this specific role
        const assignedUserIdsForRole: Set<string> = new Set(
          props.assignedMembers
            .filter((member: AssignedMember) => {
              return member.roleId.toString() === roleId.toString();
            })
            .map((member: AssignedMember) => {
              return member.userId.toString();
            }),
        );
        return props.availableUsers.filter((user: AvailableUser) => {
          return !assignedUserIdsForRole.has(user.id.toString());
        });
      },
      [props.assignedMembers, props.availableUsers],
    );

  const getUserDropdownOptionsForRole: (
    roleId: ObjectID,
  ) => Array<DropdownOption> = useCallback(
    (roleId: ObjectID): Array<DropdownOption> => {
      return getAvailableUsersForRole(roleId).map((user: AvailableUser) => {
        return {
          value: user.id.toString(),
          label: user.name || user.email,
        };
      });
    },
    [getAvailableUsersForRole],
  );

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

          <div className="space-y-6">
            {props.roles.map((role: MemberRole) => {
              const members: Array<AssignedMember> = getMembersForRole(role.id);
              const isDropdownActive: boolean =
                activeRoleDropdown?.toString() === role.id.toString();
              const availableUsers: Array<DropdownOption> =
                getUserDropdownOptionsForRole(role.id);

              return (
                <div
                  key={role.id.toString()}
                  className="border border-gray-200 rounded-xl overflow-hidden"
                >
                  {/* Role Header */}
                  <div
                    className="px-4 py-3 flex items-center justify-between"
                    style={{
                      backgroundColor: role.color
                        ? `${role.color.toString()}15`
                        : "#f9fafb",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: role.color?.toString() || "#6b7280",
                        }}
                      />
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                          {role.name}
                          {role.isPrimaryRole && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              Primary
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {members.length}{" "}
                          {members.length === 1 ? "member" : "members"} assigned
                        </p>
                      </div>
                    </div>

                    {/* Add Member Button */}
                    {!isDropdownActive && availableUsers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveRoleDropdown(role.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-150 shadow-sm"
                      >
                        <Icon icon={IconProp.Add} className="w-3.5 h-3.5" />
                        Add
                      </button>
                    )}
                  </div>

                  {/* Add Member Dropdown */}
                  {isDropdownActive && (
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Dropdown
                            options={availableUsers}
                            placeholder="Select a team member..."
                            onChange={(
                              value:
                                | DropdownValue
                                | Array<DropdownValue>
                                | null,
                            ) => {
                              if (value && !Array.isArray(value)) {
                                const option: DropdownOption | undefined =
                                  availableUsers.find((opt: DropdownOption) => {
                                    return (
                                      opt.value.toString() === value.toString()
                                    );
                                  });
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
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isAssigning ? (
                            <Icon
                              icon={IconProp.Refresh}
                              className="w-4 h-4 animate-spin"
                            />
                          ) : (
                            "Assign"
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveRoleDropdown(null);
                            setSelectedUserOption(null);
                          }}
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Members List */}
                  <div className="divide-y divide-gray-100">
                    {members.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <Icon
                          icon={IconProp.User}
                          className="mx-auto h-8 w-8 text-gray-300"
                        />
                        <p className="mt-2 text-sm text-gray-500">
                          No members assigned to this role yet
                        </p>
                      </div>
                    ) : (
                      members.map((member: AssignedMember) => {
                        return (
                          <div
                            key={member.memberId.toString()}
                            className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors group"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Avatar */}
                              <div className="relative flex-shrink-0">
                                {member.userProfilePictureUrl ? (
                                  <Image
                                    imageUrl={Route.fromString(
                                      member.userProfilePictureUrl,
                                    )}
                                    alt={member.userName}
                                    className="h-9 w-9 rounded-full object-cover ring-2 ring-white"
                                  />
                                ) : (
                                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center ring-2 ring-white">
                                    <span className="text-sm font-medium text-white">
                                      {member.userName
                                        ?.charAt(0)
                                        ?.toUpperCase() ||
                                        member.userEmail
                                          ?.charAt(0)
                                          ?.toUpperCase() ||
                                        "?"}
                                    </span>
                                  </div>
                                )}
                              </div>

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

                            {/* Remove Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setShowConfirmDelete(member);
                              }}
                              disabled={
                                isUnassigning?.toString() ===
                                member.memberId.toString()
                              }
                              className="opacity-0 group-hover:opacity-100 inline-flex items-center p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-150 disabled:opacity-50"
                              title="Remove from role"
                            >
                              {isUnassigning?.toString() ===
                              member.memberId.toString() ? (
                                <Icon
                                  icon={IconProp.Refresh}
                                  className="w-4 h-4 animate-spin"
                                />
                              ) : (
                                <Icon
                                  icon={IconProp.Close}
                                  className="w-4 h-4"
                                />
                              )}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}

            {props.roles.length === 0 && (
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
            )}
          </div>
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
