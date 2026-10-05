import IncidentLabelRule from "../../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import RuleTable from "../../../../UI/Components/RuleRun/RuleTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Navigation from "../../../../UI/Utils/Navigation";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import IconProp from "../../../../Types/Icon/IconProp";

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
        icon: IconProp.Play,
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

  it("starts every new rule on: the create form leaves the Enabled switch out", () => {
    const enabledField: Record<string, unknown> = {
      field: { isEnabled: true },
      title: "Enabled",
      fieldType: "Boolean",
    };

    render(
      <RuleTable<MonitorLabelRule>
        {...(baseProps() as any)}
        modelType={MonitorLabelRule}
        formFields={[...FORM_FIELDS, enabledField]}
      />,
    );

    const fields: Array<Record<string, unknown>> =
      lastTableProps()["formFields"];

    expect(fields).toHaveLength(2);
    // Every other field is handed on as it was.
    expect(fields[0]).toBe(FORM_FIELDS[0]);
    // The switch stays on the edit form only.
    expect(fields[1]).toEqual({ ...enabledField, doNotShowWhenCreating: true });
    expect(fields[1]!["doNotShowWhenEditing"]).toBeUndefined();
    expect(enabledField["doNotShowWhenCreating"]).toBeUndefined();
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

/*
 * A label or owner rule saved before the form asked what it adds may add
 * nothing: it matches and does nothing. Its Edit form lets it be renamed,
 * switched off or deleted, and its table says "Adds nothing" beside its
 * status, so it can be found (RuleAction).
 */
describe("RuleTable, for a rule that adds nothing", () => {
  const STATUS_COLUMN: Record<string, any> = {
    field: { isEnabled: true },
    title: "Status",
    type: FieldType.Boolean,
    getElement: (item: { isEnabled?: boolean }): ReactElement => {
      return <span>{item.isEnabled ? "Enabled" : "Disabled"}</span>;
    },
  };

  const NAME_COLUMN: Record<string, any> = {
    field: { name: true },
    title: "Name",
    type: FieldType.Text,
  };

  function tableProps(): Record<string, any> {
    return {
      ...baseProps(),
      selectMoreFields: { isEnabled: true },
      columns: [NAME_COLUMN, STATUS_COLUMN],
    };
  }

  function statusOf(item: Record<string, unknown>): HTMLElement {
    const status: Record<string, any> = lastTableProps()["columns"][1];
    const { container } = render(<>{status["getElement"](item)}</>);

    return container;
  }

  beforeEach(() => {
    mockTableProps.length = 0;
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    // A viewer who may read every column of the rule.
    jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("reads each label rule's labels, by id, beside what the page selects", () => {
    render(
      <RuleTable<MonitorLabelRule>
        {...(tableProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    expect(lastTableProps()["selectMoreFields"]).toEqual({
      isEnabled: true,
      labelsToAdd: { _id: true },
    });
  });

  it("reads each owner rule's people and teams", () => {
    render(
      <RuleTable<MonitorOwnerRule>
        {...(tableProps() as any)}
        modelType={MonitorOwnerRule}
      />,
    );

    expect(lastTableProps()["selectMoreFields"]).toEqual({
      isEnabled: true,
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
    });
  });

  it("reads an incident rule's inherit switches too", () => {
    render(
      <RuleTable<IncidentLabelRule>
        {...(tableProps() as any)}
        modelType={IncidentLabelRule}
      />,
    );

    expect(lastTableProps()["selectMoreFields"]).toEqual({
      isEnabled: true,
      labelsToAdd: { _id: true },
      inheritLabelsFromMonitors: true,
      inheritLabelsFromHosts: true,
      inheritLabelsFromKubernetesClusters: true,
      inheritLabelsFromDockerHosts: true,
      inheritLabelsFromPodmanHosts: true,
      inheritLabelsFromServices: true,
    });
  });

  it("says Adds nothing beside the status of a label rule with no labels", () => {
    render(
      <RuleTable<MonitorLabelRule>
        {...(tableProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    const cell: HTMLElement = statusOf({ isEnabled: true, labelsToAdd: [] });

    expect(cell).toHaveTextContent("Enabled");
    expect(within(cell).getByTestId("rule-adds-nothing")).toHaveTextContent(
      "Adds nothing",
    );
  });

  it("says it of a switched-off rule as well", () => {
    render(
      <RuleTable<MonitorOwnerRule>
        {...(tableProps() as any)}
        modelType={MonitorOwnerRule}
      />,
    );

    const cell: HTMLElement = statusOf({
      isEnabled: false,
      ownerUsers: [],
      ownerTeams: [],
    });

    expect(cell).toHaveTextContent("Disabled");
    expect(within(cell).getByTestId("rule-adds-nothing")).toBeInTheDocument();
  });

  it("draws every other row exactly as the page did", () => {
    render(
      <RuleTable<MonitorLabelRule>
        {...(tableProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    const status: Record<string, any> = lastTableProps()["columns"][1];
    const item: Record<string, unknown> = {
      isEnabled: true,
      labelsToAdd: [{ _id: "0000000a-0000-4000-8000-000000000001" }],
    };

    expect(status["getElement"](item)).toEqual(
      STATUS_COLUMN["getElement"](item),
    );
    expect(
      within(statusOf(item)).queryByTestId("rule-adds-nothing"),
    ).toBeNull();
  });

  it("never says it of a rule whose labels the table could not read", () => {
    render(
      <RuleTable<MonitorLabelRule>
        {...(tableProps() as any)}
        modelType={MonitorLabelRule}
      />,
    );

    expect(
      within(statusOf({ isEnabled: true })).queryByTestId("rule-adds-nothing"),
    ).toBeNull();
  });

  it("never says it of an incident rule that inherits", () => {
    render(
      <RuleTable<IncidentLabelRule>
        {...(tableProps() as any)}
        modelType={IncidentLabelRule}
      />,
    );

    const switchesOff: Record<string, boolean> = {
      inheritLabelsFromMonitors: false,
      inheritLabelsFromHosts: false,
      inheritLabelsFromKubernetesClusters: false,
      inheritLabelsFromDockerHosts: false,
      inheritLabelsFromPodmanHosts: false,
      inheritLabelsFromServices: false,
    };

    expect(
      within(
        statusOf({ isEnabled: true, labelsToAdd: [], ...switchesOff }),
      ).getByTestId("rule-adds-nothing"),
    ).toBeInTheDocument();

    cleanup();

    expect(
      within(
        statusOf({
          isEnabled: true,
          labelsToAdd: [],
          ...switchesOff,
          inheritLabelsFromMonitors: true,
        }),
      ).queryByTestId("rule-adds-nothing"),
    ).toBeNull();
  });

  it("leaves the page's other columns, and a status column it cannot draw into, as they were", () => {
    const plainStatus: Record<string, any> = {
      field: { isEnabled: true },
      title: "Status",
      type: FieldType.Boolean,
    };

    render(
      <RuleTable<MonitorLabelRule>
        {...(tableProps() as any)}
        columns={[NAME_COLUMN, plainStatus]}
        modelType={MonitorLabelRule}
      />,
    );

    expect(lastTableProps()["columns"][0]).toBe(NAME_COLUMN);
    expect(lastTableProps()["columns"][1]).toBe(plainStatus);
  });

  it("leaves a rule of another kind exactly as the page wrote it", () => {
    const props: Record<string, any> = tableProps();

    render(
      <RuleTable<IncidentOnCallRule>
        {...(props as any)}
        modelType={IncidentOnCallRule}
      />,
    );

    expect(lastTableProps()["selectMoreFields"]).toBe(
      props["selectMoreFields"],
    );
    expect(lastTableProps()["columns"]).toBe(props["columns"]);
  });

  /*
   * Selecting a column one may not read fails the whole list, and a rule is
   * never said to add nothing from part of what it adds: a viewer who may
   * not read all of it gets the table exactly as the page wrote it.
   */
  it("reads nothing more, and marks nothing, for a viewer who may not read all a rule adds", () => {
    jest
      .spyOn(PermissionGate, "canReadColumn")
      .mockImplementation((_model: unknown, column: string): boolean => {
        return column !== "ownerTeams";
      });

    const props: Record<string, any> = tableProps();

    render(
      <RuleTable<MonitorOwnerRule>
        {...(props as any)}
        modelType={MonitorOwnerRule}
      />,
    );

    expect(lastTableProps()["selectMoreFields"]).toBe(
      props["selectMoreFields"],
    );
    expect(lastTableProps()["columns"]).toBe(props["columns"]);
  });

  it("asks about every column the rule adds from, switches included", () => {
    const asked: Array<string> = [];

    jest
      .spyOn(PermissionGate, "canReadColumn")
      .mockImplementation((_model: unknown, column: string): boolean => {
        asked.push(column);
        return true;
      });

    render(
      <RuleTable<IncidentLabelRule>
        {...(tableProps() as any)}
        modelType={IncidentLabelRule}
      />,
    );

    expect([...new Set(asked)]).toEqual([
      "labelsToAdd",
      "inheritLabelsFromMonitors",
      "inheritLabelsFromHosts",
      "inheritLabelsFromKubernetesClusters",
      "inheritLabelsFromDockerHosts",
      "inheritLabelsFromPodmanHosts",
      "inheritLabelsFromServices",
    ]);
  });

  /*
   * The table works its columns out again whenever it is handed new ones.
   * This table draws again for its own reasons - the Run Now dialog opening
   * - and must not hand over new columns each time it does.
   */
  it("hands the table the same columns and select until the page changes them", async () => {
    const props: Record<string, any> = tableProps();

    render(
      <RuleTable<MonitorLabelRule>
        {...(props as any)}
        modelType={MonitorLabelRule}
      />,
    );

    const first: Record<string, any> = lastTableProps();

    const runNow: {
      onClick: (
        item: MonitorLabelRule,
        onCompleteAction: () => void,
        onError: (error: Error) => void,
      ) => void;
    } = first["actionButtons"].find((button: { title: string }) => {
      return button.title === "Run Now";
    });

    const rule: MonitorLabelRule = new MonitorLabelRule();
    rule._id = RULE_ID;
    rule.name = "Tag production";

    // Opening the Run Now dialog draws the table again.
    await act(async () => {
      runNow.onClick(rule, jest.fn(), jest.fn());
    });

    const second: Record<string, any> = lastTableProps();

    expect(second).not.toBe(first);
    expect(second["columns"]).toBe(first["columns"]);
    expect(second["selectMoreFields"]).toBe(first["selectMoreFields"]);
  });
});
