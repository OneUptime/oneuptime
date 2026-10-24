import { describe, expect, test } from "@jest/globals";
import {
  canTeamTakeCustomRoles,
  CUSTOM_ROLE_ICON,
  CustomRoleSummary,
  getApiKeyRoleCoverage,
  getApiKeyRoleGrants,
  getCustomRoleCardSelectOption,
  getOwnedPermissionCounts,
  loadApiKeyIdsGivenCustomRole,
  loadCustomRoleGrants,
  loadCustomRoleIdsOfApiKey,
  loadCustomRoleIdsOfTeam,
  loadCustomRoles,
  loadTeamIdsGivenCustomRole,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleOptions";
import { loadCustomRoleReach } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleReach";
import ApiKeyCustomRole from "../../../Models/DatabaseModels/ApiKeyCustomRole";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import TeamCustomRole from "../../../Models/DatabaseModels/TeamCustomRole";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import { TeamPermissionGrant } from "../../../UI/Utils/GrantablePermission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * A PROJECT'S CUSTOM ROLES, AS THE PAGES READ THEM
 * (Dashboard/src/Components/CustomRole/CustomRoleOptions, CustomRoleReach):
 * the roles and how much each holds, who has which role already - so a
 * picker offers only what is not given yet - every role's permissions in
 * the shape the grant ceiling weighs, and who a role reaches.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const PROJECT_ID: ObjectID = new ObjectID(
  "0e000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("0e000000-0000-4000-8000-000000000002");
const RESPONDER_ID: string = "0E000000-0000-4000-8000-000000000003";
const LEAD_ID: string = "0e000000-0000-4000-8000-000000000004";
const LABEL_ID: string = "0e000000-0000-4000-8000-000000000005";

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
}

// A ModelAPI whose getList answers each table from `rows`, and records each call.
function listingModelAPI(
  rows: Map<unknown, Array<unknown>>,
  calls: Array<ListCall>,
  refuse?: unknown,
): typeof ModelAPI {
  return {
    getList: async (call: ListCall): Promise<unknown> => {
      calls.push(call);

      if (refuse && call.modelType === refuse) {
        throw new Error("You do not have permissions to read Team Member.");
      }

      const data: Array<unknown> = rows.get(call.modelType) || [];

      return { data: data, count: data.length, skip: 0, limit: call.limit };
    },
  } as unknown as typeof ModelAPI;
}

function role(id: string, name: string, permissionCount?: number): CustomRole {
  const customRole: CustomRole = new CustomRole();
  customRole._id = id;
  customRole.name = name;
  if (permissionCount !== undefined) {
    customRole.permissionCount = permissionCount;
  }
  return customRole;
}

function given(data: {
  id?: string;
  teamId?: string;
  customRoleId?: string;
  teamName?: string;
}): TeamCustomRole {
  const row: TeamCustomRole = new TeamCustomRole();
  if (data.id) {
    row._id = data.id;
  }
  if (data.teamId) {
    row.teamId = new ObjectID(data.teamId);
  }
  if (data.customRoleId) {
    row.customRoleId = new ObjectID(data.customRoleId);
  }
  if (data.teamName) {
    const team: Team = new Team();
    team.name = data.teamName;
    row.team = team;
  }
  return row;
}

describe("the project's custom roles", () => {
  test("are read once, by name, with what each holds", async () => {
    const calls: Array<ListCall> = [];
    const responder: CustomRole = role(RESPONDER_ID, "Incident Responder", 6);
    responder.description = "Declares, works and resolves incidents.";

    const roles: Array<CustomRoleSummary> = await loadCustomRoles({
      projectId: PROJECT_ID,
      modelAPI: listingModelAPI(
        new Map<unknown, Array<unknown>>([
          [CustomRole, [responder, role(LEAD_ID, "Team Lead")]],
        ]),
        calls,
      ),
    });

    expect(roles).toEqual([
      {
        id: RESPONDER_ID,
        name: "Incident Responder",
        description: "Declares, works and resolves incidents.",
        permissionCount: 6,
      },
      { id: LEAD_ID, name: "Team Lead", description: "", permissionCount: 0 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.modelType).toBe(CustomRole);
    expect(calls[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(calls[0]!.sort).toEqual({ name: SortOrder.Ascending });
    expect(calls[0]!.select).toEqual({
      _id: true,
      name: true,
      description: true,
      permissionCount: true,
    });
  });

  test("a role reads as a card: its name, how much it holds and its description", () => {
    const card: CardSelectOption = getCustomRoleCardSelectOption(ENGLISH, {
      id: RESPONDER_ID,
      name: "Incident Responder",
      description: "Declares, works and resolves incidents.",
      permissionCount: 6,
    });

    expect(card).toEqual({
      value: RESPONDER_ID,
      title: "Incident Responder",
      description: "6 permissions · Declares, works and resolves incidents.",
      icon: CUSTOM_ROLE_ICON,
      isUserContent: true,
    });
    expect(CUSTOM_ROLE_ICON).toBe(IconProp.Identification);
  });

  /*
   * A role called "Incident Responder" read "Vorfallbearbeiter" to a German
   * reader: the card picker looked the name up as interface text. The card
   * is drawn as given - the name as typed, the description already worded in
   * the reader's language.
   */
  test("a role's card is drawn as given: its name is never looked up", () => {
    const german: Translator = createTranslator((text: string | undefined) => {
      return text === "{{permissions}} · {{description}}"
        ? "{{permissions}} – {{description}}"
        : text;
    }, "de");

    const card: CardSelectOption = getCustomRoleCardSelectOption(german, {
      id: RESPONDER_ID,
      name: "Incident Responder",
      description: "Bearbeitet Vorfälle.",
      permissionCount: 1,
    });

    expect(card.isUserContent).toBe(true);
    expect(card.title).toBe("Incident Responder");
    // Worded in the reader's language once, here.
    expect(card.description).toBe("1 permission – Bearbeitet Vorfälle.");
  });

  test("among the built-in roles, a card stands for the value it is given and says it is custom", () => {
    const card: CardSelectOption = getCustomRoleCardSelectOption(
      ENGLISH,
      { id: LEAD_ID, name: "Team Lead", description: "", permissionCount: 1 },
      { value: `customRole:${LEAD_ID}`, saysItIsCustom: true },
    );

    expect(card.value).toBe(`customRole:${LEAD_ID}`);
    expect(card.description).toBe("Custom role · 1 permission");
  });
});

describe("whether a team can take a custom role", () => {
  interface GetItemCall {
    modelType: unknown;
    id: ObjectID;
    select: Record<string, unknown>;
  }

  function teamModelAPI(
    answer: () => Promise<Team | null>,
    calls: Array<GetItemCall>,
  ): typeof ModelAPI {
    return {
      getItem: async (call: GetItemCall): Promise<Team | null> => {
        calls.push(call);
        return await answer();
      },
    } as unknown as typeof ModelAPI;
  }

  function team(isPermissionsEditable: boolean | undefined): Team {
    const record: Team = new Team();
    record._id = TEAM_ID.toString();
    if (isPermissionsEditable !== undefined) {
      record.isPermissionsEditable = isPermissionsEditable;
    }
    return record;
  }

  test("a team of the project's own can: it reads only that one column", async () => {
    const calls: Array<GetItemCall> = [];

    expect(
      await canTeamTakeCustomRoles({
        teamId: TEAM_ID,
        modelAPI: teamModelAPI(async () => {
          return team(true);
        }, calls),
      }),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.modelType).toBe(Team);
    expect(calls[0]!.id).toBe(TEAM_ID);
    expect(calls[0]!.select).toEqual({ isPermissionsEditable: true });
  });

  // Owners and Admin: the server refuses them every role.
  test("a team whose permissions can't change can't", async () => {
    expect(
      await canTeamTakeCustomRoles({
        teamId: TEAM_ID,
        modelAPI: teamModelAPI(async () => {
          return team(false);
        }, []),
      }),
    ).toBe(false);
  });

  // The card is offered, and the server decides.
  test("a team that can't be read, or reads without the column, is offered the card", async () => {
    for (const answer of [
      async (): Promise<Team | null> => {
        return null;
      },
      async (): Promise<Team | null> => {
        return team(undefined);
      },
      async (): Promise<Team | null> => {
        throw new Error("You do not have permissions to read Team.");
      },
    ]) {
      expect(
        await canTeamTakeCustomRoles({
          teamId: TEAM_ID,
          modelAPI: teamModelAPI(answer, []),
        }),
      ).toBe(true);
    }
  });
});

describe("who has which role", () => {
  test("a team's roles, by id, in lower case", async () => {
    const calls: Array<ListCall> = [];

    const ids: Set<string> = await loadCustomRoleIdsOfTeam({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      modelAPI: listingModelAPI(
        new Map<unknown, Array<unknown>>([
          [
            TeamCustomRole,
            [
              given({ customRoleId: RESPONDER_ID }),
              given({ customRoleId: LEAD_ID }),
              given({}),
            ],
          ],
        ]),
        calls,
      ),
    });

    expect(Array.from(ids)).toEqual([RESPONDER_ID.toLowerCase(), LEAD_ID]);
    expect(calls[0]!.modelType).toBe(TeamCustomRole);
    expect(calls[0]!.query).toEqual({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    });
  });

  test("the teams a role is given to, by id, in lower case", async () => {
    const calls: Array<ListCall> = [];
    const otherTeam: string = "0E000000-0000-4000-8000-0000000000AA";

    const ids: Set<string> = await loadTeamIdsGivenCustomRole({
      customRoleId: new ObjectID(RESPONDER_ID),
      projectId: PROJECT_ID,
      modelAPI: listingModelAPI(
        new Map<unknown, Array<unknown>>([
          [
            TeamCustomRole,
            [
              given({ teamId: TEAM_ID.toString() }),
              given({ teamId: otherTeam }),
              given({}),
            ],
          ],
        ]),
        calls,
      ),
    });

    expect(Array.from(ids)).toEqual([
      TEAM_ID.toString(),
      otherTeam.toLowerCase(),
    ]);
    expect(calls[0]!.query["customRoleId"]?.toString()).toBe(RESPONDER_ID);
    expect(calls[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(calls[0]!.select).toEqual({ teamId: true });
  });
});

describe("every role's permissions, as the grant ceiling weighs them", () => {
  test("by role, with each permission's scope and labels", async () => {
    const calls: Array<ListCall> = [];

    const incidentMember: CustomRolePermission = new CustomRolePermission();
    incidentMember.customRoleId = new ObjectID(RESPONDER_ID);
    incidentMember.permission = Permission.IncidentMember;
    incidentMember.scope = PermissionScope.All;

    const monitorViewer: CustomRolePermission = new CustomRolePermission();
    monitorViewer.customRoleId = new ObjectID(RESPONDER_ID);
    monitorViewer.permission = Permission.MonitorViewer;
    monitorViewer.scope = PermissionScope.Labels;
    const production: Label = new Label();
    production._id = LABEL_ID;
    monitorViewer.labels = [production];

    const leadPermission: CustomRolePermission = new CustomRolePermission();
    leadPermission.customRoleId = new ObjectID(LEAD_ID);
    leadPermission.permission = Permission.OnCallViewer;

    // A row with no role or no permission is nothing to weigh.
    const orphan: CustomRolePermission = new CustomRolePermission();
    orphan.permission = Permission.AlertMember;

    const grants: Map<
      string,
      Array<TeamPermissionGrant>
    > = await loadCustomRoleGrants({
      projectId: PROJECT_ID,
      modelAPI: listingModelAPI(
        new Map<unknown, Array<unknown>>([
          [
            CustomRolePermission,
            [incidentMember, monitorViewer, leadPermission, orphan],
          ],
        ]),
        calls,
      ),
    });

    expect(Array.from(grants.keys())).toEqual([RESPONDER_ID, LEAD_ID]);
    expect(grants.get(RESPONDER_ID)).toEqual([
      {
        permission: Permission.IncidentMember,
        scope: PermissionScope.All,
        labelIds: [],
      },
      {
        permission: Permission.MonitorViewer,
        scope: PermissionScope.Labels,
        labelIds: [LABEL_ID],
      },
    ]);
    // No scope stored reads as All, as on the server.
    expect(grants.get(LEAD_ID)).toEqual([
      {
        permission: Permission.OnCallViewer,
        scope: PermissionScope.All,
        labelIds: [],
      },
    ]);
    expect(calls[0]!.modelType).toBe(CustomRolePermission);
    expect(calls[0]!.select["labels"]).toEqual({ _id: true });
    // Every role's: no role named.
    expect(calls[0]!.query["customRoleId"]).toBeUndefined();
  });

  test("one role's only, when a role's page asks what its API keys get", async () => {
    const calls: Array<ListCall> = [];

    const owned: CustomRolePermission = new CustomRolePermission();
    owned.customRoleId = new ObjectID(LEAD_ID);
    owned.permission = Permission.AlertMember;
    owned.scope = PermissionScope.Owned;

    const grants: Map<
      string,
      Array<TeamPermissionGrant>
    > = await loadCustomRoleGrants({
      projectId: PROJECT_ID,
      customRoleId: new ObjectID(LEAD_ID),
      modelAPI: listingModelAPI(
        new Map<unknown, Array<unknown>>([[CustomRolePermission, [owned]]]),
        calls,
      ),
    });

    expect(String(calls[0]!.query["customRoleId"])).toBe(LEAD_ID);
    expect(String(calls[0]!.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(grants.get(LEAD_ID)).toEqual([
      {
        permission: Permission.AlertMember,
        scope: PermissionScope.Owned,
        labelIds: [],
      },
    ]);
  });
});

describe("how much of one role an API key holds", () => {
  test("every permission but those scoped to what someone owns", () => {
    expect(
      getApiKeyRoleCoverage([
        { permission: Permission.IncidentMember, scope: PermissionScope.All },
        {
          permission: Permission.MonitorViewer,
          scope: PermissionScope.Labels,
          labelIds: [LABEL_ID],
        },
        { permission: Permission.AlertMember, scope: PermissionScope.Owned },
      ]),
    ).toEqual({ permissionCount: 3, ownedCount: 1 });
  });

  test("a role with nothing scoped to what someone owns, and an empty role", () => {
    expect(
      getApiKeyRoleCoverage([{ permission: Permission.IncidentAdmin }]),
    ).toEqual({ permissionCount: 1, ownedCount: 0 });
    expect(getApiKeyRoleCoverage([])).toEqual({
      permissionCount: 0,
      ownedCount: 0,
    });
  });
});

describe("who a role reaches", () => {
  test("its teams, and the people on them who accepted, each once", async () => {
    const calls: Array<ListCall> = [];
    const person: (userId: string) => TeamMember = (
      userId: string,
    ): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.userId = new ObjectID(userId);
      return member;
    };
    const otherTeam: string = "0e000000-0000-4000-8000-0000000000bb";

    const reach: Awaited<ReturnType<typeof loadCustomRoleReach>> =
      await loadCustomRoleReach({
        customRoleId: new ObjectID(RESPONDER_ID),
        projectId: PROJECT_ID,
        modelAPI: listingModelAPI(
          new Map<unknown, Array<unknown>>([
            [
              TeamCustomRole,
              [
                given({
                  id: "0e000000-0000-4000-8000-0000000000c1",
                  teamId: TEAM_ID.toString(),
                  teamName: "Platform On-Call",
                }),
                given({
                  id: "0e000000-0000-4000-8000-0000000000c2",
                  teamId: otherTeam,
                  teamName: "Support",
                }),
              ],
            ],
            [
              TeamMember,
              [
                person("0e000000-0000-4000-8000-0000000000d1"),
                // On both teams: one person.
                person("0E000000-0000-4000-8000-0000000000D1"),
                person("0e000000-0000-4000-8000-0000000000d2"),
              ],
            ],
          ]),
          calls,
        ),
      });

    expect(reach.teamCount).toBe(2);
    expect(reach.memberCount).toBe(2);
    expect(reach.teams).toEqual([
      {
        teamCustomRoleId: "0e000000-0000-4000-8000-0000000000c1",
        teamId: TEAM_ID.toString(),
        teamName: "Platform On-Call",
      },
      {
        teamCustomRoleId: "0e000000-0000-4000-8000-0000000000c2",
        teamId: otherTeam,
        teamName: "Support",
      },
    ]);

    const membersRead: ListCall = calls.find((call: ListCall): boolean => {
      return call.modelType === TeamMember;
    })!;
    expect(membersRead.query["hasAcceptedInvitation"]).toBe(true);
    expect(membersRead.query["teamId"]).toBeInstanceOf(Includes);
    expect((membersRead.query["teamId"] as Includes).values).toEqual([
      TEAM_ID.toString(),
      otherTeam,
    ]);
  });

  test("no team: no one, and the members are not read", async () => {
    const calls: Array<ListCall> = [];

    expect(
      await loadCustomRoleReach({
        customRoleId: new ObjectID(LEAD_ID),
        projectId: PROJECT_ID,
        modelAPI: listingModelAPI(new Map<unknown, Array<unknown>>(), calls),
      }),
    ).toEqual({ teams: [], teamCount: 0, memberCount: 0, apiKeyCount: 0 });
    // The keys given it are counted too; the members of no team are not read.
    expect(
      calls.map((call: ListCall): unknown => {
        return call.modelType;
      }),
    ).toEqual([TeamCustomRole, ApiKeyCustomRole]);
  });

  test("the teams only, when the reader may not read who is on them", async () => {
    const reach: Awaited<ReturnType<typeof loadCustomRoleReach>> =
      await loadCustomRoleReach({
        customRoleId: new ObjectID(RESPONDER_ID),
        projectId: PROJECT_ID,
        modelAPI: listingModelAPI(
          new Map<unknown, Array<unknown>>([
            [
              TeamCustomRole,
              [given({ teamId: TEAM_ID.toString(), teamName: "Support" })],
            ],
          ]),
          [],
          TeamMember,
        ),
      });

    expect(reach.teamCount).toBe(1);
    expect(reach.memberCount).toBeNull();
  });

  test("the API keys given it are counted, each once, from the rows that give it", async () => {
    const calls: Array<ListCall> = [];
    const key: string = "0e000000-0000-4000-8000-0000000000e1";

    const reach: Awaited<ReturnType<typeof loadCustomRoleReach>> =
      await loadCustomRoleReach({
        customRoleId: new ObjectID(RESPONDER_ID),
        projectId: PROJECT_ID,
        modelAPI: listingModelAPI(
          new Map<unknown, Array<unknown>>([
            [
              ApiKeyCustomRole,
              [
                keyGiven({ apiKeyId: key }),
                keyGiven({ apiKeyId: key.toUpperCase() }),
                keyGiven({ apiKeyId: "0e000000-0000-4000-8000-0000000000e2" }),
                // A row whose key could not be read counts for nothing.
                keyGiven({}),
              ],
            ],
          ]),
          calls,
        ),
      });

    expect(reach.teamCount).toBe(0);
    expect(reach.apiKeyCount).toBe(2);

    const keysRead: ListCall = calls.find((call: ListCall): boolean => {
      return call.modelType === ApiKeyCustomRole;
    })!;
    expect(String(keysRead.query["customRoleId"])).toBe(
      new ObjectID(RESPONDER_ID).toString(),
    );
    expect(keysRead.query["projectId"]).toBe(PROJECT_ID);
    expect(keysRead.select).toEqual({ apiKeyId: true });
  });

  test("the keys are not counted, and named nowhere, when the reader may not read the project's API keys", async () => {
    const reach: Awaited<ReturnType<typeof loadCustomRoleReach>> =
      await loadCustomRoleReach({
        customRoleId: new ObjectID(RESPONDER_ID),
        projectId: PROJECT_ID,
        modelAPI: listingModelAPI(
          new Map<unknown, Array<unknown>>([
            [
              TeamCustomRole,
              [given({ teamId: TEAM_ID.toString(), teamName: "Support" })],
            ],
          ]),
          [],
          ApiKeyCustomRole,
        ),
      });

    expect(reach.teamCount).toBe(1);
    expect(reach.apiKeyCount).toBeNull();
  });
});

function keyGiven(data: {
  apiKeyId?: string;
  customRoleId?: string;
}): ApiKeyCustomRole {
  const row: ApiKeyCustomRole = new ApiKeyCustomRole();
  if (data.apiKeyId) {
    row.apiKeyId = new ObjectID(data.apiKeyId);
  }
  if (data.customRoleId) {
    row.customRoleId = new ObjectID(data.customRoleId);
  }
  return row;
}

describe("an API key's custom roles, and the keys a role is given to", () => {
  const KEY_ID: ObjectID = new ObjectID("0e000000-0000-4000-8000-0000000000f1");

  test("a key's roles are read by the key and the project, as ids in lower case, each once", async () => {
    const calls: Array<ListCall> = [];

    const ids: Set<string> = await loadCustomRoleIdsOfApiKey({
      apiKeyId: KEY_ID,
      projectId: PROJECT_ID,
      modelAPI: listingModelAPI(
        new Map<unknown, Array<unknown>>([
          [
            ApiKeyCustomRole,
            [
              keyGiven({ customRoleId: RESPONDER_ID }),
              keyGiven({ customRoleId: RESPONDER_ID.toLowerCase() }),
              keyGiven({ customRoleId: LEAD_ID }),
              keyGiven({}),
            ],
          ],
        ]),
        calls,
      ),
    });

    expect(Array.from(ids).sort()).toEqual(
      [RESPONDER_ID.toLowerCase(), LEAD_ID].sort(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.modelType).toBe(ApiKeyCustomRole);
    expect(calls[0]!.query["apiKeyId"]).toBe(KEY_ID);
    expect(calls[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(calls[0]!.select).toEqual({ customRoleId: true });
  });

  test("the keys a role is given to are read by the role and the project, as ids in lower case", async () => {
    const calls: Array<ListCall> = [];

    const ids: Set<string> = await loadApiKeyIdsGivenCustomRole({
      customRoleId: new ObjectID(LEAD_ID),
      projectId: PROJECT_ID,
      modelAPI: listingModelAPI(
        new Map<unknown, Array<unknown>>([
          [
            ApiKeyCustomRole,
            [
              keyGiven({ apiKeyId: KEY_ID.toString().toUpperCase() }),
              keyGiven({}),
            ],
          ],
        ]),
        calls,
      ),
    });

    expect(Array.from(ids)).toEqual([KEY_ID.toString().toLowerCase()]);
    expect(calls[0]!.select).toEqual({ apiKeyId: true });
    expect(String(calls[0]!.query["customRoleId"])).toBe(LEAD_ID);
  });

  test("a key holds every permission of a role but those limited to what someone owns", () => {
    const grants: Array<TeamPermissionGrant> = [
      { permission: Permission.IncidentMember, scope: PermissionScope.All },
      {
        permission: Permission.MonitorViewer,
        scope: PermissionScope.Labels,
        labelIds: [LABEL_ID],
      },
      { permission: Permission.AlertMember, scope: PermissionScope.Owned },
      { permission: Permission.OnCallViewer },
    ];

    expect(
      getApiKeyRoleGrants(grants).map(
        (grant: TeamPermissionGrant): Permission => {
          return grant.permission;
        },
      ),
    ).toEqual([
      Permission.IncidentMember,
      Permission.MonitorViewer,
      Permission.OnCallViewer,
    ]);
    expect(getApiKeyRoleGrants([])).toEqual([]);
  });

  test("each role's permissions that give a key nothing are counted, by role id in lower case", () => {
    const counts: Map<string, number> = getOwnedPermissionCounts(
      new Map<string, Array<TeamPermissionGrant>>([
        [
          RESPONDER_ID,
          [
            {
              permission: Permission.IncidentMember,
              scope: PermissionScope.All,
            },
            {
              permission: Permission.AlertMember,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.MonitorViewer,
              scope: PermissionScope.Owned,
            },
          ],
        ],
        [LEAD_ID, [{ permission: Permission.IncidentAdmin }]],
      ]),
    );

    expect(counts.get(RESPONDER_ID.toLowerCase())).toBe(2);
    expect(counts.get(LEAD_ID)).toBe(0);
    expect(counts.has(RESPONDER_ID)).toBe(false);
  });

  test("a key's picker card says how many of the role's permissions apply to the key instead of how many it holds", () => {
    const option: CardSelectOption = getCustomRoleCardSelectOption(
      ENGLISH,
      {
        id: RESPONDER_ID,
        name: "Incident Responder",
        description: "Declares, works and resolves incidents.",
        permissionCount: 6,
      },
      { permissionsText: "4 of its 6 permissions apply to this key" },
    );

    expect(option.description).toBe(
      "4 of its 6 permissions apply to this key · Declares, works and resolves incidents.",
    );
    expect(option.title).toBe("Incident Responder");
    expect(option.isUserContent).toBe(true);
  });
});
