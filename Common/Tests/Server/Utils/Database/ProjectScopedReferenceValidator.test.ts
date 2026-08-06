import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import UserService from "../../../../Server/Services/UserService";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import User from "../../../../Models/DatabaseModels/User";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Name from "../../../../Types/Name";
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
 * saved fine and blew up much later inside the probe worker. Rejecting it here
 * names the id instead. Callers whose reference is allowed to dangle opt out
 * per reference with `mustExist: false`.
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

const incidentSeverity: (
  id: string,
  projectId: ObjectID,
) => IncidentSeverity = (id: string, projectId: ObjectID): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = id;
  severity.name = "Critical";
  severity.projectId = projectId;
  return severity;
};

const incidentState: (id: string, projectId: ObjectID) => IncidentState = (
  id: string,
  projectId: ObjectID,
): IncidentState => {
  const state: IncidentState = new IncidentState();
  state._id = id;
  state.name = "Created";
  state.projectId = projectId;
  return state;
};

const monitorStatus: (id: string, projectId: ObjectID) => MonitorStatus = (
  id: string,
  projectId: ObjectID,
): MonitorStatus => {
  const status: MonitorStatus = new MonitorStatus();
  status._id = id;
  status.name = "Operational";
  status.projectId = projectId;
  return status;
};

type FoundRecords = {
  incidentSeverities?: Array<IncidentSeverity>;
  incidentStates?: Array<IncidentState>;
  monitorStatuses?: Array<MonitorStatus>;
};

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
        references: [
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("names the model and the record in the rejection so the user can fix it", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow(
      'This incident references records that belong to a different project: Incident Severity "Critical". Please pick values from this project and try again.',
    );
  });

  it("accepts a reference that belongs to the same project", async () => {
    mockLookups({
      incidentSeverities: [incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID)],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "Incident Severity",
            id: OWN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
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
        references: [
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts an UPPERCASE uuid for a record Postgres reads back lower-cased", async () => {
    /*
     * ObjectID keeps whatever case it was handed — its validation regex is
     * case-insensitive — and Postgres compares `uuid` by parsed value, so an
     * uppercase id in the payload selects the row fine but reads back
     * lower-cased. Comparing the two verbatim reported a record that plainly
     * exists as missing, and the API answered "does not exist" for an id the
     * caller had just read out of a GET response.
     */
    mockLookups({
      incidentSeverities: [incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID)],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "Incident Severity",
            id: OWN_SEVERITY_ID.toUpperCase(),
            service: IncidentSeverityService,
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("echoes the id as the caller wrote it when reporting it missing", async () => {
    mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID.toUpperCase(),
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow(`Incident Severity "${UNKNOWN_ID.toUpperCase()}"`);
  });

  it("names the missing id in the rejection so the caller can find it", async () => {
    mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow(
      `This incident references records that do not exist: Incident Severity "${UNKNOWN_ID}". Please pick values that exist in this project and try again.`,
    );
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
        references: [
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID,
            service: IncidentSeverityService,
            mustExist: false,
          },
        ],
      }),
    ).resolves.toBeUndefined();
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
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID,
            service: IncidentSeverityService,
            mustExist: false,
          },
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID,
            service: IncidentSeverityService,
            mustExist: true,
          },
        ],
      }),
    ).rejects.toThrow("do not exist");
  });

  it("reports a foreign reference and a missing one in the same message", async () => {
    /*
     * A payload with several bad ids should not have to be fixed one
     * round-trip at a time.
     */
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    let message: string = "";

    try {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID,
            service: IncidentSeverityService,
          },
        ],
      });
    } catch (error) {
      message = (error as BadDataException).message;
    }

    expect(message).toContain(
      'belong to a different project: Incident Severity "Critical"',
    );
    expect(message).toContain(
      `do not exist: Incident Severity "${UNKNOWN_ID}"`,
    );
  });

  it("does not require a record to exist when its project is unknown", async () => {
    /*
     * Same reason the cross-project half is skipped: root and internal writes
     * do not always carry a project, and the guard must stay out of the way
     * rather than guess.
     */
    const { severityFindBy } = mockLookups({ incidentSeverities: [] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: undefined,
        references: [
          {
            modelName: "Incident Severity",
            id: UNKNOWN_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).resolves.toBeUndefined();

    expect(severityFindBy).not.toHaveBeenCalled();
  });

  it("checks existence against a model that has no project of its own", async () => {
    /*
     * Monitor criteria can name owner *users*, and User has no tenant column.
     * The cross-project comparison has to be skipped for those — comparing an
     * absent projectId against the write's project would report every user as
     * belonging to a different project — while the existence check still runs.
     */
    const user: User = new User();
    user._id = OWN_USER_ID;
    user.name = new Name("Alice");

    jest.spyOn(UserService, "findBy").mockResolvedValue([user] as never);

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "User",
            id: OWN_USER_ID,
            service:
              UserService as unknown as DatabaseService<DatabaseBaseModel>,
          },
        ],
      }),
    ).resolves.toBeUndefined();

    jest.spyOn(UserService, "findBy").mockResolvedValue([] as never);

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "User",
            id: UNKNOWN_ID,
            service:
              UserService as unknown as DatabaseService<DatabaseBaseModel>,
          },
        ],
      }),
    ).rejects.toThrow(`User "${UNKNOWN_ID}"`);
  });

  it("reports every foreign reference in a single message", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
      incidentStates: [incidentState(FOREIGN_STATE_ID, OTHER_PROJECT_ID)],
      monitorStatuses: [monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID)],
    });

    let message: string = "";

    try {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        references: [
          {
            modelName: "Incident State",
            id: FOREIGN_STATE_ID,
            service: IncidentStateService,
          },
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
          {
            modelName: "Monitor Status",
            id: FOREIGN_STATUS_ID,
            service: MonitorStatusService,
          },
        ],
      });
    } catch (error) {
      message = (error as BadDataException).message;
    }

    expect(message).toContain('Incident State "Created"');
    expect(message).toContain('Incident Severity "Critical"');
    expect(message).toContain('Monitor Status "Operational"');
  });

  it("mixes accepted and rejected references without letting the good one mask the bad one", async () => {
    mockLookups({
      incidentSeverities: [
        incidentSeverity(OWN_SEVERITY_ID, PROJECT_ID),
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    let message: string = "";

    try {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "Incident Severity",
            id: OWN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
      });
    } catch (error) {
      message = (error as BadDataException).message;
    }

    expect(message).toContain("belong to a different project");
  });

  it("looks each model up once, with every id it was asked about", async () => {
    /*
     * These run on the incident create path, so three references must not mean
     * three round trips per model. Both ids are returned so the existence check
     * has nothing to complain about and the call reaches its end.
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
        {
          modelName: "Incident Severity",
          id: OWN_SEVERITY_ID,
          service: IncidentSeverityService,
        },
        {
          modelName: "Incident Severity",
          id: FOREIGN_SEVERITY_ID,
          service: IncidentSeverityService,
        },
      ],
    });

    expect(severityFindBy).toHaveBeenCalledTimes(1);

    /*
     * QueryHelper.any() builds a Raw() operator that carries the ids as bound
     * parameters under a generated key, so assert on the serialized query
     * rather than on that key.
     */
    const query: string = JSON.stringify(
      (
        severityFindBy.mock.calls[0] as unknown as Array<{
          query: unknown;
        }>
      )[0]!.query,
    );

    expect(query).toContain(OWN_SEVERITY_ID);
    expect(query).toContain(FOREIGN_SEVERITY_ID);
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
    /*
     * Root and internal writes do not always carry a project. There is nothing
     * to compare against, so the check has to stay out of the way rather than
     * guess.
     */
    const { severityFindBy } = mockLookups({
      incidentSeverities: [
        incidentSeverity(FOREIGN_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: undefined,
        references: [
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
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
        references: [
          {
            modelName: "Incident Severity",
            id: new ObjectID(FOREIGN_SEVERITY_ID),
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow("belong to a different project");
  });

  it("falls back to the id when the foreign record has no name", async () => {
    const severity: IncidentSeverity = incidentSeverity(
      FOREIGN_SEVERITY_ID,
      OTHER_PROJECT_ID,
    );
    delete severity.name;

    mockLookups({ incidentSeverities: [severity] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow(`Incident Severity "${FOREIGN_SEVERITY_ID}"`);
  });

  it("rejects a record with no project of its own", async () => {
    /*
     * A project-scoped record without a projectId is not this project's, and
     * treating "no project" as "same project" would let exactly the rows this
     * check exists for slip through.
     */
    const severity: IncidentSeverity = incidentSeverity(
      FOREIGN_SEVERITY_ID,
      OTHER_PROJECT_ID,
    );
    delete severity.projectId;

    mockLookups({ incidentSeverities: [severity] });

    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        references: [
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow("belong to a different project");
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
        references: [
          {
            modelName: "Incident Severity",
            id: FOREIGN_SEVERITY_ID,
            service: IncidentSeverityService,
          },
        ],
      }),
    ).rejects.toThrow("This request references records");
  });
});
