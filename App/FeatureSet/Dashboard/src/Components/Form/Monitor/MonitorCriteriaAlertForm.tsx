import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
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

export interface ComponentProps {
  initialValue?: undefined | CriteriaAlert;
  onChange?: undefined | ((value: CriteriaAlert) => void);
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  monitorType?: MonitorType | undefined;
  seriesAttributeKeys?: Array<string> | undefined;
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

  const updateField: <K extends keyof CriteriaAlert>(
    field: K,
    value: CriteriaAlert[K],
  ) => void = <K extends keyof CriteriaAlert>(
    field: K,
    value: CriteriaAlert[K],
  ): void => {
    setCriteriaAlert({
      ...criteriaAlert,
      [field]: value,
    });
  };

  const titleInputId: string = useId();
  const [isTitleTouched, setIsTitleTouched] = useState<boolean>(false);
  const ownerCount: number =
    (criteriaAlert.ownerTeamIds?.length || 0) +
    (criteriaAlert.ownerUserIds?.length || 0);
  const detailSummary: string =
    [
      criteriaAlert.description ? "Description" : "",
      ownerCount ? `${ownerCount} owner${ownerCount === 1 ? "" : "s"}` : "",
      criteriaAlert.labelIds?.length
        ? `${criteriaAlert.labelIds.length} label${criteriaAlert.labelIds.length === 1 ? "" : "s"}`
        : "",
      criteriaAlert.isPrivate ? "Private" : "",
      criteriaAlert.remediationNotes ? "Remediation notes" : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Optional";

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
            title="Alert title"
            htmlFor={titleInputId}
            description={templateDocsLink}
            required={true}
          />
          <Input
            id={titleInputId}
            value={criteriaAlert.title}
            onBlur={() => {
              setIsTitleTouched(true);
            }}
            error={
              isTitleTouched && !criteriaAlert.title?.trim()
                ? "Alert title is required"
                : undefined
            }
            placeholder="e.g., {{monitorName}} is degraded"
            onChange={(value: string) => {
              updateField("title", value);
            }}
          />
        </div>

        <div>
          <FieldLabelElement title="Severity" required={true} />
          <Dropdown
            ariaLabel="Alert severity"
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

      <div>
        <FieldLabelElement
          title="Notify on-call"
          description="Select the on-call policies to notify."
        />
        <Dropdown
          ariaLabel="Alert on-call policies"
          value={props.onCallPolicyDropdownOptions.filter(
            (i: DropdownOption) => {
              return criteriaAlert.onCallPolicyIds?.some((id: ObjectID) => {
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
        ariaLabel="Auto-resolve alert"
        value={criteriaAlert.autoResolveAlert || false}
        title="Auto-resolve alert"
        description="Resolve automatically when this rule no longer matches."
        onChange={(value: boolean) => {
          updateField("autoResolveAlert", value);
        }}
      />

      <CollapsibleSection
        title="Alert details"
        badge={detailSummary}
        defaultCollapsed={true}
      >
        <div className="space-y-5 border-t border-gray-200 pt-4">
          {/* Description */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">Description</h4>
            <div>
              <FieldLabelElement
                title="Alert Description"
                description={
                  <span>Description for the alert. {templateDocsLink}</span>
                }
              />
              <MarkdownEditor
                initialValue={criteriaAlert.description || ""}
                placeholder="Describe the alert..."
                onChange={(value: string) => {
                  updateField("description", value);
                }}
              />
            </div>
          </section>

          {/* Ownership & Labels */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Owners and labels
            </h4>
            <div className="space-y-4">
              <div>
                <FieldLabelElement
                  title="Owner Teams"
                  description="Teams that will own and be notified about this alert"
                />
                <Dropdown
                  ariaLabel="Alert owner teams"
                  value={props.teamDropdownOptions.filter(
                    (i: DropdownOption) => {
                      return criteriaAlert.ownerTeamIds?.some(
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
                  description="Users that will own and be notified about this alert"
                />
                <Dropdown
                  ariaLabel="Alert owner users"
                  value={props.userDropdownOptions.filter(
                    (i: DropdownOption) => {
                      return criteriaAlert.ownerUserIds?.some(
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
                  description="Labels to categorize the alert"
                />
                <Dropdown
                  ariaLabel="Alert labels"
                  value={props.labelDropdownOptions.filter(
                    (i: DropdownOption) => {
                      return criteriaAlert.labelIds?.some((id: ObjectID) => {
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
                  value={criteriaAlert.isPrivate === true}
                  title="Private Alert"
                  ariaLabel="Private Alert"
                  description="When enabled, only the alert's owner users and members of its owner teams (plus project admins and owners) can view this alert."
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
          </section>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default MonitorCriteriaAlertForm;
