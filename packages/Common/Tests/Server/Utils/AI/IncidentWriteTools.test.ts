import {
  AcknowledgeIncidentTool,
  CreateIncidentTool,
  ResolveIncidentTool,
} from "../../../../Server/Utils/AI/Toolbox/IncidentWriteTools";
import {
  ObservabilityTool,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * create_incident, acknowledge_incident and resolve_incident are the copilot's
 * incident mutations. These tests hold the contract around the write rather
 * than the prose handed to the model: tenancy and the acting user come from
 * ctx (never from a tool argument), severity is resolved from the project's
 * own list, the state tools only act on an incident the caller can already
 * see, and every missing input fails loudly instead of writing.
 */

const USER_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const SEV1_ID: ObjectID = ObjectID.generate();
const SEV2_ID: ObjectID = ObjectID.generate();

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true, userId: USER_ID },
};

function buildSeverity(
  id: ObjectID,
  name: string,
  order: number,
): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = id.toString();
  severity.name = name;
  severity.order = order;
  return severity;
}

function buildSeverities(): Array<IncidentSeverity> {
  return [buildSeverity(SEV1_ID, "SEV1", 1), buildSeverity(SEV2_ID, "SEV2", 2)];
}

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.incidentNumber = 42;
  incident.title = "Checkout down";
  return incident;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("create_incident", () => {
  function mockSeverities(
    severities: Array<IncidentSeverity> = buildSeverities(),
  ): jest.SpyInstance {
    return jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockResolvedValue(severities as never);
  }

  function mockCreate(): jest.SpyInstance {
    return jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(buildIncident() as never);
  }

  test("creates the incident pinned to ctx's project and user", async () => {
    mockSeverities();
    const createSpy: jest.SpyInstance = mockCreate();

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      {
        title: "Checkout down",
        description: "Card payments are failing for every region.",
      },
      ctx,
    );

    const callArgs: Record<string, unknown> = createSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;
    const data: Incident = callArgs["data"] as Incident;
    expect(data.projectId).toBe(ctx.projectId);
    expect(data.title).toBe("Checkout down");
    expect(data.description).toBe(
      "Card payments are failing for every region.",
    );
    expect(data.createdByUserId).toBe(USER_ID);
    expect(data.rootCause).toBe(
      "Incident created via the OneUptime AI copilot.",
    );
    // The write runs under the caller's props so model-layer RBAC applies too.
    expect(callArgs["props"]).toBe(ctx.props);

    expect(result.rowCount).toBe(1);
    expect(result.isTruncated).toBe(false);
    expect(result.dataForLlm).toContain("#42");
    expect(result.dataForLlm).toContain("Checkout down");
    expect(result.citationLabel).toBe("Created incident #42");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID.toString() },
    });
  });

  test("defaults to the project's first-ordered severity", async () => {
    const findSpy: jest.SpyInstance = mockSeverities();
    const createSpy: jest.SpyInstance = mockCreate();

    await CreateIncidentTool.execute({ title: "Checkout down" }, ctx);

    // Asked for in the project's own order, so "first" means first-defined.
    const findArgs: Record<string, unknown> = findSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(findArgs["sort"]).toEqual({ order: SortOrder.Ascending });
    expect(findArgs["props"]).toBe(ctx.props);

    const data: Incident = (
      createSpy.mock.calls[0]?.[0] as Record<string, unknown>
    )["data"] as Incident;
    expect(data.incidentSeverityId?.toString()).toBe(SEV1_ID.toString());
  });

  test("matches a named severity case-insensitively", async () => {
    mockSeverities();
    const createSpy: jest.SpyInstance = mockCreate();

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      { title: "Checkout down", severityName: "sev2" },
      ctx,
    );

    const data: Incident = (
      createSpy.mock.calls[0]?.[0] as Record<string, unknown>
    )["data"] as Incident;
    expect(data.incidentSeverityId?.toString()).toBe(SEV2_ID.toString());
    expect(result.dataForLlm).toContain("SEV2");
  });

  test("falls back to the first severity when the name matches nothing", async () => {
    mockSeverities();
    const createSpy: jest.SpyInstance = mockCreate();

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      { title: "Checkout down", severityName: "Catastrophic" },
      ctx,
    );

    const data: Incident = (
      createSpy.mock.calls[0]?.[0] as Record<string, unknown>
    )["data"] as Incident;
    expect(data.incidentSeverityId?.toString()).toBe(SEV1_ID.toString());
    // The incident is still created, and the model is told which one it got.
    expect(result.dataForLlm).toContain("SEV1");
  });

  test("a project with no severities is a loud BadData error, not a bad write", async () => {
    mockSeverities([]);
    const createSpy: jest.SpyInstance = jest.spyOn(IncidentService, "create");

    await expect(
      CreateIncidentTool.execute({ title: "Checkout down" }, ctx),
    ).rejects.toThrow("No incident severities are configured");
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("missing title is a loud BadData error and reads nothing", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(
      IncidentSeverityService,
      "findBy",
    );

    await expect(
      CreateIncidentTool.execute({ description: "no title" }, ctx),
    ).rejects.toThrow("title is required");
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("refuses to write without an authenticated user in context", async () => {
    const anonymousCtx: ToolContext = {
      projectId: ctx.projectId,
      props: { isRoot: true },
    };
    const findSpy: jest.SpyInstance = jest.spyOn(
      IncidentSeverityService,
      "findBy",
    );

    await expect(
      CreateIncidentTool.execute({ title: "Checkout down" }, anonymousCtx),
    ).rejects.toThrow("No authenticated user");
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("the acting user comes from ctx.props even when args smuggle a userId", async () => {
    mockSeverities();
    const createSpy: jest.SpyInstance = mockCreate();

    await CreateIncidentTool.execute(
      {
        title: "Checkout down",
        userId: ObjectID.generate().toString(),
        createdByUserId: ObjectID.generate().toString(),
        projectId: ObjectID.generate().toString(),
      },
      ctx,
    );

    const data: Incident = (
      createSpy.mock.calls[0]?.[0] as Record<string, unknown>
    )["data"] as Incident;
    expect(data.createdByUserId).toBe(USER_ID);
    expect(data.projectId).toBe(ctx.projectId);
  });

  test("an empty description is omitted from the card, a long one is elided", async () => {
    mockSeverities();
    mockCreate();

    const withoutDescription: ToolExecutionResult =
      await CreateIncidentTool.execute({ title: "Checkout down" }, ctx);
    const barelabels: Array<string> = (
      (withoutDescription.widget?.data as Record<string, unknown>)[
        "fields"
      ] as Array<{ label: string }>
    ).map((field: { label: string }) => {
      return field.label;
    });
    expect(barelabels).toEqual(["Number", "Severity"]);

    const longDescription: string = "x".repeat(250);
    const withDescription: ToolExecutionResult =
      await CreateIncidentTool.execute(
        { title: "Checkout down", description: longDescription },
        ctx,
      );
    const fields: Array<{ label: string; value: string }> = (
      withDescription.widget?.data as Record<string, unknown>
    )["fields"] as Array<{ label: string; value: string }>;
    const descriptionField: { label: string; value: string } | undefined =
      fields.find((field: { label: string }) => {
        return field.label === "Description";
      });
    expect(descriptionField?.value).toBe(`${"x".repeat(200)}…`);
    // The full text still reaches the incident itself; only the card is cut.
    expect(descriptionField?.value.length).toBeLessThan(longDescription.length);
  });

  test("is a mutation whose permissions derive from the Incident model's create ACL", () => {
    expect(CreateIncidentTool.isMutation).toBe(true);
    expect(CreateIncidentTool.requiredPermissions).toEqual(
      new Incident().getCreatePermissions(),
    );
    expect(CreateIncidentTool.requiredPermissions.length).toBeGreaterThan(0);
  });

  test("buildActionTitle names the incident, or says Untitled", () => {
    expect(
      CreateIncidentTool.buildActionTitle!({ title: "Checkout down" }),
    ).toBe("Create incident: Checkout down");
    expect(CreateIncidentTool.buildActionTitle!({})).toBe(
      "Create incident: Untitled",
    );
  });
});

type StateCase = {
  label: string;
  tool: ObservabilityTool;
  serviceMethod: "acknowledgeIncident" | "resolveIncident";
  newStateName: string;
  actionTitlePrefix: string;
};

const stateCases: Array<StateCase> = [
  {
    label: "acknowledge_incident",
    tool: AcknowledgeIncidentTool,
    serviceMethod: "acknowledgeIncident",
    newStateName: "Acknowledged",
    actionTitlePrefix: "Acknowledge incident",
  },
  {
    label: "resolve_incident",
    tool: ResolveIncidentTool,
    serviceMethod: "resolveIncident",
    newStateName: "Resolved",
    actionTitlePrefix: "Resolve incident",
  },
];

describe.each(stateCases)(
  "$label",
  ({ tool, serviceMethod, newStateName, actionTitlePrefix }: StateCase) => {
    test("changes the state as ctx's user and cites the incident", async () => {
      jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(buildIncident() as never);
      const changeSpy: jest.SpyInstance = jest
        .spyOn(IncidentService, serviceMethod)
        .mockResolvedValue(buildIncident() as never);

      const result: ToolExecutionResult = await tool.execute(
        { incidentId: INCIDENT_ID.toString() },
        ctx,
      );

      expect(changeSpy).toHaveBeenCalledTimes(1);
      const [calledIncidentId, calledUserId] = changeSpy.mock.calls[0] as [
        ObjectID,
        ObjectID,
      ];
      expect(calledIncidentId.toString()).toBe(INCIDENT_ID.toString());
      expect(calledUserId).toBe(USER_ID);

      expect(result.rowCount).toBe(1);
      expect(result.isTruncated).toBe(false);
      expect(result.dataForLlm).toContain("#42");
      expect(result.dataForLlm).toContain("Checkout down");
      expect(result.dataForLlm).toContain(newStateName);
      expect(result.citationLabel).toBe(`${newStateName} incident #42`);
      expect(result.citationTarget).toEqual({
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: INCIDENT_ID.toString() },
      });
    });

    test("reads the incident under the caller's own props, not as root", async () => {
      const findSpy: jest.SpyInstance = jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(buildIncident() as never);
      jest
        .spyOn(IncidentService, serviceMethod)
        .mockResolvedValue(buildIncident() as never);

      await tool.execute({ incidentId: INCIDENT_ID.toString() }, ctx);

      const findArgs: Record<string, unknown> = findSpy.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArgs["props"]).toBe(ctx.props);
      expect(String(findArgs["id"])).toBe(INCIDENT_ID.toString());
    });

    test("refuses to write when the incident is not visible to the user", async () => {
      jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(null as never);
      const changeSpy: jest.SpyInstance = jest.spyOn(
        IncidentService,
        serviceMethod,
      );

      await expect(
        tool.execute({ incidentId: INCIDENT_ID.toString() }, ctx),
      ).rejects.toThrow("Incident not found");
      expect(changeSpy).not.toHaveBeenCalled();
    });

    test("missing incidentId is a loud BadData error and reads nothing", async () => {
      const findSpy: jest.SpyInstance = jest.spyOn(
        IncidentService,
        "findOneById",
      );

      await expect(tool.execute({}, ctx)).rejects.toThrow(
        "incidentId is required",
      );
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("refuses to write without an authenticated user in context", async () => {
      const anonymousCtx: ToolContext = {
        projectId: ctx.projectId,
        props: { isRoot: true },
      };
      const findSpy: jest.SpyInstance = jest.spyOn(
        IncidentService,
        "findOneById",
      );

      await expect(
        tool.execute({ incidentId: INCIDENT_ID.toString() }, anonymousCtx),
      ).rejects.toThrow("No authenticated user");
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("carries a resource card widget that deep-links to the incident", async () => {
      jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(buildIncident() as never);
      jest
        .spyOn(IncidentService, serviceMethod)
        .mockResolvedValue(buildIncident() as never);

      const result: ToolExecutionResult = await tool.execute(
        { incidentId: INCIDENT_ID.toString() },
        ctx,
      );

      const widgetData: Record<string, unknown> = result.widget?.data as Record<
        string,
        unknown
      >;
      expect(widgetData["resourceType"]).toBe("Incident");
      expect(widgetData["heading"]).toBe("#42 · Checkout down");
      expect(widgetData["subheading"]).toBe(`Now ${newStateName}`);
      expect(widgetData["link"]).toEqual({
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: INCIDENT_ID.toString() },
      });
      expect(widgetData["fields"]).toEqual([
        { label: "Number", value: "#42" },
        { label: "State", value: newStateName },
      ]);
    });

    test("buildActionTitle names the incident, and stays tidy with no id", () => {
      expect(
        tool.buildActionTitle!({ incidentId: INCIDENT_ID.toString() }),
      ).toBe(`${actionTitlePrefix} ${INCIDENT_ID.toString()}`);
      expect(tool.buildActionTitle!({})).toBe(actionTitlePrefix);
    });

    test("is a mutation whose permissions derive from the Incident model's update ACL", () => {
      expect(tool.isMutation).toBe(true);
      expect(tool.requiredPermissions).toEqual(
        new Incident().getUpdatePermissions(),
      );
      expect(tool.requiredPermissions.length).toBeGreaterThan(0);
    });
  },
);

describe("the incident write tools as a set", () => {
  test("each tool has its own name", () => {
    expect(CreateIncidentTool.name).toBe("create_incident");
    expect(AcknowledgeIncidentTool.name).toBe("acknowledge_incident");
    expect(ResolveIncidentTool.name).toBe("resolve_incident");
  });

  test("resolve does not acknowledge, and acknowledge does not resolve", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    const acknowledgeSpy: jest.SpyInstance = jest
      .spyOn(IncidentService, "acknowledgeIncident")
      .mockResolvedValue(buildIncident() as never);
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(IncidentService, "resolveIncident")
      .mockResolvedValue(buildIncident() as never);

    await ResolveIncidentTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(acknowledgeSpy).not.toHaveBeenCalled();

    await AcknowledgeIncidentTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(acknowledgeSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });
});
