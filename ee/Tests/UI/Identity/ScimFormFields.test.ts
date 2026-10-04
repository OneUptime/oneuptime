import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PROJECT_SCIM_ADVANCED_DEFAULTS_SUMMARY,
  PROJECT_SCIM_AUTO_DEPROVISION_DESCRIPTION,
  SCIM_AUTO_PROVISION_DESCRIPTION,
  SCIM_DEFAULT_TEAMS_DESCRIPTION,
  SCIM_DESCRIPTION_DESCRIPTION,
  SCIM_NAME_DESCRIPTION,
  SCIM_PUSH_GROUPS_DESCRIPTION,
  STATUS_PAGE_SCIM_ADVANCED_DEFAULTS_SUMMARY,
  STATUS_PAGE_SCIM_AUTO_DEPROVISION_DESCRIPTION,
  getProjectScimFormFields,
  getScimAdvancedSection,
  getStatusPageScimFormFields,
  isScimAdvancedAtDefaults,
  isScimDefaultTeamsShown,
  withoutHiddenScimDefaultTeams,
} from "../../../Dashboard/Identity/ScimFormFields";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import {
  FormFacts,
  FormFieldFacts,
  countFormRows,
  scanFormFiles,
} from "Common/Tests/Helpers/FormStepsScan";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * Adding a SCIM connection asks only for what OneUptime cannot work out.
 *
 * A SCIM connection gives the identity provider an address and a bearer
 * token, both made by OneUptime once the connection is saved - nothing comes
 * from the identity provider. The project's form walked three steps (Basic
 * Info, Configuration, Teams) and the status page's two, with three
 * checkboxes that drew unticked while their columns save them ticked, and
 * Default Teams with nothing picked, so people provisioned without push
 * groups joined no team. Both forms are now one page (ScimFormFields):
 *
 *   Project      Name, Default Teams (the members team to start with), and
 *                one folded More fields section: Auto Provision Users (on),
 *                Auto Deprovision Users (on), Enable Push Groups (off) and
 *                the description.
 *   Status page  Name, and one folded More fields section: Auto Provision
 *                Users (on), Auto Deprovision Users (on) and the
 *                description.
 *
 * These pin the builder, then read the two pages the way the form guards
 * read every form (Common/Tests/Helpers/FormStepsScan) - the Common job runs
 * without ee/, so the Enterprise screens are held to the shape here.
 */

// ee/Tests/UI/Identity -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const PROJECT_PAGE: string = "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx";
const STATUS_PAGE_PAGE: string =
  "ee/Dashboard/Identity/Pages/StatusPages/SCIM.tsx";
const BUILDER: string = "ee/Dashboard/Identity/ScimFormFields.ts";

function keyOf<TEntity>(field: Field<TEntity>): string {
  return Object.keys(field.field || {})[0] || "";
}

function fieldFor<TEntity>(
  fields: Array<Field<TEntity>>,
  key: string,
): Field<TEntity> {
  const found: Field<TEntity> | undefined = fields.find(
    (field: Field<TEntity>): boolean => {
      return keyOf(field) === key;
    },
  );

  if (!found) {
    throw new Error(`No ${key} field`);
  }

  return found;
}

const PROJECT_FIELDS: Array<Field<ProjectSCIM>> = getProjectScimFormFields();
const STATUS_PAGE_FIELDS: Array<Field<StatusPageSCIM>> =
  getStatusPageScimFormFields();

describe("the project's SCIM form", () => {
  test("asks for the name and the teams newcomers join; the rest is folded", () => {
    expect(PROJECT_FIELDS.map(keyOf)).toEqual([
      "name",
      "teams",
      "autoProvisionUsers",
      "autoDeprovisionUsers",
      "enablePushGroups",
      "description",
    ]);

    for (const key of ["name", "teams"]) {
      expect([key, fieldFor(PROJECT_FIELDS, key).collapsibleSection]).toEqual([
        key,
        undefined,
      ]);
    }

    const section: FormFieldCollapsibleSection<ProjectSCIM> | undefined =
      fieldFor(PROJECT_FIELDS, "autoProvisionUsers").collapsibleSection;

    expect(section?.title).toBe(MORE_FIELDS_SECTION_TITLE);
    expect(section?.openWhenConfigured).toBe(false);

    for (const key of [
      "autoProvisionUsers",
      "autoDeprovisionUsers",
      "enablePushGroups",
      "description",
    ]) {
      expect([key, fieldFor(PROJECT_FIELDS, key).collapsibleSection]).toEqual([
        key,
        section,
      ]);
    }
  });

  test("is one page: no field names a step", () => {
    for (const field of PROJECT_FIELDS) {
      expect([keyOf(field), field.stepId]).toEqual([keyOf(field), undefined]);
    }
  });

  test("requires only the name", () => {
    expect(
      PROJECT_FIELDS.filter((field: Field<ProjectSCIM>): boolean => {
        return Boolean(field.required);
      }).map(keyOf),
    ).toEqual(["name"]);

    const name: Field<ProjectSCIM> = fieldFor(PROJECT_FIELDS, "name");

    expect(name.fieldType).toBe(FormFieldSchemaType.Text);
    expect(name.validation).toEqual({ minLength: 2 });
    expect(name.description).toBe(SCIM_NAME_DESCRIPTION);
  });

  test("Default Teams pick from the project's teams, and hide while push groups manage membership", () => {
    const teams: Field<ProjectSCIM> = fieldFor(PROJECT_FIELDS, "teams");

    expect(teams.title).toBe("Default Teams");
    expect(teams.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(teams.dropdownModal).toEqual({
      type: Team,
      labelField: "name",
      valueField: "_id",
    });
    expect(teams.description).toBe(SCIM_DEFAULT_TEAMS_DESCRIPTION);

    expect(
      teams.showIf!({
        enablePushGroups: false,
      } as unknown as FormValues<ProjectSCIM>),
    ).toBe(true);
    expect(teams.showIf!({} as FormValues<ProjectSCIM>)).toBe(true);
    expect(
      teams.showIf!({
        enablePushGroups: true,
      } as unknown as FormValues<ProjectSCIM>),
    ).toBe(false);
  });

  test("the three settings are switches with no default of their own: they start where their columns do", () => {
    for (const key of [
      "autoProvisionUsers",
      "autoDeprovisionUsers",
      "enablePushGroups",
    ]) {
      const field: Field<ProjectSCIM> = fieldFor(PROJECT_FIELDS, key);

      expect({
        key,
        type: field.fieldType,
        defaultValue: field.defaultValue,
      }).toEqual({
        key,
        type: FormFieldSchemaType.Toggle,
        defaultValue: undefined,
      });
    }

    // The columns ModelForm reads those defaults from.
    const model: ProjectSCIM = new ProjectSCIM();

    expect(
      model.getTableColumnMetadata("autoProvisionUsers").defaultValue,
    ).toBe(true);
    expect(
      model.getTableColumnMetadata("autoDeprovisionUsers").defaultValue,
    ).toBe(true);
    expect(model.getTableColumnMetadata("enablePushGroups").defaultValue).toBe(
      false,
    );
  });

  test("keeps its help: what each setting does", () => {
    expect(fieldFor(PROJECT_FIELDS, "autoProvisionUsers").description).toBe(
      SCIM_AUTO_PROVISION_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "autoDeprovisionUsers").description).toBe(
      PROJECT_SCIM_AUTO_DEPROVISION_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "enablePushGroups").description).toBe(
      SCIM_PUSH_GROUPS_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "description").description).toBe(
      SCIM_DESCRIPTION_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "description").required).toBe(false);
  });
});

describe("the status page's SCIM form", () => {
  test("asks for the name; provisioning, deprovisioning and the description are folded", () => {
    expect(STATUS_PAGE_FIELDS.map(keyOf)).toEqual([
      "name",
      "autoProvisionUsers",
      "autoDeprovisionUsers",
      "description",
    ]);

    expect(fieldFor(STATUS_PAGE_FIELDS, "name").collapsibleSection).toBe(
      undefined,
    );

    const section: FormFieldCollapsibleSection<StatusPageSCIM> | undefined =
      fieldFor(STATUS_PAGE_FIELDS, "autoProvisionUsers").collapsibleSection;

    expect(section?.title).toBe(MORE_FIELDS_SECTION_TITLE);

    for (const key of [
      "autoProvisionUsers",
      "autoDeprovisionUsers",
      "description",
    ]) {
      expect(fieldFor(STATUS_PAGE_FIELDS, key).collapsibleSection).toBe(
        section,
      );
    }
  });

  test("has no teams and no push groups, and is one page", () => {
    expect(STATUS_PAGE_FIELDS.map(keyOf)).not.toContain("teams");
    expect(STATUS_PAGE_FIELDS.map(keyOf)).not.toContain("enablePushGroups");

    for (const field of STATUS_PAGE_FIELDS) {
      expect([keyOf(field), field.stepId]).toEqual([keyOf(field), undefined]);
    }
  });

  test("its switches start where their columns do, and say what they do there", () => {
    for (const key of ["autoProvisionUsers", "autoDeprovisionUsers"]) {
      const field: Field<StatusPageSCIM> = fieldFor(STATUS_PAGE_FIELDS, key);

      expect([key, field.fieldType, field.defaultValue]).toEqual([
        key,
        FormFieldSchemaType.Toggle,
        undefined,
      ]);
      expect(
        new StatusPageSCIM().getTableColumnMetadata(key).defaultValue,
      ).toBe(true);
    }

    expect(
      fieldFor(STATUS_PAGE_FIELDS, "autoDeprovisionUsers").description,
    ).toBe(STATUS_PAGE_SCIM_AUTO_DEPROVISION_DESCRIPTION);
  });
});

describe("the folded More fields section", () => {
  test("is at its defaults while provisioning and deprovisioning are on, push groups off and nothing is written", () => {
    expect(isScimAdvancedAtDefaults({})).toBe(true);
    expect(
      isScimAdvancedAtDefaults(
        {
          autoProvisionUsers: true,
          autoDeprovisionUsers: true,
          enablePushGroups: false,
          description: "",
        },
        { withPushGroups: true },
      ),
    ).toBe(true);
    // Only a switch turned off counts: one not set yet is at its column's default.
    expect(isScimAdvancedAtDefaults({ autoProvisionUsers: undefined })).toBe(
      true,
    );
  });

  test.each([
    ["provisioning off", { autoProvisionUsers: false }],
    ["deprovisioning off", { autoDeprovisionUsers: false }],
    ["a description", { description: "Okta for the EU workforce" }],
  ])("is not, with %s", (_label: string, change: Record<string, unknown>) => {
    expect(isScimAdvancedAtDefaults(change)).toBe(false);
    expect(isScimAdvancedAtDefaults(change, { withPushGroups: true })).toBe(
      false,
    );
  });

  test("push groups count only on a project's connection", () => {
    expect(
      isScimAdvancedAtDefaults(
        { enablePushGroups: true },
        { withPushGroups: true },
      ),
    ).toBe(false);
    expect(isScimAdvancedAtDefaults({ enablePushGroups: true })).toBe(true);
  });

  test("says what its defaults do while folded at them, and is configured once something differs", () => {
    const project: FormFieldCollapsibleSection<ProjectSCIM> =
      getScimAdvancedSection<ProjectSCIM>({ withPushGroups: true });
    const statusPage: FormFieldCollapsibleSection<StatusPageSCIM> =
      getScimAdvancedSection<StatusPageSCIM>();

    const atDefaults: FormValues<ProjectSCIM> = {
      autoProvisionUsers: true,
      autoDeprovisionUsers: true,
      enablePushGroups: false,
    } as unknown as FormValues<ProjectSCIM>;

    expect(project.getSummary!(atDefaults)).toEqual([
      PROJECT_SCIM_ADVANCED_DEFAULTS_SUMMARY,
    ]);
    expect(project.isConfigured!(atDefaults)).toBe(false);
    expect(
      statusPage.getSummary!(
        atDefaults as unknown as FormValues<StatusPageSCIM>,
      ),
    ).toEqual([STATUS_PAGE_SCIM_ADVANCED_DEFAULTS_SUMMARY]);

    const pushGroups: FormValues<ProjectSCIM> = {
      ...atDefaults,
      enablePushGroups: true,
    } as unknown as FormValues<ProjectSCIM>;

    expect(project.getSummary!(pushGroups)).toBeUndefined();
    expect(project.isConfigured!(pushGroups)).toBe(true);
  });

  test("the summaries are whole sentences", () => {
    expect(PROJECT_SCIM_ADVANCED_DEFAULTS_SUMMARY).toBe(
      "People added in your identity provider join the default teams, and people removed there leave them.",
    );
    expect(STATUS_PAGE_SCIM_ADVANCED_DEFAULTS_SUMMARY).toBe(
      "People added in your identity provider can sign in to this status page, and people removed there lose access.",
    );
  });

  test("each form builds its own section", () => {
    expect(
      fieldFor(getProjectScimFormFields(), "description").collapsibleSection,
    ).not.toBe(fieldFor(PROJECT_FIELDS, "description").collapsibleSection);
  });
});

describe("what a new project connection saves", () => {
  test("the teams Default Teams showed, while it was shown", () => {
    const connection: ProjectSCIM = new ProjectSCIM();
    const team: Team = new Team();
    team._id = "00000000-0000-4000-8000-0000000000a1";
    connection.teams = [team];
    connection.enablePushGroups = false;

    expect(withoutHiddenScimDefaultTeams(connection).teams).toEqual([team]);
  });

  test("no teams while push groups manage membership: the form hid them", () => {
    const connection: ProjectSCIM = new ProjectSCIM();
    const team: Team = new Team();
    team._id = "00000000-0000-4000-8000-0000000000a1";
    connection.teams = [team];
    connection.enablePushGroups = true;

    const saved: ProjectSCIM = withoutHiddenScimDefaultTeams(connection);

    expect(saved).toBe(connection);
    expect(saved.teams).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(saved, "teams")).toBe(false);
  });

  test("Default Teams is shown exactly while push groups are off", () => {
    expect(isScimDefaultTeamsShown({})).toBe(true);
    expect(isScimDefaultTeamsShown({ enablePushGroups: false })).toBe(true);
    expect(isScimDefaultTeamsShown({ enablePushGroups: true })).toBe(false);
    expect(isScimDefaultTeamsShown(null)).toBe(true);
  });
});

/*
 * The two pages, read the way the form guards read every form. Common's
 * LongFormStepsGuard and its siblings walk ee/ too, but CI runs them with
 * ee/ deleted, so the shape is pinned here as well.
 */
describe("the two SCIM pages, as the form guards read them", () => {
  const scanned: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files: [PROJECT_PAGE, STATUS_PAGE_PAGE].map((file: string): string => {
      return path.join(REPOSITORY_ROOT, file);
    }),
  });

  const formIn: (file: string) => FormFacts = (file: string): FormFacts => {
    const forms: Array<FormFacts> = scanned.filter((form: FormFacts) => {
      return form.file === file && form.host === "ModelTable";
    });

    expect(forms).toHaveLength(1);

    return forms[0]!;
  };

  test.each([
    [
      PROJECT_PAGE,
      ["name", "teams"],
      [
        "autoProvisionUsers",
        "autoDeprovisionUsers",
        "enablePushGroups",
        "description",
      ],
    ],
    [
      STATUS_PAGE_PAGE,
      ["name"],
      ["autoProvisionUsers", "autoDeprovisionUsers", "description"],
    ],
  ])(
    "%s is one page of three rows or fewer, read in full through the builder",
    (file: string, open: Array<string>, folded: Array<string>) => {
      const form: FormFacts = formIn(file);

      expect(form.uncountableReasons).toEqual([]);
      expect(form.hasSteps).toBe(false);
      expect(countFormRows(form)).toBeLessThanOrEqual(3);

      expect(
        form.fields
          .filter((field: FormFieldFacts): boolean => {
            return field.collapsibleSection === undefined;
          })
          .map((field: FormFieldFacts): string => {
            return field.key;
          }),
      ).toEqual(open);
      expect(
        form.fields
          .filter((field: FormFieldFacts): boolean => {
            return field.collapsibleSection !== undefined;
          })
          .map((field: FormFieldFacts): string => {
            return field.key;
          }),
      ).toEqual(folded);

      for (const field of form.fields) {
        expect({ key: field.key, file: field.file }).toEqual({
          key: field.key,
          file: BUILDER,
        });
      }
    },
  );

  test.each([PROJECT_PAGE, STATUS_PAGE_PAGE])(
    "%s has no checkbox and no switch that starts off its column",
    (file: string) => {
      const form: FormFacts = formIn(file);

      for (const field of form.fields) {
        expect(field.fieldType).not.toBe("FormFieldSchemaType.Checkbox");

        if (field.fieldType === "FormFieldSchemaType.Toggle") {
          expect({ key: field.key, hasDefault: field.hasDefault }).toEqual({
            key: field.key,
            hasDefault: false,
          });
        }
      }
    },
  );

  test("the pages take their fields from the builder and write no steps", () => {
    const projectPage: string = fs
      .readFileSync(path.join(REPOSITORY_ROOT, PROJECT_PAGE), "utf8")
      .replace(/\s+/g, " ");
    const statusPagePage: string = fs
      .readFileSync(path.join(REPOSITORY_ROOT, STATUS_PAGE_PAGE), "utf8")
      .replace(/\s+/g, " ");

    expect(projectPage).toContain("formFields={getProjectScimFormFields()}");
    expect(statusPagePage).toContain(
      "formFields={getStatusPageScimFormFields()}",
    );

    for (const source of [projectPage, statusPagePage]) {
      expect(source).not.toContain("formSteps=");
      expect(source).not.toContain("FormFieldSchemaType.Checkbox");
    }

    // The project's connection starts on the members team.
    expect(projectPage).toContain(
      "const createInitialValues: FormValues<ProjectSCIM> | undefined = useDefaultSsoTeamsInitialValues<ProjectSCIM>();",
    );
    expect(projectPage).toContain("createInitialValues={createInitialValues}");
    expect(statusPagePage).not.toContain("useDefaultSsoTeamsInitialValues");
  });
});
