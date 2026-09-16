import AlertAIContextBuilder, {
  AIGenerationContext as AlertGenerationContext,
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import { QueryAlertsTool } from "../../../../Server/Utils/AI/Toolbox/AlertTools";
import { QueryIncidentsTool } from "../../../../Server/Utils/AI/Toolbox/IncidentTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A burn-rate incident or alert has no monitor - by design - so every place
 * the AI is told what an incident or alert affects used to describe it as
 * affecting nothing: the postmortem and note drafts, and the query_incidents
 * / query_alerts tools the chat and investigation agents call. The SLO it is
 * linked to is its blast radius, and these tests pin that the AI now sees it
 * - read through the relation-readable `name` column only, so it works for a
 * caller who can read incidents but not SLOs.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

function buildSlo(name: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = ObjectID.generate().toString();
  slo.name = name;
  return slo;
}

function buildMonitor(name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.name = name;
  return monitor;
}

function buildIncident(data: {
  monitors?: Array<Monitor> | undefined;
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
}): Incident {
  const incident: Incident = new Incident();
  incident._id = ObjectID.generate().toString();
  incident.incidentNumber = 7;
  incident.title = "Checkout availability is burning its error budget";
  incident.createdAt = new Date("2026-09-01T00:00:00Z");

  if (data.monitors) {
    incident.monitors = data.monitors;
  }

  if (data.serviceLevelObjectives) {
    incident.serviceLevelObjectives = data.serviceLevelObjectives;
  }

  return incident;
}

function buildAlert(data: {
  monitor?: Monitor | undefined;
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
}): Alert {
  const alert: Alert = new Alert();
  alert._id = ObjectID.generate().toString();
  alert.alertNumber = 12;
  alert.title = "Checkout availability is burning its error budget";
  alert.createdAt = new Date("2026-09-01T00:00:00Z");

  if (data.monitor) {
    alert.monitor = data.monitor;
  }

  if (data.serviceLevelObjectives) {
    alert.serviceLevelObjectives = data.serviceLevelObjectives;
  }

  return alert;
}

function incidentContext(incident: Incident): IncidentContextData {
  return {
    incident: incident,
    stateTimeline: [],
    internalNotes: [],
    publicNotes: [],
    workspaceMessages: [],
  };
}

function alertContext(alert: Alert): AlertContextData {
  return { alert: alert, stateTimeline: [], internalNotes: [] };
}

function selectOf(spy: jest.SpyInstance): JSONObject {
  return (spy.mock.calls[0]![0] as { select: JSONObject }).select;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentAIContextBuilder", () => {
  test("reads the incident's SLOs by name only", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        buildIncident({
          serviceLevelObjectives: [buildSlo("Checkout availability")],
        }) as never,
      );
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentInternalNoteService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentPublicNoteService, "findBy")
      .mockResolvedValue([] as never);

    const context: IncidentContextData =
      await IncidentAIContextBuilder.buildIncidentContext({
        incidentId: ObjectID.generate(),
      });

    expect(selectOf(findOneById)["serviceLevelObjectives"]).toEqual({
      name: true,
    });
    expect(context.incident.serviceLevelObjectives).toHaveLength(1);
  });

  test.each([
    [
      "postmortem",
      (data: IncidentContextData): AIGenerationContext => {
        return IncidentAIContextBuilder.formatIncidentContextForPostmortem(
          data,
        );
      },
    ],
    [
      "internal note",
      (data: IncidentContextData): AIGenerationContext => {
        return IncidentAIContextBuilder.formatIncidentContextForNote(
          data,
          "internal",
        );
      },
    ],
    [
      "public note",
      (data: IncidentContextData): AIGenerationContext => {
        return IncidentAIContextBuilder.formatIncidentContextForNote(
          data,
          "public",
        );
      },
    ],
  ])(
    "the %s draft names a burn-rate incident's SLOs",
    (
      _label: string,
      format: (data: IncidentContextData) => AIGenerationContext,
    ) => {
      const generated: AIGenerationContext = format(
        incidentContext(
          buildIncident({
            serviceLevelObjectives: [
              buildSlo("Checkout availability"),
              buildSlo(""),
              buildSlo("Search latency p95"),
            ],
          }),
        ),
      );

      expect(generated.contextText).toContain(
        "**Affected SLOs:** Checkout availability, Search latency p95\n\n",
      );
      // What the model is actually sent.
      expect(generated.messages[1]!.content).toContain(
        "**Affected SLOs:** Checkout availability, Search latency p95",
      );
    },
  );

  test("SLOs follow the monitors when an incident has both", () => {
    const generated: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        incidentContext(
          buildIncident({
            monitors: [buildMonitor("checkout-web")],
            serviceLevelObjectives: [buildSlo("Checkout availability")],
          }),
        ),
      );

    const monitorsAt: number = generated.contextText.indexOf(
      "**Affected Monitors:** checkout-web",
    );
    const slosAt: number = generated.contextText.indexOf(
      "**Affected SLOs:** Checkout availability",
    );

    expect(monitorsAt).toBeGreaterThan(-1);
    expect(slosAt).toBeGreaterThan(monitorsAt);
  });

  test("an incident without SLOs gets no SLO line", () => {
    const generated: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        incidentContext(
          buildIncident({ monitors: [buildMonitor("checkout-web")] }),
        ),
      );

    expect(generated.contextText).not.toContain("Affected SLOs");
  });

  test("SLOs with no names do not print an empty line", () => {
    const generated: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForNote(
        incidentContext(
          buildIncident({ serviceLevelObjectives: [buildSlo("")] }),
        ),
        "internal",
      );

    expect(generated.contextText).not.toContain("Affected SLOs");
  });
});

describe("AlertAIContextBuilder", () => {
  test("reads the alert's SLOs by name only", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(
        buildAlert({
          serviceLevelObjectives: [buildSlo("Checkout availability")],
        }) as never,
      );
    jest
      .spyOn(AlertStateTimelineService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertInternalNoteService, "findBy")
      .mockResolvedValue([] as never);

    await AlertAIContextBuilder.buildAlertContext({
      alertId: ObjectID.generate(),
    });

    expect(selectOf(findOneById)["serviceLevelObjectives"]).toEqual({
      name: true,
    });
  });

  test("the note draft names a burn-rate alert's SLO", () => {
    const generated: AlertGenerationContext =
      AlertAIContextBuilder.formatAlertContextForNote(
        alertContext(
          buildAlert({
            serviceLevelObjectives: [buildSlo("Checkout availability")],
          }),
        ),
      );

    expect(generated.contextText).toContain(
      "**Affected SLOs:** Checkout availability\n\n",
    );
    expect(generated.contextText).not.toContain("**Monitor:**");
  });

  test("the SLO follows the monitor when an alert has both", () => {
    const generated: AlertGenerationContext =
      AlertAIContextBuilder.formatAlertContextForNote(
        alertContext(
          buildAlert({
            monitor: buildMonitor("checkout-web"),
            serviceLevelObjectives: [buildSlo("Checkout availability")],
          }),
        ),
      );

    expect(generated.contextText.indexOf("**Affected SLOs:**")).toBeGreaterThan(
      generated.contextText.indexOf("**Monitor:** checkout-web"),
    );
  });

  test("an alert without SLOs gets no SLO line", () => {
    const generated: AlertGenerationContext =
      AlertAIContextBuilder.formatAlertContextForNote(
        alertContext(buildAlert({ monitor: buildMonitor("checkout-web") })),
      );

    expect(generated.contextText).not.toContain("Affected SLOs");
  });
});

describe("query_incidents detail", () => {
  function mockOwners(): void {
    jest
      .spyOn(IncidentOwnerTeamService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentOwnerUserService, "findBy")
      .mockResolvedValue([] as never);
  }

  test("selects the SLO names and reports them as affectedSlos", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        buildIncident({
          serviceLevelObjectives: [buildSlo("Checkout availability")],
        }) as never,
      );
    mockOwners();

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { incidentId: ObjectID.generate().toString() },
      ctx,
    );

    expect(selectOf(findOneById)["serviceLevelObjectives"]).toEqual({
      name: true,
    });
    // Read with the caller's own permissions, like the rest of the row.
    expect((findOneById.mock.calls[0]![0] as JSONObject)["props"]).toBe(
      ctx.props,
    );
    expect(result.dataForLlm).toContain("affectedSlos=Checkout availability");
  });

  test("the tool description tells the model SLOs are part of the detail", () => {
    expect(QueryIncidentsTool.description).toContain("affected SLOs");
  });

  test("an incident without SLOs emits no affectedSlos field", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        buildIncident({ monitors: [buildMonitor("checkout-web")] }) as never,
      );
    mockOwners();

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { incidentId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain("affectedSlos");
  });
});

describe("query_alerts", () => {
  test("the detail branch selects the SLO names and reports them as slos", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(
        buildAlert({
          serviceLevelObjectives: [buildSlo("Checkout availability")],
        }) as never,
      );
    jest.spyOn(AlertOwnerTeamService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { alertId: ObjectID.generate().toString() },
      ctx,
    );

    expect(selectOf(findOneById)["serviceLevelObjectives"]).toEqual({
      name: true,
    });
    expect(result.dataForLlm).toContain("slos=Checkout availability");
  });

  test("the list branch gives a monitor-less burn-rate alert its SLO as a source", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([
        buildAlert({
          serviceLevelObjectives: [
            buildSlo("Checkout availability"),
            buildSlo("Search latency p95"),
          ],
        }),
        buildAlert({ monitor: buildMonitor("checkout-web") }),
      ] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      ctx,
    );

    expect(selectOf(findBy)["serviceLevelObjectives"]).toEqual({ name: true });
    // The monitor select the "noisiest source" prompt relies on is unchanged.
    expect(selectOf(findBy)["monitor"]).toEqual({ name: true });

    const items: Array<JSONObject> = result.widget?.data.items ?? [];

    expect(items).toHaveLength(2);
    expect(items[0]?.["slos"]).toBe(
      "Checkout availability, Search latency p95",
    );
    expect(items[0]?.["monitor"]).toBeUndefined();
    // A monitor alert has no SLO, and carries no empty field for one.
    expect(items[1]?.["slos"]).toBeUndefined();
    expect(items[1]?.["monitor"]).toBe("checkout-web");
  });

  test("the tool description tells the model an SLO can be an alert's source", () => {
    expect(QueryAlertsTool.description).toContain("SLO burn rate rule");
  });
});
