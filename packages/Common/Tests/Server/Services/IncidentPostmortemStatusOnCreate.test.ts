import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { StartingStage } from "../../../Utils/StartingStage";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * WHERE A NEW INCIDENT'S POSTMORTEM STARTS.
 *
 * Every incident's postmortem is in one of its project's postmortem
 * statuses. A create that names none - as every incident a monitor declares,
 * and every one declared from the dashboard - starts it by its fields
 * (Common/Utils/Incident/PostmortemStatus.getStartingStatus): not started,
 * draft when it is created with a note, completed when that note is
 * published on a status page. A status the create names stands.
 *
 * These run the real IncidentService.create - its hooks included - and stop
 * just before the row would be written, keeping what it would insert.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);

const NOT_STARTED_ID: string = "7d000000-0000-4000-8000-0000000000a1";
const DRAFT_ID: string = "7d000000-0000-4000-8000-0000000000a2";
const COMPLETED_ID: string = "7d000000-0000-4000-8000-0000000000a3";
const NOT_NEEDED_ID: string = "7d000000-0000-4000-8000-0000000000a4";
const CREATED_STATE_ID: string = "7d000000-0000-4000-8000-0000000000b1";

class PastTheChecks extends Error {
  public constructor() {
    super("Every check passed; the incident would be written now.");
  }
}

function status(
  id: string,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
): IncidentPostmortemStatus {
  const row: IncidentPostmortemStatus = new IncidentPostmortemStatus();
  row._id = id;
  row.name = name;
  row.order = order;
  row.isNotStartedStatus = Boolean(flags["isNotStartedStatus"]);
  row.isDraftStatus = Boolean(flags["isDraftStatus"]);
  row.isCompletedStatus = Boolean(flags["isCompletedStatus"]);
  return row;
}

const STATUSES: Array<IncidentPostmortemStatus> = [
  status(NOT_STARTED_ID, "Not Started", 1, { isNotStartedStatus: true }),
  status(DRAFT_ID, "Draft", 2, { isDraftStatus: true }),
  status(COMPLETED_ID, "Completed", 3, { isCompletedStatus: true }),
  status(NOT_NEEDED_ID, "Not Needed", 4),
];

// OneUptime declaring an incident: a monitor, a rule, a job.
const AS_ONEUPTIME: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

let inserted: Record<string, unknown> | undefined;
let statusReads: ReturnType<typeof getJestSpyOn>;

function newIncident(values: Record<string, unknown> = {}): Incident {
  const incident: Incident = new Incident();
  incident.projectId = PROJECT_ID;
  incident.title = "Checkout is down";
  incident.incidentSeverityId = new ObjectID(
    "7d000000-0000-4000-8000-0000000000c1",
  );

  for (const [key, value] of Object.entries(values)) {
    (incident as unknown as Record<string, unknown>)[key] = value;
  }

  return incident;
}

async function declare(
  incident: Incident,
  props: DatabaseCommonInteractionProps = AS_ONEUPTIME,
): Promise<unknown> {
  try {
    await IncidentService.create({ data: incident, props: props });
  } catch (error) {
    return error;
  }

  return undefined;
}

function insertedStatusId(): string | undefined {
  const value: unknown = inserted?.["postmortemStatusId"];

  return value === undefined || value === null ? undefined : String(value);
}

beforeEach(() => {
  inserted = undefined;

  statusReads = getJestSpyOn(
    IncidentPostmortemStatusService,
    "getProjectStatuses",
  ).mockResolvedValue(STATUSES as never);

  getJestSpyOn(IncidentStateService, "getStartingState").mockResolvedValue({
    stage: StartingStage.Open,
    flaggedResolved: false,
  } as never);
  getJestSpyOn(
    IncidentStateService,
    "getCreatedIncidentStateId",
  ).mockResolvedValue(new ObjectID(CREATED_STATE_ID) as never);
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(
    ProjectService,
    "incrementAndGetIncidentCounter",
  ).mockResolvedValue({ counter: 7, prefix: "INC-" } as never);
  getJestSpyOn(
    CustomFieldMappingService,
    "applyMappingsToCreate",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(IncidentCustomFieldService, "findBy").mockResolvedValue(
    [] as never,
  );
  getJestSpyOn(IncidentService, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(IncidentService, "assertCreateWillInsert").mockImplementation(((
    data: unknown,
  ): never => {
    inserted = { ...(data as Record<string, unknown>) };
    throw new PastTheChecks();
  }) as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new incident's postmortem starts by its fields", () => {
  test("not started, with no note - as every incident a monitor declares", async () => {
    expect(await declare(newIncident())).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBe(NOT_STARTED_ID);
    // The project's statuses, read for its project.
    expect(statusReads).toHaveBeenCalledTimes(1);
    expect(String(statusReads.mock.calls[0]![0])).toBe(PROJECT_ID.toString());
  });

  test("draft, created with a note", async () => {
    expect(
      await declare(
        newIncident({ postmortemNote: "## What happened\n\nA bad deploy." }),
      ),
    ).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBe(DRAFT_ID);
  });

  test("completed, created with its note published on the status page", async () => {
    expect(
      await declare(
        newIncident({
          postmortemNote: "## What happened",
          showPostmortemOnStatusPage: true,
        }),
      ),
    ).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBe(COMPLETED_ID);
  });

  test("a note of white space is no note: not started", async () => {
    expect(
      await declare(newIncident({ postmortemNote: " \n\t " })),
    ).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBe(NOT_STARTED_ID);
  });

  test("written under its ID column alone: a relation sent as null is no other name left to win", async () => {
    expect(
      await declare(newIncident({ postmortemStatus: null })),
    ).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBe(NOT_STARTED_ID);
    expect(inserted?.["postmortemStatus"]).toBeUndefined();
  });
});

describe("a status the create names stands", () => {
  test("by its ID column", async () => {
    expect(
      await declare(
        newIncident({ postmortemStatusId: new ObjectID(NOT_NEEDED_ID) }),
      ),
    ).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBe(NOT_NEEDED_ID);
    // Nothing to work out: the statuses are not read.
    expect(statusReads).not.toHaveBeenCalled();
  });

  test("by the relation, as a dashboard form sends it", async () => {
    const picked: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    picked._id = DRAFT_ID;

    expect(
      await declare(
        newIncident({
          postmortemStatus: picked,
          postmortemNote: "",
        }),
      ),
    ).toBeInstanceOf(PastTheChecks);

    // The relation the create named, filled into the ID column.
    expect(insertedStatusId()).toBe(DRAFT_ID);
    expect(statusReads).not.toHaveBeenCalled();
  });

  test("two names that disagree are refused, before anything is read", async () => {
    const picked: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    picked._id = DRAFT_ID;

    const refusal: unknown = await declare(
      newIncident({
        postmortemStatus: picked,
        postmortemStatusId: new ObjectID(COMPLETED_ID),
      }),
    );

    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toBeInstanceOf(PastTheChecks);
    expect(inserted).toBeUndefined();
  });
});

describe("a postmortem status never stops an incident from being declared", () => {
  test("statuses that cannot be read leave the incident with none, and say so in the log", async () => {
    statusReads.mockRejectedValue(new Error("Database not connected") as never);

    expect(await declare(newIncident())).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Reading the postmortem statuses failed in IncidentService.onBeforeCreate",
      ),
      expect.anything(),
    );
  });

  test("a project with no statuses yet declares its incident with none", async () => {
    statusReads.mockResolvedValue([] as never);

    expect(
      await declare(newIncident({ postmortemNote: "## A note" })),
    ).toBeInstanceOf(PastTheChecks);

    expect(insertedStatusId()).toBeUndefined();
  });

  test("the incident number is taken after the statuses are read, so a refused read burns none", async () => {
    const order: Array<string> = [];

    statusReads.mockImplementation((async () => {
      order.push("statuses");
      return STATUSES;
    }) as never);
    getJestSpyOn(
      ProjectService,
      "incrementAndGetIncidentCounter",
    ).mockImplementation((async () => {
      order.push("counter");
      return { counter: 7, prefix: "INC-" };
    }) as never);

    await declare(newIncident());

    expect(order).toEqual(["statuses", "counter"]);
  });
});
