import { describe, expect, test } from "@jest/globals";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  MIN_SCANNED_FORMS,
  SourceFileSystem,
  countFieldRows,
  countFormRows,
  scanFormFiles,
} from "../../Helpers/FormStepsScan";
import {
  getIncomingCallEscalationRuleFormFields,
  getIncomingCallRuleTargetPickerConfig,
  INCOMING_CALL_RULE_SCHEDULE_KEY,
  INCOMING_CALL_RULE_USER_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/IncomingCallEscalationRuleForm";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  PeoplePickerFieldConfig,
  PeoplePickerFieldKind,
  PeoplePickerKind,
} from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * "Adding an incoming-call escalation rule is one short step: who to call
 * and how long to ring." An incoming call policy's escalation rules used to
 * be added with a three-step wizard - Overview (a name and a description),
 * Notification (a "Notify" dropdown of two choices, then a dropdown of
 * on-call schedules or one of users) and Escalation (one number). This guard
 * keeps the rule's form one short page, in every frontend:
 *
 *   - no form asks for whom an incoming call rule calls with dropdowns of
 *     its own: the target is picked with the one "Who to call" people
 *     picker, which writes the rule's onCallDutyPolicyScheduleId or userId
 *     column itself;
 *   - the escalation rules page's add and edit form has no steps and three
 *     rows: Who to call, Ring for, and one folded Advanced section holding
 *     the name and the description;
 *   - the picker offers on-call schedules and people - not teams, which a
 *     rule cannot call - and takes one pick.
 *
 * The detector is pinned on inline snippets first, then run over the real
 * tree with checks that it really read it.
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

const ESCALATION_PAGE_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Escalation.tsx";

const RULE_MODEL_FILE: string =
  "packages/Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule.ts";

const RULE_MODEL_NAME: string = "IncomingCallPolicyEscalationRule";

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

/*
 * The keys a rule's target used to be asked with: its two columns, and the
 * old "Notify" dropdown that chose between them.
 */
const TARGET_KEYS: Array<string> = [
  "userId",
  "onCallDutyPolicyScheduleId",
  "notifyType",
];

function isRuleForm(form: FormFacts): boolean {
  if (!form.modelType) {
    return false;
  }

  if (form.modelType.file) {
    return form.modelType.file === RULE_MODEL_FILE;
  }

  return form.modelType.name === RULE_MODEL_NAME;
}

// Fields that ask for a rule's target with a control of their own.
function findTargetDropdowns(
  forms: Array<FormFacts>,
): Array<{ form: FormFacts; field: FormFieldFacts }> {
  const found: Array<{ form: FormFacts; field: FormFieldFacts }> = [];

  for (const form of forms) {
    if (!isRuleForm(form)) {
      continue;
    }

    for (const field of form.fields) {
      if (
        !field.isNeverShown &&
        TARGET_KEYS.includes(field.key) &&
        field.fieldType !== PEOPLE_PICKER_FIELD_TYPE
      ) {
        found.push({ form, field });
      }
    }
  }

  return found;
}

const VIRTUAL_ROOT: string = "/repo";

function virtualFileSystem(files: Record<string, string>): SourceFileSystem {
  return {
    readFile: (filePath: string): string | null => {
      const relative: string = path
        .relative(VIRTUAL_ROOT, filePath)
        .split(path.sep)
        .join("/");

      return Object.prototype.hasOwnProperty.call(files, relative)
        ? (files[relative] as string)
        : null;
    },
  };
}

function scanSnippet(files: Record<string, string>): Array<FormFacts> {
  return scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });
}

const RULE_IMPORT: string = `import ${RULE_MODEL_NAME} from "Common/Models/DatabaseModels/${RULE_MODEL_NAME}";`;

const FORM_HELPER: string = `
  export const getIncomingCallRuleTargetFormField = (options) => {
    return {
      title: "Who to call",
      required: true,
      ...options,
      field: { whoToCall: true },
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getIncomingCallRuleTargetPickerConfig(),
      formOnly: true,
    };
  };
  export const getIncomingCallEscalationRuleFormFields = (options) => {
    const advanced = getAdvancedFormSection({});
    return [
      getIncomingCallRuleTargetFormField(),
      { field: { escalateAfterSeconds: true }, title: "Ring for (in seconds)", fieldType: FormFieldSchemaType.Number, required: true },
      { field: { name: true }, title: "Name", fieldType: FormFieldSchemaType.Text, collapsibleSection: advanced },
      { field: { description: true }, title: "Description", fieldType: FormFieldSchemaType.LongText, collapsibleSection: advanced },
    ];
  };`;

describe("the incoming call rule target detector", () => {
  test("finds the old Notify dropdown and the schedule and user dropdowns it switched between", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        ${RULE_IMPORT}
        const Page = () => <ModelTable modelType={${RULE_MODEL_NAME}} name="Incoming Call Policy > Escalation Rules" isCreateable={true} formSteps={[{ title: "Overview", id: "overview" }, { title: "Notification", id: "notification" }, { title: "Escalation", id: "escalation" }]} formFields={[
          { field: { name: true }, title: "Rule Name", stepId: "overview", fieldType: FormFieldSchemaType.Text },
          { overrideField: { notifyType: true }, overrideFieldKey: "notifyType", title: "Notify", stepId: "notification", fieldType: FormFieldSchemaType.Dropdown },
          { field: { onCallDutyPolicyScheduleId: true }, title: "On-Call Schedule", stepId: "notification", fieldType: FormFieldSchemaType.Dropdown },
          { field: { userId: true }, title: "User", stepId: "notification", fieldType: FormFieldSchemaType.Dropdown },
          { field: { escalateAfterSeconds: true }, title: "Escalate After (Seconds)", stepId: "escalation", fieldType: FormFieldSchemaType.Number },
        ]} />;`,
    });

    expect(forms).toHaveLength(1);
    expect(forms[0]!.hasSteps).toBe(true);
    expect(
      findTargetDropdowns(forms).map(
        (found: { field: FormFieldFacts }): string => {
          return found.field.title;
        },
      ),
    ).toEqual(["Notify", "On-Call Schedule", "User"]);
  });

  test("leaves the Who to call picker alone", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        ${RULE_IMPORT}
        import { getIncomingCallEscalationRuleFormFields } from "./IncomingCallEscalationRuleForm";
        const Page = () => <ModelTable modelType={${RULE_MODEL_NAME}} name="Incoming Call Policy > Escalation Rules" isCreateable={true} formFields={getIncomingCallEscalationRuleFormFields({ level: 1 })} />;`,
      "IncomingCallEscalationRuleForm.ts": FORM_HELPER,
    });

    expect(forms).toHaveLength(1);
    expect(findTargetDropdowns(forms)).toEqual([]);
    expect(forms[0]!.fields[0]?.fieldType).toBe(PEOPLE_PICKER_FIELD_TYPE);
    expect(forms[0]!.fields[0]?.title).toBe("Who to call");
  });

  test("looks only at forms that save an incoming call rule", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
        const Page = () => <ModelTable modelType={UserNotificationRule} name="Rules" isCreateable={true} formFields={[
          { field: { userId: true }, title: "User", fieldType: FormFieldSchemaType.Dropdown },
        ]} />;`,
    });

    expect(forms).toHaveLength(1);
    expect(findTargetDropdowns(forms)).toEqual([]);
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

  const ruleForms: Array<FormFacts> = forms.filter(isRuleForm);

  /*
   * A broken walk must not pass by finding nothing. The floors sit far below
   * today's counts: see MIN_SCANNED_FORMS.
   */
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
  });

  test("ask whom an incoming call rule calls only with the Who to call picker", () => {
    expect(
      findTargetDropdowns(forms).map(
        (found: { form: FormFacts; field: FormFieldFacts }): string => {
          return `${found.field.file}:${found.field.line} ${found.form.label} - "${found.field.title}"`;
        },
      ),
    ).toEqual([]);
  });

  test("save an incoming call rule only on its escalation rules page", () => {
    expect(
      ruleForms.map((form: FormFacts): string => {
        return `${form.file} ${form.label}`;
      }),
    ).toEqual([
      `${ESCALATION_PAGE_FILE} ModelTable: Incoming Call Policy > Escalation Rules`,
    ]);
  });

  describe("the escalation rules page's add and edit form", () => {
    const form: FormFacts | undefined = ruleForms.find(
      (candidate: FormFacts): boolean => {
        return candidate.file === ESCALATION_PAGE_FILE;
      },
    );

    test("adds and edits rules", () => {
      expect(form).toBeDefined();
      expect(form!.hasCreateForm).toBe(true);
      expect(form!.hasEditForm).toBe(true);
    });

    test("is one short step", () => {
      expect(form!.uncountableReasons).toEqual([]);
      expect(form!.hasSteps).toBe(false);
      expect(form!.hasSummaryOnly).toBe(false);

      // Who to call, Ring for, and the folded Advanced section.
      expect(countFieldRows(form!.fields)).toBe(3);
      expect(countFormRows(form!)).toBe(3);
      expect(form!.visibleFieldCount).toBe(3);
    });

    test("asks who to call, then how long to ring, with the name and the description folded", () => {
      expect(
        form!.fields.map((field: FormFieldFacts): string => {
          return field.fieldType;
        }),
      ).toEqual([
        PEOPLE_PICKER_FIELD_TYPE,
        "FormFieldSchemaType.Number",
        "FormFieldSchemaType.Text",
        "FormFieldSchemaType.LongText",
      ]);

      const [target, ring, name, description] = form!.fields as [
        FormFieldFacts,
        FormFieldFacts,
        FormFieldFacts,
        FormFieldFacts,
      ];

      expect(target.title).toBe("Who to call");
      expect(target.collapsibleSection).toBeUndefined();
      expect(target.isCreateOnly).toBe(false);
      expect(target.isEditOnly).toBe(false);

      expect(ring.key).toBe("escalateAfterSeconds");
      expect(ring.title).toBe("Ring for (in seconds)");
      expect(ring.collapsibleSection).toBeUndefined();

      expect(name.key).toBe("name");
      expect(description.key).toBe("description");
      expect(name.collapsibleSection).toBeDefined();
      expect(description.collapsibleSection).toBe(name.collapsibleSection);
    });

    test("takes its fields from the one helper", () => {
      expect(
        form!.fields.every((field: FormFieldFacts): boolean => {
          return field.file.endsWith("IncomingCallEscalationRuleForm.ts");
        }),
      ).toBe(true);
    });
  });
});

describe("the Who to call picker", () => {
  const config: PeoplePickerFieldConfig =
    getIncomingCallRuleTargetPickerConfig();

  test("offers on-call schedules, then people, and nothing else", () => {
    expect(
      config.kinds.map((entry: PeoplePickerFieldKind): PeoplePickerKind => {
        return entry.kind;
      }),
    ).toEqual([PeoplePickerKind.OnCallSchedule, PeoplePickerKind.User]);
  });

  test("takes one pick", () => {
    expect(config.isSinglePick).toBe(true);
  });

  test("writes each pick to the rule's own column for it", () => {
    expect(
      config.kinds.map((entry: PeoplePickerFieldKind): string => {
        return entry.valueKey;
      }),
    ).toEqual([INCOMING_CALL_RULE_SCHEDULE_KEY, INCOMING_CALL_RULE_USER_KEY]);

    const rule: IncomingCallPolicyEscalationRule =
      new IncomingCallPolicyEscalationRule();

    for (const entry of config.kinds) {
      expect(rule.hasColumn(entry.valueKey)).toBe(true);
    }
  });

  test("is the first field of the form, add and edit alike", () => {
    for (const isEditing of [false, true]) {
      const fields: Array<Field<IncomingCallPolicyEscalationRule>> =
        getIncomingCallEscalationRuleFormFields<IncomingCallPolicyEscalationRule>(
          { level: 2, isEditing: isEditing },
        );

      expect(fields[0]!.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
      expect(fields[0]!.peoplePicker).toEqual(config);
      expect(
        fields.filter((field: Field<IncomingCallPolicyEscalationRule>) => {
          return field.fieldType === FormFieldSchemaType.PeoplePicker;
        }),
      ).toHaveLength(1);
    }
  });
});
