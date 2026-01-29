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
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
import ObjectID from "Common/Types/ObjectID";

export interface IncidentRoleOption {
  id: string;
  name: string;
  color?: string | undefined;
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

  // Check if optional sections have content
  const hasDescription: boolean = Boolean(criteriaIncident.description);
  const hasOwnershipOrLabels: boolean = Boolean(
    criteriaIncident.labelIds?.length ||
      criteriaIncident.ownerTeamIds?.length ||
      criteriaIncident.ownerUserIds?.length,
  );
  const hasNotifications: boolean = Boolean(
    criteriaIncident.onCallPolicyIds?.length,
  );
  const hasAdvancedOptions: boolean = Boolean(
    criteriaIncident.autoResolveIncident || criteriaIncident.remediationNotes,
  );
  const hasIncidentTeam: boolean = Boolean(
    criteriaIncident.incidentMemberRoles?.length,
  );

  // Helper to get user for a role
  const getUserForRole: (roleId: string) => ObjectID | undefined = (
    roleId: string,
  ): ObjectID | undefined => {
    const assignment: IncidentMemberRoleAssignment | undefined =
      criteriaIncident.incidentMemberRoles?.find(
        (a: IncidentMemberRoleAssignment) => a.roleId.toString() === roleId,
      );
    return assignment?.userId;
  };

  // Helper to set user for a role
  const setUserForRole: (roleId: string, userId: ObjectID | undefined) => void =
    (roleId: string, userId: ObjectID | undefined): void => {
      const existingRoles: Array<IncidentMemberRoleAssignment> =
        criteriaIncident.incidentMemberRoles || [];

      // Remove existing assignment for this role
      const filteredRoles: Array<IncidentMemberRoleAssignment> =
        existingRoles.filter(
          (a: IncidentMemberRoleAssignment) => a.roleId.toString() !== roleId,
        );

      // Add new assignment if userId is provided
      if (userId) {
        filteredRoles.push({
          roleId: new ObjectID(roleId),
          userId: userId,
        });
      }

      updateField("incidentMemberRoles", filteredRoles);
    };

  const templateDocsLink: ReactElement = (
    <Link
      to={new Route("/docs/monitor/incident-alert-templating")}
      openInNewTab={true}
      className="underline text-blue-600"
    >
      Learn about dynamic templates
    </Link>
  );

  return (
    <div className="mt-4 space-y-4">
      {/* Required Fields - Always Visible */}
      <div className="space-y-4">
        <div>
          <FieldLabelElement
            title="Incident Title"
            description={
              <span>Title for the incident. {templateDocsLink}</span>
            }
            required={true}
          />
          <Input
            value={criteriaIncident.title}
            placeholder="e.g., {{monitorName}} is down"
            onChange={(value: string) => {
              updateField("title", value);
            }}
          />
        </div>

        <div>
          <FieldLabelElement title="Severity" required={true} />
          <Dropdown
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

      {/* Description - Collapsible */}
      <CollapsibleSection
        title="Description"
        description="Optional incident description"
        badge={hasDescription ? "Set" : undefined}
        variant="bordered"
        defaultCollapsed={!hasDescription}
      >
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
      </CollapsibleSection>

      {/* Ownership & Labels - Collapsible */}
      <CollapsibleSection
        title="Ownership & Labels"
        description="Assign owners and labels to the incident"
        badge={hasOwnershipOrLabels ? "Configured" : undefined}
        variant="bordered"
        defaultCollapsed={!hasOwnershipOrLabels}
      >
        <div className="space-y-4">
          <div>
            <FieldLabelElement
              title="Owner Teams"
              description="Teams that will own and be notified about this incident"
            />
            <Dropdown
              value={props.teamDropdownOptions.filter((i: DropdownOption) => {
                return criteriaIncident.ownerTeamIds?.some((id: ObjectID) => {
                  return id.toString() === i.value;
                });
              })}
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
              value={props.userDropdownOptions.filter((i: DropdownOption) => {
                return criteriaIncident.ownerUserIds?.some((id: ObjectID) => {
                  return id.toString() === i.value;
                });
              })}
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
              value={props.labelDropdownOptions.filter((i: DropdownOption) => {
                return criteriaIncident.labelIds?.some((id: ObjectID) => {
                  return id.toString() === i.value;
                });
              })}
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
      </CollapsibleSection>

      {/* Notifications - Collapsible */}
      <CollapsibleSection
        title="Notifications"
        description="Configure on-call policy escalation"
        badge={hasNotifications ? "Configured" : undefined}
        variant="bordered"
        defaultCollapsed={!hasNotifications}
      >
        <div>
          <FieldLabelElement
            title="On-Call Policies"
            description="Execute these on-call policies when this incident is created"
          />
          <Dropdown
            value={props.onCallPolicyDropdownOptions.filter(
              (i: DropdownOption) => {
                return criteriaIncident.onCallPolicyIds?.some(
                  (id: ObjectID) => {
                    return id.toString() === i.value;
                  },
                );
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
      </CollapsibleSection>

      {/* Incident Team - Collapsible */}
      {props.incidentRoleOptions && props.incidentRoleOptions.length > 0 && (
        <CollapsibleSection
          title="Incident Team"
          description="Pre-assign team members to incident roles"
          badge={hasIncidentTeam ? "Configured" : undefined}
          variant="bordered"
          defaultCollapsed={!hasIncidentTeam}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Optionally assign users to incident roles. These users will be
              automatically assigned when the incident is created.
            </p>
            {props.incidentRoleOptions.map((role: IncidentRoleOption) => {
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
                    value={
                      selectedUserId
                        ? props.userDropdownOptions.find(
                            (i: DropdownOption) =>
                              i.value === selectedUserId.toString(),
                          )
                        : undefined
                    }
                    options={props.userDropdownOptions}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      setUserForRole(
                        role.id,
                        value ? new ObjectID(value.toString()) : undefined,
                      );
                    }}
                    placeholder={`Select ${role.name}...`}
                  />
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Advanced Options - Collapsible */}
      <CollapsibleSection
        title="Advanced Options"
        description="Auto-resolve and remediation settings"
        badge={hasAdvancedOptions ? "Configured" : undefined}
        variant="bordered"
        defaultCollapsed={!hasAdvancedOptions}
      >
        <div className="space-y-4">
          <div>
            <Toggle
              value={criteriaIncident.autoResolveIncident || false}
              title="Auto Resolve Incident"
              description="Automatically resolve this incident when this criteria is no longer met"
              onChange={(value: boolean) => {
                updateField("autoResolveIncident", value);
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
      </CollapsibleSection>
    </div>
  );
};

export default MonitorCriteriaIncidentForm;
