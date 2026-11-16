import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import IncidentPrivacyRule from "../../../../Models/DatabaseModels/IncidentPrivacyRule";
import Label from "../../../../Models/DatabaseModels/Label";
import URL from "../../../../Types/API/URL";
import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import ModelTable from "../../../../UI/Components/ModelTable/ModelTable";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import ruleCriteriaModelForm, {
  RuleCriteriaModelFormLibrary,
} from "../../../../UI/Components/RuleCriteria/LazyRuleCriteriaModelForm";
import { replaceLegacyRuleCriteriaFields } from "../../../../UI/Components/RuleCriteria/RuleCriteriaModelForm";
import { LazyLibrary } from "../../../../UI/Utils/LazyLibrary";
import TabMemory from "../../../../UI/Utils/NewVersion/TabMemory";
import { CHUNK_LOAD_RELOAD_STORAGE_KEY } from "../../../../UI/Utils/NewVersion/ChunkLoadError";

/*
 * A rule's form draws its match fields as one condition builder
 * (RuleCriteriaModelForm), and every page with a form reaches ModelForm: the
 * sign-in pages' and a status page's forms, which are never a rule's,
 * downloaded the builder with the checks of a pattern and their sentences,
 * some 80 KB before gzip of their first load
 * (packages/Common/Scripts/first-load-budgets.js). It is a file of its own
 * now (LazyRuleCriteriaModelForm), which a rule's form asks for as it lays
 * out its fields, and a table of rules as it draws.
 *
 * These hold that file back until the test lets it arrive, so a rule's form
 * is seen before and after, and pin the imports that keep it out of every
 * other form's first load.
 */

const UI_ROOT: string = path.resolve(__dirname, "../../../../UI");

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(UI_ROOT, file), "utf8");
};

interface HeldLoad {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

// What the real load would have done: LazyLibrary.load, not held back.
const realLoad: () => Promise<unknown> = LazyLibrary.prototype.load;
const realGetLoaded: () => unknown = LazyLibrary.prototype.getLoaded;

// The rule criteria form's file, asked for and not yet let arrive.
let held: Array<HeldLoad> = [];
// How often its file was asked for.
let asked: number = 0;
// Set when a test has its file there already.
let alreadyLoaded: RuleCriteriaModelFormLibrary | null = null;

const LOADED: RuleCriteriaModelFormLibrary = {
  replaceLegacyRuleCriteriaFields: replaceLegacyRuleCriteriaFields,
};

const tick: () => Promise<void> = async (): Promise<void> => {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await tick();
    await tick();
  });
};

// Lets its file arrive.
const arrive: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      (held.shift() as HeldLoad).resolve(LOADED);
      await tick();
    }

    await tick();
  });
};

const failLoad: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      (held.shift() as HeldLoad).reject(
        new Error("The file could not be read"),
      );
    }

    await tick();
  });
};

beforeEach(() => {
  held = [];
  asked = 0;
  alreadyLoaded = null;

  jest.spyOn(LazyLibrary.prototype, "getLoaded").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): unknown {
    if (this === (ruleCriteriaModelForm as LazyLibrary<unknown>)) {
      return alreadyLoaded;
    }

    return realGetLoaded.call(this);
  });

  jest.spyOn(LazyLibrary.prototype, "load").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): Promise<unknown> {
    if (this !== (ruleCriteriaModelForm as LazyLibrary<unknown>)) {
      return realLoad.call(this);
    }

    asked = asked + 1;

    if (alreadyLoaded) {
      return Promise.resolve(alreadyLoaded);
    }

    return new Promise(
      (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => {
        held.push({ resolve, reject });
      },
    );
  });

  TabMemory.remove(CHUNK_LOAD_RELOAD_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const RULE_STEPS: Array<FormStep<IncidentPrivacyRule>> = [
  { id: "match-criteria", title: "Match" },
  { id: "name", title: "Name" },
];

// A rule's form: a match field on the "match-criteria" step, and its name.
const RULE_FIELDS: Fields<IncidentPrivacyRule> = [
  {
    field: { incidentTitlePattern: true },
    title: "Incident Title",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
    showEvenIfPermissionDoesNotExist: true,
  },
  {
    field: { name: true },
    title: "Name",
    stepId: "name",
    fieldType: FormFieldSchemaType.Text,
    showEvenIfPermissionDoesNotExist: true,
  },
];

const renderRuleForm: () => void = (): void => {
  render(
    <ModelForm<IncidentPrivacyRule>
      modelType={IncidentPrivacyRule}
      id="incident-privacy-rule-form"
      name="Incident Privacy Rule"
      fields={RULE_FIELDS}
      steps={RULE_STEPS}
      formType={FormType.Create}
      createOrUpdateApiUrl={URL.fromString("https://oneuptime.test/api/rule")}
      submitButtonText="Create Incident Privacy Rule"
    />,
  );
};

describe("a rule's form and the condition builder's file", () => {
  test("asks for it as it opens, shows its loader until the file arrives, then draws the builder in place of the match fields", async () => {
    renderRuleForm();
    await settle();

    expect(asked).toBeGreaterThan(0);
    expect(held.length).toBeGreaterThan(0);
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("rule-criteria-builder")).toBeNull();
    // Not the match field it stands for, drawn as a plain text field.
    expect(screen.queryByText("Incident Title")).toBeNull();

    await arrive();

    expect(
      await screen.findByTestId("rule-criteria-builder"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });

  test("once its file is there, draws the builder with no loader in between", async () => {
    alreadyLoaded = LOADED;

    renderRuleForm();

    // No loader, even before the fields are laid out.
    expect(screen.queryByTestId("bar-loader")).toBeNull();

    await settle();

    expect(screen.getByTestId("rule-criteria-builder")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(held).toHaveLength(0);
  });

  test("if its file does not arrive, says so where the form would be, and draws no match field", async () => {
    renderRuleForm();
    await settle();

    await failLoad();

    expect(
      await screen.findByText("This couldn't be loaded."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
      "data-variant",
      "part",
    );
    expect(screen.getByTestId("chunk-load-recovery-reload")).toBeEnabled();
    expect(screen.queryByTestId("rule-criteria-builder")).toBeNull();
    expect(screen.queryByText("Incident Title")).toBeNull();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });
});

describe("a form that is not a rule's", () => {
  test("never asks for the condition builder's file, and draws its fields at once", async () => {
    render(
      <ModelForm<Label>
        modelType={Label}
        id="label-form"
        name="Label"
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            showEvenIfPermissionDoesNotExist: true,
          },
        ]}
        formType={FormType.Create}
        createOrUpdateApiUrl={URL.fromString(
          "https://oneuptime.test/api/label",
        )}
        submitButtonText="Create Label"
      />,
    );
    await settle();

    expect(asked).toBe(0);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });
});

// A table's rows, as the API answers: none, so nothing reaches the network.
const NO_ROWS_API: typeof ModelAPI = {
  getList: async (data: {
    skip: number;
    limit: number;
  }): Promise<{
    data: Array<unknown>;
    count: number;
    skip: number;
    limit: number;
  }> => {
    return { data: [], count: 0, skip: data.skip, limit: data.limit };
  },
} as unknown as typeof ModelAPI;

describe("a table of rules", () => {
  test("asks for the condition builder's file as it draws, so a rule's form it opens has it", async () => {
    render(
      <ModelTable<IncidentPrivacyRule>
        modelType={IncidentPrivacyRule}
        modelAPI={NO_ROWS_API}
        id="incident-privacy-rules-table"
        userPreferencesKey="incident-privacy-rules-table"
        name="Incident Privacy Rules"
        isCreateable={false}
        isEditable={false}
        isDeleteable={false}
        isViewable={false}
        cardProps={{ title: "Incident Privacy Rules", description: "" }}
        formFields={RULE_FIELDS}
        columns={[]}
        filters={[]}
        noItemsMessage="No rules."
        showRefreshButton={false}
      />,
    );
    await settle();

    expect(asked).toBeGreaterThan(0);
  });

  test("a table of anything else does not", async () => {
    render(
      <ModelTable<Label>
        modelType={Label}
        modelAPI={NO_ROWS_API}
        id="labels-table"
        userPreferencesKey="labels-table"
        name="Labels"
        isCreateable={false}
        isEditable={false}
        isDeleteable={false}
        isViewable={false}
        cardProps={{ title: "Labels", description: "" }}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
          },
        ]}
        columns={[]}
        filters={[]}
        noItemsMessage="No labels."
        showRefreshButton={false}
      />,
    );
    await settle();

    expect(asked).toBe(0);
  });
});

describe("the imports that keep the condition builder out of every other form's first load", () => {
  test("ModelForm asks whether a form is a rule's from RuleCriteriaLegacyFields, and loads the builder through LazyRuleCriteriaModelForm", () => {
    const source: string = read("Components/Forms/ModelForm.tsx");

    expect(source).toMatch(
      /from "\.\.\/RuleCriteria\/RuleCriteriaLegacyFields";/,
    );
    expect(source).toMatch(
      /from "\.\.\/RuleCriteria\/LazyRuleCriteriaModelForm";/,
    );
    expect(source).not.toMatch(/RuleCriteria\/RuleCriteriaModelForm"/);
    expect(source).not.toMatch(/RuleCriteria\/RuleCriteriaFields"/);
    expect(source).not.toMatch(/RuleCriteria\/RuleCriteriaBuilder"/);
  });

  test("ModelTable asks the same, and loads nothing of the builder statically", () => {
    const source: string = read("Components/ModelTable/ModelTable.tsx");

    expect(source).toContain(
      'import { shouldUseRuleCriteriaBuilder } from "../RuleCriteria/RuleCriteriaLegacyFields";',
    );
    expect(source).toContain(
      'import { loadRuleCriteriaModelForm } from "../RuleCriteria/LazyRuleCriteriaModelForm";',
    );
    expect(source).not.toMatch(/RuleCriteria\/RuleCriteriaModelForm"/);
  });

  test("LazyRuleCriteriaModelForm reads the form's types, and loads it only with import()", () => {
    const source: string = read(
      "Components/RuleCriteria/LazyRuleCriteriaModelForm.ts",
    );

    const staticImports: Array<string> = Array.from(
      source.matchAll(/^import[^;]*from "\.\/RuleCriteriaModelForm";$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });

    expect(staticImports).toEqual([
      'import type { replaceLegacyRuleCriteriaFields } from "./RuleCriteriaModelForm";',
    ]);
    expect(source).toContain('import("./RuleCriteriaModelForm")');
  });

  test("RuleCriteriaLegacyFields imports nothing of the builder, its fields' checks or the patterns they read", () => {
    const source: string = read(
      "Components/RuleCriteria/RuleCriteriaLegacyFields.ts",
    );

    for (const heavy of [
      "./RuleCriteriaModelForm",
      "./RuleCriteriaFields",
      "./RuleCriteriaBuilder",
      "RulePatternMatchUtil",
      "LinearRegExp",
    ]) {
      expect({ heavy, imported: source.includes(heavy) }).toEqual({
        heavy,
        imported: false,
      });
    }
  });
});
