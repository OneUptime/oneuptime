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
import http from "http";
import type { AddressInfo } from "net";
import { FindOperator } from "typeorm";

/*
 * MICROSOFT TEAMS' CREATE NEW INCIDENT CARD, END TO END, ON THE REAL
 * BOTBUILDER STACK (#5303 follow-up).
 *
 * The Affected Resources input is a dynamic typeahead: Teams sends the bot
 * an "application/search" invoke as the person types, and lists what the
 * invoke's HTTP answer holds. Only the real CloudAdapter shows what Teams
 * gets back - a turn's return value becomes the invoke response, its status
 * the HTTP status and its body the body - so this file runs the stack for
 * real, as MicrosoftTeamsCreateCommandsEndToEnd does (see its header for
 * how the real botbuilder gets in, and why there are two realms):
 *
 *   activity -> MicrosoftTeamsUtil.processBotActivity -> real CloudAdapter
 *     -> real TeamsActivityHandler -> the bot -> real ConnectorClient
 *     -> a fake Bot Connector on 127.0.0.1, which records what is sent.
 *
 * It pins, as Teams sees it:
 *
 *   - "incident" typed in a channel answers with the card, whose Affected
 *     Resources input searches the card's project and lists nothing itself;
 *   - a search is answered HTTP 200 with the search response Teams reads -
 *     the project's resources that match, read as whoever typed, at most
 *     fifteen - and sends nothing into the conversation;
 *   - somebody whose account nobody connected, and a card of a project the
 *     organization is not connected to, get 200 with no results, and
 *     nothing said either;
 *   - the card, submitted with picks, declares the incident linked to them
 *     as the member, and the confirmation says what it is linked to.
 *
 * Only the database seams are stood in for; each kind of resource is a
 * table the stand-in reads as a query asks.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
});

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import { MicrosoftTeamsIncidentActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAffectedResources from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsAffectedResources";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceAffectedResources from "../../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import { getAffectedResourceKindService } from "../../../../Server/Utils/AffectedResources/AffectedResourceSearch";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AIService from "../../../../Server/Services/AIService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import { AiAffectedResourceKind } from "../../../../Types/AI/AiAffectedResources";
import { AffectedResourceKind } from "../../../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import logger from "../../../../Server/Utils/Logger";
import { stubPrivateRecords } from "../../TestingUtils/PrivateRecords";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from "botbuilder";

// ---- A fake Bot Connector: records what the bot sends, accepts it all ----

interface ConnectorRequest {
  method: string;
  path: string;
  activity: JSONObject | null;
}

interface FakeBotConnector {
  serviceUrl: string;
  requests: Array<ConnectorRequest>;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let nextMessageNumber: number = 0;

  const fakeConnector: FakeBotConnector = {
    serviceUrl: "",
    requests: [],
    close: async (): Promise<void> => {
      return undefined;
    },
  };

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      let bodyText: string = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        bodyText += chunk;
      });
      req.on("end", () => {
        let activity: JSONObject | null = null;

        try {
          activity = bodyText ? (JSON.parse(bodyText) as JSONObject) : null;
        } catch {
          activity = null;
        }

        fakeConnector.requests.push({
          method: req.method || "",
          path: (req.url || "/").split("?")[0] || "/",
          activity: activity,
        });

        nextMessageNumber++;
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ id: `msg-${nextMessageNumber}` }));
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address: AddressInfo = server.address() as AddressInfo;
  fakeConnector.serviceUrl = `http://127.0.0.1:${address.port}/`;
  fakeConnector.close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  };

  return fakeConnector;
}

// ---- What Teams gets back for an activity ----

class RecordingResponse {
  public statusCode: number | null = null;
  public body: unknown = undefined;
  public headersSent: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public send(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public json(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public end(): this {
    this.headersSent = true;
    return this;
  }

  public header(): this {
    return this;
  }

  public setHeader(): this {
    return this;
  }
}

// ---- The project behind the bot ----

const TENANT_ID: string = "5303aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOT: JSONObject = { id: "28:oneuptime-bot", name: "OneUptime" };
const SENDER: JSONObject = {
  id: "29:1jane",
  name: "Jane Doe",
  aadObjectId: "00000000-0000-4000-8000-000000005303",
};
const CHANNEL_CONVERSATION_ID: string = "19:ops-5303@thread.tacv2";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const USER_ID: ObjectID = new ObjectID("53030000-0000-4000-8000-0000000000a1");
const SEVERITY_ID: ObjectID = new ObjectID(
  "53030000-0000-4000-8000-0000000000c1",
);
const CREATED_ID: ObjectID = new ObjectID(
  "53030000-0000-4000-8000-0000000000e1",
);
const API_1: string = "53030000-0000-4000-8000-000000000101";
const API_2: string = "53030000-0000-4000-8000-000000000102";
const PROD: string = "53030000-0000-4000-8000-000000000201";

interface ResourceRow {
  kind: AiAffectedResourceKind;
  id: string;
  name: string;
}

let projectId: ObjectID;
let resources: Array<ResourceRow>;

// The rows of a kind a query asks for, as the stand-in database reads it.
function rowsFor(
  kind: AiAffectedResourceKind,
  query: JSONObject,
): Array<ResourceRow> {
  const search: unknown = query["_multiFieldSearch"];
  const startsWith: unknown = query["name"];
  const idCondition: unknown = query["_id"];
  let ids: Array<string> | null = null;

  if (idCondition instanceof FindOperator) {
    for (const value of Object.values(
      (idCondition.objectLiteralParameters as Record<string, unknown>) || {},
    )) {
      if (Array.isArray(value)) {
        ids = value.map((id: unknown): string => {
          return String(id).toLowerCase();
        });
      }
    }
  }

  if (String(query["projectId"]) !== projectId.toString()) {
    return [];
  }

  return resources.filter((row: ResourceRow): boolean => {
    return (
      row.kind === kind &&
      (!ids || ids.includes(row.id)) &&
      (!(search instanceof MultiSearch) ||
        row.name.toLowerCase().includes(search.value.toLowerCase())) &&
      (!(startsWith instanceof StartsWith) ||
        row.name.toLowerCase().startsWith(String(startsWith.value)))
    );
  });
}

function memberProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: [Permission.ProjectMember].map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              isBlockPermission: false,
              labelIds: [],
            };
          },
        ),
      },
    },
  };
}

// ---- Activities, as Teams sends them ----

let activityCounter: number = 0;
const RUN_TOKEN: string = ObjectID.generate().toString().substring(0, 8);

function nextActivityId(label: string): string {
  activityCounter++;
  return `5303-${RUN_TOKEN}-${label}-${activityCounter}`;
}

const CONVERSATION: JSONObject = {
  conversationType: "channel",
  tenantId: TENANT_ID,
  id: CHANNEL_CONVERSATION_ID,
  isGroup: true,
};

const CHANNEL_DATA: JSONObject = {
  tenant: { id: TENANT_ID },
  team: { id: "19:ops-team-5303@thread.tacv2", name: "Operations" },
  channel: { id: CHANNEL_CONVERSATION_ID, name: "ops" },
};

function messageActivity(text: string): JSONObject {
  return {
    type: "message",
    id: nextActivityId("message"),
    timestamp: "2026-11-03T10:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: CONVERSATION,
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: `<at>OneUptime</at> ${text}`,
    entities: [{ type: "mention", text: "<at>OneUptime</at>", mentioned: BOT }],
    channelData: CHANNEL_DATA,
  };
}

function searchActivity(data: {
  queryText: string;
  dataset: string;
}): JSONObject {
  return {
    type: "invoke",
    name: "application/search",
    id: nextActivityId("search"),
    timestamp: "2026-11-03T10:01:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: CONVERSATION,
    recipient: BOT,
    locale: "en-US",
    value: {
      queryText: data.queryText,
      queryOptions: { skip: 0, top: 15 },
      dataset: data.dataset,
    },
    channelData: { ...CHANNEL_DATA, source: { name: "compose" } },
  };
}

function submitActivity(data: {
  replyToId: string;
  value: JSONObject;
}): JSONObject {
  return {
    type: "message",
    id: nextActivityId("submit"),
    replyToId: data.replyToId,
    timestamp: "2026-11-03T10:02:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: CONVERSATION,
    recipient: BOT,
    locale: "en-US",
    channelData: {
      ...CHANNEL_DATA,
      source: { name: "message" },
      legacy: { replyToId: data.replyToId },
    },
    value: data.value,
  };
}

interface Delivery {
  httpStatus: number | null;
  httpBody: unknown;
  sent: Array<ConnectorRequest>;
}

async function deliver(activity: JSONObject): Promise<Delivery> {
  const first: number = connector.requests.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: {},
      body: JSON.parse(JSON.stringify(activity)),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  return {
    httpStatus: res.statusCode,
    httpBody: res.body,
    sent: connector.requests.slice(first),
  };
}

function cardOf(request: ConnectorRequest | undefined): JSONObject {
  const attachment: JSONObject | undefined = ((request?.activity?.[
    "attachments"
  ] as Array<JSONObject> | undefined) || [])[0];

  expect(attachment).toBeDefined();
  return attachment!["content"] as JSONObject;
}

function elementOf(card: JSONObject, id: string): JSONObject {
  const element: JSONObject | undefined = (
    card["body"] as Array<JSONObject>
  ).find((candidate: JSONObject): boolean => {
    return candidate["id"] === id;
  });

  expect(element).toBeDefined();
  return element!;
}

function resultsOf(delivery: Delivery): Array<JSONObject> {
  expect(delivery.httpStatus).toBe(200);
  const body: JSONObject = delivery.httpBody as JSONObject;
  expect(body["type"]).toBe("application/vnd.microsoft.search.searchResponse");

  return (body["value"] as JSONObject)["results"] as Array<JSONObject>;
}

// ---- Lifecycle ----

let connector: FakeBotConnector;
let created: Array<{
  data: Incident;
  props: DatabaseCommonInteractionProps;
}>;
let isLinked: boolean;
let connectedProjectId: () => ObjectID;

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.requests.splice(0);
  projectId = ObjectID.generate();
  connectedProjectId = (): ObjectID => {
    return projectId;
  };
  created = [];
  isLinked = true;
  resources = [
    { kind: AiAffectedResourceKind.Host, id: API_1, name: "api-1" },
    { kind: AiAffectedResourceKind.Host, id: API_2, name: "api-2" },
    { kind: AiAffectedResourceKind.KubernetesCluster, id: PROD, name: "prod" },
  ];

  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = new CloudAdapter(
    new ConfigurationBotFrameworkAuthentication({}),
  );

  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  stubPrivateRecords();

  jest
    .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
    .mockImplementation(async (): Promise<MicrosoftTeamsTenantResolution> => {
      const connected: ObjectID = connectedProjectId();

      return {
        projectAuth: {
          projectId: connected,
        } as unknown as WorkspaceProjectAuthToken,
        isAmbiguous: false,
        candidateProjectIds: [connected],
      };
    });
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        captureChatFromBotActivity: () => Promise<void>;
      },
      "captureChatFromBotActivity",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(MicrosoftTeamsUtil, "captureTeamFromBotActivity")
    .mockResolvedValue(undefined);

  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockImplementation(async (): Promise<ObjectID> => {
      if (!isLinked) {
        throw new MicrosoftTeamsAccountNotLinkedException("Not linked.");
      }

      return USER_ID;
    });
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(async () => {
      return memberProps();
    });
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue(undefined);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
  // The project's AI is on: Affected Resources says what AI does with picks.
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);

  // The card's lists: one severity, none of the rest.
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((async () => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ID.toString();
      severity.name = "Critical";
      return [severity];
    }) as never);
  for (const service of [
    MonitorService,
    LabelService,
    OnCallDutyPolicyService,
    MonitorStatusService,
  ]) {
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(service as typeof MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  }

  // No channel here is a record's own.
  jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
  jest.spyOn(AlertService, "findOneBy").mockResolvedValue(null);

  // Each kind of resource, a table the stand-in reads as a query asks.
  for (const kind of WorkspaceAffectedResources.getKinds()) {
    const service: {
      modelType: { new (): BaseModel };
      findBy: (data: unknown) => Promise<Array<BaseModel>>;
      countBy: (data: unknown) => Promise<PositiveNumber>;
    } = getAffectedResourceKindService(
      kind as unknown as AffectedResourceKind,
    ) as never;

    jest.spyOn(service, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
      limit?: number;
    }) => {
      return rowsFor(kind, findBy.query)
        .slice(0, findBy.limit || 10)
        .map((row: ResourceRow): BaseModel => {
          const model: BaseModel = new service.modelType();
          model._id = row.id;
          (model as unknown as Record<string, unknown>)["name"] = row.name;
          return model;
        });
    }) as never);
    jest.spyOn(service, "countBy").mockImplementation((async (countBy: {
      query: JSONObject;
    }) => {
      return new PositiveNumber(rowsFor(kind, countBy.query).length);
    }) as never);
  }

  jest.spyOn(IncidentService, "create").mockImplementation((async (create: {
    data: Incident;
    props: DatabaseCommonInteractionProps;
  }) => {
    created.push({ data: create.data, props: create.props });
    const incident: Incident = new Incident();
    incident.id = CREATED_ID;
    incident.incidentNumber = 43;
    incident.incidentNumberWithPrefix = "INC-43";
    return incident;
  }) as never);

  // A connect request, were one kept: in memory.
  const kept: Map<string, string> = new Map<string, string>();
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        kept.set(`${namespace}:${key}`, value);
      },
    );
  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return kept.get(`${namespace}:${key}`) ?? null;
    });
});

afterEach(() => {
  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = null;
  jest.restoreAllMocks();
});

describe("Teams' Create New Incident card and its typeahead, as Teams sees them", () => {
  test("botbuilder is the real package, the one this file needs", () => {
    expect(typeof CloudAdapter.prototype.process).toBe("function");
  });

  test("'incident' in a channel answers with the card, whose Affected Resources input searches the card's project and lists nothing itself", async () => {
    const delivery: Delivery = await deliver(messageActivity("incident"));

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.sent).toHaveLength(1);

    const card: JSONObject = cardOf(delivery.sent[0]);
    const input: JSONObject = elementOf(card, "affectedResources");

    expect(input["type"]).toBe("Input.ChoiceSet");
    expect(input["choices.data"]).toEqual({
      type: "Data.Query",
      dataset: MicrosoftTeamsAffectedResources.getDataset(projectId),
    });
    expect(input["choices"]).toEqual([]);
    expect(JSON.stringify(card)).not.toContain("api-1");

    // Right under it, in the card's small print: what OneUptime AI does with the picks.
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;
    const hint: JSONObject = body[body.indexOf(input) + 1]!;
    expect(hint).toEqual(
      expect.objectContaining({
        type: "TextBlock",
        text: "OneUptime AI investigates what you pick here, and can fix it.",
        isSubtle: true,
        size: "Small",
      }),
    );
  });

  test("a search is answered 200 with what matches, read as whoever typed - and nothing is said in the conversation", async () => {
    const delivery: Delivery = await deliver(
      searchActivity({
        queryText: "api",
        dataset: MicrosoftTeamsAffectedResources.getDataset(projectId),
      }),
    );

    expect(resultsOf(delivery)).toEqual([
      { title: "api-1 (Host)", value: `Host:${API_1}` },
      { title: "api-2 (Host)", value: `Host:${API_2}` },
    ]);
    expect(delivery.sent).toEqual([]);
    expect(
      MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId,
    ).toHaveBeenCalledWith({
      teamsUserId: SENDER["aadObjectId"],
      projectId: projectId,
    });
  });

  test("at most fifteen results, as Teams lists", async () => {
    resources = Array.from(
      { length: 40 },
      (_value: unknown, index: number): ResourceRow => {
        return {
          kind: AiAffectedResourceKind.Host,
          id: `53030000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
          name: `web-${String(index).padStart(2, "0")}`,
        };
      },
    );

    const delivery: Delivery = await deliver(
      searchActivity({
        queryText: "web",
        dataset: MicrosoftTeamsAffectedResources.getDataset(projectId),
      }),
    );

    expect(resultsOf(delivery)).toHaveLength(15);
  });

  test("somebody whose Teams account nobody connected: 200, no results, nothing said", async () => {
    isLinked = false;

    const delivery: Delivery = await deliver(
      searchActivity({
        queryText: "api",
        dataset: MicrosoftTeamsAffectedResources.getDataset(projectId),
      }),
    );

    expect(resultsOf(delivery)).toEqual([]);
    expect(delivery.sent).toEqual([]);
  });

  test("a card of a project the organization is not connected to: 200, no results - never this project's resources", async () => {
    const delivery: Delivery = await deliver(
      searchActivity({
        queryText: "api",
        dataset: MicrosoftTeamsAffectedResources.getDataset(
          ObjectID.generate(),
        ),
      }),
    );

    expect(resultsOf(delivery)).toEqual([]);
    expect(delivery.sent).toEqual([]);
  });

  test("the card, submitted with picks: declared as the member, linked to them, and the confirmation says so", async () => {
    const delivery: Delivery = await deliver(
      submitActivity({
        replyToId: "msg-card",
        value: {
          action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
          incidentTitle: "Checkout is slow",
          incidentDescription: "Requests time out.",
          incidentSeverity: SEVERITY_ID.toString(),
          affectedResources: `Host:${API_1},KubernetesCluster:${PROD}`,
        },
      }),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(created).toHaveLength(1);
    expect(
      (created[0]!.data.hosts || []).map((row: BaseModel): string => {
        return row.id!.toString();
      }),
    ).toEqual([API_1]);
    expect(
      (created[0]!.data.kubernetesClusters || []).map(
        (row: BaseModel): string => {
          return row.id!.toString();
        },
      ),
    ).toEqual([PROD]);
    expect(created[0]!.props.userId?.toString()).toBe(USER_ID.toString());

    const confirmation: ConnectorRequest | undefined = delivery.sent.find(
      (request: ConnectorRequest): boolean => {
        return request.method === "POST";
      },
    );

    expect(confirmation?.activity?.["text"]).toBe(
      `✅ Incident created successfully!\n\nView incident: ${DASHBOARD_URL}/${projectId.toString()}/incidents/${CREATED_ID.toString()}\n\nLinked to **api-1** (Host) and **prod** (Kubernetes Cluster).`,
    );
  });

  test("a pick that can no longer be linked: declared all the same, and a reply that mentions whoever submitted it names the incident first", async () => {
    const delivery: Delivery = await deliver(
      submitActivity({
        replyToId: "msg-card",
        value: {
          action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
          incidentTitle: "Checkout is slow",
          incidentDescription: "Requests time out.",
          incidentSeverity: SEVERITY_ID.toString(),
          // The second host is another project's: never linked here.
          affectedResources: `Host:${API_1},Host:${ObjectID.generate().toString()}`,
        },
      }),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(created).toHaveLength(1);

    const posts: Array<ConnectorRequest> = delivery.sent.filter(
      (request: ConnectorRequest): boolean => {
        return request.method === "POST";
      },
    );
    const incidentUrl: string = `${DASHBOARD_URL}/${projectId.toString()}/incidents/${CREATED_ID.toString()}`;

    expect(posts[0]?.activity?.["text"]).toBe(
      `✅ Incident created successfully!\n\nView incident: ${incidentUrl}\n\nLinked to **api-1** (Host).`,
    );

    const reply: JSONObject = cardOf(posts[1]);
    expect((reply["body"] as Array<JSONObject>)[0]!["text"]).toBe(
      `<at>Jane Doe</at> The incident **[INC-43](${incidentUrl})** is not linked to 1 resource you picked: it was deleted or archived, or you may no longer view it.`,
    );
    expect(
      ((reply["msteams"] as JSONObject)["entities"] as Array<JSONObject>)[0],
    ).toEqual({
      type: "mention",
      text: "<at>Jane Doe</at>",
      mentioned: { id: "29:1jane", name: "Jane Doe" },
    });
    // A notification of it says the same, as text.
    expect(posts[1]?.activity?.["summary"]).toBe(
      "The incident INC-43 is not linked to 1 resource you picked: it was deleted or archived, or you may no longer view it.",
    );
  });
});
