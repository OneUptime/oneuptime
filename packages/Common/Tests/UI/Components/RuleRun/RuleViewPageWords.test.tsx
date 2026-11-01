import CloudResourceOwnerRule from "../../../../Models/DatabaseModels/CloudResourceOwnerRule";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import RuleCriteriaSubject from "../../../../Types/Rules/RuleCriteriaSubject";
import { RuleRunResourceNouns } from "../../../../Types/Rules/RuleRun";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleView, {
  ComponentProps as RuleViewProps,
  RuleWording,
} from "../../../../UI/Components/RuleRun/RuleView";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A rule's own page names the rule, its records and its run as the page
 * that lists it does. On App Platforms the cloud rules are Cloud
 * Environment Owner Rules about cloud environments, while the model says
 * Cloud Resource: its Edit and Delete say the page's name, its conditions
 * and edit form say "cloud environments", and Run Now says what it runs
 * over - the rule's own rows once it is read (a rule made for both
 * products runs over both), the page's until then. A rule made for both
 * products wears its pill beside the Edit button. Without any of it, the
 * page is as it always was.
 */

const mockDetailProps: Array<Record<string, any>> = [];
const mockDeleteProps: Array<Record<string, any>> = [];
const mockModalProps: Array<Record<string, any>> = [];

jest.mock("../../../../UI/Components/ModelDetail/CardModelDetail", () => {
  const mockReact: typeof React = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      mockDetailProps.push(props);
      return mockReact.createElement("div", { "data-testid": "rule-detail" });
    },
  };
});

jest.mock("../../../../UI/Components/ModelDelete/ModelDelete", () => {
  const mockReact: typeof React = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      mockDeleteProps.push(props);
      return mockReact.createElement("div", { "data-testid": "rule-delete" });
    },
  };
});

jest.mock("../../../../UI/Components/RuleRun/RunRuleNowModal", () => {
  const mockReact: typeof React = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      mockModalProps.push(props);
      return mockReact.createElement("div", { "data-testid": "run-modal" });
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
  getBadge: (rule: CloudResourceOwnerRule): ReactElement | null => {
    return rule.cloudResourceKind ? null : (
      <span data-testid="also-in-cloud">Also in Cloud</span>
    );
  },
  getRunNouns: (rule: CloudResourceOwnerRule): RuleRunResourceNouns => {
    return rule.cloudResourceKind ? ENVIRONMENTS : BOTH;
  },
};

// The legacy criteria fields the cloud rule pages create rules with.
const FORM_FIELDS: RuleViewProps<CloudResourceOwnerRule>["formFields"] = [
  {
    field: { nameRegexPattern: true },
    title: "Environment Name",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
    required: false,
  },
];

function lastDetailProps(): Record<string, any> {
  return mockDetailProps[mockDetailProps.length - 1]!;
}

function runNowDescription(): string {
  return screen.getByTestId("card-description").textContent || "";
}

async function viewRule<TModel extends BaseModel>(data: {
  modelType: { new (): TModel };
  props?: Partial<RuleViewProps<TModel>>;
  rule?: TModel;
}): Promise<void> {
  render(
    <RuleView<TModel>
      modelType={data.modelType}
      ruleId={new ObjectID(RULE_ID)}
      formFields={
        (data.props?.formFields ||
          FORM_FIELDS) as RuleViewProps<TModel>["formFields"]
      }
      listRoute={new Route("/dashboard/app-platforms/settings/owner-rules")}
      {...(data.props || {})}
    />,
  );

  if (data.rule) {
    const loaded: TModel = data.rule;
    await act(async () => {
      lastDetailProps()["modelDetailProps"]["onItemLoaded"](loaded);
    });
  }
}

function appPlatformsProps(): Partial<RuleViewProps<CloudResourceOwnerRule>> {
  return {
    singularName: "Cloud Environment Owner Rule",
    ruleCriteriaSubject: RuleCriteriaSubject.CloudEnvironments,
    ruleRunNouns: ENVIRONMENTS,
    ruleWording: WORDING,
  };
}

function cloudRule(
  kind: string | undefined,
  data: Partial<CloudResourceOwnerRule> = {},
): CloudResourceOwnerRule {
  return Object.assign(new CloudResourceOwnerRule(), {
    _id: RULE_ID,
    name: "Production owners",
    isEnabled: true,
    ...(kind ? { cloudResourceKind: kind } : {}),
    ...data,
  });
}

describe("a rule's own page, in the words of the page that lists it", () => {
  beforeEach(() => {
    mockDetailProps.length = 0;
    mockDeleteProps.length = 0;
    mockModalProps.length = 0;
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("edits and deletes the rule by the page's name for it", async () => {
    await viewRule({
      modelType: CloudResourceOwnerRule,
      props: appPlatformsProps(),
      rule: cloudRule("environment"),
    });

    expect(lastDetailProps()["singularName"]).toBe(
      "Cloud Environment Owner Rule",
    );
    expect(mockDeleteProps[mockDeleteProps.length - 1]!["singularName"]).toBe(
      "Cloud Environment Owner Rule",
    );
  });

  it("asks the edit form, and shows the conditions, about the page's records", async () => {
    await viewRule({
      modelType: CloudResourceOwnerRule,
      props: appPlatformsProps(),
      rule: cloudRule("environment"),
    });

    expect(lastDetailProps()["ruleCriteriaSubject"]).toBe(
      RuleCriteriaSubject.CloudEnvironments,
    );

    // A rule with no condition applies to every one of the page's records.
    const criteria: Record<string, any> = lastDetailProps()["modelDetailProps"][
      "fields"
    ].find((field: Record<string, any>) => {
      return field["title"] === "Match Criteria";
    });
    expect(criteria).toBeDefined();

    render(
      <>
        {criteria["getElement"](
          Object.assign(new CloudResourceOwnerRule(), { criteria: null }),
        )}
      </>,
    );
    expect(screen.getByText("All cloud environments")).toBeInTheDocument();
  });

  it("reads what the page says about each rule with the rule", async () => {
    await viewRule({
      modelType: CloudResourceOwnerRule,
      props: appPlatformsProps(),
    });

    expect(
      lastDetailProps()["modelDetailProps"]["selectMoreFields"],
    ).toMatchObject({ cloudResourceKind: true, name: true, isEnabled: true });
  });

  it("says Run Now runs over the page's records until the rule is read, then over the rule's", async () => {
    await viewRule({
      modelType: CloudResourceOwnerRule,
      props: appPlatformsProps(),
    });

    expect(runNowDescription()).toBe(
      "This rule runs only when a cloud environment is created. Run it now for the cloud environments that already exist.",
    );

    await act(async () => {
      lastDetailProps()["modelDetailProps"]["onItemLoaded"](
        cloudRule(undefined),
      );
    });

    // Made before Cloud and App Platforms split: it runs over both.
    expect(runNowDescription()).toBe(
      "This rule runs only when a cloud resource or environment is created. Run it now for the cloud resources and environments that already exist.",
    );

    await act(async () => {
      screen.getByRole("button", { name: "Run Now" }).click();
    });

    expect(mockModalProps[mockModalProps.length - 1]!["nouns"]).toBe(BOTH);
  });

  it("wears the page's pill beside its actions when the rule is for both products", async () => {
    await viewRule({
      modelType: CloudResourceOwnerRule,
      props: appPlatformsProps(),
      rule: cloudRule(undefined, {
        ownerUsers: [],
        ownerTeams: [{ _id: "team" } as never],
      }),
    });

    const right: ReactElement | undefined =
      lastDetailProps()["cardProps"]["rightElement"];
    expect(right).toBeDefined();

    render(<>{right}</>);
    expect(screen.getByTestId("also-in-cloud")).toHaveTextContent(
      "Also in Cloud",
    );
  });

  it("wears both pills when the rule is for both products and adds nothing", async () => {
    await viewRule({
      modelType: CloudResourceOwnerRule,
      props: appPlatformsProps(),
      rule: cloudRule(undefined, { ownerUsers: [], ownerTeams: [] }),
    });

    render(<>{lastDetailProps()["cardProps"]["rightElement"]}</>);
    expect(screen.getByTestId("also-in-cloud")).toBeInTheDocument();
    expect(screen.getByTestId("rule-adds-nothing")).toBeInTheDocument();
  });

  it("wears no pill for a rule of the page's own", async () => {
    await viewRule({
      modelType: CloudResourceOwnerRule,
      props: appPlatformsProps(),
      rule: cloudRule("environment", {
        ownerUsers: [],
        ownerTeams: [{ _id: "team" } as never],
      }),
    });

    expect(lastDetailProps()["cardProps"]["rightElement"]).toBeUndefined();
  });

  it("is the page it always was without the page's words", async () => {
    await viewRule({
      modelType: MonitorLabelRule,
      props: { formFields: [] },
      rule: Object.assign(new MonitorLabelRule(), {
        _id: RULE_ID,
        name: "Tag production",
        isEnabled: true,
        labelsToAdd: [{ _id: "label" } as never],
      }),
    });

    expect(lastDetailProps()["singularName"]).toBeUndefined();
    expect(lastDetailProps()["ruleCriteriaSubject"]).toBeUndefined();
    expect(
      mockDeleteProps[mockDeleteProps.length - 1]!["singularName"],
    ).toBeUndefined();
    expect(runNowDescription()).toBe(
      "This rule runs only when a monitor is created. Run it now for the monitors that already exist.",
    );
    expect(lastDetailProps()["cardProps"]["rightElement"]).toBeUndefined();
  });
});
