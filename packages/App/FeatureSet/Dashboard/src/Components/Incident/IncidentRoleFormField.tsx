import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
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
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import RoleLabel from "Common/UI/Components/RoleLabel/RoleLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import ProjectUser from "../../Utils/ProjectUser";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  canPickAnotherPerson,
  getPickedUserIds,
  INCIDENT_ROLE_CHOICE_SELECT,
  IncidentRoleChoice,
  RoleAssignment,
  sortIncidentRoleChoices,
  toIncidentRoleChoice,
  withRoleUsers,
} from "../IncidentRole/IncidentRoleAssignments";

export type { IncidentRoleChoice, RoleAssignment };

export interface IncidentRoleFormFieldProps {
  onChange?: ((value: Array<RoleAssignment>) => void) | undefined;
  initialValue?: Array<RoleAssignment> | undefined;
  /*
   * The project's roles and people, for a form that has them already: the
   * monitor criteria read them once for every incident they declare. Each
   * one left out, the picker reads itself.
   */
  roles?: Array<IncidentRoleChoice> | undefined;
  users?: Array<DropdownOption> | undefined;
}

/*
 * Who takes each incident role, one card per role: the role's name, a
 * Primary tag on the primary roles (Incident Commander), the people picked
 * so far, and a picker for one more - for a role that takes only one
 * person, until it has one.
 *
 * The one role picker. Every form that assigns incident roles draws it:
 * Declare Incident, Create Incident Episode (IncidentEpisodeRoleFormField:
 * episodes share the project's incident roles), a monitor rule's incident
 * (Form/Monitor/MonitorCriteriaIncidentForm) and a grouping rule's episodes
 * (IncidentGroupingRule/EpisodeMemberRoleAssignmentsFormField). The last two
 * keep the rows they always stored and convert them to this picker's value
 * and back (IncidentRole/IncidentRoleAssignments). There is no "Multiple"
 * tag: a role that takes several people keeps its picker, and a role that
 * takes one says so once it has one, which is all the tag ever told.
 * Common/Tests/UI/Components/Forms/OneIncidentRolePickerGuard holds every
 * form to it.
 */
const IncidentRoleFormField: FunctionComponent<IncidentRoleFormFieldProps> = (
  props: IncidentRoleFormFieldProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const pickerId: string = useId();

  const needsRoles: boolean = props.roles === undefined;
  const needsUsers: boolean = props.users === undefined;

  const [isLoading, setIsLoading] = useState<boolean>(needsRoles || needsUsers);
  const [error, setError] = useState<string>("");
  const [loadedRoles, setLoadedRoles] = useState<Array<IncidentRoleChoice>>([]);
  const [loadedUsers, setLoadedUsers] = useState<Array<DropdownOption>>([]);
  const [assignments, setAssignments] = useState<Array<RoleAssignment>>(
    props.initialValue || [],
  );

  useEffect(() => {
    if (!needsRoles && !needsUsers) {
      setIsLoading(false);
      return;
    }

    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          throw new Error(
            translator.translateText("Project not found") ||
              "Project not found",
          );
        }

        if (needsRoles) {
          const rolesResult: ListResult<IncidentRole> =
            await ModelAPI.getList<IncidentRole>({
              modelType: IncidentRole,
              query: {
                projectId: projectId,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: INCIDENT_ROLE_CHOICE_SELECT,
              sort: {
                name: SortOrder.Ascending,
              },
            });

          if (isCurrent) {
            setLoadedRoles(rolesResult.data.map(toIncidentRoleChoice));
          }
        }

        if (needsUsers) {
          const users: Array<DropdownOption> =
            await ProjectUser.fetchProjectUsersAsDropdownOptions(projectId);

          if (isCurrent) {
            setLoadedUsers(users);
          }
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // load() reports its own failures.
    });

    return () => {
      isCurrent = false;
    };
  }, [needsRoles, needsUsers]);

  const roles: Array<IncidentRoleChoice> = sortIncidentRoleChoices(
    props.roles || loadedRoles,
  );
  const userOptions: Array<DropdownOption> = props.users || loadedUsers;

  /*
   * Worked out from the assignments on screen and told to the form right
   * away - not from inside a state update, which React may run while it
   * renders, when a form must not be told anything.
   */
  const setPeopleForRole: (roleId: string, userIds: Array<string>) => void = (
    roleId: string,
    userIds: Array<string>,
  ): void => {
    const next: Array<RoleAssignment> = withRoleUsers(
      assignments,
      roleId,
      userIds,
    );

    setAssignments(next);
    props.onChange?.(next);
  };

  // A person no longer in the project is still named, as Unknown User.
  const nameOf: (userId: string) => string = (userId: string): string => {
    return (
      userOptions.find((option: DropdownOption): boolean => {
        return option.value === userId;
      })?.label ||
      translator.translateText("Unknown User") ||
      "Unknown User"
    );
  };

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (roles.length === 0) {
    return (
      <p className="text-gray-500">
        {translator.translateText("No incident roles found.")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {roles.map((role: IncidentRoleChoice) => {
        const picked: Array<string> = getPickedUserIds(assignments, role.id);
        const canAddMore: boolean = canPickAnotherPerson(role, picked.length);
        // The role's name names its picker for a screen reader.
        const roleNameId: string = `${pickerId}-role-${role.id}`;

        return (
          <div
            key={role.id}
            data-testid="incident-role-card"
            className="border border-gray-200 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div id={roleNameId}>
                  <RoleLabel
                    name={role.name}
                    color={role.color ? new Color(role.color) : undefined}
                    icon={role.icon}
                  />
                </div>
                {role.isPrimaryRole && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">
                    {translator.translateText("Primary")}
                  </span>
                )}
              </div>
            </div>

            {/* The people picked */}
            {picked.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {picked.map((userId: string) => {
                  const name: string = nameOf(userId);

                  return (
                    <div
                      key={userId}
                      className="flex items-center bg-gray-100 rounded-full px-3 py-1 text-sm"
                    >
                      <span>{name}</span>
                      <button
                        type="button"
                        aria-label={translator.translateTemplate(
                          "Remove {{member}} from {{role}}",
                          { member: name, role: role.name },
                        )}
                        onClick={() => {
                          setPeopleForRole(
                            role.id,
                            picked.filter((id: string): boolean => {
                              return id !== userId;
                            }),
                          );
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

            {/* One more person */}
            {canAddMore && (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Dropdown
                    placeholder="Select User"
                    ariaLabelledby={roleNameId}
                    options={userOptions.filter((option: DropdownOption) => {
                      // The people picked already are not offered again.
                      return !picked.includes(option.value as string);
                    })}
                    value={undefined}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      if (value && typeof value === "string") {
                        setPeopleForRole(role.id, [...picked, value]);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {!canAddMore && (
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  "Only one user can be assigned to this role.",
                )}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default IncidentRoleFormField;
