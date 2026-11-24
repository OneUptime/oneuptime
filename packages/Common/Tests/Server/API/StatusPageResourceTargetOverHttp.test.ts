jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../../App/FeatureSet/MCP/Utils/MCPLogger");

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import StatusPageResourceService, {
  BOTH_TARGETS_MESSAGE,
  NO_TARGET_MESSAGE,
  Service as StatusPageResourceServiceType,
  TARGET_CLEARED_MESSAGE,
} from "../../../Server/Services/StatusPageResourceService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  buildGuidedStatusPageMonitor,
  buildStatusPageResource,
} from "../../../Utils/GuidedSetup/StatusPageRecords";
import { generateAllTools } from "../../../../App/FeatureSet/MCP/Tools/ToolGenerator";
import { McpToolInfo } from "../../../../App/FeatureSet/MCP/Types/McpTypes";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A STATUS PAGE RESOURCE SHOWS A MONITOR OR A MONITOR GROUP, ON EVERY PATH,
 * OVER HTTP (#6558).
 *
 * The API took a resource that named neither - a create with no monitor and
 * no monitor group, an update that cleared the one it showed - and nothing
 * in the product drew it. Now the server refuses both, with a sentence that
 * says what is missing, wherever the write comes from:
 *
 *   - a script, as the API reference's examples send it, and as a person
 *     or an API key;
 *   - Terraform, as the generated provider sends it: every attribute set on
 *     a create, and on an update only what changed, an attribute taken out
 *     of the configuration as an empty string;
 *   - an MCP client, which the MCP server offers no tool to write a
 *     resource with itself: its setup tools put monitors on a page on the
 *     server, each resource a monitor's, through the same service;
 *   - the Dashboard, through its own API client: its forms' requests still
 *     go through, and one that named nothing would read the server's words;
 *   - OneUptime itself - a workflow's step, an import - writing as root.
 *
 * Each goes over HTTP through Express's body parser, the route the App
 * serves (BaseAPI), the permission layer, the service's hooks and the error
 * handler, into a table held in memory (DashboardRequestsOverHttp,
 * InMemoryRepository). Who asks is stood in for, as the other suites here
 * do: the sign-in middleware runs, and the props it would hand on are the
 * caller's.
 *
 * The one-target rule (#6540) holds beside it: a write that names both is
 * still refused, and pointing a resource at one clears the other.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "65580000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: string = "65580000-0000-4000-8000-0000000000a1";
const MONITOR_ID: string = "65580000-0000-4000-8000-0000000000b1";
const OTHER_MONITOR_ID: string = "65580000-0000-4000-8000-0000000000b2";
const MONITOR_GROUP_ID: string = "65580000-0000-4000-8000-0000000000c1";
// A monitor group no resource of the page shows yet.
const OTHER_MONITOR_GROUP_ID: string = "65580000-0000-4000-8000-0000000000c2";

// A resource that shows a monitor, one that shows a group, and one from before the rule.
const MONITOR_RESOURCE_ID: string = "65580000-0000-4000-8000-0000000000d1";
const GROUP_RESOURCE_ID: string = "65580000-0000-4000-8000-0000000000d2";
const EMPTY_RESOURCE_ID: string = "65580000-0000-4000-8000-0000000000d3";

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

const API_KEY: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
    isApiKey: true,
  }),
  ...ON_HIGHEST_PLAN,
};

// A status page's own member, as the Dashboard's Resources page is used.
const STATUS_PAGE_MEMBER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.StatusPageMember],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

// OneUptime itself: a workflow's step, an import, Ask AI's setup.
const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

let server: DashboardRequestsOverHttp;
let resources: InMemoryTable;
let caller: DatabaseCommonInteractionProps;

function storedResource(data: {
  id: string;
  monitorId?: string | undefined;
  monitorGroupId?: string | undefined;
  order: number;
}): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    statusPageId: STATUS_PAGE_ID,
    statusPageGroupId: null,
    monitorId: data.monitorId || null,
    monitorGroupId: data.monitorGroupId || null,
    displayName: `Resource ${data.order}`,
    order: data.order,
  };
}

function answerOf(sent: SentRequest): JSONObject {
  return (sent.answer || {}) as JSONObject;
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = answerOf(sent);
  return String(answer["error"] || answer["message"] || "");
}

/*
 * What a resource shows now, as Postgres would hold it: a write that named a
 * reference by its relation (the Dashboard's forms post `{ _id }`) stores
 * the relation's id in its ID column, as TypeORM does - the table in memory
 * keeps the relation as it was sent.
 */
function showing(id: string): {
  monitorId: string | null;
  monitorGroupId: string | null;
} {
  const row: StoredRow = resources.get(id)!;

  const read: (idColumn: string, relation: string) => string | null = (
    idColumn: string,
    relation: string,
  ): string | null => {
    const related: unknown = row[relation];

    if (related && typeof related === "object" && "_id" in related) {
      return String((related as { _id: unknown })._id);
    }

    return row[idColumn] ? String(row[idColumn]) : null;
  };

  return {
    monitorId: read("monitorId", "monitor"),
    monitorGroupId: read("monitorGroupId", "monitorGroup"),
  };
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<StatusPageResource, StatusPageResourceServiceType>(
      StatusPageResource,
      StatusPageResourceService,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  stubProjectDirectory({});
  everyServerProductIsOn();
  caller = OWNER;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  // A project's first status page monitor is counted elsewhere (#6830).
  jest
    .spyOn(ProjectMilestoneService, "reachInBackground")
    .mockImplementation((): void => {});

  resources = useInMemoryTable(StatusPageResourceService, [
    storedResource({ id: MONITOR_RESOURCE_ID, monitorId: MONITOR_ID, order: 1 }),
    storedResource({
      id: GROUP_RESOURCE_ID,
      monitorGroupId: MONITOR_GROUP_ID,
      order: 2,
    }),
    storedResource({ id: EMPTY_RESOURCE_ID, order: 3 }),
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const CALLERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a person", OWNER],
  ["an API key", API_KEY],
  ["a status page's member", STATUS_PAGE_MEMBER],
  ["OneUptime itself", ROOT],
];

describe("POST /api/status-page-resource, as a script sends it", () => {
  // What every create below carries besides what it shows.
  const PAGE_AND_NAME: JSONObject = {
    statusPageId: STATUS_PAGE_ID,
    projectId: PROJECT_ID.toString(),
    displayName: "Checkout API",
  };

  test.each(
    CALLERS.flatMap(
      ([who, props]: [string, DatabaseCommonInteractionProps]): Array<
        [string, string, DatabaseCommonInteractionProps, JSONObject]
      > => {
        return [
          [who, "the page and a name", props, {}],
          [
            who,
            "both cleared",
            props,
            { monitorId: null, monitorGroupId: null },
          ],
          [who, "a monitor relation with no id", props, { monitor: {} }],
        ];
      },
    ),
  )(
    "by %s, naming %s and nothing to show, is refused with what is missing, and saves nothing",
    async (
      _who: string,
      _shape: string,
      props: DatabaseCommonInteractionProps,
      target: JSONObject,
    ) => {
      caller = props;

      const sent: SentRequest = await server.request(
        "POST",
        "/api/status-page-resource",
        { data: { ...PAGE_AND_NAME, ...target } },
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: NO_TARGET_MESSAGE,
      });
      expect(resources.inserts).toHaveLength(0);
    },
  );

  test.each(CALLERS)(
    "by %s, naming a monitor, goes through",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      caller = props;

      const sent: SentRequest = await server.request(
        "POST",
        "/api/status-page-resource",
        { data: { ...PAGE_AND_NAME, monitorId: OTHER_MONITOR_ID } },
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(resources.inserts).toHaveLength(1);
      expect(String(resources.inserts[0]!["monitorId"])).toBe(
        OTHER_MONITOR_ID,
      );
    },
  );

  test("naming a monitor group goes through", async () => {
    const sent: SentRequest = await server.request(
      "POST",
      "/api/status-page-resource",
      {
        data: {
          ...PAGE_AND_NAME,
          monitorGroupId: OTHER_MONITOR_GROUP_ID,
        },
      },
    );

    expect(sent.status).toBe(200);
    expect(resources.inserts).toHaveLength(1);
  });

  test("naming both is still refused (#6540)", async () => {
    const sent: SentRequest = await server.request(
      "POST",
      "/api/status-page-resource",
      {
        data: {
          ...PAGE_AND_NAME,
          monitorId: OTHER_MONITOR_ID,
          monitorGroupId: OTHER_MONITOR_GROUP_ID,
        },
      },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal: BOTH_TARGETS_MESSAGE,
    });
    expect(resources.inserts).toHaveLength(0);
  });
});

// Every route that updates a record: PUT /:id, and POST /:id/update-item.
function updateRoutes(id: string): Array<[string, string]> {
  return [
    ["PUT", `/api/status-page-resource/${id}`],
    ["POST", `/api/status-page-resource/${id}/update-item`],
  ];
}

describe("an update, PUT /api/status-page-resource/:id and POST .../update-item", () => {
  test.each(
    updateRoutes(MONITOR_RESOURCE_ID).flatMap(
      ([method, path]: [string, string]): Array<
        [string, string, string, DatabaseCommonInteractionProps]
      > => {
        return CALLERS.map(
          ([who, props]: [string, DatabaseCommonInteractionProps]): [
            string,
            string,
            string,
            DatabaseCommonInteractionProps,
          ] => {
            return [method, path, who, props];
          },
        );
      },
    ),
  )(
    "%s %s by %s, clearing the monitor a resource shows, is refused, and writes nothing",
    async (
      method: string,
      path: string,
      _who: string,
      props: DatabaseCommonInteractionProps,
    ) => {
      caller = props;

      const sent: SentRequest = await server.request(method, path, {
        data: { monitorId: null },
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: TARGET_CLEARED_MESSAGE,
      });
      expect(resources.updates).toHaveLength(0);
      expect(showing(MONITOR_RESOURCE_ID)).toEqual({
        monitorId: MONITOR_ID,
        monitorGroupId: null,
      });
    },
  );

  test.each(updateRoutes(GROUP_RESOURCE_ID))(
    "%s %s, clearing the group a resource shows by its relation, is refused",
    async (method: string, path: string) => {
      const sent: SentRequest = await server.request(method, path, {
        data: { monitorGroup: null, displayName: "Checkout" },
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: TARGET_CLEARED_MESSAGE,
      });
      expect(resources.updates).toHaveLength(0);
    },
  );

  test("clearing both is refused", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/status-page-resource/${MONITOR_RESOURCE_ID}`,
      { data: { monitorId: null, monitorGroupId: null } },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal: TARGET_CLEARED_MESSAGE,
    });
    expect(resources.updates).toHaveLength(0);
  });

  test("pointing a monitor's resource at a group, clearing its monitor in the same write, goes through", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/status-page-resource/${MONITOR_RESOURCE_ID}`,
      {
        data: {
          monitorId: null,
          monitorGroupId: OTHER_MONITOR_GROUP_ID,
        },
      },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(showing(MONITOR_RESOURCE_ID)).toEqual({
      monitorId: null,
      monitorGroupId: OTHER_MONITOR_GROUP_ID,
    });
  });

  test("pointing a group's resource at a monitor alone clears its group (#6540)", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/status-page-resource/${GROUP_RESOURCE_ID}`,
      { data: { monitorId: OTHER_MONITOR_ID } },
    );

    expect(sent.status).toBe(200);
    expect(showing(GROUP_RESOURCE_ID)).toEqual({
      monitorId: OTHER_MONITOR_ID,
      monitorGroupId: null,
    });
  });

  test("clearing the group a monitor's resource never had goes through: it still shows its monitor", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/status-page-resource/${MONITOR_RESOURCE_ID}`,
      { data: { monitorGroupId: null } },
    );

    expect(sent.status).toBe(200);
    expect(showing(MONITOR_RESOURCE_ID)).toEqual({
      monitorId: MONITOR_ID,
      monitorGroupId: null,
    });
  });

  test("a rename goes through", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/status-page-resource/${MONITOR_RESOURCE_ID}`,
      { data: { displayName: "Checkout API" } },
    );

    expect(sent.status).toBe(200);
    expect(resources.get(MONITOR_RESOURCE_ID)!["displayName"]).toBe(
      "Checkout API",
    );
  });

  describe("of a resource that already shows nothing, from before the rule", () => {
    test("a rename goes through", async () => {
      const sent: SentRequest = await server.request(
        "PUT",
        `/api/status-page-resource/${EMPTY_RESOURCE_ID}`,
        { data: { displayName: "Checkout API" } },
      );

      expect(sent.status).toBe(200);
    });

    test("giving it a monitor goes through, and mends it", async () => {
      const sent: SentRequest = await server.request(
        "PUT",
        `/api/status-page-resource/${EMPTY_RESOURCE_ID}`,
        { data: { monitorId: OTHER_MONITOR_ID } },
      );

      expect(sent.status).toBe(200);
      expect(showing(EMPTY_RESOURCE_ID)).toEqual({
        monitorId: OTHER_MONITOR_ID,
        monitorGroupId: null,
      });
    });

    test("clearing it again is refused", async () => {
      const sent: SentRequest = await server.request(
        "PUT",
        `/api/status-page-resource/${EMPTY_RESOURCE_ID}`,
        { data: { monitorId: null } },
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: TARGET_CLEARED_MESSAGE,
      });
    });
  });
});

/*
 * The generated provider (Scripts/TerraformProvider): a create sends every
 * attribute the configuration sets, and an update only the attributes that
 * changed - one taken out of the configuration as the empty string Go's
 * ValueString() gives a null.
 */
describe("Terraform, as the provider sends it", () => {
  beforeEach(() => {
    caller = API_KEY;
  });

  test("an oneuptime_status_page_resource with neither monitor_id nor monitor_group_id is refused on apply", async () => {
    const sent: SentRequest = await server.request(
      "POST",
      "/api/status-page-resource",
      {
        data: {
          statusPageId: STATUS_PAGE_ID,
          displayName: "Checkout API",
          displayDescription: "Takes payments.",
          showCurrentStatus: true,
          showUptimePercent: false,
          showStatusHistoryChart: true,
        },
      },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal: NO_TARGET_MESSAGE,
    });
    expect(resources.inserts).toHaveLength(0);
  });

  test("taking monitor_id out of the configuration is refused, and the resource keeps its monitor", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/status-page-resource/${MONITOR_RESOURCE_ID}`,
      { data: { monitorId: "" } },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal: TARGET_CLEARED_MESSAGE,
    });
    expect(showing(MONITOR_RESOURCE_ID)).toEqual({
      monitorId: MONITOR_ID,
      monitorGroupId: null,
    });
  });

  test("swapping monitor_id for monitor_group_id goes through in one apply", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/status-page-resource/${MONITOR_RESOURCE_ID}`,
      {
        data: {
          monitorId: "",
          monitorGroupId: OTHER_MONITOR_GROUP_ID,
        },
      },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(showing(MONITOR_RESOURCE_ID).monitorGroupId).toBe(
      OTHER_MONITOR_GROUP_ID,
    );
  });
});

/*
 * The MCP server writes no status page resource itself: StatusPageResource
 * is not one of its models (EnableMCP), so it has no create or update tool
 * for one. An agent puts monitors on a page with publish_status_page and
 * add_monitors_to_status_page, which run on the server as the person
 * (Server/Utils/AI/Toolbox/SetupTools, as Ask AI's do) and build each
 * resource with buildGuidedStatusPageMonitor - a monitor's, always. They
 * write through the same service, with the same hooks, so a resource that
 * named nothing would be refused there too.
 */
describe("an MCP client, through the MCP server", () => {
  test("is offered no tool that writes a status page resource itself", () => {
    const resourceTools: Array<string> = generateAllTools()
      .filter((tool: McpToolInfo): boolean => {
        return tool.tableName === "StatusPageResource";
      })
      .map((tool: McpToolInfo): string => {
        return tool.name;
      });

    expect(resourceTools).toEqual([]);
    expect(new StatusPageResource().enableMCP).toBeFalsy();
  });

  test("its setup tools' resources name their monitor, and go through the service's hooks", async () => {
    await StatusPageResourceService.create({
      data: buildGuidedStatusPageMonitor({
        projectId: PROJECT_ID,
        statusPageId: new ObjectID(STATUS_PAGE_ID),
        monitorId: new ObjectID(OTHER_MONITOR_ID),
        monitorName: "Checkout API",
      }),
      props: OWNER,
    });

    expect(resources.inserts).toHaveLength(1);
    expect(String(resources.inserts[0]!["monitorId"])).toBe(OTHER_MONITOR_ID);
  });

  test("a resource built without what it shows would be refused there", async () => {
    await expect(
      StatusPageResourceService.create({
        data: buildStatusPageResource({
          placement: {
            projectId: PROJECT_ID,
            statusPageId: new ObjectID(STATUS_PAGE_ID),
          },
          displayName: "Checkout API",
          displayDescription: undefined,
        }),
        props: OWNER,
      }),
    ).rejects.toThrow(NO_TARGET_MESSAGE);

    expect(resources.inserts).toHaveLength(0);
  });
});

describe("the Dashboard, through its own API client", () => {
  beforeEach(() => {
    caller = STATUS_PAGE_MEMBER;
  });

  function newResource(): StatusPageResource {
    const resource: StatusPageResource = new StatusPageResource();
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = STATUS_PAGE_ID;
    resource.statusPage = statusPage;
    resource.statusPageId = new ObjectID(STATUS_PAGE_ID);
    resource.projectId = PROJECT_ID;
    resource.displayName = "Checkout API";
    return resource;
  }

  test("Add Monitor's request, a monitor picked, goes through", async () => {
    const resource: StatusPageResource = newResource();
    const monitor: Monitor = new Monitor();
    monitor._id = OTHER_MONITOR_ID;
    resource.monitor = monitor;

    await ModelAPI.create<StatusPageResource>({
      model: resource,
      modelType: StatusPageResource,
    });

    expect(server.requests.map((sent: SentRequest) => sent.status)).toEqual([
      200,
    ]);
    expect(String(resources.inserts[0]!["monitorId"])).toBe(OTHER_MONITOR_ID);
  });

  test("Edit resource's request on a monitor's row, switched to a group, goes through and clears the monitor", async () => {
    const monitorGroup: MonitorGroup = new MonitorGroup();
    monitorGroup._id = OTHER_MONITOR_GROUP_ID;

    await ModelAPI.updateById<StatusPageResource>({
      modelType: StatusPageResource,
      id: new ObjectID(MONITOR_RESOURCE_ID),
      data: { monitorGroup: monitorGroup, displayName: "Checkout API" },
    });

    expect(showing(MONITOR_RESOURCE_ID)).toEqual({
      monitorId: null,
      monitorGroupId: OTHER_MONITOR_GROUP_ID,
    });
  });

  test("a create that named nothing to show would be refused, and the page reads why", async () => {
    let message: string = "";

    try {
      await ModelAPI.create<StatusPageResource>({
        model: newResource(),
        modelType: StatusPageResource,
      });
    } catch (error) {
      message = API.getFriendlyMessage(error);
    }

    expect(message).toBe(NO_TARGET_MESSAGE);
    expect(resources.inserts).toHaveLength(0);
  });

  test("an edit that cleared what the row shows would be refused, and the page reads why", async () => {
    let message: string = "";

    try {
      await ModelAPI.updateById<StatusPageResource>({
        modelType: StatusPageResource,
        id: new ObjectID(MONITOR_RESOURCE_ID),
        data: { monitor: null, displayName: "Checkout API" },
      });
    } catch (error) {
      message = API.getFriendlyMessage(error);
    }

    expect(message).toBe(TARGET_CLEARED_MESSAGE);
    expect(resources.updates).toHaveLength(0);
  });
});
