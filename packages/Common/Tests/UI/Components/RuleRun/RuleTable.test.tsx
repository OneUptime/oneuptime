import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import RuleTable from "../../../../UI/Components/RuleRun/RuleTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Navigation from "../../../../UI/Utils/Navigation";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import React from "react";

/*
 * Contract under test - RuleTable, the table every runnable rule is listed in.
 *
 * It is a ModelTable with three additions for runnable rules - "Run Now" on
 * each row, "Run Now" in the bulk actions, and a View button - and one mode
 * switch: given a rule id, it renders that rule's view page with the SAME form
 * fields instead of the table. A rule that cannot be run must get none of it,
 * and a viewer who may not edit rules must not be offered a button that would
 * only be refused.
 */

const mockTableProps: Array<Record<string, any>> = [];
const mockViewProps: Array<Record<string, any>> = [];

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
      return mockReact.createElement(
        "div",
        { "data-testid": "run-rule-now-modal" },
        `${props["ruleType"]}:${props["ruleId"]}:${props["ruleName"]}`,
      );
    },
  };
});

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

const FORM_FIELDS: Array<Record<string, unknown>> = [
  { field: { name: true }, title: "Name", fieldType: "Text" },
];

function lastTableProps(): Record<string, any> {
  return mockTableProps[mockTableProps.length - 1]!;
}

function baseProps(): Record<string, any> {
  return {
    id: "rules",
    name: "Rules",
    userPreferencesKey: "rules",
    isDeleteable: true,
    isEditable: true,
    isCreateable: true,
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    formFields: FORM_FIELDS,
    formSteps: [{ title: "Basic Info", id: "basic-info" }],
    actionButtons: [
      {
        title: "Existing",
        buttonStyleType: ButtonStyleType.NORMAL,
        onClick: jest.fn(),
      },
    ],
  };
}

function actionTitles(props: Record<string, any>): Array<string> {
  return (props["actionButtons"] || []).map((button: { title: string }) => {
    return button.title;
  });
}

function bulkTitles(props: Record<string, any>): Array<string> {
  return (props["bulkActions"]?.buttons || []).map(
    (button: { title: string }) => {
      return button.title;
    },
  );
}

describe("RuleTable", () => {
  beforeEach(() => {
    mockTableProps.length = 0;
    mockViewProps.length = 0;
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds Run Now to the rows and the bulk actions of a runnable rule", () => {
    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    const props: Record<string, any> = lastTableProps();
    expect(actionTitles(props)).toEqual(["Existing", "Run Now"]);
    expect(bulkTitles(props)).toEqual(["Run Now"]);
  });

  it("opens the run modal for the row's rule", async () => {
    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    const runNow: {
      onClick: (
        item: MonitorLabelRule,
        onCompleteAction: () => void,
        onError: (error: Error) => void,
      ) => void;
    } = lastTableProps()["actionButtons"].find((button: { title: string }) => {
      return button.title === "Run Now";
    });

    const rule: MonitorLabelRule = new MonitorLabelRule();
    rule._id = RULE_ID;
    rule.name = "Tag production";
    const onCompleteAction: jest.Mock = jest.fn();

    await act(async () => {
      runNow.onClick(rule, onCompleteAction, jest.fn());
    });

    expect(onCompleteAction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("run-rule-now-modal")).toHaveTextContent(
      `MonitorLabelRule:${RULE_ID}:Tag production`,
    );
  });

  it("makes rules viewable through getRuleViewRoute", async () => {
    const viewRoute: Route = new Route(`/rules/${RULE_ID}`);

    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
        getRuleViewRoute={() => {
          return viewRoute;
        }}
      />,
    );

    const props: Record<string, any> = lastTableProps();
    expect(props["isViewable"]).toBe(true);
    await expect(props["onViewPage"](new MonitorLabelRule())).resolves.toBe(
      viewRoute,
    );
  });

  it("respects an explicit isViewable={false}", () => {
    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
        isViewable={false}
        getRuleViewRoute={() => {
          return new Route("/x");
        }}
      />,
    );

    expect(lastTableProps()["isViewable"]).toBe(false);
  });

  it("leaves a rule that cannot be run exactly as a ModelTable", () => {
    render(
      <RuleTable<IncidentOnCallRule>
        {...(baseProps() as any)}
        modelType={IncidentOnCallRule}
        getRuleViewRoute={() => {
          return new Route("/x");
        }}
      />,
    );

    const props: Record<string, any> = lastTableProps();
    expect(actionTitles(props)).toEqual(["Existing"]);
    expect(props["bulkActions"]).toBeUndefined();
    expect(props["isViewable"]).toBe(false);
  });

  it("offers nothing to a viewer the gate hides it from", () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: false });

    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    const props: Record<string, any> = lastTableProps();
    expect(actionTitles(props)).toEqual(["Existing"]);
    expect(props["bulkActions"]).toBeUndefined();
  });

  it("shows a locked Run Now, with the reason, to a viewer the gate explains itself to", () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need permission to edit monitor label rules.",
    });

    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    const runNow: { disabled: boolean; tooltip: string } = lastTableProps()[
      "actionButtons"
    ].find((button: { title: string }) => {
      return button.title === "Run Now";
    });

    expect(runNow.disabled).toBe(true);
    expect(runNow.tooltip).toBe(
      "You need permission to edit monitor label rules.",
    );
  });

  it("renders the rule's view page, with the table's own form, when given a rule id", () => {
    const listRoute: Route = new Route("/rules");

    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
        viewRuleId={new ObjectID(RULE_ID)}
        listRoute={listRoute}
      />,
    );

    expect(screen.getByTestId("rule-view")).toBeInTheDocument();
    expect(screen.queryByTestId("model-table")).not.toBeInTheDocument();

    const props: Record<string, any> = mockViewProps[0]!;
    expect(props["modelType"]).toBe(MonitorLabelRule);
    expect(props["ruleId"].toString()).toBe(RULE_ID);
    expect(props["formFields"]).toBe(FORM_FIELDS);
    expect(props["formSteps"]).toEqual([
      { title: "Basic Info", id: "basic-info" },
    ]);
    expect(props["listRoute"]).toBe(listRoute);
  });

  it("returns from a view page to the parent route when no list route is given", () => {
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(
        new Route(`/dashboard/p/monitors/settings/label-rules/${RULE_ID}`),
      );

    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
        viewRuleId={new ObjectID(RULE_ID)}
      />,
    );

    expect(mockViewProps[0]!["listRoute"].toString()).toBe(
      "/dashboard/p/monitors/settings/label-rules",
    );
  });
});
