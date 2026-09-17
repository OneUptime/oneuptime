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
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * MonitorService.validateDependencyConfiguration guards the
 * alert-dependency configuration (dependsOnMonitors +
 * suppressAlertsWhenParentMonitorStatuses) on both the create and update
 * write paths. These tests pin its contract without a database:
 *
 *   - The method is multi-target: a bulk update hands it every matched
 *     monitor's {monitorId, projectId} pair. Existence/project checks are
 *     hoisted to once per DISTINCT project and one BFS serves every
 *     target's cycle check.
 *   - `undefined` means "not part of this write" and validates nothing;
 *     an empty array (clearing the config), `null` (TypeORM's clear-all
 *     for relation columns) and non-array garbage validate nothing —
 *     none of them may query.
 *   - Proposed ids arrive as relation objects, ObjectIDs or bare uuid
 *     strings; all three shapes are validated and every comparison is
 *     case-insensitive (Postgres matches uuids by value).
 *   - Self-dependency is rejected before any query, per target.
 *   - Parent existence and same-project checks run through the REAL
 *     ProjectScopedReferenceValidator (its findBy is what the mock
 *     serves), so the house error wording is exercised end-to-end.
 *   - The upward cycle walk (throwIfDependencyCycle, exercised through
 *     the public method) rejects direct and transitive cycles, fails
 *     CLOSED when a frontier level hits the query limit (truncation
 *     could hide a cycle), and terminates cleanly on acyclic chains.
 *   - On create (monitorId null) the self/cycle checks are skipped but
 *     existence and project checks still run.
 *   - Suppression statuses are checked through
 *     ProjectScopedReferenceValidator against MonitorStatusService (that
 *     validator call is spied — statuses live in a different table).
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

type ValidateTarget = {
  monitorId: ObjectID | null;
  projectId: ObjectID | null;
};

type ValidateInput = {
  targets: Array<ValidateTarget>;
  proposedParents: unknown;
  proposedSuppressionStatuses: unknown;
};

function validate(input: ValidateInput): Promise<void> {
  return MonitorService.validateDependencyConfiguration(input);
}

// The single-target shape the per-monitor create/update paths produce.
function singleTarget(
  monitorId: ObjectID | null,
  projectId: ObjectID | null = PROJECT_ID,
): Array<ValidateTarget> {
  return [{ monitorId, projectId }];
}

/*
 * Every response the sequenced findBy mock should serve, in call order.
 * With proposed parents present, call #1 is the house validator's
 * existence/project lookup (select {_id, name, projectId}); the cycle
 * walk's frontier queries (select {_id, dependsOnMonitors}) follow.
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

/*
 * Replaces the house validator with a recorder. Used ONLY where the
 * validator would query a foreign table (MonitorStatusService) or where a
 * test asserts it is never reached — the parent existence/project tests
 * run the real validator so its wording is exercised.
 */
function spyOnValidator(): Array<ValidatorCall> {
  const calls: Array<ValidatorCall> = [];

  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation((async (data: ValidatorCall): Promise<void> => {
      calls.push(data);
    }) as never);

  return calls;
}

// Distinguishes the validator's existence lookups from cycle-walk queries.
function existenceLookupCalls(findBySpy: SpyLike): Array<Array<unknown>> {
  return findBySpy.mock.calls.filter((call: Array<unknown>) => {
    const select: Record<string, unknown> = (
      call[0] as { select: Record<string, unknown> }
    ).select;
    return select["projectId"] === true;
  });
}

describe("MonitorService.validateDependencyConfiguration", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("nothing to validate", () => {
    test("proposedParents undefined (not part of this write): no query, no throw", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);
      const validatorCalls: Array<ValidatorCall> = spyOnValidator();

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
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
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(0);
    });

    test("proposedParents null (TypeORM clear-all for relation columns): no query, no throw", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: null,
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(0);
    });

    test("proposedParents that is not an array at all: nothing to extract, no query, no throw", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: { _id: MONITOR_B_ID.toString() },
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
          targets: singleTarget(MONITOR_A_ID),
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

    test("a bare uuid STRING naming the monitor itself is rejected (string-shaped payloads are not exempt)", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [MONITOR_A_ID.toString()],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow("A monitor cannot depend on itself.");

      expect(findBySpy.mock.calls.length).toBe(0);
    });

    test("an UPPERCASE uuid naming the monitor itself is rejected (uuids compare case-insensitively)", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [
            makeMonitorRef(new ObjectID(MONITOR_A_ID.toString().toUpperCase())),
          ],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow("A monitor cannot depend on itself.");

      expect(findBySpy.mock.calls.length).toBe(0);
    });

    test("multi-target bulk: a parent that is ANY of the targets is rejected", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([]);

      await expect(
        validate({
          targets: [
            { monitorId: MONITOR_A_ID, projectId: PROJECT_ID },
            { monitorId: MONITOR_B_ID, projectId: PROJECT_ID },
          ],
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow("A monitor cannot depend on itself.");

      expect(findBySpy.mock.calls.length).toBe(0);
    });
  });

  describe("existence and project checks (through the real house validator)", () => {
    test("a parent id matching no monitor is rejected with the house wording", async () => {
      spyOnFindBySequence([[]]);

      const run: () => Promise<void> = () => {
        return validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        });
      };

      await expect(run()).rejects.toThrow(BadDataException);
      await expect(run()).rejects.toThrow(/do not exist/);
      // The message names the model and echoes the offending id.
      await expect(run()).rejects.toThrow(
        new RegExp(`Monitor "${MONITOR_B_ID.toString()}"`),
      );
    });

    test("a parent from another project is rejected with the house wording", async () => {
      spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: OTHER_PROJECT_ID })],
      ]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(/belong to a different project/);
    });

    test("a bare uuid STRING parent id is validated like any other shape", async () => {
      spyOnFindBySequence([[]]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [MONITOR_B_ID.toString()],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(/do not exist/);
    });

    test("duplicate parent ids are deduped; the validator lookup runs first with the id/name/project select", async () => {
      /*
       * [B, B] must dedupe to one id; findBy returning that single row must
       * satisfy the existence check. The walk then sees B with no
       * dependencies and terminates.
       */
      const findBySpy: SpyLike = spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [] })],
      ]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [
            makeMonitorRef(MONITOR_B_ID),
            makeMonitorRef(MONITOR_B_ID),
          ],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(2);

      // Call #1 is the validator's lookup: existence + tenant column.
      const validatorSelect: Record<string, unknown> = (
        findBySpy.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;
      expect(validatorSelect).toEqual({
        _id: true,
        name: true,
        projectId: true,
      });

      // Call #2 is the cycle walk: parents of the frontier.
      const walkSelect: Record<string, unknown> = (
        findBySpy.mock.calls[1]![0] as { select: Record<string, unknown> }
      ).select;
      expect(walkSelect).toEqual({
        _id: true,
        dependsOnMonitors: {
          _id: true,
        },
      });
    });

    test("two targets in the SAME project: the existence lookup runs once, not once per target", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        // One hoisted existence/project lookup for the shared project.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // One shared walk level: B has no parents of its own.
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [] })],
      ]);

      await expect(
        validate({
          targets: [
            { monitorId: MONITOR_A_ID, projectId: PROJECT_ID },
            { monitorId: MONITOR_C_ID, projectId: PROJECT_ID },
          ],
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(existenceLookupCalls(findBySpy).length).toBe(1);
      expect(findBySpy.mock.calls.length).toBe(2);
    });
  });

  describe("cycle detection (through the public method)", () => {
    test("direct cycle: B already depends on A, so A cannot depend on B", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        // Validator existence/project lookup for the proposed parent B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Cycle walk, frontier [B]: B's own parents include A.
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [MONITOR_A_ID] })],
      ]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
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
        // Validator existence/project lookup for B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Walk level 1, frontier [B]: B depends on C.
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [MONITOR_C_ID] })],
        // Walk level 2, frontier [C]: C depends on A — closes the cycle.
        [makeMonitorRow({ id: MONITOR_C_ID, dependsOn: [MONITOR_A_ID] })],
      ]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow("would create a cycle");

      expect(findBySpy.mock.calls.length).toBe(3);
    });

    test("valid chain A -> B -> C terminates the walk without throwing", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        // Validator existence/project lookup for B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Walk level 1, frontier [B]: B depends on C.
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [MONITOR_C_ID] })],
        // Walk level 2, frontier [C]: C depends on nothing — walk ends.
        [makeMonitorRow({ id: MONITOR_C_ID, dependsOn: [] })],
      ]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy.mock.calls.length).toBe(3);
    });

    test("one BFS serves every target: a chain reaching the SECOND target of a bulk update is a cycle", async () => {
      /*
       * Targets [A, C], proposed parent B, and B already depends on C. The
       * walk starts once from B and must recognize C — a target it did not
       * start from — as closing a cycle.
       */
      const findBySpy: SpyLike = spyOnFindBySequence([
        // Validator existence/project lookup for B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Walk level 1, frontier [B]: B depends on C (the second target).
        [makeMonitorRow({ id: MONITOR_B_ID, dependsOn: [MONITOR_C_ID] })],
      ]);

      await expect(
        validate({
          targets: [
            { monitorId: MONITOR_A_ID, projectId: PROJECT_ID },
            { monitorId: MONITOR_C_ID, projectId: PROJECT_ID },
          ],
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow("would create a cycle");

      // Exactly one walk (call #2) covered both targets.
      expect(findBySpy.mock.calls.length).toBe(2);
    });

    test("fail-closed: a frontier level as wide as the query limit is refused rather than silently truncated", async () => {
      /*
       * The walk reads each frontier level with limit LIMIT_PER_PROJECT. A
       * level that returns >= that many rows may have been truncated, and a
       * cycle routed through the dropped remainder would be admitted — so
       * the walk must refuse. Rows are never field-inspected before the
       * length check, so lightweight casts suffice.
       */
      const truncatedLevel: Array<Monitor> = Array.from(
        { length: LIMIT_PER_PROJECT },
        () => {
          return {} as unknown as Monitor;
        },
      );

      spyOnFindBySequence([
        // Validator existence/project lookup for B.
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
        // Walk level 1 comes back at the limit.
        truncatedLevel,
      ]);

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(/too large to verify/);
    });
  });

  describe("create path (monitorId null)", () => {
    test("self/cycle checks are skipped but existence and project checks still run", async () => {
      const findBySpy: SpyLike = spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: PROJECT_ID })],
      ]);

      await expect(
        validate({
          targets: singleTarget(null),
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      // Exactly the validator's existence query — no cycle walk on create.
      expect(findBySpy.mock.calls.length).toBe(1);
      expect(existenceLookupCalls(findBySpy).length).toBe(1);
    });

    test("a cross-project parent is still rejected on create", async () => {
      spyOnFindBySequence([
        [makeMonitorRow({ id: MONITOR_B_ID, projectId: OTHER_PROJECT_ID })],
      ]);

      await expect(
        validate({
          targets: singleTarget(null),
          proposedParents: [makeMonitorRef(MONITOR_B_ID)],
          proposedSuppressionStatuses: undefined,
        }),
      ).rejects.toThrow(/belong to a different project/);
    });
  });

  describe("suppression statuses", () => {
    test("each proposed status is checked against MonitorStatusService in the monitor's project", async () => {
      const validatorCalls: Array<ValidatorCall> = spyOnValidator();

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
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
      const validatorCalls: Array<ValidatorCall> = spyOnValidator();

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID),
          proposedParents: undefined,
          proposedSuppressionStatuses: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(validatorCalls.length).toBe(0);
    });

    test("statuses without a projectId on any target: the validator is never invoked", async () => {
      const validatorCalls: Array<ValidatorCall> = spyOnValidator();

      await expect(
        validate({
          targets: singleTarget(MONITOR_A_ID, null),
          proposedParents: undefined,
          proposedSuppressionStatuses: [makeStatusRef(STATUS_1_ID)],
        }),
      ).resolves.toBeUndefined();

      expect(validatorCalls.length).toBe(0);
    });
  });
});
