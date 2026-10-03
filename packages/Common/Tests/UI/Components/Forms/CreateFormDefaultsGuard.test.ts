import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CreateFormColumnDefault,
  getCreateFormColumnDefault,
} from "../../../../UI/Components/Forms/Utils/CreateFormDefaults";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import { RULE_ENABLED_COLUMN } from "../../../../UI/Components/RuleRun/RuleEnabledField";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepProblem,
  MIN_SCANNED_FORMS,
  SourceFileSystem,
  findStepProblems,
  isSwitchFieldType,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "The idea is to reduce decision / choice paralysis as much as possible:
 * show people as few options as possible ... and have sane defaults." - the
 * maintainer, closing the feedback document.
 *
 * A rule created from its dashboard form was saved switched off, while the
 * same rule created through the API started on: the form drew the Enabled
 * switch off because nothing told it the column defaults to on, and sent it
 * as off. ModelForm now starts every field of a Create form from its
 * column's default (Forms/Utils/CreateFormDefaults), and a rule's create form
 * no longer asks whether the rule should be on (RuleRun/RuleEnabledField).
 *
 * This guard keeps it that way, by reading every form in the frontends
 * (Tests/Helpers/FormStepsScan):
 *
 *   - a switch on a create form starts where its column does. ModelForm
 *     gives a field that says nothing the column's default, so the only way
 *     a switch starts elsewhere is a defaultValue written on the field - and
 *     each one that contradicts its column is listed below, with the reason;
 *   - a rule's create form leaves its Enabled switch out (RuleTable does it
 *     for its pages, a rule page on ModelTable marks the field
 *     doNotShowWhenCreating), unless it is listed below, with the reason.
 *
 * The detector is pinned on inline snippets first, then run over the real
 * tree with checks that it really read it.
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

interface ListedSwitch {
  // Repository-relative, with "/".
  file: string;
  // The form's label (see getFormLabel in FormStepsScan.ts).
  form: string;
  // The column the switch writes.
  key: string;
  reason: string;
}

/*
 * Shared by both lists: the one rule that is created off, and so the one
 * rule form, grouping rules aside, that still asks.
 */
const AUTO_IMPORT_RULES_REASON: string =
  "Saving an enabled import rule imports the hosts discovered in the last day within a minute, and each one becomes a monitored device - so a new rule starts off, is tried with Dry Run (which works on a disabled rule) and is switched on after, the way the Network Device docs describe it.";

const ADMIN_ADDED_SUBSCRIBER_MESSAGE_REASON: string =
  'Someone an admin adds to a status page is sent a "you have subscribed" message only when the admin asks for one. The column defaults to on for people who subscribe themselves on the status page.';

/*
 * Create-form switches that start somewhere other than their column's
 * default, and why. A switch that leaves this list, or a new one that joins
 * the product, has to say so here.
 */
export const SWITCHES_OFF_THEIR_COLUMN_DEFAULT: Array<ListedSwitch> = [
  ...[
    ["EmailSubscribers.tsx", "Email"],
    ["SMSSubscribers.tsx", "SMS"],
    ["SlackSubscribers.tsx", "Slack"],
    ["MicrosoftTeamsSubscribers.tsx", "Microsoft Teams"],
    ["WebhookSubscribers.tsx", "Webhook"],
  ].map(([file, kind]: Array<string>): ListedSwitch => {
    return {
      file: `${DASHBOARD}/Pages/StatusPages/View/${file}`,
      form: `ModelTable: Status Page > ${kind} Subscribers`,
      key: "sendYouHaveSubscribedMessage",
      reason: ADMIN_ADDED_SUBSCRIBER_MESSAGE_REASON,
    };
  }),
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/EmailSubscribers.tsx`,
    form: "ModelTable: Status Page > Email Subscribers",
    key: "isSubscriptionConfirmed",
    reason:
      'An admin who adds a subscriber vouches for the address, so "Do not send confirmation link" starts on. The column defaults to off for people who subscribe themselves, who confirm by email.',
  },
  {
    file: `${DASHBOARD}/Pages/NetworkDevice/Discovery.tsx`,
    form: "ModelTable: Network Device Discovery Scans",
    key: "isNetbiosLookupEnabled",
    reason:
      "On for a scan created now, by an operator looking at the switch; the column's off speaks for every scan that existed before the lookup did (the field's comment says why).",
  },
  {
    file: `${DASHBOARD}/Pages/Settings/LlmProviders.tsx`,
    form: "ModelTable: Settings > LLM Providers",
    key: "isDefault",
    reason:
      "AI features use only the default provider, so a provider added here is made the default unless the admin says otherwise. The column is off because only one provider of a project can be the default.",
  },
  {
    file: "ee/Dashboard/TeamCompliance/ComplianceRuleForm.tsx",
    form: "ModelFormModal #1",
    key: "enabled",
    reason:
      "Adding a compliance rule from this dialog is asking for members to be checked, so it starts on. The column keeps the API's default of off.",
  },
  {
    file: `${DASHBOARD}/Pages/NetworkDevice/Settings/AutoImportRules.tsx`,
    form: "ModelTable: Settings > Network Device Auto Import Rules",
    key: "isEnabled",
    reason: AUTO_IMPORT_RULES_REASON,
  },
];

interface ListedForm {
  file: string;
  form: string;
  reason: string;
}

const GROUPING_RULES_REASON: string =
  "Grouping rules were reworked on their own (PR #4249): their create form keeps the Enabled switch, starting on.";

// Rule create forms that still ask whether the rule is on, and why.
export const RULE_FORMS_ASKING_ENABLED: Array<ListedForm> = [
  {
    file: `${DASHBOARD}/Pages/Incidents/Settings/IncidentGroupingRules.tsx`,
    form: "ModelTable: Settings > Incident Grouping Rules",
    reason: GROUPING_RULES_REASON,
  },
  {
    file: `${DASHBOARD}/Pages/Alerts/Settings/AlertGroupingRules.tsx`,
    form: "ModelTable: Settings > Alert Grouping Rules",
    reason: GROUPING_RULES_REASON,
  },
  {
    file: `${DASHBOARD}/Pages/NetworkDevice/Settings/AutoImportRules.tsx`,
    form: "ModelTable: Settings > Network Device Auto Import Rules",
    reason: AUTO_IMPORT_RULES_REASON,
  },
];

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

// Scans `Page.tsx` (and whatever it imports from the other files given).
function only(files: Record<string, string>): FormFacts {
  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

function fieldOf(form: FormFacts, key: string): FormFieldFacts {
  const found: FormFieldFacts | undefined = form.fields.find(
    (field: FormFieldFacts): boolean => {
      return field.key === key;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

const RULE_MODEL_FILE: string = `
  import RuleBaseModel from "./RuleBaseModel";
  export default class ThingRule extends RuleBaseModel {}
`;

describe("the create form detector", () => {
  test("names the model a form saves, and the file it comes from", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import ThingRule from "./Models/ThingRule";
        const Page = () => <ModelTable modelType={ThingRule} name="Things" isCreateable={true} formFields={[{ field: { name: true }, title: "Name", fieldType: FormFieldSchemaType.Text }]} />;`,
      "Models/ThingRule.ts": RULE_MODEL_FILE,
    });

    expect(form.modelType).toEqual({
      name: "ThingRule",
      file: "Models/ThingRule.ts",
    });
    expect(form.isRuleModel).toBe(true);
  });

  test("tells a Create form from one that only edits", () => {
    const table: (attributes: string) => FormFacts = (
      attributes: string,
    ): FormFacts => {
      return only({
        "Page.tsx": `const Page = () => <ModelTable name="Things" ${attributes} formFields={[]} />;`,
      });
    };

    expect(table("isCreateable={true}").hasCreateForm).toBe(true);
    expect(table("isCreateable").hasCreateForm).toBe(true);
    expect(table("isCreateable={false}").hasCreateForm).toBe(false);
    expect(table("").hasCreateForm).toBe(false);
    // Decided at runtime: counted as one.
    expect(table("isCreateable={!isReadOnly}").hasCreateForm).toBe(null);

    const form: (formType: string) => FormFacts = (
      formType: string,
    ): FormFacts => {
      return only({
        "Page.tsx": `const Page = () => <ModelForm name="Thing" formType={${formType}} fields={[]} />;`,
      });
    };

    expect(form("FormType.Create").hasCreateForm).toBe(true);
    expect(form("FormType.Update").hasCreateForm).toBe(false);
    expect(
      form("isEditing ? FormType.Update : FormType.Create").hasCreateForm,
    ).toBe(null);

    expect(
      only({
        "Page.tsx": `const Page = () => <ModelFormModal title="Add" formProps={{ formType: FormType.Create, fields: [] }} />;`,
      }).hasCreateForm,
    ).toBe(true);

    expect(
      only({
        "Page.tsx": `const Page = () => <CardModelDetail name="Card" formFields={[]} />;`,
      }).hasCreateForm,
    ).toBe(false);
  });

  test("reads the values a Create form starts with", () => {
    const table: (initialValues: string) => FormFacts = (
      initialValues: string,
    ): FormFacts => {
      return only({
        "Page.tsx": `
          const START = { isEnabled: true, order: 1 };
          const Page = () => <ModelTable name="Things" isCreateable={true} ${initialValues} formFields={[]} />;`,
      });
    };

    expect(
      table(`createInitialValues={{ isEnabled: true, "name": "x" }}`)
        .createInitialValueKeys,
    ).toEqual(["isEnabled", "name"]);
    expect(table("createInitialValues={START}").createInitialValueKeys).toEqual(
      ["isEnabled", "order"],
    );
    expect(table("").createInitialValueKeys).toEqual([]);
    // A spread hides keys this scan cannot see.
    expect(
      table("createInitialValues={{ ...START, name: 'x' }}")
        .createInitialValueKeys,
    ).toBe(null);
    expect(
      table("createInitialValues={getStart()}").createInitialValueKeys,
    ).toBe(null);

    expect(
      only({
        "Page.tsx": `const Page = () => <ModelFormModal title="Add" initialValues={{ enabled: true }} formProps={{ formType: FormType.Create, fields: [] }} />;`,
      }).createInitialValueKeys,
    ).toEqual(["enabled"]);
  });

  test("reads a field's own default, and whether a spread could carry one", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelTable name="Things" isCreateable={true} formFields={[
          { field: { a: true }, title: "A", fieldType: FormFieldSchemaType.Toggle, defaultValue: false },
          { field: { b: true }, title: "B", fieldType: FormFieldSchemaType.Toggle },
          { field: { c: true }, title: "C", fieldType: FormFieldSchemaType.Number, getDefaultValue: () => 5 },
          { field: { d: true }, title: "D", fieldType: FormFieldSchemaType.Toggle, defaultValue: undefined },
          { ...BASE, field: { e: true }, title: "E" },
        ]} />;`,
    });

    expect(fieldOf(form, "a")).toMatchObject({
      defaultValue: "false",
      hasDefault: true,
      hasSpread: false,
    });
    expect(fieldOf(form, "b")).toMatchObject({
      defaultValue: undefined,
      hasDefault: false,
    });
    expect(fieldOf(form, "c")).toMatchObject({
      defaultValue: undefined,
      hasDefault: true,
    });
    expect(fieldOf(form, "d")).toMatchObject({
      defaultValue: undefined,
      hasDefault: false,
    });
    expect(fieldOf(form, "e").hasSpread).toBe(true);
  });

  test("knows RuleTable leaves a rule's Enabled switch off its Create form", () => {
    const fields: string = `[
      { field: { name: true }, title: "Name", stepId: "basic", fieldType: FormFieldSchemaType.Text },
      { field: { isEnabled: true }, title: "Enabled", stepId: "basic", fieldType: FormFieldSchemaType.Toggle },
    ]`;

    for (const host of ["RuleTable", "LabelRuleTable"]) {
      const form: FormFacts = only({
        "Page.tsx": `const Page = () => <${host} name="Rules" isCreateable={true} formSteps={[{ title: "Basic", id: "basic" }]} formFields={${fields}} />;`,
      });

      expect(fieldOf(form, RULE_ENABLED_COLUMN).isEditOnly).toBe(true);
      expect(fieldOf(form, "name").isEditOnly).toBe(false);
    }

    // A plain ModelTable does not, unless the field says so.
    const table: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Rules" isCreateable={true} formSteps={[{ title: "Basic", id: "basic" }]} formFields={${fields}} />;`,
    });

    expect(fieldOf(table, RULE_ENABLED_COLUMN).isEditOnly).toBe(false);
  });

  test("flags a step the create wizard would walk through empty", () => {
    const problems: (host: string, isCreateable: string) => Array<string> = (
      host: string,
      isCreateable: string,
    ): Array<string> => {
      return findStepProblems([
        only({
          "Page.tsx": `const Page = () => <${host} name="Rules" isCreateable={${isCreateable}} isEditable={true} formSteps={[{ title: "Info", id: "info" }, { title: "Status", id: "status" }]} formFields={[
            { field: { name: true }, title: "Name", stepId: "info", fieldType: FormFieldSchemaType.Text },
            { field: { isEnabled: true }, title: "Enabled", stepId: "status", fieldType: FormFieldSchemaType.Toggle },
          ]} />;`,
        }),
      ]).map((problem: FormStepProblem): string => {
        return problem.kind;
      });
    };

    // RuleTable leaves the switch off on its own; the Status step is empty.
    expect(problems("RuleTable", "true")).toEqual(["empty-step-on-create"]);
    expect(problems("LabelRuleTable", "true")).toEqual([
      "empty-step-on-create",
    ]);
    // A table that never creates never walks it.
    expect(problems("RuleTable", "false")).toEqual([]);
    // On a ModelTable the switch is on the Create form.
    expect(problems("ModelTable", "true")).toEqual([]);

    expect(
      findStepProblems([
        only({
          "Page.tsx": `const Page = () => <ModelTable name="Rules" isCreateable={true} formSteps={[{ title: "Info", id: "info" }, { title: "Status", id: "status" }]} formFields={[
            { field: { name: true }, title: "Name", stepId: "info", fieldType: FormFieldSchemaType.Text },
            { field: { isEnabled: true }, title: "Enabled", stepId: "status", fieldType: FormFieldSchemaType.Toggle, doNotShowWhenCreating: true },
          ]} />;`,
        }),
      ]).map((problem: FormStepProblem): string => {
        return problem.kind;
      }),
    ).toEqual(["empty-step-on-create"]);
  });
});

/*
 * The project's create forms, each with the model it saves - loaded from the
 * file its import names, as ModelForm would build it.
 */
interface CreateForm {
  form: FormFacts;
  model: BaseModel;
}

const modelCache: Map<string, BaseModel | null> = new Map<
  string,
  BaseModel | null
>();

function loadModel(file: string): BaseModel | null {
  if (modelCache.has(file)) {
    return modelCache.get(file) || null;
  }

  let model: BaseModel | null = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const loaded: { default?: unknown } = require(
      path.join(REPOSITORY_ROOT, file),
    ) as { default?: unknown };

    if (typeof loaded.default === "function") {
      const instance: unknown = new (loaded.default as { new (): unknown })();

      if (instance instanceof BaseModel) {
        model = instance;
      }
    }
  } catch {
    model = null;
  }

  modelCache.set(file, model);

  return model;
}

interface SwitchOnCreateForm {
  createForm: CreateForm;
  field: FormFieldFacts;
  columnDefault: unknown;
}

function formKey(item: { file: string; form: string; key?: string }): string {
  return `${item.file} :: ${item.form}${item.key ? ` :: ${item.key}` : ""}`;
}

function describeSwitch(item: SwitchOnCreateForm): string {
  return `${item.createForm.form.file}:${item.field.line} ${item.createForm.form.label} - ${item.field.key} starts ${item.field.defaultValue}, its column ${String(item.columnDefault)}`;
}

describe("the project's create forms", () => {
  const scanRoots: Array<string> = listScanRoots(REPOSITORY_ROOT);

  /*
   * Whether a listed form is one this checkout has to read. Common's CI job
   * deletes ee/ before it runs (core builds and passes without the Enterprise
   * Edition), so an entry for an ee/ form is held to the scan only where ee/
   * is checked out, and every other entry always.
   */
  const isScannedHere: (item: { file: string }) => boolean = (item: {
    file: string;
  }): boolean => {
    const filePath: string = path.join(REPOSITORY_ROOT, item.file);

    return scanRoots.some((root: string): boolean => {
      return filePath.startsWith(`${root}${path.sep}`);
    });
  };

  const files: Array<string> = scanRoots.flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  const createForms: Array<CreateForm> = forms
    .filter((form: FormFacts): boolean => {
      return form.hasCreateForm !== false && Boolean(form.modelType?.file);
    })
    .map((form: FormFacts): CreateForm | null => {
      const model: BaseModel | null = loadModel(form.modelType!.file!);

      return model ? { form, model } : null;
    })
    .filter((item: CreateForm | null): item is CreateForm => {
      return item !== null;
    });

  // Every switch a create form shows for a column that has a default.
  const switches: Array<SwitchOnCreateForm> = createForms.flatMap(
    (createForm: CreateForm): Array<SwitchOnCreateForm> => {
      return createForm.form.fields
        .filter((field: FormFieldFacts): boolean => {
          return (
            Boolean(field.key) &&
            !field.isNeverShown &&
            !field.isEditOnly &&
            isSwitchFieldType(field.fieldType)
          );
        })
        .map((field: FormFieldFacts): SwitchOnCreateForm | null => {
          const metadata: TableColumnMetadata | undefined =
            createForm.model.getTableColumnMetadata(field.key);

          if (!metadata || typeof metadata.defaultValue !== "boolean") {
            return null;
          }

          return { createForm, field, columnDefault: metadata.defaultValue };
        })
        .filter(
          (item: SwitchOnCreateForm | null): item is SwitchOnCreateForm => {
            return item !== null;
          },
        );
    },
  );

  // A broken walk, or models that fail to load, must not pass by finding nothing.
  test("are really read", () => {
    // About half of CI's counts on 2026-10-03 (269, 195, 80): see MIN_SCANNED_FORMS.
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
    expect(createForms.length).toBeGreaterThan(125);
    expect(switches.length).toBeGreaterThan(75);
    expect(
      createForms.filter((createForm: CreateForm): boolean => {
        return createForm.form.isRuleModel;
      }).length,
    ).toBeGreaterThan(35);
  });

  test("start every switch the field says nothing about from its column's default", () => {
    /*
     * What ModelForm gives each of them, worked out by the same function it
     * calls: the column's default, on and off alike.
     */
    const saysNothing: Array<SwitchOnCreateForm> = switches.filter(
      (item: SwitchOnCreateForm): boolean => {
        return !item.field.hasDefault && !item.field.hasSpread;
      },
    );

    expect(saysNothing.length).toBeGreaterThan(50);

    const startingElsewhere: Array<string> = saysNothing
      .filter((item: SwitchOnCreateForm): boolean => {
        const startsAs: CreateFormColumnDefault | undefined =
          getCreateFormColumnDefault(item.createForm.model, {
            field: { [item.field.key]: true },
            fieldType: item.field.fieldType.endsWith(".Checkbox")
              ? FormFieldSchemaType.Checkbox
              : FormFieldSchemaType.Toggle,
          });

        return startsAs !== item.columnDefault;
      })
      .map(describeSwitch);

    expect(startingElsewhere).toEqual([]);
  });

  test("start every switch where its column does, unless they are listed with the reason", () => {
    const listed: Set<string> = new Set<string>(
      SWITCHES_OFF_THEIR_COLUMN_DEFAULT.map(formKey),
    );

    const offTheirColumn: Array<SwitchOnCreateForm> = switches.filter(
      (item: SwitchOnCreateForm): boolean => {
        return (
          (item.field.defaultValue === "true" ||
            item.field.defaultValue === "false") &&
          item.field.defaultValue !== String(item.columnDefault)
        );
      },
    );

    expect(
      offTheirColumn
        .filter((item: SwitchOnCreateForm): boolean => {
          return !listed.has(
            formKey({
              file: item.createForm.form.file,
              form: item.createForm.form.label,
              key: item.field.key,
            }),
          );
        })
        .map(describeSwitch),
    ).toEqual([]);

    // And the list never goes stale.
    const found: Set<string> = new Set<string>(
      offTheirColumn.map((item: SwitchOnCreateForm): string => {
        return formKey({
          file: item.createForm.form.file,
          form: item.createForm.form.label,
          key: item.field.key,
        });
      }),
    );

    expect(
      SWITCHES_OFF_THEIR_COLUMN_DEFAULT.filter(isScannedHere)
        .map(formKey)
        .filter((key: string): boolean => {
          return !found.has(key);
        }),
    ).toEqual([]);
  });

  test("hold every listed form to the scan, an ee/ one wherever ee/ is checked out", () => {
    const enterprisePresent: boolean = fs.existsSync(
      path.join(REPOSITORY_ROOT, "ee", "Dashboard"),
    );

    for (const item of [
      ...SWITCHES_OFF_THEIR_COLUMN_DEFAULT,
      ...RULE_FORMS_ASKING_ENABLED,
    ]) {
      expect({ file: item.file, scanned: isScannedHere(item) }).toEqual({
        file: item.file,
        scanned: item.file.startsWith("ee/") ? enterprisePresent : true,
      });
    }
  });

  test("give every listed switch and form a reason", () => {
    for (const item of [
      ...SWITCHES_OFF_THEIR_COLUMN_DEFAULT,
      ...RULE_FORMS_ASKING_ENABLED,
    ]) {
      expect(item.reason.length).toBeGreaterThan(40);
    }
  });

  test("leave a rule's Enabled switch off its create form: every rule starts on", () => {
    const listed: Set<string> = new Set<string>(
      RULE_FORMS_ASKING_ENABLED.map(formKey),
    );

    const asking: Array<CreateForm> = createForms.filter(
      (createForm: CreateForm): boolean => {
        return (
          createForm.form.isRuleModel &&
          createForm.form.fields.some((field: FormFieldFacts): boolean => {
            return (
              field.key === RULE_ENABLED_COLUMN &&
              !field.isNeverShown &&
              !field.isEditOnly
            );
          })
        );
      },
    );

    expect(
      asking
        .filter((createForm: CreateForm): boolean => {
          return !listed.has(
            formKey({
              file: createForm.form.file,
              form: createForm.form.label,
            }),
          );
        })
        .map((createForm: CreateForm): string => {
          return `${createForm.form.file}:${createForm.form.line} ${createForm.form.label}`;
        }),
    ).toEqual([]);

    const askingKeys: Set<string> = new Set<string>(
      asking.map((createForm: CreateForm): string => {
        return formKey({
          file: createForm.form.file,
          form: createForm.form.label,
        });
      }),
    );

    expect(
      RULE_FORMS_ASKING_ENABLED.filter(isScannedHere)
        .map(formKey)
        .filter((key: string): boolean => {
          return !askingKeys.has(key);
        }),
    ).toEqual([]);
  });

  test("still let every rule be switched off on its edit form", () => {
    const ruleForms: Array<CreateForm> = createForms.filter(
      (createForm: CreateForm): boolean => {
        return (
          createForm.form.isRuleModel &&
          createForm.form.hasEditForm &&
          createForm.model.hasColumn(RULE_ENABLED_COLUMN)
        );
      },
    );

    expect(ruleForms.length).toBeGreaterThan(35);

    /*
     * Every rule form that lists an Enabled switch keeps it on its Edit
     * form: left off on Create (edit-only) is fine, never left off both.
     */
    for (const createForm of ruleForms) {
      for (const field of createForm.form.fields) {
        if (field.key === RULE_ENABLED_COLUMN) {
          expect(`${createForm.form.label}: ${field.isCreateOnly}`).toBe(
            `${createForm.form.label}: false`,
          );
        }
      }
    }
  });

  test("include the forms this was found on, now starting the way the API does", () => {
    const fieldOn: (
      file: string,
      label: string,
      key: string,
    ) => FormFieldFacts = (
      file: string,
      label: string,
      key: string,
    ): FormFieldFacts => {
      const createForm: CreateForm | undefined = createForms.find(
        (item: CreateForm): boolean => {
          return item.form.file === file && item.form.label === label;
        },
      );

      expect(createForm).toBeDefined();

      return fieldOf(createForm!.form, key);
    };

    // Monitor > Probes: Add Probe asks only which probe; a new one is on.
    expect(
      fieldOn(
        `${DASHBOARD}/Pages/Monitor/View/Probes.tsx`,
        "ModelTable: Monitor > Monitor Probes",
        "isEnabled",
      ).isEditOnly,
    ).toBe(true);

    // An owner rule: no Enabled question, and Notify Owners starts on.
    const ownerRules: string = `${DASHBOARD}/Pages/Incidents/Settings/IncidentOwnerRules.tsx`;
    expect(
      fieldOn(
        ownerRules,
        "RuleTable: Settings > Incident Owner Rules",
        "isEnabled",
      ).isEditOnly,
    ).toBe(true);

    const notifyOwners: FormFieldFacts = fieldOn(
      ownerRules,
      "RuleTable: Settings > Incident Owner Rules",
      "notifyOwners",
    );
    expect(notifyOwners.hasDefault).toBe(false);
    expect(
      switches.some((item: SwitchOnCreateForm): boolean => {
        return item.field === notifyOwners && item.columnDefault === true;
      }),
    ).toBe(true);

    // The reminder rules lost their one-switch Status step.
    for (const [file, label] of [
      [
        `${DASHBOARD}/Pages/Incidents/Settings/IncidentReminderRules.tsx`,
        "ModelTable: Settings > Incident Reminder Rules",
      ],
      [
        `${DASHBOARD}/Pages/Alerts/Settings/AlertReminderRules.tsx`,
        "ModelTable: Settings > Alert Reminder Rules",
      ],
      [
        `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceReminderRules.tsx`,
        "ModelTable: Settings > Scheduled Maintenance Reminder Rules",
      ],
    ] as Array<[string, string]>) {
      const enabled: FormFieldFacts = fieldOn(file, label, "isEnabled");
      expect(enabled.isEditOnly).toBe(true);
      expect(enabled.stepId).toBe("rule-info");

      const createForm: CreateForm = createForms.find(
        (item: CreateForm): boolean => {
          return item.form.file === file && item.form.label === label;
        },
      )!;
      expect(
        (createForm.form.steps || []).map((step: { id: string | null }) => {
          return step.id;
        }),
      ).toEqual(["rule-info", "match-criteria", "reminder-settings"]);
    }
  });
});
