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
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
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
import { assignIncidentRole } from "../../Utils/EventRoleAssignment";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Why a reader who may not give or take off the incident's roles finds
 * Assign, Add More, Reassign and Remove locked: in the words of what they
 * pressed, not the member table's ("create this Incident Member"). The
 * permissions that would allow it follow.
 */
export const INCIDENT_ROLES_LOCKED_SENTENCE: string = translationKey(
  "You do not have permission to change this incident's roles.",
);

export interface ComponentProps {
  incidentId: ObjectID;
  className?: string;
  onMemberChange?: () => Promise<void>;
  // "stacked" when the card sits in a narrow column; see Card.
  headerLayout?: CardHeaderLayout | undefined;
  /*
   * Called with the incident's roles and who holds them each time the card
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

const IncidentMemberRoleAssignment: FunctionComponent<ComponentProps> = (
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
          ModelAPI.getList<IncidentMember>({
            modelType: IncidentMember,
            query: {
              incidentId: props.incidentId,
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
         * one only while someone holds it on this incident.
         */
        const heldRoleIds: Set<string> = new Set<string>(
          (membersResult.data as Array<IncidentMember>).map(
            (member: IncidentMember): string => {
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
          membersResult.data as Array<IncidentMember>
        ).map((member: IncidentMember) => {
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

        onRolesLoadedRef.current?.(props.incidentId.toString(), {
          roles: transformedRoles.map((role: MemberRole) => {
            return {
              id: role.id.toString(),
              name: role.name,
              isPrimaryRole: Boolean(role.isPrimaryRole),
              icon: role.icon,
            };
          }),
          members: (membersResult.data as Array<IncidentMember>).map(
            toEventRoleMember,
          ),
        });
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, [
      props.incidentId.toString(),
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
    await assignIncidentRole({
      incidentId: props.incidentId,
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
      modelType: IncidentMember,
      id: memberId,
    });

    await fetchData();

    if (props.onMemberChange) {
      await props.onMemberChange();
    }
  };

  const card: ReactElement = (
    <MemberRoleAssignment
      title="Incident Roles"
      /*
       * A role can take several people (Allow Multiple Users); the card
       * offers Add More on those, so it does not promise one each.
       */
      description="Who takes each role on this incident."
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
      /*
       * A role given is a new row of the incident's members, a role taken
       * off one removed: the header's Assign asks the same.
       */
      assignGate={PermissionGate.check(new IncidentMember(), ModelAction.Create, {
        sentence: INCIDENT_ROLES_LOCKED_SENTENCE,
      })}
      unassignGate={PermissionGate.check(
        new IncidentMember(),
        ModelAction.Delete,
        { sentence: INCIDENT_ROLES_LOCKED_SENTENCE },
      )}
    />
  );

  return card;
};

export default IncidentMemberRoleAssignment;
