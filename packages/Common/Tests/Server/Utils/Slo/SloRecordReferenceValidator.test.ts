import SloRecordReferenceValidator from "../../../../Server/Utils/Slo/SloRecordReferenceValidator";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Incident.serviceLevelObjectives and Alert.serviceLevelObjectives are
 * writable by API callers. Nothing in the framework checks that a relation id
 * belongs to the row's project. An IncidentMember holding another project's
 * SLO id could therefore link it, and the created feed item, the lists, the AI
 * context and the metrics would all show that SLO's name inside the caller's
 * project.
 *
 * This validator is what the Incident and Alert write hooks call. The part
 * that matters most is that its read is pinned to the record's project. The
 * fake SLO table below answers an unpinned read with the foreign SLO too, so a
 * validator that dropped the pin would accept it and the rejection tests would
 * fail. The error must not name the foreign SLO either: that would leak the
 * same name through the error message.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000002",
);
const SLO_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000a1";
const SECOND_SLO_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000a2";
const FOREIGN_SLO_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000b1";
const FOREIGN_SLO_NAME: string = "Payments SLO of another project";
const MISSING_SLO_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000c1";

interface StoredSlo {
  id: string;
  projectId: ObjectID;
  name: string;
}

const SLO_TABLE: Array<StoredSlo> = [
  { id: SLO_ID, projectId: PROJECT_ID, name: "Checkout availability" },
  { id: SECOND_SLO_ID, projectId: PROJECT_ID, name: "Search latency" },
  { id: FOREIGN_SLO_ID, projectId: OTHER_PROJECT_ID, name: FOREIGN_SLO_NAME },
];

interface LookupArgs {
  query: JSONObject;
  select: JSONObject;
  limit: number;
  skip: number;
  props: JSONObject;
}

let anySpy: jest.SpyInstance;
let lookup: jest.SpyInstance;

// The ids the validator handed to QueryHelper.any for its latest read.
function lastRequestedIds(): Array<string> {
  const calls: Array<Array<unknown>> = anySpy.mock.calls as Array<
    Array<unknown>
  >;

  return ((calls[calls.length - 1]?.[0] as Array<unknown>) || []).map(
    (id: unknown): string => {
      return String(id).toLowerCase();
    },
  );
}

function validate(serviceLevelObjectives: unknown): Promise<void> {
  return SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
    {
      projectId: PROJECT_ID,
      subject: "incident",
      serviceLevelObjectives: serviceLevelObjectives,
    },
  );
}

async function rejectionOf(promise: Promise<void>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the validation to reject, but it resolved.");
}

beforeEach(() => {
  // Calls through: only records the ids each read asked for.
  anySpy = jest.spyOn(QueryHelper, "any");

  lookup = jest
    .spyOn(SloRecordReferenceValidator.getLookupService(), "findBy")
    .mockImplementation((async (
      args: LookupArgs,
    ): Promise<Array<ServiceLevelObjective>> => {
      const requestedIds: Array<string> = lastRequestedIds();
      const pinnedProjectId: string | undefined = (
        args.query["projectId"] as unknown as ObjectID | undefined
      )?.toString();

      return SLO_TABLE.filter((row: StoredSlo): boolean => {
        return (
          requestedIds.includes(row.id) &&
          (!pinnedProjectId || row.projectId.toString() === pinnedProjectId)
        );
      }).map((row: StoredSlo): ServiceLevelObjective => {
        const slo: ServiceLevelObjective = new ServiceLevelObjective();
        slo._id = row.id;
        slo.name = row.name;
        slo.projectId = row.projectId;
        return slo;
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject", () => {
  test("accepts SLOs of the record's own project, read as root, ids only, pinned to the project", async () => {
    await expect(
      validate([{ _id: SLO_ID }, { _id: SECOND_SLO_ID }]),
    ).resolves.toBeUndefined();

    expect(lookup).toHaveBeenCalledTimes(1);

    const args: LookupArgs = lookup.mock.calls[0]![0] as LookupArgs;

    expect((args.query["projectId"] as unknown as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(args.select).toEqual({ _id: true });
    expect(args.props).toEqual({ isRoot: true });
    expect(args.limit).toBe(2);
    expect(lastRequestedIds()).toEqual([SLO_ID, SECOND_SLO_ID]);
  });

  test("rejects another project's SLO", async () => {
    const error: Error = await rejectionOf(validate([{ _id: FOREIGN_SLO_ID }]));

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      `This incident references Service Level Objectives that do not exist in this project: "${FOREIGN_SLO_ID}". Please pick SLOs from this project and try again.`,
    );
  });

  test("the rejection never names the foreign SLO", async () => {
    const error: Error = await rejectionOf(validate([{ _id: FOREIGN_SLO_ID }]));

    expect(error.message).not.toContain(FOREIGN_SLO_NAME);
  });

  test("a foreign id and an id that matches nothing get the same answer", async () => {
    const foreign: Error = await rejectionOf(validate([FOREIGN_SLO_ID]));
    const missing: Error = await rejectionOf(validate([MISSING_SLO_ID]));

    expect(foreign.message.replace(FOREIGN_SLO_ID, "<id>")).toBe(
      missing.message.replace(MISSING_SLO_ID, "<id>"),
    );
  });

  test("names only the ids that are not in the project", async () => {
    const error: Error = await rejectionOf(
      validate([SLO_ID, FOREIGN_SLO_ID, MISSING_SLO_ID]),
    );

    expect(error.message).toContain(`"${FOREIGN_SLO_ID}", "${MISSING_SLO_ID}"`);
    expect(error.message).not.toContain(SLO_ID);
  });

  test("every read is pinned to the record's project, whatever the outcome", async () => {
    await validate([SLO_ID]);
    await rejectionOf(validate([FOREIGN_SLO_ID]));

    expect(lookup).toHaveBeenCalledTimes(2);

    for (const call of lookup.mock.calls) {
      const args: LookupArgs = call[0] as LookupArgs;

      expect(
        (
          args.query["projectId"] as unknown as ObjectID | undefined
        )?.toString(),
      ).toBe(PROJECT_ID.toString());
    }
  });

  test.each([
    ["a bare uuid string (the update shape)", SLO_ID],
    ["an upper-case uuid string", SLO_ID.toUpperCase()],
    ["an ObjectID", new ObjectID(SLO_ID)],
    ["an {_id} object (the API create shape)", { _id: SLO_ID }],
    ["an {id: ObjectID} object", { id: new ObjectID(SLO_ID) }],
  ])("accepts %s", async (_label: string, entry: unknown) => {
    await expect(validate([entry])).resolves.toBeUndefined();

    expect(lastRequestedIds()).toEqual([SLO_ID]);
  });

  test("accepts the burn-rate worker's id-stub model instance", async () => {
    const stub: ServiceLevelObjective = new ServiceLevelObjective();
    stub._id = SLO_ID;

    await expect(validate([stub])).resolves.toBeUndefined();

    expect(lastRequestedIds()).toEqual([SLO_ID]);
  });

  test("the same SLO twice is looked up once", async () => {
    await validate([SLO_ID, { _id: SLO_ID.toUpperCase() }]);

    expect(lastRequestedIds()).toEqual([SLO_ID]);
    expect((lookup.mock.calls[0]![0] as LookupArgs).limit).toBe(1);
  });

  test("a malformed id is rejected without a query", async () => {
    const error: Error = await rejectionOf(validate(["not-a-uuid"]));

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain('"not-a-uuid"');
    expect(lookup).not.toHaveBeenCalled();
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty list", []],
    ["entries without ids", [{ name: "Unsaved" }, null, ""]],
  ])(
    "%s links nothing, so nothing is read",
    async (_label: string, value: unknown) => {
      await expect(validate(value)).resolves.toBeUndefined();

      expect(lookup).not.toHaveBeenCalled();
    },
  );

  test("with no project to compare against the check is a no-op, as in ProjectScopedReferenceValidator", async () => {
    await expect(
      SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
        {
          projectId: undefined,
          subject: "alert",
          serviceLevelObjectives: [FOREIGN_SLO_ID],
        },
      ),
    ).resolves.toBeUndefined();

    expect(lookup).not.toHaveBeenCalled();
  });

  test("the subject names the record in the message", async () => {
    const error: Error = await rejectionOf(
      SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
        {
          projectId: PROJECT_ID,
          subject: "alert",
          serviceLevelObjectives: [FOREIGN_SLO_ID],
        },
      ),
    );

    expect(error.message.startsWith("This alert references")).toBe(true);
  });
});

/*
 * IncidentService and AlertService call this validator, and they cannot reach
 * ServiceLevelObjectiveService: it imports the burn-rate rule service, which
 * imports them. So the lookup must be a plain DatabaseService over the model.
 * A hooked subclass would run SLO hooks, and importing an SLO service would
 * bring the cycle back.
 */
describe("the SLO lookup does not reach the SLO services", () => {
  test("is a plain DatabaseService over the ServiceLevelObjective model, created once", () => {
    const service: DatabaseService<ServiceLevelObjective> =
      SloRecordReferenceValidator.getLookupService();

    expect(Object.getPrototypeOf(service)).toBe(DatabaseService.prototype);
    expect(service.getModel()).toBeInstanceOf(ServiceLevelObjective);
    expect(SloRecordReferenceValidator.getLookupService()).toBe(service);
  });

  test("the validator module imports DatabaseService and no other service", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../Server/Utils/Slo/SloRecordReferenceValidator.ts",
      ),
      "utf8",
    );

    const serviceImports: Array<string> = (
      source.match(/from "[^"]*\/Services\/[^"]*"/g) || []
    ).map((specifier: string): string => {
      return specifier.slice('from "'.length, -1);
    });

    expect(serviceImports).toEqual(["../../Services/DatabaseService"]);
  });
});
