import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  countFieldRows,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Adding a monitor is what everyone who builds a status page does over and
 * over, and it used to walk two steps (Monitor Details, then Advanced), with
 * a display name to type although a monitor had just been picked. Creating a
 * group walked three. Now each form asks for what the record cannot exist
 * without, and folds the rest - what is shown beside a resource or a group,
 * a description, a tooltip - under Advanced at the model's own defaults:
 *
 *   - a resource (Add Monitor / Edit resource): the monitor and its display
 *     name, which follows the monitor's name (StatusPageResourceFormFields);
 *     its fields reach the panel as a prop, so the scan cannot read them -
 *     Tests/App/StatusPage/StatusPageResourceForm.test.tsx does;
 *   - Add Multiple Monitors: the monitors (and, for a grid group, the cell
 *     they go in);
 *   - a group: its name and parent, with Layout and Advanced folded;
 *   - a monitor rule: its three steps, the display options folded on the
 *     Group step (AdvancedStepsGuard pins where).
 *
 * This guard reads those forms the way the long-form and Advanced-step
 * guards do (Tests/Helpers/FormStepsScan) and pins each one's shape, so a
 * field that drifts back onto a step of its own, or out of its fold, is
 * caught here and not by a customer.
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

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const RESOURCES_PAGE: string = `${DASHBOARD}/Pages/StatusPages/View/Resources.tsx`;
const RESOURCE_PANEL: string = `${DASHBOARD}/Components/StatusPage/StatusPageResourcePanel.tsx`;
const BULK_ADD_MODAL: string = `${DASHBOARD}/Components/StatusPage/BulkAddStatusPageMonitorsModal.tsx`;
const MONITOR_RULES: string = `${DASHBOARD}/Pages/StatusPages/View/MonitorRules.tsx`;
const RESOURCE_FORM_FIELDS: string = `${DASHBOARD}/Components/StatusPage/StatusPageResourceFormFields.ts`;

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: [RESOURCES_PAGE, RESOURCE_PANEL, BULK_ADD_MODAL, MONITOR_RULES].map(
    (file: string): string => {
      return path.join(REPOSITORY_ROOT, file);
    },
  ),
});

type FindFormFunction = (file: string, label: string) => FormFacts;

const findForm: FindFormFunction = (file: string, label: string): FormFacts => {
  const form: FormFacts | undefined = forms.find(
    (candidate: FormFacts): boolean => {
      return candidate.file === file && candidate.label === label;
    },
  );

  if (!form) {
    throw new Error(
      `${file} has no form labelled ${label}; it has: ${forms
        .filter((candidate: FormFacts): boolean => {
          return candidate.file === file;
        })
        .map((candidate: FormFacts): string => {
          return candidate.label;
        })
        .join(", ")}`,
    );
  }

  return form;
};

type KeysFunction = (fields: Array<FormFieldFacts>) => Array<string>;

const keys: KeysFunction = (fields: Array<FormFieldFacts>): Array<string> => {
  return fields.map((field: FormFieldFacts): string => {
    return field.key;
  });
};

type OpenFieldsFunction = (form: FormFacts) => Array<FormFieldFacts>;

const openFields: OpenFieldsFunction = (
  form: FormFacts,
): Array<FormFieldFacts> => {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection === undefined;
  });
};

type FoldedFieldsFunction = (
  form: FormFacts,
  section: string,
) => Array<FormFieldFacts>;

const foldedFields: FoldedFieldsFunction = (
  form: FormFacts,
  section: string,
): Array<FormFieldFacts> => {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection === section;
  });
};

// Comments out: what the code does, not what a comment says about it.
type ReadCodeFunction = (file: string) => string;

const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
};

describe("the status page resource forms", () => {
  test("are really read", () => {
    expect(forms.length).toBeGreaterThanOrEqual(5);
  });

  describe("the group form", () => {
    const form: FormFacts = findForm(RESOURCES_PAGE, "ModelFormModal #1");

    test("is one page", () => {
      expect(form.hasSteps).toBe(false);
      expect(
        form.fields.filter((field: FormFieldFacts): boolean => {
          return field.stepId !== undefined && field.stepId !== null;
        }),
      ).toEqual([]);
    });

    test("asks for the group's name and where it sits, and nothing else open", () => {
      expect(keys(openFields(form))).toEqual(["name", "parentStatusPageGroup"]);
    });

    test("folds the layout - the view mode and a grid's axes - into its own section", () => {
      expect(keys(foldedFields(form, "layoutSection"))).toEqual([
        "viewMode",
        "rowAxisLabel",
        "rowAxisValues",
        "columnAxisLabel",
        "columnAxisValues",
      ]);
    });

    test("folds everything else under Advanced, last", () => {
      expect(keys(foldedFields(form, "advancedSection"))).toEqual([
        "description",
        "isExpandedByDefault",
        "showCurrentStatus",
        "showUptimePercent",
        "uptimePercentPrecision",
      ]);

      expect(form.fields[form.fields.length - 1]?.collapsibleSection).toBe(
        "advancedSection",
      );
    });

    test("is four rows: two to fill in and two folded headers", () => {
      expect(countFieldRows(form.fields)).toBe(4);
      expect(form.visibleFieldCount).toBe(4);
    });

    test("keeps each folded section's fields next to each other", () => {
      const sections: Array<string> = [];

      for (const field of form.fields) {
        const section: string = field.collapsibleSection || "(open)";

        if (sections[sections.length - 1] !== section) {
          sections.push(section);
        }
      }

      expect(sections).toEqual(["(open)", "layoutSection", "advancedSection"]);
    });

    /*
     * Do not unify the defaults: a group shows its current status and no
     * uptime unless told otherwise, as its columns say.
     */
    test("starts from the group's own defaults", () => {
      const defaults: Record<string, string | undefined> = {};

      for (const field of form.fields) {
        defaults[field.key] = field.defaultValue;
      }

      expect(defaults).toMatchObject({
        viewMode: "StatusPageGroupViewMode.List",
        showCurrentStatus: "true",
        showUptimePercent: "false",
        uptimePercentPrecision: "UptimePrecision.ONE_DECIMAL",
      });
    });
  });

  describe("Add Multiple Monitors", () => {
    const form: FormFacts = findForm(
      BULK_ADD_MODAL,
      "BasicForm: Status Page > Add Multiple Monitors",
    );

    test("is one page", () => {
      expect(form.hasSteps).toBe(false);
      expect(
        form.fields.filter((field: FormFieldFacts): boolean => {
          return field.stepId !== undefined && field.stepId !== null;
        }),
      ).toEqual([]);
    });

    test("asks for the monitors, and a grid group's cell, open", () => {
      expect(keys(openFields(form))).toEqual([
        "monitors",
        "keepInSyncWithLabels",
        "rowAxisValue",
        "columnAxisValue",
      ]);
    });

    test("folds the display options under one Advanced header, last", () => {
      expect(keys(foldedFields(form, "advancedSection"))).toEqual([
        "displayTooltip",
        "showCurrentStatus",
        "showUptimePercent",
        "uptimePercentPrecision",
        "showStatusHistoryChart",
      ]);

      expect(
        keys(
          form.fields.slice(
            form.fields.length - foldedFields(form, "advancedSection").length,
          ),
        ),
      ).toEqual(keys(foldedFields(form, "advancedSection")));
    });

    test("starts from a hand-added resource's own defaults", () => {
      const defaults: Record<string, string | undefined> = {};

      for (const field of form.fields) {
        defaults[field.key] = field.defaultValue;
      }

      expect(defaults).toMatchObject({
        showCurrentStatus: "true",
        showUptimePercent: "false",
        uptimePercentPrecision: "UptimePrecision.ONE_DECIMAL",
        showStatusHistoryChart: "true",
      });
    });

    test("submits with one plain button, never a Next", () => {
      const code: string = readCode(BULK_ADD_MODAL);

      expect(code).toContain('submitButtonText="Add Monitors"');
      expect(code).not.toContain("getSteppedFormFooter");
      expect(code).not.toContain("goToNextStep");
      expect(code).not.toContain("submitAllSteps");
      expect(code).not.toContain("modal-footer-next-button");
    });
  });

  describe("a monitor rule", () => {
    const form: FormFacts = findForm(
      MONITOR_RULES,
      "RuleTable: Status Page > Monitor Rules",
    );

    test("walks three steps, none of them a page of display options", () => {
      expect(
        (form.steps || []).map((step: FormStepFacts): string | null => {
          return step.id;
        }),
      ).toEqual(["basic-info", "match-criteria", "group"]);
    });

    test("folds how each monitor it adds is shown on the Group step", () => {
      const onGroupStep: Array<FormFieldFacts> = form.fields.filter(
        (field: FormFieldFacts): boolean => {
          return field.stepId === "group";
        },
      );

      expect(keys(onGroupStep)).toEqual([
        "statusPageGroup",
        "showCurrentStatus",
        "showUptimePercent",
        "uptimePercentPrecision",
        "showStatusHistoryChart",
      ]);
      expect(countFieldRows(onGroupStep)).toBe(2);
    });

    /*
     * A rule's monitors show their uptime unless told otherwise
     * (StatusPageMonitorRule), where a monitor added by hand does not
     * (StatusPageResource). Each form shows its own model's default.
     */
    test("keeps the rule's own defaults, which differ from a resource's", () => {
      const defaults: Record<string, string | undefined> = {};

      for (const field of form.fields) {
        defaults[field.key] = field.defaultValue;
      }

      expect(defaults).toMatchObject({
        showCurrentStatus: "true",
        showUptimePercent: "true",
        uptimePercentPrecision: "UptimePrecision.ONE_DECIMAL",
        showStatusHistoryChart: "true",
      });
    });
  });

  /*
   * The resource form reaches the panel's dialogs as a prop, so the scan
   * sees no fields there. What it can see: neither dialog is handed steps,
   * and the page hands over no step list for them.
   */
  describe("a resource (Add Monitor and Edit resource)", () => {
    test.each([
      ["ModelFormModal: Status Page > Resources"],
      ["ModelFormModal: Status Page > Resources #2"],
    ])("%s has no steps", (label: string) => {
      const form: FormFacts = findForm(RESOURCE_PANEL, label);

      expect(form.hasSteps).toBe(false);
    });

    test("no step list is handed down from the page", () => {
      expect(readCode(RESOURCE_PANEL)).not.toContain("formSteps");
      expect(readCode(RESOURCE_PANEL)).not.toContain("steps:");
      expect(readCode(RESOURCES_PAGE)).not.toContain("formSteps");
      expect(readCode(RESOURCES_PAGE)).not.toContain("FormStep");
    });

    test("its fields come from the shared resource form", () => {
      expect(readCode(RESOURCES_PAGE)).toContain(
        "getStatusPageResourceFormFields({",
      );
    });

    test("the shared resource form folds its options and puts nothing on a step", () => {
      const code: string = readCode(RESOURCE_FORM_FIELDS);

      expect(code).not.toContain("stepId");
      expect(code).toContain("getAdvancedFormSection<StatusPageResource>()");
      /*
       * Description, then the five options - every one of them handed the
       * one section the form built.
       */
      expect(code.split("collapsibleSection: advancedSection").length - 1).toBe(
        6,
      );
    });
  });
});
