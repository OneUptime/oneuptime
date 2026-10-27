import { describe, expect, test } from "@jest/globals";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  MIN_SCANNED_FORMS,
  countFieldRows,
  scanFormFiles,
} from "../../Helpers/FormStepsScan";
import {
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_DESCRIPTION,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_TITLE,
  getOnCallPolicyCreateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicyCreateForm";
import { PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY } from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import {
  ESCALATION_RULE_NOTIFY_FIELD_KEY,
  getEscalationRuleNotifyPickerConfig,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleForm";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import { FIRST_RESPONDER_KEYS } from "../../../Types/OnCallDutyPolicy/FirstResponders";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
  isFormSectionConfigured,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  PeoplePickerKind,
  getPeoplePickerValueKeys,
} from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * "A new on-call policy pages someone from the start."
 *
 * Every form that creates an on-call policy asks who gets paged first, with
 * the escalation rule's Notify picker, and keeps to three rows: Name, that
 * question, and a folded Advanced section holding the description and the
 * labels - and, for a project's first policy only, a fourth: "Page this
 * policy for every new incident and alert" (EveryNewEventRules), still on
 * one page.
 * The picker hands the server the lists it reads
 * (OnCallDutyPolicyService.create): a form that asks the question and sends
 * keys the server does not read would make a policy that silently pages
 * nobody.
 *
 * Pinned on the form helper first, then on the project's forms as the
 * FormStepsScan detector reads them - so a second create form for policies,
 * written later, is held to the same.
 */

// packages/Common/Tests/App/Dashboard -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const POLICIES_PAGE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies.tsx";

const FIRST_RESPONDERS_TITLE: string = "Who gets paged first?";

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

/*
 * The Notify field's key as the helper writes it - a computed key, which the
 * scan reports as written.
 */
const NOTIFY_KEY_AS_WRITTEN: string = "ESCALATION_RULE_NOTIFY_FIELD_KEY";

type PolicyField = Field<OnCallDutyPolicy>;

function fieldKey(field: PolicyField): string {
  return Object.keys(field.field || {})[0] || "";
}

function buildFields(
  canAddEscalationRules: boolean,
  offerEveryNewEventRules: boolean = false,
): Array<PolicyField> {
  return getOnCallPolicyCreateFormFields({
    canAddEscalationRules: (): boolean => {
      return canAddEscalationRules;
    },
    offerEveryNewEventRules: (): boolean => {
      return offerEveryNewEventRules;
    },
  });
}

function everyNewEventRulesField(fields: Array<PolicyField>): PolicyField {
  const field: PolicyField | undefined = fields.find(
    (candidate: PolicyField): boolean => {
      return fieldKey(candidate) === PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY;
    },
  );

  if (!field) {
    throw new Error(
      "No 'Page this policy for every new incident and alert' field",
    );
  }

  return field;
}

function firstRespondersField(fields: Array<PolicyField>): PolicyField {
  const field: PolicyField | undefined = fields.find(
    (candidate: PolicyField): boolean => {
      return candidate.title === FIRST_RESPONDERS_TITLE;
    },
  );

  if (!field) {
    throw new Error("No first responders field");
  }

  return field;
}

describe("the create form's fields", () => {
  const fields: Array<PolicyField> = buildFields(true);

  test("are Name, who gets paged first, paging for everything new, then the description and labels", () => {
    expect(fields.map(fieldKey)).toEqual([
      "name",
      ESCALATION_RULE_NOTIFY_FIELD_KEY,
      PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
      "description",
      "labels",
    ]);
    expect(fields[0]!.required).toBe(true);
  });

  test("ask a new project's first policy to page for every new incident and alert, with a switch that starts on", () => {
    const field: PolicyField = everyNewEventRulesField(fields);

    expect(field.title).toBe(PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_TITLE);
    // It names the policy: under "Who gets paged first?", "it" could be anyone.
    expect(field.title).toBe(
      "Page this policy for every new incident and alert",
    );
    // What it does first, then why it matters, in the dialog's own words.
    expect(field.description).toBe(
      PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_DESCRIPTION,
    );
    expect(field.description).toBe(
      "Adds an on-call rule for incidents and one for alerts. A policy pages nobody until a rule or a monitor triggers it.",
    );
    expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(field.defaultValue).toBe(true);
    expect(field.required).toBe(false);
    // Sent to the server as misc data, under the key it reads.
    expect(field.overrideFieldKey).toBe(
      PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
    );
    expect(field.formOnly).toBeUndefined();
    expect(field.showEvenIfPermissionDoesNotExist).toBe(true);
    // Never folded away: it is what makes the policy page anyone.
    expect(field.collapsibleSection).toBeUndefined();
  });

  test("ask it only when the page offers it, read when the form is drawn", () => {
    let offered: boolean = false;

    const field: PolicyField = everyNewEventRulesField(
      getOnCallPolicyCreateFormFields({
        canAddEscalationRules: (): boolean => {
          return true;
        },
        offerEveryNewEventRules: (): boolean => {
          return offered;
        },
      }),
    );

    expect(field.showIf!({} as FormValues<OnCallDutyPolicy>)).toBe(false);

    offered = true;

    expect(field.showIf!({} as FormValues<OnCallDutyPolicy>)).toBe(true);
  });

  test("a form built without an offer never asks", () => {
    const field: PolicyField = everyNewEventRulesField(
      getOnCallPolicyCreateFormFields({
        canAddEscalationRules: (): boolean => {
          return true;
        },
      }),
    );

    expect(field.showIf!({} as FormValues<OnCallDutyPolicy>)).toBe(false);
    expect(
      everyNewEventRulesField(buildFields(true, true)).showIf!(
        {} as FormValues<OnCallDutyPolicy>,
      ),
    ).toBe(true);
  });

  test("ask who gets paged first with the escalation rule's Notify picker", () => {
    const field: PolicyField = firstRespondersField(fields);

    expect(field.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(field.peoplePicker).toEqual(getEscalationRuleNotifyPickerConfig());
    expect(
      field.peoplePicker!.kinds.map((entry: { kind: PeoplePickerKind }) => {
        return entry.kind;
      }),
    ).toEqual([
      PeoplePickerKind.OnCallSchedule,
      PeoplePickerKind.Team,
      PeoplePickerKind.User,
    ]);
    // The picker's own key is the form's, never sent.
    expect(field.formOnly).toBe(true);
    expect(field.description).toBe(
      "Paged as soon as this policy is triggered. You can add more escalation levels later.",
    );
  });

  test("write exactly the lists the server reads", () => {
    const field: PolicyField = firstRespondersField(fields);

    expect(getPeoplePickerValueKeys(field.peoplePicker!)).toEqual(
      FIRST_RESPONDER_KEYS,
    );
  });

  test("leave the question optional: nobody picked passes, as does somebody", () => {
    const field: PolicyField = firstRespondersField(fields);

    expect(field.required).toBe(false);
    expect(field.customValidation).toBeDefined();
    expect(field.customValidation!({} as FormValues<OnCallDutyPolicy>)).toBe(
      null,
    );
    expect(
      field.customValidation!({
        teams: ["0b000000-0000-4000-8000-000000000001"],
      } as unknown as FormValues<OnCallDutyPolicy>),
    ).toBe(null);
  });

  test("ask it only of someone who may add escalation rules", () => {
    expect(
      firstRespondersField(buildFields(true)).showIf!(
        {} as FormValues<OnCallDutyPolicy>,
      ),
    ).toBe(true);
    expect(
      firstRespondersField(buildFields(false)).showIf!(
        {} as FormValues<OnCallDutyPolicy>,
      ),
    ).toBe(false);
  });

  test("ask at the moment the form is drawn, not when it was built", () => {
    let allowed: boolean = false;

    const field: PolicyField = firstRespondersField(
      getOnCallPolicyCreateFormFields({
        canAddEscalationRules: (): boolean => {
          return allowed;
        },
      }),
    );

    expect(field.showIf!({} as FormValues<OnCallDutyPolicy>)).toBe(false);

    allowed = true;

    expect(field.showIf!({} as FormValues<OnCallDutyPolicy>)).toBe(true);
  });

  test("fold the description and the labels under one Advanced section", () => {
    const [name, firstResponders, everyNewEvent, description, labels] =
      fields as [
        PolicyField,
        PolicyField,
        PolicyField,
        PolicyField,
        PolicyField,
      ];

    expect(name.collapsibleSection).toBeUndefined();
    expect(firstResponders.collapsibleSection).toBeUndefined();
    expect(everyNewEvent.collapsibleSection).toBeUndefined();

    expect(description.collapsibleSection).toBeDefined();
    expect(description.collapsibleSection).toBe(labels.collapsibleSection);
    expect(description.collapsibleSection!.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(description.collapsibleSection!.title).toBe(
      MORE_FIELDS_SECTION_TITLE,
    );
    // Folded on Create, and says "Configured" rather than opening.
    expect(description.collapsibleSection!.openWhenConfigured).toBe(false);
  });

  test("the Advanced section says Configured once a description or a label is set", () => {
    const description: PolicyField = fields[3]!;
    const labels: PolicyField = fields[4]!;

    const configured: (values: Record<string, unknown>) => boolean = (
      values: Record<string, unknown>,
    ): boolean => {
      return isFormSectionConfigured<OnCallDutyPolicy>({
        section: description.collapsibleSection!,
        fields: [description, labels],
        values: values as FormValues<OnCallDutyPolicy>,
      });
    };

    expect(configured({})).toBe(false);
    expect(configured({ description: "Pages payments." })).toBe(true);
    expect(
      configured({ labels: ["0b000000-0000-4000-8000-000000000002"] }),
    ).toBe(true);
    // Picking first responders is not something hidden under Advanced.
    expect(
      configured({ teams: ["0b000000-0000-4000-8000-000000000001"] }),
    ).toBe(false);
    // Nor is paging for every new incident and alert.
    expect(
      configured({ [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: false }),
    ).toBe(false);
  });

  test("each form gets a section of its own", () => {
    expect(buildFields(true)[3]!.collapsibleSection).not.toBe(
      buildFields(true)[3]!.collapsibleSection,
    );
  });
});

describe("the project's forms", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  /*
   * A broken walk must not pass by finding nothing. The floors sit far below
   * today's counts: see MIN_SCANNED_FORMS.
   */
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
  });

  const policyCreateForms: Array<FormFacts> = forms.filter(
    (form: FormFacts): boolean => {
      return (
        form.modelType?.name === "OnCallDutyPolicy" &&
        form.hasCreateForm === true
      );
    },
  );

  test("one form creates on-call policies: the policies page's", () => {
    expect(
      policyCreateForms.map((form: FormFacts): string => {
        return form.file;
      }),
    ).toEqual([POLICIES_PAGE]);
  });

  test("every form that creates a policy asks who gets paged first, in three rows - four for a project's first policy - and no steps", () => {
    expect(policyCreateForms.length).toBeGreaterThan(0);

    for (const form of policyCreateForms) {
      expect({ form: form.label, reasons: form.uncountableReasons }).toEqual({
        form: form.label,
        reasons: [],
      });
      expect(form.hasSteps).toBe(false);
      expect(form.hasSummaryOnly).toBe(false);

      /*
       * Name, the question, "Page this policy for every new incident and
       * alert" (a new project's first policy only) and the folded Advanced
       * section.
       */
      expect(countFieldRows(form.fields)).toBe(4);
      expect(form.visibleFieldCount).toBe(4);

      const everyNewEvent: FormFieldFacts | undefined = form.fields.find(
        (field: FormFieldFacts): boolean => {
          return field.key === "PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY";
        },
      );

      expect(everyNewEvent).toBeDefined();
      // Asked only when the page offers it.
      expect(everyNewEvent!.isConditional).toBe(true);
      expect(everyNewEvent!.collapsibleSection).toBeUndefined();

      const question: FormFieldFacts | undefined = form.fields.find(
        (field: FormFieldFacts): boolean => {
          return field.title === FIRST_RESPONDERS_TITLE;
        },
      );

      expect(question).toBeDefined();
      expect(question!.fieldType).toBe(PEOPLE_PICKER_FIELD_TYPE);
      expect(question!.key).toBe(NOTIFY_KEY_AS_WRITTEN);
      // Asked only of someone who may add escalation rules.
      expect(question!.isConditional).toBe(true);
      expect(question!.collapsibleSection).toBeUndefined();
    }
  });

  test("the policies page's form folds the description and labels together", () => {
    const form: FormFacts = policyCreateForms.find(
      (candidate: FormFacts): boolean => {
        return candidate.file === POLICIES_PAGE;
      },
    )!;

    expect(
      form.fields.map((field: FormFieldFacts): string => {
        return field.key;
      }),
    ).toEqual([
      "name",
      NOTIFY_KEY_AS_WRITTEN,
      "PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY",
      "description",
      "labels",
    ]);

    const [name, question, everyNewEvent, description, labels] =
      form.fields as [
        FormFieldFacts,
        FormFieldFacts,
        FormFieldFacts,
        FormFieldFacts,
        FormFieldFacts,
      ];

    expect(name.collapsibleSection).toBeUndefined();
    expect(question.collapsibleSection).toBeUndefined();
    expect(everyNewEvent.collapsibleSection).toBeUndefined();
    expect(description.collapsibleSection).toBeDefined();
    expect(labels.collapsibleSection).toBe(description.collapsibleSection);
  });
});
