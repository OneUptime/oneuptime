import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  SourceFileSystem,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "We have this owner's team and owner's user literally everywhere in the
 * project ... Instead of having two different dropdowns, can we make the UI
 * like we have in the incident ... owners page ... Wherever you find this
 * two-dropdown thing in the form, we have to replace that with that
 * particular field." - the maintainer, on the 'Owner - Teams' and 'Owner -
 * Users' dropdowns of the Create New Incident Template dialog.
 *
 * Every form that asks for owners now asks with one people picker
 * (getOwnersFormField, or OwnersPicker outside a form), and every page that
 * lists them shows one Owners card. This guard keeps it that way across the
 * frontends and Common's UI:
 *
 *   - no form has a field that writes an owner list (ownerTeams, ownerUsers,
 *     alertOwnerTeams, ownerTeamIds...) other than a people picker - so a
 *     teams dropdown and a users dropdown can never come back as a pair;
 *   - no page lists owners as an "Owners (Teams)" and an "Owners (Users)"
 *     table;
 *   - the old labels are gone from the source.
 *
 * The detector is pinned on inline snippets first, then run over the real
 * tree with checks that it really read it.
 */

// packages/Common/Tests/UI/Components/PeoplePicker -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

// A form value holding a list of owner teams or owner users.
const OWNER_LIST_KEY: RegExp = /^(?:\w*O|o)wner(?:Team|User)(?:s|Ids)$/;

// The labels of the two-dropdown and two-table owners, in any surface.
const RETIRED_LABELS: Array<string> = [
  "Owner - Teams",
  "Owner - Users",
  "Owner Teams",
  "Owner Users",
  "Owners (Teams)",
  "Owners (Users)",
  "Alert Owner Teams",
  "Alert Owner Users",
  "Incident Owner Teams",
  "Incident Owner Users",
];

// A table of one owner junction model: half of the old two-table owners.
const OWNER_TABLE: RegExp = /<ModelTable<\s*\w+Owner(?:Team|User)\s*>/;

const OWNER_DROPDOWN_COMMENT_FREE: (code: string) => string = (
  code: string,
): string => {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, " ");
};

interface OwnerDropdown {
  form: FormFacts;
  field: FormFieldFacts;
}

// Fields that write an owner list without being a people picker.
function findOwnerDropdowns(forms: Array<FormFacts>): Array<OwnerDropdown> {
  const found: Array<OwnerDropdown> = [];

  for (const form of forms) {
    for (const field of form.fields) {
      if (field.isNeverShown) {
        continue;
      }

      if (
        OWNER_LIST_KEY.test(field.key) &&
        field.fieldType !== PEOPLE_PICKER_FIELD_TYPE
      ) {
        found.push({ form, field });
      }
    }
  }

  return found;
}

function describeDropdown(dropdown: OwnerDropdown): string {
  return `${dropdown.field.file}:${dropdown.field.line} ${dropdown.form.label} - "${dropdown.field.title}" (${dropdown.field.key}) is not the owners people picker`;
}

function peoplePickers(forms: Array<FormFacts>): Array<FormFieldFacts> {
  return forms.flatMap((form: FormFacts): Array<FormFieldFacts> => {
    return form.fields.filter((field: FormFieldFacts): boolean => {
      return field.fieldType === PEOPLE_PICKER_FIELD_TYPE;
    });
  });
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

function only(files: Record<string, string>): FormFacts {
  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

const OWNERS_HELPER: string = `
  export const OWNERS_FORM_FIELD_KEY = "owners";
  const getOwnersFormField = (options) => {
    const { fieldKey, teamsKey, usersKey, ...rest } = options;
    return {
      title: "Owners",
      required: false,
      ...rest,
      field: { [fieldKey || OWNERS_FORM_FIELD_KEY]: true },
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getOwnersPeoplePickerConfig({ teamsKey, usersKey }),
      formOnly: true,
    };
  };
  export default getOwnersFormField;`;

const STEPS: string = `[{ title: "Rule", id: "rule" }, { title: "Owners", id: "owners" }]`;

describe("the owner dropdown detector", () => {
  test("finds the old pair of owner dropdowns on a rule", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <RuleTable name="Settings > Monitor Owner Rules" formSteps={${STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          { field: { ownerTeams: true }, title: "Owner Teams", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown, dropdownModal: { type: Team, labelField: "name", valueField: "_id" } },
          { field: { ownerUsers: true }, title: "Owner Users", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ]} />;`,
    });

    expect(
      findOwnerDropdowns([form]).map((dropdown: OwnerDropdown): string => {
        return dropdown.field.key;
      }),
    ).toEqual(["ownerTeams", "ownerUsers"]);
    expect(describeDropdown(findOwnerDropdowns([form])[0]!)).toContain(
      '"Owner Teams" (ownerTeams) is not the owners people picker',
    );
  });

  test("finds owners sent as misc data through an overrideFieldKey", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelTable name="Settings > Incident Templates" formSteps={${STEPS}} formFields={[
          { field: { templateName: true }, title: "Template Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          { overrideField: { ownerTeams: true }, overrideFieldKey: "ownerTeams", showEvenIfPermissionDoesNotExist: true, title: "Owner - Teams", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown },
          { overrideField: { ownerUsers: true }, overrideFieldKey: "ownerUsers", showEvenIfPermissionDoesNotExist: true, title: "Owner - Users", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ]} />;`,
    });

    expect(
      findOwnerDropdowns([form]).map((dropdown: OwnerDropdown): string => {
        return dropdown.field.title;
      }),
    ).toEqual(["Owner - Teams", "Owner - Users"]);
  });

  test("finds every spelling of an owner list: prefixed, and as ids", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <BasicFormModal title="Edit Settings" formProps={{ fields: [
          { field: { alertOwnerTeams: true }, title: "Alert Owner Teams", fieldType: FormFieldSchemaType.MultiSelectDropdown },
          { field: { ownerUserIds: true }, title: "Owner Users", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ] }} />;`,
    });

    expect(
      findOwnerDropdowns([form]).map((dropdown: OwnerDropdown): string => {
        return dropdown.field.key;
      }),
    ).toEqual(["alertOwnerTeams", "ownerUserIds"]);
  });

  test("a single owner dropdown is one too: owners are people and teams", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelFormModal title="Owners" formProps={{ fields: [
          { field: { ownerTeams: true }, title: "Teams", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ] }} />;`,
    });

    expect(findOwnerDropdowns([form])).toHaveLength(1);
  });

  test("leaves the owners people picker alone, on its step", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./OwnersFormField";
        const Page = () => <RuleTable name="Settings > Monitor Owner Rules" formSteps={${STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          getOwnersFormField({ stepId: "owners", description: "Who owns it." }),
        ]} />;`,
      "OwnersFormField.ts": OWNERS_HELPER,
    });

    expect(findOwnerDropdowns([form])).toEqual([]);

    const pickers: Array<FormFieldFacts> = peoplePickers([form]);

    expect(pickers).toHaveLength(1);
    expect(pickers[0]?.stepId).toBe("owners");
    expect(pickers[0]?.title).toBe("Owners");
  });

  test("leaves a picker that keeps owners under other names alone", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./OwnersFormField";
        const Page = () => <ModelTable name="SLO > Burn Rate Rules" formSteps={${STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          getOwnersFormField({ fieldKey: "alertOwners", usersKey: "alertOwnerUsers", teamsKey: "alertOwnerTeams", title: "Alert Owners", stepId: "owners" }),
        ]} />;`,
      "OwnersFormField.ts": OWNERS_HELPER,
    });

    expect(findOwnerDropdowns([form])).toEqual([]);
    expect(peoplePickers([form])[0]?.title).toBe("Alert Owners");
  });

  test("leaves a registration that is never shown alone", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelForm id="form" fields={[
          { field: { title: true }, title: "Title", fieldType: FormFieldSchemaType.Text },
          { field: { ownerTeams: true }, title: "", fieldType: FormFieldSchemaType.Text, showIf: () => { return false; } },
        ]} />;`,
    });

    expect(findOwnerDropdowns([form])).toEqual([]);
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

  // A broken walk must not pass by finding nothing.
  test("are really read, owner pickers included", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.length).toBeGreaterThan(500);
    /*
     * 30 owner rule forms, the two templates, scheduling maintenance, alert
     * episodes, the two owner pickers of a burn rate rule and the Forms On
     * Submit settings.
     */
    expect(peoplePickers(forms).length).toBeGreaterThanOrEqual(37);
  });

  test("ask for owners only with the owners people picker", () => {
    expect(findOwnerDropdowns(forms).map(describeDropdown)).toEqual([]);
  });

  test("every owner rule form asks for its owners with one picker, on its Owners step", () => {
    const ownerRulesLabel: RegExp = / Owner Rules$/;
    const ownerRuleForms: Array<FormFacts> = forms.filter(
      (form: FormFacts): boolean => {
        return ownerRulesLabel.test(form.label);
      },
    );

    expect(ownerRuleForms.length).toBeGreaterThanOrEqual(30);

    for (const form of ownerRuleForms) {
      const pickers: Array<FormFieldFacts> = peoplePickers([form]);

      expect({
        form: `${form.file} ${form.label}`,
        pickers: pickers.map((field: FormFieldFacts): string => {
          return `${field.title} on ${field.stepId}`;
        }),
      }).toEqual({
        form: `${form.file} ${form.label}`,
        pickers: ["Owners on owners"],
      });
    }
  });

  /*
   * The template's owners used to walk an Owners step of their own; with
   * labels-not-a-step they fold under Advanced at the end of Incident
   * Details, beside the labels, as a maintenance template's do on Event.
   */
  test("the incident template asks for owners with one picker, folded on Incident Details", () => {
    const template: FormFacts | undefined = forms.find(
      (form: FormFacts): boolean => {
        return (
          form.file.endsWith(
            "Pages/Incidents/Settings/IncidentTemplates.tsx",
          ) && form.host === "ModelTable"
        );
      },
    );

    expect(template).toBeDefined();

    expect(
      peoplePickers([template!]).map((field: FormFieldFacts): string => {
        return `${field.title}: ${field.fieldType} on ${field.stepId}, folded: ${field.collapsibleSection !== undefined}`;
      }),
    ).toEqual([
      `Owners: ${PEOPLE_PICKER_FIELD_TYPE} on incident-details, folded: true`,
    ]);
    expect(
      (template!.steps || []).map((step: FormStepFacts): string | null => {
        return step.id;
      }),
    ).not.toContain("owners");
  });
});

describe("the project's source", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const sources: Array<{ file: string; code: string }> = files.map(
    (file: string) => {
      return {
        file: path.relative(REPOSITORY_ROOT, file),
        code: OWNER_DROPDOWN_COMMENT_FREE(fs.readFileSync(file, "utf8")),
      };
    },
  );

  test("says none of the retired owner labels", () => {
    const hits: Array<string> = [];

    for (const label of RETIRED_LABELS) {
      const quoted: RegExp = new RegExp(
        `(["'\`>])${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'\`<])`,
      );

      for (const source of sources) {
        if (quoted.test(source.code)) {
          hits.push(`${source.file}: "${label}"`);
        }
      }
    }

    expect(hits).toEqual([]);
  });

  test("lists owners in one Owners card, never in a table per kind", () => {
    expect(
      sources
        .filter((source: { file: string; code: string }): boolean => {
          return OWNER_TABLE.test(source.code);
        })
        .map((source: { file: string; code: string }): string => {
          return source.file;
        }),
    ).toEqual([]);
  });

  test("the guards themselves tell a hit from a miss", () => {
    expect(OWNER_TABLE.test("<ModelTable<ProbeOwnerTeam>")).toBe(true);
    expect(OWNER_TABLE.test("<ModelTable<ProbeOwnerRule>")).toBe(false);
    expect(OWNER_LIST_KEY.test("ownerTeams")).toBe(true);
    expect(OWNER_LIST_KEY.test("incidentOwnerUsers")).toBe(true);
    expect(OWNER_LIST_KEY.test("ownerTeamIds")).toBe(true);
    expect(OWNER_LIST_KEY.test("owners")).toBe(false);
    expect(OWNER_LIST_KEY.test("defaultAssignToTeam")).toBe(false);
    expect(OWNER_LIST_KEY.test("ownerTeam")).toBe(false);
  });
});
