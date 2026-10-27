import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";

/*
 * Incidents → AI → Settings → More settings → Postmortem rules: which
 * resolved incidents OneUptime AI drafts a postmortem for, and the
 * templates each draft follows - "rules, like investigation rules".
 *
 * Only the props the table hands to ModelTable are under test, so the table
 * is captured instead of rendered: a drag-ordered list (the first rule that
 * matches decides), a form that asks what the rule matches - an incident
 * AI rule's conditions, drawn as one conditions builder - then the Draft
 * step (templates, and a name that follows them), and, below the plan
 * postmortem templates need, no template at all.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

/*
 * Whether the project is known to be below a plan: on OneUptime Cloud, a
 * project on the Free plan cannot read postmortem templates.
 */
let mockIsBelowTemplatePlan: boolean = false;
const mockBelowPlanAsked: Array<unknown> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterpriseEligibility",
  () => {
    return {
      __esModule: true,
      isKnownToBeBelowPlan: (plan: unknown): boolean => {
        mockBelowPlanAsked.push(plan);
        return mockIsBelowTemplatePlan;
      },
    };
  },
);

import AIPostmortemRulesTable from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AIPostmortemRulesTable";
import AiRulesTable from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRulesTable";
import {
  AI_LANE_AI_RULES_TABLE_ID,
  AI_POSTMORTEM_RULES_TABLE_ID,
  AiLane,
  AiLaneAdvancedCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  POSTMORTEM_RULE_MORE_TEMPLATES,
  POSTMORTEM_RULE_NAME_DESCRIPTION,
  POSTMORTEM_RULE_STANDARD_OUTLINE,
  POSTMORTEM_RULE_STANDARD_OUTLINE_NAME,
  POSTMORTEM_RULE_TEMPLATES_DESCRIPTION,
  POSTMORTEM_RULES_CARD_DESCRIPTION,
  POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES,
  POSTMORTEM_RULES_NO_ITEMS_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/PostmortemRulesCopy";
import {
  POSTMORTEM_RULE_TEMPLATE_TEST_ID,
  POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME,
  POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/PostmortemRuleTemplates";
import {
  FILLED_IN_RULE_NAME_KEY,
  RULE_NAME_MAX_LENGTH,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";
import AIPostmortemRule from "../../../Models/DatabaseModels/AIPostmortemRule";
import IncidentPostmortemTemplate from "../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { DropdownChange } from "../../../UI/Components/Dropdown/DropdownChange";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { RULE_LLM_PROVIDER_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/RuleLlmProviderCopy";
import {
  OPUS_PROVIDER,
  mockRuleLlmProviders,
  projectProvidersAnswer,
} from "./RuleLlmProviderFixtures";

// ModelAPI.count spied on, as jest-mock's spyOn types it.
type CountSpy = SpyInstance<
  (
    ...args: Parameters<typeof ModelAPI.count>
  ) => ReturnType<typeof ModelAPI.count>
>;

type NameFollow = (
  value: unknown,
  currentValues: Record<string, unknown>,
  setNewFormValues: (values: Record<string, unknown>) => void,
  change?: DropdownChange | undefined,
) => void;

interface CapturedField {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  stepId?: string;
  fieldType?: FormFieldSchemaType;
  required?: boolean;
  placeholder?: string;
  hideColumnDescription?: boolean;
  doNotShowWhenCreating?: boolean;
  collapsibleSection?: unknown;
  validation?: { minLength?: number; maxLength?: number };
  onChange?: NameFollow;
  dropdownModal?: {
    type?: unknown;
    labelField?: string;
    valueField?: string;
    sort?: Record<string, unknown>;
  };
}

interface CapturedColumn {
  field?: Record<string, unknown>;
  title?: string;
  type?: FieldType;
  wrapContent?: boolean;
  wrapMaxWidthClassName?: string;
  contentClassName?: string;
  getElement?: (item: AIPostmortemRule) => React.ReactElement;
}

// A rule naming these templates, in the order they are given.
function ruleNaming(...names: Array<string>): AIPostmortemRule {
  const rule: AIPostmortemRule = new AIPostmortemRule();
  rule.postmortemTemplates = names.map(
    (name: string): IncidentPostmortemTemplate => {
      return Object.assign(new IncidentPostmortemTemplate(), {
        templateName: name,
      });
    },
  );
  return rule;
}

// The template names the Templates cell draws, top first.
function drawnTemplateNames(): Array<string> {
  return screen
    .queryAllByTestId(POSTMORTEM_RULE_TEMPLATE_TEST_ID)
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function captured(element: React.ReactElement): Record<string, unknown> {
  render(element);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

function table(): Record<string, unknown> {
  return captured(<AIPostmortemRulesTable />);
}

function fieldsOf(props: Record<string, unknown>): Array<CapturedField> {
  return (props["formFields"] || []) as Array<CapturedField>;
}

function columnsOf(props: Record<string, unknown>): Array<CapturedColumn> {
  return (props["columns"] || []) as Array<CapturedColumn>;
}

function keyOf(entry: { field?: Record<string, unknown> }): string {
  return Object.keys(entry.field || {})[0] || "";
}

function fieldNamed(
  props: Record<string, unknown>,
  key: string,
): CapturedField | undefined {
  return fieldsOf(props).find((field: CapturedField): boolean => {
    return keyOf(field) === key;
  });
}

async function fetchAndSettle(props: Record<string, unknown>): Promise<void> {
  (props["onFetchSuccess"] as (data: Array<unknown>, n: number) => void)([], 3);
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

// What a template pick tells the name: the templates picked now and before.
function picked(
  now: Array<string>,
  before: Array<string> = [],
): DropdownChange {
  const option: (label: string) => { label: string; value: string } = (
    label: string,
  ) => {
    return { label, value: `id-of-${label}` };
  };

  return {
    selectedOptions: now.map(option),
    previousOptions: before.map(option),
  };
}

// The values the form holds after the picker reports `change`.
function nameAfter(
  values: Record<string, unknown>,
  change: DropdownChange,
): Record<string, unknown> | null {
  const follow: NameFollow = fieldNamed(
    table(),
    "postmortemTemplates",
  )!.onChange!;
  let written: Record<string, unknown> | null = null;

  follow(
    null,
    values,
    (next: Record<string, unknown>): void => {
      written = next;
    },
    change,
  );

  return written;
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  mockBelowPlanAsked.length = 0;
  mockIsBelowTemplatePlan = false;
  // The LLM Provider field's providers: not answered unless a test says so.
  mockRuleLlmProviders();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the postmortem rules table", () => {
  test("is a table of postmortem rules, with its own id and preferences", () => {
    const props: Record<string, unknown> = table();

    expect(props["modelType"]).toBe(AIPostmortemRule);
    expect(props["id"]).toBe(AI_POSTMORTEM_RULES_TABLE_ID);
    expect(props["userPreferencesKey"]).toBe(AI_POSTMORTEM_RULES_TABLE_ID);
    expect(AI_POSTMORTEM_RULES_TABLE_ID).toBe("ai-postmortem-rules-table");
    expect([
      AI_LANE_AI_RULES_TABLE_ID[AiLane.Incident],
      AI_LANE_AI_RULES_TABLE_ID[AiLane.Alert],
    ]).not.toContain(AI_POSTMORTEM_RULES_TABLE_ID);
    expect(props["isCreateable"]).toBe(true);
    expect(props["isEditable"]).toBe(true);
    expect(props["isDeleteable"]).toBe(true);
    // Postmortem rules are the incidents' alone: no trigger to filter by.
    expect(props["query"]).toBeUndefined();
  });

  test("is put in order by dragging: the first rule that matches decides", () => {
    const props: Record<string, unknown> = table();

    expect(props["enableDragAndDrop"]).toBe(true);
    expect(props["dragDropIndexField"]).toBe("order");
    expect(props["sortBy"]).toBe("order");
    expect(props["sortOrder"]).toBe(SortOrder.Ascending);
    // Nothing shows or asks for the number: the order is the list.
    expect(fieldNamed(props, "order")).toBeUndefined();
    expect(
      columnsOf(props).some((column: CapturedColumn): boolean => {
        return keyOf(column) === "order";
      }),
    ).toBe(false);
  });

  test("says what having no rule means, and how the order decides", () => {
    const props: Record<string, unknown> = table();

    expect(props["cardProps"]).toEqual({
      /*
       * Its place in the incident AI settings' More settings: the name the
       * folded header lists it by, so a link to it lands on the card.
       */
      id: AiLaneAdvancedCard.PostmortemRules,
      title: "Postmortem rules",
      description: POSTMORTEM_RULES_CARD_DESCRIPTION,
    });
    expect(POSTMORTEM_RULES_CARD_DESCRIPTION).toBe(
      "With no rule, OneUptime AI drafts a postmortem for every resolved incident. Add rules to draft only for matching incidents, in the templates you choose. The first rule that matches decides - drag to reorder.",
    );
    // Two lines beside the card's title, as every card's description.
    expect(POSTMORTEM_RULES_CARD_DESCRIPTION.length).toBeLessThanOrEqual(210);
    expect(props["noItemsMessage"]).toBe(POSTMORTEM_RULES_NO_ITEMS_MESSAGE);
    expect(POSTMORTEM_RULES_NO_ITEMS_MESSAGE).toBe(
      "No rules. Every resolved incident gets a postmortem draft.",
    );
  });

  test("lists each rule's name, templates and status; its conditions are drawn by the table", () => {
    const columns: Array<CapturedColumn> = columnsOf(table());

    expect(
      columns.map((column: CapturedColumn): [string, string] => {
        return [keyOf(column), column.title || ""];
      }),
    ).toEqual([
      ["name", "Name"],
      ["postmortemTemplates", "Templates"],
      ["isEnabled", "Status"],
    ]);

    // The template names are read through the relation.
    expect(columns[1]!.field).toEqual({
      postmortemTemplates: { templateName: true },
    });
    expect(columns[1]!.type).toBe(FieldType.EntityArray);
  });

  test("fits beside the side menu at 1280px: a name runs onto more lines, and the templates are capped", () => {
    const columns: Array<CapturedColumn> = columnsOf(table());

    /*
     * The name is what tells rules apart: cut short on one line, every
     * name in the narrow column read "Draft with Database...".
     */
    expect(columns[0]!.wrapContent).toBe(true);

    /*
     * The templates take no more than their cap - through the wrapping
     * option, the one way a table caps a column - so Status stays in
     * sight instead of scrolling off the card.
     */
    expect(columns[1]!.wrapContent).toBe(true);
    expect(columns[1]!.wrapMaxWidthClassName).toBe(
      POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME,
    );
    expect(POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME).toBe(
      "max-w-[10rem] 2xl:max-w-[18rem]",
    );

    /*
     * Both narrow to 8rem, not a column of prose's 10rem: at 10rem the
     * table ran past its card at 1280px in German and Russian. A floor,
     * never a cap.
     */
    expect(POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME).toBe("min-w-[8rem]");
    expect(columns[0]!.contentClassName).toBe(
      POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME,
    );
    expect(columns[1]!.contentClassName).toBe(
      POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME,
    );

    // Status stays a one-line pill.
    expect(columns[2]!.wrapContent).toBeUndefined();
  });

  test("the Templates column lists a rule's templates one a line, by name", () => {
    const templatesColumn: CapturedColumn = columnsOf(table())[1]!;

    render(
      templatesColumn.getElement!(
        ruleNaming("Security incident", " Database outage ", ""),
      ),
    );

    // Trimmed, blanks left out, sorted - as the server reads them.
    expect(drawnTemplateNames()).toEqual([
      "Database outage",
      "Security incident",
    ]);
    // Each on a line of its own, not run together with commas.
    expect(screen.queryByText(/, /)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("after three templates, a button says how many more and shows them", () => {
    const templatesColumn: CapturedColumn = columnsOf(table())[1]!;

    render(
      templatesColumn.getElement!(
        ruleNaming(
          "Third-party provider outage",
          "Customer-facing outage",
          "Payments outage",
          "Database outage",
          "Network partition",
        ),
      ),
    );

    expect(drawnTemplateNames()).toEqual([
      "Customer-facing outage",
      "Database outage",
      "Network partition",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "2 more templates" }));

    expect(drawnTemplateNames()).toEqual([
      "Customer-facing outage",
      "Database outage",
      "Network partition",
      "Payments outage",
      "Third-party provider outage",
    ]);
    expect(
      screen.queryByRole("button", { name: "2 more templates" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less" })).toBeVisible();
  });

  /*
   * A cell's list never folds a single item behind "1 more": its button
   * takes a line of its own, a taller one than the item it would hide
   * (TableColumnListComponent, OneUptime issue #5187). So a fourth template
   * is shown, and the count is said through the plural sentences, which
   * keep their "one" form for the languages whose "one" is more than 1.
   */
  test("a fourth template is shown rather than folded behind '1 more template'", () => {
    const templatesColumn: CapturedColumn = columnsOf(table())[1]!;

    render(templatesColumn.getElement!(ruleNaming("A", "B", "C", "D")));

    expect(drawnTemplateNames()).toEqual(["A", "B", "C", "D"]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(POSTMORTEM_RULE_MORE_TEMPLATES).toEqual({
      one: "{{count}} more template",
      other: "{{count}} more templates",
    });
  });

  test("a rule that names no template says the draft follows the standard outline", () => {
    const templatesColumn: CapturedColumn = columnsOf(table())[1]!;

    render(templatesColumn.getElement!(new AIPostmortemRule()));
    expect(screen.getByText(POSTMORTEM_RULE_STANDARD_OUTLINE)).toHaveClass(
      "text-gray-500",
    );
    expect(drawnTemplateNames()).toEqual([]);

    cleanup();

    // Templates deleted since, or blank: the same.
    render(templatesColumn.getElement!(ruleNaming(" ", "")));
    expect(
      screen.getByText(POSTMORTEM_RULE_STANDARD_OUTLINE),
    ).toBeInTheDocument();
  });

  test("the Status column says Enabled or Disabled", () => {
    const status: CapturedColumn = columnsOf(table())[2]!;

    render(
      status.getElement!(
        Object.assign(new AIPostmortemRule(), { isEnabled: true }),
      ),
    );
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    cleanup();

    render(
      status.getElement!(
        Object.assign(new AIPostmortemRule(), { isEnabled: false }),
      ),
    );
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});

describe("the postmortem rule form", () => {
  test("asks what the rule matches, then how the draft is written", () => {
    const props: Record<string, unknown> = table();

    expect(props["formSteps"]).toEqual([
      { title: "Match", id: "match-criteria" },
      { title: "Draft", id: "postmortem-draft" },
    ]);
    expect(
      fieldsOf(props).map((field: CapturedField): [string, string] => {
        return [keyOf(field), field.stepId || ""];
      }),
    ).toEqual([
      ["monitors", "match-criteria"],
      ["incidentSeverities", "match-criteria"],
      ["labels", "match-criteria"],
      ["monitorLabels", "match-criteria"],
      ["titlePattern", "match-criteria"],
      ["descriptionPattern", "match-criteria"],
      ["postmortemTemplates", "postmortem-draft"],
      ["name", "postmortem-draft"],
      ["isEnabled", "postmortem-draft"],
      ["llmProviderId", "postmortem-draft"],
      ["description", "postmortem-draft"],
    ]);
  });

  test("its conditions are an incident AI rule's, read the same way", () => {
    const postmortem: Array<CapturedField> = fieldsOf(table()).filter(
      (field: CapturedField): boolean => {
        return field.stepId === "match-criteria";
      },
    );
    const aiRule: Array<CapturedField> = fieldsOf(
      captured(<AiRulesTable lane={AiLane.Incident} />),
    ).filter((field: CapturedField): boolean => {
      return field.stepId === "match-criteria";
    });

    expect(
      postmortem.map((field: CapturedField) => {
        return [keyOf(field), field.title, field.fieldType];
      }),
    ).toEqual(
      aiRule.map((field: CapturedField) => {
        return [keyOf(field), field.title, field.fieldType];
      }),
    );

    expect(
      postmortem.map((field: CapturedField): unknown => {
        return field.dropdownModal?.type;
      }),
    ).toEqual([Monitor, IncidentSeverity, Label, Label, undefined, undefined]);

    for (const field of postmortem) {
      expect([keyOf(field), field.required]).toEqual([keyOf(field), false]);
    }
  });

  test("picks the project's postmortem templates by name, none needed", () => {
    const templates: CapturedField = fieldNamed(
      table(),
      "postmortemTemplates",
    )!;

    expect(templates.title).toBe("Templates");
    expect(templates.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(templates.dropdownModal).toEqual({
      type: IncidentPostmortemTemplate,
      labelField: "templateName",
      valueField: "_id",
      sort: { templateName: SortOrder.Ascending },
    });
    expect(templates.required).toBe(false);
    // What none means, said where none is picked.
    expect(templates.placeholder).toBe("Standard outline");
    expect(templates.description).toBe(POSTMORTEM_RULE_TEMPLATES_DESCRIPTION);
    expect(POSTMORTEM_RULE_TEMPLATES_DESCRIPTION).toBe(
      "Leave empty for OneUptime AI's standard outline. With more than one, OneUptime AI picks the one that fits the incident best.",
    );
  });

  test("a new rule is named after the standard outline, starts on, and folds its description away", () => {
    const props: Record<string, unknown> = table();
    const name: CapturedField = fieldNamed(props, "name")!;
    const enabled: CapturedField = fieldNamed(props, "isEnabled")!;
    const description: CapturedField = fieldNamed(props, "description")!;

    expect(props["createInitialValues"]).toEqual({
      name: POSTMORTEM_RULE_STANDARD_OUTLINE_NAME,
    });
    expect(POSTMORTEM_RULE_STANDARD_OUTLINE_NAME).toBe(
      "Draft with the standard outline",
    );
    expect(name.required).toBe(true);
    expect(name.description).toBe(POSTMORTEM_RULE_NAME_DESCRIPTION);
    expect(name.hideColumnDescription).toBe(true);
    expect(name.validation).toEqual({
      minLength: 2,
      maxLength: RULE_NAME_MAX_LENGTH,
    });
    expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(enabled.doNotShowWhenCreating).toBe(true);
    expect(description.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(description.collapsibleSection).toBeDefined();
    expect(description.required).toBe(false);
  });

  test("the name follows the templates picked", () => {
    expect(
      nameAfter(
        { name: POSTMORTEM_RULE_STANDARD_OUTLINE_NAME },
        picked(["Database outage"]),
      ),
    ).toEqual(
      expect.objectContaining({
        name: "Draft with Database outage",
        [FILLED_IN_RULE_NAME_KEY]: "Draft with Database outage",
      }),
    );

    expect(
      nameAfter(
        {
          name: "Draft with Database outage",
          [FILLED_IN_RULE_NAME_KEY]: "Draft with Database outage",
        },
        picked(["Database outage", "Security incident"], ["Database outage"]),
      )?.["name"],
    ).toBe("Draft with Database outage, Security incident");
  });

  test("taking every template away names the rule after the standard outline again", () => {
    expect(
      nameAfter(
        {
          name: "Draft with Database outage",
          [FILLED_IN_RULE_NAME_KEY]: "Draft with Database outage",
        },
        picked([], ["Database outage"]),
      )?.["name"],
    ).toBe(POSTMORTEM_RULE_STANDARD_OUTLINE_NAME);
  });

  test("a name somebody typed is kept, whatever is picked", () => {
    expect(
      nameAfter(
        { name: "SEV1 database incidents" },
        picked(["Database outage"]),
      ),
    ).toBeNull();
  });

  test("an edited rule never renamed follows its templates too", () => {
    expect(
      nameAfter(
        { name: "Draft with Database outage" },
        picked(["Security incident"], ["Database outage"]),
      )?.["name"],
    ).toBe("Draft with Security incident");
  });

  test("a long list is named as far as it fits, then counted", () => {
    const names: Array<string> = [
      "Customer-facing outage with data loss",
      "Database replication failure",
      "Security incident with exposure",
      "Third-party provider outage",
    ];
    const written: Record<string, unknown> | null = nameAfter(
      { name: POSTMORTEM_RULE_STANDARD_OUTLINE_NAME },
      picked(names),
    );
    const name: string = String(written?.["name"]);

    expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name.startsWith("Draft with Customer-facing outage")).toBe(true);
    expect(name).toMatch(/and \d+ more$/);
  });
});

/*
 * The LLM provider OneUptime AI drafts with (Common/Types/AI/
 * LlmProviderChoice): first under the rule's More fields, with the
 * description - empty is the default provider, which the folded line names.
 */
describe("the LLM provider a postmortem rule drafts with", () => {
  interface ProviderField {
    title?: string;
    description?: string;
    hideOptionalLabel?: boolean;
    collapsibleSection?: {
      title: string;
      getSummary?: (values: Record<string, unknown>) => unknown;
    };
    getFoldedValue?: (values: Record<string, unknown>) => string | null;
  }

  function providerField(props: Record<string, unknown>): ProviderField {
    return fieldNamed(props, "llmProviderId") as unknown as ProviderField;
  }

  test("is first under More fields, with the description, and the line every rule has", () => {
    const props: Record<string, unknown> = table();
    const field: ProviderField = providerField(props);

    expect(field.title).toBe("LLM Provider");
    expect(field.description).toBe(RULE_LLM_PROVIDER_FIELD_COPY.description);
    expect(field.hideOptionalLabel).toBe(true);
    expect(field.collapsibleSection).toBe(
      fieldNamed(props, "description")!.collapsibleSection,
    );
    expect(field.collapsibleSection!.title).toBe("More fields");
  });

  test("folded, says which provider drafts: the project's default by name, or the rule's pick", async () => {
    mockRuleLlmProviders(projectProvidersAnswer());

    await act(async () => {
      table();
    });

    const field: ProviderField = providerField(
      mockCapturedTableProps[mockCapturedTableProps.length - 1]!,
    );

    expect(field.collapsibleSection!.getSummary!({})).toEqual([
      "The rule uses the project's default LLM provider, Azure GPT-4o.",
    ]);
    expect(
      field.collapsibleSection!.getSummary!({
        llmProviderId: OPUS_PROVIDER.id,
      }),
    ).toBeUndefined();
    expect(field.getFoldedValue!({ llmProviderId: OPUS_PROVIDER.id })).toBe(
      "Claude Opus",
    );
  });

  test("before the providers are read, the folded line says nothing of them", () => {
    const field: ProviderField = providerField(table());

    expect(field.collapsibleSection!.getSummary!({})).toBeUndefined();
  });
});

describe("below the plan postmortem templates need", () => {
  beforeEach(() => {
    mockIsBelowTemplatePlan = true;
  });

  test("asks about the plan postmortem templates need", () => {
    table();

    expect(mockBelowPlanAsked).toContain(PlanType.Growth);
  });

  test("offers no template, lists none, and says nothing about them", () => {
    const props: Record<string, unknown> = table();

    expect(fieldNamed(props, "postmortemTemplates")).toBeUndefined();
    expect(
      columnsOf(props).map((column: CapturedColumn): string => {
        return keyOf(column);
      }),
    ).toEqual(["name", "isEnabled"]);
    expect(props["cardProps"]).toEqual({
      id: AiLaneAdvancedCard.PostmortemRules,
      title: "Postmortem rules",
      description: POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES,
    });
    expect(POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES).not.toContain(
      "template",
    );
    // A rule is still a name and its conditions.
    expect(fieldNamed(props, "name")?.description).toBe("");
    /*
     * And the name needs no help: the column's own description, "Name of
     * this postmortem rule.", would only repeat the title under it.
     */
    expect(fieldNamed(props, "name")?.hideColumnDescription).toBe(true);
    expect(fieldNamed(props, "name")?.required).toBe(true);
    expect(fieldNamed(props, "monitors")?.stepId).toBe("match-criteria");
  });
});

describe("the folded header's count", () => {
  test("after every read, reports how many of its rules are enabled - every postmortem rule is an incident's", async () => {
    const count: CountSpy = jest
      .spyOn(ModelAPI, "count")
      .mockResolvedValue(2 as never);
    const reported: Array<number> = [];

    await fetchAndSettle(
      captured(
        <AIPostmortemRulesTable
          onRulesLoaded={(rules: number) => {
            reported.push(rules);
          }}
        />,
      ),
    );

    expect(count).toHaveBeenCalledWith({
      modelType: AIPostmortemRule,
      query: { isEnabled: true },
    });
    expect(reported).toEqual([2]);
  });

  test("a page that does not listen is never counted for", async () => {
    const count: CountSpy = jest
      .spyOn(ModelAPI, "count")
      .mockResolvedValue(2 as never);

    await fetchAndSettle(table());

    expect(count).not.toHaveBeenCalled();
  });

  test("says nothing about its rules when it cannot count them", async () => {
    jest
      .spyOn(ModelAPI, "count")
      .mockRejectedValue(new Error("offline") as never);
    const reported: Array<number> = [];

    await fetchAndSettle(
      captured(
        <AIPostmortemRulesTable
          onRulesLoaded={(rules: number) => {
            reported.push(rules);
          }}
        />,
      ),
    );

    expect(reported).toEqual([]);
  });
});
