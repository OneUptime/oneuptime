import {
  AddIncidentAffectedResourcesTool,
  CreateIncidentTool,
} from "../../../../Server/Utils/AI/Toolbox/IncidentWriteTools";
import {
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import ServiceService from "../../../../Server/Services/ServiceService";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Service from "../../../../Models/DatabaseModels/Service";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #5293, IN THE INCIDENT TOOLS.
 *
 * On host test01's page, Ask AI was asked "Declare an incident, high memory
 * usage", and created an incident linked to nothing: its investigation
 * never reached the host, and auto-remediation said it had nothing to fix.
 *
 *   - create_incident links what the incident is about: the resources the
 *     call names, or - declared from a resource's page without naming any -
 *     that resource. The page's resource is written into the arguments
 *     before the person approves them (prepareMutation), and the approval
 *     card names it. Each resource is read as the person; what they may not
 *     view is left out, and the model is told why. The incident is created
 *     whatever is left out.
 *   - add_incident_affected_resources links an existing incident, added to
 *     what it lists already - what the person may not view included - as
 *     the person, as the incident's Affected Resources Edit does.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("abababab-abab-4bab-8bab-abababababab");
const INCIDENT_ID: string = "acacacac-acac-4cac-8cac-acacacacacac";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HELD_HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SEVERITY_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);

const HOST_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Resource,
  resourceType: AIResourceType.Host,
  entityId: HOST_ID,
  entityTitle: "test01",
};

const INCIDENT_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Incident,
  entityId: INCIDENT_ID,
};

function context(pageContext?: AIChatPageContext): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: { userId: USER_ID, tenantId: PROJECT_ID },
    ...(pageContext ? { pageContext } : {}),
  };
}

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const record: T = new modelType();
  record._id = id;
  (record as unknown as { name: string }).name = name;
  (record as unknown as { isArchived: boolean }).isArchived = false;
  return record;
}

function mockSeverities(): void {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.name = "SEV1";
  severity.order = 1;

  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([severity] as never);
}

function mockCreate(): jest.SpyInstance {
  return jest
    .spyOn(IncidentService, "create")
    .mockImplementation((async (args: {
      data: Incident;
    }): Promise<Incident> => {
      const created: Incident = args.data;
      created._id = INCIDENT_ID;
      created.incidentNumber = 12;
      return created;
    }) as never);
}

function createdIncident(spy: jest.SpyInstance): Incident {
  return (spy.mock.calls[0]![0] as { data: Incident }).data;
}

function idsOf(list: Array<BaseModel> | undefined): Array<string> {
  return (list || []).map((record: BaseModel): string => {
    return record.id!.toString();
  });
}

function widgetFields(
  result: ToolExecutionResult,
): Array<{ label: string; value: string }> {
  return (result.widget?.data as JSONObject)["fields"] as unknown as Array<{
    label: string;
    value: string;
  }>;
}

describe("create_incident links what the incident is about (issue #5293)", () => {
  test("declared from host test01's page, the incident is linked to test01", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const hosts: jest.SpyInstance = jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const ctx: ToolContext = context(HOST_PAGE);

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      {
        title: "High memory usage",
        description: "Memory on test01 is above 95%.",
      },
      ctx,
    );

    // Linked with the create itself: what the investigation and fixes read.
    const incident: Incident = createdIncident(create);
    expect(idsOf(incident.hosts)).toEqual([HOST_ID]);
    expect((create.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );

    // The host was read as the person, in the project.
    expect((hosts.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );

    expect(result.dataForLlm).toContain(
      'Successfully created incident #12 ("High memory usage", severity SEV1).',
    );
    expect(result.dataForLlm).toContain('Linked to: host "test01".');
    expect(result.dataForLlm).not.toContain("add_incident_affected_resources");

    // The card says so, beside the number and the severity.
    expect(widgetFields(result)).toEqual(
      expect.arrayContaining([
        { label: "Affected resources", value: 'host "test01"' },
      ]),
    );
  });

  test("the resources the call names win over the page", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const hosts: jest.SpyInstance = jest.spyOn(HostService, "findBy");
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        named(KubernetesCluster, CLUSTER_ID, "prod-east"),
      ] as never);

    await CreateIncidentTool.execute(
      {
        title: "Pods crash-looping",
        affectedResources: [
          { resourceType: "KubernetesCluster", resourceId: CLUSTER_ID },
        ],
      },
      context(HOST_PAGE),
    );

    const incident: Incident = createdIncident(create);
    expect(idsOf(incident.kubernetesClusters)).toEqual([CLUSTER_ID]);
    expect(incident.hosts).toBeUndefined();
    expect(hosts).not.toHaveBeenCalled();
  });

  test("an empty list links nothing, even on a resource's page", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const hosts: jest.SpyInstance = jest.spyOn(HostService, "findBy");

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      { title: "Checkout down", affectedResources: [] },
      context(HOST_PAGE),
    );

    expect(createdIncident(create).hosts).toBeUndefined();
    expect(hosts).not.toHaveBeenCalled();
    // The model is told it is linked to nothing, and how to link it.
    expect(result.dataForLlm).toContain(
      "It is linked to no infrastructure or service, and OneUptime AI fixes only what an incident is linked to.",
    );
    expect(result.dataForLlm).toContain("add_incident_affected_resources");
  });

  test("off a resource's page, nothing named links nothing, and the model is told", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      { title: "Checkout down" },
      context({ type: AIChatPageContextType.IncidentsList }),
    );

    expect(createdIncident(create).hosts).toBeUndefined();
    expect(result.dataForLlm).toContain(
      "When you know what it is about, link it with add_incident_affected_resources.",
    );
    expect(
      widgetFields(result).map((field: { label: string }): string => {
        return field.label;
      }),
    ).not.toContain("Affected resources");
  });

  test("what the person may not view is left out, the incident is still declared, and the model is told why", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(ServiceService, "findBy")
      .mockResolvedValue([named(Service, SERVICE_ID, "checkout")] as never);

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      {
        title: "Checkout slow",
        affectedResources: [
          { resourceType: "Host", resourceId: HOST_ID },
          { resourceType: "Service", resourceId: SERVICE_ID },
        ],
      },
      context(),
    );

    const incident: Incident = createdIncident(create);
    expect(incident.hosts).toBeUndefined();
    expect(idsOf(incident.services)).toEqual([SERVICE_ID]);
    expect(result.dataForLlm).toContain('Linked to: service "checkout".');
    expect(result.dataForLlm).toContain(
      `Not linked: No host with ID ${HOST_ID} that the current user may view exists in this project, so it was not linked.`,
    );
  });

  test("the schema offers affectedResources, and the description says what linking does", () => {
    const properties: JSONObject = CreateIncidentTool.inputSchema[
      "properties"
    ] as JSONObject;

    expect(properties["affectedResources"]).toBeDefined();
    // Still only a title is required: linking is never a reason to refuse.
    expect(CreateIncidentTool.inputSchema["required"]).toEqual(["title"]);
    expect(CreateIncidentTool.description).toContain(
      "OneUptime AI investigates and fixes what an incident is linked to",
    );
    expect(CreateIncidentTool.description).toContain(
      "the incident is linked to that resource unless you pass affectedResources yourself",
    );
  });
});

describe("create_incident, prepared for approval", () => {
  test("the page's host is written into the arguments the person approves, and named on the card", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);

    const prepared: PreparedMutation =
      await CreateIncidentTool.prepareMutation!(
        { title: "High memory usage" },
        context(HOST_PAGE),
      );

    expect(prepared.arguments).toEqual({
      title: "High memory usage",
      affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
    });
    expect(prepared.description).toBe('Linked to host "test01".');
  });

  test("a call's own list is kept as named, and named on the card", async () => {
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        named(KubernetesCluster, CLUSTER_ID, "prod-east"),
      ] as never);

    const args: JSONObject = {
      title: "Pods crash-looping",
      affectedResources: [
        { resourceType: "KubernetesCluster", resourceId: CLUSTER_ID },
      ],
    };

    const prepared: PreparedMutation =
      await CreateIncidentTool.prepareMutation!(args, context(HOST_PAGE));

    expect(prepared.arguments).toEqual(args);
    expect(prepared.description).toBe(
      'Linked to Kubernetes cluster "prod-east".',
    );
  });

  test("off a resource's page, nothing is written and the card says nothing more", async () => {
    const prepared: PreparedMutation =
      await CreateIncidentTool.prepareMutation!(
        { title: "Checkout down" },
        context({ type: AIChatPageContextType.IncidentsList }),
      );

    expect(prepared.arguments).toEqual({ title: "Checkout down" });
    expect(prepared.description).toBeUndefined();
  });

  test("a resource the person may not view is flagged on the card before they approve", async () => {
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);

    const prepared: PreparedMutation =
      await CreateIncidentTool.prepareMutation!(
        { title: "High memory usage" },
        context(HOST_PAGE),
      );

    expect(prepared.description).toBe(
      "The resources named will not be linked.",
    );
  });

  test("what was prepared runs as approved: running it links the same host", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);

    const prepared: PreparedMutation =
      await CreateIncidentTool.prepareMutation!(
        { title: "High memory usage" },
        context(HOST_PAGE),
      );

    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    // Run later - after approval - from any page: the arguments say it all.
    await CreateIncidentTool.execute(
      prepared.arguments,
      context({ type: AIChatPageContextType.IncidentsList }),
    );

    expect(idsOf(createdIncident(create).hosts)).toEqual([HOST_ID]);
  });
});

describe("add_incident_affected_resources", () => {
  function mockIncident(data?: {
    readable?: boolean;
    heldHostIds?: Array<string>;
  }): jest.SpyInstance {
    return jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation((async (args: {
        props: { isRoot?: boolean };
      }): Promise<Incident | null> => {
        if (!args.props.isRoot) {
          if (data?.readable === false) {
            return null;
          }

          const incident: Incident = new Incident();
          incident._id = INCIDENT_ID;
          incident.incidentNumber = 12;
          incident.title = "High memory usage";
          return incident;
        }

        // What it lists already, read as OneUptime.
        const held: Incident = new Incident();
        held._id = INCIDENT_ID;
        held.hosts = (data?.heldHostIds || []).map((id: string): Host => {
          const host: Host = new Host();
          host.id = new ObjectID(id);
          return host;
        });
        return held;
      }) as never);
  }

  test("adds the host to what the incident lists already - kept even when the person cannot view it", async () => {
    const reads: jest.SpyInstance = mockIncident({
      heldHostIds: [HELD_HOST_ID],
    });
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const update: jest.SpyInstance = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(1 as never);
    const ctx: ToolContext = context();

    const result: ToolExecutionResult =
      await AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        ctx,
      );

    // The incident was read as the person first.
    expect((reads.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );

    // Only the list that gains something is written, whole, as the person.
    const write: { id: ObjectID; data: JSONObject; props: unknown } = update
      .mock.calls[0]![0] as { id: ObjectID; data: JSONObject; props: unknown };
    expect(write.id.toString()).toBe(INCIDENT_ID);
    expect(write.props).toBe(ctx.props);
    expect(Object.keys(write.data)).toEqual(["hosts"]);
    expect(idsOf(write.data["hosts"] as unknown as Array<BaseModel>)).toEqual([
      HELD_HOST_ID,
      HOST_ID,
    ]);

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(
      'Linked incident #12 ("High memory usage") to host "test01".',
    );
    // A host can be fixed: the model can say OneUptime AI tries again.
    expect(result.dataForLlm).toContain(
      "If OneUptime AI found nothing to fix on this incident because it was linked to nothing, it tries again now",
    );
    expect(result.citationLabel).toBe("Linked incident #12");
  });

  test("on an incident's page, incidentId is the incident the conversation is about", async () => {
    mockIncident();
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const update: jest.SpyInstance = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(1 as never);

    await AddIncidentAffectedResourcesTool.execute(
      { affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }] },
      context(INCIDENT_PAGE),
    );

    expect((update.mock.calls[0]![0] as { id: ObjectID }).id.toString()).toBe(
      INCIDENT_ID,
    );
  });

  test("a host linked already is not written again, and the model is told nothing changed", async () => {
    mockIncident({ heldHostIds: [HOST_ID] });
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const update: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "updateOneById",
    );

    const result: ToolExecutionResult =
      await AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      );

    expect(update).not.toHaveBeenCalled();
    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain(
      "was linked to all of these already; nothing changed.",
    );
  });

  test("a service is linked, and no fix is promised for it", async () => {
    mockIncident();
    jest
      .spyOn(ServiceService, "findBy")
      .mockResolvedValue([named(Service, SERVICE_ID, "checkout")] as never);
    jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(1 as never);

    const result: ToolExecutionResult =
      await AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [
            { resourceType: "Service", resourceId: SERVICE_ID },
          ],
        },
        context(),
      );

    expect(result.dataForLlm).toContain('to service "checkout".');
    expect(result.dataForLlm).not.toContain("tries again");
  });

  test("nothing it may link is refused, with every reason, and nothing is written", async () => {
    mockIncident();
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);
    const update: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "updateOneById",
    );

    await expect(
      AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [
            { resourceType: "Monitor", resourceId: HOST_ID },
            { resourceType: "Host", resourceId: HOST_ID },
          ],
        },
        context(),
      ),
    ).rejects.toThrow(BadDataException);

    await expect(
      AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      ),
    ).rejects.toThrow(
      `Nothing was linked. No host with ID ${HOST_ID} that the current user may view exists in this project, so it was not linked.`,
    );
    expect(update).not.toHaveBeenCalled();
  });

  test("naming nothing, off a resource's page, says what to name", async () => {
    mockIncident();

    await expect(
      AddIncidentAffectedResourcesTool.execute(
        { incidentId: INCIDENT_ID },
        context(),
      ),
    ).rejects.toThrow("Name the resources to link in affectedResources");
  });

  test("an incident the person cannot read is refused before anything else is read", async () => {
    mockIncident({ readable: false });
    const hosts: jest.SpyInstance = jest.spyOn(HostService, "findBy");

    await expect(
      AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      ),
    ).rejects.toThrow("Incident not found");
    expect(hosts).not.toHaveBeenCalled();
  });

  test("an incident the person may read but not change is refused with its own reason", async () => {
    mockIncident();
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(0 as never);
    jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(
        new NotAuthorizedException(
          "You do not have permission to edit this incident.",
        ) as never,
      );

    await expect(
      AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      ),
    ).rejects.toThrow("You do not have permission to edit this incident.");
  });

  test("no incident named, and none on the page: refused, reading nothing", async () => {
    const reads: jest.SpyInstance = jest.spyOn(IncidentService, "findOneById");

    await expect(
      AddIncidentAffectedResourcesTool.execute(
        { affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }] },
        context(HOST_PAGE),
      ),
    ).rejects.toThrow("incidentId is required");
    expect(reads).not.toHaveBeenCalled();
  });

  test("refuses to write without an authenticated user in context", async () => {
    await expect(
      AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: INCIDENT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        { projectId: PROJECT_ID, props: { isRoot: true } },
      ),
    ).rejects.toThrow("No authenticated user");
  });

  test("is a mutation that needs what the incident's Affected Resources Edit needs", () => {
    expect(AddIncidentAffectedResourcesTool.isMutation).toBe(true);
    expect(AddIncidentAffectedResourcesTool.requiredPermissions).toEqual(
      new Incident().getUpdatePermissions(),
    );
  });

  test("prepared on a host's page while about an incident: both written out, and named on the card", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);

    const prepared: PreparedMutation =
      await AddIncidentAffectedResourcesTool.prepareMutation!(
        { incidentId: INCIDENT_ID },
        context(HOST_PAGE),
      );

    expect(prepared.arguments).toEqual({
      incidentId: INCIDENT_ID,
      affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
    });
    expect(prepared.description).toBe('Adds host "test01".');
  });

  test("prepared, the card is titled by the incident's number, read as the person - never its ID", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const read: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation((async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID;
        incident.incidentNumber = 12;
        incident.incidentNumberWithPrefix = "INC-12";
        return incident;
      }) as never);
    const ctx: ToolContext = context(HOST_PAGE);

    const prepared: PreparedMutation =
      await AddIncidentAffectedResourcesTool.prepareMutation!(
        { incidentId: INCIDENT_ID },
        ctx,
      );

    expect(prepared.title).toBe("Link incident INC-12 to affected resources");
    expect(prepared.title).not.toContain(INCIDENT_ID);
    const args: { id: ObjectID; props: unknown } = read.mock.calls[0]![0] as {
      id: ObjectID;
      props: unknown;
    };
    expect(args.id.toString()).toBe(INCIDENT_ID);
    expect(args.props).toBe(ctx.props);
  });

  test("prepared for an incident with no prefix, the title says '#' and its number", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation((async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID;
        incident.incidentNumber = 12;
        return incident;
      }) as never);

    const prepared: PreparedMutation =
      await AddIncidentAffectedResourcesTool.prepareMutation!(
        { incidentId: INCIDENT_ID },
        context(HOST_PAGE),
      );

    expect(prepared.title).toBe("Link incident #12 to affected resources");
  });

  test("prepared for an incident the person may not read, or that cannot be read, no title is offered", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const read: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValueOnce(null as never)
      .mockRejectedValueOnce(new Error("database is gone") as never);

    for (let attempt: number = 0; attempt < 2; attempt++) {
      const prepared: PreparedMutation =
        await AddIncidentAffectedResourcesTool.prepareMutation!(
          { incidentId: INCIDENT_ID },
          context(HOST_PAGE),
        );

      // buildActionTitle's title stands, and the line still names the host.
      expect(prepared.title).toBeUndefined();
      expect(prepared.description).toBe('Adds host "test01".');
    }

    expect(read).toHaveBeenCalledTimes(2);
  });

  test("prepared on an incident's page: the incident is written out", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);

    const prepared: PreparedMutation =
      await AddIncidentAffectedResourcesTool.prepareMutation!(
        { affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }] },
        context(INCIDENT_PAGE),
      );

    expect(prepared.arguments["incidentId"]).toBe(INCIDENT_ID);
  });

  test("buildActionTitle names the incident, and stays tidy with none", () => {
    expect(
      AddIncidentAffectedResourcesTool.buildActionTitle!({
        incidentId: INCIDENT_ID,
      }),
    ).toBe(`Link incident ${INCIDENT_ID} to affected resources`);
    expect(AddIncidentAffectedResourcesTool.buildActionTitle!({})).toBe(
      "Link this incident to affected resources",
    );
  });
});
