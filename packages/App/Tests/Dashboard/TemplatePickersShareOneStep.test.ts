import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Create a workflow and Create a dashboard pick their templates with one
 * step, not two copies of it.
 *
 * The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." The way to keep the two alike is to draw them with
 * the same code: the shared template picker
 * (Components/TemplatePicker/TemplatePicker) and its rules
 * (Utils/TemplatePicker/TemplatePickerUtil), the details' rows and chips
 * (TemplateDetails) and the chosen template on the Name step
 * (ChosenTemplate). Each picker only says what is its own - its catalog,
 * what an empty start gives, a picked template's details - and each wizard
 * its own steps. A copy of the step in either one would drift from the
 * other the first time one of them changed; this reads the source for the
 * signs of one.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /^\s*\/\/.*$/gm;
const JSX_COMMENT: RegExp = /\{\/\*[\s\S]*?\*\/\}/g;

type ReadFunction = (...segments: Array<string>) => string;

// The code, without its comments: they explain the step, and may name it.
const read: ReadFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(JSX_COMMENT, " ")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
};

interface Picker {
  name: string;
  picker: string;
  wizard: string;
  util: string;
  idPrefix: string;
}

const PICKERS: Array<Picker> = [
  {
    name: "Create a workflow",
    picker: read("Components", "Workflow", "WorkflowTemplatePicker.tsx"),
    wizard: read("Components", "Workflow", "CreateWorkflowModal.tsx"),
    util: read("Utils", "Workflow", "WorkflowTemplatePickerUtil.ts"),
    idPrefix: "workflow",
  },
  {
    name: "Create a dashboard",
    picker: read("Components", "Dashboard", "DashboardTemplatePicker.tsx"),
    wizard: read("Components", "Dashboard", "CreateDashboardModal.tsx"),
    util: read("Utils", "Dashboard", "DashboardTemplatePickerUtil.ts"),
    idPrefix: "dashboard",
  },
];

const SHARED_PICKER: string = read(
  "Components",
  "TemplatePicker",
  "TemplatePicker.tsx",
);

const PAGE: string = read("Pages", "Dashboards", "Dashboards.tsx");

describe.each(PICKERS.map((picker: Picker) => [picker.name, picker]))(
  "%s",
  (_name: string, picker: Picker) => {
    test("draws its step with the shared template picker, under its own id prefix", () => {
      expect(picker.picker).toContain(
        'from "../TemplatePicker/TemplatePicker"',
      );
      expect(picker.picker).toContain("<TemplatePicker");
      expect(picker.picker).toContain(`"${picker.idPrefix}"`);
    });

    test("draws none of the step itself: no list, no rows, no search box, no Start from scratch card", () => {
      for (const sign of [
        'role="listbox"',
        'role="option"',
        'role="combobox"',
        "<select",
        "<input",
        '"Start from scratch"',
        '"Or start from a template"',
        '"Search templates…"',
        "onKeyDown",
      ]) {
        expect({ sign: sign, drawn: picker.picker.includes(sign) }).toEqual({
          sign: sign,
          drawn: false,
        });
      }
    });

    test("draws a picked template's details with the shared rows and chips", () => {
      expect(picker.picker).toContain(
        'from "../TemplatePicker/TemplateDetails"',
      );
      expect(picker.picker).toContain("<TemplateDetailsRow");
      expect(picker.picker).toContain("<TemplateDetailsChip");
      expect(picker.picker).not.toContain("<dl");
    });

    test("takes its rules from the shared ones, and searches with none of its own", () => {
      expect(picker.util).toContain("createTemplatePickerRules(");
      expect(picker.util).toContain(
        'from "../TemplatePicker/TemplatePickerUtil"',
      );

      for (const ownSearch of [
        "ComponentPicker/ComponentSearch",
        "matchWordWithTypo",
        "WORD_MATCH_QUALITY",
        "NAME_PHRASE_BONUS",
      ]) {
        expect({
          ownSearch: ownSearch,
          found: picker.util.includes(ownSearch),
        }).toEqual({
          ownSearch: ownSearch,
          found: false,
        });
      }
    });

    test("its wizard shows the template chosen with the shared card, and builds its footer with the stepped footer", () => {
      expect(picker.wizard).toContain("<ChosenTemplate");
      expect(picker.wizard).toContain("getSteppedModalFooter(");
      expect(picker.wizard).toContain('"Use this template"');
      expect(picker.wizard).toContain("ModalWidth.Medium");
      expect(picker.wizard).toContain('title="Back"');
    });
  },
);

describe("the shared step", () => {
  test("names none of the catalogs it is drawn over", () => {
    for (const word of ["Workflow", "Dashboard", "workflow-", "dashboard-"]) {
      expect({ word: word, named: SHARED_PICKER.includes(word) }).toEqual({
        word: word,
        named: false,
      });
    }
  });

  test("is the one place the step's words are drawn", () => {
    for (const label of [
      '"Start from scratch"',
      '"Or start from a template"',
      '"Search templates…"',
      '"No templates match your search."',
    ]) {
      expect(SHARED_PICKER).toContain(label);
    }
  });
});

describe("the Dashboards page", () => {
  test("opens Create a dashboard from its Create button, as Workflows opens Create a workflow", () => {
    expect(PAGE).toContain("<CreateDashboardModal");
    expect(PAGE).toContain("onCreateClick={() => {");
    expect(PAGE).toContain("setShowCreateModal(true);");
  });

  test("draws no dialog of its own: no wall of template cards, no table create form", () => {
    for (const gone of [
      "Create from Template",
      "DashboardTemplateCard",
      "getDashboardTemplatesByCategory",
      "formFields=",
      "showCreateForm=",
      "createInitialValues=",
      "onBeforeCreate=",
      "<Modal",
    ]) {
      expect({ gone: gone, drawn: PAGE.includes(gone) }).toEqual({
        gone: gone,
        drawn: false,
      });
    }
  });

  test("the old card component is gone", () => {
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "Dashboard",
          "DashboardTemplateCard.tsx",
        ),
      ),
    ).toBe(false);
  });
});
