import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import LogPipelineProcessor from "../../../Models/DatabaseModels/LogPipelineProcessor";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import PublicNoteApprovalStep from "../../../Models/DatabaseModels/PublicNoteApprovalStep";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageHeaderLink from "../../../Models/DatabaseModels/StatusPageHeaderLink";
import {
  ListOrderFacts,
  getListOrderFacts,
  listOrderFactsToJSON,
  toListOrderProse,
} from "../../../Utils/DeveloperDocs/ListOrderFacts";
import { describe, expect, test } from "@jest/globals";

/*
 * What a drag-ordered list's number means, as the OpenAPI spec tells
 * clients on the list's tag (x-oneuptime-list-order, issue #9609) and the
 * Terraform provider writes in the Order section of the resource's page:
 * the column, which end is the top, what one row and many are called, what
 * holds the list, where a row created without a number goes, and which
 * built-in rows keep their order - read from the model and the rules of
 * its list (Common/Utils/StateOrder).
 */

type ModelType = { new (): BaseModel; name: string };

describe("toListOrderProse", () => {
  test.each([
    ["Incident Severity", "incident severity"],
    ["Incident SLA Rules", "incident SLA rules"],
    ["Postmortem Rule", "postmortem rule"],
    ["  Status Page  ", "status page"],
  ])("writes %p as %p", (name: string, prose: string) => {
    expect(toListOrderProse(name)).toBe(prose);
  });
});

describe("getListOrderFacts", () => {
  test("a project's list, counted from the top", () => {
    expect(getListOrderFacts(new IncidentSeverity())).toEqual({
      column: "order",
      descending: false,
      singular: "incident severity",
      plural: "incident severities",
      parent: "project",
    });
  });

  test("keeps a name's capitals", () => {
    expect(getListOrderFacts(new IncidentSlaRule())).toEqual(
      expect.objectContaining({
        singular: "incident SLA rule",
        plural: "incident SLA rules",
      }),
    );
  });

  test("a state: where a new one goes, and the built-in states that keep their order", () => {
    expect(getListOrderFacts(new IncidentState())).toEqual({
      column: "order",
      descending: false,
      singular: "incident state",
      plural: "incident states",
      parent: "project",
      insertsAbove: "resolved state",
      keepsInOrder: ["created state", "acknowledged state", "resolved state"],
    });

    expect(getListOrderFacts(new ScheduledMaintenanceState())).toEqual(
      expect.objectContaining({
        insertsAbove: "completed state",
        keepsInOrder: [
          "scheduled state",
          "ongoing state",
          "ended state",
          "completed state",
        ],
      }),
    );
  });

  test("a monitor status goes above the offline one; its built-ins keep no order", () => {
    const facts: ListOrderFacts = getListOrderFacts(new MonitorStatus())!;

    expect(facts.column).toBe("priority");
    expect(facts.insertsAbove).toBe("offline status");
    expect(facts.keepsInOrder).toBeUndefined();
  });

  test("security case priorities keep theirs, and a new one goes to the end", () => {
    const facts: ListOrderFacts = getListOrderFacts(
      new SecurityCasePriority(),
    )!;

    expect(facts.insertsAbove).toBeUndefined();
    expect(facts.keepsInOrder).toEqual([
      "critical priority",
      "high priority",
      "medium priority",
      "low priority",
      "informational priority",
    ]);
  });

  test("a list whose top is its highest number", () => {
    expect(getListOrderFacts(new NetworkSiteAssignmentRule())).toEqual(
      expect.objectContaining({ column: "priority", descending: true }),
    );
  });

  test("a list held by a parent names it", () => {
    expect(getListOrderFacts(new LogPipelineProcessor())).toEqual(
      expect.objectContaining({ column: "sortOrder", parent: "log pipeline" }),
    );
    expect(getListOrderFacts(new StatusPageHeaderLink())).toEqual(
      expect.objectContaining({ parent: "status page" }),
    );
  });

  test("a list split by a column of its project names the column", () => {
    expect(getListOrderFacts(new PublicNoteApprovalStep())).toEqual(
      expect.objectContaining({ parent: "project", sameAs: "event type" }),
    );
  });

  test("none for a model that is no drag-ordered list - the five numbered lists among them", () => {
    expect(getListOrderFacts(new Monitor())).toBeNull();
    expect(getListOrderFacts(new StatusPageGroup())).toBeNull();
  });

  test("every drag-ordered model has facts that read as words", () => {
    let lists: number = 0;

    for (const modelType of AllModelTypes as unknown as Array<ModelType>) {
      const model: BaseModel = new modelType();
      const facts: ListOrderFacts | null = getListOrderFacts(model);

      expect({ model: model.tableName, hasFacts: Boolean(facts) }).toEqual({
        model: model.tableName,
        hasFacts: Boolean(model.getListOrder()),
      });

      if (!facts) {
        continue;
      }

      lists++;

      expect([model.tableName, facts.column]).toEqual([
        model.tableName,
        model.getListOrder()!.column,
      ]);

      for (const words of [facts.singular, facts.plural, facts.parent]) {
        expect([model.tableName, words]).toEqual([
          model.tableName,
          expect.stringMatching(/^[a-z][A-Za-z ]*[a-z]$/),
        ]);
      }
    }

    expect(lists).toBeGreaterThan(30);
  });
});

describe("listOrderFactsToJSON", () => {
  test("writes what is known, and leaves out what is not", () => {
    expect(
      listOrderFactsToJSON(getListOrderFacts(new IncidentSeverity())!),
    ).toEqual({
      column: "order",
      descending: false,
      singular: "incident severity",
      plural: "incident severities",
      parent: "project",
    });

    expect(
      listOrderFactsToJSON(getListOrderFacts(new PublicNoteApprovalStep())!),
    ).toEqual(expect.objectContaining({ sameAs: "event type" }));
  });
});
