import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { getEscalationRuleNotifyFormField } from "./EscalationRule/EscalationRuleForm";
import { PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY } from "Common/Types/OnCallDutyPolicy/EveryNewEventRules";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SelectFormFields from "Common/UI/Types/SelectEntityField";

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
 *
 * A project's first policy is asked one more thing: "Page this policy for
 * every new incident and alert", on to start with. A policy pages nobody
 * until an on-call rule or a monitor triggers it, and a new project has
 * neither - so the first policy someone made from the Home checklist paged
 * nobody, and the step said it was done. With it on, the server adds an
 * on-call rule for incidents and one for alerts naming the policy
 * (EveryNewEventRules). A later policy is asked it too, off to start with
 * (#7371): its dialog used to hide the switch with nothing in its place, so
 * a second policy was saved paging nobody, and nothing said so. Four rows,
 * still one page: a step for one switch would be the longer way.
 *
 * Its words: the label names the policy ("this policy", never "it", which
 * under "Who gets paged first?" could be anyone), and the description says
 * first what the switch does, then why it matters - in the dialog's own
 * word for running a policy ("triggered", as "Who gets paged first?" says).
 */

export const PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_TITLE: string =
  translationKey("Page this policy for every new incident and alert");

export const PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_DESCRIPTION: string =
  translationKey(
    "Adds an on-call rule for incidents and one for alerts. A policy pages nobody until a rule or a monitor triggers it.",
  );

export interface OnCallPolicyCreateFormOptions {
  /*
   * Whether the user may add escalation rules. The first responders become
   * the policy's first rule, created as the user; without that permission
   * the question is not asked and the form is what it was.
   */
  canAddEscalationRules: () => boolean;
  /*
   * Whether to offer "Page this policy for every new incident and alert",
   * to someone who may add on-call rules: a project's first policy, and a
   * later one (getEveryNewEventRulesOfferKind). Read when the form is drawn.
   * Left out, it is never offered.
   */
  offerEveryNewEventRules?: (() => boolean) | undefined;
  /*
   * Whether the switch starts on: on for a first policy, off for a later
   * one (doesEveryNewEventRulesOfferStartOn). Its default, so the page
   * builds the fields again when the answer changes. Left out, it starts on.
   */
  everyNewEventRulesStartsOn?: boolean | undefined;
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
      placeholder: "e.g., Platform on-call",
      // The title says it; the column's "Any friendly name of this object" adds nothing.
      hideColumnDescription: true,
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
      /*
       * Not an OnCallDutyPolicy column: the switch is sent as misc data,
       * which OnCallDutyPolicyService.create reads. The page also drops it
       * from the request whenever it is not offered (onBeforeCreate), so a
       * switch that is on but hidden asks for nothing.
       */
      field: {
        [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true,
      } as SelectFormFields<OnCallDutyPolicy>,
      overrideFieldKey: PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
      showEvenIfPermissionDoesNotExist: true,
      title: PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_TITLE,
      description: PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_DESCRIPTION,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      /*
       * On for a first policy, off for a later one: paging two policies for
       * every new incident and alert is a choice to make, not a default.
       */
      defaultValue: options.everyNewEventRulesStartsOn !== false,
      showIf: (): boolean => {
        return Boolean(options.offerEveryNewEventRules?.());
      },
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Description",
      hideColumnDescription: true,
      collapsibleSection: advanced,
    },
    getLabelsFormField<OnCallDutyPolicy>({
      collapsibleSection: advanced,
    }),
  ];
};
