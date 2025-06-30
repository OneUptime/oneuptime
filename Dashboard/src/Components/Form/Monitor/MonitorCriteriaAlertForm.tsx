import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  initialValue?: undefined | CriteriaAlert;
  onChange?: undefined | ((value: CriteriaAlert) => void);
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  // onDelete?: undefined | (() => void);
}

const MonitorCriteriaAlertForm: FunctionComponent<ComponentProps> = (
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
        modelType={Alert}
        hideSubmitButton={true}
        initialValues={props.initialValue}
        onChange={(values: FormValues<CriteriaAlert>) => {
          props.onChange?.(values as CriteriaAlert);
        }}
        disableAutofocus={true}
        fields={[
          {
            field: {
              title: true,
            },
            title: "Alert Title",
            fieldType: FormFieldSchemaType.Text,
            stepId: "alert-details",
            required: true,

            placeholder: "Alert Title",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Alert Description",
            stepId: "alert-details",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              alertSeverityId: true,
            },
            title: "Alert Severity",
            stepId: "alert-details",
            description: "What type of alert is this?",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: props.alertSeverityDropdownOptions,
            required: true,
            placeholder: "Alert Severity",
            id: "alert-severity",
          },
          {
            field: {
              onCallPolicyIds: true,
            },
            title: "On-Call Policy",
            stepId: "alert-details",
            description:
              "Execute these on-call policies when this alert is created.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.onCallPolicyDropdownOptions,

            required: false,
            placeholder: "Select On-Call Policies",
          },
          {
            field: {
              autoResolveAlert: true,
            },
            title: "Auto Resolve Alert",
            stepId: "alert-details",
            description:
              "Automatically resolve this alert when this criteria is no longer met.",
            fieldType: FormFieldSchemaType.Toggle,

            required: false,
          },
          {
            field: {
              remediationNotes: true,
            },
            title: "Remediation Notes",
            stepId: "alert-details",
            description:
              "Notes to help the on-call engineer resolve this alert.",
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
          title="Add Remediation Notes for an engineer to help resolve this alert."
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

export default MonitorCriteriaAlertForm;
