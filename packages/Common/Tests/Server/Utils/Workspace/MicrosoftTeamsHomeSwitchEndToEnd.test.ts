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
 * SWITCH PROJECT ON THE MICROSOFT TEAMS HOME, END TO END.
 *
 * One Microsoft 365 organization connected to several OneUptime projects,
 * and Deane, connected as a member in two or more of them. His Home - typed
 * "home", or sent as the welcome when he adds the app - shows one project
 * at a time, as Slack's Home tab does: the one he chose last, else the
 * first of his, never asked which first. Under the line that names it, a
 * Switch project menu lists his others: one button "Switch to IRM Non-Prod"
 * for one other, a dropdown and a Switch button for more. A switch draws the
 * card again in place, for the project chosen, read again as his member
 * there; his later Homes open on it (WorkspaceHomeChoice). A press for a
 * project he may not see draws nothing of it.
 *
 * Through the REAL botbuilder stack against a fake Bot Connector
 * (Tests/Helpers/FakeBotConnector): the projects' rows, names, links and
 * memberships are the only things stubbed, with what each reader reads.
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

// Where the bot keeps a question's request, and Teams' redelivery claims.
jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { DRAWN_FOR_PROJECT_ID_FIELD } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardProject";
import { MicrosoftTeamsHomeActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHome";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceHome, {
  WorkspaceHomeView,
} from "../../../../Server/Utils/Workspace/WorkspaceHome";
import WorkspaceProjectResolver from "../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceOpenRecordKind from "../../../../Types/Workspace/WorkspaceOpenRecordKind";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  ConnectorCall,
  Delivery,
  FakeBotConnector,
  cardOf,
  deliverToBot,
  elementsOf,
  postsOf,
  startFakeBotConnector,
  submitsOf,
  textOfCard,
} from "../../../Helpers/FakeBotConnector";
import {
  InMemoryWorkspaceHomeChoices,
  useInMemoryWorkspaceHomeChoices,
} from "../../../Helpers/InMemoryWorkspaceHomeChoices";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler,
} from "botbuilder";

type CachedAdapterSlot = { cachedAdapter: CloudAdapter | null };

// ---- The organization, its projects, and the people in it ----

const TENANT_ID: string = "7b2e0000-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PLATFORM: ObjectID = new ObjectID("f4000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f4000000-0000-4000-8000-000000000002");
const SANDBOX: ObjectID = new ObjectID("f4000000-0000-4000-8000-000000000003");
const FINANCE: ObjectID = new ObjectID("f4000000-0000-4000-8000-000000000004");
const DEANES_MEMBER: ObjectID = new ObjectID(
  "f4000000-0000-4000-8000-0000000000d1",
);

const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
const DEANE: JSONObject = {
  id: "29:1deane",
  name: "Deane Barker",
  aadObjectId: "00000000-0000-4000-8000-00000000dea1",
};
const NITIN: JSONObject = {
  id: "29:1nitin",
  name: "Nitin",
  aadObjectId: "00000000-0000-4000-8000-0000000000a2",
};
const PERSONAL_CONVERSATION_ID: string = "a:7b2e-deane-personal-chat";
const GROUP_CHAT_ID: string = "19:7b2e-ops-chat@thread.v2";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";

const REFUSED_SWITCH: string =
  "⚠️ You can't switch to that project: you're no longer a member of it, or your Microsoft Teams account isn't connected there.";

let connector: FakeBotConnector;
let activityNumber: number = 0;
let names: Record<string, string>;
let connected: Array<ObjectID>;
// The projects Deane's Teams account is connected in, and is a member of.
let linkedIn: Array<ObjectID>;
let memberOf: Array<ObjectID>;
let blocked: Array<ObjectID>;
let membersRead: Array<string>;
let homesRead: Array<string>;
let loggedErrors: Array<string>;
let homeChoices: InMemoryWorkspaceHomeChoices;

function isOneOf(projectId: ObjectID | string, list: Array<ObjectID>): boolean {
  return list.some((candidate: ObjectID): boolean => {
    return candidate.toString() === projectId.toString().toLowerCase();
  });
}

// The ids a query's value names: an id, or QueryHelper.any's values.
function idsOf(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (value instanceof ObjectID || typeof value === "string") {
    return [value.toString().toLowerCase()];
  }

  const parameters: JSONObject | undefined = (
    value as { objectLiteralParameters?: JSONObject }
  ).objectLiteralParameters;

  return Object.values(parameters || {})
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });
}

function nextActivityId(label: string): string {
  activityNumber++;
  return `7b2e-${label}-${activityNumber}-${ObjectID.generate().toString().substring(0, 8)}`;
}

// What somebody types to the bot: in Deane's chat with it, or a group chat.
function message(
  text: string,
  options?: {
    from?: JSONObject | undefined;
    where?: "personal" | "group" | undefined;
  },
): JSONObject {
  const inGroup: boolean = options?.where === "group";

  return {
    type: "message",
    id: nextActivityId("message"),
    timestamp: "2026-11-03T09:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: options?.from || DEANE,
    conversation: inGroup
      ? {
          conversationType: "groupChat",
          tenantId: TENANT_ID,
          id: GROUP_CHAT_ID,
          isGroup: true,
        }
      : {
          conversationType: "personal",
          tenantId: TENANT_ID,
          id: PERSONAL_CONVERSATION_ID,
        },
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: inGroup ? `<at>OneUptime</at> ${text}` : text,
    entities: inGroup
      ? [{ type: "mention", text: "<at>OneUptime</at>", mentioned: BOT }]
      : [],
    channelData: { tenant: { id: TENANT_ID } },
  };
}

/*
 * A press of a card's Action.Submit, as Teams sends it: a message whose
 * value is the button's data - and what the card's inputs hold - in reply
 * to the card.
 */
function press(
  value: JSONObject,
  replyToId: string,
  options?: {
    from?: JSONObject | undefined;
    where?: "personal" | "group" | undefined;
  },
): JSONObject {
  const pressed: JSONObject = message("", options);

  delete pressed["text"];
  pressed["entities"] = [];
  pressed["value"] = value;
  pressed["replyToId"] = replyToId;

  return pressed;
}

async function deliver(activity: JSONObject): Promise<Delivery> {
  return await deliverToBot(connector, activity);
}

// The one card a delivery sent or drew in place.
function onlyCardOf(delivery: Delivery): ConnectorCall {
  expect(delivery.httpStatus).toBe(200);
  expect(delivery.calls).toHaveLength(1);

  return delivery.calls[0]!;
}

// The Switch project menu of a Home card: its button, or its dropdown and button.
interface DrawnMenu {
  // One other project: the button that names it.
  button: JSONObject | null;
  // More: the dropdown's options, by title and value.
  options: Array<{ title: string; value: string }> | null;
  dropdown: JSONObject | null;
  submit: JSONObject | null;
}

function menuOf(call: ConnectorCall): DrawnMenu {
  const card: JSONObject = cardOf(call);
  const dropdowns: Array<JSONObject> = elementsOf(card, "Input.ChoiceSet");
  const switches: Array<JSONObject> = submitsOf(card).filter(
    (submit: JSONObject): boolean => {
      return (
        (submit["data"] as JSONObject)["action"] ===
        MicrosoftTeamsHomeActionType.SwitchProject
      );
    },
  );

  expect(dropdowns.length).toBeLessThanOrEqual(1);
  expect(switches.length).toBeLessThanOrEqual(1);

  if (dropdowns[0]) {
    return {
      button: null,
      dropdown: dropdowns[0],
      options: (dropdowns[0]["choices"] as Array<JSONObject>).map(
        (choice: JSONObject): { title: string; value: string } => {
          return {
            title: String(choice["title"]),
            value: String(choice["value"]),
          };
        },
      ),
      submit: switches[0] || null,
    };
  }

  return {
    button: switches[0] || null,
    dropdown: null,
    options: null,
    submit: null,
  };
}

// The Home's own buttons: the card's actions, by their action.
function homeButtonOf(
  call: ConnectorCall,
  action: MicrosoftTeamsHomeActionType,
): JSONObject {
  const button: JSONObject | undefined = (
    (cardOf(call)["actions"] as Array<JSONObject> | undefined) || []
  ).find((candidate: JSONObject): boolean => {
    return (candidate["data"] as JSONObject | undefined)?.["action"] === action;
  });

  expect(button).toBeDefined();

  return button!;
}

function homeView(projectId: ObjectID): WorkspaceHomeView {
  return {
    projectName: names[projectId.toString()] || null,
    firstName: "Deane",
    onCall: { now: [], next: null, isNowCut: false },
    incidents: {
      kind: WorkspaceOpenRecordKind.Incidents,
      list: { records: [], isCut: false, link: null } as never,
      refused: false,
      failed: false,
    },
    alerts: {
      kind: WorkspaceOpenRecordKind.Alerts,
      list: { records: [], isCut: false, link: null } as never,
      refused: false,
      failed: false,
    },
    dashboardLink: null,
    readAt: new Date("2026-11-03T09:00:00.000Z"),
  };
}

// The line every Home names its project on.
function projectLineOf(call: ConnectorCall): string {
  const line: string | undefined = textOfCard(call)
    .split("\n")
    .find((text: string): boolean => {
      return text.startsWith("Here's what is happening in");
    });

  return line || "";
}

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.calls.splice(0);
  (GlobalCache as unknown as { store: Map<string, unknown> }).store.clear();
  names = {
    [PLATFORM.toString()]: "IRM Platform",
    [NONPRD.toString()]: "IRM Non-Prod",
    [SANDBOX.toString()]: "IRM Sandbox",
    [FINANCE.toString()]: "IRM Finance",
  };
  connected = [PLATFORM, NONPRD];
  linkedIn = [PLATFORM, NONPRD];
  memberOf = [PLATFORM, NONPRD];
  blocked = [];
  membersRead = [];
  homesRead = [];
  homeChoices = useInMemoryWorkspaceHomeChoices();

  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter =
    new CloudAdapter(new ConfigurationBotFrameworkAuthentication({}));

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

  // The organization's connections, in the order they were made.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async () => {
      return connected.map((projectId: ObjectID): WorkspaceProjectAuthToken => {
        const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
        row.projectId = projectId;
        row.workspaceProjectId = TENANT_ID;
        row.authToken = "app-token";
        return row;
      });
    }) as never);

  // Deane's Teams account, connected where linkedIn says; Nitin's nowhere.
  const linksMatching: (query: JSONObject) => Array<WorkspaceUserAuthToken> = (
    query: JSONObject,
  ): Array<WorkspaceUserAuthToken> => {
    if (query["workspaceUserId"] !== DEANE["aadObjectId"]) {
      return [];
    }

    const projectIds: Array<string> = idsOf(query["projectId"]);

    return linkedIn
      .filter((projectId: ObjectID): boolean => {
        return (
          projectIds.length === 0 || projectIds.includes(projectId.toString())
        );
      })
      .map((projectId: ObjectID): WorkspaceUserAuthToken => {
        const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        link.projectId = projectId;
        link.userId = DEANES_MEMBER;
        return link;
      });
  };

  jest
    .spyOn(WorkspaceUserAuthTokenService, "findBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      return linksMatching(args.query);
    }) as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      return linksMatching(args.query)[0] || null;
    }) as never);

  jest
    .spyOn(WorkspaceActionAuthorization, "isProjectMember")
    .mockImplementation((async (data: { projectId: ObjectID }) => {
      return isOneOf(data.projectId, memberOf);
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation((async (data: { projectId: ObjectID }) => {
      membersRead.push(data.projectId.toString());

      if (!isOneOf(data.projectId, memberOf)) {
        throw new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        );
      }

      if (isOneOf(data.projectId, blocked)) {
        throw new NotAuthorizedException(ExceptionMessages.ProjectBlocked);
      }

      return {
        userId: DEANES_MEMBER,
        tenantId: data.projectId,
      } as DatabaseCommonInteractionProps;
    }) as never);

  // The projects' names, for the menu and the line that names one.
  jest.spyOn(ProjectService, "findBy").mockImplementation((async (args: {
    query: JSONObject;
  }) => {
    return idsOf(args.query["_id"])
      .filter((id: string): boolean => {
        return Boolean(names[id]);
      })
      .map((id: string): Project => {
        const project: Project = new Project();
        project.id = new ObjectID(id);
        project.name = names[id]!;
        return project;
      });
  }) as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.name = new Name("Deane Barker");
    return user;
  }) as never);

  // No channel here belongs to one project.
  jest
    .spyOn(WorkspaceProjectResolver, "findProjectsOfChannel")
    .mockResolvedValue([]);

  // What a Home holds, read as Deane in its project.
  jest.spyOn(WorkspaceHome, "read").mockImplementation((async (data: {
    projectId: ObjectID;
  }) => {
    homesRead.push(data.projectId.toString());
    return homeView(data.projectId);
  }) as never);

  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });

  loggedErrors = [];
  jest.spyOn(logger, "error").mockImplementation((line: unknown) => {
    loggedErrors.push(String(line));
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter = null;
  jest.restoreAllMocks();
});

// Deane types "home" in his chat with the bot: the one card it answers with.
async function typedHome(): Promise<ConnectorCall> {
  const delivery: Delivery = await deliver(message("home"));

  expect(postsOf(delivery)).toHaveLength(1);

  return postsOf(delivery)[0]!;
}

// A press of a Home's Switch project menu, choosing `value` in its dropdown.
function chooseIn(menu: DrawnMenu, value: unknown): JSONObject {
  return {
    ...((menu.submit!["data"] as JSONObject) || {}),
    actionValue: value,
  } as JSONObject;
}

describe("harness: the real botbuilder stack", () => {
  test("botbuilder is the real package, not Common's stub", () => {
    expect(typeof CloudAdapter.prototype.process).toBe("function");
    expect(typeof TeamsActivityHandler.prototype.run).toBe("function");
  });
});

describe("Deane, in two of the organization's projects, types 'home'", () => {
  test("his Home of the first of his projects, never the question which project - with one button that switches to the other", async () => {
    const home: ConnectorCall = await typedHome();

    expect(home.conversationId).toBe(PERSONAL_CONVERSATION_ID);
    expect(textOfCard(home)).not.toContain("Which project is this for?");
    expect(projectLineOf(home)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    expect(textOfCard(home).split("\n")[0]).toBe("👋 Hi Deane");

    const menu: DrawnMenu = menuOf(home);

    expect(menu.dropdown).toBeNull();
    expect(menu.button!["title"]).toBe("Switch to IRM Non-Prod");
    expect(menu.button!["data"]).toEqual({
      action: MicrosoftTeamsHomeActionType.SwitchProject,
      actionValue: NONPRD.toString(),
      [DRAWN_FOR_PROJECT_ID_FIELD]: PLATFORM.toString(),
    });

    // Right under the line that names the project, before the lists.
    const body: Array<JSONObject> = cardOf(home)["body"] as Array<JSONObject>;
    const lineAt: number = body.findIndex((element: JSONObject): boolean => {
      return String(element["text"] || "").startsWith(
        "Here's what is happening in",
      );
    });

    expect(body[lineAt + 1]!["type"]).toBe("ActionSet");
    expect(body[lineAt + 1]).toMatchObject({ spacing: "Small" });

    // The Home's own buttons act in its project, and check no menu: there is none.
    for (const action of [
      MicrosoftTeamsHomeActionType.DeclareIncident,
      MicrosoftTeamsHomeActionType.Refresh,
    ]) {
      const button: JSONObject = homeButtonOf(home, action);

      expect((button["data"] as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD]).toBe(
        PLATFORM.toString(),
      );
      expect(button["associatedInputs"]).toBeUndefined();
    }

    expect(homesRead).toEqual([PLATFORM.toString()]);
    expect(homeChoices.rows).toEqual([]);
    expect(loggedErrors).toEqual([]);
  });

  test("he presses Switch to IRM Non-Prod: the card becomes IRM Non-Prod's Home in place, read as his member there - its buttons act there, its menu switches back - and it is kept", async () => {
    const home: ConnectorCall = await typedHome();
    membersRead = [];
    homesRead = [];

    const switched: ConnectorCall = onlyCardOf(
      await deliver(
        press(menuOf(home).button!["data"] as JSONObject, home.messageId!),
      ),
    );

    expect([switched.method, switched.activityId]).toEqual([
      "PUT",
      home.messageId,
    ]);
    expect(projectLineOf(switched)).toBe(
      "Here's what is happening in **IRM Non-Prod**.",
    );
    expect(textOfCard(switched)).not.toContain(REFUSED_SWITCH);
    expect(menuOf(switched).button!["title"]).toBe("Switch to IRM Platform");
    expect(membersRead).toEqual([NONPRD.toString()]);
    expect(homesRead).toEqual([NONPRD.toString()]);

    for (const submit of submitsOf(cardOf(switched))) {
      expect((submit["data"] as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD]).toBe(
        NONPRD.toString(),
      );
    }

    expect(homeChoices.rows).toEqual([
      expect.objectContaining({
        projectId: NONPRD.toString(),
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: DEANE["aadObjectId"],
      }),
    ]);
    expect(loggedErrors).toEqual([]);
  });

  test("his next 'home', and Refresh, open on the project he chose - and switching back is kept too", async () => {
    const home: ConnectorCall = await typedHome();

    await deliver(
      press(menuOf(home).button!["data"] as JSONObject, home.messageId!),
    );

    const next: ConnectorCall = await typedHome();

    expect(projectLineOf(next)).toBe(
      "Here's what is happening in **IRM Non-Prod**.",
    );

    const refreshed: ConnectorCall = onlyCardOf(
      await deliver(
        press(
          homeButtonOf(next, MicrosoftTeamsHomeActionType.Refresh)[
            "data"
          ] as JSONObject,
          next.messageId!,
        ),
      ),
    );

    expect(refreshed.method).toBe("PUT");
    expect(projectLineOf(refreshed)).toBe(
      "Here's what is happening in **IRM Non-Prod**.",
    );
    expect(menuOf(refreshed).button!["title"]).toBe("Switch to IRM Platform");

    await deliver(
      press(menuOf(refreshed).button!["data"] as JSONObject, next.messageId!),
    );

    expect(projectLineOf(await typedHome())).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
  });

  test("Teams delivering his switch twice - after a slow answer - draws it once", async () => {
    const home: ConnectorCall = await typedHome();
    const pressed: JSONObject = press(
      menuOf(home).button!["data"] as JSONObject,
      home.messageId!,
    );

    expect((await deliver(pressed)).calls).toHaveLength(1);
    expect((await deliver(pressed)).calls).toEqual([]);
  });
});

describe("in more than two projects: a dropdown, and a Switch button", () => {
  beforeEach(() => {
    connected = [PLATFORM, NONPRD, SANDBOX, FINANCE];
    linkedIn = [PLATFORM, NONPRD, SANDBOX];
    memberOf = [PLATFORM, NONPRD, SANDBOX];
  });

  test("his other projects in the order they were connected, never one he is not connected in - the dropdown checked before it is sent, the Home's own buttons sending none of it", async () => {
    const home: ConnectorCall = await typedHome();
    const menu: DrawnMenu = menuOf(home);

    expect(menu.button).toBeNull();
    expect(menu.dropdown).toMatchObject({
      type: "Input.ChoiceSet",
      id: "actionValue",
      style: "compact",
      placeholder: "Switch project",
      isRequired: true,
      errorMessage: "Choose a project to switch to.",
    });
    expect(menu.options).toEqual([
      { title: "IRM Non-Prod", value: NONPRD.toString() },
      { title: "IRM Sandbox", value: SANDBOX.toString() },
    ]);
    expect(JSON.stringify(cardOf(home))).not.toContain("IRM Finance");
    expect(menu.submit).toMatchObject({
      title: "Switch",
      data: {
        action: MicrosoftTeamsHomeActionType.SwitchProject,
        [DRAWN_FOR_PROJECT_ID_FIELD]: PLATFORM.toString(),
      },
    });
    // The button sends what the dropdown holds: it carries no value of its own.
    expect((menu.submit!["data"] as JSONObject)["actionValue"]).toBeUndefined();

    // The dropdown and its button side by side, under the project's line.
    const columnSets: Array<JSONObject> = elementsOf(cardOf(home), "ColumnSet");

    expect(columnSets).toHaveLength(1);
    expect(
      (columnSets[0]!["columns"] as Array<JSONObject>).map(
        (column: JSONObject): unknown => {
          return column["width"];
        },
      ),
    ).toEqual(["stretch", "auto"]);

    // Declare incident, Refresh: neither checks nor sends the dropdown.
    for (const action of (cardOf(home)["actions"] as Array<JSONObject>) || []) {
      if (action["type"] === "Action.Submit") {
        expect(action["associatedInputs"]).toBe("none");
      }
    }
  });

  test("he chooses IRM Sandbox and presses Switch: IRM Sandbox's Home in place, its dropdown listing the other two", async () => {
    const home: ConnectorCall = await typedHome();

    const switched: ConnectorCall = onlyCardOf(
      await deliver(
        press(chooseIn(menuOf(home), SANDBOX.toString()), home.messageId!),
      ),
    );

    expect(switched.method).toBe("PUT");
    expect(projectLineOf(switched)).toBe(
      "Here's what is happening in **IRM Sandbox**.",
    );
    expect(menuOf(switched).options).toEqual([
      { title: "IRM Platform", value: PLATFORM.toString() },
      { title: "IRM Non-Prod", value: NONPRD.toString() },
    ]);
    expect(projectLineOf(await typedHome())).toBe(
      "Here's what is happening in **IRM Sandbox**.",
    );
  });

  test("long names: cut to what a button shows, with '…', and named in full on the Home they switch to", async () => {
    const longName: string =
      `IRM Sandbox ${"for the payments platform ".repeat(4)}`.trim();
    names[SANDBOX.toString()] = longName;

    const home: ConnectorCall = await typedHome();
    const title: string = menuOf(home).options![1]!.title;

    expect(title.length).toBe(75);
    expect(title.endsWith("…")).toBe(true);
    expect(longName.startsWith(title.slice(0, -1).trimEnd())).toBe(true);

    const switched: ConnectorCall = onlyCardOf(
      await deliver(
        press(chooseIn(menuOf(home), SANDBOX.toString()), home.messageId!),
      ),
    );

    expect(projectLineOf(switched)).toBe(
      `Here's what is happening in **${longName}**.`,
    );
  });
});

describe("a switch that cannot be made draws nothing of the project it names", () => {
  test("a project he was removed from after the menu was drawn: his Home as it opens, saying first that he can't switch - nothing of it read, nothing kept", async () => {
    const home: ConnectorCall = await typedHome();

    memberOf = [PLATFORM];
    membersRead = [];
    homesRead = [];

    const refused: ConnectorCall = onlyCardOf(
      await deliver(
        press(menuOf(home).button!["data"] as JSONObject, home.messageId!),
      ),
    );

    expect(refused.method).toBe("PUT");
    expect(textOfCard(refused).split("\n").slice(0, 2)).toEqual([
      "👋 Hi Deane",
      REFUSED_SWITCH,
    ]);
    expect(projectLineOf(refused)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    // One project left: nothing to switch to.
    expect(menuOf(refused).button).toBeNull();
    expect(membersRead).not.toContain(NONPRD.toString());
    expect(homesRead).toEqual([PLATFORM.toString()]);
    expect(homeChoices.rows).toEqual([]);
  });

  test("a press he could not have made - a project he is not connected in, another organization's, a random id, none, not an id - his Home as it opens, saying so, and nothing kept", async () => {
    connected = [PLATFORM, NONPRD, FINANCE];
    const home: ConnectorCall = await typedHome();

    for (const value of [
      FINANCE.toString(),
      ObjectID.generate().toString(),
      "",
      "not-a-project",
      42,
      null,
    ]) {
      homesRead = [];
      membersRead = [];

      const refused: ConnectorCall = onlyCardOf(
        await deliver(
          press(
            {
              action: MicrosoftTeamsHomeActionType.SwitchProject,
              actionValue: value,
              [DRAWN_FOR_PROJECT_ID_FIELD]: PLATFORM.toString(),
            } as JSONObject,
            home.messageId!,
          ),
        ),
      );

      expect({ value, line: projectLineOf(refused) }).toEqual({
        value,
        line: "Here's what is happening in **IRM Platform**.",
      });
      expect(textOfCard(refused)).toContain(REFUSED_SWITCH);
      expect(JSON.stringify(cardOf(refused))).not.toContain("IRM Finance");
      expect(membersRead).toEqual([PLATFORM.toString()]);
    }

    expect(homeChoices.rows).toEqual([]);
  });

  test("a switch refused while he has chosen before: his Home falls back to the project he chose last", async () => {
    connected = [PLATFORM, NONPRD, SANDBOX];
    linkedIn = [PLATFORM, NONPRD, SANDBOX];
    memberOf = [PLATFORM, NONPRD, SANDBOX];

    const home: ConnectorCall = await typedHome();

    await deliver(
      press(chooseIn(menuOf(home), SANDBOX.toString()), home.messageId!),
    );

    const refused: ConnectorCall = onlyCardOf(
      await deliver(
        press(chooseIn(menuOf(home), "not-a-project"), home.messageId!),
      ),
    );

    expect(projectLineOf(refused)).toBe(
      "Here's what is happening in **IRM Sandbox**.",
    );
    expect(textOfCard(refused)).toContain(REFUSED_SWITCH);
  });

  test("Nitin, connected in no project, pressing Deane's Switch in a group chat: told so in a reply that mentions him - Deane's card is left as it is, nothing read or kept", async () => {
    const delivery: Delivery = await deliver(
      message("home", { where: "group" }),
    );
    const home: ConnectorCall = postsOf(delivery)[0]!;

    membersRead = [];
    homesRead = [];

    const pressed: Delivery = await deliver(
      press(menuOf(home).button!["data"] as JSONObject, home.messageId!, {
        from: NITIN,
        where: "group",
      }),
    );

    expect(
      pressed.calls.map((call: ConnectorCall): string => {
        return call.method;
      }),
    ).toEqual(["POST"]);
    expect(textOfCard(pressed.calls[0])).toBe(
      `<at>Nitin</at> ${REFUSED_SWITCH}`,
    );
    expect(pressed.calls[0]!.conversationId).toBe(GROUP_CHAT_ID);
    expect(membersRead).toEqual([]);
    expect(homesRead).toEqual([]);
    expect(homeChoices.rows).toEqual([]);
  });
});

describe("a project that refuses him still names itself, with the menu, so he can switch away", () => {
  test("IRM Non-Prod, the project he chose, blocked by an administrator: 'home' greets him, names it, says why - nothing it holds read, no buttons - and he switches to IRM Platform", async () => {
    const home: ConnectorCall = await typedHome();

    await deliver(
      press(menuOf(home).button!["data"] as JSONObject, home.messageId!),
    );

    blocked = [NONPRD];
    homesRead = [];

    const refused: ConnectorCall = await typedHome();

    expect(textOfCard(refused).split("\n")).toEqual([
      "👋 Hi Deane",
      "Here's what is happening in **IRM Non-Prod**.",
      ExceptionMessages.ProjectBlocked,
    ]);
    expect(menuOf(refused).button!["title"]).toBe("Switch to IRM Platform");
    expect(homesRead).toEqual([]);
    expect(cardOf(refused)["actions"]).toEqual([]);

    const away: ConnectorCall = onlyCardOf(
      await deliver(
        press(
          menuOf(refused).button!["data"] as JSONObject,
          refused.messageId!,
        ),
      ),
    );

    expect(projectLineOf(away)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    expect(textOfCard(away)).not.toContain(ExceptionMessages.ProjectBlocked);
    expect(projectLineOf(await typedHome())).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
  });

  test("somebody in one project whose project is blocked is told so in a reply, as before", async () => {
    connected = [PLATFORM];
    linkedIn = [PLATFORM];
    memberOf = [PLATFORM];
    blocked = [PLATFORM];

    const delivery: Delivery = await deliver(message("home"));

    expect(postsOf(delivery)).toHaveLength(1);
    expect(textOfCard(postsOf(delivery)[0])).toBe(
      `<at>Deane Barker</at> ${ExceptionMessages.ProjectBlocked}`,
    );
    expect(elementsOf(cardOf(postsOf(delivery)[0]), "ActionSet")).toEqual([]);
  });
});

describe("the welcome of somebody who adds the app for themselves", () => {
  function added(): JSONObject {
    const activity: JSONObject = {
      ...message(""),
      type: "conversationUpdate",
      membersAdded: [{ id: BOT["id"] }],
    };
    delete activity["text"];
    return activity;
  }

  test("in two projects: his Home - the first of his, or the one he chose - with Switch on it, not a hello that names no project", async () => {
    const welcome: Delivery = await deliver(added());
    const home: ConnectorCall = postsOf(welcome)[0]!;

    expect(postsOf(welcome)).toHaveLength(1);
    expect(textOfCard(home)).not.toContain("Hi, I'm OneUptime");
    expect(projectLineOf(home)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    expect(menuOf(home).button!["title"]).toBe("Switch to IRM Non-Prod");

    for (const submit of submitsOf(cardOf(home))) {
      expect((submit["data"] as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD]).toBe(
        PLATFORM.toString(),
      );
    }

    // Having chosen IRM Non-Prod, a welcome after reinstalling opens there.
    await deliver(
      press(menuOf(home).button!["data"] as JSONObject, home.messageId!),
    );

    expect(projectLineOf(postsOf(await deliver(added()))[0]!)).toBe(
      "Here's what is happening in **IRM Non-Prod**.",
    );
  });

  test("in one of the organization's projects: his Home, with no menu, as before", async () => {
    memberOf = [PLATFORM];

    const home: ConnectorCall = postsOf(await deliver(added()))[0]!;

    expect(projectLineOf(home)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    expect(menuOf(home).button).toBeNull();
    expect(menuOf(home).dropdown).toBeNull();
  });

  test("connected in none of them: the hello, as before", async () => {
    linkedIn = [];
    memberOf = [];

    const hello: ConnectorCall = postsOf(await deliver(added()))[0]!;

    expect(textOfCard(hello)).toContain("Hi, I'm OneUptime");
  });
});

describe("what does not change", () => {
  test("somebody in one project: their Home, with no menu, its buttons naming the project", async () => {
    memberOf = [NONPRD];
    linkedIn = [NONPRD];

    const home: ConnectorCall = await typedHome();

    expect(projectLineOf(home)).toBe(
      "Here's what is happening in **IRM Non-Prod**.",
    );
    expect(menuOf(home).button).toBeNull();
    expect(elementsOf(cardOf(home), "Input.ChoiceSet")).toEqual([]);
  });

  test("an organization connected to one project: the Home as it always was - no menu, nothing read of choices", async () => {
    connected = [PLATFORM];

    const home: ConnectorCall = await typedHome();

    expect(projectLineOf(home)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    expect(menuOf(home).button).toBeNull();
    expect(homeChoices.reads()).toBe(0);

    // Nor do its buttons carry a project: one is all there is.
    for (const submit of submitsOf(cardOf(home))) {
      expect(
        (submit["data"] as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD],
      ).toBeUndefined();
    }
  });

  test("the projects' names cannot be read: the Home of the first, with no menu - never a nameless button", async () => {
    jest
      .spyOn(ProjectService, "findBy")
      .mockRejectedValue(new Error("connection refused"));

    const home: ConnectorCall = await typedHome();

    expect(projectLineOf(home)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    expect(menuOf(home).button).toBeNull();
  });

  test("the choices cannot be read or kept: the Home of the first; a switch still draws the project chosen, which 'home' cannot keep - and that is logged", async () => {
    homeChoices.failWith(new Error("connection refused"));

    const home: ConnectorCall = await typedHome();

    expect(projectLineOf(home)).toBe(
      "Here's what is happening in **IRM Platform**.",
    );

    const switched: ConnectorCall = onlyCardOf(
      await deliver(
        press(menuOf(home).button!["data"] as JSONObject, home.messageId!),
      ),
    );

    expect(projectLineOf(switched)).toBe(
      "Here's what is happening in **IRM Non-Prod**.",
    );
    expect(projectLineOf(await typedHome())).toBe(
      "Here's what is happening in **IRM Platform**.",
    );
    expect(loggedErrors).toContain(
      "Could not record the project a chat Home was switched to.",
    );
  });

  test("a Home button of a card sent before cards carried their project still asks which project, and is made again there", async () => {
    const pressed: Delivery = await deliver(
      press(
        { action: MicrosoftTeamsHomeActionType.Refresh, actionValue: "" },
        "msg-old-home",
      ),
    );

    expect(textOfCard(postsOf(pressed)[0])).toContain(
      "Which project is this for?",
    );
  });
});
