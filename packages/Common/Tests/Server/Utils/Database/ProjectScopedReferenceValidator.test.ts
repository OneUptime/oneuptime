import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import UserService from "../../../../Server/Services/UserService";
import DataMigration from "../../../../Models/DatabaseModels/DataMigration";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ServerException from "../../../../Types/Exception/ServerException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test: an incident (or alert, or scheduled maintenance event)
 * stores the id of its state, its severity and the monitor status it switches
 * monitors to. Two things can be wrong with one of those ids, and the guard
 * refuses both.
 *
 * An id belonging to a *different* project is what leaves the referenced
 * project undeletable — deleting that project cascades into the record, the row
 * here still points at it, and the ON DELETE NO ACTION foreign key refuses the
 * delete with 23503.
 *
 * An id that exists NOWHERE is issue #3039: the REST API took any uuid for
 * these, and the write then failed as a raw foreign key violation deep in
 * Postgres — or, for ids stored in a JSON blob with no foreign key behind them,
 * saved fine and blew up much later inside the probe worker. Callers whose
 * reference is allowed to dangle opt out per reference with `mustExist: false`.
 *
 * Both get the same answer, which names the field and echoes the id the
 * caller sent: the records are read pinned to the project, so another
 * project's record - and its name - is never loaded. A user counts as the
 * project's while they hold a membership in it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);

const OWN_SEVERITY_ID: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127695";
const FOREIGN_SEVERITY_ID: string = "cfc2f04f-79cb-4344-8c54-dafe5e3a290c";
const FOREIGN_STATE_ID: string = "a2eb67d4-bd2e-4186-9187-dad799c9316c";
const FOREIGN_STATUS_ID: string = "1a1cf3f2-0e35-4a1e-98a1-3f0f8b5f7f9e";
const UNKNOWN_ID: string = "9c0ba0b3-2f8e-4c02-a8d5-6a4d2f5b9c11";
const OWN_USER_ID: string = "7c2f6b40-6a1b-4f18-9d0e-2c5ba2d3f0a7";
// A user of the platform with no membership in PROJECT_ID.
const STRANGER_ID: string = "5d0c43f4-11e5-4f3c-8a49-2f8c1b0d6e73";

const FOREIGN_NAME: string = "Sev 1 - another project";

const incidentSeverity: (
  id: string,
  projectId: ObjectID | undefined,
) => IncidentSeverity = (
  id: string,
  projectId: ObjectID | undefined,
): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = id;
  severity.name = FOREIGN_NAME;
  if (projectId) {
    severity.projectId = projectId;
  }
  return severity;
};

const incidentState: (id: string, projectId: ObjectID) => IncidentState = (
  id: string,
  projectId: ObjectID,
): IncidentState => {
  const state: IncidentState = new IncidentState();
  state._id = id;
  state.name = "Created elsewhere";
  state.projectId = projectId;
  return state;
};

const monitorStatus: (id: string, projectId: ObjectID) => MonitorStatus = (
  id: string,
  projectId: ObjectID,
): MonitorStatus => {
  const status: MonitorStatus = new MonitorStatus();
  status._id = id;
  status.name = "Operational elsewhere";
  status.projectId = projectId;
  return status;
};

type FoundRecords = {
  incidentSeverities?: Array<IncidentSeverity>;
  incidentStates?: Array<IncidentState>;
  monitorStatuses?: Array<MonitorStatus>;
};

/*
 * Lookups that answer with the records given, whatever the query asks: so a
 * record of another project still comes back from the pinned read, and the
 * validator has to notice its project itself.
 */
const mockLookups: (found: FoundRecords) => {
  severityFindBy: jest.Mock;
  stateFindBy: jest.Mock;
  statusFindBy: jest.Mock;
} = (found: FoundRecords) => {
  const severityFindBy: jest.Mock = jest.fn(async () => {
    return found.incidentSeverities || [];
  }) as unknown as jest.Mock;
  const stateFindBy: jest.Mock = jest.fn(async () => {
    return found.incidentStates || [];
  }) as unknown as jest.Mock;
  const statusFindBy: jest.Mock = jest.fn(async () => {
    return found.monitorStatuses || [];
  }) as unknown as jest.Mock;

  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation(severityFindBy as never);
  jest
    .spyOn(IncidentStateService, "findBy")
    .mockImplementation(stateFindBy as never);
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockImplementation(statusFindBy as never);

  return { severityFindBy, stateFindBy, statusFindBy };
};

type FindByCall = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

const callOf: (mock: jest.Mock, index: number) => FindByCall = (
  mock: jest.Mock,
  index: number,
): FindByCall => {
  return (mock.mock.calls[index] as unknown as Array<FindByCall>)[0]!;
};

// The ids a QueryHelper.any(...) operator asks for.
const idsIn: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    value as { objectLiteralParameters?: Record<string, unknown> };

  const ids: unknown = Object.values(operator.objectLiteralParameters || {})[0];

  return ((ids as Array<unknown>) || []).map((id: unknown): string => {
    return String(id);
  });
};

const refusalOf: (promise: Promise<unknown>) => Promise<string> = async (
  promise: Promise<unknown>,
): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The write was not refused.");
};

const severityReference: (
  id: string | ObjectID,
  mustExist?: boolean,
) => {
  modelName: string;
  id: string | ObjectID;
  service: DatabaseService<DatabaseBaseModel>;
  mustExist?: boolean;
} = (id: string | ObjectID, mustExist?: boolean) => {
  return {
    modelName: "Incident Severity",
    id: id,
    service: IncidentSeverityService as unknown as DatabaseService<DatabaseBaseModel>,
    ...(mustExist === undefined ? {} : { mustExist: mustExist }),
  };
};

/*
 * Memberships answered the way the database would: only rows of the queried
 * project, for the users asked about.
 */
const mockMemberships: (members: Array<string>) => jest.Mock = (
  members: Array<string>,
): jest.Mock => {
  const findBy: jest.Mock = jest.fn(async (data: unknown) => {
    const query: Record<string, unknown> = (data as FindByCall).query;

    if (String(query["projectId"]) !== PROJECT_ID.toString()) {
      return [];
    }

    return idsIn(query["userId"])
      .filter((id: string): boolean => {
        return members.includes(id.toLowerCase());
      })
      .map((id: string): TeamMember => {
        const membership: TeamMember = new TeamMember();
        membership.userId = new ObjectID(id);
        membership.projectId = PROJECT_ID;
        return membership;
      });
  }) as unknown as jest.Mock;

  jest
    .spyOn(ProjectScopedReferenceValidator.getLookupService(TeamMember), "findBy")
    .mockImplementation(findBy as never);

  return findBy;
};

const userReference: (id: string) => {
  modelName: string;
  id: string;
  service: DatabaseService<DatabaseBaseModel>;
} = (id: string) => {
  return {
    modelName: "Owner Users",
    id: id,
    service: UserService as unknown as DatabaseService<DatabaseBaseModel>,
  };
};

describe("ProjectScopedReferenceValidator", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a reference that belongs to another project", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [severityReference(FOREIGN_SEVERITY_ID)],
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("names the field and the id the caller sent, never what the id resolved to", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    const message: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [severityReference(FOREIGN_SEVERITY_ID)],
      }),
    );

    expect(message).toBe(
      `This incident references records that are not in this project: Incident Severity "${FOREIGN_SEVERITY_ID}". Please pick values from this project and try again.`,
    );
    expect(message).not.toContain(FOREIGN_NAME);
    expect(message).not.toContain(OTHER_PROJECT_ID.toString());
    expect(message).not.toContain("different project");
  });

  it("answers an id from another project exactly like an id that matches nothing", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    const foreign: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [severityReference(FOREIGN_SEVERITY_ID)],
      }),
    );

    jest.restoreAllMocks();
    mockLookups({ incidentSeverities: [] });

    const missing: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [severityReference(UNKNOWN_ID)],
      }),
    );

    expect(foreign.replace(FOREIGN_SEVERITY_ID, "<id>")).toBe(
      missing.replace(UNKNOWN_ID, "<id>"),
    );
  });

  it("reads each model pinned to the project, selecting only the id and the project", async () => {
    const { severityFindBy } = mockLookups({
      incidentSeverities: [incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID)],
    });

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: PROJECT_ID,
      references: [severityReference(OWN_SEVERITY_ID)],
    });

    expect(severityFindBy).toHaveBeenCalledTimes(1);

    const call: FindByCall = callOf(severityFindBy, 0);

    expect(String(call.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(idsIn(call.query["_id"])).toEqual([OWN_SEVERITY_ID]);
    expect(Object.keys(call.select).sort()).toEqual(["_id", "projectId"]);
  });

  it("accepts a reference that belongs to the same project", async () => {
    mockLookups({
      incidentSeverities: [incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID)],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [severityReference(OWN_SEVERITY_ID)],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an id that matches no record at all", async () => {
    /*
     * Issue #3039. This used to be allowed through on purpose, and the write
     * then either came back as an opaque foreign key violation from Postgres or
     * — in a JSON column with no foreign key — saved and failed later, at run
     * time, with nothing reported to whoever supplied the id.
     */
    mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [severityReference(UNKNOWN_ID)],
      }),
    ).rejects.toThrow(
      `This incident references records that are not in this project: Incident Severity "${UNKNOWN_ID}". Please pick values from this project and try again.`,
    );
  });

  it("accepts an UPPERCASE uuid for a record Postgres reads back lower-cased", async () => {
    /*
     * ObjectID keeps whatever case it was handed — its validation regex is
     * case-insensitive — and Postgres compares `uuid` by parsed value, so an
     * uppercase id in the payload selects the row fine but reads back
     * lower-cased. Comparing the two verbatim reported a record that plainly
     * exists as missing.
     */
    mockLookups({
      incidentSeverities: [incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID)],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [severityReference(OWN_SEVERITY_ID.toUpperCase())],
      }),
    ).resolves.toBeUndefined();
  });

  it("echoes the id as the caller wrote it", async () => {
    mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [severityReference(UNKNOWN_ID.toUpperCase())],
      }),
    ).rejects.toThrow(`Incident Severity "${UNKNOWN_ID.toUpperCase()}"`);
  });

  it("leaves a missing id alone when the caller opts out with mustExist false", async () => {
    /*
     * The opt-out exists for references with no foreign key behind them, where
     * a stored id really can dangle (deleting a monitor status does not rewrite
     * the monitor criteria that name it). Refusing those would stop a user
     * saving their way out of a record that was already broken.
     */
    mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [severityReference(UNKNOWN_ID, false)],
      }),
    ).resolves.toBeUndefined();
  });

  it("never lets mustExist false name another project's record, and reads only ids to tell", async () => {
    const { severityFindBy } = mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    const message: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "monitor's criteria",
        references: [severityReference(FOREIGN_SEVERITY_ID, false)],
      }),
    );

    expect(message).toContain(`Incident Severity "${FOREIGN_SEVERITY_ID}"`);
    expect(message).not.toContain(FOREIGN_NAME);

    // The pinned read, then one by id alone - selecting nothing but the id.
    expect(severityFindBy).toHaveBeenCalledTimes(2);
    expect(callOf(severityFindBy, 1).query["projectId"]).toBeUndefined();
    expect(Object.keys(callOf(severityFindBy, 1).select)).toEqual(["_id"]);
  });

  it("keeps the strictest requirement when the same id arrives twice", async () => {
    /*
     * Two monitor criteria can name the same status, one operative and one not.
     * They collapse to a single lookup, and the one that requires the record to
     * exist must not be dropped by the one that does not.
     */
    mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          severityReference(UNKNOWN_ID, false),
          severityReference(UNKNOWN_ID, true),
        ],
      }),
    ).rejects.toThrow("not in this project");
  });

  it("reports a foreign reference and a missing one in one clause, in the order given", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    const message: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [
          severityReference(UNKNOWN_ID),
          severityReference(FOREIGN_SEVERITY_ID),
        ],
      }),
    );

    expect(message).toBe(
      `This incident references records that are not in this project: Incident Severity "${UNKNOWN_ID}", Incident Severity "${FOREIGN_SEVERITY_ID}". Please pick values from this project and try again.`,
    );
  });

  it("does not require a record to exist when its project is unknown", async () => {
    /*
     * Root and internal writes do not always carry a project, and the guard
     * must stay out of the way rather than guess.
     */
    const { severityFindBy } = mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: undefined,
        references: [severityReference(UNKNOWN_ID)],
      }),
    ).resolves.toBeUndefined();

    expect(severityFindBy).not.toHaveBeenCalled();
  });

  it("counts a user only as a member of the project, read pinned to it", async () => {
    /*
     * A user has no project of their own, so "this project's" means a
     * membership in it - a TeamMember row in any of its teams. The users
     * table itself is never asked: a user existing somewhere on the
     * platform says nothing about this project.
     */
    const userFindBy: jest.Mock = jest.fn(async () => {
      const user: User = new User();
      user._id = STRANGER_ID;
      return [user];
    }) as unknown as jest.Mock;
    jest.spyOn(UserService, "findBy").mockImplementation(userFindBy as never);

    const memberships: jest.Mock = mockMemberships([OWN_USER_ID]);

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [userReference(OWN_USER_ID)],
      }),
    ).resolves.toBeUndefined();

    const message: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "monitor's criteria",
        references: [userReference(OWN_USER_ID), userReference(STRANGER_ID)],
      }),
    );

    expect(message).toBe(
      `This monitor's criteria references records that are not in this project: Owner Users "${STRANGER_ID}". Please pick values from this project and try again.`,
    );
    expect(userFindBy).not.toHaveBeenCalled();
    expect(String(callOf(memberships, 0).query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  it("counts a pending invitation as membership, as the pickers offer it", async () => {
    const memberships: jest.Mock = mockMemberships([OWN_USER_ID]);

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: PROJECT_ID,
      references: [userReference(OWN_USER_ID)],
    });

    // Any membership row: the query does not ask for an accepted invitation.
    expect(
      Object.keys(callOf(memberships, 0).query).sort(),
    ).toEqual(["projectId", "userId"]);
  });

  it("answers a user with no membership like a user id that matches nothing, even with mustExist false", async () => {
    mockMemberships([OWN_USER_ID]);

    const stranger: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [{ ...userReference(STRANGER_ID), mustExist: false }],
      }),
    );
    const nobody: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [userReference(UNKNOWN_ID)],
      }),
    );

    expect(stranger.replace(STRANGER_ID, "<id>")).toBe(
      nobody.replace(UNKNOWN_ID, "<id>"),
    );
  });

  it("does not count a membership read back from another project", async () => {
    // A lookup that ignores the project it was asked about.
    jest
      .spyOn(ProjectScopedReferenceValidator.getLookupService(TeamMember), "findBy")
      .mockImplementation((async (): Promise<Array<TeamMember>> => {
        const membership: TeamMember = new TeamMember();
        membership.userId = new ObjectID(OWN_USER_ID);
        membership.projectId = OTHER_PROJECT_ID;
        return [membership];
      }) as never);

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [userReference(OWN_USER_ID)],
      }),
    ).rejects.toThrow(`Owner Users "${OWN_USER_ID}"`);
  });

  it("checks existence only against a model that has no project of its own and is not a person", async () => {
    const service: DatabaseService<DatabaseBaseModel> =
      ProjectScopedReferenceValidator.getLookupService(
        DataMigration,
      ) as unknown as DatabaseService<DatabaseBaseModel>;

    const findBy: jest.Mock = jest.fn(async () => {
      const record: DataMigration = new DataMigration();
      record._id = OWN_SEVERITY_ID;
      return [record];
    }) as unknown as jest.Mock;
    jest.spyOn(service, "findBy").mockImplementation(findBy as never);

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          { modelName: "Data Migration", id: OWN_SEVERITY_ID, service: service },
        ],
      }),
    ).resolves.toBeUndefined();

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          { modelName: "Data Migration", id: UNKNOWN_ID, service: service },
        ],
      }),
    ).rejects.toThrow(`Data Migration "${UNKNOWN_ID}"`);

    expect(callOf(findBy, 0).query["projectId"]).toBeUndefined();
  });

  it("never sends a malformed id to the database, and answers it like any other", async () => {
    const { severityFindBy } = mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          severityReference("not-a-uuid"),
          severityReference("' OR 1=1 --", false),
        ],
      }),
    ).rejects.toThrow(
      `Incident Severity "not-a-uuid", Incident Severity "' OR 1=1 --"`,
    );

    expect(severityFindBy).not.toHaveBeenCalled();
  });

  it("reports every unavailable reference in a single message", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
      incidentStates: [incidentState(FOREIGN_STATE_ID, OTHER_PROJECT_ID)],
      monitorStatuses: [monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID)],
    });

    const message: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [
          {
            modelName: "Incident State",
            id: FOREIGN_STATE_ID,
            service: IncidentStateService,
          },
          severityReference(FOREIGN_SEVERITY_ID),
          {
            modelName: "Monitor Status",
            id: FOREIGN_STATUS_ID,
            service: MonitorStatusService,
          },
        ],
      }),
    );

    expect(message).toContain(`Incident State "${FOREIGN_STATE_ID}"`);
    expect(message).toContain(`Incident Severity "${FOREIGN_SEVERITY_ID}"`);
    expect(message).toContain(`Monitor Status "${FOREIGN_STATUS_ID}"`);
    expect(message).not.toContain("elsewhere");
  });

  it("mixes accepted and rejected references without letting the good one mask the bad one", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID),
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    const message: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          severityReference(OWN_SEVERITY_ID),
          severityReference(FOREIGN_SEVERITY_ID),
        ],
      }),
    );

    expect(message).toContain(`"${FOREIGN_SEVERITY_ID}"`);
    expect(message).not.toContain(`"${OWN_SEVERITY_ID}"`);
  });

  it("looks each model up once, with every id it was asked about", async () => {
    /*
     * These run on the incident create path, so three references must not mean
     * three round trips per model.
     */
    const { severityFindBy } = mockLookups({
      incidentSeverities: [
        incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID),
        incidentSeverity(FOREIGN_SEVERITY_ID, PROJECT_ID),
      ],
    });

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: PROJECT_ID,
      references: [
        severityReference(OWN_SEVERITY_ID),
        severityReference(FOREIGN_SEVERITY_ID),
      ],
    });

    expect(severityFindBy).toHaveBeenCalledTimes(1);
    expect(idsIn(callOf(severityFindBy, 0).query["_id"])).toEqual([
      OWN_SEVERITY_ID,
      FOREIGN_SEVERITY_ID,
    ]);
  });

  it("issues no query at all when nothing is being referenced", async () => {
    const { severityFindBy, stateFindBy, statusFindBy } = mockLookups({});

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: PROJECT_ID,
      references: [
        {
          modelName: "Incident Severity",
          id: undefined,
          service: IncidentSeverityService,
        },
        {
          modelName: "Incident State",
          id: null,
          service: IncidentStateService,
        },
        {
          modelName: "Monitor Status",
          id: "",
          service: MonitorStatusService,
        },
      ],
    });

    expect(severityFindBy).not.toHaveBeenCalled();
    expect(stateFindBy).not.toHaveBeenCalled();
    expect(statusFindBy).not.toHaveBeenCalled();
  });

  it("does nothing when the project is unknown", async () => {
    const { severityFindBy } = mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: undefined,
        references: [severityReference(FOREIGN_SEVERITY_ID)],
      }),
    ).resolves.toBeUndefined();

    expect(severityFindBy).not.toHaveBeenCalled();
  });

  it("treats an ObjectID and its string form as the same reference", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [severityReference(new ObjectID(FOREIGN_SEVERITY_ID))],
      }),
    ).rejects.toThrow("not in this project");
  });

  it("rejects a record read back with no project of its own", async () => {
    /*
     * A project-scoped record without a projectId is not this project's, and
     * treating "no project" as "same project" would let exactly the rows this
     * check exists for slip through.
     */
    mockLookups({
      incidentSeverities: [incidentSeverity(FOREIGN_SEVERITY_ID, undefined)],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [severityReference(FOREIGN_SEVERITY_ID)],
      }),
    ).rejects.toThrow("not in this project");
  });

  it("names the reference, instead of failing with a TypeError, when its service is missing", async () => {
    /*
     * MonitorStepsProjectValidator used to take the service from a table built
     * at module load, and an import cycle left the User entry `undefined`. The
     * lookup then threw
     *   TypeError: Cannot read properties of undefined (reading 'getModel')
     * and the API answered a bare 500 "Server Error" that named nothing. A
     * missing service is still a bug, but the error has to say which
     * reference could not be checked, and no lookup should have started.
     */
    const { severityFindBy } = mockLookups({
      incidentSeverities: [incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID)],
    });

    let thrown: unknown = null;

    try {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "monitor's criteria",
        references: [
          severityReference(OWN_SEVERITY_ID),
          {
            modelName: 'User (criteria "Monitor is offline" owner user)',
            id: OWN_USER_ID,
            service: undefined as unknown as DatabaseService<DatabaseBaseModel>,
          },
        ],
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ServerException);
    expect((thrown as ServerException).message).toBe(
      `Unable to check the User (criteria "Monitor is offline" owner user) this monitor's criteria references because its lookup service is not loaded. Please contact support.`,
    );
    expect(severityFindBy).not.toHaveBeenCalled();
  });

  it("says 'request' when the caller does not name the subject", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [severityReference(FOREIGN_SEVERITY_ID)],
      }),
    ).rejects.toThrow("This request references records");
  });
});

describe("ProjectScopedReferenceValidator lookups", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("hands out one plain lookup service per model", () => {
    const teams: DatabaseService<Team> =
      ProjectScopedReferenceValidator.getLookupService(Team);

    expect(ProjectScopedReferenceValidator.getLookupService(Team)).toBe(teams);
    expect(teams.getModel()).toBeInstanceOf(Team);
    expect(ProjectScopedReferenceValidator.getLookupService(TeamMember)).not.toBe(
      teams,
    );
  });

  it("knows a person by their model", () => {
    expect(ProjectScopedReferenceValidator.isUserModel(new User())).toBe(true);
    expect(ProjectScopedReferenceValidator.isUserModel(new Team())).toBe(false);
  });

  it("findIdsInProject keeps only rows of the project, normalized", async () => {
    const teams: DatabaseService<Team> =
      ProjectScopedReferenceValidator.getLookupService(Team);

    jest.spyOn(teams, "findBy").mockImplementation((async (): Promise<
      Array<Team>
    > => {
      const own: Team = new Team();
      own._id = OWN_SEVERITY_ID.toUpperCase();
      own.projectId = PROJECT_ID;

      const foreign: Team = new Team();
      foreign._id = FOREIGN_SEVERITY_ID;
      foreign.projectId = OTHER_PROJECT_ID;

      return [own, foreign];
    }) as never);

    const found: Set<string> =
      await ProjectScopedReferenceValidator.findIdsInProject({
        service: teams as unknown as DatabaseService<DatabaseBaseModel>,
        projectId: PROJECT_ID,
        ids: [OWN_SEVERITY_ID, FOREIGN_SEVERITY_ID],
      });

    expect(Array.from(found)).toEqual([OWN_SEVERITY_ID]);
  });

  it("asks nothing for an empty list", async () => {
    const teams: DatabaseService<Team> =
      ProjectScopedReferenceValidator.getLookupService(Team);
    const findBy: jest.Mock = jest.fn(async () => {
      return [];
    }) as unknown as jest.Mock;
    jest.spyOn(teams, "findBy").mockImplementation(findBy as never);

    await ProjectScopedReferenceValidator.findIdsInProject({
      service: teams as unknown as DatabaseService<DatabaseBaseModel>,
      projectId: PROJECT_ID,
      ids: [],
    });
    await ProjectScopedReferenceValidator.findExistingIds({
      service: teams as unknown as DatabaseService<DatabaseBaseModel>,
      ids: [],
    });
    await ProjectScopedReferenceValidator.findProjectMemberIds({
      projectId: PROJECT_ID,
      userIds: [],
    });

    expect(findBy).not.toHaveBeenCalled();
  });
});
