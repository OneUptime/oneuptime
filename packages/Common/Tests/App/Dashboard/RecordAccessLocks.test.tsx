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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

/*
 * WHAT AN INCIDENT'S PAGE OFFERS, BY WHAT THE SERVER SAYS OF THAT INCIDENT
 * (#10272).
 *
 * #10191's customer was offered Reassign on an incident their Edit Incident
 * Member did not reach - it was limited to the incidents labelled Payments -
 * and refused when they pressed it. The page now asks the server once, as
 * it opens, what the reader may do on the incident
 * (RecordAccessScopeProvider, GET /incident/record-access/:id), and the
 * Incident Roles card and the header's commander lock what it refuses,
 * saying why.
 *
 * Here the real card and the header's commander, drawn the way the
 * incident page draws it (useIncidentRoleGates, getCommanderFact), are
 * rendered under the real provider, whose request goes over HTTP
 * (DashboardRequestsOverHttp) to the server's own route
 * (RecordAccessRoute): its path, its JSON and its no-cache headers, with
 * the session guards passed as a signed-in member passes them. What the
 * route answers is the builder's, handed in per test:
 * the builder's own answers for these readers - limited to labels, to
 * owned incidents, blocked on a label, a private incident's owners - are
 * worked out against the database in RecordAccessPostgres, and with the
 * tables in memory, for the readers memory can answer, in
 * RecordAccessOverHttp.
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

jest.mock("isolated-vm", () => {
  return {};
});

import IncidentMemberRoleAssignment from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentMemberRoleAssignment";
import { getCommanderFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventPeopleFacts";
import { RECORD_ACCESS_API_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Components/RecordAccess/RecordAccessApi";
import RecordAccessScopeProvider from "../../../../App/FeatureSet/Dashboard/src/Components/RecordAccess/RecordAccessScopeProvider";
import {
  EventRoleGates,
  useIncidentRoleGates,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventRoleGates";
import { EventStatusFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import { PrimaryRoleHolding } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventPeople";
import CommonAPI from "../../../Server/API/CommonAPI";
import RecordAccessRoute from "../../../Server/API/RecordAccessRoute";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import RecordAccessBuilder from "../../../Server/Utils/RecordAccess/RecordAccessBuilder";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "../../../Types/Color";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import RecordAccess, {
  RecordAccessKind,
  RecordAccessRefusalReason,
  RecordAccessResult,
  RecordAccessVerdict,
} from "../../../Types/RecordAccess/RecordAccess";
import UserType from "../../../Types/UserType";
import { announceModelHeaderChanged } from "../../../UI/Components/Page/ModelHeaderEvents";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import express from "express";

const PROJECT_ID: string = "10272000-0000-4000-8000-000000000101";
const INCIDENT_ID: string = "10272000-0000-4000-8000-0000000001a1";
const OTHER_INCIDENT_ID: string = "10272000-0000-4000-8000-0000000001a2";
const PAYMENTS_LABEL: string = "10272000-0000-4000-8000-0000000001f1";

const COMMANDER_ROLE_ID: string = "10272000-0000-4000-8000-0000000001c1";
const MAYA_ID: string = "10272000-0000-4000-8000-0000000001b1";
const JORDAN_ID: string = "10272000-0000-4000-8000-0000000001b2";
const ANA_ID: string = "10272000-0000-4000-8000-0000000001b4";
const COMMANDER_ROW_ID: string = "10272000-0000-4000-8000-0000000001d1";
const COMMS_ROLE_ID: string = "10272000-0000-4000-8000-0000000001c2";
const COMMS_ROW_ID: string = "10272000-0000-4000-8000-0000000001d2";

const WAIT: { timeout: number } = { timeout: 10000 };

const ROLES_SENTENCE: string =
  "You do not have permission to change this incident's roles.";
const LIMITED_TO_PAYMENTS: string =
  "Your permission is limited to incidents labelled Payments.";
const REASSIGN_NAME: string = "Reassign Incident Commander from Maya Chen";
const REMOVE_NAME: string = "Remove Jordan Patel from Communications Lead";

const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const row: (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (options?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(options?.isBlock),
    ...(options?.scope ? { scope: options.scope } : {}),
  };
};

/*
 * #10191's customer: they read every incident, and may change the roles of
 * the incidents labelled Payments.
 */
const PAYMENTS_RESPONDER: Array<UserPermission> = [
  row(Permission.ReadProjectIncident),
  row(Permission.ReadIncidentMember),
  row(Permission.CreateIncidentMember, { labelIds: [PAYMENTS_LABEL] }),
  row(Permission.EditIncidentMember, { labelIds: [PAYMENTS_LABEL] }),
  row(Permission.DeleteIncidentMember, { labelIds: [PAYMENTS_LABEL] }),
];

// Someone whose role reaches every incident of the project.
const PROJECT_MEMBER: Array<UserPermission> = [row(Permission.ProjectMember)];

// The page's snapshot: what the API's permission headers leave in storage.
const signInAs: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: GLOBAL_PERMISSIONS,
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [
      row(Permission.CurrentUser),
      row(Permission.ProjectUser),
      ...rows,
    ],
  });
};

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: new ObjectID(PROJECT_ID),
  userId: new ObjectID(ANA_ID),
  userType: UserType.User,
};

// Every IncidentMember operation the incident's answer gives.
const rolesAnswer: (
  verdict: RecordAccessVerdict,
  incidentId?: string,
) => RecordAccessResult = (
  verdict: RecordAccessVerdict,
  incidentId?: string,
): RecordAccessResult => {
  return {
    kind: RecordAccessKind.Incident,
    recordId: incidentId || INCIDENT_ID,
    tables: {
      Incident: {
        update: RecordAccess.refused(RecordAccessRefusalReason.Permission),
        delete: RecordAccess.refused(RecordAccessRefusalReason.Permission),
      },
      IncidentMember: {
        create: verdict,
        update: verdict,
        delete: verdict,
      },
    },
  };
};

let server: DashboardRequestsOverHttp;
// What the route answers, by incident; and, when set, what it waits for first.
let answers: Record<string, RecordAccessResult>;
let release: Promise<void> | null;
// Every answer held back, let go after each test so no request stays open.
let openGates: Array<() => void> = [];

// Holds the route's answers back until the returned function lets them go.
const holdAnswers: () => () => void = (): (() => void) => {
  let open: () => void = (): void => {};

  release = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });
  openGates.push(open);

  return open;
};

beforeAll(async () => {
  // The session guards, as a signed-in member passes them.
  for (const guard of [
    "getUserMiddleware",
    "requireUserAuthentication",
  ] as const) {
    jest.spyOn(UserMiddleware, guard).mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
  }

  const router: ExpressRouter = express.Router() as unknown as ExpressRouter;

  RecordAccessRoute.register({
    router: router,
    apiPath: RECORD_ACCESS_API_PATHS[RecordAccessKind.Incident],
    kind: RecordAccessKind.Incident,
  });

  server = new DashboardRequestsOverHttp();
  await server.start([router]);
});

afterAll(async () => {
  await server.stop();
  jest.restoreAllMocks();
});

const userOf: (id: string, name: string) => User = (
  id: string,
  name: string,
): User => {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@acme.example`);
  return user;
};

const commanderRole: () => IncidentRole = (): IncidentRole => {
  const role: IncidentRole = new IncidentRole();
  role._id = COMMANDER_ROLE_ID;
  role.name = "Incident Commander";
  role.isPrimaryRole = true;
  role.color = new Color("#6366f1");
  role.canAssignMultipleUsers = false;
  role.isArchived = false;
  return role;
};

// A role several people take: where Remove and Add More are.
const commsRole: () => IncidentRole = (): IncidentRole => {
  const role: IncidentRole = new IncidentRole();
  role._id = COMMS_ROLE_ID;
  role.name = "Communications Lead";
  role.isPrimaryRole = false;
  role.color = new Color("#0ea5e9");
  role.canAssignMultipleUsers = true;
  role.isArchived = false;
  return role;
};

beforeEach(() => {
  server.requests.length = 0;
  answers = {
    [INCIDENT_ID]: rolesAnswer(RecordAccess.allowed()),
  };
  release = null;
  localStorage.clear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  });
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(CALLER);
  jest
    .spyOn(RecordAccessBuilder, "build")
    .mockImplementation(async (data: { recordId: ObjectID }) => {
      if (release) {
        await release;
      }

      return answers[data.recordId.toString().toLowerCase()]!;
    });

  // The card's reads: the project's roles, the incident's members, its people.
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (request: {
    modelType: { new (): BaseModel };
  }): Promise<ListResult<BaseModel>> => {
    let data: Array<BaseModel> = [];

    if (request.modelType === IncidentRole) {
      data = [commanderRole(), commsRole()];
    }

    if (request.modelType === IncidentMember) {
      const member: IncidentMember = new IncidentMember();
      member._id = COMMANDER_ROW_ID;
      member.userId = new ObjectID(MAYA_ID);
      member.incidentRoleId = new ObjectID(COMMANDER_ROLE_ID);
      member.user = userOf(MAYA_ID, "Maya Chen");
      member.incidentRole = commanderRole();

      const comms: IncidentMember = new IncidentMember();
      comms._id = COMMS_ROW_ID;
      comms.userId = new ObjectID(JORDAN_ID);
      comms.incidentRoleId = new ObjectID(COMMS_ROLE_ID);
      comms.user = userOf(JORDAN_ID, "Jordan Patel");
      comms.incidentRole = commsRole();

      data = [member, comms];
    }

    if (request.modelType === TeamMember) {
      data = [
        userOf(MAYA_ID, "Maya Chen"),
        userOf(JORDAN_ID, "Jordan Patel"),
        userOf(ANA_ID, "Ana Lima"),
      ].map((user: User): TeamMember => {
        const teamMember: TeamMember = new TeamMember();
        teamMember.user = user;
        return teamMember;
      });
    }

    return { data: data, count: data.length, skip: 0, limit: 100 };
  }) as never);
});

afterEach(async () => {
  for (const open of openGates) {
    open();
  }
  openGates = [];
  release = null;

  cleanup();
  // The answers let go reach their requests before the next test.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 20);
  });
  jest.restoreAllMocks();

  for (const guard of [
    "getUserMiddleware",
    "requireUserAuthentication",
  ] as const) {
    jest.spyOn(UserMiddleware, guard).mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
  }
});

// The incident's page, as far as roles go: its card under the page's scope.
const renderCard: (incidentId?: string) => ReturnType<typeof render> = (
  incidentId?: string,
): ReturnType<typeof render> => {
  return render(
    <RecordAccessScopeProvider
      kind={RecordAccessKind.Incident}
      modelId={new ObjectID(incidentId || INCIDENT_ID)}
    >
      <IncidentMemberRoleAssignment
        incidentId={new ObjectID(incidentId || INCIDENT_ID)}
      />
    </RecordAccessScopeProvider>,
  );
};

const HOLDING: PrimaryRoleHolding = {
  role: {
    id: COMMANDER_ROLE_ID,
    name: "Incident Commander",
    isPrimaryRole: true,
  },
  members: [
    {
      memberId: COMMANDER_ROW_ID,
      roleId: COMMANDER_ROLE_ID,
      userId: MAYA_ID,
      name: "Maya Chen",
      hasProfilePicture: false,
    },
  ],
};

// The header's commander, offered as the incident page offers it.
const HeaderCommander: React.FunctionComponent<{
  holding: PrimaryRoleHolding;
}> = (props: { holding: PrimaryRoleHolding }): React.ReactElement => {
  const gates: EventRoleGates = useIncidentRoleGates();
  const fact: EventStatusFact | null = getCommanderFact({
    holding: props.holding,
    onAssign: gates.mayAssign ? async (): Promise<void> => {} : undefined,
    onReassign: gates.mayReassign ? async (): Promise<void> => {} : undefined,
  });

  return (
    <div
      data-testid="header-commander"
      data-editable={fact?.isEditableInPlace ? "yes" : "no"}
    >
      {fact?.value}
    </div>
  );
};

const renderHeader: (holding?: PrimaryRoleHolding) => void = (
  holding?: PrimaryRoleHolding,
): void => {
  render(
    <RecordAccessScopeProvider
      kind={RecordAccessKind.Incident}
      modelId={new ObjectID(INCIDENT_ID)}
    >
      <HeaderCommander holding={holding || HOLDING} />
    </RecordAccessScopeProvider>,
  );
};

const accessRequests: () => Array<string> = (): Array<string> => {
  return server.requests
    .filter((request: SentRequest): boolean => {
      return request.path.includes("/record-access/");
    })
    .map((request: SentRequest): string => {
      return `${request.method} ${request.path}`;
    });
};

const waitForAnswer: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(accessRequests()).toHaveLength(1);
  }, WAIT);
  // The answer's render.
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

describe("the page asks once, through the incident's own route", () => {
  test("one GET of /incident/record-access/:id, however many locks the page draws", async () => {
    signInAs(PAYMENTS_RESPONDER);

    renderCard();
    await screen.findByText("Maya Chen", { selector: "p" }, WAIT);
    await waitForAnswer();

    expect(accessRequests()).toEqual([
      `GET /api/incident/record-access/${INCIDENT_ID}`,
    ]);
    expect(server.requests[0]!.status).toBe(200);
    expect(server.requests[0]!.headers["cache-control"]).toMatch(
      /no-store|no-cache/,
    );
  });

  test("each kind of record asks through its own API: the path the server registers it on", () => {
    const apiPaths: Record<RecordAccessKind, { new (): BaseModel }> = {
      [RecordAccessKind.Incident]: Incident,
      [RecordAccessKind.Alert]: Alert,
      [RecordAccessKind.IncidentEpisode]: IncidentEpisode,
      [RecordAccessKind.AlertEpisode]: AlertEpisode,
      [RecordAccessKind.ScheduledMaintenance]: ScheduledMaintenance,
    };

    for (const [kind, modelType] of Object.entries(apiPaths)) {
      expect(RECORD_ACCESS_API_PATHS[kind as RecordAccessKind]).toBe(
        new modelType().getCrudApiPath()?.toString(),
      );
    }
  });
});

describe("the Incident Roles card", () => {
  test("#10191's customer, on an incident their permission does not reach: Reassign is locked, saying why, and nothing is sent", async () => {
    signInAs(PAYMENTS_RESPONDER);
    answers[INCIDENT_ID] = rolesAnswer(
      RecordAccess.refused(RecordAccessRefusalReason.Labels, {
        labelNames: ["Payments"],
      }),
    );

    renderCard();
    await screen.findByText("Maya Chen", { selector: "p" }, WAIT);

    const locked: HTMLElement = await screen.findByTestId(
      "member-role-reassign-locked",
      {},
      WAIT,
    );

    expect(locked).toHaveAttribute(
      "aria-label",
      `${ROLES_SENTENCE} ${LIMITED_TO_PAYMENTS}`,
    );
    // Taking someone off a role, and giving one, the same.
    expect(screen.getByTestId("member-role-remove-locked")).toHaveAttribute(
      "aria-label",
      `${ROLES_SENTENCE} ${LIMITED_TO_PAYMENTS}`,
    );
    expect(screen.getByTestId("member-role-assign-locked")).toHaveAttribute(
      "aria-label",
      `${ROLES_SENTENCE} ${LIMITED_TO_PAYMENTS}`,
    );
    // The buttons are there, and cannot be pressed.
    expect(screen.getByRole("button", { name: REASSIGN_NAME })).toBeDisabled();
    expect(screen.getByRole("button", { name: REMOVE_NAME })).toBeDisabled();

    // Only the answer was asked for: no write.
    expect(
      server.requests.filter((request: SentRequest): boolean => {
        return request.method !== "GET";
      }),
    ).toEqual([]);
  });

  test("the same reader, on an incident it does reach: Reassign, Remove and Add More are offered", async () => {
    signInAs(PAYMENTS_RESPONDER);

    renderCard();
    await screen.findByText("Maya Chen", { selector: "p" }, WAIT);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: REASSIGN_NAME })).toBeEnabled();
    }, WAIT);
    expect(screen.getByRole("button", { name: REMOVE_NAME })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add More" })).toBeEnabled();
    expect(screen.queryByTestId("member-role-reassign-locked")).toBeNull();
    expect(screen.queryByTestId("member-role-remove-locked")).toBeNull();
    expect(screen.queryByTestId("member-role-assign-locked")).toBeNull();
  });

  test("while the answer is read, a reader it may narrow is offered nothing of the incident's roles - neither offered nor locked", async () => {
    signInAs(PAYMENTS_RESPONDER);
    const open: () => void = holdAnswers();

    renderCard();
    await screen.findByText("Maya Chen", { selector: "p" }, WAIT);

    for (const name of [REASSIGN_NAME, REMOVE_NAME, "Add More"]) {
      expect(screen.queryByRole("button", { name: name })).toBeNull();
    }
    expect(screen.queryByTestId("member-role-reassign-locked")).toBeNull();
    expect(screen.queryByTestId("member-role-remove-locked")).toBeNull();
    expect(screen.queryByTestId("member-role-assign-locked")).toBeNull();

    await act(async (): Promise<void> => {
      open();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: REASSIGN_NAME })).toBeEnabled();
    }, WAIT);
  });

  test("a reader whose role reaches every incident is offered Reassign at once, before the answer lands", async () => {
    signInAs(PROJECT_MEMBER);
    holdAnswers();

    renderCard();
    await screen.findByText("Maya Chen", { selector: "p" }, WAIT);

    expect(screen.getByRole("button", { name: REASSIGN_NAME })).toBeEnabled();
  });

  test.each([
    [
      "a team's block on one of its labels",
      RecordAccess.refused(RecordAccessRefusalReason.BlockedLabels, {
        labelNames: ["Payments"],
      }),
      "A team you are on blocks this on incidents labelled Payments.",
    ],
    [
      "a permission limited to the incidents they or their teams own",
      RecordAccess.refused(RecordAccessRefusalReason.Owned),
      "Your permission is limited to incidents you or your teams own.",
    ],
    [
      "a permission limited to labels or owned incidents",
      RecordAccess.refused(RecordAccessRefusalReason.LabelsOrOwned, {
        labelNames: ["Payments", "Checkout"],
      }),
      "Your permission is limited to incidents labelled Payments or Checkout and to incidents you or your teams own.",
    ],
    [
      "a private incident whose owners' permissions do not allow it",
      RecordAccess.refused(RecordAccessRefusalReason.Private, {
        teamNames: ["Payments SRE"],
      }),
      "This incident is private, so it is changed only with the permissions of the teams that own it, and Payments SRE, your team that owns it, may not do this.",
    ],
    [
      "anything else the rule weighs",
      RecordAccess.refused(RecordAccessRefusalReason.Other),
      "Your permissions do not reach this incident.",
    ],
  ])(
    "%s: Reassign says so",
    async (_name: string, verdict: RecordAccessVerdict, reason: string) => {
      signInAs(PAYMENTS_RESPONDER);
      answers[INCIDENT_ID] = rolesAnswer(verdict);

      renderCard();
      await screen.findByText("Maya Chen", { selector: "p" }, WAIT);

      const locked: HTMLElement = await screen.findByTestId(
        "member-role-reassign-locked",
        {},
        WAIT,
      );

      expect(locked).toHaveAttribute(
        "aria-label",
        `${ROLES_SENTENCE} ${reason}`,
      );
    },
  );

  test("a permission the reader does not hold is still named, whatever the answer says", async () => {
    signInAs([
      row(Permission.ReadProjectIncident),
      row(Permission.ReadIncidentMember),
    ]);
    answers[INCIDENT_ID] = rolesAnswer(
      RecordAccess.refused(RecordAccessRefusalReason.Labels, {
        labelNames: ["Payments"],
      }),
    );

    renderCard();
    await screen.findByText("Maya Chen", { selector: "p" }, WAIT);

    const locked: HTMLElement = await screen.findByTestId(
      "member-role-reassign-locked",
      {},
      WAIT,
    );

    expect(locked.getAttribute("aria-label")).toMatch(
      /^You do not have permission to change this incident's roles\. You need/,
    );
    expect(locked.getAttribute("aria-label")).not.toMatch(/labelled/);
  });

  test("an answer the server could not give leaves the reader's own locks", async () => {
    signInAs(PAYMENTS_RESPONDER);
    jest
      .spyOn(RecordAccessBuilder, "build")
      .mockRejectedValue(new Error("The database went away."));

    renderCard();
    await screen.findByText("Maya Chen", { selector: "p" }, WAIT);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: REASSIGN_NAME })).toBeEnabled();
    }, WAIT);
  });
});

describe("the header's Incident Commander", () => {
  test("hands the role on from the name, where the server allows it", async () => {
    signInAs(PAYMENTS_RESPONDER);

    renderHeader();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: REASSIGN_NAME }),
      ).toBeInTheDocument();
    }, WAIT);
    expect(screen.getByTestId("header-commander")).toHaveAttribute(
      "data-editable",
      "yes",
    );
  });

  test("is plain text on an incident the reader's permission does not reach", async () => {
    signInAs(PAYMENTS_RESPONDER);
    answers[INCIDENT_ID] = rolesAnswer(
      RecordAccess.refused(RecordAccessRefusalReason.Labels, {
        labelNames: ["Payments"],
      }),
    );

    renderHeader();
    await waitForAnswer();

    expect(screen.getByText("Maya Chen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REASSIGN_NAME })).toBeNull();
    expect(screen.getByTestId("header-commander")).toHaveAttribute(
      "data-editable",
      "no",
    );
  });

  test("offers no Assign while nobody holds the role, where the server refuses a new role", async () => {
    signInAs(PAYMENTS_RESPONDER);
    answers[INCIDENT_ID] = rolesAnswer(
      RecordAccess.refused(RecordAccessRefusalReason.Labels, {
        labelNames: ["Payments"],
      }),
    );

    renderHeader({ ...HOLDING, members: [] });
    await waitForAnswer();

    expect(screen.queryByRole("button", { name: /Assign/ })).toBeNull();
  });

  test("offers Assign while nobody holds the role, where the server allows a new one", async () => {
    signInAs(PAYMENTS_RESPONDER);

    renderHeader({ ...HOLDING, members: [] });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Assign/ }),
      ).toBeInTheDocument();
    }, WAIT);
  });

  test("holds the name back as plain text while the answer is read, for a reader it may narrow", async () => {
    signInAs(PAYMENTS_RESPONDER);
    holdAnswers();

    renderHeader();

    await waitFor(() => {
      expect(accessRequests()).toHaveLength(0);
    });
    expect(screen.getByText("Maya Chen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REASSIGN_NAME })).toBeNull();
  });
});

describe("moving to another incident", () => {
  test("asks again for the incident now on screen, and the last one's answer locks nothing of it", async () => {
    signInAs(PAYMENTS_RESPONDER);
    answers[INCIDENT_ID] = rolesAnswer(
      RecordAccess.refused(RecordAccessRefusalReason.Labels, {
        labelNames: ["Payments"],
      }),
    );
    answers[OTHER_INCIDENT_ID] = rolesAnswer(
      RecordAccess.allowed(),
      OTHER_INCIDENT_ID,
    );

    const view: ReturnType<typeof render> = renderCard();
    await screen.findByTestId("member-role-reassign-locked", {}, WAIT);

    view.rerender(
      <RecordAccessScopeProvider
        kind={RecordAccessKind.Incident}
        modelId={new ObjectID(OTHER_INCIDENT_ID)}
      >
        <IncidentMemberRoleAssignment
          incidentId={new ObjectID(OTHER_INCIDENT_ID)}
        />
      </RecordAccessScopeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: REASSIGN_NAME })).toBeEnabled();
    }, WAIT);

    expect(accessRequests()).toEqual([
      `GET /api/incident/record-access/${INCIDENT_ID}`,
      `GET /api/incident/record-access/${OTHER_INCIDENT_ID}`,
    ]);
  });
});

describe("the incident's details saved on its pages", () => {
  test("asks again - a label added can bring the incident within the reader's permission - and the locks follow it", async () => {
    signInAs(PAYMENTS_RESPONDER);
    answers[INCIDENT_ID] = rolesAnswer(
      RecordAccess.refused(RecordAccessRefusalReason.Labels, {
        labelNames: ["Payments"],
      }),
    );

    renderCard();
    await screen.findByTestId("member-role-reassign-locked", {}, WAIT);

    // Another record's save asks nothing again.
    act(() => {
      announceModelHeaderChanged({
        modelType: Incident,
        modelId: new ObjectID(OTHER_INCIDENT_ID),
      });
    });

    // The incident is labelled Payments now.
    answers[INCIDENT_ID] = rolesAnswer(RecordAccess.allowed());

    act(() => {
      announceModelHeaderChanged({
        modelType: Incident,
        modelId: new ObjectID(INCIDENT_ID),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: REASSIGN_NAME })).toBeEnabled();
    }, WAIT);
    expect(screen.queryByTestId("member-role-reassign-locked")).toBeNull();

    expect(accessRequests()).toEqual([
      `GET /api/incident/record-access/${INCIDENT_ID}`,
      `GET /api/incident/record-access/${INCIDENT_ID}`,
    ]);
  });

  test("keeps the last answer while it asks again, so nothing is offered and then taken back", async () => {
    signInAs(PAYMENTS_RESPONDER);
    answers[INCIDENT_ID] = rolesAnswer(
      RecordAccess.refused(RecordAccessRefusalReason.Labels, {
        labelNames: ["Payments"],
      }),
    );

    renderCard();
    await screen.findByTestId("member-role-reassign-locked", {}, WAIT);

    holdAnswers();

    act(() => {
      announceModelHeaderChanged({
        modelType: Incident,
        modelId: new ObjectID(INCIDENT_ID),
      });
    });

    // Asked again, and not answered yet: the lock stands as it was.
    await waitFor(() => {
      expect(jest.mocked(RecordAccessBuilder.build)).toHaveBeenCalledTimes(2);
    }, WAIT);
    expect(screen.getByTestId("member-role-reassign-locked")).toHaveAttribute(
      "aria-label",
      `${ROLES_SENTENCE} ${LIMITED_TO_PAYMENTS}`,
    );
    expect(accessRequests()).toEqual([
      `GET /api/incident/record-access/${INCIDENT_ID}`,
    ]);
  });
});
