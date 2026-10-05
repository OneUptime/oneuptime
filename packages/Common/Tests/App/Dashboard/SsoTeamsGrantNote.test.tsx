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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * A PROJECT SSO PROVIDER'S TEAMS: THE FORM NAMES THE ONES THE SERVER WOULD
 * REFUSE.
 *
 * People who sign in with a project's SAML or OIDC provider for the first
 * time join its teams, so the server saves a provider only with teams the
 * person saving it could invite someone to (Server/Utils
 * /SsoProviderTeamGrant). Settings > SSO and Settings > OIDC say so under
 * Teams the moment such a team is picked (Dashboard Components/Sso
 * /SsoTeamsGrantNote, SsoTeamGrants):
 *
 *   - the rule, piece by piece: which ids a Teams field holds, which teams
 *     the signed-in user could hand on, which picked ones they could not;
 *   - side by side with the server, caller by caller and team by team,
 *     label-limited and blocked rows included: the note warns about exactly
 *     the teams the server refuses;
 *   - the note itself: nothing while loading, when every team is fine, or
 *     when the teams cannot be read; the teams by name otherwise;
 *   - through the real provider form, on its Sign-in step.
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

let isMasterAdminForTest: boolean = false;
let projectPermissionsForTest: unknown = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner", "ProjectAdmin", "User", "Public"];
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): unknown => {
        return {
          _type: "UserGlobalAccessPermission",
          projectIds: [],
          globalPermissions: ["Public", "User"],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

interface MockListRequest {
  modelType: { new (): unknown };
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  query: Record<string, unknown>;
}

const mockServer: {
  lists: Array<MockListRequest>;
  failLists: boolean;
  record: Record<string, unknown>;
} = { lists: [], failLists: false, record: {} };

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<Record<string, unknown>> => {
        return { ...mockServer.record };
      },
      getList: async (
        data: MockListRequest,
      ): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        mockServer.lists.push(data);

        const fixtures: typeof import("./SsoTeamsGrantNoteFixtures") =
          jest.requireActual(
            "./SsoTeamsGrantNoteFixtures",
          ) as typeof import("./SsoTeamsGrantNoteFixtures");

        if (mockServer.failLists) {
          throw new Error("You do not have permission to read teams.");
        }

        const rows: Array<unknown> = fixtures.listFor(data.modelType);

        return { data: rows, count: rows.length, skip: 0, limit: 10000 };
      },
      getCommonHeaders: (): Record<string, unknown> => {
        return {};
      },
      createOrUpdate: async (data: {
        model: Record<string, unknown>;
      }): Promise<{ data: Record<string, unknown> }> => {
        return { data: data.model };
      },
    },
  };
});

import {
  SsoTeamGrant,
  buildSsoTeamGrants,
  canSignedInUserGrantTeam,
  fetchSsoTeamGrants,
  getFormTeamIds,
  getTeamsBeyondGrant,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/SsoTeamGrants";
import SsoTeamsGrantNote, {
  SSO_TEAMS_GRANT_NOTE_TEST_ID,
  getSsoTeamsGrantNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/SsoTeamsGrantNote";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { getSamlProviderFormFields } from "../../../UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "../../../UI/Components/Sso/SsoProviderFormFields";
import { TeamPermissionGrant } from "../../../UI/Utils/GrantablePermission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import {
  ADMIN,
  FRONTEND,
  FRONTEND_LABEL_ID,
  FixtureTeam,
  MEMBERS,
  OWNERS,
  PROJECT_ID,
  PROJECT_TEAMS,
  READERS,
  RESPONDERS,
  listFor,
  toPermissionModels,
} from "./SsoTeamsGrantNoteFixtures";

const PROVIDER_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-0000000000b1",
);

function allow(
  permission: Permission,
  data?: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<ObjectID> | undefined;
  },
): UserPermission {
  return {
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: false,
    scope: data?.scope || PermissionScope.All,
    _type: "UserPermission",
  };
}

function block(
  permission: Permission,
  labelIds: Array<ObjectID> = [],
): UserPermission {
  return {
    permission: permission,
    labelIds: labelIds,
    isBlockPermission: true,
    _type: "UserPermission",
  };
}

interface Caller {
  name: string;
  rows: Array<UserPermission>;
  // The teams the server lets this caller put on a provider.
  grantable: Array<FixtureTeam>;
}

const CALLERS: Array<Caller> = [
  {
    name: "a project owner",
    rows: [allow(Permission.ProjectOwner)],
    grantable: PROJECT_TEAMS,
  },
  {
    name: "a project admin",
    rows: [allow(Permission.ProjectAdmin)],
    grantable: [ADMIN, READERS],
  },
  {
    name: "a project admin who is also in Members",
    rows: [allow(Permission.ProjectAdmin), allow(Permission.ProjectMember)],
    grantable: [ADMIN, MEMBERS, FRONTEND, READERS],
  },
  {
    name: "a project owner blocked from Project Owner, who is also an admin",
    rows: [
      allow(Permission.ProjectOwner),
      block(Permission.ProjectOwner),
      allow(Permission.ProjectAdmin),
    ],
    grantable: [ADMIN, READERS],
  },
  {
    name: "an SSO editor with Project Member for the Frontend label only",
    rows: [
      allow(Permission.CreateProjectSSO),
      allow(Permission.EditProjectSSO),
      allow(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [FRONTEND_LABEL_ID],
      }),
    ],
    grantable: [FRONTEND, READERS],
  },
  {
    name: "an SSO editor with Project Member, blocked from it on Frontend",
    rows: [
      allow(Permission.CreateProjectSSO),
      allow(Permission.EditProjectSSO),
      allow(Permission.ProjectMember),
      block(Permission.ProjectMember, [FRONTEND_LABEL_ID]),
    ],
    grantable: [READERS],
  },
  {
    name: "an SSO editor with Project Member and Delete Incident",
    rows: [
      allow(Permission.CreateProjectSSO),
      allow(Permission.EditProjectSSO),
      allow(Permission.ProjectMember),
      allow(Permission.DeleteProjectIncident),
    ],
    grantable: [MEMBERS, FRONTEND, READERS, RESPONDERS],
  },
];

function signIn(caller: Caller): void {
  projectPermissionsForTest = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: caller.rows,
  };
}

function serverProps(caller: Caller): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("5f000000-0000-4000-8000-0000000000c1"),
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: caller.rows.map((row: UserPermission): UserPermission => {
          return { ...row, labelIds: [...row.labelIds] };
        }),
      },
    },
  };
}

function idOf(team: FixtureTeam): string {
  return team.id.toString();
}

beforeEach(() => {
  isMasterAdminForTest = false;
  projectPermissionsForTest = null;
  mockServer.lists = [];
  mockServer.failLists = false;
  mockServer.record = {};
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the ids a Teams field holds", () => {
  test("in every shape the field holds them, once each, in order", () => {
    expect(
      getFormTeamIds([
        idOf(MEMBERS),
        { value: idOf(ADMIN), label: "Admin" },
        { _id: idOf(OWNERS).toUpperCase() },
        OWNERS.id,
        idOf(MEMBERS),
      ]),
    ).toEqual([idOf(MEMBERS), idOf(ADMIN), idOf(OWNERS)]);
  });

  test("nothing picked is none", () => {
    expect(getFormTeamIds(undefined)).toEqual([]);
    expect(getFormTeamIds(null)).toEqual([]);
    expect(getFormTeamIds([])).toEqual([]);
    expect(getFormTeamIds(["", "  "])).toEqual([]);
  });

  test("a single value counts as one pick", () => {
    expect(getFormTeamIds(idOf(ADMIN))).toEqual([idOf(ADMIN)]);
  });
});

describe("which teams the person could hand on", () => {
  const TEAMS: Array<{ id: string; name: string }> = PROJECT_TEAMS.map(
    (team: FixtureTeam): { id: string; name: string } => {
      return { id: idOf(team).toUpperCase(), name: team.name };
    },
  );

  test("a team is weighed by every row it has, allows and blocks alike", () => {
    const asked: Array<Array<TeamPermissionGrant>> = [];

    const grants: Array<SsoTeamGrant> = buildSsoTeamGrants({
      teams: TEAMS,
      permissionRows: PROJECT_TEAMS.flatMap((team: FixtureTeam) => {
        return team.rows.map((row: FixtureTeam["rows"][number]) => {
          return {
            teamId: idOf(team),
            permission: row.permission,
            scope: row.scope,
            labelIds: (row.labelIds || []).map((labelId: ObjectID): string => {
              return labelId.toString();
            }),
          };
        });
      }),
      canGrantTeam: (rows: Array<TeamPermissionGrant>): boolean => {
        asked.push(rows);
        return rows.length === 0;
      },
    });

    expect(
      grants.map((grant: SsoTeamGrant) => {
        return [grant.id, grant.name, grant.canGrant];
      }),
    ).toEqual(
      PROJECT_TEAMS.map((team: FixtureTeam) => {
        return [idOf(team), team.name, team.rows.length === 0];
      }),
    );

    // Responders hands on its block row too.
    expect(asked[PROJECT_TEAMS.indexOf(RESPONDERS)]).toEqual([
      {
        permission: Permission.ProjectMember,
        scope: PermissionScope.All,
        labelIds: [],
      },
      {
        permission: Permission.DeleteProjectIncident,
        scope: PermissionScope.All,
        labelIds: [],
      },
    ]);
  });

  test("the picked teams beyond it are named in the project's order", () => {
    const grants: Array<SsoTeamGrant> = [
      { id: idOf(OWNERS), name: "Owners", canGrant: false },
      { id: idOf(ADMIN), name: "Admin", canGrant: true },
      { id: idOf(MEMBERS), name: "Members", canGrant: false },
    ];

    expect(
      getTeamsBeyondGrant({
        selectedTeams: [idOf(MEMBERS), idOf(ADMIN), idOf(OWNERS)],
        grants,
      }),
    ).toEqual(["Owners", "Members"]);
    expect(
      getTeamsBeyondGrant({ selectedTeams: [idOf(ADMIN)], grants }),
    ).toEqual([]);
    // While the grants are not known, nothing is said.
    expect(
      getTeamsBeyondGrant({ selectedTeams: [idOf(OWNERS)], grants: null }),
    ).toEqual([]);
  });

  test("reads the project's teams, oldest first, and every row with its scope and labels", async () => {
    signIn(CALLERS[1]!);

    const grants: Array<SsoTeamGrant> = await fetchSsoTeamGrants({
      projectId: PROJECT_ID,
      modelAPI: ModelAPI,
    });

    expect(
      grants.map((grant: SsoTeamGrant): [string, boolean] => {
        return [grant.name, grant.canGrant];
      }),
    ).toEqual([
      ["Owners", false],
      ["Admin", true],
      ["Members", false],
      ["Frontend", false],
      ["Readers", true],
      ["Responders", false],
    ]);

    const teamList: MockListRequest | undefined = mockServer.lists.find(
      (request: MockListRequest): boolean => {
        return request.modelType === Team;
      },
    );
    const rowList: MockListRequest | undefined = mockServer.lists.find(
      (request: MockListRequest): boolean => {
        return request.modelType === TeamPermission;
      },
    );

    expect(teamList?.query).toEqual({ projectId: PROJECT_ID });
    expect(teamList?.sort).toEqual({ createdAt: SortOrder.Ascending });
    expect(rowList?.query).toEqual({ projectId: PROJECT_ID });
    expect(rowList?.select).toEqual({
      _id: true,
      teamId: true,
      permission: true,
      isBlockPermission: true,
      scope: true,
      labels: { _id: true },
    });
  });

  test("a row whose permission did not come back counts against its team, as on the server", async () => {
    signIn(CALLERS[1]!);

    const unreadable: TeamPermission = new TeamPermission();
    unreadable.teamId = READERS.id;
    unreadable.projectId = PROJECT_ID;

    const grants: Array<SsoTeamGrant> = await fetchSsoTeamGrants({
      projectId: PROJECT_ID,
      modelAPI: {
        getList: async (data: {
          modelType: unknown;
        }): Promise<{
          data: Array<unknown>;
          count: number;
          skip: number;
          limit: number;
        }> => {
          const rows: Array<unknown> =
            data.modelType === TeamPermission
              ? [unreadable]
              : listFor(data.modelType);

          return { data: rows, count: rows.length, skip: 0, limit: 10000 };
        },
      } as unknown as typeof ModelAPI,
    });

    expect(
      grants.find((grant: SsoTeamGrant): boolean => {
        return grant.name === READERS.name;
      })?.canGrant,
    ).toBe(false);

    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: unreadable.permission as Permission,
        labelIds: [],
        scope: undefined,
        props: serverProps(CALLERS[1]!),
      });
    }).toThrow(NotAuthorizedException);
  });

  test("a master admin may hand on every team, as on the server", async () => {
    isMasterAdminForTest = true;

    const grants: Array<SsoTeamGrant> = await fetchSsoTeamGrants({
      projectId: PROJECT_ID,
    });

    expect(
      grants.every((grant: SsoTeamGrant): boolean => {
        return grant.canGrant;
      }),
    ).toBe(true);
  });
});

/*
 * The note warns about a team exactly when the server refuses it: the
 * dashboard's rule over the rows the browser reads, against the server's
 * rule over the same rows.
 */
describe("side by side with the server", () => {
  beforeEach(() => {
    getJestSpyOn(QueryHelper, "any").mockImplementation(
      (values: unknown): unknown => {
        return {
          anyOf: (values as Array<unknown>).map((value: unknown): string => {
            return String(value).toLowerCase();
          }),
        };
      },
    );

    getJestSpyOn(TeamPermissionService, "findAllBy").mockImplementation(
      async (findBy: unknown): Promise<Array<TeamPermission>> => {
        const teamIds: Array<string> = (
          (findBy as { query: { teamId: { anyOf: Array<string> } } }).query
            .teamId as { anyOf: Array<string> }
        ).anyOf;

        return PROJECT_TEAMS.filter((team: FixtureTeam): boolean => {
          return teamIds.includes(idOf(team).toLowerCase());
        }).flatMap(toPermissionModels);
      },
    );
  });

  test.each(CALLERS)(
    "$name: the teams the note names are the teams the server refuses",
    async (caller: Caller) => {
      signIn(caller);

      const dashboard: Array<SsoTeamGrant> = await fetchSsoTeamGrants({
        projectId: PROJECT_ID,
        canGrantTeam: canSignedInUserGrantTeam,
      });

      const refusedByServer: Array<string> = (
        await TeamPermissionService.findTeamsCallerCannotGrant({
          teamIds: PROJECT_TEAMS.map((team: FixtureTeam): ObjectID => {
            return team.id;
          }),
          projectId: PROJECT_ID,
          props: serverProps(caller),
        })
      ).map((teamId: ObjectID): string => {
        return teamId.toString();
      });

      const refusedByDashboard: Array<string> = dashboard
        .filter((grant: SsoTeamGrant): boolean => {
          return !grant.canGrant;
        })
        .map((grant: SsoTeamGrant): string => {
          return grant.id;
        });

      expect(refusedByDashboard).toEqual(refusedByServer);
      expect(refusedByDashboard).toEqual(
        PROJECT_TEAMS.filter((team: FixtureTeam): boolean => {
          return !caller.grantable.includes(team);
        }).map(idOf),
      );
    },
  );
});

describe("the note under Teams", () => {
  async function renderNote(selectedTeams: unknown): Promise<{
    rerender: (selected: unknown) => void;
  }> {
    let rerender: (ui: React.ReactElement) => void = () => {
      // Replaced below.
    };

    await act(async (): Promise<void> => {
      rerender = render(<SsoTeamsGrantNote selectedTeams={selectedTeams} />)
        .rerender;
    });

    return {
      rerender: (selected: unknown): void => {
        rerender(<SsoTeamsGrantNote selectedTeams={selected} />);
      },
    };
  }

  test("names a picked team the person could not invite someone to", async () => {
    signIn(CALLERS[1]!);

    await renderNote([idOf(ADMIN), idOf(OWNERS)]);

    const note: HTMLElement = await screen.findByTestId(
      SSO_TEAMS_GRANT_NOTE_TEST_ID,
    );

    expect(note).toHaveAttribute("role", "note");
    expect(note).toHaveTextContent(
      "You can't add people to Owners through this provider: it gives more access than you have. Choose teams you could invite someone to, or ask a project owner to save this provider.",
    );
  });

  test("names several, in the project's order, and says they give more access", async () => {
    signIn(CALLERS[1]!);

    await renderNote([idOf(MEMBERS), idOf(OWNERS)]);

    expect(
      await screen.findByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).toHaveTextContent(
      "You can't add people to Owners, Members through this provider: they give more access than you have.",
    );
  });

  test("says nothing while every picked team is one the person could hand on", async () => {
    signIn(CALLERS[1]!);

    await renderNote([idOf(ADMIN), idOf(READERS)]);

    await waitFor(() => {
      expect(mockServer.lists.length).toBeGreaterThanOrEqual(2);
    });
    await act(async (): Promise<void> => {});

    expect(
      screen.queryByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("follows the picks as they change", async () => {
    signIn(CALLERS[1]!);

    const { rerender } = await renderNote([idOf(ADMIN)]);

    await waitFor(() => {
      expect(mockServer.lists.length).toBeGreaterThanOrEqual(2);
    });

    await act(async (): Promise<void> => {
      rerender([idOf(ADMIN), idOf(MEMBERS)]);
    });

    expect(
      await screen.findByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).toHaveTextContent("Members");

    await act(async (): Promise<void> => {
      rerender([idOf(ADMIN)]);
    });

    expect(
      screen.queryByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a project owner is never warned", async () => {
    signIn(CALLERS[0]!);

    await renderNote(PROJECT_TEAMS.map(idOf));

    await waitFor(() => {
      expect(mockServer.lists.length).toBeGreaterThanOrEqual(2);
    });
    await act(async (): Promise<void> => {});

    expect(
      screen.queryByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says nothing when the teams cannot be read: the server explains on Save", async () => {
    signIn(CALLERS[1]!);
    mockServer.failLists = true;

    await renderNote([idOf(OWNERS)]);
    await act(async (): Promise<void> => {});

    expect(
      screen.queryByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says nothing, and reads nothing, outside a project", async () => {
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    signIn(CALLERS[1]!);

    await renderNote([idOf(OWNERS)]);
    await act(async (): Promise<void> => {});

    expect(mockServer.lists).toEqual([]);
    expect(
      screen.queryByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("getSsoTeamsGrantNote reads the form's Teams value", async () => {
    signIn(CALLERS[1]!);

    await act(async (): Promise<void> => {
      render(<>{getSsoTeamsGrantNote({ teams: [idOf(OWNERS)] })}</>);
    });

    expect(
      await screen.findByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).toHaveTextContent("Owners");
  });
});

/*
 * Through the real provider form, with only the network stubbed: the note
 * sits under Teams on the Sign-in step.
 */
describe("in the SAML provider form", () => {
  async function renderForm(data: {
    formType: FormType;
    initialValues?: FormValues<ProjectSSO> | undefined;
  }): Promise<void> {
    await act(async (): Promise<void> => {
      render(
        <ModelForm<ProjectSSO>
          modelType={ProjectSSO}
          id="saml-provider-form"
          name="Settings > Project SSO"
          fields={getSamlProviderFormFields<ProjectSSO>({
            withTeams: true,
            getTeamsFooterElement: getSsoTeamsGrantNote,
          })}
          steps={getSsoProviderFormSteps<ProjectSSO>()}
          formType={data.formType}
          modelIdToEdit={
            data.formType === FormType.Update ? PROVIDER_ID : undefined
          }
          initialValues={data.initialValues}
          onSuccess={(): void => {
            // Not asserted on.
          }}
          submitButtonText={
            data.formType === FormType.Create ? "Create SSO" : "Save Changes"
          }
          disableAutofocus={true}
        />,
      );
    });

    await screen.findByRole("navigation", { name: "Progress" });
    await act(async (): Promise<void> => {});
  }

  async function goToSignIn(): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("form-next-button"));
    });
  }

  test("a project admin who starts a provider on Owners is told on Sign-in", async () => {
    signIn(CALLERS[1]!);

    await renderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [idOf(OWNERS)],
      } as unknown as FormValues<ProjectSSO>,
    });

    // Not on the Provider step: Teams is on Sign-in.
    expect(
      screen.queryByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.change(screen.getByPlaceholderText("Okta"), {
        target: { value: "Okta" },
      });
      fireEvent.change(
        screen.getByPlaceholderText("https://yourapp.example.com/apps/appId"),
        { target: { value: "https://idp.example.com/sso" } },
      );
      fireEvent.change(screen.getByPlaceholderText("https://example.com"), {
        target: { value: "https://idp.example.com" },
      });
      fireEvent.change(
        screen.getByPlaceholderText("Paste in your x509 certificate here."),
        { target: { value: "certificate" } },
      );
    });

    await goToSignIn();

    expect(
      await screen.findByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).toHaveTextContent("You can't add people to Owners through this provider");
  });

  test("editing a provider whose teams give more access than the editor has says so", async () => {
    signIn(CALLERS[1]!);
    mockServer.record = {
      _id: PROVIDER_ID.toString(),
      name: "Okta",
      signOnURL: "https://idp.example.com/sso",
      issuerURL: "https://idp.example.com",
      publicCertificate: "certificate",
      signatureMethod: "RSA-SHA256",
      digestMethod: "SHA256",
      description: "Sign in with Okta",
      isEnabled: true,
      teams: [{ _id: idOf(MEMBERS) }],
    };

    await renderForm({ formType: FormType.Update });
    await goToSignIn();

    expect(
      await screen.findByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).toHaveTextContent("You can't add people to Members through this provider");
  });

  test("a project owner sees no note", async () => {
    signIn(CALLERS[0]!);

    await renderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [idOf(OWNERS), idOf(MEMBERS)],
      } as unknown as FormValues<ProjectSSO>,
    });

    await act(async (): Promise<void> => {
      fireEvent.change(screen.getByPlaceholderText("Okta"), {
        target: { value: "Okta" },
      });
      fireEvent.change(
        screen.getByPlaceholderText("https://yourapp.example.com/apps/appId"),
        { target: { value: "https://idp.example.com/sso" } },
      );
      fireEvent.change(screen.getByPlaceholderText("https://example.com"), {
        target: { value: "https://idp.example.com" },
      });
      fireEvent.change(
        screen.getByPlaceholderText("Paste in your x509 certificate here."),
        { target: { value: "certificate" } },
      );
    });

    await goToSignIn();

    await waitFor(() => {
      expect(
        mockServer.lists.filter((request: MockListRequest): boolean => {
          return request.modelType === TeamPermission;
        }).length,
      ).toBeGreaterThanOrEqual(1);
    });
    await act(async (): Promise<void> => {});

    expect(screen.getByText("Teams")).toBeVisible();
    expect(
      screen.queryByTestId(SSO_TEAMS_GRANT_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
