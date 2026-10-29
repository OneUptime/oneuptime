import Alert from "../../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../../Models/DatabaseModels/Host";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentTemplateService from "../../../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import {
  getLinkableKinds,
  linkAffectedResourcesFromSetting,
} from "../../../../../Server/Types/Workflow/Components/BaseModel/AffectedResourcesArgument";
import AffectedResourceReferences, {
  AffectedResourceReferenceResolution,
} from "../../../../../Server/Utils/AffectedResources/AffectedResourceReferences";
import { AffectedResourceKind } from "../../../../../Types/AffectedResources/AffectedResourceSearch";
import { AiAffectedResourceKindInfo } from "../../../../../Types/AI/AiAffectedResources";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import ComponentMetadata, {
  Argument,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import { INCIDENT_TEMPLATE_ARGUMENT_ID } from "../../../../../Types/Workflow/CreateFromTemplate";
import {
  AFFECTED_RESOURCES_ARGUMENT_ID,
  MAX_AFFECTED_RESOURCE_REFERENCES,
  MAX_LINKED_AFFECTED_RESOURCES,
} from "../../../../../Types/Workflow/AffectedResourcesSetting";
import { getComponentDocumentation } from "../../../../../Types/Workflow/Documentation/Index";
import ComponentDocumentation, {
  ComponentDocumentationTopic,
} from "../../../../../Types/Workflow/Documentation/ComponentDocumentation";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

// Billing on, as on OneUptime Cloud: a step's props carry the project's plan.
jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * CREATE ONE INCIDENT'S AND CREATE ONE ALERT'S AFFECTED RESOURCES (#5341).
 *
 * An alert from another tool names the router it is about - "WAN-RTR-01",
 * "10.0.4.1" - and the workflow that declares an incident for it links the
 * router by that. The step looks each reference up as itself (a Project
 * Admin of the workflow's project, never root) across every kind the
 * record can hold, and ADDS what it finds to what JSON Object and the
 * template link. A reference that names nothing never fails the step: the
 * incident is what the workflow is for, and the run log says what linked.
 *
 * The lookup itself is AffectedResourceReferences (its own suite); here it
 * is stood in for, and what the step does with its answer is read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);
const TEMPLATE_ID: string = "7d000000-0000-4000-8000-0000000000a1";

const ROUTER_ID: string = "7d000000-0000-4000-8000-0000000000d1";
const HOST_ID: string = "7d000000-0000-4000-8000-0000000000e1";
const OTHER_HOST_ID: string = "7d000000-0000-4000-8000-0000000000e2";
const TEMPLATE_HOST_ID: string = "7d000000-0000-4000-8000-0000000000e3";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

let createIncident: SpyInstance;
let createAlert: SpyInstance;
let fromTemplate: SpyInstance;
let resolveSpy: SpyInstance;

function resolution(
  partial: Partial<AffectedResourceReferenceResolution>,
): AffectedResourceReferenceResolution {
  return {
    resolved: [],
    notFound: [],
    unreadableKinds: [],
    leftOverCap: 0,
    ...partial,
  };
}

const ROUTER_AND_HOST: AffectedResourceReferenceResolution = resolution({
  resolved: [
    {
      kind: AffectedResourceKind.Host,
      id: HOST_ID,
      name: "app-server-01",
      reference: "app-server-01",
    },
    {
      kind: AffectedResourceKind.NetworkDevice,
      id: ROUTER_ID,
      name: "WAN-RTR-01",
      reference: "10.0.4.1",
    },
  ],
});

async function run(
  component: ComponentCode,
  args: JSONObject,
): Promise<StepRun> {
  const lines: Array<string> = [];
  const options: RunOptions = {
    log: ((line: unknown): void => {
      lines.push(typeof line === "string" ? line : JSON.stringify(line));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: WORKFLOW_ID,
    workflowName: "Declare WAN incidents",
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };

  const result: RunReturnType = await component.run(args, options);

  return { result, lines };
}

function runIncidentStep(args: JSONObject): Promise<StepRun> {
  return run(new CreateOneBaseModel<Incident>(IncidentService), args);
}

function runAlertStep(args: JSONObject): Promise<StepRun> {
  return run(new CreateOneBaseModel<Alert>(AlertService), args);
}

function created<T extends BaseModel>(spy: SpyInstance): T {
  return (spy.mock.calls[0]![0] as { data: T }).data;
}

function idsOf(list: unknown): Array<string> {
  return ((list as Array<BaseModel>) || []).map((item: BaseModel): string => {
    return String(item._id);
  });
}

function resolveCall(): {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  references: Array<string>;
  kinds: Array<AffectedResourceKind>;
} {
  return resolveSpy.mock.calls[0]![0] as {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    references: Array<string>;
    kinds: Array<AffectedResourceKind>;
  };
}

beforeEach(() => {
  setTestBillingEnabled(true);

  getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);

  createIncident = getJestSpyOn(IncidentService, "create").mockImplementation(
    (async (createBy: { data: Incident }) => {
      return createBy.data;
    }) as never,
  );
  fromTemplate = getJestSpyOn(
    IncidentService,
    "createFromTemplate",
  ).mockImplementation((async (data: { data: Incident }) => {
    return data.data;
  }) as never);
  createAlert = getJestSpyOn(AlertService, "create").mockImplementation(
    (async (createBy: { data: Alert }) => {
      return createBy.data;
    }) as never,
  );
  resolveSpy = getJestSpyOn(
    AffectedResourceReferences,
    "resolve",
  ).mockResolvedValue(ROUTER_AND_HOST);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("Create One Incident with Affected Resources", () => {
  test("links the router named by its address and the host named by its name, and says so", async () => {
    const step: StepRun = await runIncidentStep({
      json: { title: "WAN is down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "10.0.4.1, app-server-01",
    });

    expect(step.result.executePort?.id).toBe("success");

    const incident: Incident = created<Incident>(createIncident);

    expect(idsOf(incident.networkDevices)).toEqual([ROUTER_ID]);
    expect(incident.networkDevices![0]).toBeInstanceOf(NetworkDevice);
    expect(idsOf(incident.hosts)).toEqual([HOST_ID]);
    expect(incident.hosts![0]).toBeInstanceOf(Host);
    expect(step.lines).toContain(
      "Affected Resources: linked host app-server-01, network device WAN-RTR-01.",
    );
  });

  test("looks the references up as the step - a Project Admin of the project, never root", async () => {
    await runIncidentStep({
      json: { title: "WAN is down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]:
        " 10.0.4.1 ;app-server-01\nAPP-SERVER-01",
    });

    const call: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      references: Array<string>;
      kinds: Array<AffectedResourceKind>;
    } = resolveCall();

    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.references).toEqual(["10.0.4.1", "app-server-01"]);
    expect(call.props.isRoot).toBeFalsy();
    expect(call.props.userType).toBe(UserType.Workflow);
    expect(call.props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(call.props.workflowId?.toString()).toBe(WORKFLOW_ID.toString());

    // The same props create the incident.
    const createdWith: DatabaseCommonInteractionProps = (
      createIncident.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      }
    ).props;

    expect(createdWith).toBe(call.props);
  });

  test("looks in every kind an incident holds - network devices and services among them, never monitors", async () => {
    await runIncidentStep({
      json: { title: "WAN is down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "WAN-RTR-01",
    });

    const kinds: Array<AffectedResourceKind> = resolveCall().kinds;

    expect(kinds).toContain(AffectedResourceKind.NetworkDevice);
    expect(kinds).toContain(AffectedResourceKind.Host);
    expect(kinds).toContain(AffectedResourceKind.Service);
    expect(kinds).toContain(AffectedResourceKind.CloudResource);
    expect(kinds).not.toContain(AffectedResourceKind.Monitor);
    expect(kinds).not.toContain(AffectedResourceKind.NetworkSite);
  });

  test("adds to the lists JSON Object sets, each resource once", async () => {
    resolveSpy.mockResolvedValue(
      resolution({
        resolved: [
          {
            kind: AffectedResourceKind.Host,
            id: HOST_ID,
            name: "app-server-01",
            reference: "app-server-01",
          },
          {
            kind: AffectedResourceKind.Host,
            id: OTHER_HOST_ID,
            name: "app-server-02",
            reference: "app-server-02",
          },
        ],
      }),
    );

    await runIncidentStep({
      json: { title: "WAN is down", hosts: [{ _id: HOST_ID }] },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "app-server-01, app-server-02",
    });

    expect(idsOf(created<Incident>(createIncident).hosts)).toEqual([
      HOST_ID,
      OTHER_HOST_ID,
    ]);
  });

  test("a reference that names nothing is said by name, and never fails the step", async () => {
    resolveSpy.mockResolvedValue(
      resolution({ notFound: ["WAN-RTR-99", "10.9.9.9"] }),
    );

    const step: StepRun = await runIncidentStep({
      json: { title: "WAN is down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "WAN-RTR-99, 10.9.9.9",
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(createIncident).toHaveBeenCalledTimes(1);
    expect(created<Incident>(createIncident).networkDevices).toBeUndefined();
    expect(step.lines).toContain(
      'Affected Resources: nothing in this project is called "WAN-RTR-99", so it was not linked.',
    );
    expect(step.lines).toContain(
      'Affected Resources: nothing in this project is called "10.9.9.9", so it was not linked.',
    );
  });

  test("a kind the workflow may not read is said once, by its noun", async () => {
    resolveSpy.mockResolvedValue(
      resolution({
        unreadableKinds: [
          AffectedResourceKind.DatabaseServer,
          AffectedResourceKind.NetworkDevice,
        ],
      }),
    );

    const step: StepRun = await runIncidentStep({
      json: { title: "WAN is down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "orders-db",
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(step.lines).toContain(
      "Affected Resources: this workflow may not read database server, network device records, so none of them was looked up.",
    );
  });

  test("says how many entries and resources were past the limits", async () => {
    resolveSpy.mockResolvedValue(resolution({ leftOverCap: 7 }));

    const step: StepRun = await runIncidentStep({
      json: { title: "WAN is down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: Array.from(
        { length: MAX_AFFECTED_RESOURCE_REFERENCES + 3 },
        (_value: unknown, index: number): string => {
          return `sw-${index}`;
        },
      ).join(","),
    });

    expect(resolveCall().references).toHaveLength(
      MAX_AFFECTED_RESOURCE_REFERENCES,
    );
    expect(step.lines).toContain(
      `Affected Resources: only the first ${MAX_AFFECTED_RESOURCE_REFERENCES} entries are looked up; 3 more were left out.`,
    );
    expect(step.lines).toContain(
      `Affected Resources: only ${MAX_LINKED_AFFECTED_RESOURCES} resources are linked at once; 7 more were left out.`,
    );
  });

  test.each([
    ["left out", undefined],
    ["empty", ""],
    ["only separators", " , ;\n"],
  ])(
    "a setting %s looks nothing up and logs nothing about it",
    async (_how: string, value: unknown) => {
      const step: StepRun = await runIncidentStep({
        json: { title: "WAN is down" },
        ...(value === undefined
          ? {}
          : { [AFFECTED_RESOURCES_ARGUMENT_ID]: value }),
      });

      expect(step.result.executePort?.id).toBe("success");
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(
        step.lines.filter((line: string): boolean => {
          return line.startsWith("Affected Resources:");
        }),
      ).toEqual([]);
    },
  );

  test("an earlier step's list is read entry by entry", async () => {
    await runIncidentStep({
      json: { title: "WAN is down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: [
        "WAN-RTR-01",
        "core-sw-01, core-sw-02",
      ],
    });

    expect(resolveCall().references).toEqual([
      "WAN-RTR-01",
      "core-sw-01",
      "core-sw-02",
    ]);
  });
});

describe("Create One Incident from a template, with Affected Resources", () => {
  let templateRead: SpyInstance;

  beforeEach(() => {
    templateRead = getJestSpyOn(
      IncidentTemplateService,
      "findOneBy",
    ).mockImplementation((async () => {
      const template: BaseModel = IncidentTemplateService.getModel();
      (template as unknown as Record<string, unknown>)["hosts"] = [
        { _id: TEMPLATE_HOST_ID },
      ];
      return template;
    }) as never);
  });

  test("a list JSON Object leaves out starts from the template's, so the template's hosts stay linked", async () => {
    await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "app-server-01, 10.0.4.1",
    });

    const incident: Incident = created<Incident>(fromTemplate);

    expect(idsOf(incident.hosts)).toEqual([TEMPLATE_HOST_ID, HOST_ID]);
    // A template holds no network devices yet: the router alone.
    expect(idsOf(incident.networkDevices)).toEqual([ROUTER_ID]);

    // Read as the step, for the lists the setting adds to that it has.
    const read: {
      query: JSONObject;
      select: JSONObject;
      props: DatabaseCommonInteractionProps;
    } = templateRead.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      props: DatabaseCommonInteractionProps;
    };

    expect(read.query["_id"]).toBe(TEMPLATE_ID);
    expect(String(read.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(read.select).toEqual({ _id: true, hosts: { _id: true } });
    expect(read.props.isRoot).toBeFalsy();
    expect(read.props.userType).toBe(UserType.Workflow);
  });

  test("a list JSON Object sets is what the setting adds to; the template's is not read for it", async () => {
    resolveSpy.mockResolvedValue(
      resolution({
        resolved: [
          {
            kind: AffectedResourceKind.Host,
            id: HOST_ID,
            name: "app-server-01",
            reference: "app-server-01",
          },
        ],
      }),
    );

    await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      json: { hosts: [{ _id: OTHER_HOST_ID }] },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "app-server-01",
    });

    expect(idsOf(created<Incident>(fromTemplate).hosts)).toEqual([
      OTHER_HOST_ID,
      HOST_ID,
    ]);
    expect(templateRead).not.toHaveBeenCalled();
  });

  test("nothing found reads no template", async () => {
    resolveSpy.mockResolvedValue(resolution({ notFound: ["x"] }));

    await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "x",
    });

    expect(templateRead).not.toHaveBeenCalled();
    expect(fromTemplate).toHaveBeenCalledTimes(1);
  });
});

describe("Create One Alert with Affected Resources", () => {
  test("links the router the alert is about", async () => {
    const step: StepRun = await runAlertStep({
      json: { title: "BGP session down" },
      [AFFECTED_RESOURCES_ARGUMENT_ID]: "10.0.4.1",
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(idsOf(created<Alert>(createAlert).networkDevices)).toEqual([
      ROUTER_ID,
    ]);
    expect(resolveCall().kinds).toContain(AffectedResourceKind.NetworkDevice);
    expect(resolveCall().kinds).not.toContain(AffectedResourceKind.Monitor);
  });
});

describe("the steps that have the setting", () => {
  function createOneOf(model: BaseModel): ComponentMetadata {
    return BaseModelComponents.getComponents(model).find(
      (component: ComponentMetadata): boolean => {
        return component.id.endsWith("-create-one");
      },
    )!;
  }

  test("Create One Incident: the template, JSON Object, then Affected Resources", () => {
    expect(
      createOneOf(new Incident()).arguments.map(
        (argument: Argument): string => {
          return argument.id;
        },
      ),
    ).toEqual([
      INCIDENT_TEMPLATE_ARGUMENT_ID,
      "json",
      AFFECTED_RESOURCES_ARGUMENT_ID,
    ]);
  });

  test("Create One Alert: JSON Object, then Affected Resources", () => {
    expect(
      createOneOf(new Alert()).arguments.map((argument: Argument): string => {
        return argument.id;
      }),
    ).toEqual(["json", AFFECTED_RESOURCES_ARGUMENT_ID]);
  });

  test("no other Create One step has it", () => {
    for (const model of [new Monitor(), new ScheduledMaintenance()]) {
      expect(
        createOneOf(model).arguments.map((argument: Argument): string => {
          return argument.id;
        }),
      ).not.toContain(AFFECTED_RESOURCES_ARGUMENT_ID);
    }
  });

  test("a step without the setting ignores a value given under its name", async () => {
    getJestSpyOn(ScheduledMaintenanceService, "create").mockImplementation(
      (async (createBy: { data: ScheduledMaintenance }) => {
        return createBy.data;
      }) as never,
    );

    await run(
      new CreateOneBaseModel<ScheduledMaintenance>(ScheduledMaintenanceService),
      {
        json: { title: "Router upgrade" },
        [AFFECTED_RESOURCES_ARGUMENT_ID]: "WAN-RTR-01",
      },
    );

    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("the kinds a record can be linked to are its lists: devices on incidents and alerts", () => {
    for (const model of [new Incident(), new Alert()]) {
      const relations: Array<string> = getLinkableKinds(model).map(
        (info: AiAffectedResourceKindInfo): string => {
          return info.relation;
        },
      );

      expect(relations).toContain("networkDevices");
      expect(relations).toContain("hosts");
      expect(relations).not.toContain("monitors");
    }
  });

  test("linking for a table without the setting does nothing at all", async () => {
    const record: Incident = new Incident();

    expect(
      await linkAffectedResourcesFromSetting({
        record,
        tableName: "ScheduledMaintenance",
        value: "WAN-RTR-01",
        projectId: PROJECT_ID,
        props: {} as DatabaseCommonInteractionProps,
        templateId: null,
        log: (): void => {
          return undefined;
        },
      }),
    ).toBeNull();
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

describe("the step's help", () => {
  const STEP_ID: string = "create-incident-1";

  function topicsOf(model: BaseModel): Array<ComponentDocumentationTopic> {
    const documentation: ComponentDocumentation | null =
      getComponentDocumentation({
        metadata: BaseModelComponents.getComponents(model).find(
          (component: ComponentMetadata): boolean => {
            return component.id.endsWith("-create-one");
          },
        )!,
        stepId: STEP_ID,
        graphComponents: [],
      });

    return documentation?.learnMore || [];
  }

  // The help names the record as the model does: "the Incident", "the Alert".
  test.each([
    [
      "Incident",
      new Incident(),
      "Monitors go in **JSON Object**, because linking a monitor to an incident pauses its checks.",
    ],
    [
      "Alert",
      new Alert(),
      "The Alert's monitor goes in **JSON Object**, as `monitorId`.",
    ],
  ])(
    "Create One %s says, under Learn more, what to write, how a name is matched and where its monitor goes",
    (name: string, model: BaseModel, monitorsSentence: string) => {
      const topic: ComponentDocumentationTopic | undefined = topicsOf(
        model,
      ).find((candidate: ComponentDocumentationTopic): boolean => {
        return candidate.title === "Linking what it is about";
      });

      expect(topic).toBeDefined();

      const text: string = topic!.paragraphs.join("\n");

      // What to write comes first, then how it is matched.
      expect(topic!.paragraphs[0]).toContain(
        "Under **Affected Resources**, write the names, addresses or OneUptime IDs",
      );
      expect(text).toContain("network devices");
      expect(text).toContain(`services the ${name} is about`);
      expect(text).toContain("upper or lower case alike");
      expect(text).toContain(`the ${name} is still created`);
      expect(text).toContain("Archived resources are not linked.");
      expect(text).toContain(monitorsSentence);
      // An alert's help never says what an incident's monitors do.
      if (name === "Alert") {
        expect(text).not.toContain("incident");
      }
    },
  );

  test("a Create One step without the setting has no such topic", () => {
    expect(
      topicsOf(new ScheduledMaintenance()).map(
        (topic: ComponentDocumentationTopic): string => {
          return topic.title;
        },
      ),
    ).not.toContain("Linking what it is about");
  });
});
