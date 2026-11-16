import {
  getMonitorSecretAccessOptions,
  TranslateFunction,
} from "../../Pages/Monitor/Settings/MonitorSecretAccessFormFields";
import IncomingRequestSecret from "Common/Models/DatabaseModels/IncomingRequestSecret";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { INCOMING_REQUEST_SECRET_DEFAULT_ACCESS } from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "Common/Types/Monitor/MonitorSecretAccess";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * Which Incoming Request monitors accept an incoming request secret (issue
 * #8501), asked the way a monitor secret's access is
 * (MonitorSecretAccessFormFields), in the same words: one of three modes,
 * and the picker of that mode below it. A secret covers every monitor unless
 * it is limited, so the question starts on All monitors and folds away with
 * the secret's own value under More fields: only a project shared by tenants
 * needs it. The monitor picker lists Incoming Request monitors alone, the
 * only ones a secret is sent to.
 *
 * React-free, so App tests can read it without the Dashboard's react.
 */

type IsAccessFunction = (values: FormValues<IncomingRequestSecret>) => boolean;

export const isSpecificMonitorsAccess: IsAccessFunction = (
  values: FormValues<IncomingRequestSecret>,
): boolean => {
  return values.monitorAccess === MonitorSecretAccess.SpecificMonitors;
};

export const isMonitorsWithLabelsAccess: IsAccessFunction = (
  values: FormValues<IncomingRequestSecret>,
): boolean => {
  return values.monitorAccess === MonitorSecretAccess.MonitorsWithLabels;
};

export type GetIncomingRequestSecretAccessFormFieldsFunction = (data: {
  translate?: TranslateFunction | undefined;
  collapsibleSection?:
    | FormFieldCollapsibleSection<IncomingRequestSecret>
    | undefined;
}) => Array<ModelField<IncomingRequestSecret>>;

export const getIncomingRequestSecretAccessFormFields: GetIncomingRequestSecretAccessFormFieldsFunction =
  (data: {
    translate?: TranslateFunction | undefined;
    collapsibleSection?:
      | FormFieldCollapsibleSection<IncomingRequestSecret>
      | undefined;
  }): Array<ModelField<IncomingRequestSecret>> => {
    return [
      {
        field: {
          monitorAccess: true,
        },
        title: "Which monitors can use this secret?",
        // Set, so the form does not fall back to the column's API description.
        description: "You can change this at any time.",
        fieldType: FormFieldSchemaType.CardSelect,
        cardSelectSingleColumn: true,
        cardSelectOptions: getMonitorSecretAccessOptions(data.translate),
        // What every secret did before a secret could be limited.
        defaultValue: INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
        required: true,
        collapsibleSection: data.collapsibleSection,
      },
      {
        field: {
          monitors: true,
        },
        title: "Monitors",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: Monitor,
          labelField: "name",
          valueField: "_id",
          query: {
            monitorType: MonitorType.IncomingRequest,
          },
        },
        showIf: isSpecificMonitorsAccess,
        required: isSpecificMonitorsAccess,
        description: "These monitors can use this secret.",
        placeholder: "Select monitors",
        collapsibleSection: data.collapsibleSection,
      },
      {
        field: {
          labels: true,
        },
        title: "Labels",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: Label,
          labelField: "name",
          valueField: "_id",
        },
        showIf: isMonitorsWithLabelsAccess,
        required: isMonitorsWithLabelsAccess,
        description:
          "Monitors with at least one of these labels can use this secret.",
        placeholder: "Select labels",
        collapsibleSection: data.collapsibleSection,
      },
    ];
  };
