import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
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
  useMemo,
  useState,
} from "react";
import OwnersPicker, {
  OwnersPickerValue,
} from "Common/UI/Components/PeoplePicker/OwnersPicker";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
import ObjectID from "Common/Types/ObjectID";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TemplateVariablesModal from "Common/UI/Components/MonitorTemplateVariables/TemplateVariablesModal";
import TemplateVariablesCatalog from "Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import { TemplateVariableGroups } from "Common/Types/Template/TemplateVariable";
import MonitorCriteriaTemplateCopy from "./MonitorCriteriaTemplateCopy";
import { getIncidentMoreFieldsItems } from "./MonitorMoreFields";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import IncidentRoleFormField from "../../Incident/IncidentRoleFormField";
import {
  assignmentsToCriteriaRoles,
  criteriaRolesToAssignments,
  IncidentRoleChoice,
  RoleAssignment,
} from "../../IncidentRole/IncidentRoleAssignments";

/*
 * A project's incident role, as the monitor form reads it once for every
 * rule (MonitorSteps) and hands it to the role picker.
 */
export type IncidentRoleOption = IncidentRoleChoice;

export interface ComponentProps {
  initialValue?: undefined | CriteriaIncident;
  onChange?: undefined | ((value: CriteriaIncident) => void);
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  // The project's people, for the incident roles.
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
  const translator: Translator = useTranslator();
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

  const ownersLabelId: string = `${useId()}-owners-label`;

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
  /*
   * The More fields section's options, by name, the ones the user chose
   * as chips: a default rule's auto-resolve does not count.
   */
  const moreFieldsItems: Array<FoldedSectionItem> =
    getIncidentMoreFieldsItems(criteriaIncident);
  const hasIncidentTeam: boolean = Boolean(
    criteriaIncident.incidentMemberRoles?.length,
  );

  /*
   * The variables this monitor's incident description and remediation notes
   * can use, offered by their editors: collapsed under each, behind its
   * Insert variable button, and when "{{" is typed.
   */
  const templateVariableGroups: TemplateVariableGroups = useMemo(() => {
    return TemplateVariablesCatalog.getTemplateVariableGroups({
      monitorType: props.monitorType ?? MonitorType.API,
      seriesAttributeKeys: props.seriesAttributeKeys,
    });
  }, [props.monitorType, props.seriesAttributeKeys]);

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
      {translator.translateText("Learn about dynamic templates")}
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
    <div className="mt-4 space-y-4">
      {templateVariablesModal}
      {/* Required Fields - Always Visible */}
      <div className="space-y-4">
        <div>
          <FieldLabelElement
            title="Incident Title"
            description={
              <span>
                {translator.translateText("Title for the incident.")}{" "}
                {templateDocsLink}
              </span>
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
      <FoldedSection
        title="Description"
        description="Optional incident description"
        badge={hasDescription ? "Set" : undefined}
        defaultCollapsed={!hasDescription}
      >
        <div>
          <FieldLabelElement
            title="Incident Description"
            description={MonitorCriteriaTemplateCopy.incidentDescriptionHelp}
          />
          <MarkdownEditor
            initialValue={criteriaIncident.description || ""}
            templateVariables={templateVariableGroups}
            templateVariablesDescription={
              MonitorCriteriaTemplateCopy.incidentVariablesDescription
            }
            placeholder="Describe the incident..."
            onChange={(value: string) => {
              updateField("description", value);
            }}
          />
        </div>
      </FoldedSection>

      {/* On-Call - Collapsible */}
      <FoldedSection
        title="On-Call"
        description="Configure on-call policy escalation"
        badge={hasNotifications ? "Configured" : undefined}
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
      </FoldedSection>

      {/*
       * Incident Roles - collapsible. The declare form's role picker, with
       * the roles and people this form read once for every rule; the rule
       * keeps one { roleId, userId } row per person, as it always has.
       */}
      {props.incidentRoleOptions && props.incidentRoleOptions.length > 0 && (
        <FoldedSection
          title="Incident Roles"
          description="Pre-assign team members to incident roles"
          badge={hasIncidentTeam ? "Configured" : undefined}
          defaultCollapsed={!hasIncidentTeam}
          dataTestId="criteria-incident-roles"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "Optionally assign users to incident roles. These users will be automatically assigned when the incident is created.",
              )}
            </p>
            <IncidentRoleFormField
              roles={props.incidentRoleOptions}
              users={props.userDropdownOptions}
              initialValue={criteriaRolesToAssignments(
                criteriaIncident.incidentMemberRoles,
              )}
              onChange={(assignments: Array<RoleAssignment>) => {
                updateField(
                  "incidentMemberRoles",
                  assignmentsToCriteriaRoles(assignments),
                );
              }}
            />
          </div>
        </FoldedSection>
      )}

      {/* Ownership & Labels - Collapsible */}
      <FoldedSection
        title="Ownership & Labels"
        description="Assign owners and labels to the incident"
        badge={hasOwnershipOrLabels ? "Configured" : undefined}
        defaultCollapsed={!hasOwnershipOrLabels}
      >
        <div className="space-y-4">
          <div>
            <FieldLabelElement
              id={ownersLabelId}
              title="Owners"
              description="People and teams who will own this incident and be notified about it"
            />
            <div className="mt-2">
              <OwnersPicker
                ariaLabelledby={ownersLabelId}
                userIds={criteriaIncident.ownerUserIds}
                teamIds={criteriaIncident.ownerTeamIds}
                onChange={(owners: OwnersPickerValue) => {
                  setCriteriaIncident({
                    ...criteriaIncident,
                    ownerUserIds: owners.userIds,
                    ownerTeamIds: owners.teamIds,
                  });
                }}
              />
            </div>
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
      </FoldedSection>

      {/*
       * More fields - folded, like every form's: what most rules never
       * change. Its header names the options and shows the ones chosen.
       */}
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        icon={MORE_SECTION_ICON}
        description="Auto-resolve and remediation settings"
        items={moreFieldsItems}
        dataTestId="criteria-incident-more-fields"
      >
        <div className="space-y-4">
          <div>
            <Checkbox
              value={criteriaIncident.autoResolveIncident || false}
              title="Auto Resolve Incident"
              description="Automatically resolve this incident when this criteria is no longer met"
              onChange={(value: boolean) => {
                updateField("autoResolveIncident", value);
              }}
            />
          </div>

          <div>
            <Checkbox
              value={criteriaIncident.showIncidentOnStatusPage !== false}
              title="Show Incident on Status Page"
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
              description="When enabled, only the incident's owner users and members of its owner teams (plus project admins and owners) can view this incident. Private incidents are automatically hidden from all status pages."
              onChange={(value: boolean) => {
                updateField("isPrivate", value);
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Remediation Notes"
              description={MonitorCriteriaTemplateCopy.incidentRemediationHelp}
            />
            <MarkdownEditor
              initialValue={criteriaIncident.remediationNotes || ""}
              templateVariables={templateVariableGroups}
              templateVariablesDescription={
                MonitorCriteriaTemplateCopy.incidentVariablesDescription
              }
              placeholder="Steps to resolve this incident..."
              onChange={(value: string) => {
                updateField("remediationNotes", value);
              }}
            />
          </div>
        </div>
      </FoldedSection>
    </div>
  );
};

export default MonitorCriteriaIncidentForm;
