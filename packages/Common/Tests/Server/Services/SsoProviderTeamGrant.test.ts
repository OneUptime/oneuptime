import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TEAMS ON AN SSO OR SCIM PROVIDER ARE TEAMS THE PERSON SAVING IT COULD
 * GRANT.
 *
 * Someone who signs in with a project's SAML or OIDC provider for the first
 * time joins its teams; a SCIM connection adds people to its default teams
 * and, through its Groups endpoints, to any team. So saving a provider meets
 * the ceiling an invitation meets (Server/Utils/SsoProviderTeamGrant):
 *
 *   - SAML and OIDC: every team the provider holds after the save - the
 *     teams the save writes, or the ones it has when the save leaves them
 *     alone;
 *   - SCIM: every team in the project;
 *   - teams of another project are refused, whoever saves;
 *   - root and master admins are not weighed.
 *
 * These run the real create and update hooks of ProjectSsoService,
 * ProjectOidcService and ProjectSCIMService, and the real ceiling
 * (TeamPermissionService.assertCanGrantPermission), for a matrix of callers
 * and teams. Only the database is stubbed: the project's teams and their
 * permission rows, and the providers an update finds, live in memory below.
 */

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here hashes passwords.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import Label from "../../../Models/DatabaseModels/Label";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../Server/Types/Database/Permissions/BillingPermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Select from "../../../Server/Types/Database/Select";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SsoProviderTeamGrant, {
  MAX_REFUSED_TEAM_NAMES,
  SCIM_SAVE_REFUSAL_MESSAGE,
  SsoProviderKind,
  TEAMS_NOT_IN_PROJECT_MESSAGE,
  TEAMS_NOT_REFERENCES_MESSAGE,
  TEAMS_WITHOUT_PROJECT_MESSAGE,
  getProviderTeamsRefusalMessage,
  joinTeamNames,
} from "../../../Server/Utils/SsoProviderTeamGrant";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000003");
const FRONTEND_LABEL_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000004",
);
const PROVIDER_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000005",
);

/*
 * ---------------------------------------------------------------------------
 * The project's teams, oldest first, and their permission rows.
 * ---------------------------------------------------------------------------
 */

interface FakeRow {
  permission: Permission;
  scope?: PermissionScope | undefined;
  labelIds?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
}

interface FakeTeam {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  rows: Array<FakeRow>;
}

function fakeTeam(
  idSuffix: string,
  name: string,
  rows: Array<FakeRow>,
  projectId: ObjectID = PROJECT_ID,
): FakeTeam {
  return {
    id: new ObjectID(`5e000000-0000-4000-8000-0000000001${idSuffix}`),
    projectId: projectId,
    name: name,
    rows: rows,
  };
}

const OWNERS: FakeTeam = fakeTeam("10", "Owners", [
  { permission: Permission.ProjectOwner, scope: PermissionScope.All },
]);
const ADMIN: FakeTeam = fakeTeam("11", "Admin", [
  { permission: Permission.ProjectAdmin, scope: PermissionScope.All },
]);
const MEMBERS: FakeTeam = fakeTeam("12", "Members", [
  { permission: Permission.ProjectMember, scope: PermissionScope.All },
]);
// Project Member, for what carries the Frontend label only.
const FRONTEND: FakeTeam = fakeTeam("13", "Frontend", [
  {
    permission: Permission.ProjectMember,
    scope: PermissionScope.Labels,
    labelIds: [FRONTEND_LABEL_ID],
  },
]);
// No permission rows at all: anyone may hand it on.
const READERS: FakeTeam = fakeTeam("14", "Readers", []);
/*
 * A block row is handed on with the team too, and weighed like an allow
 * (TeamPermissionService.assertCanGrantTeamPermissions).
 */
const RESPONDERS: FakeTeam = fakeTeam("15", "Responders", [
  { permission: Permission.ProjectMember, scope: PermissionScope.All },
  {
    permission: Permission.DeleteProjectIncident,
    scope: PermissionScope.All,
    isBlockPermission: true,
  },
]);
const OTHER_PROJECTS_TEAM: FakeTeam = fakeTeam(
  "16",
  "Another project's team",
  [{ permission: Permission.Viewer, scope: PermissionScope.All }],
  OTHER_PROJECT_ID,
);

const PROJECT_TEAMS: Array<FakeTeam> = [
  OWNERS,
  ADMIN,
  MEMBERS,
  FRONTEND,
  READERS,
  RESPONDERS,
];

const ALL_TEAMS: Array<FakeTeam> = [...PROJECT_TEAMS, OTHER_PROJECTS_TEAM];

/*
 * ---------------------------------------------------------------------------
 * The callers: who saves the provider, and what they may hand on.
 * ---------------------------------------------------------------------------
 */

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
  rows?: Array<UserPermission> | undefined;
  isMasterAdmin?: boolean | undefined;
  isRoot?: boolean | undefined;
  // The project's teams this caller could put on a SAML or OIDC provider.
  grantable: Array<FakeTeam>;
}

const SSO_EDITOR_ROWS: Array<UserPermission> = [
  allow(Permission.CreateProjectSSO),
  allow(Permission.EditProjectSSO),
  allow(Permission.ReadProjectSSO),
];

const CALLERS: Array<Caller> = [
  {
    name: "a project owner",
    rows: [allow(Permission.ProjectOwner)],
    grantable: PROJECT_TEAMS,
  },
  {
    name: "a project owner blocked from Project Owner, who is also an admin and a member",
    rows: [
      allow(Permission.ProjectOwner),
      block(Permission.ProjectOwner),
      allow(Permission.ProjectAdmin),
      allow(Permission.ProjectMember),
    ],
    grantable: [ADMIN, MEMBERS, FRONTEND, READERS],
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
    name: "a custom role that edits SSO and holds Project Member",
    rows: [...SSO_EDITOR_ROWS, allow(Permission.ProjectMember)],
    grantable: [MEMBERS, FRONTEND, READERS],
  },
  {
    name: "a custom role that edits SSO and holds Project Member for the Frontend label only",
    rows: [
      ...SSO_EDITOR_ROWS,
      allow(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [FRONTEND_LABEL_ID],
      }),
    ],
    grantable: [FRONTEND, READERS],
  },
  {
    name: "a custom role that edits SSO, holds Project Member and is blocked from it on Frontend",
    rows: [
      ...SSO_EDITOR_ROWS,
      allow(Permission.ProjectMember),
      block(Permission.ProjectMember, [FRONTEND_LABEL_ID]),
    ],
    grantable: [READERS],
  },
  {
    name: "a custom role that edits SSO and also holds Delete Incident",
    rows: [
      ...SSO_EDITOR_ROWS,
      allow(Permission.ProjectMember),
      allow(Permission.DeleteProjectIncident),
    ],
    grantable: [MEMBERS, FRONTEND, READERS, RESPONDERS],
  },
  {
    name: "a master admin",
    isMasterAdmin: true,
    grantable: PROJECT_TEAMS,
  },
  {
    name: "the server itself (root)",
    isRoot: true,
    grantable: PROJECT_TEAMS,
  },
];

function propsFor(
  caller: Caller,
  tenantId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  if (caller.isRoot) {
    return { isRoot: true };
  }

  if (caller.isMasterAdmin) {
    return {
      userId: USER_ID,
      tenantId: tenantId,
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
      currentPlan: PlanType.Scale,
    };
  }

  return {
    userId: USER_ID,
    tenantId: tenantId,
    userType: UserType.User,
    currentPlan: PlanType.Scale,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [tenantId],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    },
    userTenantAccessPermission: {
      [tenantId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: tenantId,
        permissions: (caller.rows || []).map(
          (row: UserPermission): UserPermission => {
            return { ...row, labelIds: [...row.labelIds] };
          },
        ),
      },
    },
  };
}

function callerNamed(name: string): Caller {
  const caller: Caller | undefined = CALLERS.find((candidate: Caller) => {
    return candidate.name === name;
  });

  if (!caller) {
    throw new Error(`No caller named ${name}`);
  }

  return caller;
}

const OWNER: Caller = callerNamed("a project owner");
const ADMIN_CALLER: Caller = callerNamed("a project admin");
const ADMIN_IN_MEMBERS: Caller = callerNamed(
  "a project admin who is also in Members",
);
const MASTER_ADMIN: Caller = callerNamed("a master admin");
const ROOT: Caller = callerNamed("the server itself (root)");

/*
 * ---------------------------------------------------------------------------
 * The database, in memory.
 * ---------------------------------------------------------------------------
 */

// What QueryHelper.any hands a query here: the ids, readable by the stubs.
interface AnyOf {
  anyOf: Array<string>;
}

function idsIn(value: unknown): Array<string> | null {
  if (value === undefined || value === null) {
    return null;
  }

  if ((value as AnyOf).anyOf) {
    return (value as AnyOf).anyOf;
  }

  return [String(value).toLowerCase()];
}

function sameId(left: unknown, right: unknown): boolean {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function toTeamModel(team: FakeTeam): Team {
  const model: Team = new Team(team.id);
  model.projectId = team.projectId;
  model.name = team.name;
  return model;
}

function toPermissionModels(team: FakeTeam): Array<TeamPermission> {
  return team.rows.map((row: FakeRow): TeamPermission => {
    const model: TeamPermission = new TeamPermission();
    model.id = ObjectID.generate();
    model.teamId = team.id;
    model.projectId = team.projectId;
    model.permission = row.permission;
    model.isBlockPermission = row.isBlockPermission || false;
    if (row.scope) {
      model.scope = row.scope;
    }
    model.labels = (row.labelIds || []).map((labelId: ObjectID): Label => {
      return new Label(labelId);
    });
    return model;
  });
}

interface FakeProvider {
  id: ObjectID;
  projectId: ObjectID;
  teams: Array<FakeTeam>;
  // What the provider holds in its other columns.
  fields?: Record<string, unknown> | undefined;
}

let providers: Array<FakeProvider> = [];

interface StubbedDatabase {
  teamReads: ReturnType<typeof getJestSpyOn>;
  permissionReads: ReturnType<typeof getJestSpyOn>;
  providerReads: Map<string, ReturnType<typeof getJestSpyOn>>;
  createPermissionChecks: ReturnType<typeof getJestSpyOn>;
  updatePermissionChecks: ReturnType<typeof getJestSpyOn>;
}

let database: StubbedDatabase;

function stubProviderReads(
  service: unknown,
  modelType: { new (): BaseModel },
): ReturnType<typeof getJestSpyOn> {
  return getJestSpyOn(service, "findAllBy").mockImplementation(
    async (findBy: unknown): Promise<Array<BaseModel>> => {
      const query: Record<string, unknown> = (
        findBy as { query: Record<string, unknown> }
      ).query;
      const ids: Array<string> | null = idsIn(query["_id"]);

      return providers
        .filter((provider: FakeProvider): boolean => {
          return (
            (!ids || ids.includes(provider.id.toString().toLowerCase())) &&
            (query["projectId"] === undefined ||
              sameId(query["projectId"], provider.projectId))
          );
        })
        .map((provider: FakeProvider): BaseModel => {
          const model: BaseModel = new modelType();
          Object.assign(model, provider.fields || {});
          model.id = provider.id;
          (model as unknown as Record<string, unknown>)["projectId"] =
            provider.projectId;
          (model as unknown as Record<string, unknown>)["teams"] =
            provider.teams.map(toTeamModel);
          return model;
        });
    },
  );
}

function teamPermissionRowsFor(findBy: unknown): Array<TeamPermission> {
  const query: Record<string, unknown> = (
    findBy as { query: Record<string, unknown> }
  ).query;
  const teamIds: Array<string> | null = idsIn(query["teamId"]);

  return ALL_TEAMS.filter((team: FakeTeam): boolean => {
    return (
      sameId(team.projectId, query["projectId"]) &&
      (!teamIds || teamIds.includes(team.id.toString().toLowerCase()))
    );
  }).flatMap(toPermissionModels);
}

beforeEach(() => {
  providers = [];

  getJestSpyOn(QueryHelper, "any").mockImplementation(
    (values: unknown): AnyOf => {
      return {
        anyOf: (values as Array<unknown>).map((value: unknown): string => {
          return String(value).toLowerCase();
        }),
      };
    },
  );

  const teamReads: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    TeamService,
    "findAllBy",
  ).mockImplementation(async (findBy: unknown): Promise<Array<Team>> => {
    const query: Record<string, unknown> = (
      findBy as { query: Record<string, unknown> }
    ).query;
    const ids: Array<string> | null = idsIn(query["_id"]);

    return ALL_TEAMS.filter((team: FakeTeam): boolean => {
      return (
        sameId(team.projectId, query["projectId"]) &&
        (!ids || ids.includes(team.id.toString().toLowerCase()))
      );
    }).map(toTeamModel);
  });

  // A team's rows, read the same way for an invitation and for a provider.
  const permissionReads: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    TeamPermissionService,
    "findBy",
  ).mockImplementation(async (findBy: unknown) => {
    return teamPermissionRowsFor(findBy);
  });

  /*
   * The create's own permission check (every request makes it): here it lets
   * the create through, as it does for a caller allowed to add providers.
   */
  const createPermissionChecks: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    ModelPermission,
    "checkCreatePermissions",
  ).mockImplementation((): void => {
    return undefined;
  });

  /*
   * The update's own permission check (exercised by every request): here it
   * lets the update through, scoped to the request's project, as it does for
   * a caller allowed to edit providers.
   */
  const updatePermissionChecks: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    ModelPermission,
    "checkUpdateQueryPermissions",
  ).mockImplementation(
    async (
      _modelType: unknown,
      query: unknown,
      _data: unknown,
      props: unknown,
    ): Promise<unknown> => {
      return {
        ...(query as Record<string, unknown>),
        projectId: (props as DatabaseCommonInteractionProps).tenantId,
      };
    },
  );

  /*
   * Switching a provider off also asks whether its project keeps a way in
   * (Utils/ProjectSsoProviderChanges): here neither the project nor the
   * server requires SSO, so any provider may be switched off.
   * ProjectSsoProviderChanges.test covers a project that does.
   */
  getJestSpyOn(ProjectService, "findOneById").mockImplementation(
    async (): Promise<Project> => {
      const project: Project = new Project();
      project.id = PROJECT_ID;
      project.requireSsoForLogin = false;
      return project;
    },
  );

  getJestSpyOn(GlobalConfigService, "findOneBy").mockImplementation(
    (async () => {
      const config: GlobalConfig = new GlobalConfig();
      config.requireSsoForLogin = false;
      return config;
    }) as never,
  );

  database = {
    teamReads,
    permissionReads,
    providerReads: new Map<string, ReturnType<typeof getJestSpyOn>>([
      ["saml", stubProviderReads(ProjectSsoService, ProjectSSO)],
      ["oidc", stubProviderReads(ProjectOidcService, ProjectOIDC)],
      ["scim", stubProviderReads(ProjectSCIMService, ProjectSCIM)],
    ]),
    createPermissionChecks,
    updatePermissionChecks,
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * Running the real hooks.
 * ---------------------------------------------------------------------------
 */

type HookService = Record<
  string,
  (...args: Array<unknown>) => Promise<unknown>
>;

function callHook(
  service: unknown,
  hook: string,
  ...args: Array<unknown>
): Promise<unknown> {
  return (service as HookService)[hook]!.apply(service, args);
}

interface ProviderCase {
  key: string;
  label: string;
  kind: SsoProviderKind;
  service: unknown;
  make: () => BaseModel;
}

const SAML: ProviderCase = {
  key: "saml",
  label: "a SAML provider (Settings > SSO)",
  kind: SsoProviderKind.Saml,
  service: ProjectSsoService,
  make: (): BaseModel => {
    const provider: ProjectSSO = new ProjectSSO();
    provider.projectId = PROJECT_ID;
    provider.name = "Okta";
    provider.issuerURL = "http://www.okta.com/exk1";
    provider.publicCertificate = "certificate";
    return provider;
  },
};

const OIDC: ProviderCase = {
  key: "oidc",
  label: "an OIDC provider (Settings > OIDC)",
  kind: SsoProviderKind.Oidc,
  service: ProjectOidcService,
  make: (): BaseModel => {
    const provider: ProjectOIDC = new ProjectOIDC();
    provider.projectId = PROJECT_ID;
    provider.name = "Okta";
    provider.issuerURL = "https://dev-123456.okta.com/oauth2/default";
    provider.clientId = "client-id";
    provider.clientSecret = "client-secret";
    return provider;
  },
};

const SCIM: ProviderCase = {
  key: "scim",
  label: "a SCIM connection (Settings > SCIM)",
  kind: SsoProviderKind.Scim,
  service: ProjectSCIMService,
  make: (): BaseModel => {
    const connection: ProjectSCIM = new ProjectSCIM();
    connection.projectId = PROJECT_ID;
    connection.name = "Okta SCIM";
    return connection;
  },
};

function withTeams(provider: BaseModel, teams: Array<FakeTeam>): BaseModel {
  (provider as unknown as Record<string, unknown>)["teams"] =
    teams.map(toTeamModel);
  return provider;
}

async function create(
  providerCase: ProviderCase,
  teams: Array<FakeTeam>,
  props: DatabaseCommonInteractionProps,
): Promise<OnCreate<BaseModel>> {
  const createBy: CreateBy<BaseModel> = {
    data: withTeams(providerCase.make(), teams),
    props: props,
  };

  return (await callHook(
    providerCase.service,
    "onBeforeCreate",
    createBy,
  )) as OnCreate<BaseModel>;
}

function storeProvider(
  teams: Array<FakeTeam>,
  fields?: Record<string, unknown> | undefined,
): FakeProvider {
  const provider: FakeProvider = {
    id: PROVIDER_ID,
    projectId: PROJECT_ID,
    teams: teams,
    fields: fields,
  };
  providers.push(provider);
  return provider;
}

async function update(
  providerCase: ProviderCase,
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<OnUpdate<BaseModel>> {
  const updateBy: UpdateBy<BaseModel> = {
    query: { _id: PROVIDER_ID.toString() },
    data: data,
    props: props,
    skip: 0,
    limit: 1,
  } as unknown as UpdateBy<BaseModel>;

  return (await callHook(
    providerCase.service,
    "onBeforeUpdate",
    updateBy,
  )) as OnUpdate<BaseModel>;
}

async function refusal(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err as Error;
  }
}

function teamNames(teams: Array<FakeTeam>): Array<string> {
  return teams.map((team: FakeTeam): string => {
    return team.name;
  });
}

function notGrantable(caller: Caller): Array<FakeTeam> {
  return PROJECT_TEAMS.filter((team: FakeTeam): boolean => {
    return !caller.grantable.includes(team);
  });
}

/*
 * ---------------------------------------------------------------------------
 * SAML and OIDC providers.
 * ---------------------------------------------------------------------------
 */

describe.each([SAML, OIDC])("$label", (providerCase: ProviderCase) => {
  describe.each(CALLERS)("created by $name", (caller: Caller) => {
    test.each(
      PROJECT_TEAMS.map((team: FakeTeam): [string, FakeTeam] => {
        return [team.name, team];
      }),
    )("with %s as its only team", async (_name: string, team: FakeTeam) => {
      const error: Error | null = await refusal(
        create(providerCase, [team], propsFor(caller)),
      );

      if (caller.grantable.includes(team)) {
        expect(error).toBeNull();
        return;
      }

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toBe(
        getProviderTeamsRefusalMessage({
          kind: providerCase.kind,
          teamNames: [team.name],
        }),
      );
    });

    test("with every team of the project: refused, naming exactly the teams beyond the caller's access, oldest first", async () => {
      const beyond: Array<FakeTeam> = notGrantable(caller);
      const error: Error | null = await refusal(
        create(providerCase, [...PROJECT_TEAMS].reverse(), propsFor(caller)),
      );

      if (beyond.length === 0) {
        expect(error).toBeNull();
        return;
      }

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toBe(
        getProviderTeamsRefusalMessage({
          kind: providerCase.kind,
          teamNames: teamNames(beyond),
        }),
      );
    });
  });

  test("the refusal says what to do instead", async () => {
    const error: Error | null = await refusal(
      create(providerCase, [OWNERS], propsFor(ADMIN_CALLER)),
    );

    expect(error?.message).toContain("adds people to Owners");
    expect(error?.message).toContain("Owners gives more access than you have");
    expect(error?.message).toContain(
      "Choose teams you could invite someone to, or ask a project owner to save it.",
    );
  });

  test("a team of another project is refused, even for a project owner", async () => {
    const error: Error | null = await refusal(
      create(providerCase, [MEMBERS, OTHER_PROJECTS_TEAM], propsFor(OWNER)),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(TEAMS_NOT_IN_PROJECT_MESSAGE);
  });

  test("a team that does not exist is refused", async () => {
    const provider: BaseModel = providerCase.make();
    (provider as unknown as Record<string, unknown>)["teams"] = [
      { _id: "5e000000-0000-4000-8000-0000000009ff" },
    ];

    const error: Error | null = await refusal(
      callHook(providerCase.service, "onBeforeCreate", {
        data: provider,
        props: propsFor(OWNER),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(TEAMS_NOT_IN_PROJECT_MESSAGE);
  });

  test("a team given as anything but its id is refused", async () => {
    const provider: BaseModel = providerCase.make();
    (provider as unknown as Record<string, unknown>)["teams"] = [
      { name: "Owners" },
    ];

    const error: Error | null = await refusal(
      callHook(providerCase.service, "onBeforeCreate", {
        data: provider,
        props: propsFor(OWNER),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(TEAMS_NOT_REFERENCES_MESSAGE);
  });

  test.each([
    [
      "models",
      (team: FakeTeam): unknown => {
        return toTeamModel(team);
      },
    ],
    [
      "{ _id } objects",
      (team: FakeTeam): unknown => {
        return { _id: team.id.toString() };
      },
    ],
    [
      "id strings",
      (team: FakeTeam): unknown => {
        return team.id.toString();
      },
    ],
    [
      "upper-case ids",
      (team: FakeTeam): unknown => {
        return team.id.toString().toUpperCase();
      },
    ],
  ])(
    "teams sent as %s are weighed the same",
    async (_shape: string, toValue: (team: FakeTeam) => unknown) => {
      for (const [teams, isAccepted] of [
        [[ADMIN], true],
        [[ADMIN, MEMBERS], false],
      ] as Array<[Array<FakeTeam>, boolean]>) {
        const provider: BaseModel = providerCase.make();
        (provider as unknown as Record<string, unknown>)["teams"] =
          teams.map(toValue);

        const error: Error | null = await refusal(
          callHook(providerCase.service, "onBeforeCreate", {
            data: provider,
            props: propsFor(ADMIN_CALLER),
          }),
        );

        expect({ teams: teamNames(teams), refused: Boolean(error) }).toEqual({
          teams: teamNames(teams),
          refused: !isAccepted,
        });
      }
    },
  );

  test("a provider with no teams has nothing to weigh", async () => {
    await expect(
      create(providerCase, [], propsFor(ADMIN_CALLER)),
    ).resolves.toBeDefined();
    expect(database.permissionReads).not.toHaveBeenCalled();
  });

  test("a project owner's teams are checked to be the project's, and nothing more is read", async () => {
    await create(providerCase, [OWNERS, MEMBERS], propsFor(OWNER));

    expect(database.teamReads).toHaveBeenCalledTimes(1);
    expect(database.permissionReads).not.toHaveBeenCalled();
  });

  test.each([
    ["a master admin", MASTER_ADMIN],
    ["root", ROOT],
  ])(
    "%s is not weighed, but its teams must still be the project's own",
    async (_name: string, caller: Caller) => {
      await expect(
        create(providerCase, [OWNERS, MEMBERS], propsFor(caller)),
      ).resolves.toBeDefined();

      expect(database.createPermissionChecks).not.toHaveBeenCalled();
      expect(database.permissionReads).not.toHaveBeenCalled();
      expect(database.teamReads).toHaveBeenCalledTimes(1);

      const error: Error | null = await refusal(
        create(providerCase, [OWNERS, OTHER_PROJECTS_TEAM], propsFor(caller)),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(TEAMS_NOT_IN_PROJECT_MESSAGE);
    },
  );

  test("the create's own permission check comes first, and a refusal there reads nothing", async () => {
    database.createPermissionChecks.mockImplementation((): void => {
      throw new NotAuthorizedException("You may not add providers.");
    });

    const error: Error | null = await refusal(
      create(providerCase, [OWNERS], propsFor(ADMIN_CALLER)),
    );

    expect(error?.message).toBe("You may not add providers.");
    expect(database.teamReads).not.toHaveBeenCalled();
    expect(database.permissionReads).not.toHaveBeenCalled();
  });

  test("the create's own permission check is asked with the provider being created", async () => {
    await create(providerCase, [ADMIN], propsFor(ADMIN_CALLER));

    expect(database.createPermissionChecks).toHaveBeenCalledTimes(1);

    const [modelType, provider, props] = database.createPermissionChecks.mock
      .calls[0] as [unknown, BaseModel, DatabaseCommonInteractionProps];

    expect(modelType).toBe(providerCase.make().constructor);
    expect(provider).toBeInstanceOf(providerCase.make().constructor);
    expect(props.tenantId).toBe(PROJECT_ID);
  });

  test("a team id that is no id at all is refused before anything is read", async () => {
    for (const value of ["abc", { _id: "not-a-uuid" }]) {
      const provider: BaseModel = providerCase.make();
      (provider as unknown as Record<string, unknown>)["teams"] = [value];

      const error: Error | null = await refusal(
        callHook(providerCase.service, "onBeforeCreate", {
          data: provider,
          props: propsFor(OWNER),
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(TEAMS_NOT_REFERENCES_MESSAGE);
    }

    expect(database.teamReads).not.toHaveBeenCalled();
  });

  test("teams without a project to belong to are refused", async () => {
    const provider: BaseModel = providerCase.make();
    delete (provider as unknown as Record<string, unknown>)["projectId"];
    (provider as unknown as Record<string, unknown>)["teams"] = [
      toTeamModel(OWNERS),
    ];

    const error: Error | null = await refusal(
      callHook(providerCase.service, "onBeforeCreate", {
        data: provider,
        props: propsFor(ROOT),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(TEAMS_WITHOUT_PROJECT_MESSAGE);
  });

  test("the create still fills in the provider's defaults", async () => {
    const result: OnCreate<BaseModel> = await create(
      providerCase,
      [ADMIN],
      propsFor(ADMIN_CALLER),
    );

    expect(
      (result.createBy.data as unknown as Record<string, unknown>)[
        "description"
      ],
    ).toBe("Sign in with Okta");
  });

  describe("an update", () => {
    test("that writes teams weighs the new ones", async () => {
      storeProvider([ADMIN]);

      await expect(
        update(
          providerCase,
          { teams: [toTeamModel(ADMIN), toTeamModel(READERS)] },
          propsFor(ADMIN_CALLER),
        ),
      ).resolves.toBeDefined();

      const error: Error | null = await refusal(
        update(
          providerCase,
          { teams: [{ _id: OWNERS.id.toString() }] },
          propsFor(ADMIN_CALLER),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toBe(
        getProviderTeamsRefusalMessage({
          kind: providerCase.kind,
          teamNames: ["Owners"],
        }),
      );
    });

    test("that leaves the teams alone weighs the ones the provider has: changing who signs in decides who joins them", async () => {
      storeProvider([MEMBERS]);

      for (const data of [
        { name: "Renamed" },
        { issuerURL: "https://idp.example.com/somewhere-else" },
        { isEnabled: true },
      ]) {
        const error: Error | null = await refusal(
          update(providerCase, data, propsFor(ADMIN_CALLER)),
        );

        expect({ data, error: error?.message }).toEqual({
          data,
          error: getProviderTeamsRefusalMessage({
            kind: providerCase.kind,
            teamNames: ["Members"],
          }),
        });
      }

      // Someone who could invite people to Members may.
      await expect(
        update(providerCase, { name: "Renamed" }, propsFor(ADMIN_IN_MEMBERS)),
      ).resolves.toBeDefined();
    });

    test("that removes every team is accepted from anyone allowed to edit the provider", async () => {
      storeProvider([OWNERS, MEMBERS]);

      await expect(
        update(providerCase, { teams: [] }, propsFor(ADMIN_CALLER)),
      ).resolves.toBeDefined();
    });

    test("that keeps only teams the caller could grant is accepted", async () => {
      storeProvider([OWNERS, ADMIN]);

      await expect(
        update(
          providerCase,
          { teams: [toTeamModel(ADMIN)] },
          propsFor(ADMIN_CALLER),
        ),
      ).resolves.toBeDefined();
    });

    test("that moves a team to another project's is refused, even for a project owner", async () => {
      storeProvider([MEMBERS]);

      const error: Error | null = await refusal(
        update(
          providerCase,
          { teams: [toTeamModel(OTHER_PROJECTS_TEAM)] },
          propsFor(OWNER),
        ),
      );

      expect(error).toBeInstanceOf(BadDataException);
    });

    test("is checked by the update's own permissions first, and a refusal there reads nothing", async () => {
      storeProvider([MEMBERS]);

      database.updatePermissionChecks.mockImplementation(async () => {
        throw new NotAuthorizedException("You may not edit this provider.");
      });

      const error: Error | null = await refusal(
        update(providerCase, { name: "Renamed" }, propsFor(ADMIN_CALLER)),
      );

      expect(error?.message).toBe("You may not edit this provider.");
      expect(
        database.providerReads.get(providerCase.key),
      ).not.toHaveBeenCalled();
      expect(database.teamReads).not.toHaveBeenCalled();
    });

    test("reads the provider's teams by its id alone, so a filter cannot hide some of them", async () => {
      storeProvider([ADMIN]);

      await update(providerCase, { name: "Renamed" }, propsFor(ADMIN_CALLER));

      const reads: Array<Array<unknown>> = database.providerReads.get(
        providerCase.key,
      )!.mock.calls as Array<Array<unknown>>;

      expect(reads).toHaveLength(2);
      // The rows the caller may update, by the scoped query...
      expect(
        (reads[0]![0] as { query: Record<string, unknown> }).query,
      ).toEqual({
        _id: PROVIDER_ID.toString(),
        projectId: PROJECT_ID,
      });
      /*
       * ...then each of them again, by id only, with its teams and what it
       * holds in every column the update writes.
       */
      expect(
        (reads[1]![0] as { query: Record<string, unknown> }).query,
      ).toEqual({
        _id: { anyOf: [PROVIDER_ID.toString().toLowerCase()] },
      });
      expect(
        (reads[1]![0] as { select: Record<string, unknown> }).select,
      ).toEqual({
        _id: true,
        projectId: true,
        teams: { _id: true },
        name: true,
      });
    });

    test("holds the write to exactly the rows that were weighed", async () => {
      storeProvider([ADMIN]);

      const result: OnUpdate<BaseModel> = await update(
        providerCase,
        { name: "Renamed" },
        propsFor(ADMIN_CALLER),
      );

      expect(result.updateBy.query).toEqual({
        _id: { anyOf: [PROVIDER_ID.toString().toLowerCase()] },
        projectId: PROJECT_ID,
      });
      expect(result.updateBy.skip).toBe(0);
    });

    test("that matches no provider weighs nothing and writes nothing", async () => {
      const result: OnUpdate<BaseModel> = await update(
        providerCase,
        { teams: [toTeamModel(OWNERS)] },
        propsFor(ADMIN_CALLER),
      );

      expect(result.updateBy.query).toEqual({
        _id: { anyOf: [] },
        projectId: PROJECT_ID,
      });
      expect(database.teamReads).not.toHaveBeenCalled();
    });

    test.each([
      ["a master admin", MASTER_ADMIN],
      ["root", ROOT],
    ])(
      "by %s that leaves the teams alone reads nothing, and is left exactly as asked",
      async (_name: string, caller: Caller) => {
        storeProvider([OWNERS]);

        const result: OnUpdate<BaseModel> = await update(
          providerCase,
          { name: "Renamed" },
          propsFor(caller),
        );

        expect(result.updateBy.query).toEqual({
          _id: PROVIDER_ID.toString(),
        });
        expect(database.updatePermissionChecks).not.toHaveBeenCalled();
        expect(
          database.providerReads.get(providerCase.key),
        ).not.toHaveBeenCalled();
        expect(database.teamReads).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["a master admin", MASTER_ADMIN],
      ["root", ROOT],
    ])(
      "by %s that writes teams is not weighed, but its teams must be the project's own",
      async (_name: string, caller: Caller) => {
        storeProvider([MEMBERS]);

        const result: OnUpdate<BaseModel> = await update(
          providerCase,
          { teams: [toTeamModel(OWNERS)] },
          propsFor(caller),
        );

        // Held to the rows whose project was checked.
        expect(result.updateBy.query).toEqual({
          _id: { anyOf: [PROVIDER_ID.toString().toLowerCase()] },
        });
        expect(result.updateBy.skip).toBe(0);
        expect(database.updatePermissionChecks).not.toHaveBeenCalled();
        expect(database.permissionReads).not.toHaveBeenCalled();

        const error: Error | null = await refusal(
          update(
            providerCase,
            { teams: [toTeamModel(OTHER_PROJECTS_TEAM)] },
            propsFor(caller),
          ),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error?.message).toBe(TEAMS_NOT_IN_PROJECT_MESSAGE);
      },
    );

    test.each([
      ["a master admin", MASTER_ADMIN],
      ["root", ROOT],
    ])(
      "by %s that writes teams to many providers checks each one's own project, and writes only those",
      async (_name: string, caller: Caller) => {
        const second: ObjectID = new ObjectID(
          "5e000000-0000-4000-8000-0000000002b1",
        );

        providers.push(
          { id: PROVIDER_ID, projectId: PROJECT_ID, teams: [READERS] },
          { id: second, projectId: PROJECT_ID, teams: [] },
        );

        const updateBy: UpdateBy<BaseModel> = {
          query: {},
          data: { teams: [toTeamModel(MEMBERS)] },
          props: propsFor(caller),
          skip: 5,
          limit: 10,
        } as unknown as UpdateBy<BaseModel>;

        const result: OnUpdate<BaseModel> = (await callHook(
          providerCase.service,
          "onBeforeUpdate",
          updateBy,
        )) as OnUpdate<BaseModel>;

        expect(result.updateBy.query).toEqual({
          _id: {
            anyOf: [
              PROVIDER_ID.toString().toLowerCase(),
              second.toString().toLowerCase(),
            ],
          },
        });
        // The rows were picked once, with the update's own window.
        expect(result.updateBy.skip).toBe(0);

        // A provider of another project among them: Members is not its team.
        providers.push({
          id: new ObjectID("5e000000-0000-4000-8000-0000000002b2"),
          projectId: OTHER_PROJECT_ID,
          teams: [],
        });

        const error: Error | null = await refusal(
          callHook(providerCase.service, "onBeforeUpdate", {
            query: {},
            data: { teams: [toTeamModel(MEMBERS)] },
            props: propsFor(caller),
            skip: 0,
            limit: 10,
          }),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error?.message).toBe(TEAMS_NOT_IN_PROJECT_MESSAGE);
      },
    );

    test("that only switches the provider off is accepted from anyone allowed to edit it, and reads no team", async () => {
      storeProvider([OWNERS], { name: "Okta", isEnabled: true });

      const result: OnUpdate<BaseModel> = await update(
        providerCase,
        { isEnabled: false },
        propsFor(ADMIN_CALLER),
      );

      expect(database.teamReads).not.toHaveBeenCalled();
      expect(database.permissionReads).not.toHaveBeenCalled();
      // Still held to the rows that were checked.
      expect(result.updateBy.query).toEqual({
        _id: { anyOf: [PROVIDER_ID.toString().toLowerCase()] },
        projectId: PROJECT_ID,
      });
    });

    test("that switches it off from the edit form, which sends every field, is accepted when nothing else changed", async () => {
      const stored: Record<string, unknown> = {
        name: "Okta",
        description: "Sign in with Okta",
        issuerURL: "https://idp.example.com/sso",
        isEnabled: true,
      };

      storeProvider([OWNERS, MEMBERS], stored);

      await expect(
        update(
          providerCase,
          {
            ...stored,
            _id: PROVIDER_ID.toString(),
            // The form holds the teams in its own order, as plain ids.
            teams: [
              { _id: MEMBERS.id.toString() },
              { _id: OWNERS.id.toString().toUpperCase() },
            ],
            isEnabled: false,
          },
          propsFor(ADMIN_CALLER),
        ),
      ).resolves.toBeDefined();
      expect(database.permissionReads).not.toHaveBeenCalled();
    });

    test("that switches it off and changes anything else, or switches it on, is weighed as usual", async () => {
      storeProvider([OWNERS], {
        name: "Okta",
        description: "Sign in with Okta",
        isEnabled: true,
      });

      for (const data of [
        { isEnabled: false, name: "Renamed" },
        { isEnabled: false, issuerURL: "https://idp.example.com/elsewhere" },
        { isEnabled: false, teams: [toTeamModel(OWNERS), toTeamModel(ADMIN)] },
        // A value that cannot be compared counts as a change.
        { isEnabled: false, description: { text: "Sign in with Okta" } },
        { isEnabled: true },
      ]) {
        const error: Error | null = await refusal(
          update(providerCase, data, propsFor(ADMIN_CALLER)),
        );

        expect({
          data,
          refused: error instanceof NotAuthorizedException,
        }).toEqual({
          data,
          refused: true,
        });
        expect(error?.message).toContain("Owners");
      }
    });

    test("that switches it off while writing a value that cannot be read as text is weighed as usual", async () => {
      // Two different values whose text says nothing of what they hold.
      storeProvider([OWNERS], {
        description: { lines: ["Sign in with Okta"] },
        isEnabled: true,
      });

      const error: Error | null = await refusal(
        update(
          providerCase,
          {
            isEnabled: false,
            description: { lines: ["Sign in somewhere else"] },
          },
          propsFor(ADMIN_CALLER),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    });

    test("that switches it off while giving text back with other line endings or space around it counts as nothing else changed", async () => {
      // As a browser gives back a value pasted with Windows line endings.
      storeProvider([OWNERS], {
        description: "Sign in\r\nwith Okta\r\n",
        name: " Okta",
        isEnabled: true,
      });

      await expect(
        update(
          providerCase,
          {
            isEnabled: false,
            description: "Sign in\nwith Okta",
            name: "Okta",
          },
          propsFor(ADMIN_CALLER),
        ),
      ).resolves.toBeDefined();

      // Text that reads differently is a change.
      const error: Error | null = await refusal(
        update(
          providerCase,
          { isEnabled: false, description: "Sign in\nwith Okta, today" },
          propsFor(ADMIN_CALLER),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    });

    test("of many providers weighs each project and set of teams once", async () => {
      providers.push(
        { id: PROVIDER_ID, projectId: PROJECT_ID, teams: [ADMIN] },
        {
          id: new ObjectID("5e000000-0000-4000-8000-0000000002a1"),
          projectId: PROJECT_ID,
          teams: [ADMIN],
        },
        {
          id: new ObjectID("5e000000-0000-4000-8000-0000000002a2"),
          projectId: PROJECT_ID,
          teams: [READERS],
        },
      );

      const updateBy: UpdateBy<BaseModel> = {
        query: {},
        data: { name: "Renamed" },
        props: propsFor(ADMIN_IN_MEMBERS),
        skip: 0,
        limit: 10,
      } as unknown as UpdateBy<BaseModel>;

      const result: OnUpdate<BaseModel> = (await callHook(
        providerCase.service,
        "onBeforeUpdate",
        updateBy,
      )) as OnUpdate<BaseModel>;

      // Two sets of teams: Admin (twice) and Readers.
      expect(database.teamReads).toHaveBeenCalledTimes(2);
      expect((result.updateBy.query as Record<string, unknown>)["_id"]).toEqual(
        {
          anyOf: [
            PROVIDER_ID.toString().toLowerCase(),
            "5e000000-0000-4000-8000-0000000002a1",
            "5e000000-0000-4000-8000-0000000002a2",
          ],
        },
      );
    });

    test("in the request's project spelled in upper case is weighed as usual", async () => {
      storeProvider([ADMIN]);

      const props: DatabaseCommonInteractionProps = propsFor(ADMIN_CALLER);
      const upperCaseTenant: ObjectID = new ObjectID(
        PROJECT_ID.toString().toUpperCase(),
      );
      props.tenantId = upperCaseTenant;
      props.userTenantAccessPermission = {
        [upperCaseTenant.toString()]: {
          ...props.userTenantAccessPermission![PROJECT_ID.toString()]!,
          projectId: upperCaseTenant,
        },
      };

      await expect(
        update(providerCase, { name: "Renamed" }, props),
      ).resolves.toBeDefined();

      storeProvider([OWNERS]);
      providers.shift();

      const error: Error | null = await refusal(
        update(providerCase, { name: "Renamed" }, props),
      );

      expect(error?.message).toBe(
        getProviderTeamsRefusalMessage({
          kind: providerCase.kind,
          teamNames: ["Owners"],
        }),
      );
    });

    test("of a provider in another project is refused without naming its teams", async () => {
      providers.push({
        id: PROVIDER_ID,
        projectId: OTHER_PROJECT_ID,
        teams: [OTHER_PROJECTS_TEAM],
      });

      // A permission check that (wrongly) let the row through.
      database.updatePermissionChecks.mockImplementation(
        async (_modelType: unknown, query: unknown): Promise<unknown> => {
          return query;
        },
      );

      const error: Error | null = await refusal(
        update(providerCase, { name: "Renamed" }, propsFor(OWNER)),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).not.toContain(OTHER_PROJECTS_TEAM.name);
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * SCIM connections: every team in the project.
 * ---------------------------------------------------------------------------
 */

describe(SCIM.label, () => {
  test.each(CALLERS)(
    "created by $name: only someone who could invite people to every team may",
    async (caller: Caller) => {
      const beyond: Array<FakeTeam> = notGrantable(caller);
      const error: Error | null = await refusal(
        create(SCIM, [READERS], propsFor(caller)),
      );

      if (beyond.length === 0) {
        expect(error).toBeNull();
        return;
      }

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toBe(SCIM_SAVE_REFUSAL_MESSAGE);
    },
  );

  test("whatever its default teams: the Groups endpoints reach every team", async () => {
    // Default teams the admin could grant are not enough.
    const error: Error | null = await refusal(
      create(SCIM, [ADMIN], propsFor(ADMIN_CALLER)),
    );

    expect(error?.message).toBe(
      "You can't save this SCIM connection, because your identity provider can add people to any team in this project through SCIM, including Owners. Ask a project owner to save it.",
    );
  });

  test("someone who is not a project owner is refused before a single team is read", async () => {
    await refusal(create(SCIM, [ADMIN], propsFor(ADMIN_IN_MEMBERS)));

    expect(database.teamReads).not.toHaveBeenCalled();
    expect(database.permissionReads).not.toHaveBeenCalled();
  });

  test("someone who is not a project owner is told who can save it, whatever teams they name", async () => {
    for (const teams of [[OTHER_PROJECTS_TEAM], [OWNERS], []]) {
      const error: Error | null = await refusal(
        create(SCIM, teams, propsFor(ADMIN_CALLER)),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toBe(SCIM_SAVE_REFUSAL_MESSAGE);
    }

    expect(database.teamReads).not.toHaveBeenCalled();
  });

  test("a project owner may create one, with or without default teams", async () => {
    await expect(
      create(SCIM, [MEMBERS], propsFor(OWNER)),
    ).resolves.toBeDefined();
    await expect(create(SCIM, [], propsFor(OWNER))).resolves.toBeDefined();
  });

  test("an owner's connection with no default teams reads nothing", async () => {
    await create(SCIM, [], propsFor(OWNER));

    expect(database.teamReads).not.toHaveBeenCalled();
    expect(database.permissionReads).not.toHaveBeenCalled();
  });

  test("a refused create mints no bearer token", async () => {
    const connection: BaseModel = withTeams(SCIM.make(), []);

    await refusal(
      callHook(ProjectSCIMService, "onBeforeCreate", {
        data: connection,
        props: propsFor(ADMIN_CALLER),
      }),
    );

    expect((connection as ProjectSCIM).bearerToken).toBeUndefined();
  });

  test("an accepted create still gets its bearer token", async () => {
    const result: OnCreate<BaseModel> = await create(SCIM, [], propsFor(OWNER));

    expect((result.createBy.data as ProjectSCIM).bearerToken).toBeTruthy();
  });

  test("default teams of another project are refused, even for a project owner", async () => {
    const error: Error | null = await refusal(
      create(SCIM, [OTHER_PROJECTS_TEAM], propsFor(OWNER)),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(TEAMS_NOT_IN_PROJECT_MESSAGE);
  });

  test.each([
    ["changing its settings", { autoProvisionUsers: false }],
    ["turning on push groups", { enablePushGroups: true }],
    ["resetting its bearer token", { bearerToken: "a".repeat(64) }],
    ["changing its default teams", { teams: [{ _id: ADMIN.id.toString() }] }],
    // A SAML or OIDC provider may be switched off by any editor; not this.
    ["sending an off switch", { isEnabled: false }],
  ])(
    "%s is a save like any other",
    async (_name: string, data: Record<string, unknown>) => {
      storeProvider([READERS]);

      const error: Error | null = await refusal(
        update(SCIM, data, propsFor(ADMIN_IN_MEMBERS)),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);

      await expect(update(SCIM, data, propsFor(OWNER))).resolves.toBeDefined();
    },
  );

  test.each([
    ["a master admin", MASTER_ADMIN],
    ["root", ROOT],
  ])("%s is not weighed", async (_name: string, caller: Caller) => {
    storeProvider([READERS]);

    await expect(
      update(SCIM, { bearerToken: "b".repeat(64) }, propsFor(caller)),
    ).resolves.toBeDefined();
    expect(database.teamReads).not.toHaveBeenCalled();
  });
});

/*
 * The bearer token is what the identity provider adds people to teams with,
 * and the Groups endpoints reach every team, so reading it takes the access
 * saving the connection takes: Project Owner.
 */
describe("a SCIM connection's bearer token", () => {
  function canSelectToken(caller: Caller): boolean {
    try {
      SelectPermission.checkSelectPermission(
        ProjectSCIM,
        { bearerToken: true } as Select<ProjectSCIM>,
        propsFor(caller),
      );
      return true;
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return false;
      }

      throw err;
    }
  }

  test("is readable by a project owner only", () => {
    expect(
      new ProjectSCIM().getColumnAccessControlFor("bearerToken")?.read,
    ).toEqual([Permission.ProjectOwner]);
  });

  test.each(
    CALLERS.filter((caller: Caller): boolean => {
      return !caller.isRoot && !caller.isMasterAdmin;
    }).map((caller: Caller): [string, Caller] => {
      return [caller.name, caller];
    }),
  )("selected by %s", (_name: string, caller: Caller) => {
    /*
     * Held by an allow row, and not taken away by a block with no labels:
     * the column is read by the rule its table is.
     */
    const holdsProjectOwner: boolean =
      (caller.rows || []).some((row: UserPermission): boolean => {
        return (
          row.permission === Permission.ProjectOwner && !row.isBlockPermission
        );
      }) &&
      !(caller.rows || []).some((row: UserPermission): boolean => {
        return (
          row.permission === Permission.ProjectOwner &&
          Boolean(row.isBlockPermission) &&
          (row.labelIds || []).length === 0
        );
      });

    expect(canSelectToken(caller)).toBe(holdsProjectOwner);
  });

  test("the rest of a connection stays readable by everyone who could read it", () => {
    expect(() => {
      SelectPermission.checkSelectPermission(
        ProjectSCIM,
        {
          name: true,
          teams: { _id: true },
          enablePushGroups: true,
        } as Select<ProjectSCIM>,
        propsFor(callerNamed("a project admin")),
      );
    }).not.toThrow();
  });

  test("a custom role that reads SSO settings may no longer read it", () => {
    expect(
      canSelectToken({
        name: "a settings reader",
        rows: [allow(Permission.ReadProjectSSO)],
        grantable: [],
      }),
    ).toBe(false);
  });
});

/*
 * The model says the same as the hook: creating or changing a SCIM
 * connection is a project owner's to do, so every gate that reads the
 * model's access control (the API's own table check, the Dashboard's
 * buttons) agrees with the save.
 */
describe("who may create or change a SCIM connection", () => {
  test("the model lets a project owner create and change one; reading and deleting are as they were", () => {
    const connection: ProjectSCIM = new ProjectSCIM();

    expect(connection.createRecordPermissions).toEqual([
      Permission.ProjectOwner,
    ]);
    expect(connection.updateRecordPermissions).toEqual([
      Permission.ProjectOwner,
    ]);
    expect(connection.readRecordPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ReadProjectSSO,
        Permission.Viewer,
      ]),
    );
    expect(connection.deleteRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.DeleteProjectSSO,
    ]);
  });

  test("every column says the same: only a project owner writes one", () => {
    const columns: Record<
      string,
      { create?: Array<Permission>; update?: Array<Permission> }
    > = new ProjectSCIM().getColumnAccessControlForAllColumns() as Record<
      string,
      { create?: Array<Permission>; update?: Array<Permission> }
    >;

    expect(Object.keys(columns).length).toBeGreaterThan(5);

    for (const [column, accessControl] of Object.entries(columns)) {
      for (const permissions of [accessControl.create, accessControl.update]) {
        expect({
          column,
          beyondOwner: (permissions || []).filter(
            (permission: Permission): boolean => {
              return permission !== Permission.ProjectOwner;
            },
          ),
        }).toEqual({ column, beyondOwner: [] });
      }
    }
  });

  test.each(
    CALLERS.filter((caller: Caller): boolean => {
      return !caller.isRoot && !caller.isMasterAdmin;
    }).map((caller: Caller): [string, Caller] => {
      return [caller.name, caller];
    }),
  )("the update's table check, for %s", (_name: string, caller: Caller) => {
    const holdsProjectOwner: boolean = (caller.rows || []).some(
      (row: UserPermission): boolean => {
        return (
          row.permission === Permission.ProjectOwner && !row.isBlockPermission
        );
      },
    );

    // The plan is not what is asked here.
    getJestSpyOn(
      BillingPermissions,
      "checkBillingPermissions",
    ).mockImplementation((): void => {
      return undefined;
    });

    let error: unknown = null;

    try {
      TablePermission.checkTableLevelPermissions(
        ProjectSCIM,
        propsFor(caller),
        DatabaseRequestType.Update,
      );
    } catch (err) {
      error = err;
    }

    if (holdsProjectOwner) {
      // A blocked owner passes here; the hook refuses them (above).
      expect(error).toBeNull();
      return;
    }

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("a blocked project owner, whom the table check lets through, is refused by the save", async () => {
    storeProvider([READERS]);

    const error: Error | null = await refusal(
      update(
        SCIM,
        { name: "Renamed" },
        propsFor(
          callerNamed(
            "a project owner blocked from Project Owner, who is also an admin and a member",
          ),
        ),
      ),
    );

    expect(error?.message).toBe(SCIM_SAVE_REFUSAL_MESSAGE);
  });
});

/*
 * An invitation meets the same ceiling, over the same rows. A project owner
 * may hand on every team, so nothing is read for one.
 */
describe("TeamPermissionService.assertCanGrantTeamPermissions", () => {
  test("reads nothing for a project owner", async () => {
    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: OWNERS.id,
        projectId: PROJECT_ID,
        props: propsFor(OWNER),
      }),
    ).resolves.toBeUndefined();

    expect(database.permissionReads).not.toHaveBeenCalled();
  });

  test("weighs every row of the team for anyone else", async () => {
    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: OWNERS.id,
        projectId: PROJECT_ID,
        props: propsFor(ADMIN_CALLER),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: ADMIN.id,
        projectId: PROJECT_ID,
        props: propsFor(ADMIN_CALLER),
      }),
    ).resolves.toBeUndefined();

    expect(database.permissionReads).toHaveBeenCalledTimes(2);
  });

  test("a project owner of another project is refused before anything is read", async () => {
    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: OWNERS.id,
        projectId: PROJECT_ID,
        props: propsFor(OWNER, OTHER_PROJECT_ID),
      }),
    ).rejects.toThrow();

    expect(database.permissionReads).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The ceiling itself.
 * ---------------------------------------------------------------------------
 */

describe("TeamPermissionService.findTeamsCallerCannotGrant", () => {
  test.each(CALLERS)(
    "for $name, refuses exactly the teams an invitation would be refused",
    async (caller: Caller) => {
      const props: DatabaseCommonInteractionProps = propsFor(caller);

      const refused: Array<ObjectID> =
        await TeamPermissionService.findTeamsCallerCannotGrant({
          teamIds: PROJECT_TEAMS.map((team: FakeTeam): ObjectID => {
            return team.id;
          }),
          projectId: PROJECT_ID,
          props: props,
        });

      // The batch answer, team by team...
      expect(
        refused.map((teamId: ObjectID): string => {
          return teamId.toString();
        }),
      ).toEqual(
        notGrantable(caller).map((team: FakeTeam): string => {
          return team.id.toString();
        }),
      );

      // ...is the invitation's answer (assertCanGrantTeamPermissions).
      for (const team of PROJECT_TEAMS) {
        const invitationRefused: boolean = Boolean(
          await refusal(
            TeamPermissionService.assertCanGrantTeamPermissions({
              teamId: team.id,
              projectId: PROJECT_ID,
              props: propsFor(caller),
            }),
          ),
        );

        expect({ team: team.name, refused: invitationRefused }).toEqual({
          team: team.name,
          refused: notGrantable(caller).includes(team),
        });
      }
    },
  );

  test("refuses a caller from another project outright", async () => {
    await expect(
      TeamPermissionService.findTeamsCallerCannotGrant({
        teamIds: [READERS.id],
        projectId: PROJECT_ID,
        props: propsFor(ADMIN_CALLER, OTHER_PROJECT_ID),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("reads nothing for a project owner, a master admin or root", async () => {
    for (const caller of [OWNER, MASTER_ADMIN, ROOT]) {
      await expect(
        TeamPermissionService.findTeamsCallerCannotGrant({
          teamIds: [OWNERS.id],
          projectId: PROJECT_ID,
          props: propsFor(caller),
        }),
      ).resolves.toEqual([]);
    }

    expect(database.permissionReads).not.toHaveBeenCalled();
  });

  test("canGrantEveryPermission is the owner override, and nothing else", () => {
    expect(TeamPermissionService.canGrantEveryPermission(propsFor(OWNER))).toBe(
      true,
    );
    expect(
      TeamPermissionService.canGrantEveryPermission(propsFor(MASTER_ADMIN)),
    ).toBe(true);
    expect(TeamPermissionService.canGrantEveryPermission(propsFor(ROOT))).toBe(
      true,
    );

    for (const caller of CALLERS.filter((candidate: Caller): boolean => {
      return ![OWNER, MASTER_ADMIN, ROOT].includes(candidate);
    })) {
      expect({
        caller: caller.name,
        canGrantEverything: TeamPermissionService.canGrantEveryPermission(
          propsFor(caller),
        ),
      }).toEqual({ caller: caller.name, canGrantEverything: false });
    }
  });
});

describe("the refusal's wording", () => {
  test("names one team, then two, then a list, and caps a long one", () => {
    expect(joinTeamNames(["Owners"])).toBe("Owners");
    expect(joinTeamNames(["Owners", "Members"])).toBe("Owners and Members");
    expect(joinTeamNames(["Owners", "Members", "Admin"])).toBe(
      "Owners, Members and Admin",
    );

    const many: Array<string> = Array.from(
      { length: MAX_REFUSED_TEAM_NAMES + 3 },
      (_value: unknown, index: number): string => {
        return `Team ${index + 1}`;
      },
    );

    expect(joinTeamNames(many)).toBe(
      "Team 1, Team 2, Team 3, Team 4, Team 5 and 3 more",
    );
  });

  test("SAML and OIDC say which provider, and agree in number", () => {
    expect(
      getProviderTeamsRefusalMessage({
        kind: SsoProviderKind.Saml,
        teamNames: ["Owners"],
      }),
    ).toBe(
      "You can't save this SSO provider while it adds people to Owners, because Owners gives more access than you have. Choose teams you could invite someone to, or ask a project owner to save it.",
    );
    expect(
      getProviderTeamsRefusalMessage({
        kind: SsoProviderKind.Oidc,
        teamNames: ["Owners", "Members"],
      }),
    ).toBe(
      "You can't save this OIDC provider while it adds people to Owners and Members, because those teams give more access than you have. Choose teams you could invite someone to, or ask a project owner to save it.",
    );
  });

  test("SCIM says why every team counts, and who can save it", () => {
    expect(SCIM_SAVE_REFUSAL_MESSAGE).toBe(
      "You can't save this SCIM connection, because your identity provider can add people to any team in this project through SCIM, including Owners. Ask a project owner to save it.",
    );
  });

  test("getTeamIds reads every shape a hook is handed, and none is none", () => {
    expect(SsoProviderTeamGrant.getTeamIds(undefined)).toEqual([]);
    expect(SsoProviderTeamGrant.getTeamIds(null)).toEqual([]);
    expect(SsoProviderTeamGrant.getTeamIds([])).toEqual([]);
    expect(
      SsoProviderTeamGrant.getTeamIds([
        toTeamModel(OWNERS),
        { _id: MEMBERS.id.toString() },
        ADMIN.id.toString().toUpperCase(),
        OWNERS.id,
      ]).map((teamId: ObjectID): string => {
        return teamId.toString();
      }),
    ).toEqual(
      [OWNERS, ADMIN, MEMBERS]
        .map((team: FakeTeam): string => {
          return team.id.toString();
        })
        .sort(),
    );
    expect(() => {
      return SsoProviderTeamGrant.getTeamIds([{ name: "Owners" }]);
    }).toThrow(TEAMS_NOT_REFERENCES_MESSAGE);
  });
});
