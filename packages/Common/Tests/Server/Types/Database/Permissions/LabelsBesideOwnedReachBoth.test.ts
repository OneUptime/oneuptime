import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission, {
  LabelGrant,
} from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import CreateScopeException from "../../../../../Server/Types/Database/Permissions/CreateScopeException";
import CreateScopePermission, {
  CreateScope,
} from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import UpdateScopeException from "../../../../../Server/Types/Database/Permissions/UpdateScopeException";
import UpdateScopePermission from "../../../../../Server/Types/Database/Permissions/UpdateScopePermission";
import QueryHelper from "../../../../../Server/Types/Database/QueryHelper";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import Label from "../../../../../Models/DatabaseModels/Label";
import MonitorTemplate from "../../../../../Models/DatabaseModels/MonitorTemplate";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { meetsCondition } from "../../../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import PrivateRecordPermission from "../../../../../Server/Types/Database/Permissions/PrivateRecordPermission";

/*
 * A write of an incident, an alert or an episode - or of a part of one - is
 * narrowed to the teams that own it when the record is private
 * (PrivateRecordPermission), with a condition only SQL can answer. Its own
 * suites hold that rule (PrivateRecordPermission, PrivateRecordParts and
 * PrivateRecordOwnerTeamsPostgres); this one holds what the scope, labels
 * and blocks reach beside it, for records that are not private.
 */
beforeEach(() => {
  jest
    .spyOn(PrivateRecordPermission, "addPrivateRecordScopeToQuery")
    .mockImplementation(((_modelType: unknown, query: unknown): unknown => {
      return query;
    }) as never);
});

/*
 * GRANTS LIMITED TO LABELS AND GRANTS SCOPED TO OWNED REACH BOTH.
 *
 * A member's access is the union of their teams' grants. With Edit Incident
 * limited to the Security label on one team and scoped to Owned on another,
 * the member reached only the Security incidents: a row limited to labels
 * counted as the broader grant, so the Owned one was skipped
 * (OwnedScopePermission), and the read was narrowed to the labels
 * (AccessControlPermission). An incident the second team owns without the
 * label could not be read or changed, and an incident the member was to own
 * could not be created without the label. Now the two narrow by one
 * condition - carries one of the labels, or is owned by the member or the
 * Owned grant's team - on reads, changes and deletes (BasePermission
 * .addRecordScopeToQuery), on the record a model is read through, on one
 * record by id, and on what a create makes and a change leaves. Here with
 * the owner tables stood in for by a fixed map of who owns what; the
 * real-Postgres suite (Tests/Server/API/OwnedScopePerTeamPostgres) runs
 * the same through the routes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000001",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000002",
);

// The member's teams: one limited to the Security label, one to what it owns.
const LABELLED_TEAM: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000003",
);
const OWNING_TEAM: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000004",
);
// A team the member is not on.
const OTHER_TEAM: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000005",
);

const SECURITY: ObjectID = new ObjectID("4d000000-0000-4000-8000-000000000011");
const BILLING: ObjectID = new ObjectID("4d000000-0000-4000-8000-000000000012");

interface FixtureIncident {
  id: string;
  labels: Array<ObjectID>;
  ownedByMember: boolean;
  ownerTeams: Array<ObjectID>;
}

function fixture(
  id: string,
  data: Partial<Omit<FixtureIncident, "id">>,
): FixtureIncident {
  return {
    id: id,
    labels: data.labels || [],
    ownedByMember: Boolean(data.ownedByMember),
    ownerTeams: data.ownerTeams || [],
  };
}

const SECURITY_UNOWNED: FixtureIncident = fixture(
  "4d000000-0000-4000-8000-000000000021",
  { labels: [SECURITY] },
);
const OWNED_BY_OWNING_TEAM: FixtureIncident = fixture(
  "4d000000-0000-4000-8000-000000000022",
  { ownerTeams: [OWNING_TEAM] },
);
const OWNED_BY_MEMBER: FixtureIncident = fixture(
  "4d000000-0000-4000-8000-000000000023",
  { ownedByMember: true },
);
const SECURITY_AND_OWNED: FixtureIncident = fixture(
  "4d000000-0000-4000-8000-000000000024",
  { labels: [SECURITY], ownerTeams: [OWNING_TEAM] },
);
const OWNED_BY_LABELLED_TEAM: FixtureIncident = fixture(
  "4d000000-0000-4000-8000-000000000025",
  { ownerTeams: [LABELLED_TEAM] },
);
const OWNED_BY_OTHERS: FixtureIncident = fixture(
  "4d000000-0000-4000-8000-000000000026",
  { ownerTeams: [OTHER_TEAM], labels: [BILLING] },
);
const NOBODY_S: FixtureIncident = fixture(
  "4d000000-0000-4000-8000-000000000027",
  {},
);

const INCIDENTS: Array<FixtureIncident> = [
  SECURITY_UNOWNED,
  OWNED_BY_OWNING_TEAM,
  OWNED_BY_MEMBER,
  SECURITY_AND_OWNED,
  OWNED_BY_LABELLED_TEAM,
  OWNED_BY_OTHERS,
  NOBODY_S,
];

function idsOf(incidents: Array<FixtureIncident>): Array<string> {
  return incidents
    .map((incident: FixtureIncident): string => {
      return incident.id;
    })
    .sort();
}

function grantRow(
  permission: Permission,
  data: {
    scope?: PermissionScope;
    teamId?: ObjectID;
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
  },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
    ...(data.scope ? { scope: data.scope } : {}),
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

function limitedToSecurity(permission: Permission): UserPermission {
  return grantRow(permission, {
    scope: PermissionScope.Labels,
    labelIds: [SECURITY],
    teamId: LABELLED_TEAM,
  });
}

function ownedByTeam(permission: Permission): UserPermission {
  return grantRow(permission, {
    scope: PermissionScope.Owned,
    teamId: OWNING_TEAM,
  });
}

// The member, with these rows from their teams.
function memberWith(
  rows: Array<UserPermission>,
  data?: { isNoPerson?: boolean },
): DatabaseCommonInteractionProps {
  return {
    ...(data?.isNoPerson
      ? { userType: UserType.API }
      : { userId: MEMBER_ID, userType: UserType.User }),
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
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

// The task's teams: Edit Incident on Security, and on what the second team owns.
const EDIT_ON_BOTH: Array<UserPermission> = [
  limitedToSecurity(Permission.ReadProjectIncident),
  limitedToSecurity(Permission.EditProjectIncident),
  limitedToSecurity(Permission.CreateProjectIncident),
  limitedToSecurity(Permission.DeleteProjectIncident),
  ownedByTeam(Permission.ReadProjectIncident),
  ownedByTeam(Permission.EditProjectIncident),
  ownedByTeam(Permission.CreateProjectIncident),
  ownedByTeam(Permission.DeleteProjectIncident),
];

// The incidents the member, or one of `teamIds`, owns.
function ownedIncidentIds(teamIds: ReadonlyArray<ObjectID>): Array<ObjectID> {
  const teams: Set<string> = new Set<string>(
    teamIds.map((teamId: ObjectID): string => {
      return teamId.toString();
    }),
  );

  return INCIDENTS.filter((incident: FixtureIncident): boolean => {
    return (
      incident.ownedByMember ||
      incident.ownerTeams.some((teamId: ObjectID): boolean => {
        return teams.has(teamId.toString());
      })
    );
  }).map((incident: FixtureIncident): ObjectID => {
    return new ObjectID(incident.id);
  });
}

// The teams each owned lookup was asked about.
let ownedLookups: Array<Array<string>> = [];

/*
 * The conditions QueryHelper.anyOfConditions holds together, by the
 * condition it returned: what a record must meet one of.
 */
let heldTogether: WeakMap<
  Record<string, unknown>,
  Array<{ columnName?: string | undefined; condition: unknown }>
> = new WeakMap();

beforeEach(() => {
  ownedLookups = [];
  heldTogether = new WeakMap();
  withLabelJoinTables();

  jest
    .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
    .mockImplementation((async (
      _modelType: { new (): BaseModel },
      _props: DatabaseCommonInteractionProps,
      teamIds: ReadonlyArray<ObjectID>,
    ): Promise<Array<ObjectID>> => {
      ownedLookups.push(
        teamIds
          .map((teamId: ObjectID): string => {
            return teamId.toString();
          })
          .sort(),
      );
      return ownedIncidentIds(teamIds);
    }) as never);

  const anyOfConditions: typeof QueryHelper.anyOfConditions =
    QueryHelper.anyOfConditions.bind(QueryHelper);

  jest.spyOn(QueryHelper, "anyOfConditions").mockImplementation(
    (
      conditions: Array<{
        columnName?: string | undefined;
        condition: unknown;
      }>,
    ) => {
      const combined: ReturnType<typeof QueryHelper.anyOfConditions> =
        anyOfConditions(conditions as never);
      heldTogether.set(
        combined as unknown as Record<string, unknown>,
        conditions,
      );
      return combined;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Whether `incident` meets `condition`, a condition on its id: those held
 * together (any one of them), a label join table's (it carries one of the
 * labels), or one this helper reads directly (QueryConditions).
 */
function meets(condition: unknown, incident: FixtureIncident): boolean {
  const parts:
    | Array<{ columnName?: string | undefined; condition: unknown }>
    | undefined =
    condition && typeof condition === "object"
      ? heldTogether.get(condition as Record<string, unknown>)
      : undefined;

  if (parts) {
    return parts.some(
      (part: { columnName?: string | undefined; condition: unknown }) => {
        return !part.columnName && meets(part.condition, incident);
      },
    );
  }

  if (
    condition instanceof FindOperator &&
    condition.type === "and" &&
    Array.isArray(condition.value)
  ) {
    return (condition.value as Array<unknown>).every((each: unknown) => {
      return meets(each, incident);
    });
  }

  if (condition instanceof FindOperator && condition.type === "raw") {
    const sql: string = String(
      (condition.getSql as (alias: string) => string)("record"),
    );

    if (sql.includes('"IncidentLabel"')) {
      const labelIds: Array<string> = Object.values(
        condition.objectLiteralParameters || {},
      )
        .flat()
        .map((value: unknown): string => {
          return String(value).toLowerCase();
        });

      const carries: boolean = incident.labels.some(
        (labelId: ObjectID): boolean => {
          return labelIds.includes(labelId.toString().toLowerCase());
        },
      );

      // A block's: the record carries none of them.
      return sql.includes("NOT IN") ? !carries : carries;
    }
  }

  return meetsCondition(condition, incident.id);
}

// The incidents a request of the member's reaches, or null when refused.
async function incidentsReached(
  props: DatabaseCommonInteractionProps,
  type: DatabaseRequestType,
): Promise<Array<string> | null> {
  let query: Dictionary<unknown>;

  try {
    TablePermission.checkTableLevelPermissions(Incident, props, type);

    query = (await BasePermission.addRecordScopeToQuery(
      Incident,
      {},
      null,
      props,
      type,
    )) as Dictionary<unknown>;
  } catch (error) {
    expect(error).toBeInstanceOf(NotAuthorizedException);
    return null;
  }

  return INCIDENTS.filter((incident: FixtureIncident): boolean => {
    // A filter on the labels relation: the incident carries one of them.
    if (query["labels"] !== undefined) {
      const labelIds: Array<string> = (query["labels"] as Array<ObjectID>).map(
        (labelId: ObjectID): string => {
          return labelId.toString();
        },
      );

      if (
        !incident.labels.some((labelId: ObjectID): boolean => {
          return labelIds.includes(labelId.toString());
        })
      ) {
        return false;
      }
    }

    return query["_id"] === undefined || meets(query["_id"], incident);
  })
    .map((incident: FixtureIncident): string => {
      return incident.id;
    })
    .sort();
}

describe("what an operation's grants reach", () => {
  test("labels on one team and Owned on another: the labels and that team's records", () => {
    for (const type of [
      DatabaseRequestType.Read,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      const grant: LabelGrant = AccessControlPermission.getLabelGrantForModel(
        Incident,
        memberWith(EDIT_ON_BOTH),
        type,
      );

      expect([type, grant.labelIds.map(String)]).toEqual([
        type,
        [SECURITY.toString()],
      ]);
      expect([type, grant.ownedTeamIds?.map(String)]).toEqual([
        type,
        [OWNING_TEAM.toString()],
      ]);
    }
  });

  test("labels alone, Owned alone, and a grant over the whole project are as before", () => {
    expect(
      AccessControlPermission.getLabelGrantForModel(
        Incident,
        memberWith([limitedToSecurity(Permission.ReadProjectIncident)]),
        DatabaseRequestType.Read,
      ),
    ).toEqual({ labelIds: [SECURITY], ownedTeamIds: null });

    // Owned alone narrows through OwnedScopePermission, not by labels.
    expect(
      AccessControlPermission.getLabelGrantForModel(
        Incident,
        memberWith([ownedByTeam(Permission.ReadProjectIncident)]),
        DatabaseRequestType.Read,
      ),
    ).toEqual({ labelIds: [], ownedTeamIds: null });

    expect(
      AccessControlPermission.getLabelGrantForModel(
        Incident,
        memberWith([
          ...EDIT_ON_BOTH,
          grantRow(Permission.ReadProjectIncident, {
            scope: PermissionScope.All,
          }),
        ]),
        DatabaseRequestType.Read,
      ),
    ).toEqual({ labelIds: [], ownedTeamIds: null });
  });

  test("an Owned grant reaches every record of a kind it narrows nothing of, beside labels too", () => {
    // Monitor templates have no owners; probes are read by every reader of them.
    for (const [modelType, permission] of [
      [MonitorTemplate, Permission.ReadMonitorTemplate],
      [Probe, Permission.ReadMonitorProbe],
    ] as Array<[{ new (): BaseModel }, Permission]>) {
      expect(
        AccessControlPermission.getLabelGrantForModel(
          modelType,
          memberWith([limitedToSecurity(permission), ownedByTeam(permission)]),
          DatabaseRequestType.Read,
        ),
      ).toEqual({ labelIds: [], ownedTeamIds: null });
    }
  });

  test("a probe's change is narrowed by both: its owners are what a change keeps to", () => {
    const grant: LabelGrant = AccessControlPermission.getLabelGrantForModel(
      Probe,
      memberWith([
        limitedToSecurity(Permission.EditProjectProbe),
        ownedByTeam(Permission.EditProjectProbe),
      ]),
      DatabaseRequestType.Update,
    );

    expect(grant.labelIds).toEqual([SECURITY]);
    expect(grant.ownedTeamIds).toEqual([OWNING_TEAM]);
  });

  test("a grant within another's adds no condition of its own", () => {
    const narrow: LabelGrant = {
      labelIds: [SECURITY],
      ownedTeamIds: null,
    };
    const wide: LabelGrant = {
      labelIds: [SECURITY, BILLING],
      ownedTeamIds: [OWNING_TEAM],
    };
    const ownedElsewhere: LabelGrant = {
      labelIds: [SECURITY],
      ownedTeamIds: [OTHER_TEAM],
    };

    expect(AccessControlPermission.getGrantsToNarrowBy([wide, narrow])).toEqual(
      [narrow],
    );
    expect(
      AccessControlPermission.getGrantsToNarrowBy([wide, ownedElsewhere]),
    ).toEqual([wide, ownedElsewhere]);
    expect(
      AccessControlPermission.getGrantsToNarrowBy([
        ownedElsewhere,
        { labelIds: [], ownedTeamIds: null },
      ]),
    ).toEqual([ownedElsewhere]);
  });
});

describe("the records a read, a change and a delete reach", () => {
  test.each([
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ])(
    "%s: the Security incidents and the ones the member or the Owned grant's team own",
    async (type: DatabaseRequestType) => {
      expect(await incidentsReached(memberWith(EDIT_ON_BOTH), type)).toEqual(
        idsOf([
          SECURITY_UNOWNED,
          OWNED_BY_OWNING_TEAM,
          OWNED_BY_MEMBER,
          SECURITY_AND_OWNED,
        ]),
      );
    },
  );

  test("what the labelled team owns is not reached through the other team's Owned grant", async () => {
    expect(
      await incidentsReached(
        memberWith(EDIT_ON_BOTH),
        DatabaseRequestType.Update,
      ),
    ).not.toContain(OWNED_BY_LABELLED_TEAM.id);

    // Only the Owned grant's own team was asked about.
    expect(ownedLookups.length).toBeGreaterThan(0);

    for (const lookup of ownedLookups) {
      expect(lookup).toEqual([OWNING_TEAM.toString()]);
    }
  });

  test("a change on both reaches only what a read on labels alone also reaches", async () => {
    expect(
      await incidentsReached(
        memberWith([
          limitedToSecurity(Permission.ReadProjectIncident),
          limitedToSecurity(Permission.EditProjectIncident),
          ownedByTeam(Permission.EditProjectIncident),
        ]),
        DatabaseRequestType.Update,
      ),
    ).toEqual(idsOf([SECURITY_UNOWNED, SECURITY_AND_OWNED]));
  });

  test("a block with labels still takes its labels away from both", async () => {
    expect(
      await incidentsReached(
        memberWith([
          ...EDIT_ON_BOTH,
          grantRow(Permission.ReadProjectIncident, {
            isBlock: true,
            labelIds: [SECURITY],
          }),
        ]),
        DatabaseRequestType.Read,
      ),
    ).toEqual(idsOf([OWNED_BY_OWNING_TEAM, OWNED_BY_MEMBER]));
  });
});

describe("one record by its id", () => {
  test("an owned incident without the label is not refused by the labels", async () => {
    const check: (incident: FixtureIncident) => Promise<void> = async (
      incident: FixtureIncident,
    ): Promise<void> => {
      await AccessControlPermission.checkRecordByModel({
        modelType: Incident,
        props: memberWith(EDIT_ON_BOTH),
        type: DatabaseRequestType.Update,
        fetchModelWithAccessControlIds: async (): Promise<Incident> => {
          const record: Incident = new Incident(new ObjectID(incident.id));
          record.projectId = PROJECT_ID;
          record.labels = incident.labels.map((labelId: ObjectID): Label => {
            return new Label(labelId);
          });
          return record;
        },
      });
    };

    await expect(check(OWNED_BY_OWNING_TEAM)).resolves.toBeUndefined();
    await expect(check(SECURITY_UNOWNED)).resolves.toBeUndefined();
  });
});

describe("what a create makes", () => {
  const createIncident: (
    labels: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
  ) => Promise<void> = async (
    labels: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> => {
    const incident: Incident = new Incident();
    incident.projectId = PROJECT_ID;
    incident.labels = labels.map((labelId: ObjectID): Label => {
      return new Label(labelId);
    });

    await CreateScopePermission.checkCreateScope({
      modelType: Incident,
      data: incident,
      props: props,
      findRecordLabels: async (): Promise<Dictionary<Array<string>>> => {
        return {};
      },
      findLabelNames: async (): Promise<Array<string>> => {
        return ["Security"];
      },
    });
  };

  test("an incident without the label, which the member will own, is created", async () => {
    await expect(
      createIncident([], memberWith(EDIT_ON_BOTH)),
    ).resolves.toBeUndefined();
    await expect(
      createIncident([SECURITY], memberWith(EDIT_ON_BOTH)),
    ).resolves.toBeUndefined();
  });

  test("the create counts on its creator owning it", () => {
    const scope: CreateScope = CreateScopePermission.getCreateScope(
      Incident,
      memberWith(EDIT_ON_BOTH),
    );

    expect(scope.isOwnedOnly).toBe(false);
    expect(scope.isOwnedBesideLabels).toBe(true);
    expect(scope.ownedTeamIds).toEqual([OWNING_TEAM]);
  });

  test("a caller who is no person owns nothing: the label is still needed", async () => {
    await expect(
      createIncident([], memberWith(EDIT_ON_BOTH, { isNoPerson: true })),
    ).rejects.toThrow(
      new CreateScopeException(
        "Your access lets you create Incidents only with one of these labels: Security, or as their owner, and only a person can own one. Add one of the labels and try again.",
      ),
    );
  });

  test("labels alone still need the label", async () => {
    await expect(
      createIncident(
        [],
        memberWith([limitedToSecurity(Permission.CreateProjectIncident)]),
      ),
    ).rejects.toThrow(
      "Your access lets you create Incidents only with one of these labels: Security. Add one of them and try again.",
    );
  });

  describe("a note, under the incident it is on", () => {
    const NOTE_ROWS: Array<UserPermission> = [
      ...EDIT_ON_BOTH,
      limitedToSecurity(Permission.CreateIncidentInternalNote),
      ownedByTeam(Permission.CreateIncidentInternalNote),
    ];

    const addNote: (incident: FixtureIncident) => Promise<void> = async (
      incident: FixtureIncident,
    ): Promise<void> => {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.projectId = PROJECT_ID;
      note.incidentId = new ObjectID(incident.id);
      note.note = "A note";

      await CreateScopePermission.checkCreateScope({
        modelType: IncidentInternalNote,
        data: note,
        props: memberWith(NOTE_ROWS),
        findRecordLabels: async (lookup: {
          ids: Array<string>;
        }): Promise<Dictionary<Array<string>>> => {
          const labels: Dictionary<Array<string>> = {};

          for (const id of lookup.ids) {
            labels[id] =
              INCIDENTS.find((each: FixtureIncident): boolean => {
                return each.id === id;
              })?.labels.map((labelId: ObjectID): string => {
                return labelId.toString();
              }) || [];
          }

          return labels;
        },
        findLabelNames: async (): Promise<Array<string>> => {
          return ["Security"];
        },
      });
    };

    test("on an incident carrying the label, or one the member or the team owns", async () => {
      for (const incident of [
        SECURITY_UNOWNED,
        OWNED_BY_OWNING_TEAM,
        OWNED_BY_MEMBER,
      ]) {
        await expect(addNote(incident)).resolves.toBeUndefined();
      }
    });

    test("not on one that neither the label nor the owners reach", async () => {
      await expect(addNote(OWNED_BY_LABELLED_TEAM)).rejects.toThrow(
        "Your access lets you create Incident Internal Notes only for records with one of these labels: Security, or for the Incidents you or your teams own.",
      );
      await expect(addNote(NOBODY_S)).rejects.toBeInstanceOf(
        CreateScopeException,
      );
    });
  });
});

describe("what a change leaves", () => {
  const relabel: (
    incident: FixtureIncident,
    labels: Array<ObjectID>,
  ) => Promise<void> = async (
    incident: FixtureIncident,
    labels: Array<ObjectID>,
  ): Promise<void> => {
    await UpdateScopePermission.checkUpdateScope({
      modelType: Incident,
      data: {
        labels: labels.map((labelId: ObjectID): Label => {
          return new Label(labelId);
        }),
      },
      rows: [new Incident(new ObjectID(incident.id))],
      props: memberWith(EDIT_ON_BOTH),
      findRecordLabels: async (): Promise<Dictionary<Array<string>>> => {
        return {};
      },
      findLabelNames: async (): Promise<Array<string>> => {
        return ["Security"];
      },
    });
  };

  test("an owned incident may lose the label", async () => {
    await expect(relabel(SECURITY_AND_OWNED, [])).resolves.toBeUndefined();
  });

  test("one only the label reached may not", async () => {
    await expect(relabel(SECURITY_UNOWNED, [])).rejects.toThrow(
      new UpdateScopeException(
        "Your access lets you change Incidents only with one of these labels: Security, or the ones you or your teams own. Keep one of the labels and try again.",
      ),
    );
  });
});
