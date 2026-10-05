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
 *     the name and the description.
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
      expect(wait.key).toBe("escalateAfterInMinutes");
      expect(wait.collapsibleSection).toBeUndefined();

      // The name and the description, folded together.
      expect(name.key).toBe("name");
      expect(description.key).toBe("description");
      expect(name.collapsibleSection).toBeDefined();
      expect(description.collapsibleSection).toBe(name.collapsibleSection);
    });
  });
});
