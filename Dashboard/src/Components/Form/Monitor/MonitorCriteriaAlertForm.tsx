import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
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

export interface ComponentProps {
  initialValue?: undefined | CriteriaAlert;
  onChange?: undefined | ((value: CriteriaAlert) => void);
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
}

const MonitorCriteriaAlertForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [criteriaAlert, setCriteriaAlert] = React.useState<CriteriaAlert>(
    props.initialValue || {
      title: "",
      description: "",
      alertSeverityId: undefined,
      id: ObjectID.generate().toString(),
    },
  );

  useEffect(() => {
    props.onChange?.(criteriaAlert);
  }, [criteriaAlert]);

  const updateField = <K extends keyof CriteriaAlert>(
    field: K,
    value: CriteriaAlert[K],
  ): void => {
    setCriteriaAlert({
      ...criteriaAlert,
      [field]: value,
    });
  };

  // Check if optional sections have content
  const hasDescription: boolean = Boolean(criteriaAlert.description);
  const hasOwnershipOrLabels: boolean = Boolean(
    criteriaAlert.labelIds?.length ||
      criteriaAlert.ownerTeamIds?.length ||
      criteriaAlert.ownerUserIds?.length,
  );
  const hasNotifications: boolean = Boolean(
    criteriaAlert.onCallPolicyIds?.length,
  );
  const hasAdvancedOptions: boolean = Boolean(
    criteriaAlert.autoResolveAlert || criteriaAlert.remediationNotes,
  );

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
            title="Alert Title"
            description={<span>Title for the alert. {templateDocsLink}</span>}
            required={true}
          />
          <Input
            value={criteriaAlert.title}
            placeholder="e.g., {{monitorName}} is degraded"
            onChange={(value: string) => {
              updateField("title", value);
            }}
          />
        </div>

        <div>
          <FieldLabelElement title="Severity" required={true} />
          <Dropdown
            value={props.alertSeverityDropdownOptions.find(
              (i: DropdownOption) => {
                return i.value === criteriaAlert.alertSeverityId?.toString();
              },
            )}
            options={props.alertSeverityDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              updateField(
                "alertSeverityId",
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
        description="Optional alert description"
        badge={hasDescription ? "Set" : undefined}
        variant="bordered"
        defaultCollapsed={!hasDescription}
      >
        <div>
          <FieldLabelElement
            title="Alert Description"
            description={<span>Description for the alert. {templateDocsLink}</span>}
          />
          <MarkdownEditor
            initialValue={criteriaAlert.description || ""}
            placeholder="Describe the alert..."
            onChange={(value: string) => {
              updateField("description", value);
            }}
          />
        </div>
      </CollapsibleSection>

      {/* Ownership & Labels - Collapsible */}
      <CollapsibleSection
        title="Ownership & Labels"
        description="Assign owners and labels to the alert"
        badge={hasOwnershipOrLabels ? "Configured" : undefined}
        variant="bordered"
        defaultCollapsed={!hasOwnershipOrLabels}
      >
        <div className="space-y-4">
          <div>
            <FieldLabelElement
              title="Owner Teams"
              description="Teams that will own and be notified about this alert"
            />
            <Dropdown
              value={props.teamDropdownOptions.filter((i: DropdownOption) => {
                return criteriaAlert.ownerTeamIds?.some(
                  (id: ObjectID) => id.toString() === i.value,
                );
              })}
              options={props.teamDropdownOptions}
              onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
                if (Array.isArray(value)) {
                  updateField(
                    "ownerTeamIds",
                    value.map((v: DropdownValue) => new ObjectID(v.toString())),
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
              description="Users that will own and be notified about this alert"
            />
            <Dropdown
              value={props.userDropdownOptions.filter((i: DropdownOption) => {
                return criteriaAlert.ownerUserIds?.some(
                  (id: ObjectID) => id.toString() === i.value,
                );
              })}
              options={props.userDropdownOptions}
              onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
                if (Array.isArray(value)) {
                  updateField(
                    "ownerUserIds",
                    value.map((v: DropdownValue) => new ObjectID(v.toString())),
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
              description="Labels to categorize the alert"
            />
            <Dropdown
              value={props.labelDropdownOptions.filter((i: DropdownOption) => {
                return criteriaAlert.labelIds?.some(
                  (id: ObjectID) => id.toString() === i.value,
                );
              })}
              options={props.labelDropdownOptions}
              onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
                if (Array.isArray(value)) {
                  updateField(
                    "labelIds",
                    value.map((v: DropdownValue) => new ObjectID(v.toString())),
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
            description="Execute these on-call policies when this alert is created"
          />
          <Dropdown
            value={props.onCallPolicyDropdownOptions.filter(
              (i: DropdownOption) => {
                return criteriaAlert.onCallPolicyIds?.some(
                  (id: ObjectID) => id.toString() === i.value,
                );
              },
            )}
            options={props.onCallPolicyDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (Array.isArray(value)) {
                updateField(
                  "onCallPolicyIds",
                  value.map((v: DropdownValue) => new ObjectID(v.toString())),
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
              value={criteriaAlert.autoResolveAlert || false}
              title="Auto Resolve Alert"
              description="Automatically resolve this alert when this criteria is no longer met"
              onChange={(value: boolean) => {
                updateField("autoResolveAlert", value);
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Remediation Notes"
              description={
                <span>
                  Notes for on-call engineer to resolve this alert.{" "}
                  {templateDocsLink}
                </span>
              }
            />
            <MarkdownEditor
              initialValue={criteriaAlert.remediationNotes || ""}
              placeholder="Steps to resolve this alert..."
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

export default MonitorCriteriaAlertForm;
