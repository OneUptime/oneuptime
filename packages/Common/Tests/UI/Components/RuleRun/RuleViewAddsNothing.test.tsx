import IncidentLabelRule from "../../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import Team from "../../../../Models/DatabaseModels/Team";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import RuleView from "../../../../UI/Components/RuleRun/RuleView";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A label or owner rule that adds nothing - saved before the form asked
 * what it adds - says "Adds nothing" on its own page, as it does beside its
 * status in its table: somebody who follows a link to the rule learns it
 * needs fixing too. The page's details card reads what the rule adds
 * already, for the details it shows.
 */

const mockDetailProps: Array<Record<string, any>> = [];

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
    default: () => {
      return mockReact.createElement("div", { "data-testid": "rule-delete" });
    },
  };
});

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

function lastDetailProps(): Record<string, any> {
  return mockDetailProps[mockDetailProps.length - 1]!;
}

// Renders a rule's page and hands it the rule as its card loads it.
async function viewRule<TModel extends BaseModel>(
  modelType: { new (): TModel },
  rule: TModel,
): Promise<void> {
  render(
    <RuleView<TModel>
      modelType={modelType}
      ruleId={new ObjectID(RULE_ID)}
      formFields={[]}
      listRoute={new Route("/dashboard/rules")}
    />,
  );

  await act(async () => {
    lastDetailProps()["modelDetailProps"]["onItemLoaded"](rule);
  });
}

function rightElement(): ReactElement | undefined {
  return lastDetailProps()["cardProps"]["rightElement"];
}

describe("a rule's own page", () => {
  beforeEach(() => {
    mockDetailProps.length = 0;
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("says Adds nothing beside the details of a label rule with no labels", async () => {
    await viewRule(
      MonitorLabelRule,
      Object.assign(new MonitorLabelRule(), {
        _id: RULE_ID,
        name: "Old rule",
        isEnabled: true,
        labelsToAdd: [],
      }),
    );

    expect(rightElement()).toBeDefined();

    render(<>{rightElement()}</>);

    expect(screen.getByTestId("rule-adds-nothing")).toHaveTextContent(
      "Adds nothing",
    );
  });

  it("says it of an owner rule with neither people nor teams", async () => {
    await viewRule(
      MonitorOwnerRule,
      Object.assign(new MonitorOwnerRule(), {
        _id: RULE_ID,
        name: "Old rule",
        isEnabled: false,
        ownerUsers: [],
        ownerTeams: [],
      }),
    );

    expect(rightElement()).toBeDefined();
  });

  it("says nothing of a rule that adds something", async () => {
    await viewRule(
      MonitorOwnerRule,
      Object.assign(new MonitorOwnerRule(), {
        _id: RULE_ID,
        name: "Platform owns it",
        isEnabled: true,
        ownerUsers: [],
        ownerTeams: [Object.assign(new Team(), { _id: "t" })],
      }),
    );

    expect(rightElement()).toBeUndefined();

    cleanup();
    mockDetailProps.length = 0;

    await viewRule(
      MonitorLabelRule,
      Object.assign(new MonitorLabelRule(), {
        _id: RULE_ID,
        name: "Tag production",
        isEnabled: true,
        labelsToAdd: [Object.assign(new Label(), { _id: "a" })],
      }),
    );

    expect(rightElement()).toBeUndefined();
  });

  it("says nothing of an incident rule that only inherits", async () => {
    await viewRule(
      IncidentLabelRule,
      Object.assign(new IncidentLabelRule(), {
        _id: RULE_ID,
        name: "Inherit the monitors' labels",
        isEnabled: true,
        labelsToAdd: [],
        inheritLabelsFromMonitors: true,
        inheritLabelsFromHosts: false,
        inheritLabelsFromKubernetesClusters: false,
        inheritLabelsFromDockerHosts: false,
        inheritLabelsFromPodmanHosts: false,
        inheritLabelsFromServices: false,
      }),
    );

    expect(rightElement()).toBeUndefined();
  });

  it("never guesses: says nothing before the rule loads, nor of what it did not read", async () => {
    render(
      <RuleView<MonitorLabelRule>
        modelType={MonitorLabelRule}
        ruleId={new ObjectID(RULE_ID)}
        formFields={[]}
        listRoute={new Route("/dashboard/rules")}
      />,
    );

    expect(rightElement()).toBeUndefined();

    await act(async () => {
      lastDetailProps()["modelDetailProps"]["onItemLoaded"](
        Object.assign(new MonitorLabelRule(), {
          _id: RULE_ID,
          name: "Unread labels",
          isEnabled: true,
        }),
      );
    });

    expect(rightElement()).toBeUndefined();
  });

  it("says nothing on the page of a rule of another kind", async () => {
    await viewRule(
      IncidentOnCallRule,
      Object.assign(new IncidentOnCallRule(), {
        _id: RULE_ID,
        name: "Page the DB team",
        isEnabled: true,
      }),
    );

    expect(rightElement()).toBeUndefined();
  });
});
