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
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * THE INCIDENT ROLES CARD'S REASSIGN, ANSWERED BY THE SERVER ITSELF (#10191).
 *
 * A customer opened Reassign Role on an incident's commander, picked
 * someone, and read "You do not have permission to delete this Incident
 * member" as raw text over the page behind the dialog: Reassign was a
 * DELETE of the holder's row and then a POST of a new one, the DELETE was
 * refused, and the card wrote the refusal to its own error line, behind the
 * dialog, which said nothing.
 *
 * Here the real card (IncidentMemberRoleAssignment) runs against the
 * server's own incident member routes - Express, BaseAPI, the permission
 * layer and IncidentMemberService's hooks - over HTTP
 * (DashboardRequestsOverHttp), into a table held in memory. The card's
 * reads (the project's roles, the incident's members with their people,
 * the project's people) are answered from that same table; every write it
 * makes goes to the server as the browser sends it. For each reader:
 *
 *   - Reassign is one PUT of the holder's row, and the card names the
 *     person picked once the server has handed the role on;
 *   - a reader who may change roles but not take anybody off one - the
 *     customer's case - is offered Reassign, and it works;
 *   - a reader who may not change roles finds Reassign locked, saying why,
 *     and nothing is sent;
 *   - what the server refuses that the page could not know is said in the
 *     dialog, which stays open, and never behind it.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

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

import IncidentMemberRoleAssignment from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentMemberRoleAssignment";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import IncidentService from "../../../Server/Services/IncidentService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentFeed from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "../../../Types/Color";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import {
  clearPrivateRecords,
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../Server/TestingUtils/ServerProductsOn";

const PROJECT_ID: string = "10191000-0000-4000-8000-000000000101";
const INCIDENT_ID: string = "10191000-0000-4000-8000-0000000001a1";

const COMMANDER_ROLE_ID: string = "10191000-0000-4000-8000-0000000001c1";
const RESPONDER_ROLE_ID: string = "10191000-0000-4000-8000-0000000001c2";

const MAYA_ID: string = "10191000-0000-4000-8000-0000000001b1";
const JORDAN_ID: string = "10191000-0000-4000-8000-0000000001b2";
const SAM_ID: string = "10191000-0000-4000-8000-0000000001b3";
const ANA_ID: string = "10191000-0000-4000-8000-0000000001b4";

const COMMANDER_ROW_ID: string = "10191000-0000-4000-8000-0000000001d1";
const RESPONDER_ROW_ID: string = "10191000-0000-4000-8000-0000000001d2";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [MAYA_ID]: { name: "Maya Chen", email: "maya.chen@acme-commerce.example" },
  [JORDAN_ID]: {
    name: "Jordan Patel",
    email: "jordan.patel@acme-commerce.example",
  },
  [SAM_ID]: { name: "Sam Rivera", email: "sam.rivera@acme-commerce.example" },
};

const ROLES: Array<{
  id: string;
  name: string;
  isPrimaryRole: boolean;
}> = [
  { id: COMMANDER_ROLE_ID, name: "Incident Commander", isPrimaryRole: true },
  { id: RESPONDER_ROLE_ID, name: "Responder", isPrimaryRole: false },
];

const REASSIGN_NAME: string = "Reassign Incident Commander from Maya Chen";

// Each test renders the card and sends its requests through the server.
const WAIT: { timeout: number } = { timeout: 10000 };

/*
 * What a reader holds, on both sides: the page's snapshot and the server's
 * props. A role row is read through its incident, so whoever works an
 * incident's roles reads incidents too.
 */
const READS: Array<Permission> = [
  Permission.ReadProjectIncident,
  Permission.ReadIncidentMember,
];

const MAY_CHANGE_ROLES: Array<Permission> = [
  ...READS,
  Permission.CreateIncidentMember,
  Permission.DeleteIncidentMember,
  Permission.EditIncidentMember,
];

// The customer's case: may change roles, may not take anybody off one.
const MAY_NOT_TAKE_ANYBODY_OFF: Array<Permission> = [
  ...READS,
  Permission.CreateIncidentMember,
  Permission.EditIncidentMember,
];

// May give roles and take them off, and nothing more.
const MAY_ONLY_GIVE_AND_TAKE_OFF: Array<Permission> = [
  ...READS,
  Permission.CreateIncidentMember,
  Permission.DeleteIncidentMember,
];

let server: DashboardRequestsOverHttp;
let members: InMemoryTable;
let caller: DatabaseCommonInteractionProps;
let feedItems: Array<string>;

const serverCaller: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: new ObjectID(PROJECT_ID),
    }),
    userId: new ObjectID(ANA_ID),
    ...ON_HIGHEST_PLAN,
  };
};

// The reader, on the page and at the server.
const signInAs: (permissions: Array<Permission>) => void = (
  permissions: Array<Permission>,
): void => {
  caller = serverCaller(permissions);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
};

const userOf: (id: string) => User = (id: string): User => {
  const user: User = new User();
  user._id = id;
  user.name = new Name(PEOPLE[id]!.name);
  user.email = new Email(PEOPLE[id]!.email);
  return user;
};

const roleOf: (id: string) => IncidentRole = (id: string): IncidentRole => {
  const found: { id: string; name: string; isPrimaryRole: boolean } =
    ROLES.find((role: { id: string }): boolean => {
      return role.id === id;
    })!;
  const role: IncidentRole = new IncidentRole();
  role._id = found.id;
  role.name = found.name;
  role.isPrimaryRole = found.isPrimaryRole;
  role.color = new Color("#6366f1");
  role.canAssignMultipleUsers = false;
  role.isArchived = false;
  return role;
};

const idOf: (value: unknown) => string = (value: unknown): string => {
  return String(value).toLowerCase();
};

/*
 * The card's reads, answered from what the server's table holds now: the
 * project's roles, the incident's members with their people and roles (a
 * join the in-memory table does not make), and the project's people.
 */
const answerReads: () => void = (): void => {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (request: {
    modelType: { new (): BaseModel };
  }): Promise<ListResult<BaseModel>> => {
    let data: Array<BaseModel> = [];

    if (request.modelType === IncidentRole) {
      data = ROLES.map((role: { id: string }): IncidentRole => {
        return roleOf(role.id);
      });
    }

    if (request.modelType === IncidentMember) {
      data = members.rows.map((row: StoredRow): IncidentMember => {
        const member: IncidentMember = new IncidentMember();
        member._id = String(row["_id"]);
        member.userId = new ObjectID(String(row["userId"]));
        member.incidentRoleId = new ObjectID(String(row["incidentRoleId"]));
        member.user = userOf(idOf(row["userId"]));
        member.incidentRole = roleOf(idOf(row["incidentRoleId"]));
        return member;
      });
    }

    if (request.modelType === TeamMember) {
      data = Object.keys(PEOPLE).map((id: string): TeamMember => {
        const teamMember: TeamMember = new TeamMember();
        teamMember.user = userOf(id);
        return teamMember;
      });
    }

    return { data: data, count: data.length, skip: 0, limit: 100 };
  }) as never);
};

// The server's hooks around a role row: the feed, names, links, channels.
const stubServerSurroundings: () => void = (): void => {
  stubProjectDirectory({});
  everyServerProductIsOn();
  clearPrivateRecords();

  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));
  jest.spyOn(UserService, "findOneBy").mockImplementation((async (findBy: {
    query: { _id?: unknown };
  }) => {
    const id: string = idOf(findBy.query._id);
    return PEOPLE[id] ? userOf(id) : null;
  }) as never);
  jest
    .spyOn(IncidentRoleService, "findOneById")
    .mockImplementation((async (findBy: { id: unknown }) => {
      return roleOf(idOf(findBy.id));
    }) as never);
  jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 18,
    numberWithPrefix: "INC-18",
  });
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.example/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`,
      ),
    );
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
      feedItems.push(data.feedInfoInMarkdown);
      return new IncidentFeed();
    }) as never);
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
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "getWorkspaceChannelForIncident")
    .mockResolvedValue([]);
};

// The writes the card sent, as "METHOD /path".
const writesSent: () => Array<string> = (): Array<string> => {
  return server.requests
    .filter((request: SentRequest): boolean => {
      return request.method !== "GET";
    })
    .map((request: SentRequest): string => {
      return `${request.method} ${request.path.split("?")[0]}`;
    });
};

const renderCard: () => Promise<void> = async (): Promise<void> => {
  render(
    <IncidentMemberRoleAssignment incidentId={new ObjectID(INCIDENT_ID)} />,
  );

  await screen.findByText("Maya Chen", { selector: "p" }, WAIT);
};

const dialog: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("dialog");
};

// Opens Reassign, picks `name`, and presses the dialog's Reassign.
const reassignTo: (name: string) => Promise<void> = async (
  name: string,
): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: REASSIGN_NAME }));

  fireEvent.keyDown(within(dialog()).getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  const option: HTMLElement = screen
    .getAllByTestId("dropdown-option-label")
    .find((label: HTMLElement): boolean => {
      return label.textContent === name;
    })!;

  fireEvent.click(option);

  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Reassign" }));
  });
};

// Who the card names in a role, by the role's name.
const holdersOf: (roleName: string) => Array<string> = (
  roleName: string,
): Array<string> => {
  const header: HTMLElement = screen
    .getByText(roleName, { selector: "span" })
    .closest("[data-testid='member-role-header']") as HTMLElement;
  const section: HTMLElement = header.parentElement as HTMLElement;

  return within(section)
    .queryAllByTestId("member-role-member-name")
    .map((name: HTMLElement): string => {
      return name.textContent || "";
    });
};

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<IncidentMember, DatabaseService<BaseModel>>(
      IncidentMember,
      IncidentMemberService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  feedItems = [];
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);

  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  stubServerSurroundings();

  members = useInMemoryTable(IncidentMemberService, [
    {
      _id: COMMANDER_ROW_ID,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      userId: MAYA_ID,
      incidentRoleId: COMMANDER_ROLE_ID,
      isMemberNotified: true,
    },
    {
      _id: RESPONDER_ROW_ID,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      userId: SAM_ID,
      incidentRoleId: RESPONDER_ROLE_ID,
      isMemberNotified: true,
    },
  ]);

  answerReads();
  signInAs(MAY_CHANGE_ROLES);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the incident roles card's Reassign, through the server", () => {
  test("hands the commander's role on with one PUT - no DELETE, no POST - and the card names the person picked", async () => {
    await renderCard();

    await reassignTo("Jordan Patel");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);

    expect(writesSent()).toEqual([
      `PUT /api/incident-member/${COMMANDER_ROW_ID}`,
    ]);
    expect(
      server.requests.find((request: SentRequest) => {
        return request.method === "PUT";
      })!.status,
    ).toBe(200);

    // The same row names Jordan; nobody else's changed.
    expect(idOf(members.get(COMMANDER_ROW_ID)!["userId"])).toBe(JORDAN_ID);
    expect(idOf(members.get(RESPONDER_ROW_ID)!["userId"])).toBe(SAM_ID);

    await waitFor(() => {
      expect(holdersOf("Incident Commander")).toEqual(["Jordan Patel"]);
    }, WAIT);
    expect(holdersOf("Responder")).toEqual(["Sam Rivera"]);

    // One entry in the feed, never "Removed Maya" and "Added Jordan".
    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]).toMatch(/^👤 Reassigned \*\*Incident Commander\*\*/);
  });

  test("the customer's case: someone who may change roles but not take anybody off one is offered Reassign, and it works", async () => {
    signInAs(MAY_NOT_TAKE_ANYBODY_OFF);

    await renderCard();

    // Remove is theirs to see locked; Reassign is not.
    expect(screen.queryByTestId("member-role-reassign-locked")).toBeNull();
    expect(screen.getByTestId("member-role-remove-locked")).toBeVisible();

    await reassignTo("Jordan Patel");

    await waitFor(() => {
      expect(holdersOf("Incident Commander")).toEqual(["Jordan Patel"]);
    }, WAIT);

    expect(writesSent()).toEqual([
      `PUT /api/incident-member/${COMMANDER_ROW_ID}`,
    ]);
    // Nothing about deleting, anywhere on the page.
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  test("someone who may not change roles finds Reassign locked, saying why, before anything is sent", async () => {
    signInAs(MAY_ONLY_GIVE_AND_TAKE_OFF);

    await renderCard();

    const locked: HTMLElement = screen.getByTestId(
      "member-role-reassign-locked",
    );

    expect(locked).toHaveAttribute(
      "aria-label",
      "You do not have permission to change this incident's roles. You need this permission: Edit Incident Member.",
    );
    expect(
      within(locked).getByRole("button", { name: REASSIGN_NAME }),
    ).toBeDisabled();

    fireEvent.click(
      within(locked).getByRole("button", { name: REASSIGN_NAME }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writesSent()).toEqual([]);
  });

  test("what the server refuses that the page could not know is said in the dialog, which stays open - never behind it", async () => {
    /*
     * The page's snapshot allows it; the server weighs this very incident
     * - its labels, its owners, a team's block - and refuses.
     */
    await renderCard();
    caller = serverCaller(MAY_ONLY_GIVE_AND_TAKE_OFF);

    await reassignTo("Jordan Patel");

    const alert: HTMLElement = await within(dialog()).findByText(
      /permission/i,
      {},
      WAIT,
    );

    expect(alert).toBeVisible();
    expect(dialog()).toContainElement(alert);

    // The card behind the dialog says nothing of it (#10191).
    const card: HTMLElement = screen
      .getByText("Incident Roles")
      .closest("[data-testid='card']") as HTMLElement;
    expect(within(card).queryByText(/permission/i)).toBeNull();

    // The role keeps its holder, and nothing was deleted.
    expect(writesSent()).toEqual([
      `PUT /api/incident-member/${COMMANDER_ROW_ID}`,
    ]);
    expect(idOf(members.get(COMMANDER_ROW_ID)!["userId"])).toBe(MAYA_ID);
    expect(members.deletes).toHaveLength(0);
    expect(holdersOf("Incident Commander")).toEqual(["Maya Chen"]);

    // Closed, it leaves nothing behind.
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/permission/i)).toBeNull();
  });

  test("before the reader's permissions are read, Reassign is left out rather than locked or offered", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    await renderCard();

    expect(screen.queryByRole("button", { name: REASSIGN_NAME })).toBeNull();
    expect(screen.queryByTestId("member-role-reassign-locked")).toBeNull();
    expect(screen.getByText("Maya Chen", { selector: "p" })).toBeVisible();
  });
});
