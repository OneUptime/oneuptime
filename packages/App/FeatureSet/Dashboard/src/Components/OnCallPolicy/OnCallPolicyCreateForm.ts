import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { getEscalationRuleNotifyFormField } from "./EscalationRule/EscalationRuleForm";

/*
 * CREATE ON-CALL POLICY: A NEW POLICY PAGES SOMEONE FROM THE START.
 *
 * The form used to ask for a name, a description and labels, and the policy
 * it made paged nobody until its first escalation rule had been added on its
 * Escalation Rules page - which a new user had to find first. It now asks the
 * two things that make a policy work, and folds the rest away:
 *
 *   - Name.
 *   - Who gets paged first? The Notify picker of an escalation rule (on-call
 *     schedules, teams and people in one list), optional. Whoever is picked
 *     becomes the policy's first escalation rule, Level 1, which waits 30
 *     minutes for an acknowledgement before the next level: the server adds
 *     it with the policy (OnCallDutyPolicyService.create). Left empty, the
 *     policy is created without rules, as before.
 *   - Advanced, folded: the description and the labels.
 *
 * Three rows, so no steps. React-free, so tests can read the fields without
 * rendering the page.
 */

export interface OnCallPolicyCreateFormOptions {
  /*
   * Whether the user may add escalation rules. The first responders become
   * the policy's first rule, created as the user; without that permission
   * the question is not asked and the form is what it was.
   */
  canAddEscalationRules: () => boolean;
}

export const getOnCallPolicyCreateFormFields: (
  options: OnCallPolicyCreateFormOptions,
) => Array<Field<OnCallDutyPolicy>> = (
  options: OnCallPolicyCreateFormOptions,
): Array<Field<OnCallDutyPolicy>> => {
  const advanced: FormFieldCollapsibleSection<OnCallDutyPolicy> =
    getAdvancedFormSection<OnCallDutyPolicy>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "On-Call Duty Name",
      validation: {
        minLength: 2,
      },
    },
    getEscalationRuleNotifyFormField<OnCallDutyPolicy>({
      title: "Who gets paged first?",
      description:
        "Paged as soon as this policy is triggered. You can add more escalation levels later.",
      required: false,
      showIf: (): boolean => {
        return options.canAddEscalationRules();
      },
    }),
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Description",
      collapsibleSection: advanced,
    },
    getLabelsFormField<OnCallDutyPolicy>({
      collapsibleSection: advanced,
    }),
  ];
};
