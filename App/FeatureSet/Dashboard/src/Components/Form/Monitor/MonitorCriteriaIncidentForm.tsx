import {
  CriteriaIncident,
  IncidentMemberRoleAssignment,
} from "Common/Types/Monitor/CriteriaIncident";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import CollapsibleSection from "./MonitorFormSection";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
import ObjectID from "Common/Types/ObjectID";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TemplateVariablesModal from "Common/UI/Components/MonitorTemplateVariables/TemplateVariablesModal";

export interface IncidentRoleOption {
  id: string;
  name: string;
  color?: string | undefined;
  canAssignMultipleUsers?: boolean | undefined;
}

export interface ComponentProps {
  initialValue?: undefined | CriteriaIncident;
  onChange?: undefined | ((value: CriteriaIncident) => void);
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  /**
   * Monitor type that drives which template variables are shown in
   * the "Dynamic Template Variables" modal. Optional for callers that
   * don't have it, in which case a generic variable list is shown.
   */
  monitorType?: MonitorType | undefined;
  /**
   * Per-series group-by attribute keys from the metric query config
   * (e.g. ["host.name", "resource.k8s.container.name"]). When set,
   * the template variables modal exposes them as per-series labels.
   */
  seriesAttributeKeys?: Array<string> | undefined;
}

const MonitorCriteriaIncidentForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [criteriaIncident, setCriteriaIncident] =
    React.useState<CriteriaIncident>(
      props.initialValue || {
        title: "",
        description: "",
        incidentSeverityId: undefined,
        id: ObjectID.generate().toString(),
      },
    );

  useEffect(() => {
    props.onChange?.(criteriaIncident);
  }, [criteriaIncident]);

  const updateField: <K extends keyof CriteriaIncident>(
    field: K,
    value: CriteriaIncident[K],
  ) => void = <K extends keyof CriteriaIncident>(
    field: K,
    value: CriteriaIncident[K],
  ): void => {
    setCriteriaIncident({
      ...criteriaIncident,
      [field]: value,
    });
  };

  const titleInputId: string = useId();
  const [isTitleTouched, setIsTitleTouched] = useState<boolean>(false);
  const ownerCount: number =
    (criteriaIncident.ownerTeamIds?.length || 0) +
    (criteriaIncident.ownerUserIds?.length || 0);
  const detailSummary: string =
    [
      criteriaIncident.description ? "Description" : "",
      ownerCount ? `${ownerCount} owner${ownerCount === 1 ? "" : "s"}` : "",
      criteriaIncident.labelIds?.length
        ? `${criteriaIncident.labelIds.length} label${criteriaIncident.labelIds.length === 1 ? "" : "s"}`
        : "",
      criteriaIncident.isPrivate ? "Private" : "",
      criteriaIncident.remediationNotes ? "Remediation notes" : "",
      criteriaIncident.incidentMemberRoles?.length ? "Incident roles" : "",
      criteriaIncident.showIncidentOnStatusPage === false
        ? "Hidden on status pages"
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Optional";

  // Helper to get user for a single-user role
  const getUserForRole: (roleId: string) => ObjectID | undefined = (
    roleId: string,
  ): ObjectID | undefined => {
    const assignment: IncidentMemberRoleAssignment | undefined =
      criteriaIncident.incidentMemberRoles?.find(
        (a: IncidentMemberRoleAssignment) => {
          return a.roleId.toString() === roleId;
        },
      );
    return assignment?.userId;
  };

  // Helper to get all users for a multi-user role
  const getUsersForRole: (roleId: string) => Array<ObjectID> = (
    roleId: string,
  ): Array<ObjectID> => {
    const assignments: Array<IncidentMemberRoleAssignment> =
      criteriaIncident.incidentMemberRoles?.filter(
        (a: IncidentMemberRoleAssignment) => {
          return a.roleId.toString() === roleId;
        },
      ) || [];
    return assignments.map((a: IncidentMemberRoleAssignment) => {
      return a.userId;
    });
  };

  // Helper to set user for a single-user role
  const setUserForRole: (
    roleId: string,
    userId: ObjectID | undefined,
  ) => void = (roleId: string, userId: ObjectID | undefined): void => {
    const existingRoles: Array<IncidentMemberRoleAssignment> =
      criteriaIncident.incidentMemberRoles || [];

    // Remove existing assignment for this role
    const filteredRoles: Array<IncidentMemberRoleAssignment> =
      existingRoles.filter((a: IncidentMemberRoleAssignment) => {
        return a.roleId.toString() !== roleId;
      });

    // Add new assignment if userId is provided
    if (userId) {
      filteredRoles.push({
        roleId: new ObjectID(roleId),
        userId: userId,
      });
    }

    updateField("incidentMemberRoles", filteredRoles);
  };

  // Helper to set multiple users for a multi-user role
  const setUsersForRole: (roleId: string, userIds: Array<ObjectID>) => void = (
    roleId: string,
    userIds: Array<ObjectID>,
  ): void => {
    const existingRoles: Array<IncidentMemberRoleAssignment> =
      criteriaIncident.incidentMemberRoles || [];

    // Remove all existing assignments for this role
    const filteredRoles: Array<IncidentMemberRoleAssignment> =
      existingRoles.filter((a: IncidentMemberRoleAssignment) => {
        return a.roleId.toString() !== roleId;
      });

    // Add new assignments for each userId
    for (const userId of userIds) {
      filteredRoles.push({
        roleId: new ObjectID(roleId),
        userId: userId,
      });
    }

    updateField("incidentMemberRoles", filteredRoles);
  };

  const [isTemplateModalOpen, setIsTemplateModalOpen] =
    useState<boolean>(false);

  const templateDocsLink: ReactElement = (
    <button
      type="button"
      onClick={(): void => {
        setIsTemplateModalOpen(true);
      }}
      className="underline text-blue-600 hover:text-blue-800"
    >
      View dynamic values
    </button>
  );

  const templateVariablesModal: ReactElement | null = isTemplateModalOpen ? (
    <TemplateVariablesModal
      monitorType={props.monitorType ?? MonitorType.API}
      seriesAttributeKeys={props.seriesAttributeKeys}
      onClose={(): void => {
        setIsTemplateModalOpen(false);
      }}
    />
  ) : null;

  return (
    <div className="space-y-4">
      {templateVariablesModal}
      {/* Required Fields - Always Visible */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <FieldLabelElement
            title="Incident title"
            htmlFor={titleInputId}
            description={
              <span>Title for the incident. {templateDocsLink}</span>
            }
            required={true}
          />
          <Input
            id={titleInputId}
            value={criteriaIncident.title}
            onBlur={() => {
              setIsTitleTouched(true);
            }}
            error={
              isTitleTouched && !criteriaIncident.title?.trim()
                ? "Incident title is required"
                : undefined
            }
            placeholder="e.g., {{monitorName}} is down"
            onChange={(value: string) => {
              updateField("title", value);
            }}
          />
        </div>

        <div>
          <FieldLabelElement title="Severity" required={true} />
          <Dropdown
            ariaLabel="Incident severity"
            value={props.incidentSeverityDropdownOptions.find(
              (i: DropdownOption) => {
                return (
                  i.value === criteriaIncident.incidentSeverityId?.toString()
                );
              },
            )}
            options={props.incidentSeverityDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              updateField(
                "incidentSeverityId",
                value ? new ObjectID(value.toString()) : undefined,
              );
            }}
            placeholder="Select Severity"
          />
        </div>
      </div>

      <div>
        <FieldLabelElement
          title="Notify on-call"
          description="Select the on-call policies to notify."
        />
        <Dropdown
          ariaLabel="Incident on-call policies"
          value={props.onCallPolicyDropdownOptions.filter(
            (i: DropdownOption) => {
              return criteriaIncident.onCallPolicyIds?.some((id: ObjectID) => {
                return id.toString() === i.value;
              });
            },
          )}
          options={props.onCallPolicyDropdownOptions}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (Array.isArray(value)) {
              updateField(
                "onCallPolicyIds",
                value.map((v: DropdownValue) => {
                  return new ObjectID(v.toString());
                }),
              );
            } else {
              updateField("onCallPolicyIds", []);
            }
          }}
          isMultiSelect={true}
          placeholder="Select On-Call Policies"
        />
      </div>

      <Checkbox
        ariaLabel="Auto-resolve incident"
        value={criteriaIncident.autoResolveIncident || false}
        title="Auto-resolve incident"
        description="Resolve automatically when this rule no longer matches."
        onChange={(value: boolean) => {
          updateField("autoResolveIncident", value);
        }}
      />

      <CollapsibleSection
        title="Incident details"
        badge={detailSummary}
        defaultCollapsed={true}
      >
        <div className="space-y-5 border-t border-gray-200 pt-4">
          {/* Description */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">Description</h4>
            <div>
              <FieldLabelElement
                title="Incident Description"
                description={
                  <span>Description for the incident. {templateDocsLink}</span>
                }
              />
              <MarkdownEditor
                initialValue={criteriaIncident.description || ""}
                placeholder="Describe the incident..."
                onChange={(value: string) => {
                  updateField("description", value);
                }}
              />
            </div>
          </section>

          {/* Incident Roles */}
          {props.incidentRoleOptions &&
            props.incidentRoleOptions.length > 0 && (
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-900">
                  Incident roles
                </h4>
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    Optionally assign users to incident roles. These users will
                    be automatically assigned when the incident is created.
                  </p>
                  {props.incidentRoleOptions.map((role: IncidentRoleOption) => {
                    if (role.canAssignMultipleUsers) {
                      // Multi-user role
                      const selectedUserIds: Array<ObjectID> = getUsersForRole(
                        role.id,
                      );
                      return (
                        <div key={role.id}>
                          <FieldLabelElement
                            title={role.name}
                            description={
                              <span>
                                Assign multiple users to the {role.name} role{" "}
                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded ml-1">
                                  Multiple
                                </span>
                              </span>
                            }
                          />
                          <Dropdown
                            ariaLabel={role.name}
                            value={props.userDropdownOptions.filter(
                              (i: DropdownOption) => {
                                return selectedUserIds.some((id: ObjectID) => {
                                  return id.toString() === i.value;
                                });
                              },
                            )}
                            options={props.userDropdownOptions}
                            onChange={(
                              value:
                                | DropdownValue
                                | Array<DropdownValue>
                                | null,
                            ) => {
                              if (Array.isArray(value)) {
                                setUsersForRole(
                                  role.id,
                                  value.map((v: DropdownValue) => {
                                    return new ObjectID(v.toString());
                                  }),
                                );
                              } else {
                                setUsersForRole(role.id, []);
                              }
                            }}
                            isMultiSelect={true}
                            placeholder={`Select ${role.name}...`}
                          />
                        </div>
                      );
                    }
                    // Single-user role
                    const selectedUserId: ObjectID | undefined = getUserForRole(
                      role.id,
                    );
                    return (
                      <div key={role.id}>
                        <FieldLabelElement
                          title={role.name}
                          description={`Assign a user to the ${role.name} role`}
                        />
                        <Dropdown
                          ariaLabel={role.name}
                          value={
                            selectedUserId
                              ? props.userDropdownOptions.find(
                                  (i: DropdownOption) => {
                                    return (
                                      i.value === selectedUserId.toString()
                                    );
                                  },
                                )
                              : undefined
                          }
                          options={props.userDropdownOptions}
                          onChange={(
                            value: DropdownValue | Array<DropdownValue> | null,
                          ) => {
                            setUserForRole(
                              role.id,
                              value
                                ? new ObjectID(value.toString())
                                : undefined,
                            );
                          }}
                          placeholder={`Select ${role.name}...`}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

          {/* Ownership & Labels */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Owners and labels
            </h4>
            <div className="space-y-4">
              <div>
                <FieldLabelElement
                  title="Owner Teams"
                  description="Teams that will own and be notified about this incident"
                />
                <Dropdown
                  ariaLabel="Incident owner teams"
                  value={props.teamDropdownOptions.filter(
                    (i: DropdownOption) => {
                      return criteriaIncident.ownerTeamIds?.some(
                        (id: ObjectID) => {
                          return id.toString() === i.value;
                        },
                      );
                    },
                  )}
                  options={props.teamDropdownOptions}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (Array.isArray(value)) {
                      updateField(
                        "ownerTeamIds",
                        value.map((v: DropdownValue) => {
                          return new ObjectID(v.toString());
                        }),
                      );
                    } else {
                      updateField("ownerTeamIds", []);
                    }
                  }}
                  isMultiSelect={true}
                  placeholder="Select Teams"
                />
              </div>

              <div>
                <FieldLabelElement
                  title="Owner Users"
                  description="Users that will own and be notified about this incident"
                />
                <Dropdown
                  ariaLabel="Incident owner users"
                  value={props.userDropdownOptions.filter(
                    (i: DropdownOption) => {
                      return criteriaIncident.ownerUserIds?.some(
                        (id: ObjectID) => {
                          return id.toString() === i.value;
                        },
                      );
                    },
                  )}
                  options={props.userDropdownOptions}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (Array.isArray(value)) {
                      updateField(
                        "ownerUserIds",
                        value.map((v: DropdownValue) => {
                          return new ObjectID(v.toString());
                        }),
                      );
                    } else {
                      updateField("ownerUserIds", []);
                    }
                  }}
                  isMultiSelect={true}
                  placeholder="Select Users"
                />
              </div>

              <div>
                <FieldLabelElement
                  title="Labels"
                  description="Labels to categorize the incident"
                />
                <Dropdown
                  ariaLabel="Incident labels"
                  value={props.labelDropdownOptions.filter(
                    (i: DropdownOption) => {
                      return criteriaIncident.labelIds?.some((id: ObjectID) => {
                        return id.toString() === i.value;
                      });
                    },
                  )}
                  options={props.labelDropdownOptions}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (Array.isArray(value)) {
                      updateField(
                        "labelIds",
                        value.map((v: DropdownValue) => {
                          return new ObjectID(v.toString());
                        }),
                      );
                    } else {
                      updateField("labelIds", []);
                    }
                  }}
                  isMultiSelect={true}
                  placeholder="Select Labels"
                />
              </div>
            </div>
          </section>

          {/* Advanced Options */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Visibility and remediation
            </h4>
            <div className="space-y-4">
              <div>
                <Checkbox
                  value={criteriaIncident.showIncidentOnStatusPage !== false}
                  title="Show Incident on Status Page"
                  ariaLabel="Show Incident on Status Page"
                  description="When disabled, this incident will not be visible on your public status pages"
                  onChange={(value: boolean) => {
                    updateField("showIncidentOnStatusPage", value);
                  }}
                />
              </div>

              <div>
                <Checkbox
                  value={criteriaIncident.isPrivate === true}
                  title="Private Incident"
                  ariaLabel="Private Incident"
                  description="When enabled, only the incident's owner users and members of its owner teams (plus project admins and owners) can view this incident. Private incidents are automatically hidden from all status pages."
                  onChange={(value: boolean) => {
                    updateField("isPrivate", value);
                  }}
                />
              </div>

              <div>
                <FieldLabelElement
                  title="Remediation Notes"
                  description={
                    <span>
                      Notes for on-call engineer to resolve this incident.{" "}
                      {templateDocsLink}
                    </span>
                  }
                />
                <MarkdownEditor
                  initialValue={criteriaIncident.remediationNotes || ""}
                  placeholder="Steps to resolve this incident..."
                  onChange={(value: string) => {
                    updateField("remediationNotes", value);
                  }}
                />
              </div>
            </div>
          </section>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default MonitorCriteriaIncidentForm;
