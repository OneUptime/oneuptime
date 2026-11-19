import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import LogPipelineProcessor from "../../../Models/DatabaseModels/LogPipelineProcessor";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDeviceNamingRule from "../../../Models/DatabaseModels/NetworkDeviceNamingRule";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import PublicNoteApprovalStep from "../../../Models/DatabaseModels/PublicNoteApprovalStep";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageHeaderLink from "../../../Models/DatabaseModels/StatusPageHeaderLink";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import {
  ListOrderFacts,
  getListOrderFacts,
  listOrderFactsToJSON,
  toListOrderProse,
} from "../../../Utils/DeveloperDocs/ListOrderFacts";
import {
  STATE_LISTS,
  StateListBuiltIn,
  StateListDefinition,
  StateListType,
  getStateListOfTable,
} from "../../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE TERRAFORM REGISTRY SAYS OF A DRAG-ORDERED LIST'S NUMBER (issue
 * #9652), read off the model and its list's rules, so the page cannot say
 * what the server does not do: the column, which end is the top, what one
 * row and many are called, what holds the list, where a row created
 * without a number goes, and which built-in rows stay in order. The spec
 * carries these on the model's tag (x-oneuptime-list-order), and the
 * provider's generator writes the resource's Order section from them.
 */

function listModels(): Array<DatabaseBaseModel> {
  return Models.map((ModelClass: { new (): DatabaseBaseModel }) => {
    return new ModelClass();
  }).filter((model: DatabaseBaseModel): boolean => {
    return Boolean(model.getListOrder()?.column);
  });
}

describe("toListOrderProse", () => {
  test.each([
    ["Incident Severity", "incident severity"],
    ["Incident SLA Rule", "incident SLA rule"],
    ["AI Postmortem Rule", "AI postmortem rule"],
    ["  Status Page  Header Link ", "status page header link"],
    ["A", "a"],
  ])("writes %p as a sentence names it: %p", (name: string, prose: string) => {
    expect(toListOrderProse(name)).toBe(prose);
  });
});

describe("getListOrderFacts", () => {
  test("is null for a model whose rows are no drag-ordered list", () => {
    expect(getListOrderFacts(new Monitor())).toBeNull();
    // A list numbered by `order` that ContiguousOrder keeps has words of its own.
    expect(getListOrderFacts(new StatusPageGroup())).toBeNull();
  });

  test("has every drag-ordered list's", () => {
    const models: Array<DatabaseBaseModel> = listModels();

    // The 39 lists of #9609.
    expect(models.length).toBeGreaterThanOrEqual(39);

    for (const model of models) {
      const settings: ListOrderSettings = model.getListOrder()!;
      const facts: ListOrderFacts | null = getListOrderFacts(model);

      expect({ table: model.tableName, facts: facts }).toEqual({
        table: model.tableName,
        facts: expect.objectContaining({
          column: settings.column,
          descending: settings.sortOrder === SortOrder.Descending,
          singular: toListOrderProse(model.singularName!),
          plural: toListOrderProse(model.pluralName!),
        }),
      });
      expect(facts!.parent.length).toBeGreaterThan(0);
    }
  });

  test("names the project as what holds a project's list", () => {
    expect(getListOrderFacts(new IncidentSeverity())).toEqual({
      column: "order",
      descending: false,
      singular: "incident severity",
      plural: "incident severities",
      parent: "project",
    });
  });

  test("names the parent a list belongs to by its relation", () => {
    expect(getListOrderFacts(new StatusPageHeaderLink())?.parent).toBe(
      "status page",
    );
    expect(getListOrderFacts(new LogPipelineProcessor())).toEqual(
      expect.objectContaining({ column: "sortOrder", parent: "log pipeline" }),
    );
    expect(
      getListOrderFacts(new IncomingCallPolicyEscalationRule())?.parent,
    ).toBe("incoming call policy");
  });

  test("names the kind a list of one kind is split by", () => {
    expect(getListOrderFacts(new PublicNoteApprovalStep())).toEqual(
      expect.objectContaining({
        parent: "project",
        sameAs: "event type",
      }),
    );
    expect(getListOrderFacts(new IncidentSeverity())?.sameAs).toBeUndefined();
  });

  test("says which lists count down from their highest number", () => {
    for (const model of [
      new NetworkSiteAssignmentRule(),
      new NetworkDeviceNamingRule(),
    ]) {
      expect(getListOrderFacts(model)).toEqual(
        expect.objectContaining({ column: "priority", descending: true }),
      );
    }

    expect(getListOrderFacts(new MonitorStatus())).toEqual(
      expect.objectContaining({ column: "priority", descending: false }),
    );
  });

  /*
   * A new state without a number takes the resolved state's place, and the
   * rows from there down step down one (StateOrderGuard,
   * ListOrderMaintainer.placeOnCreate): the page says above which built-in
   * row. Every other list puts it at the end, and says nothing of one.
   */
  test("says above which built-in row a new row without a number goes, as the list's rules put it", () => {
    for (const model of listModels()) {
      const stateList: StateListDefinition | null = getStateListOfTable(
        model.tableName,
      );
      const anchor: StateListBuiltIn | undefined = stateList?.builtIns.find(
        (builtIn: StateListBuiltIn): boolean => {
          return builtIn.flag === stateList.insertAboveFlag;
        },
      );

      expect({
        table: model.tableName,
        insertsAbove: getListOrderFacts(model)?.insertsAbove,
      }).toEqual({ table: model.tableName, insertsAbove: anchor?.role });
    }

    expect(getListOrderFacts(new IncidentState())?.insertsAbove).toBe(
      "resolved state",
    );
    expect(getListOrderFacts(new MonitorStatus())?.insertsAbove).toBe(
      "offline status",
    );
    expect(
      getListOrderFacts(new ScheduledMaintenanceState())?.insertsAbove,
    ).toBe("completed state");
  });

  test("says which built-in rows stay in order, top first, on the lists that keep them so", () => {
    for (const model of listModels()) {
      const stateList: StateListDefinition | null = getStateListOfTable(
        model.tableName,
      );

      expect({
        table: model.tableName,
        keepsInOrder: getListOrderFacts(model)?.keepsInOrder,
      }).toEqual({
        table: model.tableName,
        keepsInOrder: stateList?.keepsBuiltInOrder
          ? stateList.builtIns.map((builtIn: StateListBuiltIn): string => {
              return builtIn.role;
            })
          : undefined,
      });
    }

    expect(getListOrderFacts(new IncidentState())?.keepsInOrder).toEqual([
      "created state",
      "acknowledged state",
      "resolved state",
    ]);
    // Priorities stay in order, and a new one still goes last.
    expect(getListOrderFacts(new SecurityCasePriority())).toEqual(
      expect.objectContaining({
        keepsInOrder: STATE_LISTS[
          StateListType.SecurityCasePriority
        ].builtIns.map((builtIn: StateListBuiltIn): string => {
          return builtIn.role;
        }),
      }),
    );
    expect(
      getListOrderFacts(new SecurityCasePriority())?.insertsAbove,
    ).toBeUndefined();
    // Monitor statuses run any way, so nothing about them stays in order.
    expect(
      getListOrderFacts(new MonitorStatus())?.keepsInOrder,
    ).toBeUndefined();
  });
});

describe("listOrderFactsToJSON", () => {
  test("writes what the spec carries, leaving out what a list does not have", () => {
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
    expect(
      listOrderFactsToJSON(getListOrderFacts(new IncidentState())!),
    ).toEqual(
      expect.objectContaining({
        insertsAbove: "resolved state",
        keepsInOrder: ["created state", "acknowledged state", "resolved state"],
      }),
    );
  });

  test("reads back as the facts it was written from", () => {
    for (const model of listModels()) {
      const facts: ListOrderFacts = getListOrderFacts(model)!;

      expect(JSON.parse(JSON.stringify(listOrderFactsToJSON(facts)))).toEqual(
        JSON.parse(JSON.stringify(facts)),
      );
    }
  });
});
