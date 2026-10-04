import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import RuleView from "../../../../UI/Components/RuleRun/RuleView";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";

/*
 * A rule's own page opens on its details card. Its description used to be
 * "Here are the details of this {{itemName}}." - the card's title already
 * names the rule - and now says what the card shows: what the rule matches
 * and what it does. Every label, owner, privacy and monitor rule page in the
 * Dashboard opens on this card (RuleTable renders it for a rule's id), so
 * the sentence is plain and names no model, which keeps it one translation
 * in every language instead of a model name glued into a sentence.
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

const DESCRIPTION: string =
  "What this rule matches, and what it does to each match.";

function lastDetailProps(): Record<string, any> {
  return mockDetailProps[mockDetailProps.length - 1]!;
}

describe("RuleView's details card", () => {
  beforeEach(() => {
    mockDetailProps.length = 0;
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says what the card shows: what the rule matches, and what it does", () => {
    render(
      <RuleView<MonitorLabelRule>
        modelType={MonitorLabelRule}
        ruleId={new ObjectID(RULE_ID)}
        formFields={[]}
        listRoute={new Route("/dashboard/rules")}
      />,
    );

    const cardProps: Record<string, any> = lastDetailProps()["cardProps"];

    expect(cardProps["description"]).toBe(DESCRIPTION);
    expect(String(cardProps["description"])).not.toMatch(/^Here\b/);
  });

  it("says the same for every kind of rule, so one translation serves all", () => {
    render(
      <RuleView<IncidentOwnerRule>
        modelType={IncidentOwnerRule}
        ruleId={new ObjectID(RULE_ID)}
        formFields={[]}
        listRoute={new Route("/dashboard/rules")}
      />,
    );

    expect(lastDetailProps()["cardProps"]["description"]).toBe(DESCRIPTION);
  });

  it("still titles the card after the rule's kind until the rule has loaded", () => {
    render(
      <RuleView<MonitorLabelRule>
        modelType={MonitorLabelRule}
        ruleId={new ObjectID(RULE_ID)}
        formFields={[]}
        listRoute={new Route("/dashboard/rules")}
      />,
    );

    expect(lastDetailProps()["cardProps"]["title"]).toBe(
      `${new MonitorLabelRule().singularName} Details`,
    );
  });
});
