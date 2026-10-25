import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import MemberRoleAssignment, {
  MemberRole,
  AssignedMember,
  AvailableUser,
} from "Common/UI/Components/MemberRoleAssignment/MemberRoleAssignment";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import User from "Common/Models/DatabaseModels/User";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectUser from "../../Utils/ProjectUser";
import UserUtil from "Common/UI/Utils/User";
import Color from "Common/Types/Color";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { CardHeaderLayout } from "Common/UI/Components/Card/Card";
import { EventRolesSnapshot, toEventRoleMember } from "../../Utils/EventPeople";

export interface ComponentProps {
  incidentEpisodeId: ObjectID;
  className?: string;
  onMemberChange?: () => Promise<void>;
  // "stacked" when the card sits in a narrow column; see Card.
  headerLayout?: CardHeaderLayout | undefined;
  /*
   * Called with the episode's roles and who holds them each time the card
   * has read them - on load and after every change made in it - so the
   * overview's header can name the commander without a read of its own,
   * and follows an assignment made here at once.
   */
  onRolesLoaded?:
    | ((recordId: string, snapshot: EventRolesSnapshot) => void)
    | undefined;
  /*
   * Changes when a role was given outside the card - the overview's header,
   * whose Assign gives the commander right where it names them - so the
   * card reads its roles again and shows the same.
   */
  refreshToken?: number | undefined;
}

/*
 * Gives a role on the episode to one of the project's people: the card's
 * own Assign, and the overview header's, which gives the commander right
 * where it names them. Rejects with the server's reason.
 */
export const assignIncidentEpisodeRole: (data: {
  incidentEpisodeId: ObjectID;
  userId: ObjectID;
  roleId: ObjectID;
}) => Promise<void> = async (data: {
  incidentEpisodeId: ObjectID;
  userId: ObjectID;
  roleId: ObjectID;
}): Promise<void> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new Error("Project ID not found");
  }

  const member: IncidentEpisodeRoleMember = new IncidentEpisodeRoleMember();
  member.incidentEpisodeId = data.incidentEpisodeId;
  member.projectId = projectId;
  member.userId = data.userId;
  member.incidentRoleId = data.roleId;

  await ModelAPI.create({
    model: member,
    modelType: IncidentEpisodeRoleMember,
  });
};

const IncidentEpisodeMemberRoleAssignment: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [roles, setRoles] = useState<Array<MemberRole>>([]);
  const [assignedMembers, setAssignedMembers] = useState<Array<AssignedMember>>(
    [],
  );
  const [availableUsers, setAvailableUsers] = useState<Array<AvailableUser>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // The latest callback, so a read that lands late never calls an old one.
  const onRolesLoadedRef: MutableRefObject<ComponentProps["onRolesLoaded"]> =
    useRef<ComponentProps["onRolesLoaded"]>(props.onRolesLoaded);
  onRolesLoadedRef.current = props.onRolesLoaded;

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

        if (!projectId) {
          throw new Error("Project ID not found");
        }

        // Fetch roles, members, and users in parallel
        const [rolesResult, membersResult, projectUsers] = await Promise.all([
          ModelAPI.getList<IncidentRole>({
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
              isPrimaryRole: true,
              roleIcon: true,
              canAssignMultipleUsers: true,
              isArchived: true,
            },
            sort: {
              isPrimaryRole: SortOrder.Descending,
              name: SortOrder.Ascending,
            },
          }),
          ModelAPI.getList<IncidentEpisodeRoleMember>({
            modelType: IncidentEpisodeRoleMember,
            query: {
              incidentEpisodeId: props.incidentEpisodeId,
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              createdAt: true,
              userId: true,
              incidentRoleId: true,
              user: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
              incidentRole: {
                _id: true,
                name: true,
                color: true,
              },
            },
            sort: {
              createdAt: SortOrder.Ascending,
            },
          }),
          ProjectUser.fetchProjectUsersAsDropdownOptions(projectId),
        ]);

        /*
         * The roles the card draws: every role not archived, and an archived
         * one only while someone holds it on this episode.
         */
        const heldRoleIds: Set<string> = new Set<string>(
          (membersResult.data as Array<IncidentEpisodeRoleMember>).map(
            (member: IncidentEpisodeRoleMember): string => {
              return member.incidentRoleId?.toString() || "";
            },
          ),
        );

        // Transform roles
        const transformedRoles: Array<MemberRole> = (
          rolesResult.data as Array<IncidentRole>
        )
          .filter((role: IncidentRole): boolean => {
            return (
              !role.isArchived || heldRoleIds.has(role.id?.toString() || "")
            );
          })
          .map((role: IncidentRole): MemberRole => {
            const memberRole: MemberRole = {
              id: role.id!,
              name: role.name || "Unknown Role",
              color: role.color || Color.fromString("#6b7280"),
              isPrimaryRole: role.isPrimaryRole || false,
              canAssignMultipleUsers: role.canAssignMultipleUsers || false,
              isArchived: Boolean(role.isArchived),
            };

            if (role.roleIcon) {
              memberRole.icon = role.roleIcon;
            }

            return memberRole;
          });

        // Transform assigned members
        const transformedMembers: Array<AssignedMember> = (
          membersResult.data as Array<IncidentEpisodeRoleMember>
        ).map((member: IncidentEpisodeRoleMember) => {
          const user: User | undefined = member.user;
          const role: IncidentRole | undefined = member.incidentRole;

          return {
            id: member.id!,
            memberId: member.id!,
            userId: member.userId!,
            userName: user?.name?.toString() || "",
            userEmail: user?.email?.toString() || "",
            userProfilePictureUrl: user?.id
              ? UserUtil.getProfilePictureRoute(user.id).toString()
              : undefined,
            roleId: member.incidentRoleId!,
            roleName: role?.name || "Unknown Role",
            roleColor: role?.color || Color.fromString("#6b7280"),
          };
        });

        // Transform available users from dropdown options
        const transformedUsers: Array<AvailableUser> = projectUsers.map(
          (option: DropdownOption) => {
            return {
              id: new ObjectID(option.value.toString()),
              name: option.label,
              email: "",
            };
          },
        );

        setRoles(transformedRoles);
        setAssignedMembers(transformedMembers);
        setAvailableUsers(transformedUsers);

        onRolesLoadedRef.current?.(props.incidentEpisodeId.toString(), {
          roles: transformedRoles.map((role: MemberRole) => {
            return {
              id: role.id.toString(),
              name: role.name,
              isPrimaryRole: Boolean(role.isPrimaryRole),
              icon: role.icon,
            };
          }),
          members: (membersResult.data as Array<IncidentEpisodeRoleMember>).map(
            toEventRoleMember,
          ),
        });
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, [
      props.incidentEpisodeId.toString(),
      projectId?.toString(),
      props.refreshToken,
    ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAssignMember: (
    userId: ObjectID,
    roleId: ObjectID,
  ) => Promise<void> = async (
    userId: ObjectID,
    roleId: ObjectID,
  ): Promise<void> => {
    await assignIncidentEpisodeRole({
      incidentEpisodeId: props.incidentEpisodeId,
      userId: userId,
      roleId: roleId,
    });

    await fetchData();

    if (props.onMemberChange) {
      await props.onMemberChange();
    }
  };

  const handleUnassignMember: (memberId: ObjectID) => Promise<void> = async (
    memberId: ObjectID,
  ): Promise<void> => {
    await ModelAPI.deleteItem({
      modelType: IncidentEpisodeRoleMember,
      id: memberId,
    });

    await fetchData();

    if (props.onMemberChange) {
      await props.onMemberChange();
    }
  };

  const card: ReactElement = (
    <MemberRoleAssignment
      title="Episode Roles"
      description="Assign team members to roles for this episode. Role assignments will automatically propagate to all incidents in this episode."
      roles={roles}
      assignedMembers={assignedMembers}
      availableUsers={availableUsers}
      isLoading={isLoading}
      error={error}
      onAssignMember={handleAssignMember}
      onUnassignMember={handleUnassignMember}
      onRefresh={fetchData}
      emptyStateMessage="Configure incident roles in Incidents → Settings → Incident Roles to start assigning team members."
      className={props.className || ""}
      headerLayout={props.headerLayout}
    />
  );

  return card;
};

export default IncidentEpisodeMemberRoleAssignment;
