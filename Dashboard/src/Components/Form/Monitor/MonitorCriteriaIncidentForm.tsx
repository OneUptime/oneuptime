import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Incident from "Common/Models/DatabaseModels/Incident";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";

export interface ComponentProps {
  initialValue?: undefined | CriteriaIncident;
  onChange?: undefined | ((value: CriteriaIncident) => void);
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  // onDelete?: undefined | (() => void);
}

const MonitorCriteriaIncidentForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedFields, setShowAdvancedFields] =
    React.useState<boolean>(false);

  useEffect(() => {
    if (props.initialValue && props.initialValue.remediationNotes) {
      setShowAdvancedFields(true);
    }
  }, [props.initialValue]);

  return (
    <div className="mt-4">
      <BasicForm
        modelType={Incident}
        hideSubmitButton={true}
        initialValues={props.initialValue}
        onChange={(values: FormValues<CriteriaIncident>) => {
          props.onChange?.(values as CriteriaIncident);
        }}
        disableAutofocus={true}
        fields={[
          {
            field: {
              title: true,
            },
            title: "Incident Title",
            fieldType: FormFieldSchemaType.Text,
            stepId: "incident-details",
            required: true,
            placeholder: "Incident Title",
            validation: {
              minLength: 2,
            },
            description: (
              <p>
                You can use dynamic templates here.{" "}
                <Link
                  to={new Route("/docs/monitor/incident-alert-templating")}
                  openInNewTab={true}
                  className="underline text-blue-600"
                >
                  Please refer to the documentation for more information.
                </Link>
              </p>
            ),
          },
          {
            field: {
              description: true,
            },
            title: "Incident Description",
            stepId: "incident-details",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            placeholder: "Description",
            description: (
              <p>
                You can use dynamic templates here.{" "}
                <Link
                  to={new Route("/docs/monitor/incident-alert-templating")}
                  openInNewTab={true}
                  className="underline text-blue-600"
                >
                  Please refer to the documentation for more information.
                </Link>
              </p>
            ),
          },
          {
            field: {
              incidentSeverityId: true,
            },
            title: "Incident Severity",
            stepId: "incident-details",
            description: "What type of incident is this?",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: props.incidentSeverityDropdownOptions,
            required: true,
            placeholder: "Incident Severity",
            id: "incident-severity",
          },
          {
            field: {
              onCallPolicyIds: true,
            },
            title: "On-Call Policy",
            stepId: "incident-details",
            description:
              "Execute these on-call policies when this incident is created.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.onCallPolicyDropdownOptions,
            required: false,
            placeholder: "Select On-Call Policies",
          },
          {
            field: {
              autoResolveIncident: true,
            },
            title: "Auto Resolve Incident",
            stepId: "incident-details",
            description:
              "Automatically resolve this incident when this criteria is no longer met.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              remediationNotes: true,
            },
            title: "Remediation Notes",
            stepId: "incident-details",
            description: (
              <p>
                Notes for on-call engineer to resolve this incident. You can use
                dynamic templates here.{" "}
                <Link
                  to={new Route("/docs/monitor/incident-alert-templating")}
                  openInNewTab={true}
                  className="underline text-blue-600"
                >
                  Please refer to the documentation for more information.
                </Link>
              </p>
            ),
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            showIf: () => {
              return showAdvancedFields;
            },
          },
        ]}
      />

      {!showAdvancedFields && (
        <Button
          title="Add Remediation Notes for an engineer to help resolve this incident."
          onClick={() => {
            return setShowAdvancedFields(true);
          }}
          className="-ml-3"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
        />
      )}

      {/* <div className='mt-4'>
                <Button
                    onClick={() => {
                        if (props.onDelete) {
                            props.onDelete();
                        }
                    }}
                    title="Delete"
                />
            </div> */}
    </div>
  );
};

export default MonitorCriteriaIncidentForm;
