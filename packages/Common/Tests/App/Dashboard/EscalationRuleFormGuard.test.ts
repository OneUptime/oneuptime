// UX rule: Docs/ux/README.md#ask-only-what-you-cannot-work-out
import { describe, expect, test } from "@jest/globals";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  MIN_SCANNED_FORMS,
  SourceFileSystem,
  countFieldRows,
  scanFormFiles,
} from "../../Helpers/FormStepsScan";
import {
  ESCALATION_RULE_NOTIFY_FIELD_KEY,
  ESCALATION_RULE_PAGED_AFTER_KEY,
  getEscalationRuleFormFields,
  readPagedAfterInMinutes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleForm";
import OnCallDutyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * "Adding an escalation rule is one short step: who to notify, and how long
 * before escalating." The add and edit dialogs of an on-call policy's
 * escalation rules used to be a three-step wizard - a required name, three
 * dropdowns (on-call schedules, teams, users) for the one question "who gets
 * paged?", and an empty required wait. This guard keeps them one short page,
 * across the frontends:
 *
 *   - no form asks for an escalation rule's on-call schedules with a field of
 *     their own: responders are picked with the Notify people picker
 *     (getEscalationRuleNotifyFormField), which writes the onCallSchedules,
 *     teams and users lists itself;
 *   - the escalation page's add and edit dialogs have no steps and at most
 *     three rows: Notify, the wait, and one folded Advanced section holding
 *     the name and the description. The wait is "Escalate after", or - on a
 *     new rule after the first - "Paged after", when the new level is paged,
 *     saved as the wait of the level before it (#7373).
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

const ESCALATION_RULES_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules.tsx";

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

// The list of an escalation rule's on-call schedules, as the form writes it.
const RESPONDER_SCHEDULES_KEY: string = "onCallSchedules";

// Fields that ask for a rule's on-call schedules on their own.
function findScheduleDropdowns(
  forms: Array<FormFacts>,
): Array<{ form: FormFacts; field: FormFieldFacts }> {
  const found: Array<{ form: FormFacts; field: FormFieldFacts }> = [];

  for (const form of forms) {
    for (const field of form.fields) {
      if (
        !field.isNeverShown &&
        field.key === RESPONDER_SCHEDULES_KEY &&
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

const NOTIFY_HELPER: string = `
  export const ESCALATION_RULE_NOTIFY_FIELD_KEY = "notify";
  export const getEscalationRuleNotifyFormField = (options) => {
    return {
      title: "Notify",
      required: true,
      ...options,
      field: { [ESCALATION_RULE_NOTIFY_FIELD_KEY]: true },
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getEscalationRuleNotifyPickerConfig(),
      formOnly: true,
    };
  };`;

describe("the escalation responder detector", () => {
  test("finds the old three dropdowns, by the schedules list they write", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        const Page = () => <ModelFormModal name="Create Escalation Rule" formProps={{ steps: [{ title: "Notify", id: "notification" }], fields: [
          { overrideField: { onCallSchedules: true }, overrideFieldKey: "onCallSchedules", title: "On-Call Schedules", stepId: "notification", fieldType: FormFieldSchemaType.MultiSelectDropdown },
          { overrideField: { teams: true }, overrideFieldKey: "teams", title: "Teams", stepId: "notification", fieldType: FormFieldSchemaType.MultiSelectDropdown },
          { overrideField: { users: true }, overrideFieldKey: "users", title: "Users", stepId: "notification", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ] }} />;`,
    });

    expect(
      findScheduleDropdowns(forms).map(
        (found: { field: FormFieldFacts }): string => {
          return found.field.title;
        },
      ),
    ).toEqual(["On-Call Schedules"]);
  });

  test("leaves the Notify picker alone", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        import { getEscalationRuleNotifyFormField } from "./EscalationRuleForm";
        const Page = () => <ModelFormModal name="Create Escalation Rule" formProps={{ fields: [
          getEscalationRuleNotifyFormField({}),
          { field: { escalateAfterInMinutes: true }, title: "Escalate after (in minutes)", fieldType: FormFieldSchemaType.Number },
        ] }} />;`,
      "EscalationRuleForm.ts": NOTIFY_HELPER,
    });

    expect(findScheduleDropdowns(forms)).toEqual([]);
    expect(forms[0]?.fields[0]?.fieldType).toBe(PEOPLE_PICKER_FIELD_TYPE);
    expect(forms[0]?.fields[0]?.title).toBe("Notify");
  });
});

/*
 * The two waits a dialog asks, by the key the helper writes them under: a
 * rule's own "Escalate after", or a new rule's "Paged after" (#7373), as the
 * scan reads the helper (ESCALATION_RULE_PAGED_AFTER_KEY, a computed key,
 * reported as written).
 */
const WAIT_KEYS: Array<string> = [
  "escalateAfterInMinutes",
  "ESCALATION_RULE_PAGED_AFTER_KEY",
];

type RuleField = Field<OnCallDutyEscalationRule>;

function fieldKey(field: RuleField): string {
  return Object.keys(field.field || {})[0] || "";
}

describe("the wait each dialog asks (#7373)", () => {
  const BACKUP: { name: string; escalateAfterInMinutes: number } = {
    name: "Backup",
    escalateAfterInMinutes: 10,
  };

  test("a new rule after the first asks when it is paged, from the level before's wait, never sent with the rule", () => {
    const fields: Array<RuleField> =
      getEscalationRuleFormFields<OnCallDutyEscalationRule>({
        level: 3,
        previousLevel: BACKUP,
      });

    expect(fields.map(fieldKey)).toEqual([
      ESCALATION_RULE_NOTIFY_FIELD_KEY,
      ESCALATION_RULE_PAGED_AFTER_KEY,
      "name",
      "description",
    ]);

    const pagedAfter: RuleField = fields[1]!;

    expect(pagedAfter.title).toBe("Paged after (in minutes)");
    expect(pagedAfter.defaultValue).toBe(10);
    expect(pagedAfter.formOnly).toBe(true);
    expect(pagedAfter.fieldType).toBe(FormFieldSchemaType.Number);
    expect(pagedAfter.collapsibleSection).toBeUndefined();
  });

  test("the first rule, an edit, and a new rule nobody may save on the level before ask Escalate after", () => {
    for (const options of [
      { level: 1 },
      { level: 2, isEditing: true, previousLevel: BACKUP },
      { level: 3 },
    ]) {
      const fields: Array<RuleField> =
        getEscalationRuleFormFields<OnCallDutyEscalationRule>(options);

      expect(fieldKey(fields[1]!)).toBe("escalateAfterInMinutes");
      expect(fields[1]!.title).toBe("Escalate after (in minutes)");
    }
  });

  test("an answer is read as whole minutes, or as none", () => {
    expect(readPagedAfterInMinutes({ pagedAfterInMinutes: 5 })).toBe(5);
    expect(readPagedAfterInMinutes({ pagedAfterInMinutes: "15" })).toBe(15);
    expect(readPagedAfterInMinutes({ pagedAfterInMinutes: 0 })).toBe(0);
    expect(readPagedAfterInMinutes({ pagedAfterInMinutes: -1 })).toBeNull();
    expect(readPagedAfterInMinutes({ pagedAfterInMinutes: "" })).toBeNull();
    expect(readPagedAfterInMinutes({})).toBeNull();
    expect(readPagedAfterInMinutes(null)).toBeNull();
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

  test("ask for an escalation rule's on-call schedules only with the Notify picker", () => {
    expect(
      findScheduleDropdowns(forms).map(
        (found: { form: FormFacts; field: FormFieldFacts }): string => {
          return `${found.field.file}:${found.field.line} ${found.form.label} - "${found.field.title}"`;
        },
      ),
    ).toEqual([]);
  });

  describe("the escalation page's add and edit dialogs", () => {
    const dialogs: Array<FormFacts> = forms.filter(
      (form: FormFacts): boolean => {
        return form.file === ESCALATION_RULES_FILE;
      },
    );

    test("are both found", () => {
      expect(
        dialogs.map((form: FormFacts): string => {
          return form.label;
        }),
      ).toEqual([
        "ModelFormModal: Create Escalation Rule",
        "ModelFormModal: Edit Escalation Rule",
      ]);
    });

    test.each([
      "ModelFormModal: Create Escalation Rule",
      "ModelFormModal: Edit Escalation Rule",
    ])("%s is one short step", (label: string) => {
      const form: FormFacts = dialogs.find((candidate: FormFacts): boolean => {
        return candidate.label === label;
      })!;

      expect(form.uncountableReasons).toEqual([]);
      expect(form.hasSteps).toBe(false);
      expect(form.hasSummaryOnly).toBe(false);

      // Notify, the wait, and the folded Advanced section.
      expect(countFieldRows(form.fields)).toBe(3);
      expect(form.visibleFieldCount).toBe(3);

      expect(
        form.fields.map((field: FormFieldFacts): string => {
          return field.fieldType;
        }),
      ).toEqual([
        PEOPLE_PICKER_FIELD_TYPE,
        "FormFieldSchemaType.Number",
        "FormFieldSchemaType.Text",
        "FormFieldSchemaType.LongText",
      ]);

      const [notify, wait, name, description] = form.fields as [
        FormFieldFacts,
        FormFieldFacts,
        FormFieldFacts,
        FormFieldFacts,
      ];

      expect(notify.title).toBe("Notify");
      expect(notify.collapsibleSection).toBeUndefined();
      // Either wait, as the scan reads the helper's choice (#7373).
      expect(WAIT_KEYS).toContain(wait.key);
      expect(wait.collapsibleSection).toBeUndefined();

      // The name and the description, folded together.
      expect(name.key).toBe("name");
      expect(description.key).toBe("description");
      expect(name.collapsibleSection).toBeDefined();
      expect(description.collapsibleSection).toBe(name.collapsibleSection);
    });
  });
});
