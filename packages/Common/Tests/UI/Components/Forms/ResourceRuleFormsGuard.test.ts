import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  INHERITED_LABEL_COLUMNS,
  INHERITED_OWNER_COLUMNS,
} from "../../../../UI/Components/RuleRun/RuleAction";
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
  getInheritingLabelRuleActionFields,
  getInheritingOwnerRuleActionFields,
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
  InheritingRuleRecord,
} from "../../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";

/*
 * "Please also find similar issues across the project and fix them as
 * well. The idea is to make software as simple as possible to use and
 * reduce decision paralysis." - the maintainer.
 *
 * Every Label Rules and Owner Rules page wrote out the same three-step form
 * by hand: a "Basic Info" step asking for a name (and, on an owner rule,
 * whether to notify owners) before anyone had said what the rule was for,
 * then "Match Criteria", then - only on the third step - what the rule
 * adds, which was optional, so a rule that adds nothing could be saved.
 * The incident, alert and scheduled maintenance rules had a fourth step
 * with six switches: which of the event's monitors, hosts, clusters and
 * services to inherit labels or owners from.
 *
 * They now take their form from one place (Dashboard Utils/Form/
 * ResourceRuleForm): two steps, Match and then Labels or Owners, where what
 * a new rule adds is required and the rule's name is filled in from it; an
 * event's rule folds its inherit switches under Inherit Labels / Inherit
 * Owners on that step. A page writes only the fields its rule matches on.
 * This guard reads every label and owner rule form in the project the way
 * the long-form guards do (Tests/Helpers/FormStepsScan) and holds each to
 * that - and every label and owner rule MODEL to having its one form there,
 * so a product added later gets the same form.
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

const MODELS_DIRECTORY: string = "packages/Common/Models/DatabaseModels";

const LABEL_RULE_MODEL: RegExp = /LabelRule$/;

// The step every label and owner rule form used to open on.
const BASIC_INFO_STEP: RegExp = /basic-info|Basic Info/;
const OWNER_RULE_MODEL: RegExp = /OwnerRule$/;
const RULE_MODEL_FILE: RegExp = /(?:Label|Owner)Rule\.ts$/;

// The events whose rules inherit, as their pages name them to the helpers.
const INHERITING_RECORDS: Array<InheritingRuleRecord> = [
  "incident",
  "alert",
  "scheduledMaintenance",
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

const ruleForms: Array<FormFacts> = forms.filter((form: FormFacts): boolean => {
  return isLabelRuleForm(form) || isOwnerRuleForm(form);
});

// Every label and owner rule model of the project, by its class name.
const ruleModelNames: Array<string> = fs
  .readdirSync(path.join(REPOSITORY_ROOT, MODELS_DIRECTORY))
  .filter((file: string): boolean => {
    return RULE_MODEL_FILE.test(file);
  })
  .map((file: string): string => {
    return file.replace(/\.ts$/, "");
  })
  .sort();

type LoadModelFunction = (form: FormFacts) => BaseModel;

const loadModel: LoadModelFunction = (form: FormFacts): BaseModel => {
  expect(form.modelType?.file).toBeTruthy();

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const loaded: { default?: unknown } = require(
    path.join(REPOSITORY_ROOT, form.modelType!.file!),
  ) as { default?: unknown };

  return new (loaded.default as { new (): BaseModel })();
};

// The model's inherit switches: an event's rule has six, any other none.
type InheritColumnsFunction = (form: FormFacts) => Array<string>;

const inheritColumnsOf: InheritColumnsFunction = (
  form: FormFacts,
): Array<string> => {
  const prefix: string = isLabelRuleForm(form)
    ? "inheritLabelsFrom"
    : "inheritOwnersFrom";

  return loadModel(form)
    .getTableColumns()
    .columns.filter((column: string): boolean => {
      return column.startsWith(prefix);
    });
};

type InheritsFunction = (form: FormFacts) => boolean;

const inherits: InheritsFunction = (form: FormFacts): boolean => {
  return inheritColumnsOf(form).length > 0;
};

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

// The keys on a form's last step: the picker, its inherit switches, the rest.
type ActionKeysFunction = (form: FormFacts) => Array<string>;

const actionKeysOf: ActionKeysFunction = (form: FormFacts): Array<string> => {
  const [picker, ...rest]: Array<string> = isLabelRuleForm(form)
    ? LABEL_ACTION_KEYS
    : OWNER_ACTION_KEYS;

  return [picker!, ...inheritColumnsOf(form), ...rest];
};

/*
 * How a page spreads the shared action fields in, last in its list (the
 * whitespace prettier puts around a long call is read as one space).
 */
type ActionFieldsCallFunction = (form: FormFacts) => RegExp;

const actionFieldsCallOf: ActionFieldsCallFunction = (
  form: FormFacts,
): RegExp => {
  const model: string = form.modelType!.name;
  const kind: string = isLabelRuleForm(form) ? "Label" : "Owner";

  if (inherits(form)) {
    return new RegExp(
      `\\.\\.\\.getInheriting${kind}RuleActionFields<${model}>\\( ?"(${INHERITING_RECORDS.join("|")})",? ?\\), \\]\\}`,
    );
  }

  return new RegExp(
    `\\.\\.\\.get${kind}RuleActionFields<${model}>\\(\\), \\]\\}`,
  );
};

describe("every label and owner rule form", () => {
  /*
   * A broken walk must not pass by finding nothing: every label and owner
   * rule model has a form - 30 of each, On-Call three tables on each page,
   * Incidents and Alerts two (their episodes' rules).
   */
  test("is really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(ruleModelNames.length).toBeGreaterThanOrEqual(60);
    expect(ruleForms.length).toBeGreaterThanOrEqual(60);
    expect(ruleForms.filter(isLabelRuleForm).length).toBeGreaterThanOrEqual(30);
    expect(ruleForms.filter(isOwnerRuleForm).length).toBeGreaterThanOrEqual(30);
    expect(ruleForms.filter(inherits).length).toBe(6);

    for (const form of ruleForms) {
      expect({
        form: describeForm(form),
        reasons: form.uncountableReasons,
      }).toEqual({ form: describeForm(form), reasons: [] });
    }
  });

  /*
   * No page keeps a form of its own any more - the list of the ones that
   * did (incident, alert, scheduled maintenance, monitor and status page
   * rules) emptied as they moved. Every model has its one form here, so a
   * rule model added later takes the shared form too.
   */
  test("exists, once, for every label and owner rule model", () => {
    const formModels: Array<string> = ruleForms
      .map((form: FormFacts): string => {
        return form.modelType!.name;
      })
      .sort();

    expect(formModels).toEqual(ruleModelNames);
  });

  test("walks Match, then what the rule adds - no Basic Info step", () => {
    for (const form of ruleForms) {
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
      ruleForms.map((form: FormFacts): string => {
        return form.file;
      }),
    )) {
      const code: string = readCode(file);

      expect({ file, ownSteps: code.includes("formSteps={[") }).toEqual({
        file,
        ownSteps: false,
      });
      expect({ file, basicInfo: BASIC_INFO_STEP.test(code) }).toEqual({
        file,
        basicInfo: false,
      });
      // Nothing it adds is written on the page: the shared form asks.
      expect({ file, ownOwners: code.includes("getOwnersFormField(") }).toEqual(
        { file, ownOwners: false },
      );
    }

    for (const form of ruleForms) {
      const model: string = form.modelType!.name;
      const steps: string = isLabelRuleForm(form)
        ? `formSteps={getLabelRuleFormSteps<${model}>()}`
        : `formSteps={getOwnerRuleFormSteps<${model}>()}`;
      const code: string = readCode(form.file);

      expect({ form: describeForm(form), steps: code.includes(steps) }).toEqual(
        { form: describeForm(form), steps: true },
      );
      expect({
        form: describeForm(form),
        actionFieldsLast: actionFieldsCallOf(form).test(code),
      }).toEqual({ form: describeForm(form), actionFieldsLast: true });
    }
  });

  test("writes only what its rule matches on: every field of the page is a criterion", () => {
    for (const form of ruleForms) {
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
    for (const form of ruleForms) {
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
        keys: actionKeysOf(form),
        fromTheHelper: true,
      });
    }
  });

  /*
   * An event's rule inherits with exactly the switches the shared form
   * offers, so a switch added to a model is either offered by the form or
   * fails here.
   */
  test("offers every inherit switch its model has, and only those", () => {
    for (const form of ruleForms.filter(inherits)) {
      expect({
        form: describeForm(form),
        switches: inheritColumnsOf(form),
      }).toEqual({
        form: describeForm(form),
        switches: isLabelRuleForm(form)
          ? [...INHERITED_LABEL_COLUMNS]
          : [...INHERITED_OWNER_COLUMNS],
      });
    }
  });

  /*
   * What a new rule's last step shows: what it adds and its name, open; the
   * inherit switches of an event's rule folded together under Inherit
   * Labels / Inherit Owners; its description - and an owner rule's Notify
   * Owners - folded under More fields. Enabled is on the Edit form only: a
   * new rule starts on.
   */
  test("creates a rule from what it adds and its name, the rest folded", () => {
    for (const form of ruleForms) {
      const shown: Array<FormFieldFacts> = createFormFields(form).filter(
        (field: FormFieldFacts): boolean => {
          return field.stepId === actionStepOf(form);
        },
      );

      const moreFields: Array<string> = isLabelRuleForm(form)
        ? ["description"]
        : ["notifyOwners", "description"];

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
        folded: [...inheritColumnsOf(form), ...moreFields],
      });

      // Two folds at most: the inherit switches, and More fields.
      const sectionOf: (key: string) => string | undefined = (
        key: string,
      ): string | undefined => {
        return shown.find((field: FormFieldFacts): boolean => {
          return fieldKey(field) === key;
        })?.collapsibleSection;
      };

      const inheritSections: Set<string | undefined> = new Set(
        inheritColumnsOf(form).map(sectionOf),
      );
      const moreSections: Set<string | undefined> = new Set(
        moreFields.map(sectionOf),
      );

      expect(moreSections.size).toBe(1);

      if (inherits(form)) {
        expect(inheritSections.size).toBe(1);
        expect([...inheritSections][0]).not.toBe([...moreSections][0]);
      }

      const enabled: FormFieldFacts | undefined = form.fields.find(
        (field: FormFieldFacts): boolean => {
          return field.key === "isEnabled";
        },
      );

      expect({
        form: describeForm(form),
        editOnly: enabled?.isEditOnly,
      }).toEqual({ form: describeForm(form), editOnly: true });
    }
  });

  test("saves to columns every one of its models has", () => {
    for (const form of ruleForms) {
      const model: BaseModel = loadModel(form);

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
        missing: [...columns, ...inheritColumnsOf(form)].filter(
          (column: string): boolean => {
            return !model.hasColumn(column);
          },
        ),
      }).toEqual({ form: describeForm(form), missing: [] });
    }
  });
});

/*
 * What the shared form asks, read from the helpers themselves - the parts a
 * source scan cannot see: which fields are required, when, and how the name
 * follows what is picked.
 */
describe("the shared label and owner rule form", () => {
  type AnyEntity = Record<string, unknown>;

  type KeyOfFunction = (field: Field<AnyEntity>) => string;

  const keyOf: KeyOfFunction = (field: Field<AnyEntity>): string => {
    return Object.keys(field.field || {})[0] || "";
  };

  type IsRequiredFunction = (
    field: Field<AnyEntity>,
    values: FormValues<AnyEntity>,
  ) => boolean;

  const isRequired: IsRequiredFunction = (
    field: Field<AnyEntity>,
    values: FormValues<AnyEntity>,
  ): boolean => {
    return typeof field.required === "function"
      ? field.required(values)
      : Boolean(field.required);
  };

  // A Create form's values, and an Edit form's: the saved rule, _id and all.
  const NEW_RULE: FormValues<AnyEntity> = {};
  const SAVED_RULE: FormValues<AnyEntity> = {
    _id: "66666666-6666-4666-8666-666666666666",
  } as FormValues<AnyEntity>;

  test("a new label rule cannot be saved without a label to add, nor without a name", () => {
    const fields: Array<Field<AnyEntity>> =
      getLabelRuleActionFields<AnyEntity>();

    expect(fields.map(keyOf)).toEqual(LABEL_ACTION_KEYS);

    const labels: Field<AnyEntity> = fields[0]!;
    expect(isRequired(labels, NEW_RULE)).toBe(true);
    expect(labels.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(labels.dropdownModal?.labelField).toBe("name");
    expect(labels.onChange).toBeDefined();

    expect(fields[1]!.required).toBe(true);
  });

  test("a new owner rule cannot be saved without an owner, nor without a name", () => {
    const fields: Array<Field<AnyEntity>> =
      getOwnerRuleActionFields<AnyEntity>();

    expect(fields.map(keyOf)).toEqual(OWNER_ACTION_KEYS);

    const owners: Field<AnyEntity> = fields[0]!;
    expect(isRequired(owners, NEW_RULE)).toBe(true);
    expect(owners.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(
      owners.peoplePicker?.kinds.map((kind: { valueKey: string }) => {
        return kind.valueKey;
      }),
    ).toEqual(["ownerUsers", "ownerTeams"]);
    expect(owners.onChange).toBeDefined();

    expect(fields[1]!.required).toBe(true);
  });

  /*
   * Decision: an Edit form does not insist on what the rule adds, so a rule
   * saved before the form asked - one that adds nothing - can still be
   * renamed, switched off or deleted. The name stays required.
   */
  test("an Edit form asks for nothing the rule adds, on every form", () => {
    for (const fields of [
      getLabelRuleActionFields<AnyEntity>(),
      getOwnerRuleActionFields<AnyEntity>(),
      ...INHERITING_RECORDS.flatMap(
        (record: InheritingRuleRecord): Array<Array<Field<AnyEntity>>> => {
          return [
            getInheritingLabelRuleActionFields<AnyEntity>(record),
            getInheritingOwnerRuleActionFields<AnyEntity>(record),
          ];
        },
      ),
    ]) {
      const picker: Field<AnyEntity> = fields[0]!;
      const name: Field<AnyEntity> = fields.find(
        (field: Field<AnyEntity>): boolean => {
          return keyOf(field) === "name";
        },
      )!;

      expect(isRequired(picker, NEW_RULE)).toBe(true);
      expect(isRequired(picker, SAVED_RULE)).toBe(false);
      expect(isRequired(name, NEW_RULE)).toBe(true);
      expect(isRequired(name, SAVED_RULE)).toBe(true);
    }
  });

  test.each(INHERITING_RECORDS)(
    "a new %s rule may add nothing by name when it inherits",
    (record: InheritingRuleRecord) => {
      for (const [fields, columns] of [
        [
          getInheritingLabelRuleActionFields<AnyEntity>(record),
          INHERITED_LABEL_COLUMNS,
        ],
        [
          getInheritingOwnerRuleActionFields<AnyEntity>(record),
          INHERITED_OWNER_COLUMNS,
        ],
      ] as Array<[Array<Field<AnyEntity>>, ReadonlyArray<string>]>) {
        const picker: Field<AnyEntity> = fields[0]!;

        // Each switch on its own is enough.
        for (const column of columns) {
          expect(
            isRequired(picker, { [column]: true } as FormValues<AnyEntity>),
          ).toBe(false);
          expect(
            isRequired(picker, { [column]: false } as FormValues<AnyEntity>),
          ).toBe(true);
        }

        // The switches, in the order the form shows them.
        expect(fields.slice(1, 1 + columns.length).map(keyOf)).toEqual([
          ...columns,
        ]);
      }
    },
  );

  test("has no optional question open on a new rule, and no switch that starts off", () => {
    for (const fields of [
      getLabelRuleActionFields<AnyEntity>(),
      getOwnerRuleActionFields<AnyEntity>(),
      getInheritingLabelRuleActionFields<AnyEntity>("incident"),
      getInheritingOwnerRuleActionFields<AnyEntity>("alert"),
    ]) {
      const openOnCreate: Array<Field<AnyEntity>> = fields.filter(
        (field: Field<AnyEntity>): boolean => {
          return !field.collapsibleSection && !field.doNotShowWhenCreating;
        },
      );

      expect(
        openOnCreate.every((field: Field<AnyEntity>): boolean => {
          return isRequired(field, NEW_RULE);
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
