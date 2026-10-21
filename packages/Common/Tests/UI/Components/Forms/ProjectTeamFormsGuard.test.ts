import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listSourceFiles } from "../../../ForeignHiddenRuleGuard";
import {
  CustomElementComponentFacts,
  FormFacts,
  FormFieldFacts,
  FormStepsScanner,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * The Admin Dashboard adds people to a project in four places that name the
 * project and then a team of it: Add to Project on a user's Projects page,
 * the Users list's bulk Add to Project, and the Attached Projects of a
 * global SSO and a global OIDC provider. Each walked two steps - the
 * project, then the team - and the team step started empty, a permissions
 * decision on every add. Now each is one page: the project, then its team(s)
 * right under it, drawn by ProjectScopedTeamsPicker, which loads the picked
 * project's teams and starts on its members team (Common/UI/Utils
 * /DefaultInviteTeam, read as a master admin).
 *
 * This guard reads every form of the Admin Dashboard (and of the Enterprise
 * Admin Dashboard screens, when the checkout has them) the way the form
 * guards read every form (Tests/Helpers/FormStepsScan), and fails when a
 * form draws the picker:
 *   - on a step of its own, away from the project it lists the teams of -
 *     with nothing to show until the project is picked, it would only be a
 *     Next between the project and its members team;
 *   - before the project field, or without one.
 * The picker writes the members team when it is drawn, so a form has to
 * draw it before it is sent: the detector that finds such elements is
 * pinned on it here. It also pins the four forms by name, so one cannot quietly stop drawing
 * the picker (and starting on the members team) without this list saying so.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";

const PICKER: string = "ProjectScopedTeamsPicker";
const PICKER_FILE: string = `${ADMIN_DASHBOARD}/Components/GlobalProvider/ProjectScopedTeamsPicker.tsx`;

interface ProjectTeamForm {
  file: string;
  label: string;
  // The fields, in order: the project, its team(s), anything after.
  keys: Array<string>;
}

const PROJECT_TEAM_FORMS: Array<ProjectTeamForm> = [
  {
    file: `${ADMIN_DASHBOARD}/Pages/Users/View/Projects.tsx`,
    label: "ModelFormModal: Add User to Project",
    keys: ["project", "team", "hasAcceptedInvitation"],
  },
  {
    file: `${ADMIN_DASHBOARD}/Components/User/BulkAddUsersToProjectModal.tsx`,
    label: "BasicForm: Admin > Users > Add to Project",
    keys: ["project", "team", "hasAcceptedInvitation"],
  },
  {
    file: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalSSO/View.tsx`,
    label: "ModelTable: Settings > Global SSO > Attached Projects",
    keys: ["project", "teams"],
  },
  {
    file: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalOIDC/View.tsx`,
    label: "ModelTable: Settings > Global OIDC > Attached Projects",
    keys: ["project", "teams"],
  },
];

// Where the forms that can draw the picker live.
const SCAN_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, ADMIN_DASHBOARD),
  path.join(REPOSITORY_ROOT, "ee", "AdminDashboard"),
].filter((directory: string): boolean => {
  return fs.existsSync(directory);
});

const FORMS: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: SCAN_ROOTS.flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  }),
});

function drawsPicker(field: FormFieldFacts): boolean {
  return field.customElementComponents.some(
    (component: CustomElementComponentFacts): boolean => {
      return component.name === PICKER;
    },
  );
}

// Every form that draws the picker, with the field that does.
const PICKER_FORMS: Array<{ form: FormFacts; field: FormFieldFacts }> =
  FORMS.flatMap(
    (form: FormFacts): Array<{ form: FormFacts; field: FormFieldFacts }> => {
      return form.fields.filter(drawsPicker).map((field: FormFieldFacts) => {
        return { form, field };
      });
    },
  );

function describeForm(form: FormFacts): string {
  return `${form.file}:${form.line} ${form.label}`;
}

describe("Admin Dashboard forms that add someone to a project", () => {
  test("are really read", () => {
    // The Admin Dashboard has dozens of forms; a broken walk finds none.
    expect(FORMS.length).toBeGreaterThan(20);
    expect(PICKER_FORMS.length).toBeGreaterThanOrEqual(
      PROJECT_TEAM_FORMS.length,
    );
  });

  test("are the four that name a project and then its team, each drawing the team picker", () => {
    expect(
      PICKER_FORMS.map(({ form }: { form: FormFacts }): string => {
        return `${form.file} | ${form.label}`;
      }).sort(),
    ).toEqual(
      PROJECT_TEAM_FORMS.map((expected: ProjectTeamForm): string => {
        return `${expected.file} | ${expected.label}`;
      }).sort(),
    );
  });

  test.each(PROJECT_TEAM_FORMS)(
    "$label is one page: the project, then its team right under it",
    (expected: ProjectTeamForm) => {
      const found: Array<FormFacts> = FORMS.filter((form: FormFacts) => {
        return form.file === expected.file && form.label === expected.label;
      });

      expect(found).toHaveLength(1);

      const form: FormFacts = found[0]!;

      expect({ form: expected.label, hasSteps: form.hasSteps }).toEqual({
        form: expected.label,
        hasSteps: false,
      });
      expect(form.uncountableReasons).toEqual([]);
      expect(
        form.fields.map((field: FormFieldFacts): string => {
          return field.key;
        }),
      ).toEqual(expected.keys);
      expect(
        form.fields.filter((field: FormFieldFacts): boolean => {
          return field.stepId !== undefined;
        }),
      ).toEqual([]);

      // The project is an entity dropdown; the team is the picker.
      expect(form.fields[0]!.fieldType).toBe("FormFieldSchemaType.Dropdown");
      expect(form.fields[1]!.fieldType).toBe(
        "FormFieldSchemaType.CustomComponent",
      );
      expect(drawsPicker(form.fields[1]!)).toBe(true);
    },
  );

  test("never put the team picker on a step away from the project it lists the teams of", () => {
    const problems: Array<string> = [];

    for (const { form, field } of PICKER_FORMS) {
      const projectIndex: number = form.fields.findIndex(
        (candidate: FormFieldFacts): boolean => {
          return candidate.key === "project";
        },
      );
      const pickerIndex: number = form.fields.indexOf(field);

      if (projectIndex < 0) {
        problems.push(
          `${describeForm(form)}: no project field to list the teams of`,
        );
        continue;
      }

      if (projectIndex > pickerIndex) {
        problems.push(
          `${describeForm(form)}: the teams come before the project`,
        );
      }

      if (form.fields[projectIndex]!.stepId !== field.stepId) {
        problems.push(
          `${describeForm(form)}: the project is on step "${String(form.fields[projectIndex]!.stepId)}" and its teams on "${String(field.stepId)}" - put them on one page`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test("the team picker is known to write the members team when it is drawn", () => {
    for (const { field } of PICKER_FORMS) {
      const picker: CustomElementComponentFacts | undefined =
        field.customElementComponents.find(
          (component: CustomElementComponentFacts): boolean => {
            return component.name === PICKER;
          },
        );

      expect(picker).toEqual({
        name: PICKER,
        file: PICKER_FILE,
        fillsInOnShow: true,
      });
    }

    // The detector agrees, asked about the component directly.
    expect(
      new FormStepsScanner(REPOSITORY_ROOT).describeComponent(
        path.join(REPOSITORY_ROOT, PICKER_FILE),
        PICKER,
      ),
    ).toEqual({ name: PICKER, file: PICKER_FILE, fillsInOnShow: true });
  });
});
