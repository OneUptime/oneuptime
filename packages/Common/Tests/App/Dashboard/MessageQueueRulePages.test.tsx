import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The Queues label and owner rule pages. Each is one rule table that is
 * also the rule's own view page: routed as a view (ruleViewModelType set
 * to ITS model) it shows the rule named by the URL's last segment. The
 * tables are captured so the view wiring, the routes and — the part the
 * rule engines depend on — the match-criteria fields are asserted exactly.
 */

const labelRuleTableMock: MockFunction = getJestMockFunction();
const ruleTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/LabelRule/LabelRuleTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      labelRuleTableMock(props);
      return <div data-testid="label-rule-table" />;
    },
  };
});

jest.mock("../../../UI/Components/RuleRun/RuleTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      ruleTableMock(props);
      return <div data-testid="rule-table" />;
    },
  };
});

import MessageQueueLabelRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Settings/LabelRules";
import MessageQueueOwnerRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Settings/OwnerRules";
import RuleSettingsPageProps from "../../../../App/FeatureSet/Dashboard/src/Pages/RuleSettingsPageProps";
import MessageQueueLabelRule from "../../../Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "../../../Models/DatabaseModels/MessageQueueOwnerRule";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { OWNER_RULE_OWNERS_DESCRIPTION } from "../../../UI/Components/PeoplePicker/OwnersFormField";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const RULE_ID: string = "9c4a2b1e-7d3f-4e8a-9b6c-1f2e3d4c5b6a";

const MATCH_CRITERIA: Array<string> = [
  "messageQueueLabels",
  "messageQueueNamePattern",
  "messageQueueDescriptionPattern",
  "messageQueueSystemPattern",
];

type Props = Record<string, any>;

function renderPage(
  Page: React.FunctionComponent<RuleSettingsPageProps>,
  url: string,
  ruleViewModelType?: RuleSettingsPageProps["ruleViewModelType"],
): void {
  goTo(url);
  render(
    <MemoryRouter initialEntries={[url]}>
      <Page
        pageRoute={new Route(url)}
        currentProject={null}
        hasPaymentMethod={true}
        ruleViewModelType={ruleViewModelType}
      />
    </MemoryRouter>,
  );
}

function fieldsInStep(props: Props, stepId: string): Array<string> {
  return props["formFields"]
    .filter((field: Props): boolean => {
      return field["stepId"] === stepId;
    })
    .map((field: Props): string => {
      return Object.keys(field["field"])[0]!;
    });
}

beforeEach(() => {
  labelRuleTableMock.mockReset();
  ruleTableMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe.each([
  {
    name: "label rules",
    Page: MessageQueueLabelRulesPage,
    model: MessageQueueLabelRule,
    otherModel: MessageQueueOwnerRule,
    table: labelRuleTableMock,
    listPath: "settings/label-rules",
    tableId: "message-queue-label-rules-table",
    actionStep: "labels",
    /*
     * What the rule adds, then its name (filled in from it), its Enabled
     * switch (Edit only) and its description (folded): the shared form.
     */
    actionFields: ["labelsToAdd", "name", "isEnabled", "description"],
  },
  {
    name: "owner rules",
    Page: MessageQueueOwnerRulesPage,
    model: MessageQueueOwnerRule,
    otherModel: MessageQueueLabelRule,
    table: ruleTableMock,
    listPath: "settings/owner-rules",
    tableId: "message-queue-owner-rules-table",
    actionStep: "owners",
    // One picker for people and teams, in place of a dropdown for each.
    actionFields: [
      "owners",
      "name",
      "isEnabled",
      "notifyOwners",
      "description",
    ],
  },
])("the queue $name page", (page: any) => {
  const listUrl: string = `/dashboard/${PROJECT_ID}/queues/${page.listPath}`;
  const viewUrl: string = `${listUrl}/${RULE_ID}`;

  function tableProps(): Props {
    expect(page.table).toHaveBeenCalled();
    return page.table.mock.calls[page.table.mock.calls.length - 1]![0] as Props;
  }

  test("lists the rules of its own model", () => {
    renderPage(page.Page, listUrl);

    expect(tableProps()["modelType"]).toBe(page.model);
    expect(tableProps()["id"]).toBe(page.tableId);
    expect(tableProps()["userPreferencesKey"]).toBe(page.tableId);
    expect(tableProps()["isCreateable"]).toBe(true);
    expect(tableProps()["isEditable"]).toBe(true);
    expect(tableProps()["isDeleteable"]).toBe(true);
  });

  test("as the list, it views no rule", () => {
    renderPage(page.Page, listUrl);

    expect(tableProps()["viewRuleId"]).toBeUndefined();
  });

  test("routed as its own view page, it shows the rule the URL names", () => {
    renderPage(page.Page, viewUrl, page.model);

    expect(tableProps()["viewRuleId"]).toEqual(new ObjectID(RULE_ID));
  });

  test("routed as ANOTHER model's view page, it stays the list", () => {
    renderPage(page.Page, viewUrl, page.otherModel);

    expect(tableProps()["viewRuleId"]).toBeUndefined();
  });

  test("its list route and a rule's view route are the product's URLs", () => {
    renderPage(page.Page, listUrl);

    expect(String(tableProps()["listRoute"])).toBe(listUrl);

    const rule: any = new page.model();
    rule.id = new ObjectID(RULE_ID);
    expect(String(tableProps()["getRuleViewRoute"](rule))).toBe(viewUrl);
  });

  test("its match-criteria step lists exactly what the rule engine evaluates", () => {
    renderPage(page.Page, listUrl);

    expect(fieldsInStep(tableProps(), "match-criteria")).toEqual(
      MATCH_CRITERIA,
    );
    expect(
      RULE_CRITERIA_FIELDS_BY_MODEL[
        page.model.name as keyof typeof RULE_CRITERIA_FIELDS_BY_MODEL
      ],
    ).toEqual(MATCH_CRITERIA);
    expect(
      tableProps()["formSteps"].map((step: Props): string => {
        return step["id"];
      }),
    ).toEqual(["match-criteria", page.actionStep]);
  });

  test("its action step is the rule's action", () => {
    renderPage(page.Page, listUrl);

    expect(fieldsInStep(tableProps(), page.actionStep)).toEqual(
      page.actionFields,
    );
  });

  test("the labels criterion picks from the project's labels", () => {
    renderPage(page.Page, listUrl);

    const labels: Props = tableProps()["formFields"].find(
      (field: Props): boolean => {
        return Boolean(field["field"]["messageQueueLabels"]);
      },
    );
    expect(labels["dropdownModal"]).toEqual({
      type: Label,
      labelField: "name",
      valueField: "_id",
    });
    expect(labels["required"]).toBe(false);
  });

  test("the system pattern explains both spellings it is matched against", () => {
    renderPage(page.Page, listUrl);

    const system: Props = tableProps()["formFields"].find(
      (field: Props): boolean => {
        return Boolean(field["field"]["messageQueueSystemPattern"]);
      },
    );
    // The operator says it is a pattern; the criterion is the system itself.
    expect(system["title"]).toBe("Messaging System");
    expect(system["placeholder"]).toBe("^kafka$");
    expect(system["description"]).toContain("messaging.system value");
    expect(system["description"]).toContain("display name");
    for (const pattern of MATCH_CRITERIA) {
      const criterion: Props = tableProps()["formFields"].find(
        (field: Props): boolean => {
          return Boolean(field["field"][pattern]);
        },
      );
      expect(criterion["required"]).toBe(false);
    }
  });

  test("its help explains the criteria under a Match Criteria heading", () => {
    renderPage(page.Page, listUrl);

    const help: Props = tableProps()["helpContent"];
    expect(help["markdown"]).toMatch(/^### Match Criteria$/m);
    expect(help["markdown"]).toContain("**Messaging System**");
    expect(help["markdown"]).not.toContain("Messaging System Pattern");
    expect(help["markdown"]).toContain("^kafka$");
    // The naming tips sit outside the section the shared help rewrites.
    expect(help["markdown"]).toMatch(/^### Matching Discovered Queues$/m);
  });
});

describe("the owner rules page's owners", () => {
  test("people and teams are picked in one field, saved as the rule's owner columns", () => {
    renderPage(
      MessageQueueOwnerRulesPage,
      `/dashboard/${PROJECT_ID}/queues/settings/owner-rules`,
    );

    const props: Props = ruleTableMock.mock.calls[0]![0] as Props;
    const owners: Array<Props> = props["formFields"].filter(
      (field: Props): boolean => {
        return field["fieldType"] === FormFieldSchemaType.PeoplePicker;
      },
    );

    expect(owners).toHaveLength(1);
    expect(owners[0]!["stepId"]).toBe("owners");
    /*
     * A new rule that adds no owner cannot be saved; an Edit form does not
     * insist (ModelForm reads doNotRequireWhenEditing), so a rule saved
     * before the form asked can still be renamed or switched off.
     */
    expect(owners[0]!["required"]).toBe(true);
    expect(owners[0]!["doNotRequireWhenEditing"]).toBe(true);
    expect(owners[0]!["title"]).toBe("Owners");
    expect(owners[0]!["description"]).toBe(OWNER_RULE_OWNERS_DESCRIPTION);
    expect(owners[0]!["fieldType"]).toBe(FormFieldSchemaType.PeoplePicker);
    expect(owners[0]!["peoplePicker"]["kinds"]).toEqual([
      { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
      { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
    ]);

    // Both are columns of the rule, which ModelForm saves as such.
    const rule: MessageQueueOwnerRule = new MessageQueueOwnerRule();
    expect(rule.hasColumn("ownerUsers")).toBe(true);
    expect(rule.hasColumn("ownerTeams")).toBe(true);
  });

  test("owners are notified by default, which waits folded under the owners", () => {
    renderPage(
      MessageQueueOwnerRulesPage,
      `/dashboard/${PROJECT_ID}/queues/settings/owner-rules`,
    );

    const props: Props = ruleTableMock.mock.calls[0]![0] as Props;
    const notifyOwners: Props = props["formFields"].find(
      (field: Props): boolean => {
        return Boolean(field["field"]?.["notifyOwners"]);
      },
    );

    expect(notifyOwners["stepId"]).toBe("owners");
    expect(notifyOwners["fieldType"]).toBe(FormFieldSchemaType.Toggle);
    expect(notifyOwners["collapsibleSection"]).toBeDefined();
    // No default of its own: the form starts it where the server does (on).
    expect(notifyOwners["defaultValue"]).toBeUndefined();
    expect(
      new MessageQueueOwnerRule().getTableColumnMetadata("notifyOwners")
        .defaultValue,
    ).toBe(true);
    expect(fieldsInStep(props, "basic-info")).toEqual([]);
  });
});
