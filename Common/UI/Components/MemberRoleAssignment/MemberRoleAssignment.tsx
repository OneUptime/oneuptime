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
import Modal from "../Modal/Modal";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import { ButtonStyleType } from "../Button/Button";

export interface MemberRole {
  id: ObjectID;
  name: string;
  color: Color;
  isPrimaryRole?: boolean;
  icon?: IconProp;
  canAssignMultipleUsers?: boolean;
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

interface ReassignState {
  member: AssignedMember;
  role: MemberRole;
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
  const [reassignState, setReassignState] = useState<ReassignState | null>(
    null,
  );
  const [isReassigning, setIsReassigning] = useState<boolean>(false);

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

  const handleReassign: (
    currentMember: AssignedMember,
    newUserId: ObjectID,
    roleId: ObjectID,
  ) => Promise<void> = useCallback(
    async (
      currentMember: AssignedMember,
      newUserId: ObjectID,
      roleId: ObjectID,
    ): Promise<void> => {
      try {
        setIsReassigning(true);
        setLocalError("");
        // First unassign the current member
        await props.onUnassignMember(currentMember.memberId);
        // Then assign the new user
        await props.onAssignMember(newUserId, roleId);
        setReassignState(null);
        setSelectedUserOption(null);
      } catch (err) {
        setLocalError(API.getFriendlyMessage(err));
      } finally {
        setIsReassigning(false);
      }
    },
    [props.onUnassignMember, props.onAssignMember],
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

  // Get available users for a role (excluding already assigned users for that role)
  const getAvailableUsersForRole: (roleId: ObjectID) => Array<DropdownOption> =
    useCallback(
      (roleId: ObjectID): Array<DropdownOption> => {
        const assignedUserIds: Set<string> = new Set(
          getMembersForRole(roleId).map((m: AssignedMember) => {
            return m.userId.toString();
          }),
        );
        return props.availableUsers
          .filter((user: AvailableUser) => {
            return !assignedUserIds.has(user.id.toString());
          })
          .map((user: AvailableUser) => {
            return {
              value: user.id.toString(),
              label: user.name || user.email,
            };
          });
      },
      [props.availableUsers, getMembersForRole],
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

  // Render a single member row
  const renderMemberRow: (
    member: AssignedMember,
    role: MemberRole,
    isLastInGroup?: boolean,
  ) => ReactElement = (
    member: AssignedMember,
    role: MemberRole,
    isLastInGroup?: boolean,
  ): ReactElement => {
    const isPrimaryRole: boolean = role.isPrimaryRole || false;

    return (
      <div
        key={member.memberId.toString()}
        className={`flex items-center justify-between py-2 ${!isLastInGroup ? "border-b border-gray-100" : ""}`}
      >
        <div className="flex items-center gap-3">
          {member.userProfilePictureUrl ? (
            <Image
              imageUrl={Route.fromString(member.userProfilePictureUrl)}
              alt={member.userName}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-xs font-medium text-white">
                {member.userName?.charAt(0)?.toUpperCase() ||
                  member.userEmail?.charAt(0)?.toUpperCase() ||
                  "?"}
              </span>
            </div>
          )}
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
        {isPrimaryRole ? (
          <button
            type="button"
            onClick={() => {
              setReassignState({ member, role });
            }}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors"
            title="Reassign"
          >
            <Icon icon={IconProp.ArrowCircleRight} className="w-3.5 h-3.5" />
            Reassign
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowConfirmDelete(member);
            }}
            disabled={isUnassigning?.toString() === member.memberId.toString()}
            className="inline-flex items-center p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
            title="Remove"
          >
            {isUnassigning?.toString() === member.memberId.toString() ? (
              <Icon icon={IconProp.Refresh} className="w-4 h-4 animate-spin" />
            ) : (
              <Icon icon={IconProp.Close} className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    );
  };

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
            <div className="space-y-4">
              {props.roles.map((role: MemberRole) => {
                const members: Array<AssignedMember> = getMembersForRole(
                  role.id,
                );
                const isDropdownActive: boolean =
                  activeRoleDropdown?.toString() === role.id.toString();
                const availableUsers: Array<DropdownOption> =
                  getAvailableUsersForRole(role.id);
                const canAddMore: boolean =
                  role.canAssignMultipleUsers || members.length === 0;

                return (
                  <div
                    key={role.id.toString()}
                    className="border border-gray-200 rounded-lg overflow-hidden"
                  >
                    {/* Role Header */}
                    <div
                      className="px-4 py-3 flex items-center justify-between"
                      style={{
                        backgroundColor: role.color
                          ? `${role.color.toString()}10`
                          : "#f9fafb",
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{
                            backgroundColor: role.color
                              ? `${role.color.toString()}25`
                              : "#e5e7eb",
                          }}
                        >
                          <Icon
                            icon={role.icon || IconProp.User}
                            className="w-5 h-5"
                            style={{
                              color: role.color?.toString() || "#6b7280",
                            }}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">
                              {role.name}
                            </span>
                            {role.isPrimaryRole && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                Primary
                              </span>
                            )}
                            {role.canAssignMultipleUsers && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                                Multiple
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {members.length}{" "}
                            {members.length === 1 ? "member" : "members"}{" "}
                            assigned
                          </p>
                        </div>
                      </div>

                      {/* Add Button */}
                      {!isDropdownActive && canAddMore && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveRoleDropdown(role.id);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400"
                        >
                          <Icon icon={IconProp.Add} className="w-3.5 h-3.5" />
                          {members.length === 0 ? "Assign" : "Add More"}
                        </button>
                      )}

                    </div>

                    {/* Dropdown for adding member */}
                    {isDropdownActive && (
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        {availableUsers.length === 0 ? (
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-red-600">
                              All users are already assigned to this role.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveRoleDropdown(null);
                                setSelectedUserOption(null);
                              }}
                              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                            >
                              Close
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 max-w-sm">
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
                                    const option: DropdownOption | undefined =
                                      availableUsers.find(
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
                        )}
                      </div>
                    )}

                    {/* Members List */}
                    <div className="px-4 py-2 bg-white">
                      {members.length === 0 ? (
                        <p className="text-sm text-gray-400 italic py-2">
                          Not assigned
                        </p>
                      ) : (
                        members.map((member: AssignedMember, index: number) => {
                          return renderMemberRow(
                            member,
                            role,
                            index === members.length - 1,
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
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

      {/* Reassign Modal */}
      {reassignState && (
        <Modal
          title="Reassign Role"
          submitButtonText={isReassigning ? "Reassigning..." : "Reassign"}
          submitButtonStyleType={ButtonStyleType.PRIMARY}
          onSubmit={() => {
            if (selectedUserOption) {
              handleReassign(
                reassignState.member,
                new ObjectID(selectedUserOption.value.toString()),
                reassignState.role.id,
              );
            }
          }}
          disableSubmitButton={!selectedUserOption || isReassigning}
          onClose={() => {
            setReassignState(null);
            setSelectedUserOption(null);
          }}
        >
          <p className="text-gray-500 text-sm mb-4">
            Select a new user to reassign the {reassignState.role.name} role
            from {reassignState.member.userName || reassignState.member.userEmail}
            .
          </p>
          <Dropdown
            options={props.availableUsers
              .filter((user: AvailableUser) => {
                // Exclude the current member from the list
                return (
                  user.id.toString() !== reassignState.member.userId.toString()
                );
              })
              .map((user: AvailableUser) => {
                return {
                  value: user.id.toString(),
                  label: user.name || user.email,
                };
              })}
            placeholder="Select new user..."
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (value && !Array.isArray(value)) {
                const option: DropdownOption | undefined = props.availableUsers
                  .map((user: AvailableUser) => ({
                    value: user.id.toString(),
                    label: user.name || user.email,
                  }))
                  .find((opt: DropdownOption) => {
                    return opt.value.toString() === value.toString();
                  });
                setSelectedUserOption(option || null);
              } else {
                setSelectedUserOption(null);
              }
            }}
            value={selectedUserOption || undefined}
          />
        </Modal>
      )}
    </>
  );
};

export default MemberRoleAssignment;
