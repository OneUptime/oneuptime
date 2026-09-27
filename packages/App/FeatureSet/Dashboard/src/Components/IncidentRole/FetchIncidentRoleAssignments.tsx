import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { Black } from "Common/Types/BrandColors";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Pill from "Common/UI/Components/Pill/Pill";
import FetchUsers from "../User/FetchUsers";
import { RoleAssignment } from "../Incident/IncidentRoleFormField";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  assignments: Array<RoleAssignment>;
}

/*
 * The answer for one set of roles, remembered with the set it was asked for.
 * A render that already has a new set of roles but not yet its answer shows
 * the loader: drawn from the old answer, a role it does not hold would read
 * as not found, and its users would be looked up only to be thrown away.
 */
interface RolesAnswer {
  roleIdsKey: string;
  rolesById: Map<string, IncidentRole>;
  error: string;
}

/*
 * A create wizard holds only the ids of the roles it assigns and of the users
 * assigned to them, so its review step looks the roles up to show each one's
 * name in its color, with the people assigned to it beneath - instead of a
 * count of users and roles that names neither. Incident and episode roles are
 * both IncidentRole records.
 */
const FetchIncidentRoleAssignments: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // One lookup covers every role on screen; a different set asks again.
  const roleIdsKey: string = Array.from(
    new Set(
      props.assignments.map((assignment: RoleAssignment): string => {
        return assignment.roleId;
      }),
    ),
  ).join(",");

  const [answer, setAnswer] = useState<RolesAnswer | null>(null);

  useEffect(() => {
    // Only the answer for the roles on screen may land.
    let isCurrent: boolean = true;

    const showError: (err: unknown) => void = (err: unknown): void => {
      if (isCurrent) {
        setAnswer({
          roleIdsKey: roleIdsKey,
          rolesById: new Map(),
          error: API.getFriendlyMessage(err),
        });
      }
    };

    const fetchRoles: PromiseVoidFunction = async (): Promise<void> => {
      if (!roleIdsKey) {
        setAnswer({ roleIdsKey: roleIdsKey, rolesById: new Map(), error: "" });
        return;
      }

      try {
        const roles: ListResult<IncidentRole> =
          await ModelAPI.getList<IncidentRole>({
            modelType: IncidentRole,
            query: {
              _id: new Includes(
                roleIdsKey.split(",").map((roleId: string): ObjectID => {
                  return new ObjectID(roleId);
                }),
              ),
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            select: {
              _id: true,
              name: true,
              color: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
          });

        if (isCurrent) {
          const fetchedRolesById: Map<string, IncidentRole> = new Map();

          for (const role of roles.data) {
            if (role._id) {
              fetchedRolesById.set(role._id.toString(), role);
            }
          }

          setAnswer({
            roleIdsKey: roleIdsKey,
            rolesById: fetchedRolesById,
            error: "",
          });
        }
      } catch (err) {
        showError(err);
      }
    };

    fetchRoles().catch((err: Exception) => {
      showError(err);
    });

    return () => {
      isCurrent = false;
    };
  }, [roleIdsKey]);

  if (!answer || answer.roleIdsKey !== roleIdsKey) {
    return <ComponentLoader />;
  }

  if (answer.error) {
    return <ErrorMessage message={answer.error} />;
  }

  const rolesById: Map<string, IncidentRole> = answer.rolesById;

  return (
    <div className="space-y-4">
      {props.assignments.map((assignment: RoleAssignment) => {
        const role: IncidentRole | undefined = rolesById.get(assignment.roleId);

        return (
          <div key={assignment.roleId}>
            {role ? (
              <Pill
                isMinimal={true}
                color={role.color || Black}
                text={role.name || "Unnamed Role"}
              />
            ) : (
              <p>The selected role could not be found.</p>
            )}
            {/*
             * FetchUsers looks its users up once, when it mounts, so a
             * different set of users for this role mounts a new one.
             */}
            <FetchUsers
              key={assignment.userIds.join(",")}
              userIds={assignment.userIds.map((userId: string): ObjectID => {
                return new ObjectID(userId);
              })}
            />
          </div>
        );
      })}
    </div>
  );
};

export default FetchIncidentRoleAssignments;
