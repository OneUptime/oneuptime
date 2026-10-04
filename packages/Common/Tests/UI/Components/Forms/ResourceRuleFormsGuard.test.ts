import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  RULE_CRITERIA_STEP_ID,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";
import {
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";

/*
 * "Please also find similar issues across the project and fix them as
 * well. The idea is to make software as simple as possible to use and
 * reduce decision paralysis." - the maintainer.
 *
 * Every resource product's Label Rules and Owner Rules pages wrote out the
 * same three-step form by hand: a "Basic Info" step asking for a name (and,
 * on an owner rule, whether to notify owners) before anyone had said what
 * the rule was for, then "Match Criteria", then - only on the third step -
 * what the rule adds, which was optional, so a rule that adds nothing could
 * be saved.
 *
 * They now take their form from one place (Dashboard Utils/Form/
 * ResourceRuleForm): two steps, Match and then Labels or Owners, where what
 * the rule adds is required and the rule's name is filled in from it. A
 * page writes only the fields its rule matches on. This guard reads every
 * label and owner rule form in the project the way the long-form guards do
 * (Tests/Helpers/FormStepsScan) and holds each to that - so a product added
 * later gets the same form, or says here why not.
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

const HELPER_FILE: string = `${DASHBOARD}/Utils/Form/ResourceRuleForm.ts`;

const LABEL_RULE_MODEL: RegExp = /LabelRule$/;
const OWNER_RULE_MODEL: RegExp = /OwnerRule$/;

/*
 * Label and owner rule pages that keep a form of their own, and why. The
 * event and monitor rules are worked on as their own areas: each asks
 * questions the resource rules do not (which monitors' or hosts' labels and
 * owners to inherit, the episode's own rules beside the incident's), and the
 * same helpers apply to them once those areas take them up. A page listed
 * here that takes the shared form must leave the list (see below).
 */
const OWN_FORM_REASON_EVENTS: string =
  "Incident, alert and scheduled maintenance rules have an Inherit step of their own (labels or owners handed on from the monitors, hosts and clusters an event touches), and belong to the incident area's work.";

const OWN_FORM_REASON_MONITOR_AND_STATUS_PAGE: string =
  "Monitor and status page rules belong to the monitor and status page areas' work; the same shared form applies to them when those areas take it up.";

export const RULE_PAGES_WITH_THEIR_OWN_FORM: Array<{
  file: string;
  reason: string;
}> = [
  ...[
    "Incidents/Settings/IncidentLabelRules.tsx",
    "Incidents/Settings/IncidentOwnerRules.tsx",
    "Alerts/Settings/AlertLabelRules.tsx",
    "Alerts/Settings/AlertOwnerRules.tsx",
    "ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceLabelRules.tsx",
    "ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceOwnerRules.tsx",
  ].map((file: string) => {
    return {
      file: `${DASHBOARD}/Pages/${file}`,
      reason: OWN_FORM_REASON_EVENTS,
    };
  }),
  ...[
    "Monitor/Settings/MonitorLabelRules.tsx",
    "Monitor/Settings/MonitorOwnerRules.tsx",
    "StatusPages/Settings/StatusPageLabelRules.tsx",
    "StatusPages/Settings/StatusPageOwnerRules.tsx",
  ].map((file: string) => {
    return {
      file: `${DASHBOARD}/Pages/${file}`,
      reason: OWN_FORM_REASON_MONITOR_AND_STATUS_PAGE,
    };
  }),
];

const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
);

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files,
});

type IsRuleFormFunction = (form: FormFacts) => boolean;

const isLabelRuleForm: IsRuleFormFunction = (form: FormFacts): boolean => {
  return LABEL_RULE_MODEL.test(form.modelType?.name || "");
};

const isOwnerRuleForm: IsRuleFormFunction = (form: FormFacts): boolean => {
  return OWNER_RULE_MODEL.test(form.modelType?.name || "");
};

const ownFormFiles: Set<string> = new Set<string>(
  RULE_PAGES_WITH_THEIR_OWN_FORM.map((entry: { file: string }): string => {
    return entry.file;
  }),
);

const ruleForms: Array<FormFacts> = forms.filter((form: FormFacts): boolean => {
  return isLabelRuleForm(form) || isOwnerRuleForm(form);
});

const sharedForms: Array<FormFacts> = ruleForms.filter(
  (form: FormFacts): boolean => {
    return !ownFormFiles.has(form.file);
  },
);

type DescribeFormFunction = (form: FormFacts) => string;

const describeForm: DescribeFormFunction = (form: FormFacts): string => {
  return `${form.file}:${form.line} ${form.label} (${form.modelType?.name})`;
};

/*
 * A field's key as the scan reads it, with the owners people picker named
 * "owners": the scan reads that helper's computed key as written.
 */
type FieldKeyFunction = (field: FormFieldFacts) => string;

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

const fieldKey: FieldKeyFunction = (field: FormFieldFacts): string => {
  return field.fieldType === PEOPLE_PICKER_FIELD_TYPE ? "owners" : field.key;
};

type KindFunction = (form: FormFacts) => "labels" | "owners";

// The step a rule's action is on: its id is the kind of rule.
const actionStepOf: KindFunction = (form: FormFacts): "labels" | "owners" => {
  return isLabelRuleForm(form) ? "labels" : "owners";
};

type CreateFieldsFunction = (form: FormFacts) => Array<FormFieldFacts>;

// What the Create form shows: a table leaves out the Edit-only fields.
const createFormFields: CreateFieldsFunction = (
  form: FormFacts,
): Array<FormFieldFacts> => {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return !field.isEditOnly && !field.isNeverShown;
  });
};

// Comments out: what the code does, not what a comment says about it.
type ReadCodeFunction = (file: string) => string;

const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ");
};

const LABEL_ACTION_KEYS: Array<string> = [
  "labelsToAdd",
  "name",
  "isEnabled",
  "description",
];

const OWNER_ACTION_KEYS: Array<string> = [
  "owners",
  "name",
  "isEnabled",
  "notifyOwners",
  "description",
];

describe("every label and owner rule form", () => {
  /*
   * A broken walk must not pass by finding nothing: 21 products have a
   * Label Rules and an Owner Rules page, On-Call three tables on each.
   */
  test("is really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(sharedForms.length).toBeGreaterThanOrEqual(46);
    expect(sharedForms.filter(isLabelRuleForm).length).toBeGreaterThanOrEqual(
      23,
    );
    expect(sharedForms.filter(isOwnerRuleForm).length).toBeGreaterThanOrEqual(
      23,
    );

    for (const form of sharedForms) {
      expect({ form: describeForm(form), reasons: form.uncountableReasons })
        .toEqual({ form: describeForm(form), reasons: [] });
    }
  });

  test("walks Match, then what the rule adds - no Basic Info step", () => {
    for (const form of sharedForms) {
      expect({
        form: describeForm(form),
        steps: (form.steps || []).map((step: FormStepFacts) => {
          return { id: step.id, title: step.titleTexts };
        }),
      }).toEqual({
        form: describeForm(form),
        steps: [
          { id: RULE_CRITERIA_STEP_ID, title: ["Match"] },
          isLabelRuleForm(form)
            ? { id: "labels", title: ["Labels"] }
            : { id: "owners", title: ["Owners"] },
        ],
      });
    }
  });

  test("takes its steps from the shared form and declares none of its own", () => {
    for (const file of new Set<string>(
      sharedForms.map((form: FormFacts): string => {
        return form.file;
      }),
    )) {
      const code: string = readCode(file);

      expect({ file, ownSteps: code.includes("formSteps={[") }).toEqual({
        file,
        ownSteps: false,
      });
      expect({ file, basicInfo: /basic-info|Basic Info/.test(code) }).toEqual(
        { file, basicInfo: false },
      );
    }

    for (const form of sharedForms) {
      const model: string = form.modelType!.name;
      const steps: string = isLabelRuleForm(form)
        ? `formSteps={getLabelRuleFormSteps<${model}>()}`
        : `formSteps={getOwnerRuleFormSteps<${model}>()}`;
      const actionFields: string = isLabelRuleForm(form)
        ? `...getLabelRuleActionFields<${model}>(), ]}`
        : `...getOwnerRuleActionFields<${model}>(), ]}`;
      const code: string = readCode(form.file);

      expect({ form: describeForm(form), steps: code.includes(steps) }).toEqual(
        { form: describeForm(form), steps: true },
      );
      expect({
        form: describeForm(form),
        actionFieldsLast: code.includes(actionFields),
      }).toEqual({ form: describeForm(form), actionFieldsLast: true });
    }
  });

  test("writes only what its rule matches on: every field of the page is a criterion", () => {
    for (const form of sharedForms) {
      const ownFields: Array<FormFieldFacts> = form.fields.filter(
        (field: FormFieldFacts): boolean => {
          return field.file === form.file;
        },
      );

      expect(ownFields.length).toBeGreaterThan(0);
      expect({
        form: describeForm(form),
        notCriteria: ownFields
          .filter((field: FormFieldFacts): boolean => {
            return field.stepId !== RULE_CRITERIA_STEP_ID;
          })
          .map((field: FormFieldFacts): string => {
            return `${field.key} on ${String(field.stepId)}`;
          }),
      }).toEqual({ form: describeForm(form), notCriteria: [] });
    }
  });

  test("asks what the rule adds with the shared fields, on its last step", () => {
    for (const form of sharedForms) {
      const actionStep: string = actionStepOf(form);
      const actionFields: Array<FormFieldFacts> = form.fields.filter(
        (field: FormFieldFacts): boolean => {
          return field.stepId === actionStep;
        },
      );

      expect({
        form: describeForm(form),
        keys: actionFields.map(fieldKey),
        fromTheHelper: actionFields.every((field: FormFieldFacts): boolean => {
          return field.file === HELPER_FILE;
        }),
      }).toEqual({
        form: describeForm(form),
        keys: isLabelRuleForm(form) ? LABEL_ACTION_KEYS : OWNER_ACTION_KEYS,
        fromTheHelper: true,
      });
    }
  });

  /*
   * What a new rule's last step shows: what it adds and its name, open;
   * its description - and an owner rule's Notify Owners - folded under More
   * fields. Enabled is on the Edit form only: a new rule starts on.
   */
  test("creates a rule from what it adds and its name, the rest folded", () => {
    for (const form of sharedForms) {
      const shown: Array<FormFieldFacts> = createFormFields(form).filter(
        (field: FormFieldFacts): boolean => {
          return field.stepId === actionStepOf(form);
        },
      );

      expect({
        form: describeForm(form),
        open: shown
          .filter((field: FormFieldFacts): boolean => {
            return field.collapsibleSection === undefined;
          })
          .map(fieldKey),
        folded: shown
          .filter((field: FormFieldFacts): boolean => {
            return field.collapsibleSection !== undefined;
          })
          .map(fieldKey),
      }).toEqual({
        form: describeForm(form),
        open: isLabelRuleForm(form)
          ? ["labelsToAdd", "name"]
          : ["owners", "name"],
        folded: isLabelRuleForm(form)
          ? ["description"]
          : ["notifyOwners", "description"],
      });

      const enabled: FormFieldFacts | undefined = form.fields.find(
        (field: FormFieldFacts): boolean => {
          return field.key === "isEnabled";
        },
      );

      expect({ form: describeForm(form), editOnly: enabled?.isEditOnly }).toEqual(
        { form: describeForm(form), editOnly: true },
      );
    }
  });

  test("saves to columns every one of its models has", () => {
    for (const form of sharedForms) {
      expect(form.modelType?.file).toBeTruthy();

      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const loaded: { default?: unknown } = require(
        path.join(REPOSITORY_ROOT, form.modelType!.file!),
      ) as { default?: unknown };
      const model: BaseModel = new (loaded.default as { new (): BaseModel })();

      const columns: Array<string> = isLabelRuleForm(form)
        ? ["name", "description", "isEnabled", "labelsToAdd", "criteria"]
        : [
            "name",
            "description",
            "isEnabled",
            "notifyOwners",
            "ownerUsers",
            "ownerTeams",
            "criteria",
          ];

      expect({
        form: describeForm(form),
        missing: columns.filter((column: string): boolean => {
          return !model.hasColumn(column);
        }),
      }).toEqual({ form: describeForm(form), missing: [] });
    }
  });
});

describe("the label and owner rule pages that keep a form of their own", () => {
  test.each(RULE_PAGES_WITH_THEIR_OWN_FORM)(
    "$file still writes its own steps (else it leaves this list)",
    (entry: { file: string; reason: string }) => {
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, entry.file))).toBe(true);

      const ownForms: Array<FormFacts> = ruleForms.filter(
        (form: FormFacts): boolean => {
          return form.file === entry.file;
        },
      );

      expect(ownForms.length).toBeGreaterThan(0);

      for (const form of ownForms) {
        expect(
          (form.steps || []).map((step: FormStepFacts): string | null => {
            return step.id;
          }),
        ).toContain("basic-info");
      }
    },
  );
});

/*
 * What the shared form asks, read from the helpers themselves - the parts a
 * source scan cannot see: which fields are required, and how the name
 * follows what is picked.
 */
describe("the shared label and owner rule form", () => {
  type AnyEntity = Record<string, unknown>;

  type KeyOfFunction = (field: Field<AnyEntity>) => string;

  const keyOf: KeyOfFunction = (field: Field<AnyEntity>): string => {
    return Object.keys(field.field || {})[0] || "";
  };

  test("a label rule cannot be saved without a label to add, nor without a name", () => {
    const fields: Array<Field<AnyEntity>> =
      getLabelRuleActionFields<AnyEntity>();

    expect(fields.map(keyOf)).toEqual(LABEL_ACTION_KEYS);

    const labels: Field<AnyEntity> = fields[0]!;
    expect(labels.required).toBe(true);
    expect(labels.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(labels.dropdownModal?.labelField).toBe("name");
    expect(labels.onChange).toBeDefined();

    expect(fields[1]!.required).toBe(true);
  });

  test("an owner rule cannot be saved without an owner, nor without a name", () => {
    const fields: Array<Field<AnyEntity>> =
      getOwnerRuleActionFields<AnyEntity>();

    expect(fields.map(keyOf)).toEqual(OWNER_ACTION_KEYS);

    const owners: Field<AnyEntity> = fields[0]!;
    expect(owners.required).toBe(true);
    expect(owners.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(
      owners.peoplePicker?.kinds.map((kind: { valueKey: string }) => {
        return kind.valueKey;
      }),
    ).toEqual(["ownerUsers", "ownerTeams"]);
    expect(owners.onChange).toBeDefined();

    expect(fields[1]!.required).toBe(true);
  });

  test("has no optional question open, and no switch that starts off", () => {
    for (const fields of [
      getLabelRuleActionFields<AnyEntity>(),
      getOwnerRuleActionFields<AnyEntity>(),
    ]) {
      const openOnCreate: Array<Field<AnyEntity>> = fields.filter(
        (field: Field<AnyEntity>): boolean => {
          return !field.collapsibleSection && !field.doNotShowWhenCreating;
        },
      );

      expect(
        openOnCreate.every((field: Field<AnyEntity>): boolean => {
          return field.required === true;
        }),
      ).toBe(true);

      // Switches start where the server starts them: no default of their own.
      for (const field of fields) {
        if (field.fieldType === FormFieldSchemaType.Toggle) {
          expect(field.defaultValue).toBeUndefined();
        }
      }
    }
  });

  test("walks two steps, whose ids are the ones the pages' criteria name", () => {
    expect(
      getLabelRuleFormSteps<AnyEntity>().map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual([RULE_CRITERIA_STEP_ID, "labels"]);
    expect(
      getOwnerRuleFormSteps<AnyEntity>().map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual([RULE_CRITERIA_STEP_ID, "owners"]);
  });
});
