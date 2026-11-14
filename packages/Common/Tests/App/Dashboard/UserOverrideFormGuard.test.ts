// UX rule: Docs/ux/README.md#ask-only-what-you-cannot-work-out
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
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

/*
 * "Adding an on-call override asks who is away and who covers, in plain
 * words, starting now." A user override's overrideUserId is the person whose
 * pages are rerouted - the one who is away - and routeAlertsToUserId the
 * person who gets them (OnCallDutyPolicyEscalationRuleService.
 * getRouteAlertToUserId, UserOverrideUtil). The Add User Override form used
 * to ask for the first one as "Override User - Select the user who will
 * override the on-call duty", which says the opposite, so an override could
 * be set up backwards and page the person on leave.
 *
 * This guard keeps every form that saves a user override, in every
 * frontend, asking the right question for each column:
 *
 *   - overrideUserId (or its overrideUser relation) is asked as "Who is
 *     away?", routeAlertsToUserId (or routeAlertsToUser) as "Who covers?",
 *     each with a people picker - never under the columns' own titles or
 *     a dropdown of their own;
 *   - the form is the one dialog of an override (UserOverrideFormModal),
 *     one page of four rows: Who is away?, Who covers?, Starts, Ends. It
 *     adds one, from the User Overrides tables, and edits one (issue
 *     #7631), from each of their rows and from a schedule's active
 *     overrides card - the tables' own create and edit forms are not used.
 *     The same four rows are the ones "Skip until..." on a person in a
 *     schedule layer opens (SkipLayerUserModal), which only ever adds. For a
 *     reader whose permission covers only some policies it asks one thing
 *     more, below the four, when the server allows several of the
 *     schedule's policies: "On-call policies", which to add the skip on,
 *     each ticked - a choice of the form's own, never sent as a column.
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

const TABLE_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTable.tsx";

// The one dialog that adds an override from the tables, and edits one.
const DIALOG_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideFormModal.tsx";

// A schedule's active overrides card: Edit on each of its rows.
const ACTIVE_OVERRIDES_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard.tsx";

/*
 * "Skip until..." on a person in a schedule layer: the same form, opened with
 * them away and the rotation covering (task oncall-skip-user-until).
 */
const SKIP_MODAL_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal.tsx";

const FORM_FILE_SUFFIX: string =
  "Components/OnCallPolicy/UserOverrides/UserOverrideForm.ts";

const OVERRIDE_MODEL_FILE: string =
  "packages/Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride.ts";

const OVERRIDE_MODEL_NAME: string = "OnCallDutyPolicyUserOverride";

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

// The question each person column must be asked with.
const QUESTION_BY_KEY: Record<string, string> = {
  overrideUserId: "Who is away?",
  overrideUser: "Who is away?",
  routeAlertsToUserId: "Who covers?",
  routeAlertsToUser: "Who covers?",
};

function isOverrideForm(form: FormFacts): boolean {
  if (!form.modelType) {
    return false;
  }

  if (form.modelType.file) {
    return form.modelType.file === OVERRIDE_MODEL_FILE;
  }

  return form.modelType.name === OVERRIDE_MODEL_NAME;
}

interface WrongQuestion {
  form: FormFacts;
  field: FormFieldFacts;
  expected: string;
}

/*
 * Fields of a form that saves a user override which ask for one of its two
 * people with anything but that person's question and a people picker.
 */
function findWrongQuestions(forms: Array<FormFacts>): Array<WrongQuestion> {
  const found: Array<WrongQuestion> = [];

  for (const form of forms) {
    if (!isOverrideForm(form)) {
      continue;
    }

    for (const field of form.fields) {
      const expected: string | undefined = QUESTION_BY_KEY[field.key];

      if (!expected || field.isNeverShown) {
        continue;
      }

      if (
        field.title !== expected ||
        field.fieldType !== PEOPLE_PICKER_FIELD_TYPE
      ) {
        found.push({ form, field, expected });
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

const MODEL_IMPORT: string = `import ${OVERRIDE_MODEL_NAME} from "Common/Models/DatabaseModels/${OVERRIDE_MODEL_NAME}";`;

// The form as it was: the columns' own titles, in dropdowns, over two steps.
const OLD_FORM: string = `
  ${MODEL_IMPORT}
  const Page = () => <ModelTable modelType={${OVERRIDE_MODEL_NAME}} name="On-Call Policy > User Overrides" isCreateable={true} formSteps={[{ title: "Users", id: "users" }, { title: "Time Window", id: "time-window" }]} formFields={[
    { field: { overrideUser: true }, title: "Override User", stepId: "users", description: "Select the user who will override the on-call duty.", fieldType: FormFieldSchemaType.Dropdown, required: true },
    { field: { routeAlertsToUser: true }, title: "Route Alerts To User", stepId: "users", fieldType: FormFieldSchemaType.Dropdown, required: true },
    { field: { startsAt: true }, title: "Starts At", stepId: "time-window", fieldType: FormFieldSchemaType.DateTime, required: true },
    { field: { endsAt: true }, title: "Ends At", stepId: "time-window", fieldType: FormFieldSchemaType.DateTime, required: true },
  ]} />;`;

const FORM_HELPER: string = `
  export const getUserOverrideFormFields = (options) => {
    return [
      { field: { overrideUserId: true }, title: "Who is away?", fieldType: FormFieldSchemaType.PeoplePicker, peoplePicker: getUserOverrideAwayPickerConfig(), required: true, defaultValue: options.currentUserId },
      { field: { routeAlertsToUserId: true }, title: "Who covers?", fieldType: FormFieldSchemaType.PeoplePicker, peoplePicker: getUserOverrideCoverPickerConfig(), required: true },
      { field: { startsAt: true }, title: "Starts", fieldType: FormFieldSchemaType.DateTime, required: true, getDefaultValue: () => now() },
      { field: { endsAt: true }, title: "Ends", fieldType: FormFieldSchemaType.DateTime, required: true },
    ];
  };`;

describe("the user override question detector", () => {
  test("finds the old form's inverted 'Override User' and its 'Route Alerts To User' dropdowns", () => {
    const forms: Array<FormFacts> = scanSnippet({ "Page.tsx": OLD_FORM });

    expect(forms).toHaveLength(1);
    expect(forms[0]!.hasSteps).toBe(true);
    expect(
      findWrongQuestions(forms).map((found: WrongQuestion): string => {
        return `${found.field.title} -> ${found.expected}`;
      }),
    ).toEqual([
      "Override User -> Who is away?",
      "Route Alerts To User -> Who covers?",
    ]);
  });

  test("finds the questions swapped round, which is the mistake this is about", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        ${MODEL_IMPORT}
        const Page = () => <ModelTable modelType={${OVERRIDE_MODEL_NAME}} name="Overrides" isCreateable={true} formFields={[
          { field: { overrideUserId: true }, title: "Who covers?", fieldType: FormFieldSchemaType.PeoplePicker },
          { field: { routeAlertsToUserId: true }, title: "Who is away?", fieldType: FormFieldSchemaType.PeoplePicker },
        ]} />;`,
    });

    expect(findWrongQuestions(forms)).toHaveLength(2);
  });

  test("finds the right question asked with a plain dropdown", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        ${MODEL_IMPORT}
        const Page = () => <ModelTable modelType={${OVERRIDE_MODEL_NAME}} name="Overrides" isCreateable={true} formFields={[
          { field: { overrideUserId: true }, title: "Who is away?", fieldType: FormFieldSchemaType.Dropdown },
        ]} />;`,
    });

    expect(findWrongQuestions(forms)).toHaveLength(1);
  });

  test("leaves the questions the form asks now alone", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        ${MODEL_IMPORT}
        import { getUserOverrideFormFields } from "./UserOverrideForm";
        const Page = () => <ModelTable modelType={${OVERRIDE_MODEL_NAME}} name="On-Call Policy > User Overrides" isCreateable={true} formFields={getUserOverrideFormFields({ currentUserId: me })} />;`,
      "UserOverrideForm.ts": FORM_HELPER,
    });

    expect(forms).toHaveLength(1);
    expect(forms[0]!.fields).toHaveLength(4);
    expect(findWrongQuestions(forms)).toEqual([]);
  });

  test("looks only at forms that save a user override", () => {
    const forms: Array<FormFacts> = scanSnippet({
      "Page.tsx": `
        import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
        const Page = () => <ModelTable modelType={IncomingCallPolicyEscalationRule} name="Rules" isCreateable={true} formFields={[
          { field: { overrideUserId: true }, title: "Override User", fieldType: FormFieldSchemaType.Dropdown },
        ]} />;`,
    });

    expect(forms).toHaveLength(1);
    expect(findWrongQuestions(forms)).toEqual([]);
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

  const overrideForms: Array<FormFacts> = forms.filter(isOverrideForm);

  /*
   * A broken walk must not pass by finding nothing. The floors sit far below
   * today's counts: see MIN_SCANNED_FORMS.
   */
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
  });

  test("ask for the person away as 'Who is away?' and the cover as 'Who covers?'", () => {
    expect(
      findWrongQuestions(forms).map((found: WrongQuestion): string => {
        return `${found.field.file}:${found.field.line} ${found.form.label} - "${found.field.title}" should be "${found.expected}"`;
      }),
    ).toEqual([]);
  });

  test("save a user override only in its one dialog, and from Skip until... on a person in a layer", () => {
    expect(
      overrideForms
        .map((form: FormFacts): string => {
          return `${form.file} ${form.label}`;
        })
        .sort(),
    ).toEqual(
      [
        `${DIALOG_FILE} ModelFormModal: On-Call Policy > User Overrides`,
        `${SKIP_MODAL_FILE} ModelFormModal: Skip in the rotation`,
      ].sort(),
    );
  });

  test("the User Overrides tables open the one dialog for Add and for each row's Edit, as a schedule's active overrides card does", () => {
    const table: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, TABLE_FILE),
      "utf8",
    );

    // The table's own forms are not used: Add and Edit open the dialog.
    expect(table).toContain("onCreateClick={");
    expect(table).toContain("isEditable={false}");
    expect(table).toContain("<UserOverrideFormModal");
    expect(table).toContain('title: "Edit",');

    expect(
      fs.readFileSync(
        path.join(REPOSITORY_ROOT, ACTIVE_OVERRIDES_FILE),
        "utf8",
      ),
    ).toContain("<UserOverrideFormModal");
  });

  describe.each([
    ["the User Override dialog", DIALOG_FILE],
    ["Skip until... on a person in a layer", SKIP_MODAL_FILE],
  ])("%s", (_name: string, file: string) => {
    const form: FormFacts | undefined = overrideForms.find(
      (candidate: FormFacts): boolean => {
        return candidate.file === file;
      },
    );

    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );

    if (file === DIALOG_FILE) {
      test("adds an override, and edits one", () => {
        expect(form).toBeDefined();
        /*
         * Which of the two it is depends on how it is opened, so the
         * scanner cannot say it never adds (null is "it may").
         */
        expect(form!.hasCreateForm).not.toBe(false);
        expect(form!.hasEditForm).toBe(true);
        expect(source).toContain(
          "formType: editTarget ? FormType.Update : FormType.Create",
        );
        expect(source).toContain("modelIdToEdit={");
        // An edit never sends who is away, the policy or the project.
        expect(source).toContain("prepareUserOverrideForUpdate(item, {");
      });
    } else {
      test("adds overrides, and nothing edits them", () => {
        expect(form).toBeDefined();
        expect(form!.hasCreateForm).toBe(true);

        /*
         * The scanner counts any dialog as one that may edit; this one only
         * ever creates.
         */
        expect(source).toContain("formType: FormType.Create");
        expect(source).not.toContain("modelIdToEdit");
        expect(source).not.toContain("FormType.Update");
      });
    }

    // The Skip dialog's own question, below the four: see the top of the file.
    const ownRows: number = file === SKIP_MODAL_FILE ? 1 : 0;

    test("is one page of four rows", () => {
      expect(form!.uncountableReasons).toEqual([]);
      expect(form!.hasSteps).toBe(false);
      expect(form!.hasSummaryOnly).toBe(false);
      expect(countFieldRows(form!.fields)).toBe(4 + ownRows);
      expect(countFormRows(form!)).toBe(4 + ownRows);
      expect(form!.visibleFieldCount).toBe(4 + ownRows);
    });

    test("asks who is away, who covers, then when it starts and ends", () => {
      expect(
        form!.fields.slice(0, 4).map((field: FormFieldFacts): Array<string> => {
          return [field.key, field.title, field.fieldType];
        }),
      ).toEqual([
        ["overrideUserId", "Who is away?", PEOPLE_PICKER_FIELD_TYPE],
        ["routeAlertsToUserId", "Who covers?", PEOPLE_PICKER_FIELD_TYPE],
        ["startsAt", "Starts", "FormFieldSchemaType.DateTime"],
        ["endsAt", "Ends", "FormFieldSchemaType.DateTime"],
      ]);

      for (const field of form!.fields) {
        expect(field.collapsibleSection).toBeUndefined();
        expect(field.stepId).toBeUndefined();
      }
    });

    if (file === SKIP_MODAL_FILE) {
      test("asks, below them, on which of the policies offered to add the skip - a choice of its own", () => {
        expect(
          form!.fields.slice(4).map((field: FormFieldFacts): Array<string> => {
            return [field.key, field.title, field.fieldType, field.file];
          }),
        ).toEqual([
          [
            "SKIP_POLICIES_FIELD_KEY",
            "On-call policies",
            "FormFieldSchemaType.CategoryCheckbox",
            SKIP_MODAL_FILE,
          ],
        ]);

        // Never sent as a column: what is saved is one override per policy.
        expect(source).toContain("formOnly: true");
      });
    }

    test("starts with the person away and the start filled in, and the end left empty", () => {
      const byKey: Record<string, FormFieldFacts> = {};

      for (const field of form!.fields) {
        byKey[field.key] = field;
      }

      expect(byKey["overrideUserId"]!.hasDefault).toBe(true);
      expect(byKey["routeAlertsToUserId"]!.hasDefault).toBe(false);
      expect(byKey["startsAt"]!.hasDefault).toBe(true);
      expect(byKey["endsAt"]!.hasDefault).toBe(false);
    });

    test("takes its fields from the one helper", () => {
      expect(
        form!.fields.slice(0, 4).every((field: FormFieldFacts): boolean => {
          return field.file.endsWith(FORM_FILE_SUFFIX);
        }),
      ).toBe(true);
    });
  });
});
