/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service, including
 * MonitorService, extends) imports it. Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * MonitorService.validateDependencyConfiguration guards the new
 * alert-dependency configuration (dependsOnMonitors +
 * suppressAlertsWhenParentMonitorStatuses) on both the create and update
 * write paths. These tests pin its contract without a database:
 *
 *   - `undefined` means "not part of this write" and validates nothing;
 *     an empty array (clearing the config) is always valid — neither may
 *     query.
 *   - Self-dependency, missing parents and cross-project parents are
 *     rejected with specific BadDataExceptions.
 *   - The upward cycle walk (throwIfDependencyCycle, exercised through
 *     the public method) rejects direct and transitive cycles and
 *     terminates cleanly on acyclic chains.
 *   - On create (monitorId null) the self/cycle checks are skipped but
 *     existence and project checks still run.
 *   - Suppression statuses are checked through
 *     ProjectScopedReferenceValidator against MonitorStatusService.
 */

// The house workaround for @jest/globals vs @types/jest spy typing.
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_C_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const STATUS_1_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const STATUS_2_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

// A bare id-only relation entry, the shape the API hands the hook.
type MakeMonitorRef = (id: ObjectID) => Monitor;

const makeMonitorRef: MakeMonitorRef = (id: ObjectID): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = id;
  return monitor;
};

// A row as the mocked findBy returns it (existence check or cycle walk).
type MakeMonitorRow = (input: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  dependsOn?: Array<ObjectID> | undefined;
}) => Monitor;

const makeMonitorRow: MakeMonitorRow = (input: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  dependsOn?: Array<ObjectID> | undefined;
}): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = input.id;
  if (input.projectId !== undefined) {
    monitor.projectId = input.projectId;
  }
  if (input.dependsOn !== undefined) {
    monitor.dependsOnMonitors = input.dependsOn.map((parentId: ObjectID) => {
      return makeMonitorRef(parentId);
    });
  }
  return monitor;
};

type MakeStatusRef = (id: ObjectID) => MonitorStatus;

const makeStatusRef: MakeStatusRef = (id: ObjectID): MonitorStatus => {
  const status: MonitorStatus = new MonitorStatus();
  status.id = id;
  return status;
};

type ValidateInput = {
  monitorId: ObjectID | null;
  projectId: ObjectID | null;
  proposedParents: Array<Monitor> | undefined;
  proposedSuppressionStatuses: Array<MonitorStatus> | undefined;
};

function validate(input: ValidateInput): Promise<void> {
  return MonitorService.validateDependencyConfiguration(input);
}

/*
 * Every response the sequenced findBy mock should serve, in call order.
 * Exhausting the sequence serves [] rather than falling through to the
 * real (database-backed) findBy.
 */
function spyOnFindBySequence(responses: Array<Array<Monitor>>): SpyLike {
  let callIndex: number = 0;

  return jest.spyOn(MonitorService, "findBy").mockImplementation((():
    | Promise<Array<Monitor>>
    | never => {
    const response: Array<Monitor> = responses[callIndex] || [];
    callIndex++;
    return Promise.resolve(response);
  }) as never) as unknown as SpyLike;
}

type ValidatorCall = {
  projectId: ObjectID;
  subject: string;
  references: Array<{
    modelName: string;
    id: ObjectID | string | undefined | null;
    service: DatabaseService<DatabaseBaseModel>;
  }>;
};

let validatorCalls: Array<ValidatorCall> = [];

function spyOnValidator(): void {
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation((async (data: ValidatorCall): Promise<void> => {
      validatorCalls.push(data);
    }) as never);
}

describe("MonitorService.validateDependencyConfiguration", () => {
  beforeEach(() => {
    validatorCalls = [];
    spyOnValidator();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("nothing to validate", () => {
    test("proposedParents undefined (not part of this write): no query, no throw", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: undefined,
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(0);
      expect(validatorCalls.length).toBe(0);
    });

    test("proposedParents [] (clearing the config): no query, no throw", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(0);
    });
  });

  describe("self-dependency", () => {
    test("a monitor listing itself as a parent is rejected before any query", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      const run: () => Promise<void> = () => {
        return validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [
            makeMonitorRef(MONITOR_B_ID),
            makeMonitorRef(MONITOR_A_ID),
          ],
          proposedSuppressionStatuses: undefined,
        });
      };

      await expect(run()).rejects.toThrow(BadDataException);
      await expect(run()).rejects.toThrow("A monitor cannot depend on itself.");
      expect(findBySpy.mock.calls.length).toBe(0);
    });
  });

  describe("existence and project checks", () => {
    test("a parent id matching no monitor is rejected", async () => {
      spyOnFindBySequence([[]]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(
        "One or more monitors in Depends On Monitors do not exist.",
      );
    });

    test("a parent from another project is rejected", async () => {
      spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: OTHER_PROJECT_ID })],
      ]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(
        "Monitors in Depends On Monitors must belong to the same project.",
      );
    });

    test("duplicate parent ids are deduped before the existence count compares", async () => {
      /*
       * [B, B] must dedupe to one id; findBy returning that single row must
       * NOT trip the "do not exist" length comparison. The walk then sees B
       * with no dependencies and terminates.
       */
      const findBySpy: SpyLike = spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [] })],
      ]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [
            makeMonitorRef(MONITOR_B_ID),
            makeMonitorRef(MONITOR_B_ID),
          ],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(2);
    });
  });

  describe("cycle detection (through the public method)", () => {
    test("direct cycle: B already depends on A, so A cannot depend on B", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        // Existence / project check for the proposed parent B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Cycle walk, frontier [B]: B's own parents include A.
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [MONITOR_A_ID] })],
      ]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(
        "This dependency would create a cycle: one of the selected monitors (or a monitor it depends on) already depends on this monitor.",
      );

      expect(findBySpy.mock.calls.length).toBe(2);
    });

    test("transitive cycle: A -> B -> C -> A is rejected", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        // Existence / project check for B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Walk level 1, frontier [B]: B depends on C.
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [MONITOR_C_ID] })],
        // Walk level 2, frontier [C]: C depends on A — closes the cycle.
        [makeMonitorRow({ id: MONITOR_C_ID, dependsOn: [MONITOR_A_ID] })],
      ]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow("would create a cycle");

      expect(findBySpy.mock.calls.length).toBe(3);
    });

    test("valid chain A -> B -> C terminates the walk without throwing", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        // Existence / project check for B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Walk level 1, frontier [B]: B depends on C.
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [MONITOR_C_ID] })],
        // Walk level 2, frontier [C]: C depends on nothing — walk ends.
        [makeMonitorRow({ id: MONITOR_C_ID, dependsOn: [] })],
      ]);

      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(3);
    });
  });

  describe("create path (monitorId null)", () => {
    test("self/cycle checks are skipped but existence and project checks still run", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
      ]);

      await expect(
        validate({
          monitorId: null,
          projectId: PROJECT_ID,
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      // Exactly the existence query — no cycle walk on create.
      expect(findBySpy.mock.calls.length).toBe(1);
    });

    test("a cross-project parent is still rejected on create", async () => {
      spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: OTHER_PROJECT_ID })],
      ]);

      await expect(
        validate({
          monitorId: null,
          projectId: PROJECT_ID,
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(
        "Monitors in Depends On Monitors must belong to the same project.",
      );
    });
  });

  describe("suppression statuses", () => {
    test("each proposed status is checked against MonitorStatusService in the monitor's project", async () => {
      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: undefined,
          proposedSuppressionStatuses: [
            makeStatusRef(STATUS_1_ID),
            makeStatusRef(STATUS_2_ID),
          ],
        }),
      ).resolves.toBeUndefined();

      expect(validatorCalls.length).toBe(1);

      const call: ValidatorCall = validatorCalls[0]!;
      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(call.subject).toBe("monitor");
      expect(
        call.references.map(
          (reference: {
            modelName: string;
            id: ObjectID | string | undefined | null;
            service: DatabaseService<DatabaseBaseModel>;
          }) => {
            return {
              modelName: reference.modelName,
              id: reference.id?.toString(),
              // Identity matters: the service picks the table the id is checked against.
              serviceIsMonitorStatusService:
                reference.service ===
                (MonitorStatusService as unknown as DatabaseService<DatabaseBaseModel>),
            };
          },
        ),
      ).toEqual([
        {
          modelName: "Monitor Status",
          id: STATUS_1_ID.toString(),
          serviceIsMonitorStatusService: true,
        },
        {
          modelName: "Monitor Status",
          id: STATUS_2_ID.toString(),
          serviceIsMonitorStatusService: true,
        },
      ]);
    });

    test("statuses undefined (not part of this write): the validator is never invoked", async () => {
      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: PROJECT_ID,
          proposedParents: undefined,
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(validatorCalls.length).toBe(0);
    });

    test("statuses without a projectId: the validator is never invoked", async () => {
      await expect(
        validate({
          monitorId: MONITOR_A_ID,
          projectId: null,
          proposedParents: undefined,
          proposedSuppressionStatuses: [makeStatusRef(STATUS_1_ID)],
        }),
      ).resolves.toBeUndefined();

      expect(validatorCalls.length).toBe(0);
    });
  });
});
