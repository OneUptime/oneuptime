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
 *   - the form is the User Overrides table's, one page of four rows: Who is
 *     away?, Who covers?, Starts, Ends.
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

  test("save a user override only on the User Overrides table", () => {
    expect(
      overrideForms.map((form: FormFacts): string => {
        return `${form.file} ${form.label}`;
      }),
    ).toEqual([`${TABLE_FILE} ModelTable: On-Call Policy > User Overrides`]);
  });

  describe("the Add User Override form", () => {
    const form: FormFacts | undefined = overrideForms.find(
      (candidate: FormFacts): boolean => {
        return candidate.file === TABLE_FILE;
      },
    );

    test("adds overrides, and nothing edits them", () => {
      expect(form).toBeDefined();
      expect(form!.hasCreateForm).toBe(true);
      expect(form!.hasEditForm).toBe(false);
    });

    test("is one page of four rows", () => {
      expect(form!.uncountableReasons).toEqual([]);
      expect(form!.hasSteps).toBe(false);
      expect(form!.hasSummaryOnly).toBe(false);
      expect(countFieldRows(form!.fields)).toBe(4);
      expect(countFormRows(form!)).toBe(4);
      expect(form!.visibleFieldCount).toBe(4);
    });

    test("asks who is away, who covers, then when it starts and ends", () => {
      expect(
        form!.fields.map((field: FormFieldFacts): Array<string> => {
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
        form!.fields.every((field: FormFieldFacts): boolean => {
          return field.file.endsWith(FORM_FILE_SUFFIX);
        }),
      ).toBe(true);
    });
  });
});
