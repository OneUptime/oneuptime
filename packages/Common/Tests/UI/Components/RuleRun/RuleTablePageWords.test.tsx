import CloudResourceOwnerRule from "../../../../Models/DatabaseModels/CloudResourceOwnerRule";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import RuleCriteriaSubject from "../../../../Types/Rules/RuleCriteriaSubject";
import { RuleRunResourceNouns } from "../../../../Types/Rules/RuleRun";
import { RuleWording } from "../../../../UI/Components/RuleRun/RuleView";
import RuleTable from "../../../../UI/Components/RuleRun/RuleTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * A rule model two products share names its rules, their records and their
 * runs in the page's words: App Platforms lists the cloud rules as Cloud
 * Environment Owner Rules, about cloud environments, though the model says
 * Cloud Resource. RuleTable hands the page's words to every place a rule is
 * read or run from: its own page (RuleView), each row's Run Now and the
 * bulk Run Now - and a rule's own words, read from the rule, win over the
 * page's.
 */

const mockTableProps: Array<Record<string, any>> = [];
const mockViewProps: Array<Record<string, any>> = [];
const mockModalProps: Array<Record<string, any>> = [];

jest.mock("../../../../UI/Components/ModelTable/ModelTable", () => {
  const mockReact: typeof React = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      mockTableProps.push(props);
      return mockReact.createElement("div", { "data-testid": "model-table" });
    },
  };
});

jest.mock("../../../../UI/Components/RuleRun/RuleView", () => {
  const mockReact: typeof React = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      mockViewProps.push(props);
      return mockReact.createElement("div", { "data-testid": "rule-view" });
    },
  };
});

jest.mock("../../../../UI/Components/RuleRun/RunRuleNowModal", () => {
  const mockReact: typeof React = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      mockModalProps.push(props);
      return mockReact.createElement("div", {
        "data-testid": "run-rule-now-modal",
      });
    },
  };
});

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

const ENVIRONMENTS: RuleRunResourceNouns = {
  resourceSingular: "cloud environment",
  resourcePlural: "cloud environments",
};

const BOTH: RuleRunResourceNouns = {
  resourceSingular: "cloud resource or environment",
  resourcePlural: "cloud resources and environments",
};

const WORDING: RuleWording<CloudResourceOwnerRule> = {
  select: { cloudResourceKind: true },
  getBadge: (rule: CloudResourceOwnerRule) => {
    return rule.cloudResourceKind ? null : <span>Also in Cloud</span>;
  },
  getRunNouns: (rule: CloudResourceOwnerRule) => {
    return rule.cloudResourceKind ? ENVIRONMENTS : BOTH;
  },
};

function pageProps(): Record<string, any> {
  return {
    id: "app-platforms-owner-rules-table",
    name: "Settings > Cloud Environment Owner Rules",
    userPreferencesKey: "app-platforms-owner-rules-table",
    singularName: "Cloud Environment Owner Rule",
    pluralName: "Cloud Environment Owner Rules",
    isDeleteable: true,
    isEditable: true,
    isCreateable: true,
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    formFields: [{ field: { name: true }, title: "Name", fieldType: "Text" }],
    ruleCriteriaSubject: RuleCriteriaSubject.CloudEnvironments,
    ruleRunNouns: ENVIRONMENTS,
    ruleWording: WORDING,
  };
}

function lastTableProps(): Record<string, any> {
  return mockTableProps[mockTableProps.length - 1]!;
}

function runNowButton(): {
  onClick: (
    item: CloudResourceOwnerRule,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
} {
  return lastTableProps()["actionButtons"].find((button: { title: string }) => {
    return button.title === "Run Now";
  });
}

function rule(data: Partial<CloudResourceOwnerRule>): CloudResourceOwnerRule {
  return Object.assign(new CloudResourceOwnerRule(), {
    _id: RULE_ID,
    name: "Payments team owns checkout",
    ...data,
  });
}

describe("a shared rule model's page, in the page's words", () => {
  beforeEach(() => {
    mockTableProps.length = 0;
    mockViewProps.length = 0;
    mockModalProps.length = 0;
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("hands a rule's own page the rule's name, its records and its run", () => {
    render(
      <RuleTable<CloudResourceOwnerRule>
        {...(pageProps() as any)}
        modelType={CloudResourceOwnerRule}
        viewRuleId={new ObjectID(RULE_ID)}
        listRoute={new Route("/app-platforms/settings/owner-rules")}
      />,
    );

    expect(screen.getByTestId("rule-view")).toBeInTheDocument();
    const props: Record<string, any> = mockViewProps[0]!;
    expect(props["singularName"]).toBe("Cloud Environment Owner Rule");
    expect(props["ruleCriteriaSubject"]).toBe(
      RuleCriteriaSubject.CloudEnvironments,
    );
    expect(props["ruleRunNouns"]).toBe(ENVIRONMENTS);
    expect(props["ruleWording"]).toBe(WORDING);
  });

  it("keeps its own words away from the list, which takes the subject itself", () => {
    render(
      <RuleTable<CloudResourceOwnerRule>
        {...(pageProps() as any)}
        modelType={CloudResourceOwnerRule}
      />,
    );

    const props: Record<string, any> = lastTableProps();
    // The list's choice ("All cloud environments") and its criteria cells.
    expect(props["ruleCriteriaSubject"]).toBe(
      RuleCriteriaSubject.CloudEnvironments,
    );
    expect(props["singularName"]).toBe("Cloud Environment Owner Rule");
    // The table is a ModelTable: what only a rule page reads stays here.
    expect(props["ruleRunNouns"]).toBeUndefined();
    expect(props["ruleWording"]).toBeUndefined();
  });

  it("runs a row's rule in the rule's own words", async () => {
    render(
      <RuleTable<CloudResourceOwnerRule>
        {...(pageProps() as any)}
        modelType={CloudResourceOwnerRule}
      />,
    );

    await act(async () => {
      runNowButton().onClick(
        rule({ cloudResourceKind: "environment" as never }),
        jest.fn(),
        jest.fn(),
      );
    });

    expect(mockModalProps[mockModalProps.length - 1]!["nouns"]).toBe(
      ENVIRONMENTS,
    );
  });

  it("runs a rule made for both products as one over both", async () => {
    render(
      <RuleTable<CloudResourceOwnerRule>
        {...(pageProps() as any)}
        modelType={CloudResourceOwnerRule}
      />,
    );

    await act(async () => {
      runNowButton().onClick(rule({}), jest.fn(), jest.fn());
    });

    expect(mockModalProps[mockModalProps.length - 1]!["nouns"]).toBe(BOTH);
  });

  it("falls back to the page's words when the rule names none, and to the model's on a page with none", async () => {
    const props: Record<string, any> = {
      ...pageProps(),
      ruleWording: { select: {} },
    };

    render(
      <RuleTable<CloudResourceOwnerRule>
        {...(props as any)}
        modelType={CloudResourceOwnerRule}
      />,
    );

    await act(async () => {
      runNowButton().onClick(rule({}), jest.fn(), jest.fn());
    });

    expect(mockModalProps[mockModalProps.length - 1]!["nouns"]).toBe(
      ENVIRONMENTS,
    );

    cleanup();
    mockModalProps.length = 0;

    // A page that names nothing: Cloud's, whose rows are the model's own.
    const plain: Record<string, any> = pageProps();
    delete plain["ruleRunNouns"];
    delete plain["ruleWording"];

    render(
      <RuleTable<CloudResourceOwnerRule>
        {...(plain as any)}
        modelType={CloudResourceOwnerRule}
      />,
    );

    await act(async () => {
      runNowButton().onClick(rule({}), jest.fn(), jest.fn());
    });

    expect(mockModalProps[mockModalProps.length - 1]!["nouns"]).toBeUndefined();
  });

  it("asks for a bulk run in the page's words", () => {
    render(
      <RuleTable<CloudResourceOwnerRule>
        {...(pageProps() as any)}
        modelType={CloudResourceOwnerRule}
      />,
    );

    const runNow: Record<string, any> = lastTableProps()[
      "bulkActions"
    ].buttons.find((button: { title: string }) => {
      return button.title === "Run Now";
    });

    expect(runNow["confirmMessage"]([rule({}), rule({})])).toContain(
      "Run 2 selected rules on the cloud environments that already exist?",
    );
  });
});
