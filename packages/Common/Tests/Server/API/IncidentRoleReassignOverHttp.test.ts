jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * The monitor's incident path pulls the native isolated-vm addon through
 * its template renderer; nothing here runs it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeRoleMemberService, {
  ALREADY_HOLDS_EPISODE_ROLE_MESSAGE,
  ALREADY_HOLDS_TARGET_EPISODE_ROLE_MESSAGE,
} from "../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMemberService, {
  ALREADY_HOLDS_INCIDENT_ROLE_MESSAGE,
  ALREADY_HOLDS_TARGET_ROLE_MESSAGE,
  MOVE_ONE_ROLE_AT_A_TIME_MESSAGE,
  REASSIGN_ONE_ROLE_AT_A_TIME_MESSAGE,
  NOT_A_PROJECT_MEMBER_ROLE_MESSAGE,
  ROLE_HOLDER_REQUIRED_MESSAGE,
  ROLE_REQUIRED_MESSAGE,
} from "../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import IncidentService from "../../../Server/Services/IncidentService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  reassignIncidentEpisodeRole,
  reassignIncidentRole,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventRoleAssignment";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  clearPrivateRecords,
  InMemoryTable,
  setPrivateRecords,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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
 * REASSIGN, THROUGH THE SERVER'S OWN ROUTES OVER HTTP (#10191).
 *
 * The Incident Roles card's Reassign took the commander's role off its
 * holder with a DELETE and gave it to the person picked with a POST. A
 * customer who may hand roles on but not delete role rows read "You do not
 * have permission to delete this Incident member" behind the dialog, and a
 * POST refused after the DELETE went through left the incident with no
 * commander at all.
 *
 * Reassign is now one PUT of the role's row: the row keeps its incident
 * and its role and names the person picked, and the server asks what any
 * change of the row asks - Edit Incident Member - never the delete. Here
 * each kind of caller sends it through Express's JSON body parser, BaseAPI,
 * the permission layer, IncidentMemberService's hooks and the error
 * handler, into tables held in memory: who may hand a role on and who may
 * not, what the row and the feed hold afterwards, and what the server
 * refuses. The Dashboard's own request is sent by the Dashboard's own code
 * (reassignIncidentRole). An episode's Reassign is carried into each of its
 * incidents the same way.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";

const PROJECT_ID: ObjectID = new ObjectID(
  "10191000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: string = "10191000-0000-4000-8000-0000000000a1";
const OTHER_INCIDENT_ID: string = "10191000-0000-4000-8000-0000000000a2";
const THIRD_INCIDENT_ID: string = "10191000-0000-4000-8000-0000000000a3";
const EPISODE_ID: string = "10191000-0000-4000-8000-0000000000e1";

const COMMANDER_ROLE_ID: string = "10191000-0000-4000-8000-0000000000c1";
const RESPONDER_ROLE_ID: string = "10191000-0000-4000-8000-0000000000c2";

const MAYA_ID: string = "10191000-0000-4000-8000-0000000000b1";
const JORDAN_ID: string = "10191000-0000-4000-8000-0000000000b2";
const SAM_ID: string = "10191000-0000-4000-8000-0000000000b3";
const OUTSIDER_ID: string = "10191000-0000-4000-8000-0000000000b9";

// Maya commands the incident; Sam responds to it.
const COMMANDER_ROW_ID: string = "10191000-0000-4000-8000-0000000000d1";
const RESPONDER_ROW_ID: string = "10191000-0000-4000-8000-0000000000d2";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [MAYA_ID]: { name: "Maya Chen", email: "maya.chen@acme-commerce.example" },
  [JORDAN_ID]: {
    name: "Jordan Patel",
    email: "jordan.patel@acme-commerce.example",
  },
  [SAM_ID]: { name: "Sam Rivera", email: "sam.rivera@acme-commerce.example" },
};

const ROLES: Record<string, string> = {
  [COMMANDER_ROLE_ID]: "Incident Commander",
  [RESPONDER_ROLE_ID]: "Responder",
};

const personLink: (userId: string) => string = (userId: string): string => {
  return `[${PEOPLE[userId]!.name}](${DASHBOARD}/${PROJECT_ID.toString()}/users/${userId})`;
};

const INCIDENT_LINK: string = `[Incident INC-18](${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID})`;

/*
 * A teammate holding exactly `permissions` in the project, with a person of
 * their own (`userId`, Ana by default, who holds no role here).
 */
const ANA_ID: string = "10191000-0000-4000-8000-0000000000b4";

const teammate: (
  permissions: Array<Permission>,
  userId?: string,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
  userId?: string,
): DatabaseCommonInteractionProps => {
  return {
    ...customDomainCaller({
      /*
       * A role row is read through its incident or episode: a custom role
       * that works its roles reads those too.
       */
      permissions: [
        Permission.ReadProjectIncident,
        Permission.ReadIncidentEpisode,
        ...permissions,
      ],
      projectId: PROJECT_ID,
    }),
    userId: new ObjectID(userId || ANA_ID),
    ...ON_HIGHEST_PLAN,
  };
};

// Who may change a role row: what a custom role that hands roles on holds.
const EDITOR: DatabaseCommonInteractionProps = teammate([
  Permission.ReadIncidentMember,
  Permission.EditIncidentMember,
]);

/*
 * Who may give a role and take one off, and nothing more: the two
 * permissions Reassign used to need. Handing a role on is a change of the
 * row, which they may not make.
 */
const GIVER_AND_TAKER: DatabaseCommonInteractionProps = teammate([
  Permission.ReadIncidentMember,
  Permission.CreateIncidentMember,
  Permission.DeleteIncidentMember,
]);

/*
 * The customer's case: may hand a role on and give one, but not take
 * anybody off a role - the delete Reassign used to send first.
 */
const NO_DELETE: DatabaseCommonInteractionProps = teammate([
  Permission.ReadIncidentMember,
  Permission.CreateIncidentMember,
  Permission.EditIncidentMember,
]);

const VIEWER: DatabaseCommonInteractionProps = teammate([Permission.Viewer]);

const PROJECT_MEMBER: DatabaseCommonInteractionProps = teammate([
  Permission.ProjectMember,
]);

const EPISODE_EDITOR: DatabaseCommonInteractionProps = teammate([
  Permission.ReadIncidentEpisodeRoleMember,
  Permission.EditIncidentEpisodeRoleMember,
]);

let server: DashboardRequestsOverHttp;
let members: InMemoryTable;
let episodeRoleMembers: InMemoryTable;
let episodeIncidents: InMemoryTable;
let caller: DatabaseCommonInteractionProps;
let feedItems: Array<{
  incidentId: string;
  markdown: string;
  data: JSONObject;
}>;
let invites: Array<{ incidentId: string | undefined; userIds: Array<string> }>;

const memberRow: (data: {
  id: string;
  incidentId?: string;
  userId: string;
  roleId: string;
}) => StoredRow = (data: {
  id: string;
  incidentId?: string;
  userId: string;
  roleId: string;
}): StoredRow => {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    incidentId: data.incidentId || INCIDENT_ID,
    userId: data.userId,
    incidentRoleId: data.roleId,
    isMemberNotified: true,
  };
};

const userRow: (id: unknown) => User | null = (id: unknown): User | null => {
  const person: { name: string; email: string } | undefined =
    PEOPLE[String(id).toLowerCase()];

  if (!person) {
    return null;
  }

  const user: User = new User();
  user._id = String(id);
  user.name = new Name(person.name);
  user.email = new Email(person.email);
  return user;
};

function answerOf(sent: SentRequest): JSONObject {
  return (sent.answer || {}) as JSONObject;
}

// What the server answered a refusal with, as the Dashboard reads it.
function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = answerOf(sent);
  return String(answer["error"] || answer["message"] || "");
}

const idOf: (value: unknown) => string = (value: unknown): string => {
  return String(value).toLowerCase();
};

// PUT /api/incident-member/:id, as any API caller sends it.
async function handOn(rowId: string, data: JSONObject): Promise<SentRequest> {
  return await server.request("PUT", `/api/incident-member/${rowId}`, {
    data: data,
  });
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<IncidentMember, DatabaseService<BaseModel>>(
      IncidentMember,
      IncidentMemberService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<IncidentEpisodeRoleMember, DatabaseService<BaseModel>>(
      IncidentEpisodeRoleMember,
      IncidentEpisodeRoleMemberService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  feedItems = [];
  invites = [];
  caller = EDITOR;

  // Every person named here is a member of the project.
  stubProjectDirectory({});
  everyServerProductIsOn();
  clearPrivateRecords();
  // A role row's create asks whether its person is in the project.
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));

  // The people, by id: for the names and links of the feed's entries.
  jest.spyOn(UserService, "findOneBy").mockImplementation((async (findBy: {
    query: { _id?: unknown };
  }) => {
    return userRow(findBy.query._id);
  }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (findBy: {
    id: unknown;
  }) => {
    return userRow(findBy.id);
  }) as never);

  jest
    .spyOn(IncidentRoleService, "findOneById")
    .mockImplementation((async (findBy: { id: unknown }) => {
      const role: IncidentRole = new IncidentRole();
      role.name = ROLES[idOf(findBy.id)] || "";
      return role;
    }) as never);

  jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 18,
    numberWithPrefix: "INC-18",
  });
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockImplementation((async (_projectId: ObjectID, incidentId: ObjectID) => {
      return URL.fromString(
        `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${incidentId.toString()}`,
      );
    }) as never);

  // The feed's entries, as the incident's feed and its channels get them.
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation((async (data: {
      incidentId: ObjectID;
      feedInfoInMarkdown: string;
    }) => {
      feedItems.push({
        incidentId: data.incidentId.toString(),
        markdown: data.feedInfoInMarkdown,
        data: data as unknown as JSONObject,
      });
      return new IncidentFeed();
    }) as never);

  // The channels a person given a role joins.
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteRolesIsTrue",
    )
    .mockResolvedValue([]);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockImplementation((async (data: {
      userIds: Array<ObjectID>;
      notificationFor: { incidentId?: ObjectID; incidentEpisodeId?: ObjectID };
    }) => {
      invites.push({
        incidentId: (
          data.notificationFor.incidentId ||
          data.notificationFor.incidentEpisodeId
        )?.toString(),
        userIds: data.userIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      });
    }) as never);
  jest
    .spyOn(IncidentService, "getWorkspaceChannelForIncident")
    .mockResolvedValue([]);
  jest
    .spyOn(IncidentEpisodeService, "getWorkspaceChannelForEpisode")
    .mockResolvedValue([]);

  members = useInMemoryTable(IncidentMemberService, [
    memberRow({
      id: COMMANDER_ROW_ID,
      userId: MAYA_ID,
      roleId: COMMANDER_ROLE_ID,
    }),
    memberRow({
      id: RESPONDER_ROW_ID,
      userId: SAM_ID,
      roleId: RESPONDER_ROLE_ID,
    }),
  ]);
  episodeRoleMembers = useInMemoryTable(IncidentEpisodeRoleMemberService, []);
  episodeIncidents = useInMemoryTable(IncidentEpisodeMemberService, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The commander's row as the table holds it now.
const commanderRow: () => StoredRow = (): StoredRow => {
  return members.get(COMMANDER_ROW_ID)!;
};

const expectCommanderUntouched: () => void = (): void => {
  expect(idOf(commanderRow()["userId"])).toBe(MAYA_ID);
  expect(idOf(commanderRow()["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
  expect(members.updates).toHaveLength(0);
  expect(members.deletes).toHaveLength(0);
  expect(members.inserts).toHaveLength(0);
  expect(feedItems).toHaveLength(0);
};

describe("PUT /api/incident-member/:id hands a role on in one change", () => {
  test("someone who may change role rows hands the commander's role on: the same row names the person picked", async () => {
    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBe(200);

    // One write of one row: never a delete and a create.
    expect(members.deletes).toHaveLength(0);
    expect(members.inserts).toHaveLength(0);
    expect(members.updates).toHaveLength(1);
    expect(idOf(members.updates[0]!.id)).toBe(COMMANDER_ROW_ID);

    const row: StoredRow = commanderRow();
    expect(idOf(row["userId"])).toBe(JORDAN_ID);
    // The row keeps its incident and its role.
    expect(idOf(row["incidentId"])).toBe(INCIDENT_ID);
    expect(idOf(row["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
    // Sam's row is not touched.
    expect(idOf(members.get(RESPONDER_ROW_ID)!["userId"])).toBe(SAM_ID);
  });

  test("the person it goes to is told, as anyone given a role is: the row is marked not told yet", async () => {
    await handOn(COMMANDER_ROW_ID, { userId: JORDAN_ID });

    expect(members.updates[0]!.set["isMemberNotified"]).toBe(false);
    expect(commanderRow()["isMemberNotified"]).toBe(false);
  });

  test("the feed says it in one entry, by whoever handed it on, from the person who held it to the one who holds it now", async () => {
    await handOn(COMMANDER_ROW_ID, { userId: JORDAN_ID });

    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!.incidentId).toBe(INCIDENT_ID);
    expect(feedItems[0]!.markdown).toBe(
      `👤 Reassigned **Incident Commander** on ${INCIDENT_LINK} from **${personLink(MAYA_ID)}** to **${personLink(JORDAN_ID)}**.`,
    );

    const data: JSONObject = feedItems[0]!.data;
    // Its author is the person who made the change, said in the channels too.
    expect(String(data["userId"]).toLowerCase()).toBe(ANA_ID);
    expect(data["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.IncidentMemberAdded,
    );
    expect(data["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
  });

  test("the person it goes to joins the incident's channels, as anyone given a role does", async () => {
    await handOn(COMMANDER_ROW_ID, { userId: JORDAN_ID });

    // The invites go out in the background.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(invites).toEqual([
      { incidentId: INCIDENT_ID, userIds: [JORDAN_ID] },
    ]);
  });

  test("the person it goes to taking it over themselves reads as taking it over", async () => {
    caller = teammate(
      [Permission.ReadIncidentMember, Permission.EditIncidentMember],
      JORDAN_ID,
    );

    await handOn(COMMANDER_ROW_ID, { userId: JORDAN_ID });

    expect(
      feedItems.map((item: { markdown: string }) => {
        return item.markdown;
      }),
    ).toEqual([
      `👤 Took over the **Incident Commander** role on ${INCIDENT_LINK} from **${personLink(MAYA_ID)}**.`,
    ]);
  });

  test("the person who held it handing it on themselves reads as handing it on", async () => {
    caller = teammate(
      [Permission.ReadIncidentMember, Permission.EditIncidentMember],
      MAYA_ID,
    );

    await handOn(COMMANDER_ROW_ID, { userId: JORDAN_ID });

    expect(
      feedItems.map((item: { markdown: string }) => {
        return item.markdown;
      }),
    ).toEqual([
      `👤 Handed the **Incident Commander** role on ${INCIDENT_LINK} to **${personLink(JORDAN_ID)}**.`,
    ]);
  });

  test("the person can be named by the relation as well as by the ID column", async () => {
    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      user: { _id: JORDAN_ID },
    });

    expect(sent.status).toBe(200);
    expect(idOf(commanderRow()["userId"])).toBe(JORDAN_ID);
    expect(feedItems).toHaveLength(1);
  });

  test("a project member hands it on: their role allows any change of the incident's roles", async () => {
    caller = PROJECT_MEMBER;

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBe(200);
    expect(idOf(commanderRow()["userId"])).toBe(JORDAN_ID);
  });
});

describe("who may hand a role on: the change of the row, never the delete (#10191)", () => {
  test("the customer's case: someone who may change roles but not take anybody off one hands the role on", async () => {
    caller = NO_DELETE;

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBe(200);
    expect(idOf(commanderRow()["userId"])).toBe(JORDAN_ID);
    expect(members.deletes).toHaveLength(0);
  });

  test("…and the delete Reassign used to send first is still refused to them, so it is never sent", async () => {
    caller = NO_DELETE;

    const sent: SentRequest = await server.request(
      "DELETE",
      `/api/incident-member/${COMMANDER_ROW_ID}`,
    );

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(refusalOf(sent)).toMatch(/permissions? to delete/i);
    expectCommanderUntouched();
  });

  test("someone who may give and take off roles but not change them is refused, and the role keeps its holder", async () => {
    caller = GIVER_AND_TAKER;

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(refusalOf(sent)).toMatch(/permission/i);
    expect(refusalOf(sent)).not.toMatch(/delete/i);
    expectCommanderUntouched();
  });

  test("a viewer is refused, and the role keeps its holder", async () => {
    caller = VIEWER;

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expectCommanderUntouched();
  });

  test("a team's block on Edit Incident Member refuses it, whatever the role around it allows", async () => {
    caller = {
      ...customDomainCaller({
        permissions: [Permission.ProjectMember],
        blocks: [Permission.EditIncidentMember],
        projectId: PROJECT_ID,
      }),
      userId: new ObjectID(ANA_ID),
      ...ON_HIGHEST_PLAN,
    };

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expectCommanderUntouched();
  });
});

describe("a private incident's roles are handed on by its owners only", () => {
  beforeEach(() => {
    setPrivateRecords({
      table: "Incident",
      records: [{ id: INCIDENT_ID, seenBy: [MAYA_ID] }],
    });
  });

  test("someone it is not owned by is refused, though their role may change roles, and the role keeps its holder", async () => {
    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expectCommanderUntouched();
  });

  test("its owner hands it on", async () => {
    caller = teammate(
      [Permission.ReadIncidentMember, Permission.EditIncidentMember],
      MAYA_ID,
    );

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBe(200);
    expect(idOf(commanderRow()["userId"])).toBe(JORDAN_ID);
  });
});

describe("what the server refuses of a hand-over", () => {
  test("someone who holds the role already is refused, in words that say so", async () => {
    // Jordan commands the incident too, by a row of his own.
    members.rows.push(
      memberRow({
        id: "10191000-0000-4000-8000-0000000000d3",
        userId: JORDAN_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
    );

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: JORDAN_ID,
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(ALREADY_HOLDS_INCIDENT_ROLE_MESSAGE);
    expectCommanderUntouched();
  });

  test("a role handed to nobody is refused: it is always held by someone", async () => {
    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: null,
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(ROLE_HOLDER_REQUIRED_MESSAGE);
    expectCommanderUntouched();
  });

  test("someone who is not a member of the project cannot be handed the role", async () => {
    stubProjectDirectory({ members: [MAYA_ID, JORDAN_ID, SAM_ID, ANA_ID] });

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: OUTSIDER_ID,
    });

    expect(sent.status).toBe(400);
    expectCommanderUntouched();
  });

  /*
   * REGRESSION: someone invited who has not joined passes the check every
   * update makes of a person - an invitation still waiting is a membership
   * - so a role could be handed to them, though giving them one is refused
   * (#10668). Nothing of the project reaches them until they join.
   */
  test("someone only invited, who has not joined the project, cannot be handed the role either, in the words giving one says", async () => {
    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockImplementation(
        async (data: { userId: ObjectID }): Promise<boolean> => {
          return idOf(data.userId) !== idOf(ANA_ID);
        },
      );

    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: ANA_ID,
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(NOT_A_PROJECT_MEMBER_ROLE_MESSAGE);
    expectCommanderUntouched();
    expect(feedItems).toEqual([]);
  });

  test("handing it back to the person who holds it changes nobody, and says nothing", async () => {
    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      userId: MAYA_ID,
    });

    expect(sent.status).toBe(200);
    expect(idOf(commanderRow()["userId"])).toBe(MAYA_ID);
    expect(commanderRow()["isMemberNotified"]).toBe(true);
    expect(feedItems).toHaveLength(0);
  });

  test("an update of several role rows at once is refused: a role goes from one person to one person", async () => {
    await expect(
      IncidentMemberService.updateBy({
        query: { incidentId: new ObjectID(INCIDENT_ID) },
        data: { userId: new ObjectID(JORDAN_ID) },
        limit: 10,
        skip: 0,
        props: EDITOR,
      }),
    ).rejects.toThrow(REASSIGN_ONE_ROLE_AT_A_TIME_MESSAGE);

    expectCommanderUntouched();
  });

  test("a change of a row's notes alone is no hand-over: nothing more is asked or said", async () => {
    const sent: SentRequest = await handOn(COMMANDER_ROW_ID, {
      notes: "Leading the database work.",
    });

    expect(sent.status).toBe(200);
    expect(idOf(commanderRow()["userId"])).toBe(MAYA_ID);
    expect(commanderRow()["isMemberNotified"]).toBe(true);
    expect(feedItems).toHaveLength(0);
  });
});

/*
 * A PERSON MOVED TO ANOTHER ROLE IN ONE CHANGE (#10274). An update of a
 * role row's role - through the API, Terraform or a workflow's Update step
 * (Edit Incident Member) - wrote nothing to the feed, told nobody, and
 * left the incident's channels as they were. It is now said as Reassign
 * says a hand-over: one entry by whoever made it, the person told of the
 * role they hold now and brought into the channels, and refused where it
 * would leave them holding a role twice.
 */
describe("PUT /api/incident-member/:id moves someone to another role in one change (#10274)", () => {
  const responderRow: () => StoredRow = (): StoredRow => {
    return members.get(RESPONDER_ROW_ID)!;
  };

  const MOVED_SAM: string = `👤 Moved **${personLink(SAM_ID)}** from **Responder** to **Incident Commander** on ${INCIDENT_LINK}.`;

  test("Sam is moved from Responder to Incident Commander: the same row names the role, and keeps its person", async () => {
    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    expect(sent.status).toBe(200);

    // One write of one row: never a delete and a create.
    expect(members.deletes).toHaveLength(0);
    expect(members.inserts).toHaveLength(0);
    expect(members.updates).toHaveLength(1);
    expect(idOf(members.updates[0]!.id)).toBe(RESPONDER_ROW_ID);

    expect(idOf(responderRow()["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
    expect(idOf(responderRow()["userId"])).toBe(SAM_ID);
    expect(idOf(responderRow()["incidentId"])).toBe(INCIDENT_ID);
    // Maya's row is not touched.
    expect(idOf(commanderRow()["userId"])).toBe(MAYA_ID);
    expect(idOf(commanderRow()["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
  });

  test("the feed says it in one entry, by whoever moved them, from the role they held to the one they hold now", async () => {
    await handOn(RESPONDER_ROW_ID, { incidentRoleId: COMMANDER_ROLE_ID });

    expect(
      feedItems.map((item: { markdown: string }): string => {
        return item.markdown;
      }),
    ).toEqual([MOVED_SAM]);
    expect(feedItems[0]!.incidentId).toBe(INCIDENT_ID);

    const data: JSONObject = feedItems[0]!.data;
    // Its author is the person who made the change, said in the channels too.
    expect(String(data["userId"]).toLowerCase()).toBe(ANA_ID);
    expect(data["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.IncidentMemberAdded,
    );
    expect(data["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
  });

  test("they are told of the role they hold now: the row is marked not told yet, for the job that tells them", async () => {
    await handOn(RESPONDER_ROW_ID, { incidentRoleId: COMMANDER_ROLE_ID });

    expect(members.updates[0]!.set["isMemberNotified"]).toBe(false);
    expect(responderRow()["isMemberNotified"]).toBe(false);
  });

  test("they join the incident's channels whose rules add the people given a role", async () => {
    await handOn(RESPONDER_ROW_ID, { incidentRoleId: COMMANDER_ROLE_ID });

    // The invites go out in the background.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(invites).toEqual([{ incidentId: INCIDENT_ID, userIds: [SAM_ID] }]);
  });

  test("somebody moving themselves reads as moving - never 'Sam moved Sam'", async () => {
    caller = teammate(
      [Permission.ReadIncidentMember, Permission.EditIncidentMember],
      SAM_ID,
    );

    await handOn(RESPONDER_ROW_ID, { incidentRoleId: COMMANDER_ROLE_ID });

    expect(
      feedItems.map((item: { markdown: string }): string => {
        return item.markdown;
      }),
    ).toEqual([
      `👤 Moved from **Responder** to **Incident Commander** on ${INCIDENT_LINK}.`,
    ]);
  });

  test("the role can be named by the relation as well as by the ID column", async () => {
    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRole: { _id: COMMANDER_ROLE_ID },
    });

    expect(sent.status).toBe(200);
    expect(idOf(responderRow()["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
    expect(feedItems).toHaveLength(1);
  });

  test("a project member may move them: their role allows any change of the incident's roles", async () => {
    caller = PROJECT_MEMBER;

    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    expect(sent.status).toBe(200);
    expect(idOf(responderRow()["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
  });

  test("moving them to the role they hold changes nobody, and says nothing", async () => {
    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRoleId: RESPONDER_ROLE_ID,
    });

    expect(sent.status).toBe(200);
    expect(idOf(responderRow()["incidentRoleId"])).toBe(RESPONDER_ROLE_ID);
    expect(responderRow()["isMemberNotified"]).toBe(true);
    expect(feedItems).toHaveLength(0);
    expect(invites).toHaveLength(0);
  });
});

describe("what the server refuses of a move (#10274)", () => {
  const expectResponderUntouched: () => void = (): void => {
    const row: StoredRow = members.get(RESPONDER_ROW_ID)!;
    expect(idOf(row["userId"])).toBe(SAM_ID);
    expect(idOf(row["incidentRoleId"])).toBe(RESPONDER_ROLE_ID);
    expect(members.updates).toHaveLength(0);
    expect(members.deletes).toHaveLength(0);
    expect(feedItems).toHaveLength(0);
  };

  test("a role they hold on the incident already is refused, in words that say what to do instead", async () => {
    // Sam commands the incident too, by a row of his own.
    members.rows.push(
      memberRow({
        id: "10191000-0000-4000-8000-0000000000d4",
        userId: SAM_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
    );

    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(ALREADY_HOLDS_TARGET_ROLE_MESSAGE);
    expectResponderUntouched();
  });

  test("a role cleared is refused: a person on an incident always holds one", async () => {
    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRoleId: null,
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(ROLE_REQUIRED_MESSAGE);
    expectResponderUntouched();
  });

  test("a move of several role rows at once is refused: one person moves at a time", async () => {
    await expect(
      IncidentMemberService.updateBy({
        query: { incidentId: new ObjectID(INCIDENT_ID) },
        data: { incidentRoleId: new ObjectID(RESPONDER_ROLE_ID) },
        limit: 10,
        skip: 0,
        props: EDITOR,
      }),
    ).rejects.toThrow(MOVE_ONE_ROLE_AT_A_TIME_MESSAGE);

    expectResponderUntouched();
    expect(idOf(commanderRow()["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
  });

  test("someone who may give and take off roles but not change them is refused", async () => {
    caller = GIVER_AND_TAKER;

    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expectResponderUntouched();
  });

  test("a private incident's roles are moved by its owners only", async () => {
    setPrivateRecords({
      table: "Incident",
      records: [{ id: INCIDENT_ID, seenBy: [MAYA_ID] }],
    });

    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expectResponderUntouched();
  });
});

describe("a person and a role changed in one update (#10274)", () => {
  test("the person who held the old role is taken off it and the one named given the new role, as two entries say it", async () => {
    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      userId: JORDAN_ID,
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    expect(sent.status).toBe(200);

    const row: StoredRow = members.get(RESPONDER_ROW_ID)!;
    expect(idOf(row["userId"])).toBe(JORDAN_ID);
    expect(idOf(row["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
    expect(row["isMemberNotified"]).toBe(false);

    expect(
      feedItems.map((item: { markdown: string }): string => {
        return item.markdown;
      }),
    ).toEqual([
      `👤 Removed **${personLink(SAM_ID)}** as **Responder** from ${INCIDENT_LINK}.`,
      `👤 Added **${personLink(JORDAN_ID)}** as **Incident Commander** to ${INCIDENT_LINK}.`,
    ]);

    expect(feedItems[0]!.data["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.IncidentMemberRemoved,
    );
    expect(feedItems[1]!.data["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.IncidentMemberAdded,
    );

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(invites).toEqual([
      { incidentId: INCIDENT_ID, userIds: [JORDAN_ID] },
    ]);
  });

  test("refused when the person named holds the new role already", async () => {
    members.rows.push(
      memberRow({
        id: "10191000-0000-4000-8000-0000000000d5",
        userId: JORDAN_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
    );

    const sent: SentRequest = await handOn(RESPONDER_ROW_ID, {
      userId: JORDAN_ID,
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(ALREADY_HOLDS_INCIDENT_ROLE_MESSAGE);
    expect(idOf(members.get(RESPONDER_ROW_ID)!["userId"])).toBe(SAM_ID);
    expect(feedItems).toHaveLength(0);
  });
});

describe("the Dashboard's own Reassign (reassignIncidentRole)", () => {
  test("sends one PUT of the role's row - no DELETE, no POST - and the server hands the role on", async () => {
    await reassignIncidentRole({
      memberId: new ObjectID(COMMANDER_ROW_ID),
      userId: new ObjectID(JORDAN_ID),
    });

    expect(
      server.requests.map((request: SentRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([`PUT /api/incident-member/${COMMANDER_ROW_ID}`]);

    const sent: SentRequest = server.requests[0]!;
    expect(sent.status).toBe(200);

    // What went over the wire: the person, as the JSON of an ObjectID.
    expect((sent.body as JSONObject)["data"]).toEqual({
      userId: { _type: "ObjectID", value: JORDAN_ID },
    });

    expect(idOf(commanderRow()["userId"])).toBe(JORDAN_ID);
    expect(feedItems).toHaveLength(1);
  });

  test("rejects with the server's own words when it is refused, and nothing changes", async () => {
    caller = GIVER_AND_TAKER;

    let refusal: unknown = null;

    try {
      await reassignIncidentRole({
        memberId: new ObjectID(COMMANDER_ROW_ID),
        userId: new ObjectID(JORDAN_ID),
      });
    } catch (err) {
      refusal = err;
    }

    expect(refusal).not.toBeNull();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.method).toBe("PUT");
    expectCommanderUntouched();
  });
});

describe("PUT /api/incident-episode-role-member/:id hands an episode's role on, and its incidents follow", () => {
  const EPISODE_COMMANDER_ROW_ID: string =
    "10191000-0000-4000-8000-0000000000f1";

  // Rows the episode gave its incidents, as propagateRoleToIncidentsInEpisode writes them.
  const MAYA_ON_INCIDENT: string = "10191000-0000-4000-8000-0000000000f2";
  const MAYA_ON_OTHER: string = "10191000-0000-4000-8000-0000000000f3";
  const JORDAN_ON_OTHER: string = "10191000-0000-4000-8000-0000000000f4";

  beforeEach(() => {
    caller = EPISODE_EDITOR;

    episodeRoleMembers.rows.push({
      _id: EPISODE_COMMANDER_ROW_ID,
      projectId: PROJECT_ID.toString(),
      incidentEpisodeId: EPISODE_ID,
      userId: MAYA_ID,
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    // Three incidents in the episode.
    for (const incidentId of [
      INCIDENT_ID,
      OTHER_INCIDENT_ID,
      THIRD_INCIDENT_ID,
    ]) {
      episodeIncidents.rows.push({
        _id: `10191000-0000-4000-8000-${incidentId.slice(-12, -2)}ee`,
        projectId: PROJECT_ID.toString(),
        incidentEpisodeId: EPISODE_ID,
        incidentId: incidentId,
      });
    }

    /*
     * The first incident: Maya commands it from the episode. The second:
     * Maya and Jordan both do (Jordan was given it by hand). The third:
     * nobody does from the episode.
     */
    members.rows.length = 0;
    members.rows.push(
      memberRow({
        id: MAYA_ON_INCIDENT,
        incidentId: INCIDENT_ID,
        userId: MAYA_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
      memberRow({
        id: MAYA_ON_OTHER,
        incidentId: OTHER_INCIDENT_ID,
        userId: MAYA_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
      memberRow({
        id: JORDAN_ON_OTHER,
        incidentId: OTHER_INCIDENT_ID,
        userId: JORDAN_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
    );
  });

  test("the episode's row names the person picked, in one change", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { userId: JORDAN_ID } },
    );

    expect(sent.status).toBe(200);
    expect(episodeRoleMembers.deletes).toHaveLength(0);
    expect(episodeRoleMembers.inserts).toHaveLength(0);
    expect(
      idOf(episodeRoleMembers.get(EPISODE_COMMANDER_ROW_ID)!["userId"]),
    ).toBe(JORDAN_ID);
  });

  test("each incident follows: Maya's row names Jordan, goes where Jordan holds it already, and Jordan is given it where nobody held it", async () => {
    await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { userId: JORDAN_ID } },
    );

    // The first incident: the same row, handed on.
    expect(idOf(members.get(MAYA_ON_INCIDENT)!["userId"])).toBe(JORDAN_ID);
    expect(members.get(MAYA_ON_INCIDENT)!["isMemberNotified"]).toBe(false);

    // The second: Jordan held it already, so only Maya's row goes.
    expect(members.get(MAYA_ON_OTHER)).toBeUndefined();
    expect(idOf(members.get(JORDAN_ON_OTHER)!["userId"])).toBe(JORDAN_ID);

    // The third: Jordan is given it, as the episode gives its roles.
    const third: Array<StoredRow> = members.rows.filter(
      (row: StoredRow): boolean => {
        return idOf(row["incidentId"]) === THIRD_INCIDENT_ID;
      },
    );
    expect(third).toHaveLength(1);
    expect(idOf(third[0]!["userId"])).toBe(JORDAN_ID);
    expect(idOf(third[0]!["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);

    // Each incident's feed says what happened there, by who did it.
    const byIncident: Record<string, Array<string>> = {};
    for (const item of feedItems) {
      byIncident[item.incidentId] = [
        ...(byIncident[item.incidentId] || []),
        item.markdown,
      ];
    }

    expect(byIncident[INCIDENT_ID]).toEqual([
      expect.stringMatching(
        /^👤 Reassigned \*\*Incident Commander\*\* on .* from \*\*\[Maya Chen\].* to \*\*\[Jordan Patel\]/,
      ),
    ]);
    expect(byIncident[OTHER_INCIDENT_ID]).toEqual([
      expect.stringMatching(
        /^👤 Removed \*\*\[Maya Chen\].* as \*\*Incident Commander\*\*/,
      ),
    ]);
    expect(byIncident[THIRD_INCIDENT_ID]).toEqual([
      expect.stringMatching(
        /^👤 Added \*\*\[Jordan Patel\].* as \*\*Incident Commander\*\*/,
      ),
    ]);

    for (const item of feedItems) {
      expect(String(item.data["userId"]).toLowerCase()).toBe(ANA_ID);
    }
  });

  test("the Dashboard's own Reassign sends one PUT of the episode's row", async () => {
    await reassignIncidentEpisodeRole({
      memberId: new ObjectID(EPISODE_COMMANDER_ROW_ID),
      userId: new ObjectID(JORDAN_ID),
    });

    expect(
      server.requests.map((request: SentRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([
      `PUT /api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
    ]);
    expect(server.requests[0]!.status).toBe(200);
  });

  test("someone who holds the episode's role already is refused, and no incident changes", async () => {
    episodeRoleMembers.rows.push({
      _id: "10191000-0000-4000-8000-0000000000f5",
      projectId: PROJECT_ID.toString(),
      incidentEpisodeId: EPISODE_ID,
      userId: JORDAN_ID,
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    const sent: SentRequest = await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { userId: JORDAN_ID } },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(ALREADY_HOLDS_EPISODE_ROLE_MESSAGE);
    expect(members.updates).toHaveLength(0);
    expect(members.deletes).toHaveLength(0);
    expect(members.inserts).toHaveLength(0);
    expect(feedItems).toHaveLength(0);
  });

  test("someone who may give and take off the episode's roles but not change them is refused", async () => {
    caller = teammate([
      Permission.ReadIncidentEpisodeRoleMember,
      Permission.CreateIncidentEpisodeRoleMember,
      Permission.DeleteIncidentEpisodeRoleMember,
    ]);

    const sent: SentRequest = await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { userId: JORDAN_ID } },
    );

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(
      idOf(episodeRoleMembers.get(EPISODE_COMMANDER_ROW_ID)!["userId"]),
    ).toBe(MAYA_ID);
    expect(members.updates).toHaveLength(0);
    expect(feedItems).toHaveLength(0);
  });
});

/*
 * AN EPISODE'S ROW MOVED TO ANOTHER ROLE (#10274): the episode's incidents
 * follow, as they follow a hand-over - each incident's row the episode gave
 * moves with it, said in that incident's feed by whoever moved the
 * episode's row.
 */
describe("PUT /api/incident-episode-role-member/:id moves someone to another role, and its incidents follow (#10274)", () => {
  const EPISODE_COMMANDER_ROW_ID: string =
    "10191000-0000-4000-8000-0000000000f1";

  const MAYA_ON_INCIDENT: string = "10191000-0000-4000-8000-0000000000f2";
  const MAYA_ON_OTHER: string = "10191000-0000-4000-8000-0000000000f3";
  const MAYA_RESPONDS_ON_OTHER: string = "10191000-0000-4000-8000-0000000000f6";

  beforeEach(() => {
    caller = EPISODE_EDITOR;

    episodeRoleMembers.rows.push({
      _id: EPISODE_COMMANDER_ROW_ID,
      projectId: PROJECT_ID.toString(),
      incidentEpisodeId: EPISODE_ID,
      userId: MAYA_ID,
      incidentRoleId: COMMANDER_ROLE_ID,
    });

    for (const incidentId of [
      INCIDENT_ID,
      OTHER_INCIDENT_ID,
      THIRD_INCIDENT_ID,
    ]) {
      episodeIncidents.rows.push({
        _id: `10191000-0000-4000-8000-${incidentId.slice(-12, -2)}ee`,
        projectId: PROJECT_ID.toString(),
        incidentEpisodeId: EPISODE_ID,
        incidentId: incidentId,
      });
    }

    /*
     * The first incident: Maya commands it from the episode. The second:
     * she commands it and responds to it already. The third: nobody does
     * from the episode.
     */
    members.rows.length = 0;
    members.rows.push(
      memberRow({
        id: MAYA_ON_INCIDENT,
        incidentId: INCIDENT_ID,
        userId: MAYA_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
      memberRow({
        id: MAYA_ON_OTHER,
        incidentId: OTHER_INCIDENT_ID,
        userId: MAYA_ID,
        roleId: COMMANDER_ROLE_ID,
      }),
      memberRow({
        id: MAYA_RESPONDS_ON_OTHER,
        incidentId: OTHER_INCIDENT_ID,
        userId: MAYA_ID,
        roleId: RESPONDER_ROLE_ID,
      }),
    );
  });

  test("the episode's row names the new role, in one change, and keeps its person", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { incidentRoleId: RESPONDER_ROLE_ID } },
    );

    expect(sent.status).toBe(200);
    expect(episodeRoleMembers.deletes).toHaveLength(0);
    expect(episodeRoleMembers.inserts).toHaveLength(0);

    const row: StoredRow = episodeRoleMembers.get(EPISODE_COMMANDER_ROW_ID)!;
    expect(idOf(row["incidentRoleId"])).toBe(RESPONDER_ROLE_ID);
    expect(idOf(row["userId"])).toBe(MAYA_ID);
  });

  test("each incident follows: Maya's row moves with it, goes where she holds the role already, and she is given it where nobody held it", async () => {
    await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { incidentRoleId: RESPONDER_ROLE_ID } },
    );

    // The first incident: the same row, moved, and Maya told of it.
    expect(idOf(members.get(MAYA_ON_INCIDENT)!["incidentRoleId"])).toBe(
      RESPONDER_ROLE_ID,
    );
    expect(idOf(members.get(MAYA_ON_INCIDENT)!["userId"])).toBe(MAYA_ID);
    expect(members.get(MAYA_ON_INCIDENT)!["isMemberNotified"]).toBe(false);

    // The second: she responds already, so only her commander's row goes.
    expect(members.get(MAYA_ON_OTHER)).toBeUndefined();
    expect(idOf(members.get(MAYA_RESPONDS_ON_OTHER)!["incidentRoleId"])).toBe(
      RESPONDER_ROLE_ID,
    );

    // The third: she is given it, as the episode gives its roles.
    const third: Array<StoredRow> = members.rows.filter(
      (row: StoredRow): boolean => {
        return idOf(row["incidentId"]) === THIRD_INCIDENT_ID;
      },
    );
    expect(third).toHaveLength(1);
    expect(idOf(third[0]!["userId"])).toBe(MAYA_ID);
    expect(idOf(third[0]!["incidentRoleId"])).toBe(RESPONDER_ROLE_ID);

    // Each incident's feed says what happened there, by who did it.
    const byIncident: Record<string, Array<string>> = {};
    for (const item of feedItems) {
      byIncident[item.incidentId] = [
        ...(byIncident[item.incidentId] || []),
        item.markdown,
      ];
    }

    expect(byIncident[INCIDENT_ID]).toEqual([
      expect.stringMatching(
        /^👤 Moved \*\*\[Maya Chen\].* from \*\*Incident Commander\*\* to \*\*Responder\*\* on /,
      ),
    ]);
    expect(byIncident[OTHER_INCIDENT_ID]).toEqual([
      expect.stringMatching(
        /^👤 Removed \*\*\[Maya Chen\].* as \*\*Incident Commander\*\*/,
      ),
    ]);
    expect(byIncident[THIRD_INCIDENT_ID]).toEqual([
      expect.stringMatching(
        /^👤 Added \*\*\[Maya Chen\].* as \*\*Responder\*\*/,
      ),
    ]);

    for (const item of feedItems) {
      expect(String(item.data["userId"]).toLowerCase()).toBe(ANA_ID);
    }
  });

  test("a role she holds on the episode already is refused, and no incident changes", async () => {
    episodeRoleMembers.rows.push({
      _id: "10191000-0000-4000-8000-0000000000f7",
      projectId: PROJECT_ID.toString(),
      incidentEpisodeId: EPISODE_ID,
      userId: MAYA_ID,
      incidentRoleId: RESPONDER_ROLE_ID,
    });

    const sent: SentRequest = await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { incidentRoleId: RESPONDER_ROLE_ID } },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(ALREADY_HOLDS_TARGET_EPISODE_ROLE_MESSAGE);
    expect(
      idOf(episodeRoleMembers.get(EPISODE_COMMANDER_ROW_ID)!["incidentRoleId"]),
    ).toBe(COMMANDER_ROLE_ID);
    expect(members.updates).toHaveLength(0);
    expect(members.deletes).toHaveLength(0);
    expect(members.inserts).toHaveLength(0);
    expect(feedItems).toHaveLength(0);
  });

  test("a person and a role changed at once on the episode: each incident's row follows both", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/incident-episode-role-member/${EPISODE_COMMANDER_ROW_ID}`,
      { data: { userId: JORDAN_ID, incidentRoleId: RESPONDER_ROLE_ID } },
    );

    expect(sent.status).toBe(200);

    // The first incident: Maya's commander row now names Jordan as Responder.
    expect(idOf(members.get(MAYA_ON_INCIDENT)!["userId"])).toBe(JORDAN_ID);
    expect(idOf(members.get(MAYA_ON_INCIDENT)!["incidentRoleId"])).toBe(
      RESPONDER_ROLE_ID,
    );

    const byIncident: Record<string, Array<string>> = {};
    for (const item of feedItems) {
      byIncident[item.incidentId] = [
        ...(byIncident[item.incidentId] || []),
        item.markdown,
      ];
    }

    expect(byIncident[INCIDENT_ID]).toEqual([
      expect.stringMatching(
        /^👤 Removed \*\*\[Maya Chen\].* as \*\*Incident Commander\*\*/,
      ),
      expect.stringMatching(
        /^👤 Added \*\*\[Jordan Patel\].* as \*\*Responder\*\*/,
      ),
    ]);
  });
});
