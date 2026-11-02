import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock consts above are still unassigned when the factory
 * runs. Dereferencing them lazily, at call time, is what makes this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

// The state-change modal is not what these are about.
jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", {
        "data-testid": "state-change-modal",
      });
    },
  };
});

import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import PrivateRecordScopeProvider from "../../../../App/FeatureSet/Dashboard/src/Components/PrivateRecord/PrivateRecordScopeProvider";
import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * THE MAINTAINER'S PAGE (block 33, INC-17): a private incident owned by
 * Team 2 alone, whose permissions are Viewer, opened by Test User 2 - a
 * member of Team 1 (Project Member) and Team 2. The page offered
 * Acknowledge, Resolve and every Edit, and the server took them, through
 * Team 1's permission. A private incident is changed only with the
 * permissions of the teams that own it and of the people named as its
 * owners: the incident's view layout reads who owns it
 * (PrivateRecordScopeProvider), and every gate of the incident and its
 * parts on the page locks, saying why - while a card about something else
 * on the page (a monitor) is offered as before, and the incident is read
 * as before.
 */

const PROJECT_ID: string = "7f000000-0000-4000-8000-000000000001";
const INCIDENT_ID: string = "7f000000-0000-4000-8000-000000000017";
const MONITOR_ID: string = "7f000000-0000-4000-8000-000000000033";
const USER_ID: string = "7f000000-0000-4000-8000-0000000000e2";
const TEAM_1: string = "7f000000-0000-4000-8000-0000000000a1";
const TEAM_2: string = "7f000000-0000-4000-8000-0000000000a2";
const TEAM_3: string = "7f000000-0000-4000-8000-0000000000a3";
const CREATED: string = "7f000000-0000-4000-8000-0000000000c1";
const ACKNOWLEDGED: string = "7f000000-0000-4000-8000-0000000000c2";
const RESOLVED: string = "7f000000-0000-4000-8000-0000000000c3";

const TITLE: string = "Another Private Incident";
const DESCRIPTION: string = "Sigh. Updated.";
const START: Date = new Date("2026-10-28T16:00:00.000Z");

// Why, after each lock's first sentence.
const WHY: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it, and Team 2, your team that owns it, may not do this.";
const STATE_REASON: string = `You do not have permission to change this incident's state. ${WHY}`;
const EDIT_REASON: string = `You do not have permission to update this Incident. ${WHY}`;

type RowFunction = (
  permission: Permission,
  teamId?: string | undefined,
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  teamId?: string | undefined,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
  };
};

const DEFAULT_ROWS: Array<UserPermission> = [
  row(Permission.CurrentUser),
  row(Permission.UnAuthorizedSsoUser),
  row(Permission.ProjectUser),
];

// Test User 2: Team 1 may change every incident, Team 2 may only view.
const MAINTAINERS_ROWS: Array<UserPermission> = [
  ...DEFAULT_ROWS,
  row(Permission.ProjectMember, TEAM_1),
  row(Permission.Viewer, TEAM_2),
];

function store(rows: Array<UserPermission>): void {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: rows,
  });
}

interface Scenario {
  isPrivate: boolean;
  owningTeams: Array<{ id: string; name: string }>;
  isOwnedByReader: boolean;
  // How the read of whether the incident is private answers.
  privateRead?: "answers" | "fails" | "pending" | undefined;
  ownersRead?: "answers" | "fails" | undefined;
}

const MAINTAINERS_CASE: Scenario = {
  isPrivate: true,
  owningTeams: [{ id: TEAM_2, name: "Team 2" }],
  isOwnedByReader: false,
};

interface ListResultShape {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

function listResult(data: Array<unknown>): ListResultShape {
  return { data: data, count: data.length, skip: 0, limit: 99 };
}

function stateOf(id: string, name: string, order: number): IncidentState {
  const state: IncidentState = new IncidentState();
  state.id = new ObjectID(id);
  state.name = name;
  state.color = new Color("#6366f1");
  state.order = order;
  return state;
}

function respondWith(scenario: Scenario): void {
  getItemMock.mockImplementation((...args: Array<unknown>) => {
    const request: {
      modelType: { new (): BaseModel };
      select?: Record<string, unknown>;
    } = args[0] as {
      modelType: { new (): BaseModel };
      select?: Record<string, unknown>;
    };

    if (request.modelType === Incident && request.select?.["isPrivate"]) {
      if (scenario.privateRead === "pending") {
        return new Promise<never>(() => {});
      }

      if (scenario.privateRead === "fails") {
        return Promise.reject(new Error("The incident could not be read."));
      }

      const incident: Incident = new Incident();
      incident.id = new ObjectID(INCIDENT_ID);
      incident.isPrivate = scenario.isPrivate;
      return Promise.resolve(incident);
    }

    if (request.modelType === Incident) {
      const incident: Incident = new Incident();
      incident.id = new ObjectID(INCIDENT_ID);
      incident.description = DESCRIPTION;
      return Promise.resolve(incident);
    }

    if (request.modelType === Monitor) {
      const monitor: Monitor = new Monitor();
      monitor.id = new ObjectID(MONITOR_ID);
      monitor.name = "Checkout API";
      return Promise.resolve(monitor);
    }

    return Promise.reject(new Error("Unexpected item request"));
  });

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentState) {
      const created: IncidentState = stateOf(CREATED, "Created", 1);
      const acknowledged: IncidentState = stateOf(
        ACKNOWLEDGED,
        "Acknowledged",
        2,
      );
      const resolved: IncidentState = stateOf(RESOLVED, "Resolved", 3);

      created.isCreatedState = true;
      acknowledged.isAcknowledgedState = true;
      resolved.isResolvedState = true;

      return Promise.resolve(listResult([created, acknowledged, resolved]));
    }

    if (request.modelType === IncidentStateTimeline) {
      const timeline: IncidentStateTimeline = new IncidentStateTimeline();
      timeline.incidentStateId = new ObjectID(CREATED);
      timeline.startsAt = START;
      return Promise.resolve(listResult([timeline]));
    }

    if (request.modelType === IncidentNoteTemplate) {
      return Promise.resolve(listResult([]));
    }

    if (request.modelType === IncidentOwnerTeam) {
      if (scenario.ownersRead === "fails") {
        return Promise.reject(new Error("The owners could not be read."));
      }

      return Promise.resolve(
        listResult(
          scenario.owningTeams.map(
            (owner: { id: string; name: string }): IncidentOwnerTeam => {
              const ownerTeam: IncidentOwnerTeam = new IncidentOwnerTeam();
              ownerTeam.teamId = new ObjectID(owner.id);
              const team: Team = new Team();
              team.name = owner.name;
              ownerTeam.team = team;
              return ownerTeam;
            },
          ),
        ),
      );
    }

    return Promise.reject(new Error("Unexpected list request"));
  });

  countMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentOwnerUser) {
      return Promise.resolve(scenario.isOwnedByReader ? 1 : 0);
    }

    return Promise.reject(new Error("Unexpected count request"));
  });
}

function renderPage(): void {
  render(
    <PrivateRecordScopeProvider
      modelType={Incident}
      modelId={new ObjectID(INCIDENT_ID)}
      ownerTeamModelType={IncidentOwnerTeam}
      ownerUserModelType={IncidentOwnerUser}
      ownerKey="incidentId"
    >
      <>
        <ChangeIncidentState
          incidentId={new ObjectID(INCIDENT_ID)}
          eventNumber="INC-17"
          title={TITLE}
          eventStartsAt={START}
          onActionComplete={(): void => {}}
        />
        <CardModelDetail<Incident>
          name="Incident Description"
          cardProps={{ title: "What happened", description: "What it is" }}
          isEditable={true}
          formFields={[
            {
              field: { description: true },
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
            },
          ]}
          modelDetailProps={{
            modelType: Incident,
            id: "incident-description",
            modelId: new ObjectID(INCIDENT_ID),
            fields: [
              {
                field: { description: true },
                title: "Description",
                fieldType: FieldType.LongText,
              },
            ],
          }}
        />
        <CardModelDetail<Monitor>
          name="Monitor"
          cardProps={{ title: "Affected monitor", description: "What it is" }}
          isEditable={true}
          formFields={[
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
            },
          ]}
          modelDetailProps={{
            modelType: Monitor,
            id: "monitor-detail",
            modelId: new ObjectID(MONITOR_ID),
            fields: [
              {
                field: { name: true },
                title: "Name",
                fieldType: FieldType.Text,
              },
            ],
          }}
        />
      </>
    </PrivateRecordScopeProvider>,
  );
}

function buttonStartingWith(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith(text);
      },
    ) || null
  );
}

// The tooltip a hover of `wrapper` opens - the newest, as one fades out.
function tooltipOf(wrapper: HTMLElement): string {
  fireEvent.mouseEnter(wrapper);
  const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");
  const text: string = tooltips[tooltips.length - 1]!.textContent || "";
  fireEvent.mouseLeave(wrapper);
  return text;
}

async function renderLoaded(): Promise<void> {
  renderPage();
  await screen.findByRole("heading", { level: 2, name: TITLE });
  await screen.findByText(DESCRIPTION);
  await screen.findByText("Checkout API");
}

function ownerReads(): Array<unknown> {
  return getListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown };
    })
    .filter((request: { modelType: unknown }) => {
      return request.modelType === IncidentOwnerTeam;
    });
}

beforeEach(() => {
  localStorage.clear();
  PermissionGate.clearPermissionPropsCache();

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  store(MAINTAINERS_ROWS);
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("a private incident owned by a view-only team of the reader's (the maintainer's INC-17)", () => {
  test("Acknowledge and Resolve are locked, each saying why", async () => {
    respondWith(MAINTAINERS_CASE);

    await renderLoaded();

    await waitFor(() => {
      expect(
        document.getElementById("incident-acknowledge-btn"),
      ).toBeDisabled();
    });

    for (const id of ["incident-acknowledge-btn", "incident-resolve-btn"]) {
      expect(document.getElementById(id)).toBeDisabled();
      expect(tooltipOf(screen.getByTestId(`${id}-disabled-wrapper`))).toBe(
        STATE_REASON,
      );
    }
  });

  test("the incident's Edit is locked, saying why - while a monitor on the page is edited as before", async () => {
    respondWith(MAINTAINERS_CASE);

    await renderLoaded();

    await waitFor(() => {
      expect(buttonStartingWith("Edit Incident")).toBeDisabled();
    });

    expect(
      tooltipOf(buttonStartingWith("Edit Incident")!.parentElement!),
    ).toContain(EDIT_REASON);
    expect(buttonStartingWith("Edit Monitor")).toBeEnabled();
  });

  test("the incident is still read: Team 2 owns it, and Team 2 may view it", async () => {
    respondWith(MAINTAINERS_CASE);

    await renderLoaded();

    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: TITLE }),
    ).toBeVisible();
  });

  test("the layout asks once whether it is private, then who owns it and whether the reader does", async () => {
    respondWith(MAINTAINERS_CASE);

    await renderLoaded();

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(1);
    });

    const privateReads: Array<unknown> = getItemMock.mock.calls.filter(
      (call: Array<unknown>) => {
        return Boolean(
          (call[0] as { select?: Record<string, unknown> }).select?.[
            "isPrivate"
          ],
        );
      },
    );

    expect(privateReads).toHaveLength(1);
    expect(privateReads[0]).toEqual([
      expect.objectContaining({
        modelType: Incident,
        select: { isPrivate: true },
      }),
    ]);
    expect(ownerReads()).toHaveLength(1);
    expect(ownerReads()[0]).toEqual(
      expect.objectContaining({
        modelType: IncidentOwnerTeam,
        query: { incidentId: new ObjectID(INCIDENT_ID) },
        select: { teamId: true, team: { name: true } },
      }),
    );
    expect(countMock.mock.calls[0]).toEqual([
      expect.objectContaining({
        modelType: IncidentOwnerUser,
        query: {
          incidentId: new ObjectID(INCIDENT_ID),
          userId: new ObjectID(USER_ID),
        },
      }),
    ]);
  });

  test("owned by two view-only teams of the reader's, the reason names both", async () => {
    store([...MAINTAINERS_ROWS, row(Permission.Viewer, TEAM_3)]);
    respondWith({
      ...MAINTAINERS_CASE,
      owningTeams: [
        { id: TEAM_2, name: "Team 2" },
        { id: TEAM_3, name: "Payments" },
      ],
    });

    await renderLoaded();

    await waitFor(() => {
      expect(
        document.getElementById("incident-acknowledge-btn"),
      ).toBeDisabled();
    });

    expect(
      tooltipOf(
        screen.getByTestId("incident-acknowledge-btn-disabled-wrapper"),
      ),
    ).toBe(
      "You do not have permission to change this incident's state. This incident is private, so it is changed only with the permissions of the teams that own it, and Team 2 and Payments, your teams that own it, may not do this.",
    );
  });
});

describe("the same page offers every change again", () => {
  async function expectEverythingOffered(): Promise<void> {
    await renderLoaded();

    await waitFor(() => {
      expect(document.getElementById("incident-acknowledge-btn")).toBeEnabled();
    });

    expect(document.getElementById("incident-resolve-btn")).toBeEnabled();
    expect(
      screen.queryByTestId("incident-acknowledge-btn-disabled-wrapper"),
    ).toBeNull();
    expect(buttonStartingWith("Edit Incident")).toBeEnabled();
    expect(buttonStartingWith("Edit Monitor")).toBeEnabled();
  }

  test("once Team 2 may change incidents", async () => {
    store([...MAINTAINERS_ROWS, row(Permission.IncidentMember, TEAM_2)]);
    respondWith(MAINTAINERS_CASE);

    await expectEverythingOffered();
  });

  test("once the reader is named an owner of the incident", async () => {
    respondWith({ ...MAINTAINERS_CASE, isOwnedByReader: true });

    await expectEverythingOffered();
  });

  test("on a private incident Team 1 owns", async () => {
    respondWith({
      ...MAINTAINERS_CASE,
      owningTeams: [{ id: TEAM_1, name: "Team 1" }],
    });

    await expectEverythingOffered();
  });

  test("on an incident that is not private: Team 1's permission reaches it, and who owns it is never read", async () => {
    respondWith({ ...MAINTAINERS_CASE, isPrivate: false });

    await expectEverythingOffered();

    expect(ownerReads()).toEqual([]);
    expect(countMock).not.toHaveBeenCalled();
  });

  test("for a Project Admin, who acts on every private record: nothing is read about it at all", async () => {
    store([...MAINTAINERS_ROWS, row(Permission.ProjectAdmin, TEAM_1)]);
    respondWith(MAINTAINERS_CASE);

    await expectEverythingOffered();

    expect(
      getItemMock.mock.calls.some((call: Array<unknown>) => {
        return Boolean(
          (call[0] as { select?: Record<string, unknown> }).select?.[
            "isPrivate"
          ],
        );
      }),
    ).toBe(false);
    expect(ownerReads()).toEqual([]);
  });

  test("when who owns it cannot be read: the gates stay as they are, and the server holds the rule", async () => {
    respondWith({ ...MAINTAINERS_CASE, ownersRead: "fails" });

    await expectEverythingOffered();
  });

  test("when whether it is private cannot be read: the same", async () => {
    respondWith({ ...MAINTAINERS_CASE, privateRead: "fails" });

    await expectEverythingOffered();
  });
});

describe("while the page reads who owns the incident", () => {
  test("its changes are not offered yet - neither offered nor locked - and the monitor's are", async () => {
    respondWith({ ...MAINTAINERS_CASE, privateRead: "pending" });

    renderPage();

    await screen.findByRole("heading", { level: 2, name: TITLE });
    await screen.findByText(DESCRIPTION);
    await screen.findByText("Checkout API");

    await waitFor(() => {
      expect(buttonStartingWith("Edit Monitor")).toBeEnabled();
    });

    expect(document.getElementById("incident-acknowledge-btn")).toBeNull();
    expect(document.getElementById("incident-resolve-btn")).toBeNull();
    expect(buttonStartingWith("Edit Incident")).toBeNull();
    // Read as before: the description is on the page.
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
  });
});
